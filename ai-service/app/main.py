"""FastAPI application factory, lifespan lifecycle, and authenticated route definitions."""

import asyncio
from contextlib import asynccontextmanager
import logging
from typing import Any, AsyncGenerator
from fastapi import Depends, FastAPI, HTTPException, Request, Response
from fastapi.exceptions import RequestValidationError
from fastapi.responses import JSONResponse, StreamingResponse
from pydantic import BaseModel, Field
from app.chat import ChatService
from app.config import Settings, get_settings
from app.embeddings import embed_query, is_model_available
from app.ingest import ingest_document, read_body_limited
from app.llm.ollama_client import check as llm_check
from app.security import (
    SecurityMiddleware,
    get_authorized_session,
    setup_cors,
)
from app.sessions import Session, SessionManager
from app.vectorstore import SessionStore

logger = logging.getLogger(__name__)


class SearchRequest(BaseModel):
    """Search query parameters schema."""

    query: str = Field(..., min_length=1, max_length=500)
    k: int = Field(default=5, ge=1, le=10)


@asynccontextmanager
async def lifespan(app: FastAPI) -> AsyncGenerator[None, None]:
    """Manage application startup, background tasks, and clean teardown."""
    if not hasattr(app.state, "vector_store") or app.state.vector_store is None:
        app.state.vector_store = SessionStore()
    if not hasattr(app.state, "session_manager") or app.state.session_manager is None:
        app.state.session_manager = SessionManager(
            vector_store=app.state.vector_store,
            settings=get_settings(),
        )
    if not hasattr(app.state, "chat_service") or app.state.chat_service is None:
        app.state.chat_service = ChatService(
            vector_store=app.state.vector_store,
            cfg=get_settings(),
        )

    app.state.session_manager.start_reaper(interval_seconds=2.0)
    try:
        yield
    finally:
        await app.state.session_manager.wipe_all()


def create_app(settings: Settings | None = None) -> FastAPI:
    """Construct and configure FastAPI application instance with security controls."""
    cfg = settings or get_settings()

    app = FastAPI(
        docs_url=None,
        redoc_url=None,
        openapi_url=None,
        lifespan=lifespan,
    )

    app.state.vector_store = SessionStore()
    app.state.session_manager = SessionManager(
        vector_store=app.state.vector_store,
        settings=cfg,
    )
    app.state.chat_service = ChatService(
        vector_store=app.state.vector_store,
        cfg=cfg,
    )

    setup_cors(app, cfg)
    app.add_middleware(SecurityMiddleware, settings=cfg)

    @app.exception_handler(HTTPException)
    async def http_exception_handler(
        request: Request,
        exc: HTTPException,
    ) -> JSONResponse:
        """Sanitize HTTP exceptions into generic response objects."""
        return JSONResponse(
            status_code=exc.status_code,
            content={"error": exc.detail},
            headers={
                "Cache-Control": "no-store",
                "X-Content-Type-Options": "nosniff",
            },
        )

    @app.exception_handler(RequestValidationError)
    async def validation_exception_handler(
        request: Request,
        exc: RequestValidationError,
    ) -> JSONResponse:
        """Sanitize validation errors without reflecting untrusted payloads."""
        return JSONResponse(
            status_code=422,
            content={"error": "Invalid request parameters."},
            headers={
                "Cache-Control": "no-store",
                "X-Content-Type-Options": "nosniff",
            },
        )

    @app.exception_handler(Exception)
    async def unhandled_exception_handler(
        request: Request,
        exc: Exception,
    ) -> JSONResponse:
        """Shield internal exception stacktraces from leaking to clients."""
        logger.error("Unhandled server exception: %s", type(exc).__name__)
        return JSONResponse(
            status_code=500,
            content={"error": "Internal server error."},
            headers={
                "Cache-Control": "no-store",
                "X-Content-Type-Options": "nosniff",
            },
        )

    @app.get("/health")
    async def health_check() -> dict[str, Any]:
        """Unauthenticated health endpoint reporting service and offline model status."""
        return {
            "status": "ok",
            "modelsReady": is_model_available(),
        }

    @app.post("/v1/sessions", status_code=201)
    async def create_session(request: Request) -> dict[str, Any]:
        """Establish a new ephemeral session and return access credentials."""
        session_manager: SessionManager = request.app.state.session_manager
        sid, token, expires_at = await session_manager.create()
        return {
            "sessionId": sid,
            "token": token,
            "expiresAt": expires_at,
            "ttlSeconds": cfg.session_ttl_seconds,
        }

    @app.post("/v1/sessions/{sid}/documents", status_code=201)
    async def upload_document(
        sid: str,
        request: Request,
        session: Session = Depends(get_authorized_session),
    ) -> dict[str, Any]:
        """Ingest raw document payload in-memory into the authenticated session."""
        session_manager: SessionManager = request.app.state.session_manager
        vector_store: SessionStore = request.app.state.vector_store

        body = await read_body_limited(request, cfg.max_upload_bytes)
        return await ingest_document(
            session_id=sid,
            data=body,
            session_manager=session_manager,
            vector_store=vector_store,
        )

    @app.post("/v1/sessions/{sid}/search")
    async def search_session(
        sid: str,
        payload: SearchRequest,
        request: Request,
        session: Session = Depends(get_authorized_session),
    ) -> dict[str, Any]:
        """Perform cosine similarity retrieval across ingested session documents."""
        vector_store: SessionStore = request.app.state.vector_store
        query_vector = await asyncio.to_thread(embed_query, payload.query)
        results = vector_store.query(
            session_id=sid,
            query_embedding=query_vector,
            k=payload.k,
        )
        return {"results": results}

    @app.delete("/v1/sessions/{sid}", status_code=204)
    async def delete_session(
        sid: str,
        request: Request,
        session: Session = Depends(get_authorized_session),
    ) -> Response:
        """Purge session metadata and associated vector store collection."""
        session_manager: SessionManager = request.app.state.session_manager
        await session_manager.delete(sid)
        return Response(status_code=204)

    @app.get("/v1/sessions/{sid}")
    async def get_session_info(
        sid: str,
        request: Request,
        session: Session = Depends(get_authorized_session),
    ) -> dict[str, Any]:
        """Retrieve non-sensitive session metadata and chunk counts."""
        vector_store: SessionStore = request.app.state.vector_store
        chunks_count = vector_store.count(sid)
        return {
            "documents": len(session.doc_ids),
            "chunks": chunks_count,
            "expiresAt": session.expires_at,
        }

    # ------------------------------------------------------------------ #
    #  Phase 6: LLM chat endpoints                                         #
    # ------------------------------------------------------------------ #

    class ChatRequest(BaseModel):
        """Incoming chat question payload."""

        question: str = Field(..., min_length=1, max_length=cfg.max_question_chars)
        mode: str = Field(default="auto")

    @app.get("/v1/llm/status")
    async def llm_status(request: Request) -> dict[str, Any]:
        """Probe local Ollama availability and model presence (unauthenticated)."""
        result = await llm_check(cfg)
        return {
            "ok": result["ok"],
            "detail": result["detail"],
            "model": cfg.llm_model,
        }

    @app.post("/v1/sessions/{sid}/chat")
    async def chat(
        sid: str,
        payload: ChatRequest,
        request: Request,
        session: Session = Depends(get_authorized_session),
    ) -> StreamingResponse:
        """Stream LLM answer as SSE for the given session question."""
        chat_service: ChatService = request.app.state.chat_service

        async def event_generator() -> AsyncGenerator[str, None]:
            async for frame in chat_service.answer_stream(payload.question, session, mode=payload.mode):
                yield frame

        return StreamingResponse(
            event_generator(),
            media_type="text/event-stream",
            headers={
                "Cache-Control": "no-store",
                "X-Accel-Buffering": "no",
                "X-Content-Type-Options": "nosniff",
            },
        )

    @app.delete("/v1/sessions/{sid}/history", status_code=204)
    async def clear_history(
        sid: str,
        request: Request,
        session: Session = Depends(get_authorized_session),
    ) -> Response:
        """Wipe the conversation history and summary cache for this session without deleting the session."""
        session.chat_history.clear()
        session.summary_cache.clear()
        request.app.state.vector_store.clear_summary_cache(sid)
        return Response(status_code=204)

    return app

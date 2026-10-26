"""Streaming upload receiver and in-memory document ingestion pipeline."""

import asyncio
import logging
import secrets
from typing import Any
from fastapi import HTTPException, Request
from app.chunking import chunk_pages
from app.config import get_settings
from app.embeddings import embed_texts
from app.extraction.dispatcher import extract
from app.schemas import (
    ExtractionError,
    ExtractionLimitError,
    UnsupportedTypeError,
)
from app.sessions import SessionManager
from app.vectorstore import SessionStore

logger = logging.getLogger(__name__)


async def read_body_limited(request: Request, max_bytes: int) -> bytearray:
    """Read request stream incrementally into a bytearray, enforcing size limits without disk spooling."""
    content_length = request.headers.get("content-length")
    if content_length is not None:
        try:
            if int(content_length) > max_bytes:
                raise HTTPException(
                    status_code=413,
                    detail="Payload exceeds maximum permitted size.",
                )
        except ValueError:
            pass

    body = bytearray()
    async for chunk in request.stream():
        body.extend(chunk)
        if len(body) > max_bytes:
            raise HTTPException(
                status_code=413,
                detail="Payload exceeds maximum permitted size.",
            )

    if not body:
        raise HTTPException(
            status_code=415,
            detail="Empty payload cannot be processed.",
        )

    return body


async def _run_extraction_pipeline(
    session_id: str,
    data: bytearray,
    session_manager: SessionManager,
    vector_store: SessionStore,
) -> dict[str, Any]:
    """Execute synchronous extraction, chunking, and embedding with session accounting."""
    await session_manager.check_doc_limit(session_id)

    raw_bytes = bytes(data)
    try:
        extraction_result = await asyncio.to_thread(extract, raw_bytes)
    finally:
        del raw_bytes

    settings = get_settings()
    chunks = chunk_pages(
        extraction_result.pages,
        chunk_chars=settings.chunk_chars,
        overlap=settings.chunk_overlap,
    )

    doc_id = secrets.token_urlsafe(16)

    embeddings: list[list[float]] = []
    if chunks:
        chunk_texts = [c.text for c in chunks]
        embeddings = await asyncio.to_thread(embed_texts, chunk_texts)

    vector_store.add_chunks(
        session_id=session_id,
        doc_id=doc_id,
        chunks=chunks,
        embeddings=embeddings,
    )
    await session_manager.add_doc_id(session_id, doc_id)

    logger.info(
        "Ingested document doc_id=%s with %d pages and %d chunks.",
        doc_id,
        extraction_result.page_count,
        len(chunks),
    )

    return {
        "docId": doc_id,
        "pageCount": extraction_result.page_count,
        "ocrPages": extraction_result.ocr_pages,
        "chunkCount": len(chunks),
        "warnings": extraction_result.warnings,
    }


async def ingest_document(
    session_id: str,
    data: bytearray,
    session_manager: SessionManager,
    vector_store: SessionStore,
    timeout_seconds: float = 120.0,
) -> dict[str, Any]:
    """Coordinate ingestion with memory zeroing guarantee, timeouts, and sanitized errors."""
    try:
        return await asyncio.wait_for(
            _run_extraction_pipeline(
                session_id=session_id,
                data=data,
                session_manager=session_manager,
                vector_store=vector_store,
            ),
            timeout=timeout_seconds,
        )
    except TimeoutError:
        raise HTTPException(
            status_code=504,
            detail="Document processing timed out.",
        )
    except UnsupportedTypeError:
        raise HTTPException(
            status_code=415,
            detail="Unsupported document format.",
        )
    except ExtractionLimitError:
        raise HTTPException(
            status_code=413,
            detail="Document exceeds permitted limits.",
        )
    except ExtractionError:
        raise HTTPException(
            status_code=422,
            detail="Document extraction failed.",
        )
    finally:
        if isinstance(data, bytearray):
            data[:] = b"\x00" * len(data)

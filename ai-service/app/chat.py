"""ChatService: orchestrates retrieval, prompting, LLM streaming, and SSE event emission."""

import asyncio
import json
import logging
import time
from typing import Any, AsyncIterator

from app.config import Settings, get_settings
from app.embeddings import embed_query
from app.llm.ollama_client import LlmUnavailableError, stream_chat
from app.llm.prompting import build_messages
from app.llm.safety import is_question_valid, sanitize_answer
from app.sessions import Session
from app.vectorstore import SessionStore

logger = logging.getLogger(__name__)

# Sliding-window duration in seconds
_RATE_WINDOW_SECONDS = 60.0


def _sse_event(event: str, data: Any) -> str:
    """Format a single Server-Sent Events frame."""
    payload = json.dumps(data, ensure_ascii=False)
    return f"event: {event}\ndata: {payload}\n\n"


class RateLimitError(Exception):
    """Raised when a session exceeds the per-minute chat rate limit."""

    def __init__(self, message: str = "Rate limit exceeded.") -> None:
        super().__init__(message)


class ChatService:
    """Stateless orchestrator for context-grounded LLM chat with SSE streaming.

    A single ChatService instance is shared across all requests. Per-session
    mutable state (history, lock, rate-limit timestamps) lives on the Session
    dataclass to ensure it is cleaned up when the session is deleted.
    """

    def __init__(
        self,
        vector_store: SessionStore,
        cfg: Settings | None = None,
    ) -> None:
        """Initialise with a shared vector store reference."""
        self._vector_store = vector_store
        self._cfg = cfg or get_settings()

    def _check_rate_limit(self, session: Session) -> None:
        """Enforce per-session sliding-window rate limit.

        Raises :class:`RateLimitError` when the session has fired
        ``max_chats_per_minute`` or more requests within the last 60 seconds.
        """
        now = time.monotonic()
        window_start = now - _RATE_WINDOW_SECONDS

        while session.chat_timestamps and session.chat_timestamps[0] < window_start:
            session.chat_timestamps.popleft()

        if len(session.chat_timestamps) >= self._cfg.max_chats_per_minute:
            raise RateLimitError(
                f"Rate limit: max {self._cfg.max_chats_per_minute} chats per minute."
            )

        session.chat_timestamps.append(now)

    async def _do_answer(
        self,
        question: str,
        session: Session,
    ) -> AsyncIterator[str]:
        """Internal async generator that performs retrieval → prompting → streaming.

        Must be called only while the session's generation_lock is held.
        Yields SSE-formatted strings.
        """
        # --- retrieval ---
        query_vector = await asyncio.to_thread(embed_query, question)
        raw_results = self._vector_store.query(
            session_id=session.session_id,
            query_embedding=query_vector,
            k=self._cfg.retrieval_k,
        )
        results = [
            r for r in raw_results
            if float(r.get("score", 0.0)) >= self._cfg.min_similarity
        ]

        # --- prompt construction ---
        messages, sources = build_messages(
            question=question,
            results=results,
            history=list(session.chat_history),
            cfg=self._cfg,
        )

        # Emit sources metadata before token stream
        source_meta = [
            {
                "page": s.get("page", 0),
                "source": s.get("source", ""),
                "score": s.get("score", 0.0),
                "docId": s.get("docId", ""),
            }
            for s in sources
        ]
        yield _sse_event("sources", source_meta)

        # --- LLM streaming ---
        answer_parts: list[str] = []
        async for token in stream_chat(messages, self._cfg):
            clean = sanitize_answer(token)
            if clean:
                answer_parts.append(clean)
                yield _sse_event("token", {"text": clean})

        full_answer = "".join(answer_parts)

        # --- persist history only on success ---
        session.chat_history.append({"role": "user", "content": question})
        session.chat_history.append({"role": "assistant", "content": full_answer})

        max_msgs = self._cfg.max_history_turns * 2
        while len(session.chat_history) > max_msgs:
            session.chat_history.popleft()

        yield _sse_event("done", {})

    async def answer_stream(
        self,
        question: str,
        session: Session,
    ) -> AsyncIterator[str]:
        """Yield SSE-formatted frames for a single chat question.

        SSE events (in order):
          ``sources`` → list of retrieval source dicts.
          ``token``   → one per LLM token fragment.
          ``done``    → empty dict, marks end of stream.
          ``error``   → dict with ``message`` key on any failure.

        Guarantees:
          - Only one concurrent stream per session.
          - Sliding-window rate limit enforced before retrieval.
          - Question validated before any retrieval or LLM call.
          - Tokens sanitised before emission.
          - History updated only on successful completion.
        """
        # --- input validation ---
        ok, reason = is_question_valid(question, self._cfg)
        if not ok:
            yield _sse_event("error", {"message": reason})
            return

        # --- rate limit (outside lock to fail fast) ---
        try:
            self._check_rate_limit(session)
        except RateLimitError as exc:
            yield _sse_event("error", {"message": str(exc)})
            return

        # --- ensure per-session lock exists ---
        if session.generation_lock is None:
            session.generation_lock = asyncio.Lock()

        # Non-blocking check: reject if already busy
        if session.generation_lock.locked():
            yield _sse_event(
                "error",
                {"message": "A response is already being generated for this session."},
            )
            return

        # Acquire the lock, drive the inner generator, release in finally
        await session.generation_lock.acquire()
        try:
            async for frame in self._do_answer(question, session):
                yield frame
        except LlmUnavailableError as exc:
            yield _sse_event("error", {"message": str(exc)})
        except Exception as exc:  # noqa: BLE001
            logger.warning("Chat pipeline error: %s", type(exc).__name__)
            yield _sse_event("error", {"message": "Unexpected error during chat."})
        finally:
            session.generation_lock.release()

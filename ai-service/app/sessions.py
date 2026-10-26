"""Session management with token hashing, TTL reaping, and concurrency controls."""

import asyncio
from collections import deque
from dataclasses import dataclass, field
import hashlib
import hmac
import logging
import secrets
import time
from typing import Callable, Optional
from app.config import Settings, get_settings
from app.schemas import ExtractionLimitError
from app.vectorstore import SessionStore

logger = logging.getLogger(__name__)


class AuthError(Exception):
    """Raised when session authentication or token authorization fails."""

    def __init__(self, message: str = "Authentication failed.") -> None:
        super().__init__(message)


@dataclass
class Session:
    """Ephemeral session state container."""

    session_id: str
    token_hash: str
    created_at: float
    last_accessed_at: float
    expires_at: float
    doc_ids: set[str] = field(default_factory=set)

    # Chat state — populated on first use by ChatService
    chat_history: deque = field(default_factory=deque)
    """Alternating user/assistant message dicts for the sliding context window."""
    generation_lock: Optional[asyncio.Lock] = field(default=None, repr=False)
    """Per-session mutex ensuring only one LLM stream runs at a time."""
    chat_timestamps: deque = field(default_factory=deque)
    """Monotonic timestamps of recent chat requests for rate-limit enforcement."""


class SessionManager:
    """Asyncio-safe session lifecycle manager with idle TTL and capacity limits."""

    def __init__(
        self,
        vector_store: SessionStore,
        settings: Optional[Settings] = None,
        clock: Optional[Callable[[], float]] = None,
    ) -> None:
        """Initialize session manager with dependencies and optional clock injection."""
        self._vector_store = vector_store
        self._settings = settings or get_settings()
        self._clock = clock or time.time
        self._lock = asyncio.Lock()
        self._sessions: dict[str, Session] = {}
        self._reaper_task: Optional[asyncio.Task[None]] = None
        self._reaper_stop_event = asyncio.Event()

    async def create(self) -> tuple[str, str, float]:
        """Create a new session, evicting the oldest session if capacity is exceeded."""
        async with self._lock:
            now = self._clock()

            # Evict expired sessions first
            expired_ids = [
                sid for sid, s in self._sessions.items() if now > s.expires_at
            ]
            for sid in expired_ids:
                self._sessions.pop(sid, None)
                self._vector_store.delete(sid)

            # Evict oldest active session if max_sessions reached
            if len(self._sessions) >= self._settings.max_sessions:
                oldest_sid = min(
                    self._sessions.keys(),
                    key=lambda k: self._sessions[k].last_accessed_at,
                )
                self._sessions.pop(oldest_sid, None)
                self._vector_store.delete(oldest_sid)
                logger.info("Evicted oldest session due to max_sessions cap.")

            session_id = secrets.token_urlsafe(32)
            token = secrets.token_urlsafe(32)
            token_hash = hashlib.sha256(token.encode("utf-8")).hexdigest()
            expires_at = now + self._settings.session_ttl_seconds

            session = Session(
                session_id=session_id,
                token_hash=token_hash,
                created_at=now,
                last_accessed_at=now,
                expires_at=expires_at,
            )
            self._sessions[session_id] = session
            self._vector_store.create(session_id)
            return session_id, token, expires_at

    async def authorize(self, session_id: str, token: str) -> Session:
        """Validate token hash using constant-time comparison and refresh idle TTL."""
        async with self._lock:
            session = self._sessions.get(session_id)
            if session is None:
                raise AuthError("Invalid or expired session.")

            now = self._clock()
            if now > session.expires_at:
                self._sessions.pop(session_id, None)
                self._vector_store.delete(session_id)
                raise AuthError("Invalid or expired session.")

            input_hash = hashlib.sha256(token.encode("utf-8")).hexdigest()
            if not hmac.compare_digest(input_hash, session.token_hash):
                raise AuthError("Invalid or expired session.")

            # Refresh idle expiration on successful authorization
            session.last_accessed_at = now
            session.expires_at = now + self._settings.session_ttl_seconds
            return session

    async def get_session(self, session_id: str) -> Optional[Session]:
        """Retrieve session record if present and unexpired."""
        async with self._lock:
            session = self._sessions.get(session_id)
            if session is None:
                return None
            if self._clock() > session.expires_at:
                self._sessions.pop(session_id, None)
                self._vector_store.delete(session_id)
                return None
            return session

    async def check_doc_limit(self, session_id: str) -> None:
        """Verify session has not exceeded maximum permitted documents."""
        async with self._lock:
            session = self._sessions.get(session_id)
            if session is None:
                raise AuthError("Invalid or expired session.")
            if len(session.doc_ids) >= self._settings.max_docs_per_session:
                raise ExtractionLimitError(
                    f"Session doc limit of {self._settings.max_docs_per_session} exceeded."
                )

    async def add_doc_id(self, session_id: str, doc_id: str) -> None:
        """Register an ingested document ID against the session."""
        async with self._lock:
            session = self._sessions.get(session_id)
            if session is not None:
                session.doc_ids.add(doc_id)

    async def delete(self, session_id: str) -> bool:
        """Explicitly terminate a session and purge its vector collection."""
        async with self._lock:
            removed = self._sessions.pop(session_id, None) is not None
            self._vector_store.delete(session_id)
            return removed

    async def reap_expired(self) -> int:
        """Purge all sessions that have exceeded their idle TTL."""
        async with self._lock:
            now = self._clock()
            expired_ids = [
                sid for sid, s in self._sessions.items() if now > s.expires_at
            ]
            for sid in expired_ids:
                self._sessions.pop(sid, None)
                self._vector_store.delete(sid)
            if expired_ids:
                logger.info("Reaped %d expired sessions.", len(expired_ids))
            return len(expired_ids)

    async def _reaper_loop(self, interval_seconds: float) -> None:
        """Internal worker loop periodically invoking reaper."""
        while not self._reaper_stop_event.is_set():
            try:
                await asyncio.wait_for(
                    self._reaper_stop_event.wait(),
                    timeout=interval_seconds,
                )
                break
            except asyncio.TimeoutError:
                await self.reap_expired()

    def start_reaper(self, interval_seconds: float = 2.0) -> None:
        """Start background reaper task if not already running."""
        if self._reaper_task is None or self._reaper_task.done():
            self._reaper_stop_event.clear()
            self._reaper_task = asyncio.create_task(
                self._reaper_loop(interval_seconds)
            )

    async def stop_reaper(self) -> None:
        """Signal reaper task to terminate and await its completion."""
        if self._reaper_task is not None:
            self._reaper_stop_event.set()
            try:
                await asyncio.wait_for(self._reaper_task, timeout=2.0)
            except (asyncio.TimeoutError, asyncio.CancelledError):
                self._reaper_task.cancel()
            self._reaper_task = None

    async def wipe_all(self) -> None:
        """Purge all active sessions and vector collections."""
        await self.stop_reaper()
        async with self._lock:
            self._sessions.clear()
            self._vector_store.reset()

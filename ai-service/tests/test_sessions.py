"""Session management tests covering token hashing, TTL reaper, eviction, and wipe_all."""

import hashlib
import pytest
from app.config import Settings
from app.schemas import ExtractionLimitError
from app.sessions import AuthError, SessionManager
from app.vectorstore import SessionStore


@pytest.mark.asyncio
async def test_token_stored_only_hashed():
    """Verify raw session tokens are never persisted in session objects."""
    store = SessionStore()
    manager = SessionManager(vector_store=store)

    session_id, raw_token, _ = await manager.create()
    session = await manager.get_session(session_id)
    assert session is not None

    # Token in session must be SHA-256 hash, not the raw token
    assert session.token_hash != raw_token
    expected_hash = hashlib.sha256(raw_token.encode("utf-8")).hexdigest()
    assert session.token_hash == expected_hash


@pytest.mark.asyncio
async def test_ttl_reaper_deletes_expired():
    """Verify TTL reaper purges expired sessions and cleans up vector store collections."""
    current_time = 1000.0

    def fake_clock() -> float:
        return current_time

    store = SessionStore()
    settings = Settings(session_ttl_seconds=100)
    manager = SessionManager(vector_store=store, settings=settings, clock=fake_clock)

    # Create two sessions at t=1000.0 (expire at t=1100.0)
    s1_id, tok1, _ = await manager.create()
    s2_id, tok2, _ = await manager.create()

    assert store.count(s1_id) == 0
    assert (await manager.get_session(s1_id)) is not None

    # Advance time to t=1050.0 and refresh session 1
    current_time = 1050.0
    await manager.authorize(s1_id, tok1)
    # Session 1 expires at 1050 + 100 = 1150.0
    # Session 2 still expires at 1100.0

    # Advance time to t=1110.0 (Session 2 expired, Session 1 active)
    current_time = 1110.0
    reaped = await manager.reap_expired()
    assert reaped == 1
    assert (await manager.get_session(s2_id)) is None
    assert (await manager.get_session(s1_id)) is not None

    # Advance past Session 1 expiry to t=1200.0
    current_time = 1200.0
    reaped2 = await manager.reap_expired()
    assert reaped2 == 1
    assert (await manager.get_session(s1_id)) is None


@pytest.mark.asyncio
async def test_max_sessions_evicts_oldest():
    """Verify max_sessions cap evicts the least recently accessed session."""
    current_time = 100.0

    def fake_clock() -> float:
        return current_time

    store = SessionStore()
    settings = Settings(max_sessions=3, session_ttl_seconds=1000)
    manager = SessionManager(vector_store=store, settings=settings, clock=fake_clock)

    # Create 3 sessions
    current_time = 100.0
    s1_id, tok1, _ = await manager.create()
    current_time = 110.0
    s2_id, tok2, _ = await manager.create()
    current_time = 120.0
    s3_id, tok3, _ = await manager.create()

    # Access s1 to make s2 the oldest
    current_time = 130.0
    await manager.authorize(s1_id, tok1)

    # Creating 4th session should evict s2
    current_time = 140.0
    s4_id, _, _ = await manager.create()

    assert (await manager.get_session(s1_id)) is not None
    assert (await manager.get_session(s2_id)) is None  # Evicted!
    assert (await manager.get_session(s3_id)) is not None
    assert (await manager.get_session(s4_id)) is not None


@pytest.mark.asyncio
async def test_max_docs_enforced():
    """Verify document limit per session is strictly checked."""
    store = SessionStore()
    settings = Settings(max_docs_per_session=2)
    manager = SessionManager(vector_store=store, settings=settings)

    session_id, _, _ = await manager.create()

    await manager.check_doc_limit(session_id)
    await manager.add_doc_id(session_id, "doc1")

    await manager.check_doc_limit(session_id)
    await manager.add_doc_id(session_id, "doc2")

    with pytest.raises(ExtractionLimitError):
        await manager.check_doc_limit(session_id)


@pytest.mark.asyncio
async def test_wipe_all_clears_everything():
    """Verify wipe_all destroys all sessions and resets vector store state."""
    store = SessionStore()
    manager = SessionManager(vector_store=store)

    s1_id, _, _ = await manager.create()
    s2_id, _, _ = await manager.create()

    assert (await manager.get_session(s1_id)) is not None
    assert (await manager.get_session(s2_id)) is not None

    await manager.wipe_all()

    assert (await manager.get_session(s1_id)) is None
    assert (await manager.get_session(s2_id)) is None
    assert store.count() == 0

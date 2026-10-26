"""Vector store tests verifying in-memory isolation, telemetry disabled, and k capping."""

from pathlib import Path
import pytest
from app.schemas import Chunk
from app.vectorstore import SessionStore


def test_vectorstore_in_memory_and_telemetry():
    """Verify ChromaDB EphemeralClient is memory-only with telemetry strictly disabled."""
    store = SessionStore()
    assert store._settings.anonymized_telemetry is False
    assert store._settings.is_persistent is False

    # Verify no persistent Chroma sqlite directory was created in current directory
    assert not (Path.cwd() / "chroma.sqlite3").exists()
    assert not (Path.cwd() / "chroma").exists()


def test_vectorstore_k_capped():
    """Verify query results are capped at maximum 10 items even if higher k is requested."""
    store = SessionStore()
    session_id = "test_k_cap_session"
    doc_id = "test_doc"

    # Generate 15 distinct chunks
    chunks: list[Chunk] = []
    embeddings: list[list[float]] = []

    for i in range(15):
        chunks.append(
            Chunk(
                text=f"Unique chunk content number {i} for vector testing.",
                page=1,
                source="test.pdf",
                index=i,
            )
        )
        # Simple distinct vector
        vec = [0.0] * 384
        vec[i % 384] = 1.0
        embeddings.append(vec)

    store.add_chunks(
        session_id=session_id,
        doc_id=doc_id,
        chunks=chunks,
        embeddings=embeddings,
    )

    assert store.count(session_id) == 15

    # Query with k=20 -> should return at most 10
    query_vec = [0.0] * 384
    query_vec[0] = 1.0
    results_20 = store.query(session_id=session_id, query_embedding=query_vec, k=20)
    assert len(results_20) == 10

    # Query with k=3 -> should return 3
    results_3 = store.query(session_id=session_id, query_embedding=query_vec, k=3)
    assert len(results_3) == 3

    # Clean up
    store.delete(session_id)
    assert store.count(session_id) == 0

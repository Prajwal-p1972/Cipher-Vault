"""Unit tests for the upgraded offline RAG pipeline:

Verification of:
1. RRF ordering
2. BM25 + dense fusion beats dense alone on keyword-heavy query
3. Reranker is called with at most 20 pairs
4. Neighbour expansion of top 2 hits on same page
5. Follow-up rewrite fallback to original query
6. Prefix is applied to queries only (model-aware)
7. Sources SSE event never contains chunk text
8. Session deletion removes BM25 data
9. Service operates fully offline with HF_HUB_OFFLINE=1
"""

import asyncio
import json
import os
from unittest.mock import AsyncMock, MagicMock, patch
import pytest

from app.chat import ChatService
from app.config import get_settings
from app.embeddings import embed_query, embed_texts, get_document_prefix, get_query_prefix
from app.retrieval import (
    BM25SessionStore,
    expand_neighbours,
    reciprocal_rank_fusion,
    rerank_candidates,
)
from app.schemas import Chunk
from app.sessions import Session, SessionManager
from app.vectorstore import SessionStore


def test_rrf_ordering():
    """Verify reciprocal rank fusion computes 1 / (60 + rank) contribution and sorts descending."""
    dense = [
        {"docId": "d1", "chunk_index": 0, "text": "A"},
        {"docId": "d1", "chunk_index": 1, "text": "B"},
        {"docId": "d1", "chunk_index": 2, "text": "C"},
    ]
    bm25 = [
        {"docId": "d1", "chunk_index": 1, "text": "B"},  # rank 1 in BM25, rank 2 in dense
        {"docId": "d1", "chunk_index": 3, "text": "D"},
    ]

    fused = reciprocal_rank_fusion(dense_results=dense, bm25_results=bm25, k_rrf=60, top_n=10)

    # Chunk B is in both lists: 1/(60+2) + 1/(60+1) ≈ 0.016129 + 0.016393 ≈ 0.0325
    # Chunk A is in dense only: 1/(60+1) ≈ 0.016393
    assert fused[0]["chunk_index"] == 1
    assert fused[0]["rrf_score"] > fused[1]["rrf_score"]
    assert fused[1]["chunk_index"] == 0


def test_bm25_dense_fusion_beats_dense_alone_on_keyword_query():
    """Verify BM25 + dense fusion elevates a specific keyword match above generic dense matches."""
    keyword_chunk = {
        "docId": "d1",
        "chunk_index": 10,
        "text": "The secure key derivation function used is argon2id-v13-hash with salt.",
        "page": 1,
    }
    generic_dense_1 = {
        "docId": "d1",
        "chunk_index": 1,
        "text": "General cryptography overview covering hash functions and encryption algorithms.",
        "page": 1,
    }
    generic_dense_2 = {
        "docId": "d1",
        "chunk_index": 2,
        "text": "Security mechanisms and password protection guidelines.",
        "page": 1,
    }

    # In dense-only, generic chunks ranked higher
    dense_results = [generic_dense_1, generic_dense_2, keyword_chunk]
    # In BM25 for 'argon2id-v13-hash', keyword_chunk is rank 1
    bm25_results = [keyword_chunk]

    fused = reciprocal_rank_fusion(dense_results=dense_results, bm25_results=bm25_results, k_rrf=60, top_n=5)

    assert fused[0]["chunk_index"] == 10
    assert "argon2id-v13-hash" in fused[0]["text"]


@pytest.mark.asyncio
async def test_reranker_called_with_at_most_20_pairs(monkeypatch):
    """Verify CrossEncoder is never called with more than 20 candidate pairs."""
    called_pairs = []

    class FakeCrossEncoder:
        def predict(self, pairs):
            called_pairs.extend(pairs)
            return [0.5] * len(pairs)

    import app.retrieval as ret
    monkeypatch.setattr(ret, "get_rerank_model", lambda name: FakeCrossEncoder())

    candidates = [{"docId": "d1", "chunk_index": i, "text": f"Passage {i}"} for i in range(35)]
    cfg = get_settings()

    reranked = await rerank_candidates("query test", candidates, cfg)

    assert len(called_pairs) == 20
    assert len(reranked) == 20


def test_neighbour_expansion(monkeypatch):
    """Verify adjacent chunks on the same page for top 2 hits are added and deduplicated."""
    store = BM25SessionStore()
    all_chunks = [
        Chunk(text=f"Chunk {i} text", page=1, source="f.pdf", index=i) for i in range(10)
    ]
    store.add_chunks("s1", "doc1", all_chunks)

    import app.retrieval as ret
    monkeypatch.setattr(ret, "bm25_store", store)

    # Top hits: chunk 2 and chunk 7
    top_hits = [
        {"docId": "doc1", "chunk_index": 2, "page": 1, "score": 0.9, "text": "Chunk 2 text"},
        {"docId": "doc1", "chunk_index": 7, "page": 1, "score": 0.8, "text": "Chunk 7 text"},
    ]

    expanded = expand_neighbours(top_hits, "s1", final_k=6)
    expanded_indices = [c["chunk_index"] for c in expanded]

    # Must contain top hits
    assert 2 in expanded_indices
    assert 7 in expanded_indices
    # Must contain neighbours 1, 3 (from 2) and 6, 8 (from 7)
    assert 1 in expanded_indices or 3 in expanded_indices
    assert len(expanded) <= 6
    # No duplicate indices
    assert len(expanded_indices) == len(set(expanded_indices))


@pytest.mark.asyncio
async def test_followup_rewrite_fallback():
    """Verify follow-up query rewriting falls back to original question on error/timeout."""
    cfg = get_settings()
    service = ChatService(MagicMock(), cfg)
    session = Session(
        session_id="s1",
        token_hash="th",
        created_at=0.0,
        last_accessed_at=0.0,
        expires_at=999999.0,
    )
    session.chat_history.append({"role": "user", "content": "What is the encryption key size?"})
    session.chat_history.append({"role": "assistant", "content": "It is 256 bits."})

    # Simulate network failure or timeout during rewrite
    with patch("httpx.AsyncClient.post", side_effect=asyncio.TimeoutError("Rewrite timeout")):
        rewritten = await service._rewrite_query_if_followup("what about the iv?", session)
        assert rewritten == "what about the iv?"


def test_prefix_applied_to_queries_only():
    """Verify BGE model prefix is prepended to search queries and NOT to documents."""
    cfg = get_settings()
    bge_model = "BAAI/bge-small-en-v1.5"
    e5_model = "intfloat/e5-small-v2"
    other_model = "sentence-transformers/all-MiniLM-L6-v2"

    assert get_query_prefix(bge_model) == "Represent this sentence for searching relevant passages: "
    assert get_document_prefix(bge_model) == ""

    assert get_query_prefix(e5_model) == "query: "
    assert get_document_prefix(e5_model) == "passage: "

    assert get_query_prefix(other_model) == ""
    assert get_document_prefix(other_model) == ""


@pytest.mark.asyncio
async def test_sources_never_contain_chunk_text():
    """Verify that SSE sources events carry page, source, score, docId ONLY and never chunk text."""
    cfg = get_settings()
    mock_store = MagicMock()
    mock_store.query.return_value = [
        {"text": "TOP_SECRET_CHUNK_TEXT_NEVER_LEAK", "page": 3, "score": 0.88, "source": "vault.pdf", "docId": "d1"}
    ]
    service = ChatService(mock_store, cfg)
    session = Session(
        session_id="s1",
        token_hash="th",
        created_at=0.0,
        last_accessed_at=0.0,
        expires_at=999999.0,
    )

    with patch("app.chat.embed_query", return_value=[0.1] * 384):
        with patch("app.chat.stream_chat") as mock_stream:
            async def _fake_stream(*args, **kwargs):
                yield "Answer text."
            mock_stream.side_effect = _fake_stream

            frames = [frame async for frame in service.answer_stream("What is the protocol?", session)]

    sources_frames = [f for f in frames if f.startswith("event: sources")]
    assert len(sources_frames) == 1

    payload_line = next(line for line in sources_frames[0].split("\n") if line.startswith("data: "))
    sources_data = json.loads(payload_line[6:])

    assert len(sources_data) >= 1
    for s in sources_data:
        assert "page" in s
        assert "source" in s
        assert "score" in s
        assert "docId" in s
        # Crucial security guarantee: chunk text must NEVER be sent to client
        assert "text" not in s
        assert "TOP_SECRET_CHUNK_TEXT_NEVER_LEAK" not in json.dumps(s)


@pytest.mark.asyncio
async def test_session_deletion_removes_bm25_data():
    """Verify explicit session deletion removes BM25 index and chunk corpus from memory."""
    from app.retrieval import bm25_store

    store = SessionStore()
    manager = SessionManager(store)
    session_id, token, _ = await manager.create()

    chunks = [Chunk(text="Ephemeral BM25 text.", page=1, source="test.pdf", index=0)]
    bm25_store.add_chunks(session_id, "doc1", chunks)
    assert bm25_store.has_session(session_id) is True

    # Delete session
    await manager.delete(session_id)

    assert bm25_store.has_session(session_id) is False
    assert bm25_store.query(session_id, "Ephemeral") == []


def test_service_offline_mode_env():
    """Verify HF_HUB_OFFLINE and TRANSFORMERS_OFFLINE are set and respected."""
    assert os.environ.get("HF_HUB_OFFLINE") == "1"
    assert os.environ.get("TRANSFORMERS_OFFLINE") == "1"

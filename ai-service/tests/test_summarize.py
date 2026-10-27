"""Unit tests for whole-document representative chunk selection and overview context building."""

import numpy as np
import pytest

from app.config import Settings
from app.schemas import Chunk
from app.sessions import Session
from app.summarize import (
    build_overview_context,
    is_table_of_contents_chunk,
    representative_indexes,
)
from app.vectorstore import SessionStore


def test_representative_indexes_deterministic():
    """Verify representative_indexes produces identical picks across multiple runs."""
    rng = np.random.RandomState(123)
    emb = rng.randn(30, 384).astype(np.float32)

    picks1 = representative_indexes(emb, k=6)
    picks2 = representative_indexes(emb, k=6)

    assert picks1 == picks2
    assert len(picks1) == 6
    assert picks1 == sorted(picks1)


def test_representative_indexes_well_separated_clusters():
    """Verify representative_indexes selects exactly one chunk per well-separated cluster."""
    # Create 4 well-separated clusters in orthogonal subspaces
    clusters = []
    dim = 16
    for c_i in range(4):
        center = np.zeros(dim, dtype=np.float32)
        center[c_i] = 1.0  # orthogonal unit basis
        # 5 samples per cluster with small noise
        noise = np.random.RandomState(c_i).randn(5, dim).astype(np.float32) * 0.05
        samples = center + noise
        clusters.append(samples)

    all_embs = np.vstack(clusters)  # 20 samples total, [0..4] in C0, [5..9] in C1, [10..14] in C2, [15..19] in C3
    picks = representative_indexes(all_embs, k=4)

    assert len(picks) == 4
    # Ensure one pick from each cluster interval
    cluster_0 = [p for p in picks if 0 <= p < 5]
    cluster_1 = [p for p in picks if 5 <= p < 10]
    cluster_2 = [p for p in picks if 10 <= p < 15]
    cluster_3 = [p for p in picks if 15 <= p < 20]

    assert len(cluster_0) == 1, f"Expected 1 pick in cluster 0, got {cluster_0}"
    assert len(cluster_1) == 1, f"Expected 1 pick in cluster 1, got {cluster_1}"
    assert len(cluster_2) == 1, f"Expected 1 pick in cluster 2, got {cluster_2}"
    assert len(cluster_3) == 1, f"Expected 1 pick in cluster 3, got {cluster_3}"


def test_representative_indexes_handles_n_less_or_equal_k():
    """Verify representative_indexes handles cases where total chunks <= k."""
    emb_3 = np.random.randn(3, 8).astype(np.float32)
    picks = representative_indexes(emb_3, k=5)
    assert picks == [0, 1, 2]

    emb_0 = np.empty((0, 8), dtype=np.float32)
    assert representative_indexes(emb_0, k=5) == []


def test_is_table_of_contents_chunk():
    """Verify TOC detection pattern matches TOC chunks and ignores prose."""
    toc_sample = (
        "Table of Contents\n\n"
        "1. Executive Summary ................................. 2\n"
        "2. Architecture Overview ............................. 5\n"
        "3. Security Specifications ........................... 8\n"
    )
    assert is_table_of_contents_chunk(toc_sample) is True

    prose_sample = (
        "Cipher Vault implements zero-trust architecture. All decryption keys "
        "remain exclusively in volatile RAM and are scrubbed upon process termination."
    )
    assert is_table_of_contents_chunk(prose_sample) is False


def test_build_overview_context_skips_toc_and_respects_cap():
    """Verify build_overview_context skips TOC, captures opening and outline, and respects max_chars."""
    store = SessionStore()
    session = Session(
        session_id="s_overview_test",
        token_hash="fake",
        created_at=0.0,
        last_accessed_at=0.0,
        expires_at=99999.0,
    )

    chunks = [
        Chunk(
            text="Table of Contents\n1. Intro ... 1\n2. Body ... 2\n3. Conclusion ... 3",
            page=1,
            source="manual.pdf",
            index=0,
            section="TOC",
        ),
        Chunk(
            text="Opening overview text of the document introducing the system.",
            page=2,
            source="manual.pdf",
            index=1,
            section="Introduction",
        ),
        Chunk(
            text="Second section explaining key cryptography details and key management.",
            page=3,
            source="manual.pdf",
            index=2,
            section="Cryptography",
        ),
        Chunk(
            text="Third section analyzing operational security and network isolation.",
            page=4,
            source="manual.pdf",
            index=3,
            section="Operations",
        ),
    ]

    embs = np.random.randn(4, 384).astype(np.float32).tolist()
    store.add_chunks(session.session_id, "doc1", chunks, embs)

    cfg = Settings(summary_max_chars=2000)
    context, pages_used = build_overview_context(session, vector_store=store, cfg=cfg)

    # TOC content should NOT be in context
    assert "Table of Contents" not in context
    # Opening and sections should be in context
    assert "Document Opening:" in context
    assert "Opening overview text" in context
    assert "Document Outline:" in context
    assert "Introduction" in context
    assert "Cryptography" in context

    # Check pages used
    assert 2 in pages_used
    assert 3 in pages_used
    assert len(context) <= cfg.summary_max_chars

    # Clean up
    store.delete(session.session_id)

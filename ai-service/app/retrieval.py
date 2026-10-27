"""Hybrid retrieval (dense + BM25), Reciprocal Rank Fusion, CrossEncoder reranking, and neighbour expansion.

All data remains strictly in-memory per session; BM25 indexes are purged when sessions terminate.
"""

import asyncio
import logging
import os
import re
from typing import Any, Optional
from rank_bm25 import BM25Okapi
from sentence_transformers import CrossEncoder

from app.config import Settings, get_settings
from app.embeddings import embed_query
from app.schemas import Chunk
from app.vectorstore import SessionStore

logger = logging.getLogger("cipher_vault.retrieval")

# Regular expression tokenizer for BM25
_WORD_RE = re.compile(r"\w+")

_RERANK_MODEL: Optional[CrossEncoder] = None
_RERANK_MODEL_NAME: Optional[str] = None


def tokenize(text: str) -> list[str]:
    """Tokenize text into lowercase word tokens for BM25 scoring."""
    if not text:
        return []
    return _WORD_RE.findall(text.lower())


class BM25SessionStore:
    """Manages in-memory BM25 indexes per ephemeral document session."""

    def __init__(self) -> None:
        # session_id -> (BM25Okapi instance, list of chunk dicts)
        self._indexes: dict[str, tuple[Optional[BM25Okapi], list[dict[str, Any]]]] = {}

    def add_chunks(
        self,
        session_id: str,
        doc_id: str,
        chunks: list[Chunk],
    ) -> None:
        """Register or rebuild the in-memory BM25 index for a session."""
        if not chunks:
            return

        existing_chunks = []
        if session_id in self._indexes:
            existing_chunks = self._indexes[session_id][1]

        # Convert Chunk instances to standardized dictionaries
        new_chunks = [
            {
                "text": c.text,
                "page": c.page,
                "source": c.source,
                "chunk_index": c.index,
                "docId": doc_id,
                "section": getattr(c, "section", ""),
                "kind": getattr(c, "kind", "text"),
            }
            for c in chunks
        ]

        all_chunks = existing_chunks + new_chunks
        corpus = [tokenize(c["text"]) for c in all_chunks]
        bm25 = BM25Okapi(corpus) if corpus else None
        self._indexes[session_id] = (bm25, all_chunks)
        logger.debug("BM25 index updated for session with %d total chunks", len(all_chunks))

    def get_session_chunks(self, session_id: str) -> list[dict[str, Any]]:
        """Return all chunk dictionaries associated with a session."""
        if session_id in self._indexes:
            return self._indexes[session_id][1]
        return []

    def query(
        self,
        session_id: str,
        query_text: str,
        k: int = 20,
    ) -> list[dict[str, Any]]:
        """Query top-k chunks using BM25 Okapi scoring."""
        if session_id not in self._indexes:
            return []

        bm25, chunks = self._indexes[session_id]
        if bm25 is None or not chunks:
            return []

        tokenized_query = tokenize(query_text)
        if not tokenized_query:
            return []

        scores = bm25.get_scores(tokenized_query)

        # Retain chunks with positive keyword scores
        scored_pairs = [
            (i, float(scores[i])) for i in range(len(scores)) if scores[i] > 0.0
        ]
        if not scored_pairs:
            return []

        scored_pairs.sort(key=lambda pair: pair[1], reverse=True)
        top_pairs = scored_pairs[:k]

        return [
            {
                **chunks[idx],
                "score": score,
                "bm25_score": score,
            }
            for idx, score in top_pairs
        ]

    def delete(self, session_id: str) -> None:
        """Purge BM25 index and chunk corpus for the specified session."""
        self._indexes.pop(session_id, None)
        logger.debug("Purged BM25 index for session")

    def clear(self) -> None:
        """Purge all in-memory BM25 indexes."""
        self._indexes.clear()

    def has_session(self, session_id: str) -> bool:
        """Check if a session exists in the BM25 store."""
        return session_id in self._indexes


# Global shared in-memory BM25 store singleton
bm25_store = BM25SessionStore()


def reciprocal_rank_fusion(
    dense_results: list[dict[str, Any]],
    bm25_results: list[dict[str, Any]],
    k_rrf: int = 60,
    top_n: int = 20,
) -> list[dict[str, Any]]:
    """Merge ranked dense and BM25 candidate lists using Reciprocal Rank Fusion (k=60)."""
    # Key mapping: chunk identity (docId, chunk_index) -> (rrf_score, chunk_dict)
    combined: dict[tuple[str, int], tuple[float, dict[str, Any]]] = {}

    for rank, item in enumerate(dense_results, start=1):
        key = (str(item.get("docId", "")), int(item.get("chunk_index", 0)))
        rrf_contrib = 1.0 / (k_rrf + rank)
        score, stored = combined.get(key, (0.0, item))
        combined[key] = (score + rrf_contrib, stored)

    for rank, item in enumerate(bm25_results, start=1):
        key = (str(item.get("docId", "")), int(item.get("chunk_index", 0)))
        rrf_contrib = 1.0 / (k_rrf + rank)
        score, stored = combined.get(key, (0.0, item))
        combined[key] = (score + rrf_contrib, stored)

    # Sort combined candidates by aggregated RRF score descending
    sorted_candidates = sorted(combined.values(), key=lambda x: x[0], reverse=True)

    results: list[dict[str, Any]] = []
    for rrf_score, item in sorted_candidates[:top_n]:
        candidate = dict(item)
        candidate["rrf_score"] = round(rrf_score, 6)
        results.append(candidate)

    return results


def get_rerank_model(model_name: str) -> CrossEncoder:
    """Load or retrieve lazy singleton CrossEncoder model in offline mode."""
    global _RERANK_MODEL, _RERANK_MODEL_NAME
    if _RERANK_MODEL is None or _RERANK_MODEL_NAME != model_name:
        os.environ["HF_HUB_OFFLINE"] = "1"
        os.environ["TRANSFORMERS_OFFLINE"] = "1"
        try:
            _RERANK_MODEL = CrossEncoder(model_name, device="cpu")
            _RERANK_MODEL_NAME = model_name
            logger.info("Loaded CrossEncoder reranker model: %s", model_name)
        except Exception as exc:
            raise RuntimeError(
                f"CrossEncoder model '{model_name}' is not available in the local cache. "
                "Run 'python scripts/download_models.py' while online to pre-cache weights."
            ) from exc
    return _RERANK_MODEL


async def rerank_candidates(
    query: str,
    candidates: list[dict[str, Any]],
    cfg: Settings,
) -> list[dict[str, Any]]:
    """Rerank candidates using CrossEncoder in a worker thread and filter by threshold."""
    if not candidates:
        return []

    # CrossEncoder evaluates at most 20 candidates
    eval_candidates = candidates[:20]
    pairs = [[query, c.get("text", "")] for c in eval_candidates]

    try:
        model = get_rerank_model(cfg.rerank_model)
        scores = await asyncio.to_thread(model.predict, pairs)
    except Exception as exc:
        logger.warning("Reranking failed (%s); falling back to candidate order.", type(exc).__name__)
        return eval_candidates

    scored_candidates: list[tuple[float, dict[str, Any]]] = []
    for candidate, score in zip(eval_candidates, scores):
        updated = dict(candidate)
        val = float(score)
        updated["rerank_score"] = round(val, 6)
        updated["score"] = round(val, 6)
        if val >= cfg.rerank_score_threshold:
            scored_candidates.append((val, updated))

    scored_candidates.sort(key=lambda x: x[0], reverse=True)
    return [c for _, c in scored_candidates]


def expand_neighbours(
    top_hits: list[dict[str, Any]],
    session_id: str,
    final_k: int = 6,
) -> list[dict[str, Any]]:
    """Add adjacent chunks on the same page for top 2 hits; deduplicate; limit to final_k."""
    if not top_hits:
        return []

    all_session_chunks = bm25_store.get_session_chunks(session_id)
    # Index session chunks by (docId, page, chunk_index)
    lookup: dict[tuple[str, int, int], dict[str, Any]] = {
        (c.get("docId", ""), int(c.get("page", 0)), int(c.get("chunk_index", 0))): c
        for c in all_session_chunks
    }

    seen_keys: set[tuple[str, int]] = set()
    result: list[dict[str, Any]] = []

    # First add top hits
    for hit in top_hits:
        key = (str(hit.get("docId", "")), int(hit.get("chunk_index", 0)))
        if key not in seen_keys:
            seen_keys.add(key)
            result.append(hit)

    # For top 2 hits, add adjacent chunks from the same page
    for hit in top_hits[:2]:
        doc_id = str(hit.get("docId", ""))
        page = int(hit.get("page", 0))
        idx = int(hit.get("chunk_index", 0))

        for adjacent_idx in (idx - 1, idx + 1):
            adj_key = (doc_id, adjacent_idx)
            if adj_key not in seen_keys:
                candidate = lookup.get((doc_id, page, adjacent_idx))
                if candidate:
                    seen_keys.add(adj_key)
                    expanded = dict(candidate)
                    # Inherit parent hit score slightly discounted
                    expanded["score"] = round(hit.get("score", 0.0) * 0.99, 4)
                    result.append(expanded)

    return result[:final_k]


async def hybrid_retrieve(
    session_id: str,
    query: str,
    vector_store: SessionStore,
    cfg: Settings,
) -> list[dict[str, Any]]:
    """Execute end-to-end hybrid retrieval: Dense + BM25 -> RRF -> Rerank -> Neighbour Expansion."""
    # 1. Dense retrieval (top-20)
    query_vector = await asyncio.to_thread(embed_query, query)
    dense_candidates = vector_store.query(
        session_id=session_id,
        query_embedding=query_vector,
        k=cfg.retrieval_k,
        max_k=cfg.retrieval_k,
    )

    if not cfg.enable_hybrid_retrieval:
        candidates = [
            r for r in dense_candidates
            if float(r.get("score", 0.0)) >= cfg.min_similarity
        ]
        return candidates[:cfg.retrieval_final_k]

    # 2. BM25 retrieval (top-20)
    bm25_candidates = bm25_store.query(
        session_id=session_id,
        query_text=query,
        k=cfg.retrieval_k,
    )

    # 3. Reciprocal Rank Fusion (k=60) -> top-20 candidates
    rrf_candidates = reciprocal_rank_fusion(
        dense_results=dense_candidates,
        bm25_results=bm25_candidates,
        k_rrf=60,
        top_n=20,
    )

    if not rrf_candidates:
        return []

    # 4. Reranking (CrossEncoder)
    if cfg.enable_reranking:
        reranked = await rerank_candidates(query, rrf_candidates, cfg)
    else:
        reranked = rrf_candidates

    if not reranked:
        return []

    # 5. Neighbour expansion on top 2 hits + deduplication -> final_k
    final_results = expand_neighbours(
        top_hits=reranked,
        session_id=session_id,
        final_k=cfg.retrieval_final_k,
    )

    return final_results

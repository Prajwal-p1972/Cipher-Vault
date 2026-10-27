"""Whole-document summarization context builder and representative chunk clustering."""

import re
from typing import Any, Optional
import numpy as np

from app.config import Settings, get_settings
from app.llm.prompting import _neutralize_delimiters
from app.schemas import Chunk
from app.sessions import Session
from app.vectorstore import SessionStore

# Marker for Table of Contents detection
_TOC_HEADER_PATTERN = re.compile(r"\b(table\s+of\s+contents|contents)\b", re.IGNORECASE)
_DOT_LEADER_PATTERN = re.compile(r"(\.{3,}|\u2026|\s{4,})\s*\d+$")


def is_table_of_contents_chunk(text: str) -> bool:
    """Detect if chunk content represents a table of contents."""
    if not text:
        return False
    lines = [ln.strip() for ln in text.split("\n") if ln.strip()]
    if not lines:
        return False

    first_few = "\n".join(lines[:4]).lower()
    if _TOC_HEADER_PATTERN.search(first_few):
        return True

    dot_leader_lines = sum(
        1 for ln in lines
        if _DOT_LEADER_PATTERN.search(ln) or re.search(r"\.{4,}", ln)
    )
    if dot_leader_lines >= 3 or (len(lines) >= 3 and dot_leader_lines / len(lines) >= 0.4):
        return True

    return False


def representative_indexes(emb: np.ndarray, k: int = 8) -> list[int]:
    """Select representative chunk indices via cosine k-means clustering.

    Uses deterministic seed and 15 iterations. Returns the chunk nearest each
    centroid, ordered by document position (chunk index ascending).
    Handles n <= k gracefully.
    """
    n = len(emb)
    if n == 0:
        return []
    if n <= k:
        return list(range(n))

    # Normalize embeddings to unit length for cosine distance
    norms = np.linalg.norm(emb, axis=1, keepdims=True)
    norms[norms == 0] = 1.0
    norm_emb = (emb / norms).astype(np.float32)

    rng = np.random.RandomState(42)

    # Initialize k centroids using k-means++ for deterministic diversity
    centroids = np.zeros((k, norm_emb.shape[1]), dtype=np.float32)
    first_idx = int(rng.choice(n))
    centroids[0] = norm_emb[first_idx]

    for c_i in range(1, k):
        # Cosine distance = 1.0 - max(cosine similarity with existing centroids)
        sims = norm_emb @ centroids[:c_i].T  # shape (n, c_i)
        max_sim = np.max(sims, axis=1)
        distances = np.maximum(0.0, 1.0 - max_sim)
        total_dist = np.sum(distances)
        if total_dist > 0:
            probs = distances / total_dist
            next_idx = int(rng.choice(n, p=probs))
        else:
            next_idx = int(rng.choice(n))
        centroids[c_i] = norm_emb[next_idx]

    # 15 iterations of Lloyd's algorithm with cosine similarity
    for _ in range(15):
        sims = norm_emb @ centroids.T  # shape (n, k)
        labels = np.argmax(sims, axis=1)

        for j in range(k):
            members = norm_emb[labels == j]
            if len(members) > 0:
                mean_vec = members.mean(axis=0)
                norm_val = np.linalg.norm(mean_vec)
                if norm_val > 0:
                    centroids[j] = mean_vec / norm_val
            else:
                # Reassign empty centroid to point with lowest similarity to its assigned centroid
                assigned_sims = sims[np.arange(n), labels]
                worst_idx = int(np.argmin(assigned_sims))
                centroids[j] = norm_emb[worst_idx]

    # Pick the point in each cluster closest to the final centroid
    sims = norm_emb @ centroids.T
    labels = np.argmax(sims, axis=1)
    picked: set[int] = set()

    for j in range(k):
        members_idx = np.where(labels == j)[0]
        if len(members_idx) > 0:
            best_in_cluster = members_idx[np.argmax(sims[members_idx, j])]
            picked.add(int(best_in_cluster))
        else:
            best_overall = int(np.argmax(norm_emb @ centroids[j]))
            picked.add(best_overall)

    return sorted(picked)


def build_overview_context(
    session: Session,
    doc_id: Optional[str] = None,
    vector_store: Optional[SessionStore] = None,
    cfg: Optional[Settings] = None,
) -> tuple[str, list[int]]:
    """Assemble whole-document overview context from outline, opening, and representative chunks.

    Structure:
      1. Section outline (distinct section names with pages, max 30 lines, skipped when absent)
      2. First ~1200 characters of opening non-contents pages
      3. Diverse representative chunks (each truncated to 700 chars)

    Enforces hard cap summary_max_chars (default 8000). Skips table of contents chunks.
    Returns (context_text, pages_used).
    """
    settings = cfg or get_settings()
    max_chars = settings.summary_max_chars

    chunks: list[Chunk] = []
    embeddings: np.ndarray = np.empty((0, 0), dtype=np.float32)

    if vector_store is not None:
        chunks, embeddings = vector_store.get_document_data(session.session_id, doc_id=doc_id)

    if not chunks:
        return "", []

    # Filter out Table of Contents chunks
    usable_chunks: list[tuple[int, Chunk]] = []
    for idx, c in enumerate(chunks):
        if not is_table_of_contents_chunk(c.text):
            usable_chunks.append((idx, c))

    if not usable_chunks:
        # Fallback to all chunks if everything was flagged
        usable_chunks = list(enumerate(chunks))

    used_pages: set[int] = set()
    used_chars = 0
    context_parts: list[str] = []

    # 1. Section outline (distinct section names with pages, max 30 lines)
    outline_lines: list[str] = []
    seen_sections: set[tuple[str, int]] = set()
    for _, c in usable_chunks:
        if c.section and c.section.strip():
            sec_clean = c.section.strip()
            key = (sec_clean, c.page)
            if key not in seen_sections:
                seen_sections.add(key)
                outline_lines.append(f"- {sec_clean} [p.{c.page}]")
                if len(outline_lines) >= 30:
                    break

    if outline_lines:
        outline_block = "Document Outline:\n" + "\n".join(outline_lines) + "\n\n"
        context_parts.append(outline_block)
        used_chars += len(outline_block)
        for _, p in seen_sections:
            used_pages.add(p)

    # 2. Opening ~1200 characters of opening non-contents pages
    opening_text_parts: list[str] = []
    opening_chars = 0
    opening_chunk_indices: set[int] = set()

    for idx, c in usable_chunks:
        if opening_chars >= 1200:
            break
        text = c.text.strip()
        remaining = 1200 - opening_chars
        add_text = text[:remaining]
        opening_text_parts.append(f"[{add_text}] (p.{c.page})")
        opening_chars += len(add_text)
        opening_chunk_indices.add(idx)
        used_pages.add(c.page)

    if opening_text_parts:
        opening_block = "Document Opening:\n" + "\n".join(opening_text_parts) + "\n\n"
        if used_chars + len(opening_block) <= max_chars:
            context_parts.append(opening_block)
            used_chars += len(opening_block)

    # 3. Diverse representative chunks (truncated to 700 chars each)
    if embeddings.size > 0 and len(embeddings) == len(chunks):
        rep_idxs = representative_indexes(embeddings, k=8)
    else:
        # Uniform stride if embeddings not available
        step = max(1, len(chunks) // 8)
        rep_idxs = list(range(0, len(chunks), step))[:8]

    rep_parts: list[str] = []
    for r_idx in rep_idxs:
        if r_idx < len(chunks):
            chunk = chunks[r_idx]
            if is_table_of_contents_chunk(chunk.text):
                continue
            if r_idx in opening_chunk_indices and len(usable_chunks) > 2:
                # Don't duplicate opening chunk if we have diverse options
                continue

            clean_text = _neutralize_delimiters(chunk.text.strip()[:700])
            part = f"<<<PASSAGE page={chunk.page}>>>\n{clean_text}\n<<<END_PASSAGE>>>"
            if used_chars + len(part) + 2 > max_chars:
                break
            rep_parts.append(part)
            used_chars += len(part) + 2
            used_pages.add(chunk.page)

    if rep_parts:
        context_parts.append("Key Representative Passages:\n" + "\n\n".join(rep_parts))

    final_context = "".join(context_parts).strip()
    return final_context, sorted(used_pages)

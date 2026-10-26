"""Deterministic semantic text chunking with boundary awareness and overlap retention."""

import re
from app.schemas import Chunk, PageText

WHITESPACE_RE = re.compile(r"[ \t]+")
MULTILINE_RE = re.compile(r"\n{3,}")


def normalize_whitespace(text: str) -> str:
    """Normalize internal spacing while retaining logical paragraph breaks."""
    text = WHITESPACE_RE.sub(" ", text)
    text = MULTILINE_RE.sub("\n\n", text)
    return text.strip()


def find_split_point(text: str, max_len: int) -> int:
    """Identify the optimal semantic delimiter within max_len boundaries."""
    if len(text) <= max_len:
        return len(text)

    search_window = text[:max_len]
    min_split_threshold = max_len // 2

    # 1. Paragraph boundary
    para_break = search_window.rfind("\n\n")
    if para_break >= min_split_threshold:
        return para_break + 2

    # 2. Line break
    line_break = search_window.rfind("\n")
    if line_break >= min_split_threshold:
        return line_break + 1

    # 3. Sentence boundaries (. ! ?)
    for punct in (". ", "! ", "? "):
        punct_idx = search_window.rfind(punct)
        if punct_idx >= min_split_threshold:
            return punct_idx + len(punct)

    # 4. Word boundary
    space_idx = search_window.rfind(" ")
    if space_idx >= min_split_threshold:
        return space_idx + 1

    # 5. Hard break fallback
    return max_len


def chunk_pages(
    pages: list[PageText],
    chunk_chars: int = 800,
    overlap: int = 100
) -> list[Chunk]:
    """Split extracted page texts into deterministic chunks respecting boundaries and overlap."""
    if chunk_chars <= 0:
        raise ValueError("chunk_chars must be a positive integer.")
    if overlap < 0 or overlap >= chunk_chars:
        raise ValueError("overlap must be non-negative and strictly less than chunk_chars.")

    chunks: list[Chunk] = []
    chunk_counter = 0

    for page in pages:
        normalized_content = normalize_whitespace(page.text)
        if not normalized_content:
            continue

        pos = 0
        text_length = len(normalized_content)

        while pos < text_length:
            remaining = normalized_content[pos:]
            split_len = find_split_point(remaining, chunk_chars)
            chunk_slice = remaining[:split_len].strip()

            if chunk_slice:
                chunks.append(
                    Chunk(
                        text=chunk_slice,
                        page=page.page,
                        source=page.source,
                        index=chunk_counter
                    )
                )
                chunk_counter += 1

            next_advance = split_len
            if pos + next_advance >= text_length:
                break

            # Calculate advance with overlap guarantee
            pos += max(1, next_advance - overlap)

    return chunks

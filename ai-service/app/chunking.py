"""Deterministic heading-aware semantic text chunking with boundary awareness and overlap retention."""

import re
from app.extraction.cleaning import looks_like_toc
from app.schemas import Chunk, PageText

WHITESPACE_RE = re.compile(r"[ \t]+")
MULTILINE_RE = re.compile(r"\n{3,}")
NUMBERED_HEADING_RE = re.compile(
    r"^\s*(?:(?:Section|Chapter|Appendix)\s+)?\d+(?:\.\d+)*[\.:]?\s+[A-Za-z0-9]",
    re.IGNORECASE,
)


def normalize_whitespace(text: str) -> str:
    """Normalize internal spacing while retaining logical paragraph breaks."""
    text = WHITESPACE_RE.sub(" ", text)
    text = MULTILINE_RE.sub("\n\n", text)
    return text.strip()


def is_heading(line: str) -> bool:
    """Detect headings (numbered like '5.1 Technology Stack', or short Title Case/ALL CAPS lines)."""
    cleaned = line.strip()
    if not cleaned or len(cleaned) > 100:
        return False

    # Exclude table rows (e.g. 'Layer: Backend; Technology: Node')
    if "; " in cleaned and ":" in cleaned:
        return False

    # 1. Numbered heading (e.g. "5.1 Technology Stack", "1. Introduction")
    if NUMBERED_HEADING_RE.match(cleaned):
        return True

    # Sentence terminal punctuation indicates regular prose, not a heading
    if cleaned[-1] in {".", "!", "?", ",", ";"}:
        return False

    words = cleaned.split()
    if not (1 <= len(words) <= 12):
        return False

    # 2. ALL CAPS line (e.g. "SYSTEM ARCHITECTURE")
    alpha_chars = [c for c in cleaned if c.isalpha()]
    if alpha_chars and cleaned.isupper() and len(cleaned) <= 80:
        return True

    # 3. Short Title Case line (e.g. "Technology Stack")
    minor_words = {
        "and", "or", "the", "a", "an", "of", "in", "to", "for", "on", "with", "by", "at", "from"
    }
    has_alpha = False
    all_title = True
    for i, w in enumerate(words):
        alpha_part = "".join(c for c in w if c.isalpha())
        if not alpha_part:
            continue
        has_alpha = True
        if i > 0 and alpha_part.lower() in minor_words:
            continue
        if not alpha_part[0].isupper():
            all_title = False
            break

    if has_alpha and all_title and len(cleaned) <= 80:
        return True

    return False


def is_table_row(line: str) -> bool:
    """Identify if a line is formatted as a serialized table row ('h: v; h: v')."""
    cleaned = line.strip()
    return "; " in cleaned and ":" in cleaned


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
    chunk_chars: int = 1000,
    overlap: int = 150,
) -> list[Chunk]:
    """Split extracted page texts into deterministic chunks respecting boundaries, headings, and tables."""
    if chunk_chars <= 0:
        raise ValueError("chunk_chars must be a positive integer.")
    if overlap < 0 or overlap >= chunk_chars:
        raise ValueError("overlap must be non-negative and strictly less than chunk_chars.")

    chunks: list[Chunk] = []
    chunk_counter = 0
    current_section = ""

    for page in pages:
        if getattr(page, "kind", None) == "toc" or looks_like_toc(page.text):
            continue

        normalized_content = normalize_whitespace(page.text)
        if not normalized_content:
            continue

        lines = [line.strip() for line in page.text.splitlines() if line.strip()]
        has_table_rows = any(is_table_row(l) for l in lines) or (getattr(page, "kind", None) == "table")

        if has_table_rows:
            # Table-aware line chunking: NEVER split a table row
            current_body_lines: list[str] = []
            current_kind = "text"

            for line in lines:
                if is_heading(line):
                    if current_body_lines:
                        prefix = f"[Page {page.page} | Section {current_section}] "
                        body = "\n".join(current_body_lines)
                        chunks.append(
                            Chunk(
                                text=f"{prefix}{body}",
                                page=page.page,
                                source=page.source,
                                index=chunk_counter,
                                section=current_section,
                                kind=current_kind,
                            )
                        )
                        chunk_counter += 1
                        current_body_lines = []
                        current_kind = "text"

                    current_section = line
                    current_body_lines.append(line)
                    continue

                is_tbl = is_table_row(line) or (getattr(page, "kind", None) == "table")
                line_kind = "table" if is_tbl else "text"

                prefix = f"[Page {page.page} | Section {current_section}] "
                max_body = max(50, chunk_chars - len(prefix))

                tentative_len = (
                    sum(len(l) for l in current_body_lines)
                    + len(current_body_lines)
                    + len(line)
                )
                if current_body_lines and tentative_len > max_body:
                    prefix = f"[Page {page.page} | Section {current_section}] "
                    body = "\n".join(current_body_lines)
                    chunks.append(
                        Chunk(
                            text=f"{prefix}{body}",
                            page=page.page,
                            source=page.source,
                            index=chunk_counter,
                            section=current_section,
                            kind=current_kind,
                        )
                    )
                    chunk_counter += 1

                    # Overlap with complete lines (never splitting rows)
                    overlap_lines: list[str] = []
                    acc_len = 0
                    for prev_l in reversed(current_body_lines):
                        if acc_len + len(prev_l) + 1 <= overlap:
                            overlap_lines.insert(0, prev_l)
                            acc_len += len(prev_l) + 1
                        else:
                            break

                    current_body_lines = overlap_lines + [line]
                    current_kind = "table" if any(
                        is_table_row(l) or (getattr(page, "kind", None) == "table")
                        for l in current_body_lines
                    ) else "text"
                else:
                    current_body_lines.append(line)
                    if line_kind == "table":
                        current_kind = "table"

            if current_body_lines:
                prefix = f"[Page {page.page} | Section {current_section}] "
                body = "\n".join(current_body_lines)
                chunks.append(
                    Chunk(
                        text=f"{prefix}{body}",
                        page=page.page,
                        source=page.source,
                        index=chunk_counter,
                        section=current_section,
                        kind=current_kind,
                    )
                )
                chunk_counter += 1

        else:
            # Regular text page
            paragraphs = [p.strip() for p in normalized_content.split("\n\n") if p.strip()]
            for para in paragraphs:
                lines_in_para = para.split("\n")
                if len(lines_in_para) == 1 and is_heading(lines_in_para[0]):
                    current_section = lines_in_para[0].strip()
                    continue

                pos = 0
                text_len = len(para)
                prefix = f"[Page {page.page} | Section {current_section}] "
                max_body = max(50, chunk_chars - len(prefix))

                while pos < text_len:
                    remaining = para[pos:]
                    split_len = find_split_point(remaining, max_body)
                    chunk_slice = remaining[:split_len].strip()

                    if chunk_slice:
                        chunk_text = f"{prefix}{chunk_slice}"
                        chunks.append(
                            Chunk(
                                text=chunk_text,
                                page=page.page,
                                source=page.source,
                                index=chunk_counter,
                                section=current_section,
                                kind="text",
                            )
                        )
                        chunk_counter += 1

                    next_advance = split_len
                    if pos + next_advance >= text_len:
                        break

                    pos += max(1, next_advance - overlap)

    return chunks

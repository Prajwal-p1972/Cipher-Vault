"""Document cleaning utilities: TOC detection and running header/footer line removal.

Fully offline and in-memory; returns counts only, never leaking document text into logs or return metadata.
"""

import logging
import re
from collections import Counter
from app.schemas import PageText

logger = logging.getLogger("cipher_vault.cleaning")

TOC_HEADING_PATTERNS = [
    re.compile(r"^\s*(table of contents|contents)\s*[:\-\.]?\s*$", re.IGNORECASE),
    re.compile(r"^\s*(list of (?:figures|tables))\s*[:\-\.]?\s*$", re.IGNORECASE),
    re.compile(r"^\s*((?:figure|table)\s+index)\s*[:\-\.]?\s*$", re.IGNORECASE),
    re.compile(r"^\s*(index of (?:figures|tables))\s*[:\-\.]?\s*$", re.IGNORECASE),
]

# Dot-leader lines ending with a page number, e.g. "Chapter 1 .......... 5" or ". . . 12"
DOT_LEADER_RE = re.compile(r"(?:\.{2,}|\u2026{2,}|\.\s*\.\s*\.)\s*\d+\s*$", re.MULTILINE)


def looks_like_toc(text: str) -> bool:
    """Return True if text contains TOC/index headings or multiple dot-leader lines."""
    if not text or not text.strip():
        return False

    lines = [line.strip() for line in text.splitlines() if line.strip()]
    if not lines:
        return False

    # Check top lines for explicit TOC / List of Tables / List of Figures headings
    for line in lines[:10]:
        for pattern in TOC_HEADING_PATTERNS:
            if pattern.match(line):
                return True

    # Count dot-leader lines (e.g. "Section 1.1 ....... 4")
    dot_leader_matches = len(DOT_LEADER_RE.findall(text))
    if dot_leader_matches >= 2:
        return True

    # Check for short TOC listing format where lines end with page numbers and start with Table/Figure/Chapter
    toc_item_re = re.compile(
        r"^\s*(?:table|figure|chapter|section)\s+\d+[\.\d]*\s+.+\s+\d+\s*$",
        re.IGNORECASE,
    )
    toc_items = sum(1 for line in lines if toc_item_re.match(line))
    if toc_items >= 2:
        return True

    return False


class CleaningResult(tuple):
    """Result tuple supporting (cleaned_pages, removed_count), int comparison, and attribute access."""

    def __new__(cls, pages: list[PageText], count: int):
        return super().__new__(cls, (pages, count))

    @property
    def pages(self) -> list[PageText]:
        return self[0]

    @property
    def count(self) -> int:
        return self[1]

    def __int__(self) -> int:
        return self[1]

    def __eq__(self, other):
        if isinstance(other, int):
            return self[1] == other
        return super().__eq__(other)


def remove_repeated_lines(pages: list[PageText]) -> CleaningResult:
    """Drop short lines repeating on >= 40% of pages (running headers, footers, page numbers).

    Returns counts only to prevent sensitive content leakage.
    """
    total_pages = len(pages)
    if total_pages < 2:
        return CleaningResult(list(pages), 0)

    # Count how many distinct pages each candidate short line appears on
    line_page_counts: Counter[str] = Counter()
    for page in pages:
        seen_on_this_page: set[str] = set()
        for line in page.text.splitlines():
            cleaned = line.strip()
            # Running headers/footers/page numbers are typically 1-100 characters
            if 1 <= len(cleaned) <= 100:
                seen_on_this_page.add(cleaned)
        for cleaned in seen_on_this_page:
            line_page_counts[cleaned] += 1

    # Threshold: >= 40% of total pages, and at least 2 pages
    repeated_lines = {
        line for line, count in line_page_counts.items()
        if count >= 2 and (count / total_pages) >= 0.40
    }

    if not repeated_lines:
        return CleaningResult(list(pages), 0)

    total_removed = 0
    cleaned_pages: list[PageText] = []

    for page in pages:
        kept_lines: list[str] = []
        for line in page.text.splitlines():
            if line.strip() in repeated_lines:
                total_removed += 1
            else:
                kept_lines.append(line)

        cleaned_text = "\n".join(kept_lines).strip()
        cleaned_pages.append(
            PageText(
                page=page.page,
                text=cleaned_text,
                source=page.source,
                ocr=page.ocr,
                kind=page.kind,
            )
        )

    # In-place update if pages is a mutable list
    try:
        pages[:] = cleaned_pages
    except Exception:
        pass

    logger.debug("Removed %d repeated header/footer lines across %d pages", total_removed, total_pages)
    return CleaningResult(cleaned_pages, total_removed)


def filter_toc_pages(pages: list[PageText]) -> tuple[list[PageText], int]:
    """Filter out pages classified as TOC, returning non-TOC pages and skipped count."""
    non_toc: list[PageText] = []
    skipped_count = 0
    for page in pages:
        if getattr(page, "kind", None) == "toc" or looks_like_toc(page.text):
            skipped_count += 1
        else:
            non_toc.append(page)
    return non_toc, skipped_count

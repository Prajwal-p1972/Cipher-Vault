"""In-memory PDF text extraction, table serialization, and fallback OCR pipeline."""

import logging
import fitz

from app.config import get_settings
from app.extraction.cleaning import looks_like_toc, remove_repeated_lines
from app.extraction.ocr import ocr_image_bytes
from app.schemas import ExtractionError, ExtractionLimitError, ExtractionResult, PageText

logger = logging.getLogger("cipher_vault.pdf")


def _extract_page_content(
    page: fitz.Page, page_num: int, warnings: list[str]
) -> tuple[str, str]:
    """Extract reading-order text and table content from a PDF page.

    Returns (text, kind) where kind is 'table' or 'text'.
    Falls back to plain text on table failure with a warning.
    """
    table_list = []
    try:
        tabs = page.find_tables()
        table_list = list(tabs) if tabs else []
    except Exception as exc:
        logger.warning("Table detection failed on page %d: %s", page_num, exc)
        warnings.append(f"Table detection failed on page {page_num}; fell back to plain text.")
        table_list = []

    if not table_list:
        blocks = page.get_text("blocks")
        text_blocks = [b for b in blocks if len(b) >= 7 and b[6] == 0 and b[4].strip()]
        text_blocks.sort(key=lambda b: (b[1], b[0]))
        text = "\n\n".join(b[4].strip() for b in text_blocks)
        return text.strip(), "text"

    try:
        table_items: list[tuple[fitz.Rect, str]] = []
        for tab in table_list:
            raw_rows = tab.extract()
            if not raw_rows or len(raw_rows) < 1:
                continue

            # First row = header; join wrapped lines and skip empty cells
            headers = [
                " ".join(cell.split()) if (cell and isinstance(cell, str)) else ""
                for cell in raw_rows[0]
            ]

            serialized_rows = []
            for row in raw_rows[1:]:
                cell_pairs = []
                for h, val in zip(headers, row):
                    cleaned_val = (
                        " ".join(val.split()) if (val and isinstance(val, str)) else ""
                    )
                    if cleaned_val and h:
                        cell_pairs.append(f"{h}: {cleaned_val}")
                    elif cleaned_val:
                        cell_pairs.append(cleaned_val)
                if cell_pairs:
                    serialized_rows.append("; ".join(cell_pairs))

            table_text = "\n".join(serialized_rows).strip()
            if table_text:
                table_items.append((fitz.Rect(tab.bbox), table_text))

        blocks = page.get_text("blocks")
        raw_text_blocks = [b for b in blocks if len(b) >= 7 and b[6] == 0 and b[4].strip()]

        # Exclude blocks that overlap table rectangles so text is not duplicated
        non_table_blocks = []
        for b in raw_text_blocks:
            b_rect = fitz.Rect(b[:4])
            overlaps = False
            for tab_rect, _ in table_items:
                inter = b_rect & tab_rect
                if not inter.is_empty and inter.get_area() > 1.0:
                    overlaps = True
                    break
            if not overlaps:
                non_table_blocks.append(b)

        # Build reading order: combine non-table text blocks and tables, sorted by y then x
        combined_items: list[tuple[float, float, str]] = []
        for b in non_table_blocks:
            combined_items.append((b[1], b[0], b[4].strip()))

        for tab_rect, tab_text in table_items:
            combined_items.append((tab_rect.y0, tab_rect.x0, tab_text))

        combined_items.sort(key=lambda item: (item[0], item[1]))
        full_text = "\n\n".join(item[2] for item in combined_items if item[2]).strip()
        kind = "table" if table_items else "text"
        return full_text, kind

    except Exception as exc:
        logger.warning("Table extraction failed on page %d: %s", page_num, exc)
        warnings.append(f"Table extraction failed on page {page_num}; fell back to plain text.")
        blocks = page.get_text("blocks")
        text_blocks = [b for b in blocks if len(b) >= 7 and b[6] == 0 and b[4].strip()]
        text_blocks.sort(key=lambda b: (b[1], b[0]))
        text = "\n\n".join(b[4].strip() for b in text_blocks)
        return text.strip(), "text"


def extract_pdf(data: bytes, source: str = "document.pdf") -> ExtractionResult:
    """Extract text from in-memory PDF bytes with fallback OCR for scanned pages."""
    settings = get_settings()

    try:
        doc = fitz.open(stream=data, filetype="pdf")
    except Exception as exc:
        raise ExtractionError("Corrupted or invalid PDF document structure.") from exc

    try:
        if doc.is_encrypted:
            raise ExtractionError("Encrypted or password-protected PDFs are not supported.")

        page_count = len(doc)
        if page_count > settings.max_pdf_pages:
            raise ExtractionLimitError(
                f"PDF page count ({page_count}) exceeds limit of {settings.max_pdf_pages}."
            )

        pages: list[PageText] = []
        warnings: list[str] = []
        ocr_pages_count = 0

        for page_index in range(page_count):
            page = doc[page_index]
            page_num = page_index + 1

            text, kind = _extract_page_content(page, page_num, warnings)
            ocr_applied = False

            if len(text) < settings.min_text_chars_per_page:
                if ocr_pages_count < settings.max_ocr_pages:
                    pix = page.get_pixmap(dpi=200)
                    png_bytes = pix.tobytes("png")
                    ocr_text = ocr_image_bytes(png_bytes)
                    ocr_pages_count += 1
                    ocr_applied = True
                    if ocr_text:
                        text = ocr_text
                else:
                    warnings.append(
                        f"Maximum OCR page limit ({settings.max_ocr_pages}) reached; "
                        f"skipped OCR on page {page_num}."
                    )

            if looks_like_toc(text):
                kind = "toc"

            pages.append(
                PageText(
                    page=page_num,
                    text=text,
                    source=source,
                    ocr=ocr_applied,
                    kind=kind,
                )
            )

        # Count contents/TOC pages and add warning
        toc_count = sum(1 for p in pages if p.kind == "toc")
        if toc_count > 0:
            warnings.append(f"{toc_count} contents pages skipped")

        # Drop running headers, footers, page numbers repeating across >= 40% of pages
        remove_repeated_lines(pages)

        return ExtractionResult(
            pages=pages,
            warnings=warnings,
            page_count=page_count,
            ocr_pages=ocr_pages_count,
        )
    finally:
        doc.close()

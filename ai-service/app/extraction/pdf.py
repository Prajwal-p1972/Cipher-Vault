"""In-memory PDF text extraction and fallback OCR pipeline."""

import fitz

from app.config import get_settings
from app.extraction.ocr import ocr_image_bytes
from app.schemas import ExtractionError, ExtractionLimitError, ExtractionResult, PageText


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

            # Extract digital text layer without executing JS or attachments
            text = page.get_text("text").strip()
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

            pages.append(
                PageText(
                    page=page_num,
                    text=text,
                    source=source,
                    ocr=ocr_applied
                )
            )

        return ExtractionResult(
            pages=pages,
            warnings=warnings,
            page_count=page_count,
            ocr_pages=ocr_pages_count
        )
    finally:
        doc.close()

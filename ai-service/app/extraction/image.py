"""In-memory image text extraction via OCR pipeline."""

from app.extraction.ocr import ocr_image_bytes
from app.schemas import ExtractionResult, PageText, UnsupportedTypeError


def extract_image(data: bytes, source: str = "image.jpg") -> ExtractionResult:
    """Extract text from JPEG image bytes using in-memory OCR."""
    if not (data.startswith(b"\xff\xd8\xff") or data.startswith(b"\x89PNG\r\n\x1a\n")):
        raise UnsupportedTypeError("Image format not recognized; expected valid JPEG image data.")

    text = ocr_image_bytes(data).strip()
    warnings: list[str] = []

    if not text:
        warnings.append("No text detected in image.")

    pages = [
        PageText(
            page=1,
            text=text,
            source=source,
            ocr=True
        )
    ]

    return ExtractionResult(
        pages=pages,
        warnings=warnings,
        page_count=1,
        ocr_pages=1
    )

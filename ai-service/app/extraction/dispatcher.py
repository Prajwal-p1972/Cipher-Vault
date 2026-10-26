"""Format detection based purely on binary magic bytes and dispatcher routing."""

from app.config import get_settings
from app.extraction.archive import extract_zip
from app.extraction.image import extract_image
from app.extraction.pdf import extract_pdf
from app.schemas import (
    ExtractionLimitError,
    ExtractionResult,
    UnsupportedTypeError,
)

PDF_MAGIC = b"%PDF-"
JPEG_MAGIC = b"\xff\xd8\xff"
ZIP_MAGIC_STANDARD = b"PK\x03\x04"
ZIP_MAGIC_EMPTY = b"PK\x05\x06"


def detect_type(data: bytes) -> str:
    """Identify document type exclusively from initial binary magic signatures."""
    if not data or len(data) < 4:
        raise UnsupportedTypeError("File is empty or too short to identify magic signature.")

    if data.startswith(PDF_MAGIC):
        return "pdf"
    if data.startswith(JPEG_MAGIC):
        return "image"
    if data.startswith(ZIP_MAGIC_STANDARD) or data.startswith(ZIP_MAGIC_EMPTY):
        return "zip"

    raise UnsupportedTypeError("Unsupported document type; binary signature did not match PDF, JPEG, or ZIP.")


def extract(data: bytes) -> ExtractionResult:
    """Validate upload size, detect document type via magic bytes, and dispatch to extractor."""
    settings = get_settings()

    if len(data) > settings.max_upload_bytes:
        raise ExtractionLimitError(
            f"Uploaded data ({len(data)} bytes) exceeds maximum upload limit of {settings.max_upload_bytes} bytes."
        )

    doc_type = detect_type(data)

    try:
        if doc_type == "pdf":
            result = extract_pdf(data)
        elif doc_type == "image":
            result = extract_image(data)
        elif doc_type == "zip":
            result = extract_zip(data)
        else:
            raise UnsupportedTypeError(f"Unsupported document type: {doc_type}")
        return result
    finally:
        # Guarantee immediate dereferencing of raw untrusted payload buffer
        del data

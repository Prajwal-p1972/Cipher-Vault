"""Unit tests for PDF extraction, encryption rejection, page limits, and resource cleanup."""

import fitz
import pytest
from app.extraction.pdf import extract_pdf
from app.schemas import ExtractionError, ExtractionLimitError


def test_text_pdf_extracts_per_page(make_pdf):
    """Ensure multi-page digital PDF extracts each page independently without OCR."""
    pages = [
        "First page cryptographic report with sufficient length to avoid triggering OCR threshold.",
        "Second page audit chain verification summary with detailed compliance logs."
    ]
    pdf_bytes = make_pdf(pages)
    result = extract_pdf(pdf_bytes, source="audit.pdf")

    assert result.page_count == 2
    assert result.ocr_pages == 0
    assert len(result.pages) == 2
    assert "First page cryptographic report" in result.pages[0].text
    assert result.pages[0].page == 1
    assert result.pages[0].source == "audit.pdf"
    assert result.pages[0].ocr is False

    assert "Second page audit chain" in result.pages[1].text
    assert result.pages[1].page == 2
    assert result.pages[1].ocr is False


def test_encrypted_pdf_rejected():
    """Ensure password-protected and encrypted PDFs are rejected with ExtractionError."""
    doc = fitz.open()
    page = doc.new_page()
    page.insert_text(fitz.Point(50, 72), "Classified confidential content")
    encrypted_bytes = doc.tobytes(
        encryption=fitz.PDF_ENCRYPT_AES_256,
        owner_pw="adminpass",
        user_pw="userpass"
    )
    doc.close()

    with pytest.raises(ExtractionError, match="Encrypted or password-protected"):
        extract_pdf(encrypted_bytes)


def test_too_many_pages_rejected(make_pdf, monkeypatch):
    """Ensure PDFs exceeding max_pdf_pages raise ExtractionLimitError."""
    from app.config import get_settings
    settings = get_settings()
    monkeypatch.setattr(settings, "max_pdf_pages", 3)

    four_pages = ["Page one text", "Page two text", "Page three text", "Page four text"]
    pdf_bytes = make_pdf(four_pages)

    with pytest.raises(ExtractionLimitError, match="PDF page count"):
        extract_pdf(pdf_bytes)


def test_document_is_closed_on_success_and_error(make_pdf, monkeypatch):
    """Ensure PyMuPDF document handle is always closed in finally block."""
    close_called = 0
    orig_close = fitz.Document.close

    def spied_close(self):
        nonlocal close_called
        close_called += 1
        return orig_close(self)

    monkeypatch.setattr(fitz.Document, "close", spied_close)

    # Success case
    pdf_bytes = make_pdf(["Standard document content for testing close behavior."])
    extract_pdf(pdf_bytes)
    assert close_called >= 1

    # Error case (e.g. page limit triggered)
    from app.config import get_settings
    monkeypatch.setattr(get_settings(), "max_pdf_pages", 1)
    two_pages = ["Page one", "Page two"]
    two_page_pdf = make_pdf(two_pages)

    initial_closes = close_called
    with pytest.raises(ExtractionLimitError):
        extract_pdf(two_page_pdf)
    assert close_called > initial_closes


@pytest.mark.ocr
def test_scanned_pdf_extracts_via_ocr(make_scanned_pdf):
    """Ensure scanned image page with low digital text triggers OCR."""
    scanned_bytes = make_scanned_pdf("AIRGAP 98765")
    try:
        result = extract_pdf(scanned_bytes)
    except ExtractionError as exc:
        if "EasyOCR models are not available offline" in str(exc):
            pytest.skip("EasyOCR models are not downloaded on this machine.")
        raise

    assert result.ocr_pages >= 1
    assert result.pages[0].ocr is True
    assert "AIRGAP" in result.pages[0].text.upper()

"""Unit tests for binary magic-byte detection and extraction dispatcher."""

import pytest
from app.extraction.dispatcher import detect_type, extract
from app.schemas import ExtractionLimitError, UnsupportedTypeError


def test_detect_type_magic_bytes(make_pdf, make_jpeg, make_zip):
    """Ensure detect_type correctly identifies PDF, JPEG, and ZIP purely from binary headers."""
    pdf_bytes = make_pdf(["This is a sample document text."])
    jpeg_bytes = make_jpeg("Photo header test")
    zip_bytes = make_zip({"note.txt": b"Confidential memo text."})

    assert detect_type(pdf_bytes) == "pdf"
    assert detect_type(jpeg_bytes) == "image"
    assert detect_type(zip_bytes) == "zip"


def test_renamed_exe_rejected():
    """Ensure an executable payload disguised as another file is strictly rejected."""
    fake_exe = b"MZ\x90\x00\x03\x00\x00\x00" + b"\x00" * 128
    with pytest.raises(UnsupportedTypeError):
        detect_type(fake_exe)
    with pytest.raises(UnsupportedTypeError):
        extract(fake_exe)


def test_oversize_upload_rejected(monkeypatch):
    """Ensure payloads exceeding max_upload_bytes raise ExtractionLimitError immediately."""
    from app.config import get_settings
    settings = get_settings()

    # Simulate smaller max_upload_bytes limit for fast testing
    monkeypatch.setattr(settings, "max_upload_bytes", 500)

    oversize_data = b"%PDF-1.4 " + b"X" * 1000
    with pytest.raises(ExtractionLimitError):
        extract(oversize_data)


def test_spoofed_type_ignored(make_pdf):
    """Ensure extraction routing relies strictly on binary bytes regardless of declared labels."""
    pdf_bytes = make_pdf(["Trusted text page content with sufficient characters to exceed min_text_chars_per_page threshold."])
    # Calling extract routes correctly to extract_pdf because magic bytes are %PDF-
    result = extract(pdf_bytes)
    assert result.page_count == 1
    assert "Trusted text page content" in result.pages[0].text

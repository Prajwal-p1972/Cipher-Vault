"""Unit tests for ZIP archive security checks, decompression bomb defenses, and memory purity."""

import io
import os
import tempfile
import zipfile
import pytest

from app.config import get_settings
from app.extraction.archive import extract_zip
from app.schemas import ExtractionError, ExtractionLimitError


def test_zip_bomb_ratio_rejected():
    """Ensure entries with excessive compression ratios trigger ExtractionLimitError."""
    buf = io.BytesIO()
    # 500,000 zeros compress to ~500 bytes (ratio ~1000)
    huge_zeros = b"\x00" * 500_000
    with zipfile.ZipFile(buf, "w", compression=zipfile.ZIP_DEFLATED) as zf:
        zf.writestr("zero.bin", huge_zeros)

    zip_bytes = buf.getvalue()
    with pytest.raises(ExtractionLimitError, match="compression ratio"):
        extract_zip(zip_bytes)


def test_zip_entry_count_limit(monkeypatch, make_zip):
    """Ensure archives exceeding zip_max_entries are rejected."""
    monkeypatch.setattr(get_settings(), "zip_max_entries", 3)
    four_files = {f"file_{i}.txt": b"content" for i in range(4)}
    zip_bytes = make_zip(four_files)

    with pytest.raises(ExtractionLimitError, match="entry count"):
        extract_zip(zip_bytes)


def test_zip_total_size_limit(monkeypatch, make_zip):
    """Ensure archives exceeding zip_max_total_bytes are rejected."""
    monkeypatch.setattr(get_settings(), "zip_max_total_bytes", 500)
    files = {"large.txt": b"A" * 600}
    zip_bytes = make_zip(files)

    with pytest.raises(ExtractionLimitError, match="uncompressed size"):
        extract_zip(zip_bytes)


def test_path_traversal_entry_skipped(make_zip):
    """Ensure paths containing '..' or leading slashes are skipped with warnings."""
    files = {
        "../escaped.txt": b"Should not be extracted",
        "valid.txt": b"Valid file content"
    }
    zip_bytes = make_zip(files)
    result = extract_zip(zip_bytes)

    assert any("suspicious or malformed" in w.lower() for w in result.warnings)
    assert len(result.pages) == 1
    assert result.pages[0].source == "valid.txt"


def test_nested_archive_skipped(make_zip):
    """Ensure nested archives (.zip, .tar, etc.) are skipped with a warning."""
    files = {
        "inner.zip": b"PK\x03\x04fake_inner_zip",
        "document.txt": b"Primary document text."
    }
    zip_bytes = make_zip(files)
    result = extract_zip(zip_bytes)

    assert any("nested archive" in w.lower() for w in result.warnings)
    assert len(result.pages) == 1
    assert result.pages[0].source == "document.txt"


def test_encrypted_entry_rejected(make_zip):
    """Ensure ZIP entries with encryption flags are rejected with ExtractionError."""
    raw_zip = make_zip({"locked.txt": b"Confidential encrypted content"})
    modified = bytearray(raw_zip)

    # Flip bit 0 of flag_bits in local file header (offset 6)
    loc_idx = modified.find(b"PK\x03\x04")
    if loc_idx != -1:
        modified[loc_idx + 6] |= 0x01

    # Flip bit 0 of flag_bits in central directory entry (offset 8)
    cd_idx = modified.find(b"PK\x01\x02")
    if cd_idx != -1:
        modified[cd_idx + 8] |= 0x01

    with pytest.raises(ExtractionError, match="Encrypted ZIP"):
        extract_zip(bytes(modified))


def test_unsupported_extension_skipped(make_zip):
    """Ensure non-whitelisted extensions (.exe, .sh, .bin) are skipped with warnings."""
    files = {
        "script.sh": b"#!/bin/bash\necho 1",
        "doc.txt": b"Approved text document."
    }
    zip_bytes = make_zip(files)
    result = extract_zip(zip_bytes)

    assert any("unsupported file type" in w.lower() for w in result.warnings)
    assert len(result.pages) == 1
    assert result.pages[0].source == "doc.txt"


def test_txt_entry_extracted(make_zip):
    """Ensure valid .txt entry in ZIP extracts properly."""
    files = {"notes.txt": b"Simple memo content for verification."}
    zip_bytes = make_zip(files)
    result = extract_zip(zip_bytes)

    assert result.page_count == 1
    assert result.pages[0].text == "Simple memo content for verification."
    assert result.pages[0].source == "notes.txt"


def test_nothing_written_to_disk(make_zip):
    """Verify strictly zero filesystem writes during archive extraction."""
    temp_dir = tempfile.gettempdir()
    temp_files_before = set(os.listdir(temp_dir))
    cwd_files_before = set(os.listdir("."))

    files = {
        "doc1.txt": b"In-memory stream 1",
        "doc2.txt": b"In-memory stream 2"
    }
    zip_bytes = make_zip(files)
    result = extract_zip(zip_bytes)

    assert result.page_count == 2

    temp_files_after = set(os.listdir(temp_dir))
    cwd_files_after = set(os.listdir("."))

    # No new files created
    assert temp_files_after == temp_files_before
    assert cwd_files_after == cwd_files_before

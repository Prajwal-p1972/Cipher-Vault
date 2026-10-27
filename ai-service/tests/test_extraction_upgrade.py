"""Synthetic PDF tests for upgraded extraction and chunking pipeline.

Tests verification of:
(a) TOC page skipped and table serialized as 'header: value; header: value'
(b) Repeated header/footer lines removed across pages
(c) Table rows never split across chunks
(d) Every chunk <= chunk_chars + prefix; page and section metadata preserved
(e) Scanned/OCR fallback still works
(f) Zero disk writes and zero content in logs
"""

import logging
import os
import tempfile
import fitz
import pytest

from app.chunking import chunk_pages
from app.extraction.pdf import extract_pdf
from app.schemas import Chunk, PageText


def make_synthetic_table_pdf(pages_spec: list[dict]) -> bytes:
    """Generate in-memory PDF with text blocks, headings, and drawn table structures."""
    doc = fitz.open()
    try:
        for spec in pages_spec:
            page = doc.new_page(width=595, height=842)
            if "heading" in spec:
                page.insert_text(fitz.Point(50, spec.get("heading_y", 50)), spec["heading"], fontsize=14)
            if "text" in spec:
                page.insert_text(fitz.Point(50, spec.get("text_y", 80)), spec["text"], fontsize=11)
            if "table" in spec:
                x0 = spec.get("table_x", 50)
                y0 = spec.get("table_y", 120)
                col_w = spec.get("col_w", 160)
                row_h = spec.get("row_h", 25)
                rows = spec["table"]
                shape = page.new_shape()
                for r_idx, row in enumerate(rows):
                    y = y0 + r_idx * row_h
                    for c_idx, val in enumerate(row):
                        x = x0 + c_idx * col_w
                        rect = fitz.Rect(x, y, x + col_w, y + row_h)
                        shape.draw_rect(rect)
                        page.insert_text(fitz.Point(x + 5, y + 17), str(val), fontsize=10)
                shape.finish(color=(0, 0, 0), width=1)
                shape.commit()
        return doc.tobytes()
    finally:
        doc.close()


def test_synthetic_toc_skipped_and_table_chunked():
    """(a) TOC page listing 'Table 5.1 Technology stack' is skipped; 2-col table chunked as 'header: value'."""
    pdf_bytes = make_synthetic_table_pdf([
        {
            "text": "Table of Contents\n\nTable 5.1 Technology stack ......... 2",
            "text_y": 72,
        },
        {
            "heading": "5.1 Technology Stack",
            "heading_y": 50,
            "table_y": 100,
            "table": [
                ["Layer", "Technology"],
                ["Backend", "Node"],
                ["Frontend", "React"],
            ],
        },
    ])

    result = extract_pdf(pdf_bytes, source="arch_spec.pdf")

    assert result.page_count == 2
    assert result.pages[0].kind == "toc"
    assert result.pages[1].kind == "table"
    assert any("1 contents pages skipped" in w for w in result.warnings)

    chunks = chunk_pages(result.pages)
    assert len(chunks) >= 1

    # Ensure no chunk exists from the contents page
    for chunk in chunks:
        assert "Table 5.1 Technology stack ......... 2" not in chunk.text
        assert chunk.page == 2

    # Verify a chunk contains the serialized table row
    matching_chunks = [c for c in chunks if "Layer: Backend; Technology: Node" in c.text]
    assert len(matching_chunks) >= 1
    assert matching_chunks[0].kind == "table"
    assert matching_chunks[0].section == "5.1 Technology Stack"
    assert matching_chunks[0].text.startswith("[Page 2 | Section 5.1 Technology Stack] ")


def test_repeated_header_and_footer_lines_removed():
    """(b) Short lines repeating on >= 40% of pages (running headers, footers) are dropped."""
    pdf_bytes = make_synthetic_table_pdf([
        {
            "heading": "CONFIDENTIAL AUDIT REPORT",
            "heading_y": 40,
            "text": "Page one cryptographic audit logs and validation chains.\n" * 3,
            "text_y": 100,
        },
        {
            "heading": "CONFIDENTIAL AUDIT REPORT",
            "heading_y": 40,
            "text": "Page two key management policies and rotation records.\n" * 3,
            "text_y": 100,
        },
        {
            "heading": "CONFIDENTIAL AUDIT REPORT",
            "heading_y": 40,
            "text": "Page three tamper-evident storage verification logs.\n" * 3,
            "text_y": 100,
        },
    ])

    result = extract_pdf(pdf_bytes, source="audit.pdf")

    assert result.page_count == 3
    for idx, page in enumerate(result.pages):
        assert "CONFIDENTIAL AUDIT REPORT" not in page.text
        assert f"Page {['one', 'two', 'three'][idx]}" in page.text


def test_table_rows_never_split_across_chunks():
    """(c) Table rows are never split across chunks; row boundaries remain intact."""
    rows = [["Layer", "Technology"]]
    for i in range(25):
        rows.append([f"Service{i}", f"Framework{i}"])

    pdf_bytes = make_synthetic_table_pdf([
        {
            "heading": "5.1 Services Architecture",
            "heading_y": 40,
            "table_y": 80,
            "col_w": 180,
            "table": rows,
        }
    ])

    result = extract_pdf(pdf_bytes, source="services.pdf")
    # Small chunk_chars to force chunk boundaries across rows
    chunks = chunk_pages(result.pages, chunk_chars=350, overlap=60)

    assert len(chunks) > 1
    for chunk in chunks:
        assert chunk.kind == "table"
        assert chunk.section == "5.1 Services Architecture"
        body = chunk.text[len("[Page 1 | Section 5.1 Services Architecture] "):]
        lines = [line.strip() for line in body.splitlines() if line.strip()]
        for line in lines:
            if line == "5.1 Services Architecture":
                continue
            # Each table row must be intact: "Layer: ServiceX; Technology: FrameworkX"
            assert line.startswith("Layer: Service")
            assert "; Technology: Framework" in line


def test_chunk_size_bound_and_metadata_integrity():
    """(d) Every chunk <= chunk_chars + prefix; page and section metadata are correct."""
    long_body = "Cipher Vault enforces zero-trust memory isolation and airgap controls. " * 30
    pages = [
        PageText(
            page=1,
            text=f"5.1 Security Architecture\n\n{long_body}",
            source="manual.pdf",
            ocr=False,
            kind="text",
        ),
        PageText(
            page=2,
            text=f"5.2 Key Rotation Protocol\n\n{long_body}",
            source="manual.pdf",
            ocr=False,
            kind="text",
        ),
    ]

    target_chars = 1000
    target_overlap = 150
    chunks = chunk_pages(pages, chunk_chars=target_chars, overlap=target_overlap)

    assert len(chunks) >= 4
    for chunk in chunks:
        prefix = f"[Page {chunk.page} | Section {chunk.section}] "
        assert chunk.text.startswith(prefix)
        assert len(chunk.text) <= target_chars + len(prefix)
        assert chunk.page in (1, 2)
        assert chunk.section in ("5.1 Security Architecture", "5.2 Key Rotation Protocol")
        assert chunk.source == "manual.pdf"
        assert chunk.kind == "text"


def test_scanned_ocr_fallback_still_works(make_scanned_pdf):
    """(e) Scanned PDF raster fallback triggers OCR when text characters < min_text_chars_per_page."""
    scanned_bytes = make_scanned_pdf("AIRGAP 445566")
    try:
        result = extract_pdf(scanned_bytes, source="scanned.pdf")
    except Exception as exc:
        if "EasyOCR models are not available offline" in str(exc):
            pytest.skip("EasyOCR models not downloaded offline.")
        raise

    assert result.ocr_pages >= 1
    assert result.pages[0].ocr is True
    assert "AIRGAP" in result.pages[0].text.upper()


def test_zero_disk_writes_and_no_log_content(caplog):
    """(f) Extraction and chunking do not write to disk or log document contents."""
    secret_marker = "TOPSECRET778899TOKEN"
    pdf_bytes = make_synthetic_table_pdf([
        {
            "heading": "5.1 Sensitive Assets",
            "heading_y": 50,
            "table_y": 100,
            "col_w": 200,
            "table": [
                ["Asset", "Token"],
                ["Primary", secret_marker],
            ],
        }
    ])

    temp_dir = tempfile.gettempdir()
    temp_before = set(os.listdir(temp_dir))
    cwd_before = set(os.listdir("."))

    with caplog.at_level(logging.DEBUG):
        result = extract_pdf(pdf_bytes, source="secure.pdf")
        chunks = chunk_pages(result.pages)

    temp_after = set(os.listdir(temp_dir))
    cwd_after = set(os.listdir("."))

    # No disk writes
    assert temp_after == temp_before, "Temporary file created on disk!"
    assert cwd_after == cwd_before, "File created in working directory!"

    # Secret is extracted in memory
    assert any(secret_marker in c.text for c in chunks)

    # No secret leaked in logs
    for record in caplog.records:
        assert secret_marker not in record.message
        assert secret_marker not in str(record.args)

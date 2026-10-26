"""Security tests verifying zero disk writes and zero secret leaks into application logs."""

import logging
import os
import tempfile
from app.extraction.pdf import extract_pdf


def test_no_disk_writes_and_no_log_leak(make_pdf, caplog):
    """Ensure extract_pdf leaves no filesystem traces and leaks no plaintext in logs."""
    secret_payload_token = "TOPSECRET_CRYPTO_TOKEN_XYZ987654321"
    pdf_content = f"Sensitive document body containing {secret_payload_token}."
    pdf_bytes = make_pdf([pdf_content])

    temp_dir = tempfile.gettempdir()
    temp_before = set(os.listdir(temp_dir))
    cwd_before = set(os.listdir("."))

    with caplog.at_level(logging.DEBUG):
        result = extract_pdf(pdf_bytes, source="confidential.pdf")

    temp_after = set(os.listdir(temp_dir))
    cwd_after = set(os.listdir("."))

    # 1. Verification of document extraction
    assert result.page_count == 1
    assert secret_payload_token in result.pages[0].text

    # 2. Zero disk writes verification
    assert temp_after == temp_before, "Temporary files were leaked during extraction!"
    assert cwd_after == cwd_before, "Files were created in the working directory!"

    # 3. Zero secret leaks in logging
    for record in caplog.records:
        assert secret_payload_token not in record.message
        assert secret_payload_token not in str(record.args)

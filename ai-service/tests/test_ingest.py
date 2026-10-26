"""Ingestion pipeline tests verifying streaming limits, RAM-only processing, and zero leaks."""

import os
from pathlib import Path
import tempfile
import pytest
from app.ingest import ingest_document


@pytest.mark.asyncio
async def test_raw_body_pdf_upload(async_client, make_pdf):
    """Verify raw body PDF upload returns 201 and valid extraction counts."""
    # 1. Create session
    create_res = await async_client.post(
        "/v1/sessions",
        headers={"Origin": "http://localhost:3000"},
    )
    assert create_res.status_code == 201
    sid = create_res.json()["sessionId"]
    token = create_res.json()["token"]

    # 2. Ingest valid PDF
    pdf_bytes = make_pdf(
        ["Cipher Vault secure local document processing pipeline in memory."]
    )
    upload_res = await async_client.post(
        f"/v1/sessions/{sid}/documents",
        content=pdf_bytes,
        headers={
            "Origin": "http://localhost:3000",
            "Authorization": f"Bearer {token}",
            "Content-Type": "application/octet-stream",
        },
    )
    assert upload_res.status_code == 201
    data = upload_res.json()
    assert "docId" in data
    assert data["pageCount"] == 1
    assert data["chunkCount"] >= 1
    assert isinstance(data["warnings"], list)


@pytest.mark.asyncio
async def test_oversize_body_rejected_without_buffering(async_client):
    """Verify stream exceeding max_upload_bytes immediately aborts with 413."""
    create_res = await async_client.post(
        "/v1/sessions",
        headers={"Origin": "http://localhost:3000"},
    )
    sid = create_res.json()["sessionId"]
    token = create_res.json()["token"]

    async def oversize_generator():
        chunk = b"X" * (1024 * 1024)  # 1MB chunks
        for _ in range(30):  # 30MB > 25MB limit
            yield chunk

    upload_res = await async_client.post(
        f"/v1/sessions/{sid}/documents",
        content=oversize_generator(),
        headers={
            "Origin": "http://localhost:3000",
            "Authorization": f"Bearer {token}",
            "Content-Type": "application/octet-stream",
        },
    )
    assert upload_res.status_code == 413
    assert "exceeds" in upload_res.json()["error"].lower()


@pytest.mark.asyncio
async def test_spoofed_content_type_ignored(async_client, make_pdf):
    """Verify declared Content-Type header is ignored and magic bytes drive extraction."""
    create_res = await async_client.post(
        "/v1/sessions",
        headers={"Origin": "http://localhost:3000"},
    )
    sid = create_res.json()["sessionId"]
    token = create_res.json()["token"]

    pdf_bytes = make_pdf(
        ["Magic byte verification strictly overrides client spoofing headers."]
    )
    upload_res = await async_client.post(
        f"/v1/sessions/{sid}/documents",
        content=pdf_bytes,
        headers={
            "Origin": "http://localhost:3000",
            "Authorization": f"Bearer {token}",
            "Content-Type": "image/jpeg",  # Spoofed!
        },
    )
    assert upload_res.status_code == 201
    assert upload_res.json()["pageCount"] == 1


@pytest.mark.asyncio
async def test_unsupported_magic_bytes_rejected(async_client):
    """Verify unknown binary payload is rejected with 415."""
    create_res = await async_client.post(
        "/v1/sessions",
        headers={"Origin": "http://localhost:3000"},
    )
    sid = create_res.json()["sessionId"]
    token = create_res.json()["token"]

    # Windows PE executable magic
    fake_exe = b"MZ\x90\x00" + b"\x00" * 100
    upload_res = await async_client.post(
        f"/v1/sessions/{sid}/documents",
        content=fake_exe,
        headers={
            "Origin": "http://localhost:3000",
            "Authorization": f"Bearer {token}",
            "Content-Type": "application/octet-stream",
        },
    )
    assert upload_res.status_code == 415


@pytest.mark.asyncio
async def test_no_disk_and_input_zeroed(async_client, make_pdf, caplog):
    """Verify tempdir/cwd purity, zero disk leaks, and zeroing of input bytearray."""
    import logging
    caplog.set_level(logging.DEBUG)

    create_res = await async_client.post(
        "/v1/sessions",
        headers={"Origin": "http://localhost:3000"},
    )
    sid = create_res.json()["sessionId"]
    token = create_res.json()["token"]

    secret_phrase = "TOP_SECRET_REDACTED_PHRASE_998877"
    pdf_bytes = make_pdf([f"Document content containing {secret_phrase}."])

    # Snapshot disk state
    temp_dir = tempfile.gettempdir()
    before_temp = set(os.listdir(temp_dir))
    before_cwd = set(os.listdir(os.getcwd()))

    # Direct ingest to test bytearray zeroing
    data_buffer = bytearray(pdf_bytes)
    assert any(b != 0 for b in data_buffer)

    from app.main import create_app
    app = create_app()
    manager = app.state.session_manager
    store = app.state.vector_store
    s_id, _, _ = await manager.create()

    await ingest_document(
        session_id=s_id,
        data=data_buffer,
        session_manager=manager,
        vector_store=store,
    )

    # 1. Bytearray must be completely zeroed
    assert all(b == 0 for b in data_buffer)

    # 2. Disk must not have any new files
    after_temp = set(os.listdir(temp_dir))
    after_cwd = set(os.listdir(os.getcwd()))
    assert after_temp == before_temp
    assert after_cwd == before_cwd

    # 3. Secret text must never appear in logs
    assert secret_phrase not in caplog.text


def test_no_uploadfile_or_request_form_used():
    """Verify Starlette disk-spooling APIs (UploadFile, request.form) are absent from app/."""
    app_dir = Path(__file__).resolve().parent.parent / "app"
    py_files = list(app_dir.rglob("*.py"))
    assert len(py_files) > 0

    for py_file in py_files:
        content = py_file.read_text(encoding="utf-8")
        assert "UploadFile" not in content, f"UploadFile found in {py_file.name}"
        assert "request.form" not in content, f"request.form found in {py_file.name}"

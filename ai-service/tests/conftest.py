"""Pytest test configuration and in-memory document generators."""

import io
import zipfile
import pytest
from PIL import Image, ImageDraw
import fitz


def create_pdf_bytes(page_texts: list[str]) -> bytes:
    """Generate a digital text PDF in memory from a list of page strings."""
    doc = fitz.open()
    try:
        for text in page_texts:
            page = doc.new_page(width=595, height=842)  # A4
            page.insert_text(fitz.Point(50, 72), text, fontsize=12)
        return doc.tobytes()
    finally:
        doc.close()


def create_scanned_pdf_bytes(text: str) -> bytes:
    """Generate a raster-only PDF in memory with no digital text layer."""
    img = Image.new("RGB", (800, 600), color=(255, 255, 255))
    draw = ImageDraw.Draw(img)
    draw.text((40, 40), text, fill=(0, 0, 0))

    img_buffer = io.BytesIO()
    img.save(img_buffer, format="PNG")
    img_bytes = img_buffer.getvalue()

    doc = fitz.open()
    try:
        page = doc.new_page(width=595, height=842)
        page.insert_image(page.rect, stream=img_bytes)
        return doc.tobytes()
    finally:
        doc.close()


def create_jpeg_bytes(text: str) -> bytes:
    """Generate a JPEG image in memory with rendered text."""
    img = Image.new("RGB", (640, 480), color=(255, 255, 255))
    draw = ImageDraw.Draw(img)
    draw.text((30, 30), text, fill=(0, 0, 0))

    out = io.BytesIO()
    img.save(out, format="JPEG", quality=90)
    return out.getvalue()


def create_zip_bytes(file_dict: dict[str, bytes]) -> bytes:
    """Generate a ZIP archive in memory containing the specified file paths and bytes."""
    buf = io.BytesIO()
    with zipfile.ZipFile(buf, "w", compression=zipfile.ZIP_DEFLATED) as zf:
        for name, data in file_dict.items():
            zf.writestr(name, data)
    return buf.getvalue()


@pytest.fixture
def make_pdf():
    """Fixture providing helper to generate in-memory digital text PDFs."""
    return create_pdf_bytes


@pytest.fixture
def make_scanned_pdf():
    """Fixture providing helper to generate in-memory scanned (raster) PDFs."""
    return create_scanned_pdf_bytes


@pytest.fixture
def make_jpeg():
    """Fixture providing helper to generate in-memory JPEG images."""
    return create_jpeg_bytes


@pytest.fixture
def make_zip():
    """Fixture providing helper to generate in-memory ZIP archives."""
    return create_zip_bytes


@pytest.fixture
def stub_embeddings(monkeypatch):
    """Stub out SentenceTransformer embeddings for fast, deterministic unit testing."""
    import app.embeddings as emb
    import app.ingest as ing
    import app.main as mn

    def _fake_embed_texts(texts: list[str]) -> list[list[float]]:
        import hashlib
        out = []
        for t in texts:
            h = hashlib.sha256(t.encode("utf-8")).digest()
            raw = [float((b % 100) / 100.0) for b in (h * 12)[:384]]
            norm = sum(x * x for x in raw) ** 0.5 or 1.0
            out.append([x / norm for x in raw])
        return out

    def _fake_embed_query(query: str) -> list[float]:
        return _fake_embed_texts([query])[0]

    monkeypatch.setattr(emb, "embed_texts", _fake_embed_texts)
    monkeypatch.setattr(emb, "embed_query", _fake_embed_query)
    monkeypatch.setattr(emb, "is_model_available", lambda: True)
    monkeypatch.setattr(ing, "embed_texts", _fake_embed_texts)
    monkeypatch.setattr(mn, "embed_query", _fake_embed_query)
    monkeypatch.setattr(mn, "is_model_available", lambda: True)
    return _fake_embed_texts


import pytest_asyncio


@pytest_asyncio.fixture(loop_scope="function")
async def async_client(stub_embeddings):
    """Create an httpx.AsyncClient bound to a fresh app instance with stubbed embeddings."""
    from httpx import ASGITransport, AsyncClient
    from app.main import create_app

    app = create_app()
    async with AsyncClient(
        transport=ASGITransport(app=app),
        base_url="http://127.0.0.1:8000",
        headers={"Host": "127.0.0.1:8000"},
    ) as client:
        yield client


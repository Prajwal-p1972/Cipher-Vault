"""Unit tests for deterministic semantic text chunking."""

from app.chunking import chunk_pages, normalize_whitespace
from app.schemas import PageText


def test_chunking_size_bound():
    """Ensure no produced chunk exceeds the specified chunk_chars threshold."""
    long_text = "This is a detailed sentence about cryptographic security. " * 50
    pages = [PageText(page=1, text=long_text, source="doc.pdf", ocr=False)]

    chunks = chunk_pages(pages, chunk_chars=300, overlap=50)

    assert len(chunks) > 1
    for chunk in chunks:
        assert len(chunk.text) <= 300
        assert chunk.page == 1
        assert chunk.source == "doc.pdf"


def test_chunking_overlap():
    """Ensure consecutive chunks share overlapping tokens for semantic continuity."""
    sentences = [f"Numbered statement {i} containing important technical specifications." for i in range(20)]
    full_text = " ".join(sentences)
    pages = [PageText(page=1, text=full_text, source="notes.txt", ocr=False)]

    chunk_size = 200
    overlap = 50
    chunks = chunk_pages(pages, chunk_chars=chunk_size, overlap=overlap)

    assert len(chunks) >= 2
    for i in range(len(chunks) - 1):
        c1 = chunks[i].text
        c2 = chunks[i + 1].text
        # Tail of c1 should overlap with head of c2 or share tokens
        words_c1 = set(c1.split()[-4:])
        words_c2 = set(c2.split()[:8])
        assert len(words_c1.intersection(words_c2)) > 0


def test_chunking_page_tracking_and_indexing():
    """Ensure page numbers, source labels, and sequential indexes are accurately preserved."""
    pages = [
        PageText(page=1, text="Text from page 1.", source="guide.pdf", ocr=False),
        PageText(page=2, text="Text from page 2.", source="guide.pdf", ocr=False)
    ]

    chunks = chunk_pages(pages, chunk_chars=500, overlap=50)

    assert len(chunks) == 2
    assert chunks[0].page == 1
    assert chunks[0].source == "guide.pdf"
    assert chunks[0].index == 0

    assert chunks[1].page == 2
    assert chunks[1].source == "guide.pdf"
    assert chunks[1].index == 1


def test_chunking_determinism():
    """Ensure repeated runs with the same input yield identical chunks and indexes."""
    sample_text = "Deterministic cryptographic verification test. " * 30
    pages = [PageText(page=1, text=sample_text, source="test.pdf", ocr=False)]

    run1 = chunk_pages(pages, chunk_chars=250, overlap=40)
    run2 = chunk_pages(pages, chunk_chars=250, overlap=40)

    assert len(run1) == len(run2)
    for c1, c2 in zip(run1, run2):
        assert c1.text == c2.text
        assert c1.page == c2.page
        assert c1.source == c2.source
        assert c1.index == c2.index


def test_chunking_whitespace_normalization():
    """Ensure excess tabs, multiple spaces, and excessive linebreaks are cleaned."""
    dirty_text = "Word1     Word2\t\t\tWord3\n\n\n\n\nWord4"
    normalized = normalize_whitespace(dirty_text)

    assert "     " not in normalized
    assert "\t" not in normalized
    assert "\n\n\n" not in normalized
    assert normalized == "Word1 Word2 Word3\n\nWord4"

"""Data models and exception definitions for document extraction and chunking."""

from dataclasses import dataclass, field


@dataclass(slots=True, frozen=True)
class PageText:
    """Extracted text unit corresponding to a single page or document partition."""

    page: int
    text: str
    source: str
    ocr: bool


@dataclass(slots=True)
class ExtractionResult:
    """Aggregated extraction result for an ingested document."""

    pages: list[PageText] = field(default_factory=list)
    warnings: list[str] = field(default_factory=list)
    page_count: int = 0
    ocr_pages: int = 0


@dataclass(slots=True, frozen=True)
class Chunk:
    """Discrete text chunk ready for vector embedding and retrieval."""

    text: str
    page: int
    source: str
    index: int


class UnsupportedTypeError(Exception):
    """Raised when the document magic bytes do not match supported file types."""

    def __init__(self, message: str = "Unsupported document file format.") -> None:
        super().__init__(message)


class ExtractionLimitError(Exception):
    """Raised when document complexity or size exceeds configured security limits."""

    def __init__(self, message: str = "Document exceeds permitted extraction limits.") -> None:
        super().__init__(message)


class ExtractionError(Exception):
    """Raised when document extraction encounters a parsing or corruption error."""

    def __init__(self, message: str = "Failed to extract text from document.") -> None:
        super().__init__(message)

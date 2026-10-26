"""Configuration management for Cipher Vault offline AI service."""

from functools import lru_cache
from pydantic_settings import BaseSettings, SettingsConfigDict


class Settings(BaseSettings):
    """Application configuration loaded from environment variables with CV_AI_ prefix."""

    model_config = SettingsConfigDict(
        env_prefix="CV_AI_",
        env_file=".env",
        extra="ignore"
    )

    host: str = "127.0.0.1"
    port: int = 8000
    allowed_origins: list[str] = ["http://localhost:3000"]

    # Ingestion limits
    max_upload_bytes: int = 26_214_400  # 25 MB
    max_pdf_pages: int = 200
    max_ocr_pages: int = 30
    min_text_chars_per_page: int = 40
    ocr_languages: list[str] = ["en"]
    ocr_gpu: bool = False

    # ZIP archive limits
    zip_max_entries: int = 50
    zip_max_total_bytes: int = 104_857_600  # 100 MB
    zip_max_entry_bytes: int = 26_214_400   # 25 MB
    zip_max_ratio: float = 100.0

    # Image processing limits
    max_image_pixels: int = 40_000_000

    # Text chunking
    chunk_chars: int = 800
    chunk_overlap: int = 100

    # Session storage
    session_ttl_seconds: int = 1800
    max_sessions: int = 3
    max_docs_per_session: int = 5

    # Models
    embedding_model: str = "sentence-transformers/all-MiniLM-L6-v2"

    # LLM / Ollama
    ollama_url: str = "http://127.0.0.1:11434"
    llm_model: str = "llama3"
    llm_num_ctx: int = 4096
    llm_temperature: float = 0.2
    llm_max_answer_tokens: int = 700
    llm_timeout_seconds: int = 180
    retrieval_k: int = 5
    min_similarity: float = 0.25
    max_question_chars: int = 1000
    max_history_turns: int = 6
    max_context_chars: int = 6000
    max_chats_per_minute: int = 12


def _assert_ollama_loopback(url: str) -> None:
    """Raise RuntimeError if the ollama_url host is not a loopback address."""
    from urllib.parse import urlparse
    parsed = urlparse(url)
    hostname = parsed.hostname or ""
    loopback = {"127.0.0.1", "::1", "localhost"}
    if hostname not in loopback:
        raise RuntimeError(
            f"CV_AI_OLLAMA_URL host '{hostname}' is not a loopback address. "
            "The LLM backend must run on 127.0.0.1, ::1, or localhost."
        )


@lru_cache(maxsize=1)
def get_settings() -> Settings:
    """Return cached application settings singleton, asserting loopback for ollama_url."""
    cfg = Settings()
    _assert_ollama_loopback(cfg.ollama_url)
    return cfg

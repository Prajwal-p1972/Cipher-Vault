"""Offline embedding generation using local SentenceTransformer weights."""

import os

os.environ["HF_HUB_OFFLINE"] = "1"
os.environ["TRANSFORMERS_OFFLINE"] = "1"

from typing import Optional
from sentence_transformers import SentenceTransformer
from app.config import get_settings

_EMBEDDING_MODEL: Optional[SentenceTransformer] = None
_EMBEDDING_MODEL_NAME: Optional[str] = None


def get_query_prefix(model_name: str) -> str:
    """Return model-aware prefix for search queries."""
    lower = model_name.lower()
    if "bge" in lower:
        return "Represent this sentence for searching relevant passages: "
    if "e5" in lower:
        return "query: "
    return ""


def get_document_prefix(model_name: str) -> str:
    """Return model-aware prefix for indexed documents."""
    lower = model_name.lower()
    if "e5" in lower:
        return "passage: "
    return ""


def get_embedding_model() -> SentenceTransformer:
    """Load cached SentenceTransformer model singleton in offline mode."""
    global _EMBEDDING_MODEL, _EMBEDDING_MODEL_NAME
    settings = get_settings()
    if _EMBEDDING_MODEL is None or _EMBEDDING_MODEL_NAME != settings.embedding_model:
        try:
            _EMBEDDING_MODEL = SentenceTransformer(
                settings.embedding_model,
                device="cpu",
            )
            _EMBEDDING_MODEL_NAME = settings.embedding_model
        except Exception as exc:
            raise RuntimeError(
                f"SentenceTransformer model '{settings.embedding_model}' is not present in the local offline cache. "
                "Please run 'python scripts/download_models.py' while online to pre-cache the required weights."
            ) from exc
    return _EMBEDDING_MODEL


def is_model_available() -> bool:
    """Check if embedding model weights are pre-cached and loadable."""
    try:
        get_embedding_model()
        return True
    except Exception:
        return False


def embed_texts(texts: list[str]) -> list[list[float]]:
    """Generate normalized L2 vector embeddings for text chunks in batches of 32."""
    if not texts:
        return []
    settings = get_settings()
    doc_prefix = get_document_prefix(settings.embedding_model)
    prefixed_texts = [f"{doc_prefix}{t}" for t in texts] if doc_prefix else texts
    model = get_embedding_model()
    embeddings = model.encode(
        prefixed_texts,
        batch_size=32,
        device="cpu",
        normalize_embeddings=True,
        show_progress_bar=False,
    )
    return embeddings.tolist()


def embed_query(query: str) -> list[float]:
    """Generate normalized vector embedding for a search query with model-aware prefix."""
    if not query:
        raise ValueError("Cannot generate embedding for empty query.")
    settings = get_settings()
    prefix = get_query_prefix(settings.embedding_model)
    prefixed_query = f"{prefix}{query}" if prefix else query
    model = get_embedding_model()
    vec = model.encode(
        prefixed_query,
        device="cpu",
        normalize_embeddings=True,
        show_progress_bar=False,
    )
    return vec.tolist()

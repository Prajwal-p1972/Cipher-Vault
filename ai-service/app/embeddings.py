"""Offline embedding generation using local SentenceTransformer weights."""

import os

os.environ["HF_HUB_OFFLINE"] = "1"
os.environ["TRANSFORMERS_OFFLINE"] = "1"

from typing import Optional
from sentence_transformers import SentenceTransformer
from app.config import get_settings

_EMBEDDING_MODEL: Optional[SentenceTransformer] = None


def get_embedding_model() -> SentenceTransformer:
    """Load cached SentenceTransformer model singleton in offline mode."""
    global _EMBEDDING_MODEL
    if _EMBEDDING_MODEL is None:
        settings = get_settings()
        try:
            _EMBEDDING_MODEL = SentenceTransformer(
                settings.embedding_model,
                device="cpu",
            )
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
    """Generate normalized L2 vector embeddings for a list of text chunks in batches of 32."""
    if not texts:
        return []
    model = get_embedding_model()
    embeddings = model.encode(
        texts,
        batch_size=32,
        device="cpu",
        normalize_embeddings=True,
        show_progress_bar=False,
    )
    return embeddings.tolist()


def embed_query(query: str) -> list[float]:
    """Generate normalized vector embedding for a single search query."""
    vectors = embed_texts([query])
    if not vectors:
        raise ValueError("Cannot generate embedding for empty query.")
    return vectors[0]

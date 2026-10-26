"""In-memory ChromaDB vector store for ephemeral document sessions."""

import hashlib
import logging
from typing import Any, Optional
import chromadb
from chromadb.api import ClientAPI
from chromadb.api.models.Collection import Collection
from chromadb.config import Settings
from app.schemas import Chunk

logger = logging.getLogger(__name__)


class SessionStore:
    """Manages ephemeral in-memory ChromaDB collections for document sessions."""

    def __init__(self) -> None:
        """Initialize in-memory EphemeralClient with telemetry disabled."""
        self._settings = Settings(
            anonymized_telemetry=False,
            allow_reset=True,
            is_persistent=False,
        )
        self._client: ClientAPI = chromadb.EphemeralClient(settings=self._settings)

    @staticmethod
    def _collection_name(session_id: str) -> str:
        """Derive compliant, deterministic ChromaDB collection name from session ID."""
        digest = hashlib.sha256(session_id.encode("utf-8")).hexdigest()[:32]
        return f"cv_{digest}"

    def create(self, session_id: str) -> Collection:
        """Create or retrieve in-memory collection for a session with cosine distance."""
        name = self._collection_name(session_id)
        return self._client.get_or_create_collection(
            name=name,
            metadata={"hnsw:space": "cosine"},
            embedding_function=None,
        )

    def add_chunks(
        self,
        session_id: str,
        doc_id: str,
        chunks: list[Chunk],
        embeddings: list[list[float]],
    ) -> None:
        """Add document chunks and pre-computed embeddings to the session collection."""
        if not chunks:
            return

        collection = self.create(session_id)
        ids = [f"{doc_id}_{chunk.index}" for chunk in chunks]
        documents = [chunk.text for chunk in chunks]
        metadatas: list[dict[str, Any]] = [
            {
                "doc_id": doc_id,
                "page": chunk.page,
                "source": chunk.source,
                "chunk_index": chunk.index,
            }
            for chunk in chunks
        ]

        collection.add(
            ids=ids,
            embeddings=embeddings,
            documents=documents,
            metadatas=metadatas,
        )
        logger.debug(
            "Added %d chunks for doc_id=%s into session collection",
            len(chunks),
            doc_id,
        )

    def query(
        self,
        session_id: str,
        query_embedding: list[float],
        k: int = 5,
    ) -> list[dict[str, Any]]:
        """Query top-k most similar chunks using cosine similarity capped at 10."""
        capped_k = min(max(1, int(k)), 10)
        collection = self.create(session_id)
        total_items = collection.count()

        if total_items == 0:
            return []

        n_results = min(capped_k, total_items)
        raw_result = collection.query(
            query_embeddings=[query_embedding],
            n_results=n_results,
        )

        results: list[dict[str, Any]] = []
        doc_list = raw_result.get("documents")
        if doc_list and len(doc_list) > 0 and doc_list[0]:
            docs = doc_list[0]
            metas = raw_result.get("metadatas", [[]])[0]
            distances = raw_result.get("distances", [[]])[0]

            for i in range(len(docs)):
                raw_dist = distances[i] if i < len(distances) and distances[i] is not None else 1.0
                cosine_sim = max(0.0, min(1.0, 1.0 - float(raw_dist)))
                meta = metas[i] if i < len(metas) and metas[i] is not None else {}

                results.append(
                    {
                        "text": docs[i],
                        "page": int(meta.get("page", 0)),
                        "source": str(meta.get("source", "")),
                        "score": round(cosine_sim, 4),
                        "docId": str(meta.get("doc_id", "")),
                    }
                )

        return results

    def delete(self, session_id: str) -> None:
        """Delete session collection from in-memory ChromaDB client."""
        name = self._collection_name(session_id)
        try:
            self._client.delete_collection(name=name)
            logger.debug("Deleted collection for session")
        except Exception:
            pass

    def count(self, session_id: Optional[str] = None) -> int:
        """Return total chunks in session collection or total collections count."""
        if session_id is not None:
            try:
                name = self._collection_name(session_id)
                collection = self._client.get_collection(name=name)
                return collection.count()
            except Exception:
                return 0
        return len(self._client.list_collections())

    def reset(self) -> None:
        """Reset the entire in-memory vector store, purging all collections."""
        try:
            self._client.reset()
        except Exception:
            pass

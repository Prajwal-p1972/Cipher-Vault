"""In-memory ChromaDB vector store for ephemeral document sessions."""

import hashlib
import logging
from typing import Any, Optional
import chromadb
from chromadb.api import ClientAPI
from chromadb.api.models.Collection import Collection
from chromadb.config import Settings
import numpy as np
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
        # In-memory document storage: session_id -> doc_id -> {"chunks": list[Chunk], "embeddings": np.ndarray}
        self._doc_data: dict[str, dict[str, dict[str, Any]]] = {}
        # In-memory summary cache: session_id -> dict[str, str] {mode: text}
        self._summary_cache: dict[str, dict[str, str]] = {}

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

        # In-memory ordered chunk list and normalized embedding matrix
        if session_id not in self._doc_data:
            self._doc_data[session_id] = {}

        if embeddings and len(embeddings) > 0:
            arr = np.array(embeddings, dtype=np.float32)
            norms = np.linalg.norm(arr, axis=1, keepdims=True)
            norms[norms == 0] = 1.0
            norm_embeddings = arr / norms
        else:
            norm_embeddings = np.empty((0, 0), dtype=np.float32)

        self._doc_data[session_id][doc_id] = {
            "chunks": list(chunks),
            "embeddings": norm_embeddings,
        }
        # Invalidate summary cache when a new document is added
        self.clear_summary_cache(session_id)

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
        max_k: int = 10,
    ) -> list[dict[str, Any]]:
        """Query top-k most similar chunks using cosine similarity capped at max_k (default 10)."""
        capped_k = min(max(1, int(k)), max_k)
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
                        "chunk_index": int(meta.get("chunk_index", 0)),
                        "section": str(meta.get("section", "")),
                        "kind": str(meta.get("kind", "text")),
                    }
                )

        return results

    def get_document_data(
        self,
        session_id: str,
        doc_id: Optional[str] = None,
    ) -> tuple[list[Chunk], np.ndarray]:
        """Retrieve ordered chunk list and normalized embedding matrix for document(s)."""
        session_docs = self._doc_data.get(session_id, {})
        if not session_docs:
            return [], np.empty((0, 0), dtype=np.float32)

        if doc_id is not None:
            doc_record = session_docs.get(doc_id)
            if not doc_record:
                return [], np.empty((0, 0), dtype=np.float32)
            return list(doc_record["chunks"]), doc_record["embeddings"]

        # Concatenate all docs in session in insertion order
        all_chunks: list[Chunk] = []
        all_embs: list[np.ndarray] = []
        for d in session_docs.values():
            all_chunks.extend(d["chunks"])
            if d["embeddings"].size > 0:
                all_embs.append(d["embeddings"])

        if all_embs:
            merged_embs = np.vstack(all_embs)
        else:
            merged_embs = np.empty((0, 0), dtype=np.float32)

        return all_chunks, merged_embs

    def get_summary_cache(self, session_id: str, mode: str) -> Optional[str]:
        """Retrieve cached whole-document summary for the session and mode."""
        return self._summary_cache.get(session_id, {}).get(mode)

    def set_summary_cache(self, session_id: str, mode: str, text: str) -> None:
        """Store generated whole-document summary in ephemeral session memory."""
        if session_id not in self._summary_cache:
            self._summary_cache[session_id] = {}
        self._summary_cache[session_id][mode] = text

    def clear_summary_cache(self, session_id: str) -> None:
        """Clear whole-document summary cache for session."""
        self._summary_cache.pop(session_id, None)

    def delete(self, session_id: str) -> None:
        """Delete session collection and memory stores from in-memory ChromaDB client."""
        self._doc_data.pop(session_id, None)
        self._summary_cache.pop(session_id, None)
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
        """Reset the entire in-memory vector store, purging all collections and caches."""
        self._doc_data.clear()
        self._summary_cache.clear()
        try:
            self._client.reset()
        except Exception:
            pass

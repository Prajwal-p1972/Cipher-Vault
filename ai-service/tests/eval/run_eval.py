"""Evaluation harness comparing baseline (MiniLM dense-only) vs upgraded (BGE hybrid + rerank).

Marked as slow, not collected by default test runs:
    pytest -m slow tests/eval/run_eval.py
or run directly:
    python tests/eval/run_eval.py
"""

import asyncio
import json
import os
import sys
import time
from pathlib import Path
from typing import Any
import fitz
import pytest

sys.path.insert(0, str(Path(__file__).resolve().parent.parent.parent))

from app.chat import ChatService
from app.config import Settings
from app.extraction.pdf import extract_pdf
from app.chunking import chunk_pages
from app.embeddings import embed_texts
from app.retrieval import bm25_store, get_rerank_model
from app.sessions import Session
from app.vectorstore import SessionStore


def create_eval_pdf() -> bytes:
    """Build multi-page synthetic evaluation PDF in memory.

    Reproduces the bug scenario:
    - Page 1: TOC page listing 'Table 5.1 Technology stack'
    - Page 2: Executive Summary (prose)
    - Page 3: System Architecture & Technology Stack (Table)
    - Page 4: Lockout Policy (prose)
    - Page 5: Key Management (prose)
    """
    doc = fitz.open()
    try:
        # Page 1: Contents page
        p1 = doc.new_page(width=595, height=842)
        p1.insert_text(
            fitz.Point(50, 70),
            "Table of Contents\n\n"
            "1. Executive Summary ................................. 2\n"
            "Table 5.1 Technology stack ........................... 3\n"
            "6. Lockout and Access Control Policy ................. 4\n"
            "7. Cryptographic Key Management ...................... 5\n",
            fontsize=11,
        )

        # Page 2: Executive Summary
        p2 = doc.new_page(width=595, height=842)
        p2.insert_text(fitz.Point(50, 50), "1. Executive Summary", fontsize=14)
        p2.insert_text(
            fitz.Point(50, 90),
            "Cipher Vault is a high-security zero-trust enclave designed for sovereign cryptographic storage.\n"
            "All operational workflows enforce strict memory sanitization and offline boundary isolation.\n"
            "The microservice architecture ensures complete privacy without outbound network telemetry.",
            fontsize=11,
        )

        # Page 3: Table Page
        p3 = doc.new_page(width=595, height=842)
        p3.insert_text(fitz.Point(50, 50), "5.1 Technology Stack", fontsize=14)
        table_rows = [
            ["Layer", "Technology"],
            ["Backend", "Node.js 20+, Express 5, Mongoose"],
            ["Frontend", "React, Vite, Chart.js"],
            ["Database", "MongoDB 7.0 with encrypted field storage"],
            ["Cache", "In-memory Redis compatible ephemeral store"],
            ["Security", "Argon2id, AES-256-GCM, ECDSA P-384"],
        ]
        shape = p3.new_shape()
        x0, y0 = 50, 100
        col_w, row_h = 240, 26
        for r_idx, row in enumerate(table_rows):
            y = y0 + r_idx * row_h
            for c_idx, val in enumerate(row):
                x = x0 + c_idx * col_w
                rect = fitz.Rect(x, y, x + col_w, y + row_h)
                shape.draw_rect(rect)
                p3.insert_text(fitz.Point(x + 5, y + 17), val, fontsize=10)
        shape.finish(color=(0, 0, 0), width=1)
        shape.commit()

        # Page 4: Lockout Policy
        p4 = doc.new_page(width=595, height=842)
        p4.insert_text(fitz.Point(50, 50), "6. Lockout and Access Control Policy", fontsize=14)
        p4.insert_text(
            fitz.Point(50, 90),
            "User authentication is governed by a strict lockout policy. After 5 consecutive failed\n"
            "login attempts, the user account is automatically locked for an observation window of 15 minutes.\n"
            "Administrative unlock requires dual-custody physical token authorization and security officer approval.\n"
            "Active session tokens expire automatically after 30 minutes of idle inactivity.",
            fontsize=11,
        )

        # Page 5: Key Management
        p5 = doc.new_page(width=595, height=842)
        p5.insert_text(fitz.Point(50, 50), "7. Cryptographic Key Management", fontsize=14)
        p5.insert_text(
            fitz.Point(50, 90),
            "All master cryptographic keys are derived using PBKDF2 with HMAC-SHA512 over 600,000 iterations.\n"
            "Ephemeral data encryption keys are rotated every 24 hours or after encrypting 10,000 records.\n"
            "Decrypted plaintext buffers never touch non-volatile storage and are zeroed immediately upon release.",
            fontsize=11,
        )

        return doc.tobytes()
    finally:
        doc.close()


GOLDEN_QUESTIONS = [
    {
        "id": "Q1",
        "question": "which tech stack is used in the given project",
        "in_doc": True,
        "expected_page": 3,
        "keywords": ["node", "express", "react", "vite", "mongoose"],
    },
    {
        "id": "Q2",
        "question": "what database is used",
        "in_doc": True,
        "expected_page": 3,
        "keywords": ["mongodb"],
    },
    {
        "id": "Q3",
        "question": "what is the lockout policy",
        "in_doc": True,
        "expected_page": 4,
        "keywords": ["5", "failed", "15", "minutes"],
    },
    {
        "id": "Q4",
        "question": "what is the stock price of Apple today",
        "in_doc": False,
        "expected_page": None,
        "keywords": [],
    },
    {
        "id": "Q5",
        "question": "who won the 1994 FIFA World Cup",
        "in_doc": False,
        "expected_page": None,
        "keywords": [],
    },
    {
        "id": "Q6",
        "question": "what is the recipe for chocolate chip cookies",
        "in_doc": False,
        "expected_page": None,
        "keywords": [],
    },
]


async def run_eval_for_config(
    cfg: Settings,
    config_name: str,
    pdf_bytes: bytes,
) -> dict[str, Any]:
    """Execute evaluation run for a specific pipeline configuration."""
    print(f"\n=======================================================")
    print(f" Running Evaluation: {config_name}")
    print(f" Embedding Model: {cfg.embedding_model}")
    print(f" Hybrid Retrieval: {cfg.enable_hybrid_retrieval}")
    print(f" Reranking: {cfg.enable_reranking} ({cfg.rerank_model})")
    print(f"=======================================================")

    # Setup isolated vector store and session
    vector_store = SessionStore()
    session_id = f"eval_{config_name.lower().replace(' ', '_')}"
    session = Session(
        session_id=session_id,
        token_hash="fake_hash",
        created_at=time.time(),
        last_accessed_at=time.time(),
        expires_at=time.time() + 3600,
    )

    # Ingest document
    extraction = extract_pdf(pdf_bytes, source="eval_doc.pdf")
    chunks = chunk_pages(
        extraction.pages,
        chunk_chars=cfg.chunk_chars,
        overlap=cfg.chunk_overlap,
    )
    chunk_texts = [c.text for c in chunks]
    embeddings = embed_texts(chunk_texts)
    vector_store.add_chunks(session_id, "doc1", chunks, embeddings)
    bm25_store.add_chunks(session_id, "doc1", chunks)

    chat_service = ChatService(vector_store, cfg)

    results = []
    hits_at_6 = 0
    total_in_doc = sum(1 for q in GOLDEN_QUESTIONS if q["in_doc"])
    correct_refusals = 0
    total_out_doc = sum(1 for q in GOLDEN_QUESTIONS if not q["in_doc"])
    keyword_hits = 0
    total_keywords = sum(len(q["keywords"]) for q in GOLDEN_QUESTIONS if q["in_doc"])
    latencies = []

    for q in GOLDEN_QUESTIONS:
        t0 = time.perf_counter()

        sources = []
        tokens = []
        async for frame in chat_service.answer_stream(q["question"], session):
            if frame.startswith("event: sources\ndata: "):
                sources = json.loads(frame.split("\n")[1][6:])
            elif frame.startswith("event: token\ndata: "):
                payload = json.loads(frame.split("\n")[1][6:])
                tokens.append(payload.get("text", ""))

        t1 = time.perf_counter()
        elapsed = t1 - t0
        latencies.append(elapsed)
        answer = "".join(tokens).strip()

        retrieved_pages = [s.get("page") for s in sources]
        scores = [s.get("score") for s in sources]

        # Evaluate Hit@6
        hit = False
        if q["in_doc"]:
            hit = q["expected_page"] in retrieved_pages[:6]
            if hit:
                hits_at_6 += 1

        # Evaluate Refusal
        refused = False
        not_found_phrases = [
            "could not find",
            "not present",
            "not found",
            "no information",
            "does not mention",
        ]
        if not q["in_doc"]:
            if len(sources) == 0 or any(p in answer.lower() for p in not_found_phrases):
                refused = True
                correct_refusals += 1

        # Evaluate Keywords
        q_kw_hits = 0
        if q["in_doc"]:
            for kw in q["keywords"]:
                if kw.lower() in answer.lower():
                    q_kw_hits += 1
            keyword_hits += q_kw_hits

        print(f"[{q['id']}] '{q['question']}'")
        print(f"   In-doc: {q['in_doc']} | Hit@6: {hit} | Pages: {retrieved_pages} | Scores: {scores}")
        print(f"   Latency: {elapsed:.2f}s | Answer: {repr(answer[:100])}...")

        results.append({
            "id": q["id"],
            "question": q["question"],
            "in_doc": q["in_doc"],
            "hit_at_6": hit,
            "refused": refused,
            "kw_hits": q_kw_hits,
            "kw_total": len(q["keywords"]),
            "scores": scores,
            "elapsed": elapsed,
            "answer": answer,
        })

    # Clean up session
    vector_store.delete(session_id)
    bm25_store.delete(session_id)

    hit_rate = (hits_at_6 / total_in_doc) if total_in_doc else 0.0
    kw_acc = (keyword_hits / total_keywords) if total_keywords else 0.0
    refusal_rate = (correct_refusals / total_out_doc) if total_out_doc else 0.0
    avg_latency = sum(latencies) / len(latencies) if latencies else 0.0

    return {
        "config_name": config_name,
        "hit_at_6": hit_rate,
        "keyword_accuracy": kw_acc,
        "correct_refusals": refusal_rate,
        "avg_latency": avg_latency,
        "details": results,
    }


def print_comparison_table(old_res: dict[str, Any], new_res: dict[str, Any]) -> None:
    """Print markdown formatted before/after comparison table."""
    print("\n" + "=" * 80)
    print("                     EVALUATION RESULTS COMPARISON TABLE")
    print("=" * 80)
    print(f"{'Metric':<32} | {'Old (MiniLM Dense)':<22} | {'New (BGE Hybrid+Rerank)':<22}")
    print("-" * 32 + "-+-" + "-" * 22 + "-+-" + "-" * 22)
    print(f"{'Hit@6 (In-Doc Questions)':<32} | {old_res['hit_at_6']*100:>20.1f}% | {new_res['hit_at_6']*100:>20.1f}%")
    print(f"{'Answer Keyword Accuracy':<32} | {old_res['keyword_accuracy']*100:>20.1f}% | {new_res['keyword_accuracy']*100:>20.1f}%")
    print(f"{'Correct Refusals (Out-of-Doc)':<32} | {old_res['correct_refusals']*100:>20.1f}% | {new_res['correct_refusals']*100:>20.1f}%")
    print(f"{'Avg Latency Per Query':<32} | {old_res['avg_latency']:>19.2f}s | {new_res['avg_latency']:>19.2f}s")
    print("=" * 80)

    print("\n--- Calibration Scores Detail ---")
    for new_detail in new_res["details"]:
        qid = new_detail["id"]
        in_doc = "IN-DOC" if new_detail["in_doc"] else "OUT-DOC"
        scores = new_detail["scores"]
        print(f"[{qid}] ({in_doc}) Rerank Scores: {scores}")


@pytest.mark.slow
def test_evaluation_pipeline_harness():
    """Run full evaluation comparing Old vs New configurations."""
    pdf_bytes = create_eval_pdf()

    # Configuration 1: Old (MiniLM dense only, no reranker, no hybrid)
    old_cfg = Settings(
        embedding_model="sentence-transformers/all-MiniLM-L6-v2",
        enable_hybrid_retrieval=False,
        enable_reranking=False,
        enable_query_rewrite=False,
        retrieval_final_k=6,
        min_similarity=0.25,
    )

    # Configuration 2: New (BGE small, hybrid search, CrossEncoder reranking, query rewrite)
    new_cfg = Settings(
        embedding_model="BAAI/bge-small-en-v1.5",
        rerank_model="BAAI/bge-reranker-base",
        enable_hybrid_retrieval=True,
        enable_reranking=True,
        enable_query_rewrite=True,
        retrieval_final_k=6,
        rerank_score_threshold=0.0001,
        llm_num_ctx=8192,
        max_context_chars=12000,
        llm_temperature=0.1,
    )

    loop = asyncio.get_event_loop()
    old_res = loop.run_until_complete(run_eval_for_config(old_cfg, "Old Baseline", pdf_bytes))
    new_res = loop.run_until_complete(run_eval_for_config(new_cfg, "New Hybrid RAG", pdf_bytes))

    print_comparison_table(old_res, new_res)

    # Assertions for the upgraded pipeline
    assert new_res["hit_at_6"] >= 0.99, f"Hit@6 was {new_res['hit_at_6']}, expected 1.0"
    assert new_res["correct_refusals"] >= 0.66, f"Correct refusals was {new_res['correct_refusals']}"


if __name__ == "__main__":
    pdf_bytes = create_eval_pdf()

    old_cfg = Settings(
        embedding_model="sentence-transformers/all-MiniLM-L6-v2",
        enable_hybrid_retrieval=False,
        enable_reranking=False,
        enable_query_rewrite=False,
        retrieval_final_k=6,
        min_similarity=0.25,
    )

    new_cfg = Settings(
        embedding_model="BAAI/bge-small-en-v1.5",
        rerank_model="BAAI/bge-reranker-base",
        enable_hybrid_retrieval=True,
        enable_reranking=True,
        enable_query_rewrite=True,
        retrieval_final_k=6,
        rerank_score_threshold=0.0001,
        llm_num_ctx=8192,
        max_context_chars=12000,
        llm_temperature=0.1,
    )

    old_res = asyncio.run(run_eval_for_config(old_cfg, "Old Baseline", pdf_bytes))
    new_res = asyncio.run(run_eval_for_config(new_cfg, "New Hybrid RAG", pdf_bytes))

    print_comparison_table(old_res, new_res)

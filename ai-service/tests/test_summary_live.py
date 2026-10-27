"""Live LLM tests for whole-document summarization with local Ollama instance.

Ingests a 20-page synthetic PDF with distinct topics per page, measures
quick and detailed summary latency on CPU, verifies at least 3 topics are cited/mentioned,
and prints timings and raw output.
"""

import asyncio
import json
import re
import time
import pytest
from httpx import ASGITransport, AsyncClient

from app.config import get_settings
from app.llm.ollama_client import check
from app.main import create_app
from tests.conftest import create_pdf_bytes

cfg = get_settings()

TOPICS = [
    ("Quantum Computing", "Superposition and entanglement enable fast quantum algorithms to outperform classical computers."),
    ("Coral Bleaching", "Ocean warming causes zooxanthellae loss and widespread bleaching across global barrier reefs."),
    ("Gothic Architecture", "Ribbed vaults and external flying buttresses support massive cathedral stone walls."),
    ("Deep Learning", "Backpropagation optimizes neural network weights by propagating loss gradients backwards."),
    ("Photosynthesis", "Chloroplast thylakoids split water molecules to generate ATP and oxygen chemical energy."),
    ("Wind Turbines", "Aerodynamic blades capture kinetic wind energy to generate clean renewable electricity."),
    ("Damascus Steel", "Ancient metallurgy techniques folding high-carbon crucible steel created patterned blades."),
    ("Martian Volcanism", "Olympus Mons is a colossal shield volcano formed by stationary mantle plumes on Mars."),
    ("RSA Cryptography", "Factoring large prime numbers provides asymmetric security for digital encryption."),
    ("Cellular Mitosis", "Centromeric kinetochores attach to spindle fibers to separate sister chromatids."),
    ("Silk Road", "Caravans transported silk, spices, and cultural concepts between Asia and the Mediterranean."),
    ("Superconductivity", "Zero electrical resistance and magnetic expulsion via Meissner effect occur at low temperatures."),
    ("Pyroclastic Flows", "Superheated gas and tephra currents descend volcanic slopes during Plinian eruptions."),
    ("CRISPR Gene Editing", "Bacterial Cas9 endonuclease enables targeted and precise modifications of genomic DNA."),
    ("Solar Wind", "Coronal mass ejections cause geomagnetic storms and vibrant high-latitude auroras."),
    ("Jet Streams", "High-altitude meandering air currents guide mid-latitude atmospheric weather systems."),
    ("Fiber Optics", "Total internal reflection transmits pulsed laser light signals across silica glass cores."),
    ("Tectonic Faulting", "Subduction zones release elastic strain energy generating destructive seismic waves."),
    ("Enzyme Kinetics", "Michaelis-Menten dynamics describe biocatalyst reaction rates up to maximum velocity."),
    ("Robotic Navigation", "SLAM algorithms map unknown environments and navigate mobile robots indoors.")
]


async def _ollama_available() -> bool:
    """Return True only when Ollama is running and the model is present."""
    result = await check(cfg)
    return bool(result.get("ok"))


async def _require_ollama() -> None:
    """Skip the test if Ollama is not available."""
    try:
        available = await _ollama_available()
    except Exception:
        available = False
    if not available:
        pytest.skip("Ollama not running or model not pulled — skipping live LLM summary test.")


pytestmark = [pytest.mark.slow, pytest.mark.llm, pytest.mark.llm_live]


@pytest.mark.asyncio
async def test_live_summary_20_page_synthetic_pdf():
    """Ingest a 20-page synthetic PDF with distinct topics; verify topic coverage and page citations."""
    await _require_ollama()

    test_cfg = cfg.model_copy(update={"summary_group_chars": 1200})
    app = create_app(test_cfg)

    # 1. Generate 20-page PDF
    page_texts = [f"Chapter {i+1}: {title}\n\n{content}" for i, (title, content) in enumerate(TOPICS)]
    pdf_bytes = create_pdf_bytes(page_texts)
    assert len(pdf_bytes) > 0

    async with AsyncClient(
        transport=ASGITransport(app=app),
        base_url="http://127.0.0.1:8000",
        headers={"Host": "127.0.0.1:8000", "Origin": "http://localhost:3000"},
        timeout=180.0,
    ) as client:
        # Create session
        create_res = await client.post("/v1/sessions")
        assert create_res.status_code == 201
        sid = create_res.json()["sessionId"]
        token = create_res.json()["token"]
        auth_hdr = {"Authorization": f"Bearer {token}"}

        # Ingest PDF
        upload_res = await client.post(
            f"/v1/sessions/{sid}/documents",
            headers={**auth_hdr, "Content-Type": "application/octet-stream"},
            content=pdf_bytes,
        )
        assert upload_res.status_code == 201
        upload_data = upload_res.json()
        assert upload_data["pageCount"] == 20
        assert upload_data["chunkCount"] >= 20

        # 2. Quick summary benchmark
        t_start_quick = time.monotonic()
        quick_res = await client.post(
            f"/v1/sessions/{sid}/chat",
            headers=auth_hdr,
            json={"question": "Summarize this document and give an overview", "mode": "summary"},
        )
        assert quick_res.status_code == 200

        quick_tokens = []
        quick_final_text = ""
        for line in quick_res.text.split("\n"):
            if line.startswith("data: "):
                try:
                    payload = json.loads(line[6:])
                    if isinstance(payload, dict):
                        if "text" in payload:
                            quick_tokens.append(payload["text"])
                        if "finalText" in payload:
                            quick_final_text = payload["finalText"]
                except Exception:
                    pass

        quick_elapsed = time.monotonic() - t_start_quick
        if not quick_final_text:
            quick_final_text = "".join(quick_tokens)

        # 3. Detailed summary benchmark
        t_start_detailed = time.monotonic()
        detailed_res = await client.post(
            f"/v1/sessions/{sid}/chat",
            headers=auth_hdr,
            json={"question": "Provide a detailed summary", "mode": "detailed"},
        )
        assert detailed_res.status_code == 200

        detailed_tokens = []
        detailed_final_text = ""
        progress_events = []
        for line in detailed_res.text.split("\n"):
            if line.startswith("data: "):
                try:
                    payload = json.loads(line[6:])
                    if isinstance(payload, dict):
                        if "text" in payload:
                            detailed_tokens.append(payload["text"])
                        if "finalText" in payload:
                            detailed_final_text = payload["finalText"]
                        if "step" in payload and "of" in payload:
                            progress_events.append(payload)
                except Exception:
                    pass

        detailed_elapsed = time.monotonic() - t_start_detailed
        if not detailed_final_text:
            detailed_final_text = "".join(detailed_tokens)

        # Output raw results and timings for done criteria
        print(f"\n==================== SYNTHETIC 20-PAGE BENCHMARK ====================")
        print(f"Quick summary elapsed: {quick_elapsed:.2f} s")
        print(f"Detailed summary elapsed: {detailed_elapsed:.2f} s")
        print(f"Detailed progress steps captured: {len(progress_events)}")
        print(f"Detailed raw response:\n{detailed_res.text[:500]}")
        print(f"\n--- RAW QUICK SUMMARY ---\n{quick_final_text}")
        print(f"\n--- RAW DETAILED SUMMARY ---\n{detailed_final_text}")
        print(f"====================================================================\n")

        # 4. Verify topic coverage: mentions at least 3 topics
        all_text_lower = (quick_final_text + " " + detailed_final_text).lower()
        matched_topics = []
        for title, _ in TOPICS:
            # Check individual keywords of each topic
            keywords = [w.lower() for w in title.split() if len(w) > 3]
            if any(k in all_text_lower for k in keywords):
                matched_topics.append(title)

        print(f"Topics identified in summaries ({len(matched_topics)}): {matched_topics}")

        # Citations check
        has_citations = bool(re.search(r"\[p\.\d+\]", quick_final_text) or re.search(r"\[p\.\d+\]", detailed_final_text))
        print(f"Page citations present: {has_citations}")

        assert len(matched_topics) >= 3, f"Expected at least 3 topics mentioned, got {len(matched_topics)}: {matched_topics}"
        assert has_citations, "Expected page citations [p.N] in generated summary"

"""Semantic retrieval tests using real SentenceTransformer model and multi-session isolation."""

import pytest
from httpx import ASGITransport, AsyncClient
from app.embeddings import is_model_available
from app.main import create_app


@pytest.mark.slow
@pytest.mark.asyncio
async def test_semantic_search_and_session_isolation(make_pdf):
    """Verify semantic retrieval rankings, cross-session isolation, and post-delete invalidation."""
    if not is_model_available():
        pytest.skip(
            "SentenceTransformer model weights not pre-cached; run scripts/download_models.py."
        )

    app = create_app()
    async with AsyncClient(
        transport=ASGITransport(app=app),
        base_url="http://127.0.0.1:8000",
        headers={"Host": "127.0.0.1:8000"},
    ) as client:
        # 1. Create Session A
        res_a = await client.post(
            "/v1/sessions",
            headers={"Origin": "http://localhost:3000"},
        )
        assert res_a.status_code == 201
        sid_a = res_a.json()["sessionId"]
        tok_a = res_a.json()["token"]

        # Ingest Document 1: Quantum Physics
        pdf_quantum = make_pdf(
            [
                "Quantum mechanics and wave-particle duality describe microscopic atomic phenomena in physics."
            ]
        )
        up1 = await client.post(
            f"/v1/sessions/{sid_a}/documents",
            content=pdf_quantum,
            headers={
                "Origin": "http://localhost:3000",
                "Authorization": f"Bearer {tok_a}",
                "Content-Type": "application/octet-stream",
            },
        )
        assert up1.status_code == 201

        # Ingest Document 2: Baking Bread
        pdf_baking = make_pdf(
            [
                "Traditional artisanal baking recipes rely on sourdough yeast fermentation and organic wheat flour."
            ]
        )
        up2 = await client.post(
            f"/v1/sessions/{sid_a}/documents",
            content=pdf_baking,
            headers={
                "Origin": "http://localhost:3000",
                "Authorization": f"Bearer {tok_a}",
                "Content-Type": "application/octet-stream",
            },
        )
        assert up2.status_code == 201

        # 2. Semantic Search on Topic A
        search_res = await client.post(
            f"/v1/sessions/{sid_a}/search",
            json={"query": "quantum physics and atomic particle duality", "k": 2},
            headers={
                "Origin": "http://localhost:3000",
                "Authorization": f"Bearer {tok_a}",
            },
        )
        assert search_res.status_code == 200
        results = search_res.json()["results"]
        assert len(results) == 2
        # Topic A chunk must rank first
        assert "Quantum mechanics" in results[0]["text"]
        assert results[0]["score"] > results[1]["score"]

        # 3. Create Session B
        res_b = await client.post(
            "/v1/sessions",
            headers={"Origin": "http://localhost:3000"},
        )
        assert res_b.status_code == 201
        sid_b = res_b.json()["sessionId"]
        tok_b = res_b.json()["token"]

        # Cross-session isolation: Session B cannot query Session A
        cross_res = await client.post(
            f"/v1/sessions/{sid_a}/search",
            json={"query": "quantum physics", "k": 2},
            headers={
                "Origin": "http://localhost:3000",
                "Authorization": f"Bearer {tok_b}",  # Wrong token!
            },
        )
        assert cross_res.status_code == 401

        # 4. Delete Session A
        del_res = await client.delete(
            f"/v1/sessions/{sid_a}",
            headers={
                "Origin": "http://localhost:3000",
                "Authorization": f"Bearer {tok_a}",
            },
        )
        assert del_res.status_code == 204

        # Search on deleted Session A should return 401
        post_del_res = await client.post(
            f"/v1/sessions/{sid_a}/search",
            json={"query": "quantum physics", "k": 2},
            headers={
                "Origin": "http://localhost:3000",
                "Authorization": f"Bearer {tok_a}",
            },
        )
        assert post_del_res.status_code == 401

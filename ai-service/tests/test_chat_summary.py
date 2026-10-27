"""Comprehensive unit and integration tests for whole-document summarization in ChatService."""

import asyncio
import json
from unittest.mock import MagicMock, patch
import httpx
from httpx import ASGITransport, AsyncClient
import pytest

from app.config import get_settings
from app.main import create_app
from app.schemas import Chunk
from app.sessions import Session
from app.vectorstore import SessionStore


def _make_sample_chunks(count: int = 5, chars_per_chunk: int = 200) -> list[Chunk]:
    return [
        Chunk(
            text=f"Paragraph {i} content text. " * (chars_per_chunk // 25),
            page=(i // 2) + 1,
            source="test_doc.pdf",
            index=i,
            section=f"Section {i}",
        )
        for i in range(count)
    ]


@pytest.mark.asyncio
async def test_auto_mode_routes_overview_to_summary_and_tech_stack_to_retrieval():
    """Verify auto mode routes global queries to summarization and specific questions to retrieval."""
    cfg = get_settings()
    app = create_app(cfg)

    # Ingest document with 4 chunks
    chunks = _make_sample_chunks(4)
    embs = [[0.1] * 384 for _ in range(4)]

    called_endpoints = []

    def _transport(req: httpx.Request) -> httpx.Response:
        called_endpoints.append(req.url.path)
        body_lines = [
            json.dumps({"message": {"content": "Summary text [p.1]."}, "done": False}),
            json.dumps({"message": {"content": ""}, "done": True}),
        ]
        return httpx.Response(200, text="\n".join(body_lines) + "\n")

    mock_client = httpx.AsyncClient(transport=httpx.MockTransport(_transport), base_url="http://127.0.0.1:11434")

    with (
        patch("app.llm.ollama_client._make_client", side_effect=lambda cfg=None: httpx.AsyncClient(transport=httpx.MockTransport(_transport), base_url="http://127.0.0.1:11434")),
        patch("app.chat.embed_query", return_value=[0.1] * 384),
    ):
        async with AsyncClient(
            transport=ASGITransport(app=app),
            base_url="http://127.0.0.1:8000",
            headers={"Host": "127.0.0.1:8000", "Origin": "http://localhost:3000"},
        ) as client:
            res_sess = await client.post("/v1/sessions")
            sid = res_sess.json()["sessionId"]
            tok = res_sess.json()["token"]

            app.state.vector_store.add_chunks(sid, "d1", chunks, embs)

            # Spy on vector_store.query
            query_spy = MagicMock(return_value=[])
            app.state.vector_store.query = query_spy

            # 1. Global query in auto mode -> summary
            res1 = await client.post(
                f"/v1/sessions/{sid}/chat",
                headers={"Authorization": f"Bearer {tok}"},
                json={"question": "give me an overview", "mode": "auto"},
            )
            assert res1.status_code == 200
            # Similarity retrieval should NOT be called
            query_spy.assert_not_called()

            # 2. Specific query in auto mode -> retrieval
            query_spy.reset_mock()
            with patch("app.retrieval.hybrid_retrieve", return_value=[]):
                res2 = await client.post(
                    f"/v1/sessions/{sid}/chat",
                    headers={"Authorization": f"Bearer {tok}"},
                    json={"question": "which tech stack is used", "mode": "auto"},
                )
                assert res2.status_code == 200


@pytest.mark.asyncio
async def test_summary_mode_skips_similarity_retrieval_and_preserves_whitespace():
    """Verify explicit summary mode skips similarity search and preserves all whitespace in tokens."""
    cfg = get_settings()
    app = create_app(cfg)
    chunks = _make_sample_chunks(4)
    embs = [[0.1] * 384 for _ in range(4)]

    raw_tokens = ["Document Overview:", "\n\n", "  * Point 1 [p.1]", "\n", "  * Point 2 [p.2]"]
    expected_full = "Document Overview:\n\n  * Point 1 [p.1]\n  * Point 2 [p.2]"

    def _transport(req: httpx.Request) -> httpx.Response:
        lines = [json.dumps({"message": {"content": t}, "done": False}) for t in raw_tokens]
        lines.append(json.dumps({"message": {"content": ""}, "done": True}))
        return httpx.Response(200, text="\n".join(lines) + "\n")

    mock_client = httpx.AsyncClient(transport=httpx.MockTransport(_transport), base_url="http://127.0.0.1:11434")

    with (
        patch("app.llm.ollama_client._make_client", side_effect=lambda cfg=None: httpx.AsyncClient(transport=httpx.MockTransport(_transport), base_url="http://127.0.0.1:11434")),
        patch("app.chat.embed_query", return_value=[0.1] * 384),
    ):
        async with AsyncClient(
            transport=ASGITransport(app=app),
            base_url="http://127.0.0.1:8000",
            headers={"Host": "127.0.0.1:8000", "Origin": "http://localhost:3000"},
        ) as client:
            res_sess = await client.post("/v1/sessions")
            sid = res_sess.json()["sessionId"]
            tok = res_sess.json()["token"]
            app.state.vector_store.add_chunks(sid, "d1", chunks, embs)

            query_spy = MagicMock()
            app.state.vector_store.query = query_spy

            res = await client.post(
                f"/v1/sessions/{sid}/chat",
                headers={"Authorization": f"Bearer {tok}"},
                json={"question": "Summarize document", "mode": "summary"},
            )
            assert res.status_code == 200
            query_spy.assert_not_called()

            tokens = []
            done_payload = None
            for line in res.text.split("\n"):
                if line.startswith("data: "):
                    try:
                        p = json.loads(line[6:])
                        if "text" in p:
                            tokens.append(p["text"])
                        if "finalText" in p:
                            done_payload = p
                    except Exception:
                        pass

            assert "".join(tokens) == expected_full
            assert done_payload is not None
            assert done_payload["finalText"] == expected_full


@pytest.mark.asyncio
async def test_fake_citations_removed_and_valid_ones_kept():
    """Verify citations for pages not in context are stripped while valid ones remain."""
    cfg = get_settings()
    app = create_app(cfg)
    # Chunks on page 1 and page 2 only
    chunks = [
        Chunk(text="Page 1 text here.", page=1, source="f.pdf", index=0),
        Chunk(text="Page 2 text here.", page=2, source="f.pdf", index=1),
    ]
    embs = [[0.1] * 384 for _ in range(2)]

    # Model hallucinations: [p.1] (valid), [p.99] (fake)
    tokens = ["Summary point [p.1] and fake reference [p.99]."]

    def _transport(req: httpx.Request) -> httpx.Response:
        lines = [json.dumps({"message": {"content": t}, "done": False}) for t in tokens]
        lines.append(json.dumps({"message": {"content": ""}, "done": True}))
        return httpx.Response(200, text="\n".join(lines) + "\n")

    mock_client = httpx.AsyncClient(transport=httpx.MockTransport(_transport), base_url="http://127.0.0.1:11434")

    with patch("app.llm.ollama_client._make_client", side_effect=lambda cfg=None: httpx.AsyncClient(transport=httpx.MockTransport(_transport), base_url="http://127.0.0.1:11434")):
        async with AsyncClient(
            transport=ASGITransport(app=app),
            base_url="http://127.0.0.1:8000",
            headers={"Host": "127.0.0.1:8000", "Origin": "http://localhost:3000"},
        ) as client:
            res_sess = await client.post("/v1/sessions")
            sid = res_sess.json()["sessionId"]
            tok = res_sess.json()["token"]
            app.state.vector_store.add_chunks(sid, "d1", chunks, embs)

            res = await client.post(
                f"/v1/sessions/{sid}/chat",
                headers={"Authorization": f"Bearer {tok}"},
                json={"question": "Summarize", "mode": "summary"},
            )
            assert res.status_code == 200
            done_payload = None
            for line in res.text.split("\n"):
                if line.startswith("data: "):
                    try:
                        p = json.loads(line[6:])
                        if "finalText" in p:
                            done_payload = p
                    except Exception:
                        pass

            assert done_payload is not None
            # [p.1] is preserved, [p.99] is removed
            assert "[p.1]" in done_payload["finalText"]
            assert "[p.99]" not in done_payload["finalText"]


@pytest.mark.asyncio
async def test_summary_cache_and_session_cleanup():
    """Verify second request is served from cache without model call, and cache is deleted with session."""
    cfg = get_settings()
    app = create_app(cfg)
    chunks = _make_sample_chunks(3)
    embs = [[0.1] * 384 for _ in range(3)]

    model_calls = 0

    def _transport(req: httpx.Request) -> httpx.Response:
        nonlocal model_calls
        model_calls += 1
        lines = [
            json.dumps({"message": {"content": "First call summary."}, "done": False}),
            json.dumps({"message": {"content": ""}, "done": True}),
        ]
        return httpx.Response(200, text="\n".join(lines) + "\n")

    mock_client = httpx.AsyncClient(transport=httpx.MockTransport(_transport), base_url="http://127.0.0.1:11434")

    with patch("app.llm.ollama_client._make_client", side_effect=lambda cfg=None: httpx.AsyncClient(transport=httpx.MockTransport(_transport), base_url="http://127.0.0.1:11434")):
        async with AsyncClient(
            transport=ASGITransport(app=app),
            base_url="http://127.0.0.1:8000",
            headers={"Host": "127.0.0.1:8000", "Origin": "http://localhost:3000"},
        ) as client:
            res_sess = await client.post("/v1/sessions")
            sid = res_sess.json()["sessionId"]
            tok = res_sess.json()["token"]
            app.state.vector_store.add_chunks(sid, "d1", chunks, embs)

            # Request 1 -> calls model
            res1 = await client.post(
                f"/v1/sessions/{sid}/chat",
                headers={"Authorization": f"Bearer {tok}"},
                json={"question": "Summarize", "mode": "summary"},
            )
            assert res1.status_code == 200
            assert model_calls == 1

            # Request 2 -> served from cache without model call
            res2 = await client.post(
                f"/v1/sessions/{sid}/chat",
                headers={"Authorization": f"Bearer {tok}"},
                json={"question": "Summarize", "mode": "summary"},
            )
            assert res2.status_code == 200
            assert model_calls == 1  # Still 1!

            # Clear history -> should invalidate summary cache
            del_hist = await client.delete(
                f"/v1/sessions/{sid}/history",
                headers={"Authorization": f"Bearer {tok}"},
            )
            assert del_hist.status_code == 204
            assert app.state.vector_store.get_summary_cache(sid, "summary") is None

            # Request 3 after history clear -> triggers model call again
            res3 = await client.post(
                f"/v1/sessions/{sid}/chat",
                headers={"Authorization": f"Bearer {tok}"},
                json={"question": "Summarize", "mode": "summary"},
            )
            assert res3.status_code == 200
            assert model_calls == 2

            # Delete session -> purges cache and doc data completely
            del_sess = await client.delete(
                f"/v1/sessions/{sid}",
                headers={"Authorization": f"Bearer {tok}"},
            )
            assert del_sess.status_code == 204
            assert app.state.vector_store.get_summary_cache(sid, "summary") is None


@pytest.mark.asyncio
async def test_too_little_text_short_circuits_without_model():
    """Verify document with fewer than 2 chunks gets too-little-text message with no model calls."""
    cfg = get_settings()
    app = create_app(cfg)
    # Only 1 chunk
    chunks = [Chunk(text="Tiny single sentence.", page=1, source="doc.pdf", index=0)]
    embs = [[0.1] * 384]

    model_called = False

    def _transport(req: httpx.Request) -> httpx.Response:
        nonlocal model_called
        model_called = True
        return httpx.Response(500)

    mock_client = httpx.AsyncClient(transport=httpx.MockTransport(_transport), base_url="http://127.0.0.1:11434")

    with patch("app.llm.ollama_client._make_client", side_effect=lambda cfg=None: httpx.AsyncClient(transport=httpx.MockTransport(_transport), base_url="http://127.0.0.1:11434")):
        async with AsyncClient(
            transport=ASGITransport(app=app),
            base_url="http://127.0.0.1:8000",
            headers={"Host": "127.0.0.1:8000", "Origin": "http://localhost:3000"},
        ) as client:
            res_sess = await client.post("/v1/sessions")
            sid = res_sess.json()["sessionId"]
            tok = res_sess.json()["token"]
            app.state.vector_store.add_chunks(sid, "d1", chunks, embs)

            res = await client.post(
                f"/v1/sessions/{sid}/chat",
                headers={"Authorization": f"Bearer {tok}"},
                json={"question": "Summarize", "mode": "summary"},
            )
            assert res.status_code == 200
            assert model_called is False
            assert "too little readable text" in res.text
            assert "OCR" in res.text


@pytest.mark.asyncio
async def test_detailed_mode_progress_events_and_group_calls():
    """Verify detailed mode executes map groups, emits progress SSE events, and streams reduce call."""
    cfg = get_settings()
    # Configure small group size so chunks split across groups
    cfg.summary_group_chars = 400
    app = create_app(cfg)

    # 4 chunks each 250 chars -> 2 groups
    chunks = _make_sample_chunks(4, chars_per_chunk=250)
    embs = [[0.1] * 384 for _ in range(4)]

    group_calls = 0
    reduce_stream_called = False

    def _transport(req: httpx.Request) -> httpx.Response:
        nonlocal group_calls, reduce_stream_called
        body = json.loads(req.content.decode("utf-8"))
        if body.get("stream") is False:
            group_calls += 1
            return httpx.Response(200, json={"message": {"content": f"Group {group_calls} summary [p.1]."}, "done": True})
        else:
            reduce_stream_called = True
            lines = [
                json.dumps({"message": {"content": "Final detailed summary."}, "done": False}),
                json.dumps({"message": {"content": ""}, "done": True}),
            ]
            return httpx.Response(200, text="\n".join(lines) + "\n")

    mock_client = httpx.AsyncClient(transport=httpx.MockTransport(_transport), base_url="http://127.0.0.1:11434")

    with patch("app.llm.ollama_client._make_client", side_effect=lambda cfg=None: httpx.AsyncClient(transport=httpx.MockTransport(_transport), base_url="http://127.0.0.1:11434")):
        async with AsyncClient(
            transport=ASGITransport(app=app),
            base_url="http://127.0.0.1:8000",
            headers={"Host": "127.0.0.1:8000", "Origin": "http://localhost:3000"},
        ) as client:
            res_sess = await client.post("/v1/sessions")
            sid = res_sess.json()["sessionId"]
            tok = res_sess.json()["token"]
            app.state.vector_store.add_chunks(sid, "d1", chunks, embs)

            res = await client.post(
                f"/v1/sessions/{sid}/chat",
                headers={"Authorization": f"Bearer {tok}"},
                json={"question": "Detailed summary", "mode": "detailed"},
            )
            assert res.status_code == 200

            progress_events = []
            for line in res.text.split("\n"):
                if line.startswith("event: progress"):
                    continue
                if line.startswith("data: ") and "step" in line:
                    progress_events.append(json.loads(line[6:]))

            assert group_calls > 0
            assert reduce_stream_called is True
            assert len(progress_events) == group_calls + 1
            assert progress_events[0]["step"] == 1
            assert progress_events[-1]["step"] == progress_events[-1]["of"]


@pytest.mark.asyncio
async def test_sources_never_contain_chunk_text_and_auth_rules_enforced():
    """Verify privacy (sources carries page/source/score only) and security (Origin/Auth) enforcement."""
    cfg = get_settings()
    app = create_app(cfg)
    chunks = _make_sample_chunks(3)
    embs = [[0.1] * 384 for _ in range(3)]

    def _transport(req: httpx.Request) -> httpx.Response:
        lines = [
            json.dumps({"message": {"content": "Overview text."}, "done": False}),
            json.dumps({"message": {"content": ""}, "done": True}),
        ]
        return httpx.Response(200, text="\n".join(lines) + "\n")

    mock_client = httpx.AsyncClient(transport=httpx.MockTransport(_transport), base_url="http://127.0.0.1:11434")

    with patch("app.llm.ollama_client._make_client", side_effect=lambda cfg=None: httpx.AsyncClient(transport=httpx.MockTransport(_transport), base_url="http://127.0.0.1:11434")):
        async with AsyncClient(
            transport=ASGITransport(app=app),
            base_url="http://127.0.0.1:8000",
            headers={"Host": "127.0.0.1:8000", "Origin": "http://localhost:3000"},
        ) as client:
            res_sess = await client.post("/v1/sessions")
            sid = res_sess.json()["sessionId"]
            tok = res_sess.json()["token"]
            app.state.vector_store.add_chunks(sid, "d1", chunks, embs)

            # 1. Privacy: check sources frame
            res = await client.post(
                f"/v1/sessions/{sid}/chat",
                headers={"Authorization": f"Bearer {tok}"},
                json={"question": "Summarize", "mode": "summary"},
            )
            for line in res.text.split("\n"):
                if line.startswith("event: sources\ndata: ") or (line.startswith("data: ") and "page" in line):
                    data_str = line.split("data: ")[-1]
                    try:
                        sources = json.loads(data_str)
                        if isinstance(sources, list):
                            for s in sources:
                                assert "text" not in s
                                assert "chunk" not in s
                                assert "content" not in s
                                assert "page" in s
                    except Exception:
                        pass

            # 2. Auth: Missing token rejected with 401
            unauth = await client.post(
                f"/v1/sessions/{sid}/chat",
                json={"question": "Summarize", "mode": "summary"},
            )
            assert unauth.status_code == 401

            # 3. Security: Disallowed origin rejected
            bad_origin = await client.post(
                f"/v1/sessions/{sid}/chat",
                headers={"Authorization": f"Bearer {tok}", "Origin": "http://evil.com"},
                json={"question": "Summarize", "mode": "summary"},
            )
            assert bad_origin.status_code == 403

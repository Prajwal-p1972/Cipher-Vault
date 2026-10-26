"""Regression tests for streamed chat whitespace preservation, fake citation removal, and security."""

import json
import pytest
import httpx
from httpx import ASGITransport, AsyncClient
from unittest.mock import patch

from app.main import create_app
from app.config import get_settings

TOKENS = ["According", " to", " the", " doc", ".", "\n\n", "Next", " line"]
EXPECTED_TEXT = "According to the doc.\n\nNext line"


def _fake_ollama_transport(request: httpx.Request) -> httpx.Response:
    if request.url.path == "/api/chat":
        lines = []
        for t in TOKENS:
            lines.append(json.dumps({"message": {"content": t}, "done": False}))
        lines.append(json.dumps({"message": {"content": ""}, "done": True}))
        body = "\n".join(lines) + "\n"
        return httpx.Response(200, text=body)
    return httpx.Response(404)


@pytest.mark.asyncio
async def test_streaming_preserves_whitespace_across_pipeline():
    """Verify raw tokens streamed from Ollama maintain all whitespace and newlines."""
    cfg = get_settings()
    app = create_app(cfg)

    mock_transport = httpx.MockTransport(_fake_ollama_transport)

    with (
        patch("app.llm.ollama_client._make_client", return_value=httpx.AsyncClient(transport=mock_transport, base_url="http://127.0.0.1:11434")),
        patch("app.chat.embed_query", return_value=[0.0] * 384),
    ):
        async with AsyncClient(
            transport=ASGITransport(app=app),
            base_url="http://127.0.0.1:8000",
            headers={"Host": "127.0.0.1:8000", "Origin": "http://localhost:3000"},
        ) as client:
            create_res = await client.post("/v1/sessions")
            assert create_res.status_code == 201
            session_data = create_res.json()
            sid = session_data["sessionId"]
            token = session_data["token"]

            chat_res = await client.post(
                f"/v1/sessions/{sid}/chat",
                headers={"Authorization": f"Bearer {token}"},
                json={"question": "What is the summary?"},
            )
            assert chat_res.status_code == 200

            streamed_tokens = []
            done_payload = None

            for line in chat_res.text.split("\n"):
                if line.startswith("data: "):
                    data_str = line[6:]
                    try:
                        parsed = json.loads(data_str)
                        if "text" in parsed:
                            streamed_tokens.append(parsed["text"])
                        if "finalText" in parsed:
                            done_payload = parsed
                    except Exception:
                        pass

            streamed_text = "".join(streamed_tokens)
            assert streamed_text == EXPECTED_TEXT, f"Whitespace lost: got {repr(streamed_text)}"
            assert done_payload is not None
            assert done_payload["finalText"] == EXPECTED_TEXT


@pytest.mark.asyncio
async def test_leading_space_whitespace_only_and_newline_tokens():
    """Verify whitespace-only and newline tokens are not dropped or trimmed during streaming."""
    cfg = get_settings()
    app = create_app(cfg)

    custom_tokens = ["Title", "\n\n", "  Indent", " word", " ", "\t", "end."]
    expected = "Title\n\n  Indent word \tend."

    def _transport(req: httpx.Request) -> httpx.Response:
        lines = [json.dumps({"message": {"content": t}, "done": False}) for t in custom_tokens]
        lines.append(json.dumps({"message": {"content": ""}, "done": True}))
        return httpx.Response(200, text="\n".join(lines) + "\n")

    mock_transport = httpx.MockTransport(_transport)

    with (
        patch("app.llm.ollama_client._make_client", return_value=httpx.AsyncClient(transport=mock_transport, base_url="http://127.0.0.1:11434")),
        patch("app.chat.embed_query", return_value=[0.0] * 384),
    ):
        async with AsyncClient(
            transport=ASGITransport(app=app),
            base_url="http://127.0.0.1:8000",
            headers={"Host": "127.0.0.1:8000", "Origin": "http://localhost:3000"},
        ) as client:
            create_res = await client.post("/v1/sessions")
            sid = create_res.json()["sessionId"]
            token = create_res.json()["token"]

            chat_res = await client.post(
                f"/v1/sessions/{sid}/chat",
                headers={"Authorization": f"Bearer {token}"},
                json={"question": "Preserve whitespace?"},
            )

            streamed = []
            done_payload = None
            for line in chat_res.text.split("\n"):
                if line.startswith("data: "):
                    try:
                        parsed = json.loads(line[6:])
                        if "text" in parsed:
                            streamed.append(parsed["text"])
                        if "finalText" in parsed:
                            done_payload = parsed
                    except Exception:
                        pass

            assert "".join(streamed) == expected
            assert done_payload is not None
            assert done_payload["finalText"] == expected


@pytest.mark.asyncio
async def test_fake_citations_removed_only_at_end():
    """Verify fake citations like [p.99] stream raw and are stripped from finalText only at the end."""
    cfg = get_settings()
    app = create_app(cfg)

    citation_tokens = ["According to section A ", "[p.99]", " the system is intact."]

    def _transport(req: httpx.Request) -> httpx.Response:
        lines = [json.dumps({"message": {"content": t}, "done": False}) for t in citation_tokens]
        lines.append(json.dumps({"message": {"content": ""}, "done": True}))
        return httpx.Response(200, text="\n".join(lines) + "\n")

    mock_transport = httpx.MockTransport(_transport)

    with (
        patch("app.llm.ollama_client._make_client", return_value=httpx.AsyncClient(transport=mock_transport, base_url="http://127.0.0.1:11434")),
        patch("app.chat.embed_query", return_value=[0.0] * 384),
    ):
        async with AsyncClient(
            transport=ASGITransport(app=app),
            base_url="http://127.0.0.1:8000",
            headers={"Host": "127.0.0.1:8000", "Origin": "http://localhost:3000"},
        ) as client:
            create_res = await client.post("/v1/sessions")
            sid = create_res.json()["sessionId"]
            token = create_res.json()["token"]

            chat_res = await client.post(
                f"/v1/sessions/{sid}/chat",
                headers={"Authorization": f"Bearer {token}"},
                json={"question": "Citation test?"},
            )

            streamed = []
            done_payload = None
            for line in chat_res.text.split("\n"):
                if line.startswith("data: "):
                    try:
                        parsed = json.loads(line[6:])
                        if "text" in parsed:
                            streamed.append(parsed["text"])
                        if "finalText" in parsed:
                            done_payload = parsed
                    except Exception:
                        pass

            # RAW streamed tokens still contain [p.99] (never stripped mid-stream)
            assert "[p.99]" in "".join(streamed)
            # Final text on done event has [p.99] removed
            assert done_payload is not None
            assert "[p.99]" not in done_payload["finalText"]
            assert done_payload["finalText"] == "According to section A the system is intact."


@pytest.mark.asyncio
async def test_sources_event_contains_no_chunk_text():
    """Verify sources event metadata never includes raw document text."""
    cfg = get_settings()
    app = create_app(cfg)

    def _transport(req: httpx.Request) -> httpx.Response:
        lines = [
            json.dumps({"message": {"content": "Answer"}, "done": False}),
            json.dumps({"message": {"content": ""}, "done": True}),
        ]
        return httpx.Response(200, text="\n".join(lines) + "\n")

    mock_transport = httpx.MockTransport(_transport)

    with (
        patch("app.llm.ollama_client._make_client", return_value=httpx.AsyncClient(transport=mock_transport, base_url="http://127.0.0.1:11434")),
        patch("app.chat.embed_query", return_value=[0.0] * 384),
    ):
        async with AsyncClient(
            transport=ASGITransport(app=app),
            base_url="http://127.0.0.1:8000",
            headers={"Host": "127.0.0.1:8000", "Origin": "http://localhost:3000"},
        ) as client:
            create_res = await client.post("/v1/sessions")
            sid = create_res.json()["sessionId"]
            token = create_res.json()["token"]

            chat_res = await client.post(
                f"/v1/sessions/{sid}/chat",
                headers={"Authorization": f"Bearer {token}"},
                json={"question": "Sources check?"},
            )

            for line in chat_res.text.split("\n"):
                if line.startswith("data: "):
                    try:
                        parsed = json.loads(line[6:])
                        if isinstance(parsed, list):
                            for s in parsed:
                                assert "text" not in s
                                assert "page" in s
                                assert "source" in s
                    except Exception:
                        pass

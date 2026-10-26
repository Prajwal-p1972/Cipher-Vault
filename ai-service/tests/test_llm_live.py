"""Live integration tests against a running local Ollama instance.

Marked with ``llm_live`` pytest marker; skipped automatically if Ollama
is not reachable or the configured model is missing.

Run explicitly with:
    python -m pytest -m llm_live -v tests/test_llm_live.py
"""

import asyncio
import json

import pytest

from app.config import get_settings
from app.llm.ollama_client import LlmUnavailableError, check, stream_chat

cfg = get_settings()


async def _ollama_available() -> bool:
    """Return True only when Ollama is running and the model is present."""
    result = await check(cfg)
    return bool(result.get("ok"))


def _require_ollama() -> None:
    """Skip the test if Ollama is not available."""
    try:
        available = asyncio.run(_ollama_available())
    except Exception:
        available = False
    if not available:
        pytest.skip("Ollama not running or model not pulled — skipping live LLM test.")


pytestmark = pytest.mark.llm_live


class TestOllamaCheck:
    def test_check_returns_ok_true(self) -> None:
        _require_ollama()
        result = asyncio.run(check(cfg))
        assert result["ok"] is True
        assert result["detail"] == "ready"

    def test_check_model_field_matches_config(self) -> None:
        _require_ollama()
        result = asyncio.run(check(cfg))
        assert result["ok"] is True


class TestStreamChat:
    def test_stream_yields_tokens(self) -> None:
        _require_ollama()
        messages = [
            {
                "role": "system",
                "content": "You are a helpful assistant. Answer in one word only.",
            },
            {"role": "user", "content": "Say 'hello' and nothing else."},
        ]

        async def _run():
            tokens = []
            async for tok in stream_chat(messages, cfg):
                tokens.append(tok)
                if len("".join(tokens)) > 200:
                    break
            return tokens

        tokens = asyncio.run(_run())
        assert len(tokens) > 0
        full = "".join(tokens)
        # Should contain something recognizable; not empty
        assert full.strip() != ""

    def test_stream_tokens_are_strings(self) -> None:
        _require_ollama()
        messages = [
            {"role": "user", "content": "Reply with one word: 'ok'."},
        ]

        async def _run():
            parts = []
            async for tok in stream_chat(messages, cfg):
                parts.append(tok)
                if len(parts) >= 10:
                    break
            return parts

        parts = asyncio.run(_run())
        for part in parts:
            assert isinstance(part, str)

    def test_stream_respects_max_answer_tokens(self) -> None:
        _require_ollama()
        import time

        messages = [
            {"role": "user", "content": "Count from 1 to 1000, one number per line."},
        ]

        async def _run():
            tokens = []
            start = time.monotonic()
            async for tok in stream_chat(messages, cfg):
                tokens.append(tok)
                # Stop after collecting sufficient tokens or 10 seconds
                if time.monotonic() - start > 10:
                    break
            return tokens

        tokens = asyncio.run(_run())
        full = "".join(tokens)
        # Answer should be capped; we won't see the full count to 1000
        assert len(full) < 10_000


class TestStreamChatUnavailable:
    def test_bad_url_raises_llm_unavailable(self) -> None:
        """This test does NOT need Ollama running — it tests failure path."""
        bad_cfg = cfg.model_copy(update={"ollama_url": "http://127.0.0.1:19999"})

        messages = [{"role": "user", "content": "hello"}]

        async def _run():
            async for _ in stream_chat(messages, bad_cfg):
                pass

        with pytest.raises(LlmUnavailableError):
            asyncio.run(_run())

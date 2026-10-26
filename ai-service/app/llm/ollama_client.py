"""Async httpx client for local Ollama chat completion API."""

import logging
from collections.abc import AsyncIterator
from typing import Any

import httpx

from app.config import Settings, get_settings

logger = logging.getLogger(__name__)


class LlmUnavailableError(Exception):
    """Raised when the local Ollama process cannot be reached or returns a server error."""

    def __init__(self, message: str = "LLM service unavailable.") -> None:
        super().__init__(message)


def _make_client(cfg: Settings) -> httpx.AsyncClient:
    """Construct a locked-down async httpx client for the local Ollama API."""
    return httpx.AsyncClient(
        base_url=cfg.ollama_url,
        timeout=httpx.Timeout(
            connect=5.0,
            read=float(cfg.llm_timeout_seconds),
            write=10.0,
            pool=5.0,
        ),
        follow_redirects=False,
        trust_env=False,
    )


async def check(cfg: Settings | None = None) -> dict[str, Any]:
    """Probe Ollama health and confirm the configured model is present.

    Returns a dict with keys ``ok`` (bool) and ``detail`` (str).
    Never raises; connection failures are caught and returned as ``ok=False``.
    """
    cfg = cfg or get_settings()
    try:
        async with _make_client(cfg) as client:
            resp = await client.get("/api/tags")
            if resp.status_code != 200:
                return {"ok": False, "detail": f"Ollama returned HTTP {resp.status_code}"}
            data: dict[str, Any] = resp.json()
            model_names: list[str] = [
                m.get("name", "").split(":")[0]
                for m in data.get("models", [])
            ]
            model_base = cfg.llm_model.split(":")[0]
            if model_base not in model_names:
                return {
                    "ok": False,
                    "detail": (
                        f"Model '{cfg.llm_model}' not found in Ollama. "
                        f"Run: ollama pull {cfg.llm_model}"
                    ),
                }
            return {"ok": True, "detail": "ready"}
    except httpx.ConnectError:
        return {"ok": False, "detail": "Cannot connect to Ollama — is it running?"}
    except httpx.TimeoutException:
        return {"ok": False, "detail": "Ollama health check timed out."}
    except Exception as exc:  # noqa: BLE001
        logger.warning("LLM check failed: %s", type(exc).__name__)
        return {"ok": False, "detail": "LLM health check failed."}


async def stream_chat(
    messages: list[dict[str, str]],
    cfg: Settings | None = None,
) -> AsyncIterator[str]:
    """Stream raw text tokens from the Ollama /api/chat endpoint.

    Each yielded string is one incremental content token.
    Raises :class:`LlmUnavailableError` on connection or server errors.
    Never yields prompt text, system content, or log it.
    """
    cfg = cfg or get_settings()
    payload: dict[str, Any] = {
        "model": cfg.llm_model,
        "messages": messages,
        "stream": True,
        "options": {
            "num_ctx": cfg.llm_num_ctx,
            "temperature": cfg.llm_temperature,
            "num_predict": cfg.llm_max_answer_tokens,
        },
    }
    try:
        async with _make_client(cfg) as client:
            async with client.stream("POST", "/api/chat", json=payload) as resp:
                if resp.status_code != 200:
                    raise LlmUnavailableError(
                        f"Ollama returned HTTP {resp.status_code}."
                    )
                async for line in resp.aiter_lines():
                    if not line:
                        continue
                    try:
                        import json
                        chunk: dict[str, Any] = json.loads(line)
                    except ValueError:
                        continue
                    token: str = chunk.get("message", {}).get("content", "")
                    if token:
                        yield token
                    if chunk.get("done", False):
                        break
    except LlmUnavailableError:
        raise
    except httpx.ConnectError as exc:
        raise LlmUnavailableError("Cannot connect to Ollama — is it running?") from exc
    except httpx.TimeoutException as exc:
        raise LlmUnavailableError("Ollama request timed out.") from exc
    except Exception as exc:  # noqa: BLE001
        logger.warning("LLM stream error: %s", type(exc).__name__)
        raise LlmUnavailableError("LLM stream failed unexpectedly.") from exc

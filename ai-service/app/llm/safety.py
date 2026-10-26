"""Input validation and output sanitisation for the LLM chat pipeline."""

import re
import unicodedata

from app.config import Settings, get_settings

# Patterns that indicate a user is trying to hijack the LLM or exfiltrate rules
_INJECTION_PATTERNS: list[re.Pattern[str]] = [
    re.compile(r"\bignore\s+(all\s+)?(previous|above|prior)\b", re.IGNORECASE),
    re.compile(r"\bforget\s+(all\s+)?(previous|above|prior)\b", re.IGNORECASE),
    re.compile(r"\bact\s+as\b.{0,40}\bAI\b", re.IGNORECASE),
    re.compile(r"\byou\s+are\s+now\b", re.IGNORECASE),
    re.compile(r"\bdo\s+not\s+follow\b.{0,40}\brules\b", re.IGNORECASE),
    re.compile(r"\brepeat\s+(after\s+me|the\s+system)\b", re.IGNORECASE),
    re.compile(r"\bsystem\s+prompt\b", re.IGNORECASE),
    re.compile(r"\breveal\s+(your\s+)?(instructions|prompt|token|key)\b", re.IGNORECASE),
    re.compile(r"\bprint\s+(your\s+)?(instructions|prompt|token|key)\b", re.IGNORECASE),
    re.compile(r"<\|.*?\|>"),       # LLM control tokens e.g. <|im_start|>
    re.compile(r"\[INST\]|\[/INST\]"),  # Llama-2 instruction tokens
]

# Maximum consecutive repeated characters (guards against garbled / junk input)
_MAX_CHAR_RUN = 40
_CHAR_RUN_PATTERN = re.compile(r"(.)\1{" + str(_MAX_CHAR_RUN) + r",}")

# Strip C0/C1 control characters except whitespace from answers
_CONTROL_CHARS_PATTERN = re.compile(
    r"[\x00-\x08\x0b\x0c\x0e-\x1f\x7f-\x9f]"
)

# Strip fake/hallucinated inline citations e.g. [p.99] or [p. 1]
_FAKE_CITATION_PATTERN = re.compile(
    r"\s*\[p\.\s*\d+\]",
    re.IGNORECASE,
)


def _normalize(text: str) -> str:
    """NFC-normalize and strip leading/trailing whitespace."""
    return unicodedata.normalize("NFC", text).strip()


def is_question_valid(question: str, cfg: Settings | None = None) -> tuple[bool, str]:
    """Validate a user question before it enters the LLM pipeline.

    Returns:
        (True, "") if the question is acceptable.
        (False, reason) if it should be rejected.
    """
    cfg = cfg or get_settings()
    normalized = _normalize(question)

    if not normalized:
        return False, "Question must not be empty."

    if len(normalized) > cfg.max_question_chars:
        return False, f"Question exceeds {cfg.max_question_chars} character limit."

    if _CHAR_RUN_PATTERN.search(normalized):
        return False, "Question contains excessive repeated characters."

    for pattern in _INJECTION_PATTERNS:
        if pattern.search(normalized):
            return False, "Question rejected: possible prompt injection."

    return True, ""


def sanitize_answer(text: str) -> str:
    """Remove control characters, fake citation tags, and NFC-normalize an LLM answer.

    Does not truncate or alter semantic content; only strips characters that could
    cause UI injection, terminal escapes, or hallucinated citation markers.
    """
    cleaned = _CONTROL_CHARS_PATTERN.sub("", text)
    cleaned = _FAKE_CITATION_PATTERN.sub("", cleaned)
    return _normalize(cleaned)

"""Query intent classification for distinguishing whole-document vs factoid retrieval questions."""

import difflib
import re

_SUMMARY_KEYWORDS: list[str] = [
    "overview",
    "summary",
    "summarize",
    "summarise",
    "outline",
    "gist",
    "synopsis",
    "recap",
]

# Regex patterns matching broad / whole-document queries
_GLOBAL_REGEX_PATTERNS: list[re.Pattern[str]] = [
    re.compile(r"\b(summary|overview|outline|gist|tl;?dr|synopsis|recap|summarize|summarise)\b", re.IGNORECASE),
    re.compile(r"\b(whole|entire|complete|all\s+pages)\b", re.IGNORECASE),
    re.compile(r"\bwhat\s+is\s+this\s+(document|doc|pdf|file|paper|text)\s+about\b", re.IGNORECASE),
    re.compile(r"\b(main|key)\s+(points|topics|takeaways|findings|aspects|themes)\b", re.IGNORECASE),
]


def is_global_question(question: str) -> bool:
    """Classify whether a user query requires broad whole-document synthesis.

    Combines regex pattern detection with typo tolerance on core summary keywords.
    Never logs document text or user questions.

    Returns:
        True if the question asks for a broad summary or overview, False for focused retrieval.
    """
    if not question or not isinstance(question, str):
        return False

    q_lower = question.strip().lower()
    if not q_lower:
        return False

    # 1. Regex pattern check
    for pattern in _GLOBAL_REGEX_PATTERNS:
        if pattern.search(q_lower):
            return True

    # 2. Typo-tolerant keyword check across word tokens
    words = re.findall(r"\b[a-zA-Z]{3,}\b", q_lower)
    for word in words:
        matches = difflib.get_close_matches(word, _SUMMARY_KEYWORDS, n=1, cutoff=0.8)
        if matches:
            return True

    return False

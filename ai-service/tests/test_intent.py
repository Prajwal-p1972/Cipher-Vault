"""Unit tests for query intent classification (whole-document summary vs targeted retrieval)."""

import pytest
from app.intent import is_global_question

GLOBAL_QUESTIONS_TRUE = [
    # Required base cases
    "analyze whole document and tellme shoert overview",
    "give me a sumary",
    "what is this pdf about",
    # 10 additional cases
    "can you summarize the entire document",
    "give me the key points of this doc",
    "provide an outline of the paper",
    "what are the main topics discussed",
    "brief synopsis please",
    "give me a quick recap",
    "tl;dr of the document",
    "can i get a shoert overveiw",
    "give me the gist of this file",
    "what is this document about",
]

GLOBAL_QUESTIONS_FALSE = [
    # Required base cases
    "which tech stack is used",
    "what is the lockout policy",
    "document title",
    # 10 additional cases
    "what database is configured",
    "how many failed attempts trigger a lockout",
    "who authored section 3",
    "what is the PBKDF2 iteration count",
    "show me the token expiration timeout",
    "where is the private key stored",
    "what is the port number of the backend",
    "is redis used for ephemeral cache",
    "explain AES-256-GCM implementation",
    "what algorithm is used for password hashing",
]


@pytest.mark.parametrize("question", GLOBAL_QUESTIONS_TRUE)
def test_is_global_question_positive(question: str):
    """Verify broad/summary questions are classified as global."""
    assert is_global_question(question) is True, f"Expected True for: {question}"


@pytest.mark.parametrize("question", GLOBAL_QUESTIONS_FALSE)
def test_is_global_question_negative(question: str):
    """Verify specific factoid retrieval questions are NOT classified as global."""
    assert is_global_question(question) is False, f"Expected False for: {question}"


def test_is_global_question_empty_and_edge_cases():
    """Verify handling of empty or blank inputs."""
    assert is_global_question("") is False
    assert is_global_question("   ") is False
    assert is_global_question(None) is False  # type: ignore[arg-type]

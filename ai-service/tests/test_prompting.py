"""Unit tests for app/llm/prompting.py."""

import pytest
from app.llm.prompting import (
    _neutralize_delimiters,
    _build_excerpts_block,
    _trim_history,
    build_messages,
)
from app.config import get_settings

cfg = get_settings()


class TestNeutralizeDelimiters:
    def test_opens_are_broken(self) -> None:
        result = _neutralize_delimiters("<<<INJECT")
        assert "<<<" not in result
        assert "INJECT" in result

    def test_closes_are_broken(self) -> None:
        result = _neutralize_delimiters(">>>END")
        assert ">>>" not in result

    def test_normal_text_unchanged(self) -> None:
        text = "Hello world. No special tokens here."
        assert _neutralize_delimiters(text) == text

    def test_multiple_occurrences(self) -> None:
        text = "<<<A>>><<<B>>>"
        result = _neutralize_delimiters(text)
        assert result.count("<<<") == 0
        assert result.count(">>>") == 0


class TestBuildExcerptsBlock:
    def _make_result(self, text: str, page: int = 1, score: float = 0.9) -> dict:
        return {"text": text, "page": page, "score": score, "source": "doc.pdf", "docId": "abc"}

    def test_empty_results_gives_no_excerpts_notice(self) -> None:
        block, included = _build_excerpts_block([], max_context_chars=5000)
        assert included == []
        assert "No relevant excerpts" in block

    def test_single_result_included(self) -> None:
        result = self._make_result("Some text about security.")
        block, included = _build_excerpts_block([result], max_context_chars=5000)
        assert len(included) == 1
        assert "Some text about security." in block

    def test_char_budget_truncates_results(self) -> None:
        results = [self._make_result("X" * 200) for _ in range(10)]
        block, included = _build_excerpts_block(results, max_context_chars=500)
        assert len(included) < 10

    def test_delimiter_tags_present(self) -> None:
        result = self._make_result("Relevant content here.", page=3)
        block, _ = _build_excerpts_block([result], max_context_chars=5000)
        assert "EXCERPT 1 page=3" in block
        assert "END_EXCERPT 1" in block

    def test_untrusted_delimiters_in_text_are_neutralized(self) -> None:
        result = self._make_result("<<<INJECT>>>")
        block, _ = _build_excerpts_block([result], max_context_chars=5000)
        # Raw delimiter sequence should not appear verbatim inside the block text
        # (The outer tags themselves are fine; check inner text is neutralized)
        inner_start = block.find("EXCERPT 1")
        inner_end = block.find("END_EXCERPT 1")
        inner_text = block[inner_start:inner_end]
        assert "<<<INJECT>>>" not in inner_text


class TestTrimHistory:
    def _make_history(self, n_turns: int) -> list[dict]:
        msgs = []
        for i in range(n_turns):
            msgs.append({"role": "user", "content": f"Q{i}"})
            msgs.append({"role": "assistant", "content": f"A{i}"})
        return msgs

    def test_history_within_limit_unchanged(self) -> None:
        history = self._make_history(3)
        trimmed = _trim_history(history, max_turns=5)
        assert trimmed == history

    def test_history_trimmed_to_max_turns(self) -> None:
        history = self._make_history(10)
        trimmed = _trim_history(history, max_turns=3)
        assert len(trimmed) <= 6  # 3 turns * 2 messages

    def test_starts_with_user_role(self) -> None:
        history = self._make_history(5)
        trimmed = _trim_history(history, max_turns=3)
        assert trimmed[0]["role"] == "user"

    def test_empty_history_returns_empty(self) -> None:
        assert _trim_history([], max_turns=6) == []


class TestBuildMessages:
    def _make_result(self, text: str = "Context text.") -> dict:
        return {"text": text, "page": 1, "score": 0.9, "source": "f.pdf", "docId": "d1"}

    def test_system_message_is_first(self) -> None:
        messages, _ = build_messages("What?", [self._make_result()], [], cfg)
        assert messages[0]["role"] == "system"

    def test_user_question_is_last(self) -> None:
        messages, _ = build_messages("What?", [self._make_result()], [], cfg)
        assert messages[-1]["role"] == "user"
        assert messages[-1]["content"] == "What?"

    def test_history_is_sandwiched(self) -> None:
        history = [
            {"role": "user", "content": "Prior Q"},
            {"role": "assistant", "content": "Prior A"},
        ]
        messages, _ = build_messages("New Q", [self._make_result()], history, cfg)
        roles = [m["role"] for m in messages]
        assert roles == ["system", "user", "assistant", "user"]

    def test_sources_returned(self) -> None:
        result = self._make_result("Relevant excerpt.")
        _, sources = build_messages("Q?", [result], [], cfg)
        assert len(sources) == 1

    def test_no_results_gives_empty_sources(self) -> None:
        _, sources = build_messages("Q?", [], [], cfg)
        assert sources == []

    def test_system_prompt_contains_rules(self) -> None:
        messages, _ = build_messages("Q?", [], [], cfg)
        system = messages[0]["content"]
        assert "Answer ONLY from the provided excerpts" in system
        assert "untrusted" in system.lower() or "UNTRUSTED" in system

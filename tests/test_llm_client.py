import json
from unittest.mock import MagicMock
import pytest
from app.llm_client import LLMClient, LLMParseError
from app.models import LLMResumeScore


VALID_JSON = {
    "name": "张三", "school": "清华", "degree": "硕士",
    "major": "计算机", "grade_or_graduate_date": "2025",
    "available_duration": "6月+", "phone": "138****5678",
    "email": "a@b.c", "hard_pass": True,
    "ai_exp_score": 8, "ai_exp_reason": "X",
    "logic_score": 7, "logic_reason": "Y",
    "project_score": 6, "project_reason": "Z",
    "summary": "OK",
}


def _make_response(content: str) -> MagicMock:
    resp = MagicMock()
    resp.choices = [MagicMock()]
    resp.choices[0].message.content = content
    return resp


def test_score_resume_parses_valid_json():
    mock_openai = MagicMock()
    mock_openai.chat.completions.create.return_value = _make_response(
        json.dumps(VALID_JSON, ensure_ascii=False)
    )
    client = LLMClient(openai_client=mock_openai, model="test-model")
    score = client.score_resume(jd_text="jd", resume_text="resume")
    assert isinstance(score, LLMResumeScore)
    assert score.name == "张三"


def test_score_resume_strips_markdown_fences():
    wrapped = f"```json\n{json.dumps(VALID_JSON, ensure_ascii=False)}\n```"
    mock_openai = MagicMock()
    mock_openai.chat.completions.create.return_value = _make_response(wrapped)
    client = LLMClient(openai_client=mock_openai, model="test-model")
    score = client.score_resume(jd_text="jd", resume_text="r")
    assert score.name == "张三"


def test_score_resume_retries_once_on_bad_json():
    mock_openai = MagicMock()
    mock_openai.chat.completions.create.side_effect = [
        _make_response("this is not json"),
        _make_response(json.dumps(VALID_JSON, ensure_ascii=False)),
    ]
    client = LLMClient(openai_client=mock_openai, model="test-model")
    score = client.score_resume(jd_text="jd", resume_text="r")
    assert score.name == "张三"
    assert mock_openai.chat.completions.create.call_count == 2


def test_score_resume_raises_after_second_failure():
    mock_openai = MagicMock()
    mock_openai.chat.completions.create.return_value = _make_response("nope")
    client = LLMClient(openai_client=mock_openai, model="test-model")
    with pytest.raises(LLMParseError):
        client.score_resume(jd_text="jd", resume_text="r")
    assert mock_openai.chat.completions.create.call_count == 2


def test_summarize_interview_returns_text():
    mock_openai = MagicMock()
    mock_openai.chat.completions.create.return_value = _make_response(
        "综合判断：不错\n亮点:\n- A\n隐忧:\n- B\n推荐结论：推荐"
    )
    client = LLMClient(openai_client=mock_openai, model="test-model")
    out = client.summarize_interview(
        jd_text="jd", resume_summary="s",
        tech=4, product=3, learning=5, culture=4,
        observation="主动提问",
    )
    assert "推荐结论：推荐" in out

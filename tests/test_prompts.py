import pytest
from app.prompts import render_prompt


def test_render_resume_screening():
    p = render_prompt(
        "resume_screening",
        jd_text="JD 内容",
        resume_text="张三，清华大学",
    )
    assert "JD 内容" in p
    assert "张三" in p
    assert "hard_pass" in p


def test_render_interview_summary():
    p = render_prompt(
        "interview_summary",
        jd_text="JD",
        resume_summary="简历摘要",
        tech_score=4,
        product_score=3,
        learning_score=5,
        culture_score=4,
        observation="候选人主动提问",
    )
    assert "候选人主动提问" in p
    assert "技术理解：4" in p


def test_render_unknown_template():
    with pytest.raises(FileNotFoundError):
        render_prompt("nonexistent", foo="bar")


def test_missing_placeholder_raises():
    with pytest.raises(KeyError):
        render_prompt("resume_screening", jd_text="only jd")

import pytest
from pydantic import ValidationError
from app.models import LLMResumeScore


def test_valid_llm_resume_score():
    m = LLMResumeScore(
        name="张三",
        school="清华大学",
        degree="硕士",
        major="计算机",
        grade_or_graduate_date="2025 届",
        available_duration="6月+",
        phone="138****5678",
        email="zhang@x.com",
        hard_pass=True,
        ai_exp_score=8,
        ai_exp_reason="毕设做 RAG",
        logic_score=7,
        logic_reason="结构清晰",
        project_score=6,
        project_reason="demo 级",
        summary="亮点...隐忧...",
    )
    assert m.hard_pass
    assert m.ai_exp_score == 8


def test_score_out_of_range():
    with pytest.raises(ValidationError):
        LLMResumeScore(
            name="张三", school="清华", degree="硕士", major="计算机",
            grade_or_graduate_date="2025", available_duration="6月+",
            phone="138****5678", email="a@b.c",
            hard_pass=True,
            ai_exp_score=11,
            ai_exp_reason="", logic_score=5, logic_reason="",
            project_score=5, project_reason="", summary="",
        )


def test_degree_enum():
    with pytest.raises(ValidationError):
        LLMResumeScore(
            name="x", school="x", degree="小学",
            major="x", grade_or_graduate_date="x",
            available_duration="6月+", phone="x", email="a@b.c",
            hard_pass=True, ai_exp_score=5, ai_exp_reason="",
            logic_score=5, logic_reason="", project_score=5,
            project_reason="", summary="",
        )

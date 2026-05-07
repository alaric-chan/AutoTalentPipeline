from typing import Literal
from pydantic import BaseModel, Field


Degree = Literal["本科", "硕士", "博士"]
Duration = Literal["<3月", "3-6月", "6月+"]


class LLMResumeScore(BaseModel):
    """LLM 对一份简历的结构化输出契约。"""

    name: str
    school: str
    degree: Degree
    major: str
    grade_or_graduate_date: str
    available_duration: Duration
    phone: str
    email: str

    hard_pass: bool
    ai_exp_score: int = Field(ge=0, le=10)
    ai_exp_reason: str
    logic_score: int = Field(ge=0, le=10)
    logic_reason: str
    project_score: int = Field(ge=0, le=10)
    project_reason: str
    summary: str

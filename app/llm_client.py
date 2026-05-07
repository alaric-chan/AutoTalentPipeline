import json
import re
from typing import Optional
from loguru import logger
from pydantic import ValidationError
from openai import OpenAI
from app.config import get_settings
from app.models import LLMResumeScore
from app.prompts import render_prompt


class LLMParseError(Exception):
    """LLM 输出无法被解析为预期结构。"""


_FENCE_RE = re.compile(r"^```(?:json)?\s*|\s*```$", re.MULTILINE)


def _strip_fences(text: str) -> str:
    return _FENCE_RE.sub("", text).strip()


class LLMClient:
    def __init__(self, openai_client=None, model: Optional[str] = None):
        s = get_settings()
        self._client = openai_client or OpenAI(
            api_key=s.dashscope_api_key,
            base_url=s.dashscope_base_url,
        )
        self._model = model or s.dashscope_model

    def score_resume(self, *, jd_text: str, resume_text: str) -> LLMResumeScore:
        prompt = render_prompt(
            "resume_screening", jd_text=jd_text, resume_text=resume_text
        )
        last_err: Optional[Exception] = None
        for attempt in range(2):
            raw = self._chat(prompt)
            try:
                data = json.loads(_strip_fences(raw))
                return LLMResumeScore.model_validate(data)
            except (json.JSONDecodeError, ValidationError) as e:
                last_err = e
                logger.warning(
                    "LLM 响应解析失败 attempt={}: {}", attempt + 1, e
                )
        raise LLMParseError(f"LLM 两次解析均失败: {last_err}")

    def summarize_interview(
        self,
        *,
        jd_text: str,
        resume_summary: str,
        tech: int,
        product: int,
        learning: int,
        culture: int,
        observation: str,
    ) -> str:
        prompt = render_prompt(
            "interview_summary",
            jd_text=jd_text,
            resume_summary=resume_summary,
            tech_score=tech,
            product_score=product,
            learning_score=learning,
            culture_score=culture,
            observation=observation,
        )
        return self._chat(prompt).strip()

    def _chat(self, prompt: str) -> str:
        resp = self._client.chat.completions.create(
            model=self._model,
            messages=[{"role": "user", "content": prompt}],
            temperature=0.2,
        )
        return resp.choices[0].message.content or ""

from loguru import logger
from app.llm_client import LLMClient
from app.lark_client import LarkClient


_REQUIRED_SCORES = ["技术理解分", "产品思维分", "学习能力分", "文化匹配分"]


def generate_interview_summary(
    *, interview_record_id: str, lark: LarkClient, llm: LLMClient,
) -> str:
    fields = lark.get_interview(interview_record_id)

    missing = [k for k in _REQUIRED_SCORES if fields.get(k) in (None, "")]
    if missing:
        raise ValueError(f"分数未填: {missing}")

    candidate_link = fields.get("候选人", [])
    candidate_id = None
    if candidate_link and isinstance(candidate_link, list):
        first = candidate_link[0]
        rids = first.get("record_ids") if isinstance(first, dict) else None
        if rids:
            candidate_id = rids[0]

    resume_summary = ""
    if candidate_id:
        cand = lark.get_candidate(candidate_id)
        resume_summary = cand.get("LLM评语", "")

    jd = lark.get_jd_config().get("JD原文", "")

    out = llm.summarize_interview(
        jd_text=jd,
        resume_summary=resume_summary,
        tech=int(fields["技术理解分"]),
        product=int(fields["产品思维分"]),
        learning=int(fields["学习能力分"]),
        culture=int(fields["文化匹配分"]),
        observation=fields.get("关键观察", ""),
    )
    lark.update_interview(interview_record_id, {"LLM面试小结": out})
    logger.info("面试小结已写回 interview_id={}", interview_record_id)
    return out

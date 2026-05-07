from typing import Callable, Optional
from loguru import logger
from app.llm_client import LLMClient, LLMParseError
from app.lark_client import LarkClient
from app.outlook_client import OutlookClient, IncomingEmail
from app.resume_parser import extract_text as default_extract
from app.scrubber import scrub_pii as default_scrub
from app.models import LLMResumeScore


STATUS_REVIEW = "待人工初筛"
STATUS_REJECT = "已婉拒"
STATUS_ERROR = "LLM解析失败"


async def process_new_resumes(
    *,
    outlook: OutlookClient,
    lark: LarkClient,
    llm: LLMClient,
    extract_text: Optional[Callable[..., str]] = None,
    scrub: Optional[Callable[[str], str]] = None,
) -> dict:
    """流程 A 主入口。"""
    extract_text = extract_text or default_extract
    scrub = scrub or default_scrub

    stats = {"processed": 0, "skipped_duplicate": 0, "failed": 0}
    emails = await outlook.fetch_new_emails()
    if not emails:
        return stats

    jd_config = lark.get_jd_config()
    jd_text = jd_config.get("JD原文", "")

    for email in emails:
        try:
            await _handle_one(
                email=email, outlook=outlook, lark=lark, llm=llm,
                extract_text=extract_text, scrub=scrub, jd_text=jd_text,
                stats=stats,
            )
        except Exception as e:  # noqa: BLE001 — 邮件级隔离
            logger.exception("处理邮件异常 mid={}", email.message_id)
            stats["failed"] += 1
            try:
                lark.send_alert(
                    f"流程A异常 mid={email.message_id} sender={email.sender} err={e}"
                )
            except Exception:
                logger.exception("send_alert 自身失败")
    return stats


async def _handle_one(
    *, email: IncomingEmail, outlook, lark, llm, extract_text, scrub, jd_text, stats,
):
    existing = lark.query_candidate_by_email(email.sender)
    if existing:
        logger.info("重复投递，跳过 sender={} existing={}", email.sender, existing)
        stats["skipped_duplicate"] += 1
        await outlook.mark_read(email.message_id)
        return

    attachments = await outlook.download_attachments(email.message_id)
    if not attachments:
        logger.warning("邮件无附件 mid={}", email.message_id)
        stats["failed"] += 1
        await outlook.mark_read(email.message_id)
        return

    att = attachments[0]
    file_token = lark.upload_resume(att.content, filename=att.filename)

    try:
        raw_text = extract_text(att.content, filename=att.filename)
    except ValueError as e:
        logger.warning("附件格式不支持 mid={} err={}", email.message_id, e)
        lark.create_candidate({
            "邮箱": email.sender,
            "简历附件": [{"file_token": file_token}],
            "投递时间": _to_epoch_ms(email.received_at),
            "状态": STATUS_ERROR,
            "LLM评语": f"附件格式不支持: {e}",
        })
        stats["failed"] += 1
        await outlook.mark_read(email.message_id)
        return

    clean_text = scrub(raw_text)

    try:
        score: LLMResumeScore = llm.score_resume(jd_text=jd_text, resume_text=clean_text)
    except LLMParseError as e:
        logger.warning("LLM 两次失败 mid={}", email.message_id)
        lark.create_candidate({
            "邮箱": email.sender,
            "简历附件": [{"file_token": file_token}],
            "投递时间": _to_epoch_ms(email.received_at),
            "状态": STATUS_ERROR,
            "LLM评语": f"LLM 解析失败: {e}",
        })
        lark.send_alert(f"LLM解析失败 mid={email.message_id} sender={email.sender}")
        stats["failed"] += 1
        await outlook.mark_read(email.message_id)
        return

    status = STATUS_REVIEW if score.hard_pass else STATUS_REJECT
    lark.create_candidate({
        "姓名": score.name,
        "学校": score.school,
        "学历": score.degree,
        "专业": score.major,
        "年级/毕业时间": score.grade_or_graduate_date,
        "可实习时长": score.available_duration,
        "手机": score.phone,
        "邮箱": email.sender,
        "简历附件": [{"file_token": file_token}],
        "投递时间": _to_epoch_ms(email.received_at),
        "硬门槛通过": score.hard_pass,
        "AI经验分": score.ai_exp_score,
        "逻辑表达分": score.logic_score,
        "项目深度分": score.project_score,
        "LLM评语": _render_summary(score),
        "状态": status,
    })
    stats["processed"] += 1
    await outlook.mark_read(email.message_id)


def _render_summary(s: LLMResumeScore) -> str:
    return (
        f"{s.summary}\n\n"
        f"[AI经验 {s.ai_exp_score}] {s.ai_exp_reason}\n"
        f"[逻辑表达 {s.logic_score}] {s.logic_reason}\n"
        f"[项目深度 {s.project_score}] {s.project_reason}"
    )


def _to_epoch_ms(dt) -> Optional[int]:
    if dt is None:
        return None
    return int(dt.timestamp() * 1000)

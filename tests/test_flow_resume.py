from datetime import datetime
from unittest.mock import AsyncMock, MagicMock
import pytest
from app.flow_resume import process_new_resumes
from app.models import LLMResumeScore
from app.outlook_client import EmailAttachment, IncomingEmail


def _make_score(hard_pass: bool = True, ai=8, logic=7, project=6) -> LLMResumeScore:
    return LLMResumeScore(
        name="张三", school="清华", degree="硕士", major="计算机",
        grade_or_graduate_date="2025", available_duration="6月+",
        phone="138****5678", email="z@x.com",
        hard_pass=hard_pass,
        ai_exp_score=ai, ai_exp_reason="r1",
        logic_score=logic, logic_reason="r2",
        project_score=project, project_reason="r3",
        summary="ok",
    )


def _mock_email(mid="m1", sender="z@x.com") -> IncomingEmail:
    return IncomingEmail(
        message_id=mid, subject="超级智能体实习申请-张三",
        sender=sender, received_at=datetime(2026, 5, 7, 10),
    )


@pytest.mark.asyncio
async def test_process_happy_path():
    outlook = MagicMock()
    outlook.fetch_new_emails = AsyncMock(return_value=[_mock_email()])
    outlook.download_attachments = AsyncMock(return_value=[
        EmailAttachment(filename="resume.pdf", content=b"fakepdf"),
    ])
    outlook.mark_read = AsyncMock()

    lark = MagicMock()
    lark.query_candidate_by_email.return_value = []
    lark.get_jd_config.return_value = {"JD原文": "jd..."}
    lark.upload_resume.return_value = "filetoken"
    lark.create_candidate.return_value = "rec_1"

    llm = MagicMock()
    llm.score_resume.return_value = _make_score()

    parser = MagicMock(return_value="张三 138 1234 5678 身份证 110101199001011234")
    scrubber = MagicMock(return_value="张三 138****5678 身份证 110101****1234")

    stats = await process_new_resumes(
        outlook=outlook, lark=lark, llm=llm,
        extract_text=parser, scrub=scrubber,
    )

    assert stats["processed"] == 1
    assert stats["skipped_duplicate"] == 0
    assert stats["failed"] == 0
    lark.create_candidate.assert_called_once()
    created_fields = lark.create_candidate.call_args[0][0]
    assert created_fields["状态"] == "待人工初筛"
    assert created_fields["硬门槛通过"] is True
    outlook.mark_read.assert_awaited_once_with("m1")


@pytest.mark.asyncio
async def test_hard_fail_writes_rejected():
    outlook = MagicMock()
    outlook.fetch_new_emails = AsyncMock(return_value=[_mock_email()])
    outlook.download_attachments = AsyncMock(return_value=[
        EmailAttachment(filename="r.pdf", content=b"x"),
    ])
    outlook.mark_read = AsyncMock()
    lark = MagicMock()
    lark.query_candidate_by_email.return_value = []
    lark.get_jd_config.return_value = {"JD原文": "jd"}
    lark.upload_resume.return_value = "ft"
    lark.create_candidate.return_value = "rec_2"
    llm = MagicMock()
    llm.score_resume.return_value = _make_score(hard_pass=False)

    await process_new_resumes(
        outlook=outlook, lark=lark, llm=llm,
        extract_text=MagicMock(return_value="t"),
        scrub=MagicMock(return_value="t"),
    )
    fields = lark.create_candidate.call_args[0][0]
    assert fields["状态"] == "已婉拒"


@pytest.mark.asyncio
async def test_duplicate_email_skipped():
    outlook = MagicMock()
    outlook.fetch_new_emails = AsyncMock(return_value=[_mock_email()])
    outlook.download_attachments = AsyncMock()
    outlook.mark_read = AsyncMock()
    lark = MagicMock()
    lark.query_candidate_by_email.return_value = [{"record_id": "existing"}]
    lark.get_jd_config.return_value = {"JD原文": "jd"}
    llm = MagicMock()

    stats = await process_new_resumes(
        outlook=outlook, lark=lark, llm=llm,
        extract_text=MagicMock(), scrub=MagicMock(),
    )
    assert stats["skipped_duplicate"] == 1
    lark.create_candidate.assert_not_called()
    outlook.mark_read.assert_awaited_once()


@pytest.mark.asyncio
async def test_llm_failure_creates_error_record_and_alerts():
    from app.llm_client import LLMParseError
    outlook = MagicMock()
    outlook.fetch_new_emails = AsyncMock(return_value=[_mock_email()])
    outlook.download_attachments = AsyncMock(return_value=[
        EmailAttachment(filename="r.pdf", content=b"x"),
    ])
    outlook.mark_read = AsyncMock()
    lark = MagicMock()
    lark.query_candidate_by_email.return_value = []
    lark.get_jd_config.return_value = {"JD原文": "jd"}
    lark.upload_resume.return_value = "ft"
    lark.create_candidate.return_value = "rec_err"
    llm = MagicMock()
    llm.score_resume.side_effect = LLMParseError("bad json")

    stats = await process_new_resumes(
        outlook=outlook, lark=lark, llm=llm,
        extract_text=MagicMock(return_value="t"),
        scrub=MagicMock(return_value="t"),
    )
    assert stats["failed"] == 1
    lark.send_alert.assert_called()
    fields = lark.create_candidate.call_args[0][0]
    assert fields["状态"] == "LLM解析失败"

import pytest
from unittest.mock import MagicMock
from app.flow_interview import generate_interview_summary


def test_happy_path():
    lark = MagicMock()
    lark.get_interview.return_value = {
        "候选人": [{"text": "张三", "record_ids": ["rec_cand_1"]}],
        "技术理解分": 4, "产品思维分": 3, "学习能力分": 5, "文化匹配分": 4,
        "关键观察": "主动提问",
    }
    lark.get_candidate.return_value = {"LLM评语": "简历摘要..."}
    lark.get_jd_config.return_value = {"JD原文": "jd..."}
    llm = MagicMock()
    llm.summarize_interview.return_value = (
        "综合判断：值得推荐\n亮点:\n- 主动\n隐忧:\n- demo\n推荐结论：推荐"
    )
    out = generate_interview_summary(
        interview_record_id="rec_int_1", lark=lark, llm=llm,
    )
    assert "综合判断" in out
    lark.update_interview.assert_called_once()
    update_args = lark.update_interview.call_args[0]
    assert update_args[0] == "rec_int_1"
    assert "LLM面试小结" in update_args[1]


def test_missing_scores_raises():
    lark = MagicMock()
    lark.get_interview.return_value = {
        "候选人": [{"text": "张三", "record_ids": ["rec_cand_1"]}],
        "关键观察": "x",
    }
    with pytest.raises(ValueError, match="分数未填"):
        generate_interview_summary(
            interview_record_id="rec_int_1", lark=lark, llm=MagicMock(),
        )

from unittest.mock import MagicMock, patch
import pytest
from app.lark_client import LarkClient


@pytest.fixture
def mock_httpx_client():
    """mock httpx.Client 返回预设响应"""
    with patch("app.lark_client.httpx.Client") as cls:
        inst = MagicMock()
        cls.return_value = inst
        yield inst


def _resp(status=200, json_body=None):
    r = MagicMock()
    r.status_code = status
    r.json.return_value = json_body or {"code": 0, "msg": "ok", "data": {}}
    r.raise_for_status = MagicMock()
    return r


def test_get_tenant_token_caches(mock_httpx_client):
    mock_httpx_client.post.return_value = _resp(
        json_body={"code": 0, "tenant_access_token": "t_xxx", "expire": 7200}
    )
    c = LarkClient()
    tok1 = c._get_token()
    tok2 = c._get_token()
    assert tok1 == "t_xxx"
    assert tok2 == "t_xxx"
    assert mock_httpx_client.post.call_count == 1


def test_create_candidate_record(mock_httpx_client):
    mock_httpx_client.post.side_effect = [
        _resp(json_body={"code": 0, "tenant_access_token": "t", "expire": 7200}),
        _resp(json_body={"code": 0, "data": {"record": {"record_id": "rec_123"}}}),
    ]
    c = LarkClient()
    rid = c.create_candidate({"姓名": "张三", "邮箱": "a@b.c"})
    assert rid == "rec_123"


def test_send_alert_message(mock_httpx_client):
    mock_httpx_client.post.side_effect = [
        _resp(json_body={"code": 0, "tenant_access_token": "t", "expire": 7200}),
        _resp(json_body={"code": 0, "data": {"message_id": "om_xxx"}}),
    ]
    c = LarkClient()
    c.send_alert("系统告警：LLM 解析失败 候选人 rec_123")
    assert mock_httpx_client.post.call_count == 2


def test_upload_resume_to_drive(mock_httpx_client):
    mock_httpx_client.post.side_effect = [
        _resp(json_body={"code": 0, "tenant_access_token": "t", "expire": 7200}),
        _resp(json_body={"code": 0, "data": {"file_token": "file_xxx"}}),
    ]
    c = LarkClient()
    tok = c.upload_resume(b"pdf-bytes", filename="resume.pdf")
    assert tok == "file_xxx"


def test_update_candidate_status(mock_httpx_client):
    mock_httpx_client.post.return_value = _resp(
        json_body={"code": 0, "tenant_access_token": "t", "expire": 7200}
    )
    mock_httpx_client.put.return_value = _resp(
        json_body={"code": 0, "data": {}}
    )
    c = LarkClient()
    c.update_candidate("rec_123", {"状态": "LLM解析失败"})
    mock_httpx_client.put.assert_called_once()

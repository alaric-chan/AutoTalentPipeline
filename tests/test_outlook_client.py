from unittest.mock import AsyncMock, MagicMock, patch
import pytest
from app.outlook_client import OutlookClient, IncomingEmail


@pytest.fixture
def mock_graph():
    with patch("app.outlook_client.GraphServiceClient") as cls:
        inst = MagicMock()
        cls.return_value = inst
        yield inst


def _mk_msg(subject: str, sender_email: str, has_attachments: bool, mid: str):
    m = MagicMock()
    m.id = mid
    m.subject = subject
    from_addr = MagicMock()
    from_addr.email_address.address = sender_email
    m.from_ = from_addr
    m.has_attachments = has_attachments
    m.received_date_time = None
    return m


async def test_fetch_new_emails_filters_subject(mock_graph):
    msgs = [
        _mk_msg("超级智能体实习申请-张三-清华-6月", "zhang@x.com", True, "m1"),
        _mk_msg("Re: 工作汇报", "bob@x.com", False, "m2"),
    ]
    page = MagicMock()
    page.value = msgs
    mock_graph.users.by_user_id.return_value.messages.get = AsyncMock(
        return_value=page
    )
    client = OutlookClient(graph_client=mock_graph)
    result = await client.fetch_new_emails()
    assert len(result) == 1
    assert result[0].sender == "zhang@x.com"
    assert result[0].subject.startswith("超级智能体实习申请")


async def test_fetch_skips_no_attachment(mock_graph):
    msgs = [_mk_msg("超级智能体实习申请-李四", "li@x.com", False, "m3")]
    page = MagicMock()
    page.value = msgs
    mock_graph.users.by_user_id.return_value.messages.get = AsyncMock(
        return_value=page
    )
    client = OutlookClient(graph_client=mock_graph)
    result = await client.fetch_new_emails()
    assert result == []

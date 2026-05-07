from dataclasses import dataclass, field
from datetime import datetime
from typing import Optional, List
from loguru import logger
from azure.identity import ClientSecretCredential
from msgraph import GraphServiceClient
from app.config import get_settings


_SUBJECT_PREFIX = "超级智能体实习申请"


@dataclass
class EmailAttachment:
    filename: str
    content: bytes


@dataclass
class IncomingEmail:
    message_id: str
    subject: str
    sender: str
    received_at: Optional[datetime]
    attachments: List[EmailAttachment] = field(default_factory=list)


class OutlookClient:
    def __init__(self, graph_client: Optional[GraphServiceClient] = None):
        s = get_settings()
        self._user = s.ms_user_email
        if graph_client is not None:
            self._graph = graph_client
        else:
            creds = ClientSecretCredential(
                tenant_id=s.ms_tenant_id,
                client_id=s.ms_client_id,
                client_secret=s.ms_client_secret,
            )
            self._graph = GraphServiceClient(
                credentials=creds,
                scopes=["https://graph.microsoft.com/.default"],
            )

    async def fetch_new_emails(self, limit: int = 50) -> List[IncomingEmail]:
        """拉取未读、标题以 {_SUBJECT_PREFIX} 开头、含附件的邮件（不含附件字节）。"""
        user_req = self._graph.users.by_user_id(self._user)
        page = await user_req.messages.get()
        msgs = (page.value or [])[:limit]
        result: List[IncomingEmail] = []
        for m in msgs:
            subject = (m.subject or "").strip()
            if not subject.startswith(_SUBJECT_PREFIX):
                continue
            if not m.has_attachments:
                continue
            sender = ""
            try:
                sender = m.from_.email_address.address or ""
            except AttributeError:
                pass
            result.append(
                IncomingEmail(
                    message_id=m.id,
                    subject=subject,
                    sender=sender,
                    received_at=m.received_date_time,
                )
            )
        return result

    async def download_attachments(self, message_id: str) -> List[EmailAttachment]:
        user_req = self._graph.users.by_user_id(self._user)
        page = await user_req.messages.by_message_id(message_id).attachments.get()
        items = page.value or []
        out: List[EmailAttachment] = []
        for a in items:
            name = getattr(a, "name", "") or ""
            content = getattr(a, "content_bytes", None)
            if content is None:
                logger.warning("附件无内容 mid={} name={}", message_id, name)
                continue
            out.append(EmailAttachment(filename=name, content=content))
        return out

    async def mark_read(self, message_id: str) -> None:
        from msgraph.generated.models.message import Message
        patch = Message(is_read=True)
        await (
            self._graph.users.by_user_id(self._user)
            .messages.by_message_id(message_id)
            .patch(patch)
        )

import json
import time
from typing import Optional
import httpx
from loguru import logger
from app.config import get_settings


_OPENAPI = "https://open.feishu.cn/open-apis"


class LarkClient:
    """飞书开放平台封装。

    关注 5 个能力：
    - tenant_access_token 的获取与缓存
    - 多维表格 record 创建 / 更新 / 查询
    - 云空间文件上传
    - 群机器人文本消息
    """

    def __init__(self):
        s = get_settings()
        self._app_id = s.lark_app_id
        self._app_secret = s.lark_app_secret
        self._base_app = s.lark_base_app_token
        self._table_candidate = s.lark_table_candidate
        self._table_interview = s.lark_table_interview
        self._table_jd = s.lark_table_jd
        self._folder_token = s.lark_resume_folder_token
        self._alert_chat = s.lark_alert_chat_id
        self._http = httpx.Client(timeout=30.0)
        self._token: Optional[str] = None
        self._token_expire_at: float = 0.0

    # ---------- token ----------
    def _get_token(self) -> str:
        now = time.time()
        if self._token and now < self._token_expire_at - 60:
            return self._token
        resp = self._http.post(
            f"{_OPENAPI}/auth/v3/tenant_access_token/internal",
            json={"app_id": self._app_id, "app_secret": self._app_secret},
        )
        resp.raise_for_status()
        data = resp.json()
        if data.get("code") != 0:
            raise RuntimeError(f"获取 tenant_access_token 失败: {data}")
        self._token = data["tenant_access_token"]
        self._token_expire_at = now + data.get("expire", 7200)
        return self._token

    def _headers(self) -> dict:
        return {"Authorization": f"Bearer {self._get_token()}"}

    # ---------- Base ----------
    def create_candidate(self, fields: dict) -> str:
        url = (
            f"{_OPENAPI}/bitable/v1/apps/{self._base_app}"
            f"/tables/{self._table_candidate}/records"
        )
        resp = self._http.post(url, headers=self._headers(), json={"fields": fields})
        resp.raise_for_status()
        data = resp.json()
        if data.get("code") != 0:
            raise RuntimeError(f"create_candidate 失败: {data}")
        return data["data"]["record"]["record_id"]

    def update_candidate(self, record_id: str, fields: dict) -> None:
        url = (
            f"{_OPENAPI}/bitable/v1/apps/{self._base_app}"
            f"/tables/{self._table_candidate}/records/{record_id}"
        )
        resp = self._http.put(url, headers=self._headers(), json={"fields": fields})
        resp.raise_for_status()
        data = resp.json()
        if data.get("code") != 0:
            raise RuntimeError(f"update_candidate 失败: {data}")

    def get_candidate(self, record_id: str) -> dict:
        url = (
            f"{_OPENAPI}/bitable/v1/apps/{self._base_app}"
            f"/tables/{self._table_candidate}/records/{record_id}"
        )
        resp = self._http.get(url, headers=self._headers())
        resp.raise_for_status()
        data = resp.json()
        if data.get("code") != 0:
            raise RuntimeError(f"get_candidate 失败: {data}")
        return data["data"]["record"]["fields"]

    def get_interview(self, record_id: str) -> dict:
        url = (
            f"{_OPENAPI}/bitable/v1/apps/{self._base_app}"
            f"/tables/{self._table_interview}/records/{record_id}"
        )
        resp = self._http.get(url, headers=self._headers())
        resp.raise_for_status()
        data = resp.json()
        if data.get("code") != 0:
            raise RuntimeError(f"get_interview 失败: {data}")
        return data["data"]["record"]["fields"]

    def update_interview(self, record_id: str, fields: dict) -> None:
        url = (
            f"{_OPENAPI}/bitable/v1/apps/{self._base_app}"
            f"/tables/{self._table_interview}/records/{record_id}"
        )
        resp = self._http.put(url, headers=self._headers(), json={"fields": fields})
        resp.raise_for_status()
        data = resp.json()
        if data.get("code") != 0:
            raise RuntimeError(f"update_interview 失败: {data}")

    def query_candidate_by_email(self, email: str) -> list:
        """按邮箱过滤查询候选人记录（用于去重）。"""
        url = (
            f"{_OPENAPI}/bitable/v1/apps/{self._base_app}"
            f"/tables/{self._table_candidate}/records/search"
        )
        payload = {
            "filter": {
                "conjunction": "and",
                "conditions": [
                    {"field_name": "邮箱", "operator": "is", "value": [email]}
                ],
            }
        }
        resp = self._http.post(url, headers=self._headers(), json=payload)
        resp.raise_for_status()
        data = resp.json()
        if data.get("code") != 0:
            raise RuntimeError(f"query 失败: {data}")
        return data.get("data", {}).get("items", [])

    def get_jd_config(self) -> dict:
        """读取表 4 第一条 JD 配置（MVP 单岗位）。"""
        url = (
            f"{_OPENAPI}/bitable/v1/apps/{self._base_app}"
            f"/tables/{self._table_jd}/records"
        )
        resp = self._http.get(
            url, headers=self._headers(), params={"page_size": 1}
        )
        resp.raise_for_status()
        data = resp.json()
        if data.get("code") != 0:
            raise RuntimeError(f"get_jd_config 失败: {data}")
        items = data["data"].get("items", [])
        if not items:
            raise RuntimeError("JD 配置表为空，请先在表 4 填一条")
        return items[0]["fields"]

    # ---------- Drive ----------
    def upload_resume(self, data: bytes, *, filename: str) -> str:
        url = f"{_OPENAPI}/drive/v1/medias/upload_all"
        files = {
            "file": (filename, data, "application/octet-stream"),
        }
        form = {
            "file_name": filename,
            "parent_type": "explorer",
            "parent_node": self._folder_token,
            "size": str(len(data)),
        }
        resp = self._http.post(
            url,
            headers=self._headers(),
            data=form,
            files=files,
        )
        resp.raise_for_status()
        body = resp.json()
        if body.get("code") != 0:
            raise RuntimeError(f"upload_resume 失败: {body}")
        return body["data"]["file_token"]

    # ---------- Message ----------
    def send_alert(self, text: str) -> None:
        url = f"{_OPENAPI}/im/v1/messages?receive_id_type=chat_id"
        payload = {
            "receive_id": self._alert_chat,
            "msg_type": "text",
            "content": json.dumps({"text": text}, ensure_ascii=False),
        }
        resp = self._http.post(url, headers=self._headers(), json=payload)
        resp.raise_for_status()
        body = resp.json()
        if body.get("code") != 0:
            logger.error("send_alert 失败 body={}", body)

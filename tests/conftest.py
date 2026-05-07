import os
from pathlib import Path
import pytest


@pytest.fixture(autouse=True)
def _test_env(monkeypatch):
    """所有测试默认用占位环境变量，避免意外打真 API"""
    monkeypatch.setenv("DASHSCOPE_API_KEY", "test-key")
    monkeypatch.setenv("DASHSCOPE_BASE_URL", "https://test.example/v1")
    monkeypatch.setenv("DASHSCOPE_MODEL", "test-model")
    monkeypatch.setenv("MS_TENANT_ID", "test-tenant")
    monkeypatch.setenv("MS_CLIENT_ID", "test-client")
    monkeypatch.setenv("MS_CLIENT_SECRET", "test-secret")
    monkeypatch.setenv("MS_USER_EMAIL", "test@example.com")
    monkeypatch.setenv("LARK_APP_ID", "test-app")
    monkeypatch.setenv("LARK_APP_SECRET", "test-secret")
    monkeypatch.setenv("LARK_BASE_APP_TOKEN", "test-base")
    monkeypatch.setenv("LARK_TABLE_CANDIDATE", "tblcandidate")
    monkeypatch.setenv("LARK_TABLE_INTERVIEW", "tblinterview")
    monkeypatch.setenv("LARK_TABLE_SLOT", "tblslot")
    monkeypatch.setenv("LARK_TABLE_JD", "tbljd")
    monkeypatch.setenv("LARK_RESUME_FOLDER_TOKEN", "fldtoken")
    monkeypatch.setenv("LARK_ALERT_CHAT_ID", "oc_test")
    # 清 lru_cache，确保每个测试都重新加载
    from app.config import get_settings
    get_settings.cache_clear()


@pytest.fixture
def fixtures_dir() -> Path:
    return Path(__file__).parent / "fixtures"

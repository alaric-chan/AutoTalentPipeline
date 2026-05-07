from functools import lru_cache
from pydantic_settings import BaseSettings, SettingsConfigDict


class Settings(BaseSettings):
    dashscope_api_key: str
    dashscope_base_url: str = "https://coding.dashscope.aliyuncs.com/v1"
    dashscope_model: str = "qwen-max"

    ms_tenant_id: str
    ms_client_id: str
    ms_client_secret: str
    ms_user_email: str

    lark_app_id: str
    lark_app_secret: str
    lark_base_app_token: str
    lark_table_candidate: str
    lark_table_interview: str
    lark_table_slot: str
    lark_table_jd: str
    lark_resume_folder_token: str
    lark_alert_chat_id: str

    resume_poll_interval_minutes: int = 15
    log_level: str = "INFO"

    model_config = SettingsConfigDict(
        env_file=".env",
        env_file_encoding="utf-8",
        case_sensitive=False,
        extra="ignore",
    )


@lru_cache(maxsize=1)
def get_settings() -> Settings:
    return Settings()

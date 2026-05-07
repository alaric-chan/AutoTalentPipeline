from app.config import get_settings


def test_settings_loaded_from_env():
    s = get_settings()
    assert s.dashscope_api_key == "test-key"
    assert s.dashscope_model == "test-model"
    assert s.ms_user_email == "test@example.com"
    assert s.lark_base_app_token == "test-base"
    assert s.resume_poll_interval_minutes == 15


def test_settings_cached():
    a = get_settings()
    b = get_settings()
    assert a is b

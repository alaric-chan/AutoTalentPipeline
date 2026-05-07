from unittest.mock import MagicMock, patch
from fastapi.testclient import TestClient


def test_health_endpoint():
    from app.webhook_server import app
    client = TestClient(app)
    r = client.get("/health")
    assert r.status_code == 200
    assert r.json()["status"] == "ok"


def test_interview_webhook_triggers_summary():
    with patch("app.webhook_server.generate_interview_summary") as mock_gen, \
         patch("app.webhook_server.LarkClient") as mock_lark_cls, \
         patch("app.webhook_server.LLMClient") as mock_llm_cls:
        mock_gen.return_value = "summary text"
        from app.webhook_server import app
        client = TestClient(app)
        r = client.post(
            "/webhook/interview-complete",
            json={"interview_record_id": "rec_int_1"},
        )
        assert r.status_code == 200
        mock_gen.assert_called_once()
        kwargs = mock_gen.call_args.kwargs
        assert kwargs["interview_record_id"] == "rec_int_1"


def test_interview_webhook_bad_payload():
    from app.webhook_server import app
    client = TestClient(app)
    r = client.post("/webhook/interview-complete", json={})
    assert r.status_code == 422

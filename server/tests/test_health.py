from fastapi.testclient import TestClient

from app.config import settings
from app.main import app
from app.services import asr

client = TestClient(app)


def test_health_returns_ok_and_models():
    asr.reset_model_for_tests()
    r = client.get("/health")
    assert r.status_code == 200
    body = r.json()
    assert body["ok"] is True
    assert body["asrModel"] == settings.asr_model
    assert body["asrReady"] is False
    assert body["llm"] == settings.ollama_model

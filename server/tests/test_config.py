import pytest

from app.config import Settings

ENV_KEYS = [
    "HOST",
    "PORT",
    "ASR_MODEL",
    "ASR_DEVICE",
    "ASR_COMPUTE_TYPE",
    "ASR_LANGUAGE",
    "ASR_VAD_FILTER",
    "ASR_WARMUP",
    "OLLAMA_URL",
    "OLLAMA_MODEL",
    "OLLAMA_API_KEY",
    "LLM_TIMEOUT_SEC",
    "LLM_MAX_TOKENS",
    "MAX_UPLOAD_MB",
    "DATA_DIR",
]


@pytest.fixture
def clean_env(monkeypatch):
    for key in ENV_KEYS:
        monkeypatch.delenv(key, raising=False)


def test_defaults(clean_env):
    s = Settings(_env_file=None)
    assert s.host == "127.0.0.1"
    assert s.port == 8765
    assert s.asr_model == "gigaam-v3-e2e-rnnt"
    assert s.asr_device == "cpu"
    assert s.asr_compute_type == ""
    assert s.asr_language == "ru"
    assert s.asr_vad_filter is True
    assert s.asr_warmup is False
    assert s.ollama_url == "http://127.0.0.1:11434/v1"
    assert s.ollama_model == "local-llm"
    assert s.ollama_api_key == ""
    assert s.max_upload_mb == 500
    assert s.data_dir.endswith("/server/data")


def test_env_override(clean_env, monkeypatch):
    monkeypatch.setenv("PORT", "9999")
    monkeypatch.setenv("ASR_MODEL", "gigaam-v3-e2e-ctc")
    monkeypatch.setenv("OLLAMA_MODEL", "qwen:27b")
    monkeypatch.setenv("OLLAMA_URL", "http://example.local/v1")
    monkeypatch.setenv("DATA_DIR", "/tmp/conspector-data")
    s = Settings(_env_file=None)
    assert s.port == 9999
    assert s.asr_model == "gigaam-v3-e2e-ctc"
    assert s.ollama_model == "qwen:27b"
    assert s.ollama_url == "http://example.local/v1"
    assert s.data_dir == "/tmp/conspector-data"


def test_loads_dotenv_file(clean_env, tmp_path, monkeypatch):
    env_path = tmp_path / ".env"
    env_path.write_text(
        "OLLAMA_URL=http://secret.example/v1\nOLLAMA_MODEL=from-dotenv\nOLLAMA_API_KEY=sekret\n",
        encoding="utf-8",
    )
    s = Settings(_env_file=env_path)
    assert s.ollama_url == "http://secret.example/v1"
    assert s.ollama_model == "from-dotenv"
    assert s.ollama_api_key == "sekret"

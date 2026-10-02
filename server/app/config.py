"""Server configuration via environment variables.

Sensitive values (LLM URL/key, paths) live in `server/.env` (not committed).
See `.env.example` for the template.
"""

from pathlib import Path

from pydantic_settings import BaseSettings, SettingsConfigDict

_SERVER_ROOT = Path(__file__).resolve().parent.parent


class Settings(BaseSettings):
    model_config = SettingsConfigDict(
        env_file=str(_SERVER_ROOT / ".env"),
        env_file_encoding="utf-8",
        extra="ignore",
    )

    host: str = "127.0.0.1"
    port: int = 8765

    # onnx-asr model name, e.g. gigaam-v3-e2e-rnnt (punctuation + case).
    asr_model: str = "gigaam-v3-e2e-rnnt"
    asr_device: str = "cpu"
    # onnx quantization: "" | int8 | fp16. Empty = full precision (best quality).
    asr_compute_type: str = ""
    asr_language: str = "ru"
    asr_vad_filter: bool = True
    asr_warmup: bool = False

    # OpenAI-compatible chat API. Env names kept as OLLAMA_* for continuity.
    # Real URL/key/model come from .env — no LAN secrets in code defaults.
    ollama_url: str = "http://127.0.0.1:11434/v1"
    ollama_model: str = "local-llm"
    ollama_api_key: str = ""
    llm_timeout_sec: float = 300.0
    llm_max_tokens: int = 2048

    max_upload_mb: int = 500
    data_dir: str = str(_SERVER_ROOT / "data")


settings = Settings()

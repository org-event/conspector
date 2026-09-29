"""Summarize a meeting transcript via OpenAI-compatible LLM (vLLM)."""

from __future__ import annotations

import httpx

from app.config import settings

SYSTEM_PROMPT = (
    "Ты секретарь совещания. По транскрипту на русском сделай краткий конспект:\n"
    "- тема/цель\n"
    "- ключевые решения\n"
    "- поручения (кто / что / срок если сказано)\n"
    "- открытые вопросы\n"
    "Без выдумок. Если чего-то нет в тексте — не добавляй."
)


def _chat_url() -> str:
    base = settings.ollama_url.rstrip("/")
    if base.endswith("/v1"):
        return f"{base}/chat/completions"
    return f"{base}/v1/chat/completions"


def _message_text(message: dict) -> str:
    content = message.get("content")
    if isinstance(content, str) and content.strip():
        return content.strip()
    # Thinking models may put the answer only in reasoning when enabled.
    for key in ("reasoning", "reasoning_content"):
        value = message.get(key)
        if isinstance(value, str) and value.strip():
            return value.strip()
    return ""


def summarize_transcript(transcript_text: str, *, timeout: float | None = None) -> str:
    """Call the configured LLM and return the assistant message content."""
    text = (transcript_text or "").strip()
    if not text:
        return "Нет текста транскрипта для конспекта."

    wait = timeout if timeout is not None else settings.llm_timeout_sec
    headers = {
        "Authorization": f"Bearer {settings.ollama_api_key}",
        "Content-Type": "application/json",
    }
    payload = {
        "model": settings.ollama_model,
        "messages": [
            {"role": "system", "content": SYSTEM_PROMPT},
            {"role": "user", "content": text},
        ],
        "stream": False,
        "max_tokens": settings.llm_max_tokens,
        # Qwen3.x on vLLM: avoid filling the budget with chain-of-thought.
        "chat_template_kwargs": {"enable_thinking": False},
    }
    with httpx.Client(timeout=wait) as client:
        response = client.post(_chat_url(), headers=headers, json=payload)
        response.raise_for_status()
        body = response.json()

    try:
        message = body["choices"][0]["message"]
    except (KeyError, IndexError, TypeError) as exc:
        raise RuntimeError(f"Unexpected LLM response shape: {body!r}") from exc

    content = _message_text(message if isinstance(message, dict) else {})
    if not content:
        raise RuntimeError("LLM returned empty summary")
    return content

from app.services.summarize import SYSTEM_PROMPT, summarize_transcript


def test_summarize_empty_returns_message():
    assert "Нет текста" in summarize_transcript("")


def test_summarize_calls_openai_compatible_api(monkeypatch):
    captured = {}

    class FakeResponse:
        def raise_for_status(self):
            return None

        def json(self):
            return {
                "choices": [
                    {"message": {"role": "assistant", "content": "## Краткое резюме\nРешение принято."}}
                ]
            }

    class FakeClient:
        def __init__(self, *args, **kwargs):
            pass

        def __enter__(self):
            return self

        def __exit__(self, *args):
            return False

        def post(self, url, headers=None, json=None):
            captured["url"] = url
            captured["headers"] = headers
            captured["json"] = json
            return FakeResponse()

    monkeypatch.setattr("app.services.summarize.httpx.Client", FakeClient)
    out = summarize_transcript("[00:12] Морозов: Перенесём дедлайн.")
    assert "Решение принято" in out
    assert captured["url"].endswith("/v1/chat/completions")
    assert captured["headers"]["Authorization"].startswith("Bearer ")
    assert captured["json"]["messages"][0]["content"] == SYSTEM_PROMPT
    assert captured["json"]["chat_template_kwargs"]["enable_thinking"] is False

# Conspector — локальный сервер

Прототип: FastAPI-сервер принимает запись встречи (аудио + таймлайн спикеров),
делает ASR (faster-whisper) и краткое резюме через LLM.

## Требования

- Python 3.11+

## Установка

```bash
cd server
python3 -m venv .venv
.venv/bin/pip install -e ".[dev]"
cp .env.example .env   # заполните OLLAMA_*, DATA_DIR и т.д.
```

Файл `.env` **не коммитится**. Шаблон — `.env.example`.

## Запуск

```bash
cd server
.venv/bin/python -m uvicorn app.main:app --host "${HOST:-127.0.0.1}" --port "${PORT:-8765}"
```

Конфиг читается из `server/.env` (путь к файлу фиксирован относительно пакета, не от cwd).
Jobs пишутся в `DATA_DIR` (по умолчанию `server/data/jobs/{id}/`).

## Проверка

```bash
curl http://127.0.0.1:8765/health
```

В ответе `asrModel` / `llm` / `asrReady` — из текущего `.env`.

Создание job:

```bash
curl -s -F "audio=@meeting.webm" -F "speakers=@speakers.jsonl" \
  -F 'meta={"sessionId": "demo", "durationSec": 60, "language": "ru"}' \
  http://127.0.0.1:8765/v1/jobs
```

Статусы: `queued` → `transcribing` → `summarizing` → `done` | `error`.

```bash
curl http://127.0.0.1:8765/v1/jobs/<id>
```

## ASR (faster-whisper)

- Модель: `ASR_MODEL` (дефолт `small`), `ASR_DEVICE`, `ASR_COMPUTE_TYPE`, `ASR_LANGUAGE`, VAD.
- **Lazy-load** при `ASR_WARMUP=false` (по умолчанию); при `true` — загрузка на старте uvicorn.
- Popup расширения **не** управляет моделью — только upload job и опрос статуса.
- Одна тяжёлая ASR за раз (lock).

Прогрев:

```bash
cd server
.venv/bin/python -c "from app.services.asr import load_model, is_model_loaded; load_model(); print('asrReady', is_model_loaded())"
```

## LLM (конспект)

Параметры **только из `.env`**: `OLLAMA_URL`, `OLLAMA_MODEL`, `OLLAMA_API_KEY`,
`LLM_TIMEOUT_SEC`, `LLM_MAX_TOKENS` (OpenAI-compatible API).

В коде нет LAN-адресов и ключей — см. `.env.example`.

Промпт — в `app/services/summarize.py`. ASR и LLM на прототипе идут последовательно.

## Конфигурация

| Переменная | Назначение |
|---|---|
| `HOST` / `PORT` | bind uvicorn |
| `DATA_DIR` | каталог jobs |
| `ASR_*` | faster-whisper |
| `OLLAMA_*` / `LLM_*` | доступ к LLM |
| `MAX_UPLOAD_MB` | лимит upload |

## Тесты

```bash
cd server
.venv/bin/python -m pytest
```

# Conspector — локальный сервер

Прототип: FastAPI принимает запись встречи (аудио + спикеры), делает ASR
(faster-whisper) и краткое резюме через LLM.

Работает на **macOS, Linux и Windows** (нужен Python 3.11+ и браузер Chromium для расширения).

## Если нет Python

Нужен **Python 3.11+** (`python3 --version`).

| ОС | Как поставить |
|---|---|
| **macOS** | [python.org](https://www.python.org/downloads/) или `brew install python@3.12` |
| **Linux** | `sudo apt install python3 python3-venv python3-pip` (Debian/Ubuntu) или аналог дистрибутива |
| **Windows** | Установщик с [python.org](https://www.python.org/downloads/) — включите **«Add python.exe to PATH»**. В PowerShell: `py -3 --version` |

Проверка:

```bash
python3 --version    # macOS / Linux
py -3 --version      # Windows
```

## Установка

**macOS / Linux:**

```bash
cd server
python3 -m venv .venv
.venv/bin/pip install -e ".[dev]"
cp .env.example .env   # заполните OLLAMA_*, DATA_DIR и т.д.
```

**Windows (PowerShell / cmd):**

```bat
cd server
py -3 -m venv .venv
.venv\Scripts\pip install -e ".[dev]"
copy .env.example .env
```

Файл `.env` **не коммитится**. Шаблон — `.env.example`.

## Запуск

**macOS / Linux:**

```bash
cd server
.venv/bin/python -m uvicorn app.main:app --host 127.0.0.1 --port 8765
```

**Windows:**

```bat
cd server
.venv\Scripts\python -m uvicorn app.main:app --host 127.0.0.1 --port 8765
```

Конфиг читается из `server/.env`. Jobs — в `DATA_DIR` (по умолчанию `server/data/jobs/{id}/`).

## Остановка сервера

В терминале, где крутится uvicorn: **Ctrl+C**.

Если процесс «завис» в фоне:

```bash
# macOS / Linux — кто слушает 8765
lsof -iTCP:8765 -sTCP:LISTEN
kill <PID>

# или одной строкой
kill $(lsof -t -iTCP:8765 -sTCP:LISTEN)
```

```bat
REM Windows
netstat -ano | findstr :8765
taskkill /PID <PID> /F
```

## Проверка

```bash
curl http://127.0.0.1:8765/health
```

В ответе `asrModel` / `llm` / `asrReady`.

Создание job:

```bash
curl -s -F "audio=@meeting.webm" -F "speakers=@speakers.jsonl" \
  -F 'meta={"sessionId": "demo", "durationSec": 60, "language": "ru"}' \
  http://127.0.0.1:8765/v1/jobs
```

Статусы: `queued` → `transcribing` → `summarizing` → `done` | `error`.

После `done` появляется **`conspect.md`**:

`server/data/jobs/<id>/conspect.md`

```bash
curl -O http://127.0.0.1:8765/v1/jobs/<id>/conspect.md
```

Пайплайн после upload **сам**: Whisper (речь→текст) → Qwen (конспект) → `conspect.md`.

## ASR (faster-whisper) — скачивается ли модель?

**По умолчанию при старте uvicorn модель не грузится** (`ASR_WARMUP=false`).

| Режим | Когда скачивается / грузится Whisper |
|---|---|
| **Lazy (дефолт)** | При **первой job** (этап `transcribing`). Первый раз нужен интернет — веса уходят в кэш Hugging Face. Дальше с диска. |
| **Warmup** `ASR_WARMUP=true` | При **старте** сервера (дольше старт, зато первая job быстрее). |

`asrReady: true` в `/health` = модель уже в памяти процесса.

Прогрев вручную:

```bash
# macOS / Linux
.venv/bin/python -c "from app.services.asr import load_model, is_model_loaded; load_model(); print('asrReady', is_model_loaded())"

# Windows
.venv\Scripts\python -c "from app.services.asr import load_model, is_model_loaded; load_model(); print('asrReady', is_model_loaded())"
```

Env: `ASR_MODEL` (дефолт `small`), `ASR_DEVICE`, `ASR_COMPUTE_TYPE`, `ASR_LANGUAGE`, `ASR_VAD_FILTER`, `ASR_WARMUP`.

Одна тяжёлая ASR за раз (lock). Popup моделью не управляет.

На Linux/Windows для декодирования webm обычно тянется `av`/`ffmpeg` через зависимости faster-whisper; если ASR падает на аудио — поставьте системный **ffmpeg** (`brew` / `apt` / [gyan.dev](https://www.gyan.dev/ffmpeg/builds/) на Windows).

## LLM (конспект)

Из `.env`: `OLLAMA_URL`, `OLLAMA_MODEL`, `OLLAMA_API_KEY`, `LLM_TIMEOUT_SEC`, `LLM_MAX_TOKENS`.

LLM может быть на другой машине в LAN (OpenAI-compatible API). Без доступного LLM job дойдёт до ASR, но суммаризация упадёт в `error`.

## Платформы

| Часть | macOS | Linux | Windows |
|---|---|---|---|
| Сервер (Python / uvicorn / Whisper) | да | да | да (пути `.venv\Scripts\…`) |
| Расширение Chrome | да | да | да |
| Запись вкладки + микрофон | да | да | да (Chromium) |

Ограничения: нужен **Chrome/Chromium** (не Firefox). Захват — http(s) вкладки, не `chrome://`.

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
.venv/bin/python -m pytest      # macOS / Linux
.venv\Scripts\python -m pytest  # Windows
```

# Conspector

Локальный конспект встреч: **Chrome-расширение** пишет звук вкладки + микрофон → **сервер** на вашей машине делает Whisper (речь→текст) и LLM-конспект (например Qwen в LAN).

Аудио и текст не уходят в облако расширения — только на ваш `127.0.0.1` (или указанный сервер) и на настроенный LLM.

## Состав репозитория

| Каталог | Что это |
|---|---|
| [`extension/`](extension/) | Chrome MV3: запись, mute микрофона, upload jobs |
| [`server/`](server/) | FastAPI: ASR (faster-whisper) + summarize → `conspect.md` / `conspect.html` |
| [`openspec/`](openspec/) | Спеки / milestones (для разработки) |

Подробности: [extension/README.md](extension/README.md) · [server/README.md](server/README.md)

## Быстрый старт

### 1. Сервер

Нужен **Python 3.11+**. Если нет — см. [server/README.md](server/README.md#если-нет-python).

```bash
cd server
python3 -m venv .venv
.venv/bin/pip install -e ".[dev]"   # Windows: .venv\Scripts\pip …
cp .env.example .env                # OLLAMA_URL / OLLAMA_MODEL и т.д.
.venv/bin/python -m uvicorn app.main:app --host 127.0.0.1 --port 8765
```

Остановка: **Ctrl+C**. Проверка: `curl http://127.0.0.1:8765/health`

Модель Whisper по умолчанию **не** качается при старте — при **первой** job (нужен интернет один раз). Подробнее — в server README.

### 2. Расширение

Нужен **Bun**. Если нет — см. [extension/README.md](extension/README.md#если-нет-bun) ([bun.sh](https://bun.sh)).

```bash
cd extension
bun install
bun run build
```

Chrome → `chrome://extensions` → режим разработчика → «Загрузить нераспакованное» → `extension/dist`.

### 3. Запись

1. Откройте http(s) вкладку со звуком (не `chrome://`).
2. Popup Conspector: адрес сервера, вкладка, **Старт** (микрофон при первом разе).
3. Во время записи можно **выключить/включить микрофон** в миксе (звук вкладки пишется всегда).
4. **Стоп** → сервер: Whisper → LLM → файлы в `server/data/jobs/<id>/`.
5. **Открыть конспект** → HTML со сворачиваемым транскриптом (`conspect.html`). Рядом лежит `conspect.md`.

## Платформы

| | macOS | Linux | Windows |
|---|---|---|---|
| Сервер | да | да | да |
| Расширение (Chrome / Chromium / Edge) | да | да | да |
| Firefox | нет (`tabCapture` / `offscreen` — Chrome-only) |

## Результат job

После статуса `done`:

- `server/data/jobs/<id>/conspect.html` — смотреть в браузере (сворачивание транскрипта)
- `server/data/jobs/<id>/conspect.md` — исходник / архив
- `audio.webm`, `meta.json`

```bash
open http://127.0.0.1:8765/v1/jobs/<id>/conspect.html
```

## Конфиг

- Сервер: `server/.env` ← `server/.env.example` (`ASR_*`, `OLLAMA_*`, `DATA_DIR`, …)
- Расширение: опционально `extension/.env` ← `VITE_DEFAULT_SERVER_URL`

Секреты и `server/data/` в git не попадают.

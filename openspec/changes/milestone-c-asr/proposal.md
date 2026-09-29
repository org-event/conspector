# Proposal

## Why

После записи (B) нужен реальный перевод речи в текст. Сейчас job либо stub, либо суммаризует только таймлайн спикеров. Нужен ASR на сервере через faster-whisper с явным жизненным циклом модели (загрузка/использование/статусы), без онлайн-стриминга по секундам.

## What Changes

- Сервис `asr.py`: загрузка WhisperModel по конфигу (`ASR_MODEL=small`, `cpu`, `int8`, `language=ru`, VAD).
- Пайплайн job: после save → статус `transcribing` → сегменты `{start, end, text}` → `transcriptText` → (существующая) суммаризация → `done`.
- Lifecycle модели: lazy-load при первой job (или прогрев при старте — решение в design); одна активная тяжёлая стадия за раз (lock).
- `GET /health` отражает сконфигурированную ASR-модель (как сейчас) и опционально факт «модель в памяти».
- Тесты на ASR с коротким фикстурным аудио или моком WhisperModel.
- В C **нет** merge со спикерами (это D) — транскрипт без имён или с `unknown`.

## Capabilities

### New Capabilities

- `asr-pipeline`: распознавание сохранённого audio.webm в сегменты и transcriptText внутри job.
- `asr-model-lifecycle`: когда загружается/держится/освобождается модель ASR; что видит оператор.

### Modified Capabilities

- `job-api`: после создания job реальный этап `transcribing` вместо пустого transcript; ошибка ASR → `status: error`.

## Impact

- Код: `server/app/services/asr.py`, правки `routes`/pipeline, тесты.
- Зависимость: `faster-whisper` (уже в pyproject / venv).
- Ресурсы: CPU/RAM на Mac 16 GB; демо на коротких файлах (3–5 мин).
- LLM-суммаризация уже есть — на вход пойдёт реальный transcriptText.

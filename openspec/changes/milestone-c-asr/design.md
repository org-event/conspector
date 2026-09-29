# Design

## Context

Запись (B) кладёт `audio.webm` в job. Суммаризация через LAN Qwen уже есть, но без ASR текст бедный. План §4.3: faster-whisper `small` / cpu / int8 / ru / VAD. Пакет `faster-whisper` уже в зависимостях сервера.

## Goals / Non-Goals

**Goals:**
- Реальный ASR в пайплайне job с статусом `transcribing`.
- Понятный lifecycle модели (lazy-load + reuse; README).
- Очередь/lock на одну тяжёлую транскрипцию.
- Связка: transcript → существующий `summarize_transcript`.

**Non-Goals:**
- Merge со спикерами (D).
- Смена модели из UI расширения.
- GPU/AMD ROCm тюнинг; стриминг ASR по чанкам.
- Параллельные Whisper+LLM на пике RAM (последовательно).

## Decisions

1. **Lazy-load по умолчанию:** первый job загружает `WhisperModel`; держим singleton в процессе. Опциональный env `ASR_WARMUP=true` — загрузка на startup lifespan FastAPI.

2. **Сервис `app/services/asr.py`:** `transcribe_file(path) -> list[{start,end,text}]` + helper `to_transcript_text`. Конфиг из `settings`.

3. **Пайплайн:** `queued` → `transcribing` → (сегменты) → `summarizing` → `done`. Ошибки ASR → `error`.

4. **Lock:** `asyncio.Lock` или threading lock вокруг ASR+summarize тяжёлых стадий (одна job за раз на прототипе).

5. **Health:** сохранить `asrModel`; добавить `asrReady` boolean (модель загружена) — дешёвый сигнал для оператора.

6. **Тесты:** мок `transcribe_file` в API-тестах; отдельный unit-тест формата; опциональный integration с коротким wav если есть фикстура (не блокирует CI без файла).

7. **Модель на диске:** при первом запуске faster-whisper скачает weights в HF cache; это «установка C», не кнопка в popup.

## Risks / Trade-offs

- [Долгий CPU ASR] → UI уже показывает status; README предупреждает про 3–5 мин демо.
- [RAM 16 GB + LLM] → не параллелить ASR и LLM.
- [webm/opus decode] → faster-whisper/av обычно тянет; при сбоях — явный error.

## Open Questions

- Нет: lazy + optional warmup зафиксированы.

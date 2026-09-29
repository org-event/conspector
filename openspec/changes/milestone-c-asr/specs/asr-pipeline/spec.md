# Spec Delta

## Purpose

Сервер распознаёт сохранённый аудиофайл встречи (faster-whisper) и заполняет транскрипт job сегментами с таймкодами до суммаризации.

## ADDED Requirements

### Requirement: Transcribe on job
После сохранения файлов job сервер SHALL выполнить ASR над `audio.webm` (или сохранённым аудио в каталоге job), используя параметры из конфигурации (`ASR_MODEL`, `ASR_DEVICE`, `ASR_COMPUTE_TYPE`, `ASR_LANGUAGE`, `ASR_VAD_FILTER`). Результат SHALL содержать `result.transcript` — массив объектов с полями `start`, `end`, `text` (секунды float, текст сегмента) — и `result.transcriptText` — человекочитаемую склейку сегментов. Имена спикеров в этом milestone не обязательны (можно опустить или ставить `unknown`).

#### Scenario: Успешное распознавание
- **WHEN** job создан с валидным аудио, содержащим речь
- **THEN** после обработки `status` становится `done` (или переходит к суммаризации затем `done`), `transcript` непустой при наличии речи, `transcriptText` согласован с сегментами

#### Scenario: Пустое или безречевое аудио
- **WHEN** аудио не содержит распознаваемой речи
- **THEN** job не обязан падать: допустимы пустые `transcript`/`transcriptText`, дальнейшая суммаризация получает пустой или поясняющий текст

### Requirement: Transcribing status
Во время ASR job SHALL иметь `status: "transcribing"` (и осмысленный `progress` между 0 и 1). Клиент, опрашивающий `GET /v1/jobs/{id}`, SHALL иметь возможность увидеть этот статус до завершения ASR.

#### Scenario: Наблюдение статуса
- **WHEN** ASR выполняется
- **THEN** промежуточный `GET` может вернуть `status: "transcribing"`

### Requirement: ASR failure
При неустранимой ошибке ASR (файл битый, модель не загрузилась, исключение пайплайна) job SHALL перейти в `status: "error"` с непустым `error`, без зависания в `queued`/`transcribing`.

#### Scenario: Ошибка модели или файла
- **WHEN** ASR бросает исключение
- **THEN** `GET /v1/jobs/{id}` возвращает `status: "error"` и текст ошибки

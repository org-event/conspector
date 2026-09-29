# Spec Delta

## Purpose

Уточнение поведения job API: реальный этап транскрипции вместо пустого transcript после stub Milestone A.

## ADDED Requirements

### Requirement: Pipeline includes transcription
После `POST /v1/jobs` обработка SHALL включать этап распознавания речи перед финальным `done` (суммаризация может следовать за транскрипцией). `result.transcript` и `result.transcriptText` SHALL отражать выход ASR (или пустые значения при отсутствии речи), а не обязательный вечный stub `[]` / `""` при успешном аудио с речью.

#### Scenario: Job с речью доходит до done с текстом
- **WHEN** загружено аудио с русской речью и ASR успешен
- **THEN** финальный `result.transcriptText` содержит распознанный текст, `status` — `done` либо предшествующий успешный путь через `transcribing`/`summarizing`

### Requirement: Status values unchanged
Допустимые значения `status` остаются `queued|transcribing|merging|summarizing|done|error`. Milestone C SHALL использовать как минимум `queued`, `transcribing`, `summarizing` (если резюме включено), `done`, `error`.

#### Scenario: Переход статусов
- **WHEN** job обрабатывается штатно с ASR и резюме
- **THEN** клиент может наблюдать последовательность, включающую `transcribing` и завершающуюся `done`

# Spec Delta

## Purpose

Job API локального сервера принимает аудио встречи и таймлайн спикеров, ведёт задачу (job) со статусами и хранит результат (транскрипт с метками спикеров и резюме) для получения расширением.

## ADDED Requirements

### Requirement: Job creation
Сервер SHALL принимать `POST /v1/jobs` с multipart-запросом, содержащим поля `audio` (аудиофайл), `speakers` (файл `speakers.jsonl`) и `meta` (JSON-строка), сохранять полученные файлы в каталог job `server/data/jobs/{id}/` и отвечать `202` с JSON `{"id": "job_...", "status": "queued"}`.

#### Scenario: Загрузка валидного запроса
- **WHEN** клиент отправляет `POST /v1/jobs` с полями `audio`, `speakers`, `meta`
- **THEN** сервер возвращает `202` с `id` job и `status: "queued"`, а файлы сохраняются в каталоге `server/data/jobs/{id}/`

### Requirement: Job status and result
Сервер SHALL отвечать на `GET /v1/jobs/{id}` JSON-объектом с полями `id`, `status` (одно из `queued|transcribing|merging|summarizing|done|error`), `error`, `progress`, `result`. Для несуществующего `id` сервер SHALL отвечать `404`.

#### Scenario: Запрос статуса существующего job
- **WHEN** клиент выполняет `GET /v1/jobs/{id}` для созданного job
- **THEN** сервер возвращает `200` с текущим статусом job

#### Scenario: Запрос несуществующего job
- **WHEN** клиент выполняет `GET /v1/jobs/{id}` с неизвестным `id`
- **THEN** сервер возвращает `404`

### Requirement: Stub pipeline (Milestone A)
В этом milestone обработка job SHALL быть заглушкой: после создания job без реального ASR и суммаризации переходит в статус `done` с плейсхолдер-результатом — `result.transcript` пустой массив, `result.transcriptText` пустая строка, `result.summary` плейсхолдер-текст, `error` — `null`.

#### Scenario: Job доходит до done
- **WHEN** job создан и заглушка пайплайна выполнена
- **THEN** `GET /v1/jobs/{id}` возвращает `status: "done"`, `error: null` и плейсхолдер-результат

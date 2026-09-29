# Proposal

## Why

В проекте есть план прототипа (`conspector.md`), но нет кода. Чтобы начать реализацию по Milestone A, нужен рабочий каркас: локальный сервер с health-эндпоинтом и заглушкой job API, а также popup Chrome-расширения, который сохраняет адрес сервера и проверяет его доступность.

## What Changes

- Создать структуру репозитория: `extension/` (Chrome MV3, TypeScript, сборка Vite) и `server/` (Python 3.11+, FastAPI).
- Сервер: `GET /health` возвращает статус и имена сконфигурированных моделей (ASR/LLM).
- Сервер: `POST /v1/jobs` (multipart: `audio`, `speakers`, `meta`) принимает запрос, создаёт job в `server/data/jobs/{id}/` и отвечает `202` с id; `GET /v1/jobs/{id}` возвращает статус и результат. В этом milestone пайплайн — заглушка: job переходит в `done` с плейсхолдер-результатом (без реального ASR/резюме).
- Popup расширения: поле «Адрес сервера», сохраняемое в `chrome.storage` между открытиями (дефолт `http://127.0.0.1:8765`), и индикатор доступности сервера (ping `GET /health`).
- `.gitignore`: `node_modules`, `dist`, `.venv`, `data`, `*.webm`.

## Capabilities

### New Capabilities

- `server-health`: health-эндпоинт локального сервера (`GET /health`).
- `job-api`: API задач транскрипции (`POST /v1/jobs`, `GET /v1/jobs/{id}`) с заглушкой пайплайна в этом milestone.
- `extension-settings`: popup расширения — сохранение адреса сервера и проверка его доступности.

### Modified Capabilities

(нет — существующих спеков нет)

## Impact

- Новый код: `extension/` (manifest, popup, TypeScript-сборка через Vite), `server/` (FastAPI-приложение, конфиг, хранение jobs).
- Новые зависимости: FastAPI, uvicorn, python-multipart (сервер); Vite + TypeScript (расширение).
- Существующий код не затрагивается (greenfield).

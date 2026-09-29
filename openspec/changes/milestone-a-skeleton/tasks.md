# Tasks

## 1. Каркас репозитория

- [x] 1.1 Создать `.gitignore` в корне (`node_modules`, `dist`, `.venv`, `data`, `*.webm`) и проверить, что все пункты на месте
- [x] 1.2 Создать `server/`: `pyproject.toml` (fastapi, uvicorn, python-multipart, pydantic-settings, pytest, httpx), `app/` с пустым пакетом; создать `.venv` и установить зависимости — проверить, что `server/.venv/bin/python -c "import fastapi, uvicorn, multipart, pydantic_settings"` выполняется без ошибок
- [x] 1.3 Создать `extension/`: `package.json` (typescript, vite, @types/chrome), `tsconfig.json`; `npm install` — проверить, что установка проходит и `node_modules` создан

## 2. Сервер: конфиг и health

- [x] 2.1 Реализовать `server/app/config.py` (pydantic-settings, env-переменные с дефолтами из плана §4.2: HOST, PORT, ASR_MODEL, ASR_DEVICE, ASR_COMPUTE_TYPE, ASR_LANGUAGE, ASR_VAD_FILTER, OLLAMA_URL, OLLAMA_MODEL, MAX_UPLOAD_MB, DATA_DIR) и unit-тест дефолтов — проверить, что тест проходит: `PORT=8765`, `ASR_MODEL=small`, `OLLAMA_MODEL=qwen2.5:7b-instruct-q4_K_M`
- [x] 2.2 Реализовать `GET /health` (`server/app/main.py`, `server/app/api/routes.py`) — вернуть `{"ok": true, "asrModel", "llm"}` из конфига; TestClient-тест — проверить, что тест проходит (200, поля на месте)
- [x] 2.3 Подключить `CORSMiddleware` (`allow_origins=["*"]`) и точку запуска uvicorn; вручную поднять сервер и проверить `curl http://127.0.0.1:8765/health` — проверить, что curl возвращает JSON с `ok: true`

## 3. Сервер: job API (stub)

- [x] 3.1 Реализовать in-memory хранилище jobs (`server/app/services/jobs.py`): create (id `job_<uuid4-hex>`, статус `queued`), get, обновление статуса/результата; unit-тесты — проверить, что тесты проходят
- [x] 3.2 Реализовать `POST /v1/jobs` (multipart: `audio`, `speakers`, `meta`): сохранить файлы в `server/data/jobs/{id}/` (+ `meta.json`), ответить `202 {"id", "status": "queued"}`; TestClient-тест с тестовыми файлами — проверить, что тест проходит и файлы реально появляются на диске
- [x] 3.3 Реализовать stub-пайплайн: фоновая задача переводит job в `done` с плейсхолдер-результатом (`transcript: []`, `transcriptText: ""`, `summary` — плейсхолдер, `error: null`); тест — проверить, что после создания job достигает `done` с плейсхолдер-результатом
- [x] 3.4 Реализовать `GET /v1/jobs/{id}`: `{id, status, error, progress, result}`, `404` для неизвестного id; TestClient-тесты (существующий job + неизвестный id) — проверить, что тесты проходят
- [x] 3.5 Написать `server/README.md` (создание venv, установка зависимостей, запуск uvicorn, проверка `/health`) — проверить, что команды из README выполняются дословно и сервер отвечает

## 4. Расширение: popup

- [x] 4.1 Создать `extension/manifest.json` (MV3, name Conspector, permissions `storage`, host_permissions `http://127.0.0.1:*/*` и `http://localhost:*/*`, action → `popup.html`) — проверить, что файл валидный JSON и соответствует подмножеству плана §2.1 (без background/content — они в следующих milestone)
- [x] 4.2 Настроить `vite.config.ts`: HTML-вход `popup.html`, вывод в `dist/`, копирование `manifest.json` в `dist/`; `npm run build` — проверить, что в `dist/` появились `popup.html` и `manifest.json`
- [x] 4.3 Реализовать popup: поле «Адрес сервера» (дефолт `http://127.0.0.1:8765`), сохранение в `chrome.storage.local`, восстановление при открытии; UI на русском — проверить вручную: load unpacked `extension/dist` в Chrome, ввести адрес, закрыть и открыть popup — значение сохранено; при первом открытии виден дефолт
- [x] 4.4 Реализовать индикатор доступности: `fetch GET {serverUrl}/health` при открытии popup и после сохранения адреса, показ «сервер доступен» / «сервер недоступен» — проверить вручную: с запущенным сервером индикатор «доступен», с остановленным — «недоступен»
- [x] 4.5 Написать `extension/README.md` (npm install, сборка, load unpacked, как пользоваться popup) — проверить, что шаги из README выполняются дословно

## 5. Интеграционная проверка

- [x] 5.1 Сквозной прогон: запустить сервер, загрузить расширение, в popup убедиться в «сервер доступен», затем `curl -F` создать job (любой аудиофайл + `speakers.jsonl` + `meta`) и дождаться `done` через `GET /v1/jobs/{id}` — проверить, что на диске в `server/data/jobs/{id}/` лежат audio + speakers + meta, а ответ содержит плейсхолдер-результат

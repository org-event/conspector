# Tasks

## 1. ASR-сервис

- [x] 1.1 Реализовать `server/app/services/asr.py`: singleton WhisperModel, `transcribe_file`, сбор `transcript` + `transcriptText`; параметры из settings
- [x] 1.2 Env `ASR_WARMUP` (bool, default false): при true — загрузка модели в lifespan FastAPI; описать в README
- [x] 1.3 Unit-тест(ы) с моком модели / проверка пустого входа

## 2. Пайплайн job

- [x] 2.1 В pipeline: статус `transcribing`, lock на одну тяжёлую обработку, вызов ASR по `audio.webm`, затем `summarizing` + существующий summarize
- [x] 2.2 Ошибки ASR → `status=error` с сообщением; не оставлять job в `transcribing`
- [x] 2.3 `GET /health`: поле `asrReady` (модель в памяти); сохранить `asrModel`

## 3. Зависимости и модель

- [x] 3.1 Убедиться, что `faster-whisper` в `pyproject.toml` и установлен в `.venv`
- [x] 3.2 Прогреть/скачать модель `small` один раз (команда в README); проверить `asrReady` после warmup или первой job

## 4. Тесты и документация

- [x] 4.1 TestClient: job с моком ASR возвращает непустой transcriptText и проходит `transcribing`→`done`
- [x] 4.2 Обновить `server/README.md`: lifecycle ASR, env, что popup не стартует модель вручную

## 5. Проверка

- [x] 5.1 Ручной прогон: короткий webm/wav с русской речью → job → `transcribing` → `done` с текстом и резюме от LLM

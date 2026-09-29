# Tasks

## 1. Manifest и сборка

- [x] 1.1 Расширить `manifest.json`: permissions `tabCapture`, `activeTab`, `offscreen` (и `scripting` при необходимости); `background.service_worker`; проверить, что build копирует manifest в `dist/`
- [x] 1.2 Добавить Vite entry для `background.ts` (и offscreen HTML/TS); `bun run build` кладёт артефакты в `dist/`

## 2. Цель захвата

- [x] 2.1 В popup: показать URL/title активной вкладки; кнопка «Обновить цель»; ключ `captureUrlPattern` в `chrome.storage.local` с восстановлением
- [x] 2.2 Перед Стартом валидировать паттерн (пусто = ок; иначе URL должен содержать паттерн) — при провале показать ошибку и не стартовать
- [x] 2.3 Зафиксировать `tabId`+`pageUrl` в session storage на время записи; при открытии popup во время записи показывать ту же цель

## 3. Запись Start/Stop

- [x] 3.1 Реализовать offscreen + MediaRecorder (`audio/webm;codecs=opus` или webm); Старт после успешного health
- [x] 3.2 Стоп: остановить recorder, собрать Blob; одна активная сессия (флаг/storage)
- [x] 3.3 Ошибки: нет health, отказ capture, пустой blob — тексты в UI на русском

## 4. Upload и статус job

- [x] 4.1 `POST /v1/jobs` multipart: audio Blob, speakers (пустой/минимальный jsonl), meta JSON со `sessionId`, `startedAtIso`, `durationSec`, `pageUrl`, `language`
- [x] 4.2 Polling `GET /v1/jobs/{id}` каждые 2–3 с до `done`/`error`; показать id и status в popup
- [x] 4.3 Обновить `extension/README.md`: Start/Stop, паттерн URL, offscreen/load unpacked

## 5. Проверка

- [x] 5.1 Ручной прогон: встреча/любая вкладка с звуком → Старт → Стоп → файлы на сервере в `data/jobs/{id}/`, job доходит до терминального статуса

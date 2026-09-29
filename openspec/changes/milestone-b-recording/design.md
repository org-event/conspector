# Design

## Context

Есть Milestone A: popup с serverUrl/health, сервер с `POST /v1/jobs`. План `conspector.md` §2 описывает Start/Stop и tabCapture; спикеры и ASR — следующие milestone. Пользователь отдельно запросил явную индикацию и смену «какой страницы слушаем».

## Goals / Non-Goals

**Goals:**
- Одна сессия записи: Старт → webm Blob → Стоп → upload job.
- UI показывает цель (URL вкладки) и позволяет сменить вкладку/паттерн до старта.
- Контракт upload совместим с уже существующим job API.

**Non-Goals:**
- Реальный speaker observer / селекторы DOM (D).
- ASR (C), UI полного transcript/summary (можно показать job status).
- Запись произвольного desktop/микрофона вне вкладки.
- Онлайн-стриминг аудио на сервер чанками.

## Decisions

1. **Цель по умолчанию — активная вкладка текущего окна** (`chrome.tabs.query` active+currentWindow). Перед Стартом показываем `tab.url` / `tab.title`. Смена цели = пользователь активирует другую вкладку и обновляет popup (или кнопка «Обновить цель»).

2. **Опциональный `captureUrlPattern`** (подстрока или glob-простая проверка `includes` / RegExp — зафиксировать `includes` case-sensitive для простоты прототипа). Пустой паттерн = без фильтра. Несоответствие → блок Старт с текстом ошибки.

3. **Захват через tabCapture + offscreen document**, если service worker не удерживает MediaRecorder. Design default: попробовать offscreen с `getUserMedia` по `targetTabId` (рекомендация плана §2.1). Fallback — document в popup только если offscreen недоступен (плохо: popup закрывается). **Выбрать offscreen как основной путь.**

4. **Накопление Blob локально до Стоп**, один multipart upload (не chunked stream).

5. **`speakers.jsonl` в B** — пустой файл или одна служебная строка; merge спикеров в D.

6. **Polling job** каждые 2–3 с; в B достаточно показать status/id (полный transcript UI — E или минимальный textarea если `done`).

## Risks / Trade-offs

- [Popup закрыт во время записи] → запись живёт в offscreen/background; UI статус восстановить при открытии из storage (`recordingSession`).
- [Сайт запрещает capture] → явная ошибка; не ретраить молча.
- [Широкий host/content matches] → паттерн и явный Старт снижают риск; сужение domain — F.

## Open Questions

- Нет блокирующих: `includes` для паттерна принят; offscreen — основной путь.

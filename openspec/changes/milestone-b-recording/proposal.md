# Proposal

## Why

Milestone A дал каркас (serverUrl + stub jobs), но без записи встречи прототип бесполезен. Нужен Start/Stop захват аудио активной вкладки и явный выбор/отображение страницы, которую слушаем, с возможностью сменить цель.

## What Changes

- Popup: кнопки **Старт** / **Стоп**, статус записи, показ URL текущей (или выбранной) вкладки.
- Настройка цели захвата: по умолчанию активная вкладка; пользователь может зафиксировать вкладку/URL-паттерн для content script (и увидеть, какую страницу слушаем).
- Background + offscreen (при необходимости): MediaRecorder → `audio/webm;codecs=opus`, накопление Blob до Стоп.
- На Стоп: `POST /v1/jobs` с `audio`, `speakers` (пустой jsonl допустим в B), `meta` (sessionId, pageUrl, durationSec, …).
- Права MV3: `tabCapture` / `activeTab` / `offscreen` / `scripting` по необходимости.
- В B **нет** реального ASR и спикеров (observer — заглушка или пустой jsonl).

## Capabilities

### New Capabilities

- `extension-recording`: Start/Stop, захват аудио вкладки, upload job после Стоп.
- `extension-capture-target`: какая страница/вкладка слушается; отображение и смена цели.

### Modified Capabilities

- `extension-settings`: popup дополняется UI записи и целью захвата (поверх serverUrl).

## Impact

- Код: `extension/` (popup, background, optional offscreen, lib audio/upload).
- Manifest: новые permissions.
- Сервер: без изменений контракта job API (уже принимает multipart); результат по-прежнему может быть stub/LLM по таймлайну до milestone C.
- Зависимости: без новых npm-пакетов сверх уже имеющихся (Vite/TS).

# Spec Delta

## Purpose

Локальный сервер предоставляет health-эндпоинт для проверки доступности и текущей конфигурации (ASR/LLM), чтобы расширение и пользователь могли убедиться, что сервер запущен.

## ADDED Requirements

### Requirement: Health endpoint
Сервер SHALL отвечать на `GET /health` HTTP-статусом 200 и JSON-телом, содержащим поле `ok: true`, а также имена сконфигурированных моделей `asrModel` и `llm`.

#### Scenario: Сервер запущен
- **WHEN** клиент выполняет `GET /health`
- **THEN** сервер возвращает `200` с JSON `{"ok": true, "asrModel": "small", "llm": "qwen2.5:7b-instruct-q4_K_M"}` (значения — текущие значения конфигурации по умолчанию)

# Conspector — Chrome-расширение

Прототип: запись аудио вкладки встречи + микрофон, отправка на локальный сервер Conspector.
Работает в **Chrome / Chromium на macOS, Linux и Windows**.

## Если нет Bun

Нужен [Bun](https://bun.sh) 1.1+ (`bun --version`).

| ОС | Установка |
|---|---|
| **macOS / Linux** | `curl -fsSL https://bun.sh/install \| bash` затем переоткройте терминал |
| **Windows** | `powershell -c "irm bun.sh/install.ps1 \| iex"` (PowerShell) |

Альтернатива: скачать бинарник с [bun.sh](https://bun.sh). Проверка: `bun --version`.

Node.js **не обязателен**, если есть Bun.

## Требования

- Bun 1.1+
- Chrome (или Chromium / Edge на базе Chromium)
- Запущенный локальный сервер (см. `server/README.md`)

## Установка и сборка

```bash
cd extension
bun install
# опционально: cp .env.example .env  и задать VITE_DEFAULT_SERVER_URL
bun run build
```

На Windows те же команды в PowerShell / cmd, если Bun в PATH.

`.env` не коммитится. Шаблон — `.env.example`.
Результат — `extension/dist/` (`popup.html`, `background.js`, `offscreen.html`, `manifest.json`, `icons/`).

## Загрузка в Chrome

1. `chrome://extensions` (в Edge: `edge://extensions`).
2. «Режим разработчика».
3. «Загрузить нераспакованное» → каталог `extension/dist`.

## Использование

1. Запустите сервер (`server/README.md`).
2. Вкладка встречи **http(s)** со звуком (не `chrome://`).
3. Иконка Conspector (зелёная = сервер ок, красная = запись, серая = сервер недоступен).
4. Выберите вкладку в списке, при необходимости фильтр URL.
5. **Старт** → при первом разе вкладка «Доступ к микрофону» → **Разрешить** → снова **Старт**.
6. **Стоп** → upload; сервер сам: Whisper → Qwen → `conspect.md`.
7. Кнопка **«Открыть конспект.md»** когда job `done`.

После правок кода: `bun run build` и **Reload** расширения на `chrome://extensions`.

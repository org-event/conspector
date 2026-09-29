# Conspector — план реализации прототипа

Прототип: Chrome-расширение записывает аудио вкладки встречи + таймлайн «кто говорит», по Stop отправляет на локальный сервер. Сервер делает ASR (русский) → склейку со спикерами → краткое резюме через локальную LLM.

Целевой ПК (ориентир железа):
- Intel Core i7-9750H, 16 GB RAM
- AMD Radeon Pro 5300M 4 GB + Intel UHD
- macOS, без установленных Ollama / Whisper / Qwen на момент плана

Ограничения прототипа:
- Не продакшен VKS; не парсить видео ради ASR
- Качество важнее онлайн-латентности: запись на диск (в расширении и/или на сервере), распознавание после Stop
- UI сайдбара участников может меняться — селекторы вынести в конфиг

---

## 0. Итоговый пользовательский сценарий

1. Пользователь открывает встречу в Chrome (свой VKS / messenger).
2. Кликает иконку расширения → указывает URL локального сервера (сохраняется).
3. **Старт** — начинается захват аудио вкладки + лог спикеров из DOM.
4. **Стоп** — запись останавливается; на сервер уходят:
   - аудиофайл
   - `speakers.jsonl` (таймлайн)
   - метаданные (старт, длительность, URL страницы опционально)
5. Сервер отвечает job id; UI показывает статус: `queued → transcribing → summarizing → done`.
6. По готовности: полный текст с метками спикеров + краткое резюме (скачать / показать в popup).

---

## 1. Репозиторий / структура

Рекомендуемый отдельный каталог (не обязательно внутри messenger):

```
conspector/
  extension/                 # Chrome MV3
    manifest.json
    popup.html
    popup.ts
    background.ts
    content/
      speaker-observer.ts
      selectors.ts           # CSS-селекторы сайдбара — править под UI
    lib/
      audio-recorder.ts
      upload.ts
      settings.ts
    styles/
    icons/
  server/                    # Python FastAPI
    pyproject.toml           # или requirements.txt
    app/
      main.py
      config.py
      api/
        routes.py
      services/
        asr.py
        diarize_merge.py
        summarize.py
        jobs.py
      storage/
        paths.py
    README.md
  shared/
    protocol.md              # контракт API (ниже дублируется)
  conspector.md              # этот план
```

Стек:
- Extension: TypeScript, Vite + `@crxjs/vite-plugin` (или esbuild) → unpacked load
- Server: Python 3.11+, FastAPI, uvicorn
- ASR: `faster-whisper` модель `small` (дефолт), опционально `medium`
- LLM: Ollama, модель класса Qwen 7B Q4_K_M (см. §4)

---

## 2. Chrome-расширение

### 2.1 Manifest V3 — ключевые права

```json
{
  "manifest_version": 3,
  "name": "Conspector",
  "version": "0.1.0",
  "permissions": ["storage", "tabCapture", "activeTab", "scripting"],
  "host_permissions": ["http://127.0.0.1:*/*", "http://localhost:*/*"],
  "action": { "default_popup": "popup.html" },
  "background": { "service_worker": "background.js", "type": "module" },
  "content_scripts": [{
    "matches": ["<all_urls>"],
    "js": ["content/speaker-observer.js"],
    "run_at": "document_idle"
  }]
}
```

Уточнение по `matches`: для прототипа можно сузить до домена VKS/messenger, когда известен URL. Пока — широкий match + явный Старт только по кнопке.

Альтернатива `tabCapture`: `chrome.tabCapture` / offscreen document с `getUserMedia` по `targetTabId`. На MV3 часто нужен **offscreen document** для стабильной записи — заложить в план реализацию через offscreen, если service worker убивает поток.

### 2.2 Настройки (chrome.storage.sync или local)

| Ключ | Тип | Дефолт | Описание |
|------|-----|--------|----------|
| `serverUrl` | string | `http://127.0.0.1:8765` | Базовый URL API |
| `language` | string | `ru` | Язык ASR |
| `meetingTitle` | string | `""` | Опционально, вручную |

В popup: поле «Адрес сервера», кнопки **Старт** / **Стоп**, индикатор состояния, ссылка/превью результата.

### 2.3 Старт

1. Проверить `serverUrl` (ping `GET /health`).
2. Зафиксировать `sessionId` (uuid) и `t0 = performance.now()` / монотонные секунды от старта.
3. Запросить захват аудио **текущей вкладки** (без видео).
4. Писать чанки в память/IndexedDB **или** сразу стримить бинарём на сервер (`POST /sessions/{id}/audio` chunked / WebSocket).  
   **Рекомендация для прототипа (простота):** копить `Blob` локально (MediaRecorder → `audio/webm;codecs=opus`), на Стоп один upload. На час ~15–30 МБ Opus — ок.
5. Инжект/активация content script: старт observer спикеров, `postMessage`/`chrome.runtime.sendMessage` событий в background → append в `speakers.jsonl` (строки в storage / массив в memory).

Формат строки лога:

```json
{"t": 12.41, "activeIds": ["u-42"], "names": ["Морозов"]}
```

`t` — секунды float от момента Старт (тот же clock, что у аудио). Писать **только при изменении** набора активных.

### 2.4 Content script — кто говорит

Цель: читать сайдбар «УЧАСТНИКИ», детектить активного (зелёная рамка / зелёный мик без слэша).

Вынести селекторы в `selectors.ts`:

```ts
export const SELECTORS = {
  participantList: '[data-testid="participants"]', // ЗАМЕНИТЬ под реальный DOM
  participantItem: '.participant-card',
  name: '.participant-name',
  active: '.participant-card--speaking', // или проверка computed border / класса
};
```

Алгоритм:
1. `MutationObserver` на список участников + polling каждые 500 ms как fallback.
2. Для каждого item: имя (textContent trim), флаг active.
3. Если набор active изменился → сообщение в background.

Если селекторы неизвестны на старте реализации: сделать режим « Dom picker» позже; для первой версии — заглушка с ручным `document.querySelector` после инспекции живой страницы (в README: «открой DevTools и заполни selectors.ts»).

Имена вида «Мороз…» оставлять как есть; опционально слать полный список участников отдельным событием `{"t":0,"participants":[...]}` в начале.

### 2.5 Стоп

1. Остановить MediaRecorder, дождаться `onstop`, собрать Blob.
2. Остановить observer.
3. `multipart/form-data` на `POST {serverUrl}/v1/jobs`:
   - `audio`: file (`meeting.webm`)
   - `speakers`: file (`speakers.jsonl`)
   - `meta`: JSON `{ sessionId, startedAtIso, durationSec, language, pageUrl, title }`
4. Показать job id; polling `GET /v1/jobs/{id}` каждые 2–3 с.
5. По `done` — показать transcript + summary; кнопки копировать/скачать `.md`.

Ошибки: сервер недоступен, отказ в захвате вкладки, пустое аудио — явные сообщения в popup.

### 2.6 UI popup (минимальный)

- Input: Server URL  
- Buttons: Start / Stop (Stop disabled пока не Start)  
- Status text  
- После done: textarea transcript + summary  

Не усложнять дизайн.

---

## 3. Контракт API локального сервера

Base: `http://127.0.0.1:8765`

### `GET /health`

```json
{ "ok": true, "asrModel": "small", "llm": "qwen2.5:7b-instruct-q4_K_M" }
```

### `POST /v1/jobs` (multipart)

Поля: `audio`, `speakers`, `meta` (string JSON).

Ответ `202`:

```json
{ "id": "job_...", "status": "queued" }
```

### `GET /v1/jobs/{id}`

```json
{
  "id": "job_...",
  "status": "queued|transcribing|merging|summarizing|done|error",
  "error": null,
  "progress": 0.0,
  "result": {
    "transcript": [
      { "start": 12.0, "end": 18.2, "speaker": "Морозов", "text": "..." }
    ],
    "transcriptText": "[00:12] Морозов: ...\n",
    "summary": "## Краткое резюме\n..."
  }
}
```

Хранить джобы и файлы в `server/data/jobs/{id}/`.

---

## 4. Сервер — рекомендованные параметры под этот Mac

### 4.1 Установка зависимостей

```bash
cd conspector/server
python3 -m venv .venv
source .venv/bin/activate
pip install fastapi uvicorn python-multipart faster-whisper httpx pydantic-settings
```

Ollama (LLM) — отдельно:

```bash
brew install ollama
ollama serve
ollama pull qwen2.5:7b-instruct-q4_K_M
```

Если точного тега нет — взять ближайший лёгкий instruct Qwen 7B Q4. Не тянуть 32B+/Qwen3.6 full на 16 GB.

### 4.2 Конфиг (`config.py` / env)

| Параметр | Значение по умолчанию | Почему |
|----------|----------------------|--------|
| `HOST` | `127.0.0.1` | только локально |
| `PORT` | `8765` | |
| `ASR_MODEL` | `small` | баланс качество/скорость на 16 GB без нормального CUDA NVIDIA |
| `ASR_DEVICE` | `cpu` | AMD 4 GB на macOS для whisper часто проблемнее CPU; CPU предсказуемее |
| `ASR_COMPUTE_TYPE` | `int8` | быстрее и меньше RAM на CPU |
| `ASR_LANGUAGE` | `ru` | |
| `ASR_VAD_FILTER` | `true` | меньше мусора на паузах |
| `OLLAMA_URL` | `http://127.0.0.1:11434` | |
| `OLLAMA_MODEL` | `qwen2.5:7b-instruct-q4_K_M` | резюме; влезает в 16 GB вместе с ASR если не параллелить тяжело |
| `MAX_UPLOAD_MB` | `500` | запас на длинные WAV; Opus час << |
| `DATA_DIR` | `./data` | |

Опционально позже: `ASR_MODEL=medium` если small мало качества и готовы ждать дольше.

### 4.3 Пайплайн job

1. **Save** — положить `audio.webm`, `speakers.jsonl`, `meta.json`.
2. **Transcribe** (`faster_whisper`):
   - `WhisperModel(ASR_MODEL, device=cpu, compute_type=int8)`
   - `transcribe(path, language="ru", vad_filter=True, word_timestamps=False)`
   - сегменты `{start, end, text}`
3. **Merge speakers** (`diarize_merge.py`):
   - загрузить jsonl в список интервалов активности
   - для каждого ASR-сегмента выбрать спикера(ов), активных на большей части `[start,end]`
   - 0 активных → `"unknown"`; 2+ → `"A + B"` или главный по длительности (выбрать одно правило и зафиксировать)
4. **Summarize** — POST Ollama `/api/chat`:

```
Система: Ты секретарь совещания. По транскрипту на русском сделай краткий конспект:
- тема/цель
- ключевые решения
- поручения (кто / что / срок если сказано)
- открытые вопросы
Без выдумок. Если чего-то нет в тексте — не добавляй.

Пользователь: {transcriptText}
```

5. Статус `done`, отдать JSON.

Очередь: для прототипа **одна job за раз** (asyncio Lock / очередь). Параллельный Whisper + Ollama на 16 GB может упереться в RAM — не параллелить тяжёлые стадии.

### 4.4 Ожидания по времени (грубо, 1 час аудио)

- faster-whisper `small` CPU int8: порядка **0.3–0.7× realtime** (очень зависит от загрузки) → ориентир десятки минут на час; предупредить в UI «это займёт время».
- Для демо тестировать на **3–5 минутах**.
- Summary 7B: секунды–пара минут на текст часа встречи (если транскрипт огромный — можно суммаризировать чанками map-reduce; в v1 достаточно одного прохода, обрезать до N символов с предупреждением).

### 4.5 Запуск сервера

```bash
source .venv/bin/activate
uvicorn app.main:app --host 127.0.0.1 --port 8765 --reload
```

Проверка: `curl http://127.0.0.1:8765/health`

---

## 5. Склейка спикеров — псевдокод

```python
def speaker_at(t: float, events: list[Event]) -> list[str]:
    # последний event с event.t <= t
    ...

def pick_speaker(seg_start, seg_end, events) -> str:
    # семплы каждые 0.25s или интегрировать overlaps
    # вернуть самое частое имя / "unknown" / "A + B"
    ...
```

Гарантировать одинаковый ноль времени: мета `durationSec` должна быть близка к длине аудио; если нет — не падать, логировать warning.

---

## 6. Порядок реализации (для исполнителя)

### Milestone A — скелет
1. Scaffold `extension/` + `server/`
2. `GET /health`, пустой `POST /v1/jobs` → fake done
3. Popup: сохранить serverUrl, ping health

### Milestone B — запись
4. Start/Stop + MediaRecorder (opus/webm), без спикеров
5. Upload audio only, сервер сохраняет файл

### Milestone C — ASR
6. Подключить faster-whisper small/cpu/int8
7. Вернуть сырой транскрипт без имён

### Milestone D — спикеры
8. Content script + jsonl
9. Merge → transcript с именами (селекторы — placeholder + инструкция заполнить)

### Milestone E — резюме
10. Ollama + Qwen 7B Q4
11. Итоговый UI результата

### Milestone F — полировка
12. Ошибки, прогресс, README с установкой под этот Mac
13. Сузить host permissions под реальный URL встреч

---

## 7. README для пользователя (что должно получиться в тексте)

Кратко описать:
1. Установить Ollama + pull модели  
2. Поднять server venv + uvicorn  
3. `chrome://extensions` → Developer mode → Load unpacked → `extension/dist`  
4. Открыть встречу → указать `http://127.0.0.1:8765` → Старт / Стоп  
5. Дождаться резюме  

Troubleshooting:
- Health fail → сервер не запущен  
- Нет звука → не та вкладка / запрет захвата  
- Пустые имена → поправить `selectors.ts`  
- OOM → не поднимать medium параллельно с 14B LLM; закрыть лишние приложения  

---

## 8. Что сознательно НЕ делать в прототипе

- Не использовать vision/OCR экрана как основной путь  
- Не стримить онлайн-ASR по секундам  
- Не писать видео встречи  
- Не требовать Qwen 3.6 full / large-v3 Whisper на этом ноутбуке  
- Не интегрировать в backend VKS (это следующий этап после прототипа)

---

## 9. Критерии приёмки

- [ ] Поле адреса сервера сохраняется между открытиями popup  
- [ ] Start/Stop управляют одной сессией записи  
- [ ] После Stop на диске сервера есть audio + speakers + meta  
- [ ] Job доходит до `done` с непустым `transcriptText` на русском тестовом файле  
- [ ] При валидных селекторах хотя бы часть реплик с именем ≠ `unknown`  
- [ ] `summary` не пустой, на русском, без явных выдуманных фактов вне транскрипта (на глаз)  
- [ ] По умолчанию конфиг сервера: whisper `small`, `cpu`, `int8`, Ollama 7B Q4  

---

## 10. Подсказки исполнителю-модели

- Пиши код сразу рабочим каркасом, без «оставьте TODO на всё».
- Селекторы DOM пометь `TODO(selectors)` и дать пример с комментарием «подогнать под скрин сайдбара УЧАСТНИКИ».
- Не добавлять Docker в v1.
- Не коммитить веса моделей и `server/data/`.
- `.gitignore`: `node_modules`, `dist`, `.venv`, `data`, `*.webm`.
- Язык UI расширения: русский.
- Комментарии в коде: кратко, на русском или английском — единообразно; предпочтительно английский в коде, русский в README/UI.

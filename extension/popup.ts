import type { BgResponse, RecordingSession } from "./lib/types";

const DEFAULT_SERVER_URL =
  (import.meta.env.VITE_DEFAULT_SERVER_URL as string | undefined)?.trim() ||
  "http://127.0.0.1:8765";

type StatusKind = "pending" | "ok" | "bad" | "";

function $(id: string): HTMLElement {
  const el = document.getElementById(id);
  if (!el) throw new Error(`Missing #${id}`);
  return el;
}

function $input(id: string): HTMLInputElement {
  return $(id) as HTMLInputElement;
}

function $button(id: string): HTMLButtonElement {
  return $(id) as HTMLButtonElement;
}

function $select(id: string): HTMLSelectElement {
  return $(id) as HTMLSelectElement;
}

const serverUrlInput = $input("serverUrl");
const patternInput = $input("captureUrlPattern");
const tabSelect = $select("tabSelect");
const saveButton = $button("save");
const refreshTabsButton = $button("refreshTabs");
const startButton = $button("start");
const stopButton = $button("stop");
const micToggleButton = $button("micToggle");
const openConspectButton = $button("openConspect");
const serverStatus = $("serverStatus");
const recStatus = $("recStatus");
const jobStatus = $("jobStatus");
const targetTitle = $("targetTitle");
const targetUrl = $("targetUrl");

type Target = { tabId: number; pageUrl: string; pageTitle: string };

let selectedTarget: Target | null = null;
let serverOk = false;
let pollTimer: ReturnType<typeof setInterval> | null = null;
let lastJobId: string | null = null;

function jobStatusLabel(status: string): string {
  switch (status) {
    case "queued":
      return "в очереди на сервере";
    case "transcribing":
      return "Whisper: речь → текст";
    case "summarizing":
      return "Qwen: текст → конспект (LAN)";
    case "done":
      return "готово — можно открыть conspect.md";
    case "error":
      return "ошибка на сервере";
    default:
      return status;
  }
}

function setStatus(el: HTMLElement, kind: StatusKind, text: string): void {
  el.textContent = text;
  el.className = kind ? `status status--${kind}` : "status";
}

function setConspectAvailable(jobId: string | null, ready: boolean): void {
  lastJobId = jobId;
  openConspectButton.disabled = !ready || !jobId;
  if (jobId) {
    void chrome.storage.local.set({ lastJobId: jobId, lastJobReady: ready });
  }
}

function normalizeUrl(raw: string): string {
  const trimmed = raw.trim();
  if (!trimmed) return DEFAULT_SERVER_URL;
  return trimmed.replace(/\/+$/, "");
}

async function sendBg(message: unknown): Promise<BgResponse> {
  return chrome.runtime.sendMessage(message) as Promise<BgResponse>;
}

function isCapturableUrl(url: string): boolean {
  return /^https?:\/\//i.test(url);
}

function patternMatches(pattern: string, url: string): boolean {
  const p = pattern.trim();
  if (!p) return true;
  return url.includes(p);
}

async function checkHealth(serverUrl: string): Promise<boolean> {
  setStatus(serverStatus, "pending", "Проверка сервера…");
  try {
    const response = await fetch(`${serverUrl}/health`);
    if (!response.ok) throw new Error(String(response.status));
    const body = await response.json();
    const ok = Boolean(body?.ok);
    if (ok) {
      setStatus(serverStatus, "ok", "Сервер доступен");
      await sendBg({ type: "SET_SERVER_OK", ok: true });
      return true;
    }
    setStatus(serverStatus, "bad", "Сервер недоступен");
    await sendBg({ type: "SET_SERVER_OK", ok: false });
    return false;
  } catch {
    setStatus(serverStatus, "bad", "Сервер недоступен — запустите uvicorn");
    await sendBg({ type: "SET_SERVER_OK", ok: false });
    return false;
  }
}

function renderTarget(target: Target | null, locked: boolean): void {
  if (!target) {
    targetTitle.textContent = "Цель не выбрана";
    targetUrl.textContent = "—";
    return;
  }
  targetTitle.textContent = `${locked ? "Запись: " : ""}${target.pageTitle || "Без названия"}`;
  targetUrl.textContent = target.pageUrl || "(нет URL)";
}

function startBlockReasons(): string[] {
  const reason: string[] = [];
  if (!serverOk) reason.push("сервер недоступен");
  if (!selectedTarget) reason.push("не выбрана вкладка");
  if (selectedTarget && !isCapturableUrl(selectedTarget.pageUrl)) {
    reason.push("нужна http(s) вкладка");
  }
  if (
    selectedTarget &&
    patternInput.value.trim() &&
    !patternMatches(patternInput.value, selectedTarget.pageUrl)
  ) {
    reason.push("URL не совпал с фильтром");
  }
  return reason;
}

function syncStartEnabled(recording: boolean, uploading: boolean): void {
  const reason = startBlockReasons();
  const blocked = reason.length > 0;
  startButton.disabled = recording || uploading || blocked;
  startButton.title = blocked
    ? `Старт недоступен: ${reason.join(", ")}`
    : "Начать запись выбранной вкладки";
  if (!recording && !uploading && blocked) {
    setStatus(recStatus, "", `Старт недоступен: ${reason.join(", ")}`);
  }
}

async function refreshTabList(): Promise<void> {
  const tabs = await chrome.tabs.query({ currentWindow: true });
  const usable = tabs.filter((t) => t.id != null && t.url && isCapturableUrl(t.url));
  const previousId = selectedTarget?.tabId;
  tabSelect.innerHTML = "";

  if (usable.length === 0) {
    const opt = document.createElement("option");
    opt.value = "";
    opt.textContent = "Нет http(s) вкладок в этом окне";
    tabSelect.appendChild(opt);
    selectedTarget = null;
    renderTarget(null, false);
    syncStartEnabled(false, false);
    return;
  }

  for (const tab of usable) {
    const opt = document.createElement("option");
    opt.value = String(tab.id);
    const title = (tab.title || "Без названия").slice(0, 40);
    let host = tab.url || "";
    try {
      host = new URL(tab.url || "").host;
    } catch {
      /* keep raw url */
    }
    opt.textContent = `${title} — ${host}`;
    tabSelect.appendChild(opt);
  }

  const active = usable.find((t) => t.active) || usable[0];
  const pickId = usable.some((t) => t.id === previousId) ? previousId! : active.id!;
  tabSelect.value = String(pickId);
  const picked = usable.find((t) => t.id === pickId)!;
  selectedTarget = {
    tabId: picked.id!,
    pageUrl: picked.url || "",
    pageTitle: picked.title || "",
  };
  renderTarget(selectedTarget, false);
  syncStartEnabled(false, false);
}

function syncMicToggle(session: RecordingSession | null): void {
  const recording = session?.phase === "recording";
  const muted = Boolean(session?.micMuted);
  micToggleButton.disabled = !recording;
  micToggleButton.setAttribute("aria-pressed", muted ? "true" : "false");
  micToggleButton.textContent = muted ? "Микрофон: выкл" : "Микрофон: вкл";
  micToggleButton.classList.toggle("mic-off", muted && recording);
  micToggleButton.classList.toggle("secondary", !(muted && recording));
  micToggleButton.title = recording
    ? muted
      ? "Сейчас микрофон не пишется — нажмите, чтобы снова включить в микс"
      : "Нажмите, чтобы не писать ваш голос (звук вкладки останется)"
    : "Доступно во время записи";
}

function applySessionUi(session: RecordingSession | null): void {
  const recording = session?.phase === "recording";
  const uploading = session?.phase === "uploading";
  stopButton.disabled = !(recording || uploading);
  stopButton.textContent = uploading ? "Сбросить" : "Стоп";
  refreshTabsButton.disabled = recording || uploading;
  tabSelect.disabled = recording || uploading;
  patternInput.disabled = recording || uploading;
  syncMicToggle(session);

  if (session && (recording || uploading || session.phase === "done" || session.phase === "error")) {
    selectedTarget = {
      tabId: session.tabId,
      pageUrl: session.pageUrl,
      pageTitle: session.pageTitle,
    };
    renderTarget(selectedTarget, recording || uploading);
  } else {
    renderTarget(selectedTarget, false);
  }

  syncStartEnabled(Boolean(recording), Boolean(uploading));

  if (!session || session.phase === "idle") {
    if (startButton.disabled) return;
    setStatus(recStatus, "", "Не записывает");
    jobStatus.hidden = true;
    return;
  }
  if (session.phase === "recording") {
    setStatus(
      recStatus,
      "ok",
      session.micMuted ? "Идёт запись… (микрофон выкл)" : "Идёт запись…",
    );
    jobStatus.hidden = true;
    return;
  }
  if (session.phase === "uploading") {
    setStatus(recStatus, "pending", "Остановка и загрузка…");
    jobStatus.hidden = true;
    return;
  }
  if (session.phase === "error") {
    setStatus(recStatus, "bad", session.error || "Ошибка записи");
    jobStatus.hidden = true;
    return;
  }
  if (session.phase === "done" && session.jobId) {
    setStatus(recStatus, "ok", "Запись на сервере — идёт/ждёт обработка");
    jobStatus.hidden = false;
    jobStatus.className = "status";
    jobStatus.textContent = `Job ${session.jobId}: ${jobStatusLabel(session.jobStatus || "queued")}`;
    setConspectAvailable(session.jobId, session.jobStatus === "done");
    startJobPolling(normalizeUrl(serverUrlInput.value), session.jobId);
  }
}

async function refreshState(): Promise<void> {
  const response = await sendBg({ type: "GET_STATE" });
  if (!response.ok) {
    setStatus(recStatus, "bad", response.error);
    return;
  }
  applySessionUi(response.session);
}

async function saveSettings(): Promise<void> {
  const url = normalizeUrl(serverUrlInput.value);
  serverUrlInput.value = url;
  await chrome.storage.local.set({
    serverUrl: url,
    captureUrlPattern: patternInput.value.trim(),
  });
  serverOk = await checkHealth(url);
  await refreshState();
}

async function micPermissionState(): Promise<PermissionState | "unknown"> {
  try {
    const status = await navigator.permissions.query({
      name: "microphone" as PermissionName,
    });
    return status.state;
  } catch {
    return "unknown";
  }
}

async function openMicPermissionPage(): Promise<void> {
  const url = chrome.runtime.getURL("mic-permission.html");
  await chrome.tabs.create({ url, active: true });
}

async function onStart(): Promise<void> {
  const serverUrl = normalizeUrl(serverUrlInput.value);
  serverUrlInput.value = serverUrl;
  await chrome.storage.local.set({
    serverUrl,
    captureUrlPattern: patternInput.value.trim(),
  });

  serverOk = await checkHealth(serverUrl);
  if (!serverOk) {
    setStatus(recStatus, "bad", "Сервер недоступен — запись не начата");
    syncStartEnabled(false, false);
    return;
  }

  const target = selectedTarget;
  if (!target) {
    setStatus(recStatus, "bad", "Выберите вкладку в списке");
    return;
  }
  if (!isCapturableUrl(target.pageUrl)) {
    setStatus(recStatus, "bad", "Нельзя захватывать chrome:// и служебные страницы");
    return;
  }
  if (!patternMatches(patternInput.value, target.pageUrl)) {
    setStatus(
      recStatus,
      "bad",
      `URL не содержит фильтр «${patternInput.value.trim()}» — смените вкладку или фильтр`,
    );
    return;
  }

  setStatus(recStatus, "pending", "Проверка микрофона…");
  // Never call getUserMedia from the popup: Chrome closes it when the permission
  // dialog opens → "Permission dismissed".
  const micState = await micPermissionState();
  if (micState !== "granted") {
    await openMicPermissionPage();
    setStatus(
      recStatus,
      "bad",
      micState === "denied"
        ? "Микрофон запрещён. Разрешите его на открывшейся странице (или в настройках Chrome) и снова нажмите Старт."
        : "Открылась вкладка «Доступ к микрофону». Нажмите «Разрешить», закройте её и снова Старт.",
    );
    return;
  }

  setStatus(recStatus, "pending", "Подготовка offscreen…");
  const ready = await sendBg({ type: "ENSURE_OFFSCREEN" });
  if (!ready.ok) {
    setStatus(recStatus, "bad", ready.error);
    return;
  }

  let streamId: string;
  try {
    streamId = await chrome.tabCapture.getMediaStreamId({ targetTabId: target.tabId });
  } catch (error) {
    setStatus(
      recStatus,
      "bad",
      `Отказ в захвате: ${error instanceof Error ? error.message : String(error)}`,
    );
    return;
  }

  setStatus(recStatus, "pending", "Запуск записи (вкладка + микрофон)…");
  const started = await chrome.runtime.sendMessage({
    type: "OFFSCREEN_START",
    streamId,
  });
  if (!started?.ok) {
    setStatus(recStatus, "bad", started?.error || "Не удалось начать захват аудио");
    return;
  }

  const sessionResp = await sendBg({
    type: "SESSION_STARTED",
    tabId: target.tabId,
    pageUrl: target.pageUrl,
    pageTitle: target.pageTitle,
    serverUrl,
    language: "ru",
  });
  if (!sessionResp.ok) {
    setStatus(recStatus, "bad", sessionResp.error);
    await chrome.runtime.sendMessage({ type: "OFFSCREEN_STOP" }).catch(() => undefined);
    return;
  }
  applySessionUi(sessionResp.session);
}

async function onStop(): Promise<void> {
  const before = await sendBg({ type: "GET_STATE" });
  if (before.ok && before.session?.phase === "uploading") {
    setStatus(recStatus, "pending", "Сброс зависшей загрузки…");
  } else {
    setStatus(recStatus, "pending", "Остановка и загрузка…");
  }
  stopButton.disabled = true;
  const response = await sendBg({ type: "STOP_RECORDING" });
  if (!response.ok) {
    setStatus(recStatus, "bad", response.error);
    await refreshState();
    return;
  }
  applySessionUi(response.session);
}

function stopPolling(): void {
  if (pollTimer) {
    clearInterval(pollTimer);
    pollTimer = null;
  }
}

function startJobPolling(serverUrl: string, jobId: string): void {
  stopPolling();
  setConspectAvailable(jobId, false);
  const tick = async () => {
    try {
      const response = await fetch(`${serverUrl}/v1/jobs/${jobId}`);
      if (!response.ok) throw new Error(String(response.status));
      const body = await response.json();
      const status = String(body.status || "?");
      jobStatus.hidden = false;
      jobStatus.className = "status";
      jobStatus.textContent = `Job ${jobId}: ${jobStatusLabel(status)}${
        body.error ? ` — ${body.error}` : ""
      }`;
      if (status === "done") {
        setStatus(recStatus, "ok", "Конспект готов (сервер: Whisper → Qwen)");
        setConspectAvailable(jobId, true);
        stopPolling();
      } else if (status === "error") {
        setStatus(recStatus, "bad", body.error || "Ошибка обработки на сервере");
        setConspectAvailable(jobId, false);
        stopPolling();
      } else if (status === "transcribing") {
        setStatus(recStatus, "pending", "Сервер: распознавание речи (Whisper)…");
      } else if (status === "summarizing") {
        setStatus(recStatus, "pending", "Сервер: конспект через Qwen…");
      }
    } catch (error) {
      jobStatus.hidden = false;
      jobStatus.className = "status status--bad";
      jobStatus.textContent = `Job ${jobId}: ошибка опроса (${
        error instanceof Error ? error.message : String(error)
      })`;
    }
  };
  void tick();
  pollTimer = setInterval(() => void tick(), 2500);
}

async function onMicToggle(): Promise<void> {
  const before = await sendBg({ type: "GET_STATE" });
  if (!before.ok || before.session?.phase !== "recording") {
    setStatus(recStatus, "bad", "Микрофон можно переключать только во время записи");
    return;
  }
  const nextMuted = !before.session.micMuted;
  const response = await sendBg({ type: "SET_MIC_MUTED", muted: nextMuted });
  if (!response.ok) {
    setStatus(recStatus, "bad", response.error);
    return;
  }
  applySessionUi(response.session);
}

async function onOpenConspect(): Promise<void> {
  const jobId = lastJobId;
  if (!jobId) return;
  const serverUrl = normalizeUrl(serverUrlInput.value);
  await chrome.tabs.create({
    url: `${serverUrl}/v1/jobs/${jobId}/conspect.md`,
    active: true,
  });
}

async function init(): Promise<void> {
  const stored = await chrome.storage.local.get([
    "serverUrl",
    "captureUrlPattern",
    "lastJobId",
    "lastJobReady",
  ]);
  const url =
    typeof stored.serverUrl === "string" && stored.serverUrl
      ? stored.serverUrl
      : DEFAULT_SERVER_URL;
  serverUrlInput.value = url;
  patternInput.value =
    typeof stored.captureUrlPattern === "string" ? stored.captureUrlPattern : "";
  if (typeof stored.lastJobId === "string" && stored.lastJobId) {
    setConspectAvailable(stored.lastJobId, Boolean(stored.lastJobReady));
  }
  serverOk = await checkHealth(url);
  await refreshTabList();
  await refreshState();
}

tabSelect.addEventListener("change", () => {
  const id = Number(tabSelect.value);
  const label = tabSelect.selectedOptions[0]?.textContent || "";
  void chrome.tabs.get(id).then((tab) => {
    selectedTarget = {
      tabId: id,
      pageUrl: tab.url || "",
      pageTitle: tab.title || label,
    };
    renderTarget(selectedTarget, false);
    syncStartEnabled(false, false);
  });
});

saveButton.addEventListener("click", () => void saveSettings());
serverUrlInput.addEventListener("change", () => void saveSettings());
serverUrlInput.addEventListener("blur", () => void saveSettings());
patternInput.addEventListener("change", () => {
  void chrome.storage.local.set({ captureUrlPattern: patternInput.value.trim() });
  syncStartEnabled(false, false);
});
refreshTabsButton.addEventListener("click", () => void refreshTabList());
startButton.addEventListener("click", () => void onStart());
stopButton.addEventListener("click", () => void onStop());
micToggleButton.addEventListener("click", () => void onMicToggle());
openConspectButton.addEventListener("click", () => void onOpenConspect());
void init();

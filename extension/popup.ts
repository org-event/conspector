import type { BgResponse, RecordingSession } from "./lib/types";

const DEFAULT_SERVER_URL =
  (import.meta.env.VITE_DEFAULT_SERVER_URL as string | undefined)?.trim() ||
  "http://127.0.0.1:8765";

const serverUrlInput = document.getElementById("serverUrl") as HTMLInputElement;
const patternInput = document.getElementById("captureUrlPattern") as HTMLInputElement;
const tabSelect = document.getElementById("tabSelect") as HTMLSelectElement;
const saveButton = document.getElementById("save") as HTMLButtonElement;
const refreshTabsButton = document.getElementById("refreshTabs") as HTMLButtonElement;
const startButton = document.getElementById("start") as HTMLButtonElement;
const stopButton = document.getElementById("stop") as HTMLButtonElement;
const serverStatus = document.getElementById("serverStatus") as HTMLDivElement;
const recStatus = document.getElementById("recStatus") as HTMLDivElement;
const jobStatus = document.getElementById("jobStatus") as HTMLDivElement;
const targetTitle = document.getElementById("targetTitle") as HTMLDivElement;
const targetUrl = document.getElementById("targetUrl") as HTMLDivElement;

type Target = { tabId: number; pageUrl: string; pageTitle: string };

let selectedTarget: Target | null = null;
let serverOk = false;
let pollTimer: ReturnType<typeof setInterval> | null = null;

function normalizeUrl(raw: string): string {
  const trimmed = raw.trim();
  if (!trimmed) return DEFAULT_SERVER_URL;
  return trimmed.replace(/\/+$/, "");
}

function setBadge(el: HTMLElement, kind: "pending" | "ok" | "bad" | "", text: string): void {
  el.textContent = text;
  el.className = kind;
}

async function sendBg(message: unknown): Promise<BgResponse> {
  return chrome.runtime.sendMessage(message) as Promise<BgResponse>;
}

function isCapturableUrl(url: string): boolean {
  return /^https?:\/\//i.test(url);
}

async function checkHealth(serverUrl: string): Promise<boolean> {
  setBadge(serverStatus, "pending", "Проверка сервера…");
  try {
    const response = await fetch(`${serverUrl}/health`);
    if (!response.ok) throw new Error(String(response.status));
    const body = await response.json();
    if (body?.ok) {
      setBadge(serverStatus, "ok", "Сервер доступен");
      return true;
    }
    setBadge(serverStatus, "bad", "Сервер недоступен");
    return false;
  } catch {
    setBadge(serverStatus, "bad", "Сервер недоступен — запустите uvicorn");
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

function patternMatches(pattern: string, url: string): boolean {
  const p = pattern.trim();
  if (!p) return true;
  return url.includes(p);
}

function syncStartEnabled(recording: boolean, uploading: boolean): void {
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

  const blocked = reason.length > 0;
  startButton.disabled = recording || uploading || blocked;
  startButton.title = blocked ? `Старт недоступен: ${reason.join(", ")}` : "Начать запись выбранной вкладки";
  if (!recording && !uploading && blocked) {
    setBadge(recStatus, "", `Старт недоступен: ${reason.join(", ")}`);
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
    const host = (() => {
      try {
        return new URL(tab.url || "").host;
      } catch {
        return tab.url || "";
      }
    })();
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

function applySessionUi(session: RecordingSession | null): void {
  const recording = session?.phase === "recording";
  const uploading = session?.phase === "uploading";
  stopButton.disabled = !recording;
  refreshTabsButton.disabled = recording || uploading;
  tabSelect.disabled = recording || uploading;
  patternInput.disabled = recording || uploading;

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
    setBadge(recStatus, "", "Не записывает");
    jobStatus.hidden = true;
    return;
  }
  if (session.phase === "recording") {
    setBadge(recStatus, "ok", "Идёт запись…");
    jobStatus.hidden = true;
    return;
  }
  if (session.phase === "uploading") {
    setBadge(recStatus, "pending", "Остановка и загрузка…");
    jobStatus.hidden = true;
    return;
  }
  if (session.phase === "error") {
    setBadge(recStatus, "bad", session.error || "Ошибка записи");
    jobStatus.hidden = true;
    return;
  }
  if (session.phase === "done" && session.jobId) {
    setBadge(recStatus, "ok", "Запись отправлена");
    jobStatus.hidden = false;
    jobStatus.textContent = `Job ${session.jobId}: ${session.jobStatus || "queued"}`;
    startJobPolling(normalizeUrl(serverUrlInput.value), session.jobId);
  }
}

async function refreshState(): Promise<void> {
  const response = await sendBg({ type: "GET_STATE" });
  if (!response.ok) {
    setBadge(recStatus, "bad", response.error);
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

async function onStart(): Promise<void> {
  const serverUrl = normalizeUrl(serverUrlInput.value);
  serverUrlInput.value = serverUrl;
  await chrome.storage.local.set({
    serverUrl,
    captureUrlPattern: patternInput.value.trim(),
  });

  serverOk = await checkHealth(serverUrl);
  if (!serverOk) {
    setBadge(recStatus, "bad", "Сервер недоступен — запись не начата");
    syncStartEnabled(false, false);
    return;
  }

  const target = selectedTarget;
  if (!target) {
    setBadge(recStatus, "bad", "Выберите вкладку в списке");
    return;
  }
  if (!isCapturableUrl(target.pageUrl)) {
    setBadge(recStatus, "bad", "Нельзя захватывать chrome:// и служебные страницы");
    return;
  }
  if (!patternMatches(patternInput.value, target.pageUrl)) {
    setBadge(
      recStatus,
      "bad",
      `URL не содержит фильтр «${patternInput.value.trim()}» — смените вкладку или фильтр`,
    );
    return;
  }

  setBadge(recStatus, "pending", "Подготовка offscreen…");
  const ready = await sendBg({ type: "ENSURE_OFFSCREEN" });
  if (!ready.ok) {
    setBadge(recStatus, "bad", ready.error);
    return;
  }

  let streamId: string;
  try {
    streamId = await chrome.tabCapture.getMediaStreamId({ targetTabId: target.tabId });
  } catch (error) {
    setBadge(
      recStatus,
      "bad",
      `Отказ в захвате: ${error instanceof Error ? error.message : String(error)}`,
    );
    return;
  }

  setBadge(recStatus, "pending", "Запуск MediaRecorder…");
  // Speak to offscreen immediately (same user-gesture chain as getMediaStreamId).
  const started = await chrome.runtime.sendMessage({
    type: "OFFSCREEN_START",
    streamId,
  });
  if (!started?.ok) {
    setBadge(recStatus, "bad", started?.error || "Не удалось начать захват аудио");
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
    setBadge(recStatus, "bad", sessionResp.error);
    await chrome.runtime.sendMessage({ type: "OFFSCREEN_STOP" }).catch(() => undefined);
    return;
  }
  applySessionUi(sessionResp.session);
}

async function onStop(): Promise<void> {
  setBadge(recStatus, "pending", "Остановка…");
  stopButton.disabled = true;
  const response = await sendBg({ type: "STOP_RECORDING" });
  if (!response.ok) {
    setBadge(recStatus, "bad", response.error);
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
  const tick = async () => {
    try {
      const response = await fetch(`${serverUrl}/v1/jobs/${jobId}`);
      if (!response.ok) throw new Error(String(response.status));
      const body = await response.json();
      jobStatus.hidden = false;
      jobStatus.textContent = `Job ${jobId}: ${body.status}${body.error ? ` — ${body.error}` : ""}`;
      if (body.status === "done" || body.status === "error") {
        stopPolling();
      }
    } catch (error) {
      jobStatus.hidden = false;
      jobStatus.textContent = `Job ${jobId}: ошибка опроса (${error instanceof Error ? error.message : String(error)})`;
    }
  };
  void tick();
  pollTimer = setInterval(() => void tick(), 2500);
}

async function init(): Promise<void> {
  const stored = await chrome.storage.local.get(["serverUrl", "captureUrlPattern"]);
  const url =
    typeof stored.serverUrl === "string" && stored.serverUrl ? stored.serverUrl : DEFAULT_SERVER_URL;
  serverUrlInput.value = url;
  patternInput.value = typeof stored.captureUrlPattern === "string" ? stored.captureUrlPattern : "";
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
init();

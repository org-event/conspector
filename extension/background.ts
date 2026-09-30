import { setActionIcon, syncIconFromSession } from "./lib/icon";
import { SESSION_KEY, type BgMessage, type BgResponse, type RecordingSession } from "./lib/types";

const OFFSCREEN_URL = "offscreen.html";
const OFFSCREEN_REASONS: chrome.offscreen.Reason[] = [chrome.offscreen.Reason.USER_MEDIA];

async function readSession(): Promise<RecordingSession | null> {
  const stored = await chrome.storage.session.get(SESSION_KEY);
  const value = stored[SESSION_KEY];
  return value && typeof value === "object" ? (value as RecordingSession) : null;
}

async function writeSession(session: RecordingSession | null): Promise<void> {
  if (session) {
    await chrome.storage.session.set({ [SESSION_KEY]: session });
  } else {
    await chrome.storage.session.remove(SESSION_KEY);
  }
  await syncIconFromSession();
}

async function pingOffscreen(): Promise<boolean> {
  try {
    const response = await chrome.runtime.sendMessage({ type: "OFFSCREEN_PING" });
    return Boolean(response?.ok);
  } catch {
    return false;
  }
}

async function ensureOffscreen(): Promise<void> {
  if (await pingOffscreen()) return;

  const contexts = await chrome.runtime.getContexts({
    contextTypes: [chrome.runtime.ContextType.OFFSCREEN_DOCUMENT],
  });
  // Exists but silent (broken script/load) — recreate instead of waiting forever.
  if (contexts.length > 0) {
    await chrome.offscreen.closeDocument();
  }

  await chrome.offscreen.createDocument({
    url: OFFSCREEN_URL,
    reasons: OFFSCREEN_REASONS,
    justification: "Запись аудио вкладки через MediaRecorder",
  });

  for (let i = 0; i < 40; i++) {
    if (await pingOffscreen()) return;
    await new Promise((r) => setTimeout(r, 50));
  }
  throw new Error("Offscreen-документ не ответил (перезагрузите расширение)");
}

function uuid(): string {
  return crypto.randomUUID().replace(/-/g, "");
}

async function sessionStarted(
  msg: Extract<BgMessage, { type: "SESSION_STARTED" }>,
): Promise<BgResponse> {
  const existing = await readSession();
  if (existing && (existing.phase === "recording" || existing.phase === "uploading")) {
    return { ok: false, error: "Запись уже идёт" };
  }
  const session: RecordingSession = {
    tabId: msg.tabId,
    pageUrl: msg.pageUrl,
    pageTitle: msg.pageTitle,
    sessionId: `s_${uuid()}`,
    startedAtIso: new Date().toISOString(),
    startedAtMs: Date.now(),
    phase: "recording",
    micMuted: false,
  };
  await writeSession(session);
  await chrome.storage.session.set({
    pendingUpload: {
      serverUrl: msg.serverUrl,
      language: msg.language,
    },
  });
  await setActionIcon("rec");
  return { ok: true, session };
}

async function setMicMuted(muted: boolean): Promise<BgResponse> {
  const session = await readSession();
  if (!session || session.phase !== "recording") {
    return { ok: false, error: "Микрофон можно переключать только во время записи" };
  }
  const result = await chrome.runtime.sendMessage({
    type: "OFFSCREEN_SET_MIC_MUTED",
    muted,
  });
  if (!result?.ok) {
    return { ok: false, error: result?.error || "Не удалось переключить микрофон" };
  }
  session.micMuted = Boolean(result.micMuted ?? muted);
  await writeSession(session);
  return { ok: true, session };
}

async function stopRecording(): Promise<BgResponse> {
  const session = await readSession();
  if (!session || (session.phase !== "recording" && session.phase !== "uploading")) {
    return { ok: false, error: "Нет активной записи" };
  }

  // Stuck upload recovery: clear without re-sending audio.
  if (session.phase === "uploading") {
    await chrome.runtime.sendMessage({ type: "OFFSCREEN_STOP" }).catch(() => undefined);
    await writeSession(null);
    await chrome.storage.session.remove("pendingUpload");
    return { ok: false, error: "Загрузка сброшена — попробуйте записать снова" };
  }

  const pending = await chrome.storage.session.get("pendingUpload");
  const uploadMeta = pending.pendingUpload as { serverUrl: string; language: string } | undefined;
  if (!uploadMeta?.serverUrl) {
    return { ok: false, error: "Нет настроек загрузки" };
  }

  session.phase = "uploading";
  await writeSession(session);
  await setActionIcon("rec");

  const durationSec = Math.max(0, (Date.now() - session.startedAtMs) / 1000);
  const meta = JSON.stringify({
    sessionId: session.sessionId,
    startedAtIso: session.startedAtIso,
    durationSec,
    pageUrl: session.pageUrl,
    title: session.pageTitle,
    language: uploadMeta.language || "ru",
  });

  // Upload happens inside offscreen (Blob/FormData) — never Array.from(audio) via messaging.
  const stopped = await chrome.runtime.sendMessage({
    type: "OFFSCREEN_STOP",
    serverUrl: uploadMeta.serverUrl,
    meta,
  });
  if (!stopped?.ok) {
    const error = stopped?.error || "Не удалось остановить запись / загрузить";
    session.phase = "error";
    session.error = error;
    await writeSession(session);
    return { ok: false, error };
  }

  session.phase = "done";
  session.jobId = stopped.jobId as string;
  session.jobStatus = (stopped.jobStatus as string) || "queued";
  session.error = undefined;
  await writeSession(session);
  await chrome.storage.session.remove("pendingUpload");
  return { ok: true, session };
}

chrome.runtime.onInstalled.addListener(() => {
  void setActionIcon("off");
});

chrome.runtime.onStartup.addListener(() => {
  void syncIconFromSession();
});

void syncIconFromSession();

chrome.runtime.onMessage.addListener((message: BgMessage, _sender, sendResponse) => {
  const reply = (response: BgResponse) => sendResponse(response);

  if (message?.type === "SET_SERVER_OK") {
    void chrome.storage.session
      .set({ serverOk: message.ok })
      .then(() => syncIconFromSession())
      .then(() => reply({ ok: true, session: null }))
      .catch((error: unknown) =>
        reply({ ok: false, error: error instanceof Error ? error.message : String(error) }),
      );
    return true;
  }
  if (message?.type === "ENSURE_OFFSCREEN") {
    ensureOffscreen()
      .then(() => reply({ ok: true, session: null }))
      .catch((error: unknown) =>
        reply({ ok: false, error: error instanceof Error ? error.message : String(error) }),
      );
    return true;
  }
  if (message?.type === "SESSION_STARTED") {
    sessionStarted(message)
      .then(reply)
      .catch((error: unknown) =>
        reply({ ok: false, error: error instanceof Error ? error.message : String(error) }),
      );
    return true;
  }
  if (message?.type === "GET_STATE") {
    readSession()
      .then((session) => reply({ ok: true, session }))
      .catch((error: unknown) =>
        reply({ ok: false, error: error instanceof Error ? error.message : String(error) }),
      );
    return true;
  }
  if (message?.type === "CLEAR_SESSION") {
    writeSession(null)
      .then(() => reply({ ok: true, session: null }))
      .catch((error: unknown) =>
        reply({ ok: false, error: error instanceof Error ? error.message : String(error) }),
      );
    return true;
  }
  if (message?.type === "STOP_RECORDING") {
    stopRecording()
      .then(reply)
      .catch((error: unknown) =>
        reply({ ok: false, error: error instanceof Error ? error.message : String(error) }),
      );
    return true;
  }
  if (message?.type === "SET_MIC_MUTED") {
    setMicMuted(Boolean(message.muted))
      .then(reply)
      .catch((error: unknown) =>
        reply({ ok: false, error: error instanceof Error ? error.message : String(error) }),
      );
    return true;
  }
  return false;
});

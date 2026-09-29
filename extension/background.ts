import { SESSION_KEY, type BgMessage, type BgResponse, type RecordingSession } from "./lib/types";

const OFFSCREEN_URL = "offscreen.html";
const OFFSCREEN_REASONS: chrome.offscreen.Reason[] = ["USER_MEDIA"];

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
  };
  await writeSession(session);
  await chrome.storage.session.set({
    pendingUpload: {
      serverUrl: msg.serverUrl,
      language: msg.language,
    },
  });
  return { ok: true, session };
}

async function stopRecording(): Promise<BgResponse> {
  const session = await readSession();
  if (!session || session.phase !== "recording") {
    return { ok: false, error: "Нет активной записи" };
  }

  const pending = await chrome.storage.session.get("pendingUpload");
  const uploadMeta = pending.pendingUpload as { serverUrl: string; language: string } | undefined;
  if (!uploadMeta?.serverUrl) {
    return { ok: false, error: "Нет настроек загрузки" };
  }

  session.phase = "uploading";
  await writeSession(session);

  const stopped = await chrome.runtime.sendMessage({ type: "OFFSCREEN_STOP" });
  if (!stopped?.ok) {
    session.phase = "error";
    session.error = stopped?.error || "Не удалось остановить запись";
    await writeSession(session);
    return { ok: false, error: session.error };
  }

  const size = Number(stopped.size || 0);
  const byteList = stopped.bytes as number[] | undefined;
  if (!size || !byteList?.length) {
    session.phase = "error";
    session.error = "Пустая запись: нет аудиоданных (вкладка без звука?)";
    await writeSession(session);
    return { ok: false, error: session.error };
  }

  const durationSec = Math.max(0, (Date.now() - session.startedAtMs) / 1000);
  const audioBlob = new Blob([new Uint8Array(byteList)], {
    type: stopped.mimeType || "audio/webm",
  });
  const speakersBlob = new Blob([""], { type: "application/x-ndjson" });
  const meta = JSON.stringify({
    sessionId: session.sessionId,
    startedAtIso: session.startedAtIso,
    durationSec,
    pageUrl: session.pageUrl,
    title: session.pageTitle,
    language: uploadMeta.language || "ru",
  });

  try {
    const form = new FormData();
    form.append("audio", audioBlob, "meeting.webm");
    form.append("speakers", speakersBlob, "speakers.jsonl");
    form.append("meta", meta);

    const response = await fetch(`${uploadMeta.serverUrl}/v1/jobs`, {
      method: "POST",
      body: form,
    });
    if (!response.ok) {
      throw new Error(`Сервер вернул ${response.status}`);
    }
    const body = (await response.json()) as { id?: string; status?: string };
    if (!body.id) {
      throw new Error("Сервер не вернул id job");
    }
    session.phase = "done";
    session.jobId = body.id;
    session.jobStatus = body.status || "queued";
    session.error = undefined;
    await writeSession(session);
    await chrome.storage.session.remove("pendingUpload");
    return { ok: true, session };
  } catch (error) {
    session.phase = "error";
    session.error = error instanceof Error ? error.message : String(error);
    await writeSession(session);
    return { ok: false, error: session.error };
  }
}

chrome.runtime.onMessage.addListener((message: BgMessage, _sender, sendResponse) => {
  const reply = (response: BgResponse) => sendResponse(response);

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
  return false;
});

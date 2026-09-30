type OffscreenMsg =
  | { type: "OFFSCREEN_PING" }
  | { type: "OFFSCREEN_START"; streamId: string }
  | { type: "OFFSCREEN_STOP"; serverUrl?: string; meta?: string }
  | { type: "OFFSCREEN_SET_MIC_MUTED"; muted: boolean };

let tabStream: MediaStream | null = null;
let micStream: MediaStream | null = null;
let recorder: MediaRecorder | null = null;
let audioContext: AudioContext | null = null;
let micMuted = false;
const chunks: BlobPart[] = [];

function applyMicMute(): void {
  micStream?.getAudioTracks().forEach((t) => {
    t.enabled = !micMuted;
  });
}

function setMicMuted(muted: boolean): void {
  micMuted = muted;
  applyMicMute();
}

function stopAllTracks(): void {
  tabStream?.getTracks().forEach((t) => t.stop());
  micStream?.getTracks().forEach((t) => t.stop());
  tabStream = null;
  micStream = null;
  micMuted = false;
}

function closeAudioGraph(): void {
  void audioContext?.close().catch(() => undefined);
  audioContext = null;
}

/**
 * Mix tab audio + microphone into one MediaStream for MediaRecorder.
 * Only tab audio is played to speakers (so the meeting stays audible and mic
 * does not echo back into the headset).
 */
async function startMixedCapture(streamId: string): Promise<MediaStream> {
  const tabConstraints = {
    audio: {
      mandatory: {
        chromeMediaSource: "tab",
        chromeMediaSourceId: streamId,
      },
    },
    video: false,
  } as unknown as MediaStreamConstraints;

  tabStream = await navigator.mediaDevices.getUserMedia(tabConstraints);

  try {
    micStream = await navigator.mediaDevices.getUserMedia({
      audio: {
        echoCancellation: true,
        noiseSuppression: true,
        autoGainControl: true,
      },
      video: false,
    });
  } catch (error) {
    stopAllTracks();
    throw new Error(
      `Нужен доступ к микрофону (свой голос в конференции иначе не попадёт в запись): ${
        error instanceof Error ? error.message : String(error)
      }`,
    );
  }

  closeAudioGraph();
  const ctx = new AudioContext();
  const tabSource = ctx.createMediaStreamSource(tabStream);
  const micSource = ctx.createMediaStreamSource(micStream);
  const mixDest = ctx.createMediaStreamDestination();

  // Hear the meeting (tabCapture mutes the tab until played back).
  tabSource.connect(ctx.destination);
  // Record both sides of the conference.
  tabSource.connect(mixDest);
  micSource.connect(mixDest);

  if (ctx.state === "suspended") {
    await ctx.resume();
  }
  audioContext = ctx;
  applyMicMute();
  return mixDest.stream;
}

async function start(streamId: string): Promise<void> {
  if (recorder && recorder.state !== "inactive") {
    throw new Error("Запись уже идёт");
  }
  chunks.length = 0;
  micMuted = false;

  const mixed = await startMixedCapture(streamId);
  const mime = MediaRecorder.isTypeSupported("audio/webm;codecs=opus")
    ? "audio/webm;codecs=opus"
    : "audio/webm";
  recorder = new MediaRecorder(mixed, { mimeType: mime });
  recorder.ondataavailable = (event) => {
    if (event.data && event.data.size > 0) chunks.push(event.data);
  };
  recorder.start(1000);
}

function stopRecorder(): Promise<Blob> {
  return new Promise((resolve, reject) => {
    if (!recorder || recorder.state === "inactive") {
      reject(new Error("Запись не активна"));
      return;
    }
    const rec = recorder;
    rec.onstop = () => {
      closeAudioGraph();
      stopAllTracks();
      recorder = null;
      const blob = new Blob(chunks, { type: rec.mimeType || "audio/webm" });
      chunks.length = 0;
      resolve(blob);
    };
    rec.stop();
  });
}

/** Stop capture and optionally POST multipart to the server (no giant message payloads). */
async function stopAndUpload(
  serverUrl?: string,
  meta?: string,
): Promise<{ ok: true; size: number; jobId?: string; jobStatus?: string } | { ok: false; error: string }> {
  const blob = await stopRecorder();
  if (!serverUrl || !meta) {
    return { ok: true, size: blob.size };
  }
  if (!blob.size) {
    return { ok: false, error: "Пустая запись: нет аудиоданных (вкладка без звука?)" };
  }

  const form = new FormData();
  form.append("audio", blob, "meeting.webm");
  form.append("speakers", new Blob([""], { type: "application/x-ndjson" }), "speakers.jsonl");
  form.append("meta", meta);

  const response = await fetch(`${serverUrl.replace(/\/+$/, "")}/v1/jobs`, {
    method: "POST",
    body: form,
  });
  if (!response.ok) {
    return { ok: false, error: `Сервер вернул ${response.status}` };
  }
  const body = (await response.json()) as { id?: string; status?: string };
  if (!body.id) {
    return { ok: false, error: "Сервер не вернул id job" };
  }
  return { ok: true, size: blob.size, jobId: body.id, jobStatus: body.status || "queued" };
}

chrome.runtime.onMessage.addListener((message: OffscreenMsg, _sender, sendResponse) => {
  if (message?.type === "OFFSCREEN_PING") {
    sendResponse({ ok: true });
    return false;
  }
  if (message?.type === "OFFSCREEN_START") {
    start(message.streamId)
      .then(() => sendResponse({ ok: true }))
      .catch((error: unknown) =>
        sendResponse({ ok: false, error: error instanceof Error ? error.message : String(error) }),
      );
    return true;
  }
  if (message?.type === "OFFSCREEN_STOP") {
    stopAndUpload(message.serverUrl, message.meta)
      .then((result) => sendResponse(result))
      .catch((error: unknown) =>
        sendResponse({ ok: false, error: error instanceof Error ? error.message : String(error) }),
      );
    return true;
  }
  if (message?.type === "OFFSCREEN_SET_MIC_MUTED") {
    if (!recorder || recorder.state === "inactive") {
      sendResponse({ ok: false, error: "Запись не активна" });
      return false;
    }
    setMicMuted(Boolean(message.muted));
    sendResponse({ ok: true, micMuted });
    return false;
  }
  return false;
});

type OffscreenMsg =
  | { type: "OFFSCREEN_PING" }
  | { type: "OFFSCREEN_START"; streamId: string }
  | { type: "OFFSCREEN_STOP" };

let mediaStream: MediaStream | null = null;
let recorder: MediaRecorder | null = null;
let audioContext: AudioContext | null = null;
const chunks: BlobPart[] = [];

function stopPlayback(): void {
  void audioContext?.close().catch(() => undefined);
  audioContext = null;
}

async function startPlayback(stream: MediaStream): Promise<void> {
  // tabCapture mutes the tab until the captured stream is played back locally.
  stopPlayback();
  const ctx = new AudioContext();
  const source = ctx.createMediaStreamSource(stream);
  source.connect(ctx.destination);
  if (ctx.state === "suspended") {
    await ctx.resume();
  }
  audioContext = ctx;
}

async function start(streamId: string): Promise<void> {
  if (recorder && recorder.state !== "inactive") {
    throw new Error("Запись уже идёт");
  }
  chunks.length = 0;

  // Chrome tab-capture constraints (legacy `mandatory` form required by Chromium).
  const constraints = {
    audio: {
      mandatory: {
        chromeMediaSource: "tab",
        chromeMediaSourceId: streamId,
      },
    },
    video: false,
  } as unknown as MediaStreamConstraints;

  mediaStream = await navigator.mediaDevices.getUserMedia(constraints);
  await startPlayback(mediaStream);

  const mime = MediaRecorder.isTypeSupported("audio/webm;codecs=opus")
    ? "audio/webm;codecs=opus"
    : "audio/webm";
  recorder = new MediaRecorder(mediaStream, { mimeType: mime });
  recorder.ondataavailable = (event) => {
    if (event.data && event.data.size > 0) chunks.push(event.data);
  };
  recorder.start(1000);
}

function stop(): Promise<Blob> {
  return new Promise((resolve, reject) => {
    if (!recorder || recorder.state === "inactive") {
      reject(new Error("Запись не активна"));
      return;
    }
    const rec = recorder;
    rec.onstop = () => {
      stopPlayback();
      mediaStream?.getTracks().forEach((t) => t.stop());
      mediaStream = null;
      recorder = null;
      const blob = new Blob(chunks, { type: rec.mimeType || "audio/webm" });
      chunks.length = 0;
      resolve(blob);
    };
    rec.stop();
  });
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
    stop()
      .then(async (blob) => {
        const bytes = new Uint8Array(await blob.arrayBuffer());
        sendResponse({
          ok: true,
          mimeType: blob.type || "audio/webm",
          size: blob.size,
          // structured-clone friendly
          bytes: Array.from(bytes),
        });
      })
      .catch((error: unknown) =>
        sendResponse({ ok: false, error: error instanceof Error ? error.message : String(error) }),
      );
    return true;
  }
  return false;
});

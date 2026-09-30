export type RecordingPhase = "idle" | "recording" | "uploading" | "done" | "error";

export type RecordingSession = {
  tabId: number;
  pageUrl: string;
  pageTitle: string;
  sessionId: string;
  startedAtIso: string;
  startedAtMs: number;
  phase: RecordingPhase;
  /** Mic feed muted in the mix (tab audio keeps recording). */
  micMuted?: boolean;
  jobId?: string;
  jobStatus?: string;
  error?: string;
};

export type BgMessage =
  | { type: "ENSURE_OFFSCREEN" }
  | {
      type: "SESSION_STARTED";
      tabId: number;
      pageUrl: string;
      pageTitle: string;
      serverUrl: string;
      language: string;
    }
  | { type: "STOP_RECORDING" }
  | { type: "SET_MIC_MUTED"; muted: boolean }
  | { type: "GET_STATE" }
  | { type: "CLEAR_SESSION" }
  | { type: "SET_SERVER_OK"; ok: boolean };

export type BgResponse =
  | { ok: true; session: RecordingSession | null }
  | { ok: false; error: string };

export const SESSION_KEY = "recordingSession";

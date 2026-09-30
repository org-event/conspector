/** Toolbar icon (green = server ok, red = recording, gray = offline). */

export type IconMode = "ok" | "rec" | "off";

const PATHS: Record<IconMode, Record<number, string>> = {
  ok: { 16: "icons/ok-16.png", 32: "icons/ok-32.png", 48: "icons/ok-48.png" },
  rec: { 16: "icons/rec-16.png", 32: "icons/rec-32.png", 48: "icons/rec-48.png" },
  off: { 16: "icons/off-16.png", 32: "icons/off-32.png", 48: "icons/off-48.png" },
};

const TITLES: Record<IconMode, string> = {
  ok: "Conspector — сервер доступен",
  rec: "Conspector — идёт запись",
  off: "Conspector — сервер недоступен",
};

export async function setActionIcon(mode: IconMode): Promise<void> {
  try {
    await chrome.action.setIcon({ path: PATHS[mode] });
    await chrome.action.setTitle({ title: TITLES[mode] });
  } catch {
    // Ignore — e.g. during install before icons are ready.
  }
}

export async function syncIconFromSession(): Promise<void> {
  const { recordingSession } = await chrome.storage.session.get("recordingSession");
  const session = recordingSession as { phase?: string } | undefined;
  if (session?.phase === "recording" || session?.phase === "uploading") {
    await setActionIcon("rec");
    return;
  }
  const { serverOk } = await chrome.storage.session.get("serverOk");
  await setActionIcon(serverOk === true ? "ok" : "off");
}

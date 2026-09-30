function $(id: string): HTMLElement {
  const el = document.getElementById(id);
  if (!el) throw new Error(`Missing #${id}`);
  return el;
}

const grantButton = $("grant") as HTMLButtonElement;
const statusEl = $("status");

function setStatus(kind: "ok" | "bad" | "pending" | "", text: string): void {
  statusEl.className = kind ? `status status--${kind}` : "status";
  statusEl.textContent = text;
}

async function grantMic(): Promise<void> {
  setStatus("pending", "Запрос доступа…");
  try {
    const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
    stream.getTracks().forEach((t) => t.stop());
    setStatus(
      "ok",
      "Микрофон разрешён. Закройте эту вкладку и снова нажмите «Старт» в popup Conspector.",
    );
    grantButton.disabled = true;
  } catch (error) {
    setStatus(
      "bad",
      `Не удалось получить доступ: ${error instanceof Error ? error.message : String(error)}. Проверьте настройки Chrome → Конфиденциальность → Микрофон.`,
    );
  }
}

grantButton.addEventListener("click", () => void grantMic());
setStatus("", "Нажмите кнопку ниже — диалог Chrome не сработает из маленького popup.");

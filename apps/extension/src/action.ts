async function openPanel() {
  try {
    const reply = await chrome.runtime.sendMessage({ type: "OPEN_PANEL" });
    if (!reply?.ok)
      throw new Error(
        reply?.error ??
          "Не удалось открыть окно. Обновите страницу и повторите.",
      );
    window.close();
  } catch (error) {
    const status = document.getElementById("status")!;
    status.setAttribute("role", "alert");
    status.textContent =
      error instanceof Error
        ? error.message
        : "Не удалось открыть окно. Обновите страницу и повторите.";
  }
}
void openPanel();

export {};

import { afterEach, expect, it, vi } from "vitest";

afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

it("opens the page panel and closes the toolbar popup", async () => {
  vi.resetModules();
  document.body.innerHTML = '<p id="status" role="status"></p>';
  const sendMessage = vi.fn().mockResolvedValue({ ok: true });
  vi.stubGlobal("chrome", { runtime: { sendMessage } });
  const close = vi.spyOn(window, "close").mockImplementation(() => {});
  await import("./action");
  expect(sendMessage).toHaveBeenCalledWith({ type: "OPEN_PANEL" });
  expect(close).toHaveBeenCalledOnce();
});

it("keeps an unsupported page error in the toolbar popup", async () => {
  vi.resetModules();
  document.body.innerHTML = '<p id="status" role="status"></p>';
  vi.stubGlobal("chrome", {
    runtime: {
      sendMessage: vi.fn().mockResolvedValue({
        ok: false,
        error: "Эта страница не поддерживается",
      }),
    },
  });
  const close = vi.spyOn(window, "close").mockImplementation(() => {});
  await import("./action");
  expect(close).not.toHaveBeenCalled();
  expect(document.querySelector('[role="alert"]')?.textContent).toBe(
    "Эта страница не поддерживается",
  );
});

import { act, createElement } from "react";
import { createRoot } from "react-dom/client";
import { describe, expect, it, vi } from "vitest";
import type { Transport } from "@avari/shared";
import { TelegramConnect, TelegramLogin } from "./Telegram";

(
  globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }
).IS_REACT_ACT_ENVIRONMENT = true;

describe("Telegram auth availability", () => {
  it("hides Telegram login when the server disables it", async () => {
    const api = vi.fn().mockResolvedValue({ enabled: false }) as Transport;
    const container = document.createElement("div");
    const root = createRoot(container);
    try {
      await act(async () =>
        root.render(createElement(TelegramLogin, { api, onLogin: vi.fn() })),
      );
      expect(container.textContent).toBe("");
    } finally {
      act(() => root.unmount());
    }
  });

  it("retries configuration without reloading or submitting the email form", async () => {
    const api = vi
      .fn()
      .mockRejectedValueOnce(new Error("offline"))
      .mockResolvedValue({ enabled: true }) as Transport;
    const container = document.createElement("div");
    const root = createRoot(container);
    try {
      await act(async () =>
        root.render(createElement(TelegramLogin, { api, onLogin: vi.fn() })),
      );
      expect(container.querySelector('[role="status"]')?.textContent).toContain(
        "Можно войти через email",
      );
      await act(async () => container.querySelector("button")!.click());
      expect(container.querySelector("button")?.textContent).toBe(
        "Войти через Telegram",
      );
      expect(container.querySelector("button")?.type).toBe("button");
      expect(container.textContent).toContain("Если Telegram уже подключён");
      expect(api).toHaveBeenCalledTimes(2);
    } finally {
      act(() => root.unmount());
    }
  });

  it("prevents Telegram login during email submission", async () => {
    const api = vi.fn().mockResolvedValue({ enabled: true }) as Transport;
    const container = document.createElement("div");
    const root = createRoot(container);
    try {
      await act(async () =>
        root.render(
          createElement(TelegramLogin, { api, onLogin: vi.fn(), busy: true }),
        ),
      );
      expect(container.querySelector("button")?.disabled).toBe(true);
    } finally {
      act(() => root.unmount());
    }
  });

  it("lets pending users retry Telegram availability", async () => {
    const api = vi
      .fn()
      .mockRejectedValueOnce(new Error("offline"))
      .mockResolvedValue({ enabled: true, link: null }) as Transport;
    const container = document.createElement("div");
    const root = createRoot(container);
    try {
      await act(async () =>
        root.render(
          createElement(TelegramConnect, { api, purpose: "registration" }),
        ),
      );
      expect(container.textContent).toContain("Не удалось проверить");
      await act(async () => container.querySelector("button")!.click());
      expect(container.querySelector("button")?.textContent).toBe(
        "Подтвердить через Telegram",
      );
    } finally {
      act(() => root.unmount());
    }
  });
  it.each(["cancelled", "expired"])(
    "allows a new registration challenge after %s",
    async (status) => {
      vi.useFakeTimers();
      const challenge = {
        id: "challenge-1",
        status: "pending",
        expiresAt: "2030-01-01T12:00:00Z",
      };
      const api = vi
        .fn()
        .mockResolvedValueOnce({ enabled: true, link: null })
        .mockResolvedValueOnce({ challenge, url: "https://t.me/example" })
        .mockResolvedValueOnce({ ...challenge, status })
        .mockResolvedValueOnce({
          challenge: { ...challenge, id: "challenge-2" },
          url: "https://t.me/new",
        }) as Transport;
      const container = document.createElement("div");
      const root = createRoot(container);
      try {
        await act(async () =>
          root.render(
            createElement(TelegramConnect, { api, purpose: "registration" }),
          ),
        );
        await act(async () => container.querySelector("button")!.click());
        expect(container.querySelector("button")?.disabled).toBe(true);
        expect(container.querySelector("a")?.textContent).toBe(
          "Открыть Telegram",
        );
        await act(async () => {
          await vi.advanceTimersByTimeAsync(6000);
        });
        expect(container.querySelector("button")?.textContent).toBe(
          "Начать заново",
        );
        await act(async () => container.querySelector("button")!.click());
        expect(container.querySelector("a")?.href).toBe("https://t.me/new");
      } finally {
        act(() => root.unmount());
        vi.useRealTimers();
      }
    },
  );

  it("completes an approved Telegram login once", async () => {
    vi.useFakeTimers();
    const user = { id: "u1" };
    const onLogin = vi.fn();
    const api = vi
      .fn()
      .mockResolvedValueOnce({ enabled: true })
      .mockResolvedValueOnce({
        challenge: { id: "c1", code: "ABC123" },
        url: "https://t.me/example",
      })
      .mockResolvedValueOnce({ id: "c1", status: "approved" })
      .mockResolvedValueOnce({ user }) as Transport;
    const container = document.createElement("div");
    const root = createRoot(container);
    try {
      await act(async () =>
        root.render(createElement(TelegramLogin, { api, onLogin })),
      );
      await act(async () => container.querySelector("button")!.click());
      await act(async () => {
        await vi.advanceTimersByTimeAsync(12000);
      });
      expect(onLogin).toHaveBeenCalledExactlyOnceWith(user);
      expect(api).toHaveBeenLastCalledWith(
        "/auth/telegram/requests/c1/complete",
        "POST",
        {},
      );
    } finally {
      act(() => root.unmount());
      vi.useRealTimers();
    }
  });
});

import { privateStorage } from "./private-storage";
import type { TelegramChallenge as Challenge } from "@avari/shared";

// Only the background worker imports this module. Its secrets never reach a page.
type Pending = {
  server: string;
  secret: string;
  challenge: Challenge;
  url: string;
};
export type TelegramLoginState = {
  server: string;
  status: "idle" | "completed" | Challenge["status"];
  challenge?: Challenge;
  url?: string;
};
const key = "telegramLogin";
const base = "/api/v1/auth/telegram/extension/requests";

export function telegramAuth(
  config: () => Promise<{ server?: string; token?: string }>,
  onLogin: () => Promise<unknown>,
) {
  async function request(
    server: string,
    path: string,
    method = "GET",
    secret?: string,
  ) {
    const response = await fetch(server + path, {
      method,
      credentials: "omit",
      redirect: "error",
      headers: secret ? { "X-Telegram-Login-Secret": secret } : {},
      signal: AbortSignal.timeout(15000),
    });
    const data = await response.json().catch(() => ({}));
    if (!response.ok)
      throw new Error(
        data.error ||
          "Не удалось выполнить вход через Telegram. Попробуйте снова.",
      );
    return data;
  }
  async function available(server: string) {
    if (!(await chrome.permissions.contains({ origins: [server + "/*"] })))
      return { enabled: true, needsPermission: true };
    try {
      const data = await request(server, "/api/v1/auth/telegram/config");
      return { enabled: data.enabled === true && data.extensionLogin === true };
    } catch {
      return { enabled: false };
    }
  }
  async function state(
    start = false,
    expectedServer?: string,
    restart = false,
  ): Promise<TelegramLoginState> {
    const c = await config();
    if (!c.server) throw new Error("Выберите сервер в расширении");
    if (expectedServer && expectedServer !== c.server)
      throw new Error("Сервер изменён. Начните вход заново из расширения.");
    if (c.token) return { server: c.server, status: "completed" };
    let pending = (await privateStorage.get(key))[key] as Pending | undefined;
    if (pending?.server !== c.server) {
      await clear();
      pending = undefined;
    }
    if (start && (!pending || restart)) {
      await clear();
      const data = await request(c.server, base, "POST");
      const url = new URL(data.url);
      if (url.origin !== "https://t.me" || !data.secret || !data.challenge?.id)
        throw new Error("Некорректный ответ сервера");
      pending = {
        server: c.server,
        secret: data.secret,
        challenge: data.challenge,
        url: url.href,
      };
      await privateStorage.set({ [key]: pending });
    }
    if (!pending) return { server: c.server, status: "idle" };
    const challenge = (await request(
      c.server,
      base + "/" + pending.challenge.id,
      "GET",
      pending.secret,
    )) as Challenge;
    if (challenge.status === "approved") {
      const result = await request(
        c.server,
        base + "/" + challenge.id + "/complete",
        "POST",
        pending.secret,
      );
      if (!result.token || result.session?.kind !== "extension")
        throw new Error("Некорректная сессия расширения");
      await privateStorage.set({ token: result.token });
      await clear();
      // Badge errors must not turn a completed login into an apparent failure.
      await onLogin().catch(() => {});
      return { server: c.server, status: "completed" };
    }
    if (challenge.status === "completed")
      throw new Error("Этот запрос уже использован. Начните вход заново.");
    return {
      server: c.server,
      status: challenge.status,
      challenge,
      url: pending.url,
    };
  }
  async function clear() {
    await privateStorage.remove(key);
  }
  return { available, state, clear };
}

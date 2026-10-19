import { afterEach, expect, it, vi } from "vitest";
import { telegramAuth } from "./telegram-auth";

afterEach(() => vi.unstubAllGlobals());
const server = "https://jobs.example.com";
const challenge = {
  id: "abc123",
  purpose: "login",
  status: "pending",
  code: "ABC123",
  expiresAt: "2099-01-01T00:00:00Z",
};
const pending = {
  server,
  secret: "private-secret",
  challenge,
  url: "https://t.me/test_bot?start=bot-token",
};
function setup(initial: Record<string, unknown> = {}) {
  const storage: Record<string, any> = { server, ...initial };
  vi.stubGlobal("chrome", {
    storage: {
      local: {
        setAccessLevel: vi.fn(),
        get: vi.fn(async (key: string) => ({ [key]: storage[key] })),
        set: vi.fn(async (value: any) => {
          Object.assign(storage, value);
        }),
        remove: vi.fn(async (key: string) => {
          delete storage[key];
        }),
      },
    },
    permissions: { contains: vi.fn(async () => true) },
  });
  const fetch = vi.fn();
  vi.stubGlobal("fetch", fetch);
  const onLogin = vi.fn(async () => {});
  const create = () =>
    telegramAuth(
      async () => ({ server: storage.server, token: storage.token }),
      onLogin,
    );
  return { storage, fetch, onLogin, create };
}
const json = (data: unknown, ok = true) => ({ ok, json: async () => data });

it("keeps the initiating secret in storage and resumes after worker recreation", async () => {
  const { storage, fetch, create, onLogin } = setup();
  fetch
    .mockResolvedValueOnce(json({ ...pending }))
    .mockResolvedValueOnce(json(challenge));
  const first = await create().state(true);
  expect(first).toMatchObject({ status: "pending", url: pending.url });
  expect(JSON.stringify(first)).not.toContain("private-secret");
  expect(storage.telegramLogin).toEqual(pending);
  fetch
    .mockResolvedValueOnce(json({ ...challenge, status: "approved" }))
    .mockResolvedValueOnce(
      json({ token: "session-token", session: { kind: "extension" } }),
    );
  const resumed = await create().state();
  expect(resumed.status).toBe("completed");
  expect(storage.token).toBe("session-token");
  expect(storage.telegramLogin).toBeUndefined();
  expect(onLogin).toHaveBeenCalledOnce();
  expect(JSON.stringify(resumed)).not.toContain("session-token");
  expect(fetch).toHaveBeenLastCalledWith(
    server + "/api/v1/auth/telegram/extension/requests/abc123/complete",
    expect.objectContaining({
      credentials: "omit",
      headers: { "X-Telegram-Login-Secret": "private-secret" },
    }),
  );
});

it("does not consume pending, expired or cancelled challenges", async () => {
  const { storage, fetch, create } = setup({ telegramLogin: pending });
  for (const status of ["pending", "expired", "cancelled"]) {
    fetch.mockResolvedValueOnce(json({ ...challenge, status }));
    expect((await create().state()).status).toBe(status);
  }
  expect(storage.token).toBeUndefined();
  expect(fetch).toHaveBeenCalledTimes(3);
});

it("rejects a changed server and cannot reuse the old secret on the new server", async () => {
  const { storage, fetch, create } = setup({
    telegramLogin: pending,
    server: "https://other.example.com",
  });
  await expect(create().state(false, server)).rejects.toThrow("Сервер изменён");
  expect(fetch).not.toHaveBeenCalled();
  expect((await create().state()).status).toBe("idle");
  expect(storage.telegramLogin).toBeUndefined();
});

it("does not report a consumed request as a successful login without a local token", async () => {
  const { fetch, create } = setup({ telegramLogin: pending });
  fetch.mockResolvedValueOnce(json({ ...challenge, status: "completed" }));
  await expect(create().state()).rejects.toThrow("уже использован");
});

it("retains the pending request on network errors and rejects web sessions", async () => {
  const { storage, fetch, create } = setup({ telegramLogin: pending });
  fetch.mockRejectedValueOnce(new Error("network error"));
  await expect(create().state()).rejects.toThrow("network error");
  expect(storage.telegramLogin).toEqual(pending);
  fetch
    .mockResolvedValueOnce(json({ ...challenge, status: "approved" }))
    .mockResolvedValueOnce(
      json({ token: "web-token", session: { kind: "web" } }),
    );
  await expect(create().state()).rejects.toThrow("Некорректная сессия");
  expect(storage.token).toBeUndefined();
});

it("hides login on disabled, old and unavailable servers", async () => {
  const { fetch, create } = setup();
  for (const data of [
    { enabled: false, extensionLogin: false },
    { enabled: true },
  ]) {
    fetch.mockResolvedValueOnce(json(data));
    expect((await create().available(server)).enabled).toBe(false);
  }
  fetch.mockRejectedValueOnce(new Error("unavailable"));
  expect((await create().available(server)).enabled).toBe(false);
  fetch.mockResolvedValueOnce(json({ enabled: true, extensionLogin: true }));
  expect((await create().available(server)).enabled).toBe(true);
});

it("reuses a pending request when two auth tabs start and replaces it only on explicit restart", async () => {
  const { fetch, create } = setup({ telegramLogin: pending });
  fetch.mockResolvedValueOnce(json(challenge));
  expect((await create().state(true)).url).toBe(pending.url);
  expect(fetch).toHaveBeenCalledTimes(1);
  fetch
    .mockResolvedValueOnce(json({ ...pending, secret: "new-secret" }))
    .mockResolvedValueOnce(json(challenge));
  await create().state(true, server, true);
  expect(fetch).toHaveBeenNthCalledWith(
    2,
    server + "/api/v1/auth/telegram/extension/requests",
    expect.objectContaining({ method: "POST" }),
  );
});

import { afterEach, expect, it, vi } from "vitest";
import { privateStorage, restrictStorage } from "./private-storage";

afterEach(() => {
  vi.unstubAllGlobals();
  localStorage.clear();
});

it("persists Firefox credentials outside content-script-accessible extension storage", async () => {
  const shared: Record<string, any> = { token: "old-token" };
  vi.stubGlobal("chrome", {
    storage: {
      local: {
        get: vi.fn(async (keys: string[]) =>
          Object.fromEntries(keys.map((k) => [k, shared[k]])),
        ),
        set: vi.fn(async (values: any) => {
          Object.assign(shared, values);
        }),
        remove: vi.fn(async (keys: string | string[]) => {
          for (const key of Array.isArray(keys) ? keys : [keys])
            delete shared[key];
        }),
      },
    },
  });
  await restrictStorage(); // Firefox has no setAccessLevel API.
  expect(await privateStorage.get("token")).toEqual({ token: "old-token" });
  expect(shared.token).toBeUndefined();
  await privateStorage.set({
    token: "new-token",
    telegramLogin: { secret: "secret" },
  });
  expect(shared.token).toBeUndefined();
  expect(shared.telegramLogin).toBeUndefined();
  expect(shared.authRevision).toBeTruthy();
  // A new background event page reads the persisted extension-origin storage.
  expect(await privateStorage.get(["token", "telegramLogin"])).toEqual({
    token: "new-token",
    telegramLogin: { secret: "secret" },
  });
  await privateStorage.remove(["token", "telegramLogin"]);
  expect(await privateStorage.get("token")).toEqual({});
});

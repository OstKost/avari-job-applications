import "fake-indexeddb/auto";
import { afterEach, describe, expect, it, vi } from "vitest";
import { APIError, type Transport } from "@avari/shared";
import { createWebAPI, isNetworkError, isOfflineOrReadOnly, requireLiveVerification } from "./policy";
import { closeOfflineDB, clearOfflineCache, getDraft, getSessionState, saveDraft } from "./db";

afterEach(() => { closeOfflineDB(); vi.restoreAllMocks(); requireLiveVerification(); });
const user = { id: "policy-user", email: "policy@test.com", status: "active", timezone: "UTC", createdAt: "2026-10-01" };

describe("web session transport policy", () => {
  it("allows Telegram login before verification and activates offline state only after completion", async () => {
    vi.spyOn(navigator, "onLine", "get").mockReturnValue(true);
    requireLiveVerification();
    const transport = vi.fn().mockResolvedValue({ challenge: { id: "telegram-request" } });
    const api = createWebAPI(transport as Transport);
    await api("/auth/telegram/requests", "POST", {});
    expect(isOfflineOrReadOnly()).toBe(true);
    transport.mockResolvedValueOnce({ user });
    await api("/auth/telegram/requests/telegram-request/complete", "POST", {});
    expect(isOfflineOrReadOnly()).toBe(false);
    expect((await getSessionState(user.id))?.revoked).toBe(false);
  });
  it("rejects unsafe writes before verification and while server is unreachable despite navigator true", async () => {
    vi.spyOn(navigator, "onLine", "get").mockReturnValue(true);
    const transport = vi.fn().mockResolvedValue(user);
    const api = createWebAPI(transport as Transport);
    requireLiveVerification();
    await expect(api("/applications", "POST", {})).rejects.toThrow("проверяется");
    expect(transport).not.toHaveBeenCalled();
    await api("/me");
    expect((await getSessionState(user.id))?.revoked).toBe(false);
    await api("/applications", "POST", {});
    transport.mockRejectedValueOnce(new APIError(0, "unreachable"));
    await expect(api("/applications")).rejects.toThrow();
    expect(isOfflineOrReadOnly()).toBe(true);
    await expect(api("/applications", "PUT", {})).rejects.toThrow();
    await api("/auth/logout", "POST");
    transport.mockResolvedValueOnce({ user });
    await api("/auth/login", "POST"); // explicit auth remains available before verification
  });

  it.each([401, 403, 500])("never treats HTTP %i as fallback even when navigator reports offline", async (status) => {
    vi.spyOn(navigator, "onLine", "get").mockReturnValue(false);
    expect(isNetworkError(new APIError(status, "denied"))).toBe(false);
    const error = new APIError(status, "denied");
    await expect(createWebAPI(vi.fn().mockRejectedValue(error))("/applications")).rejects.toBe(error);
    expect(isNetworkError(new DOMException("cancelled", "AbortError"))).toBe(false);
    expect(isNetworkError(new TypeError("Failed to fetch"))).toBe(false);
  });

  it("relogin commits a fresh epoch and restores saving while rejecting late writes from an independent module", async () => {
    vi.spyOn(navigator, "onLine", "get").mockReturnValue(true);
    const api = createWebAPI(vi.fn().mockResolvedValue({ user }));
    await api("/auth/login", "POST", {});
    const oldEpoch = (await getSessionState(user.id))!.epoch;
    // A second JS instance has its own in-memory generation map and DB connection.
    vi.resetModules();
    const second = await import("./db");
    await second.openOfflineDB();
    await second.restoreSessionGeneration(user.id);
    try {
      await clearOfflineCache(user.id, true);
      await api("/auth/login", "POST", {});
      const nextEpoch = (await getSessionState(user.id))!.epoch;
      expect(nextEpoch).toBeGreaterThan(oldEpoch);
      await second.saveDraft(user.id, "application", "late", { company: "zombie" }, oldEpoch);
      await second.saveCachedUser(user.id, user as any); // omitted generation cannot bypass persisted epoch
      expect(await getDraft(user.id, "application", "late")).toBeNull();
      expect(await second.getCachedUser(user.id)).toBeNull();
      await saveDraft(user.id, "application", "new", { company: "fresh" }, nextEpoch, { throwOnError: true });
      expect((await getDraft(user.id, "application", "new"))?.data.company).toBe("fresh");
      // Cold cached restoration hydrates the persisted epoch without activating it.
      requireLiveVerification();
      expect(await second.restoreSessionGeneration(user.id)).toBe(true);
      await second.saveDraft(user.id, "application", "cold", { company: "offline draft" }, undefined, { throwOnError: true });
      expect((await getDraft(user.id, "application", "cold"))?.data.company).toBe("offline draft");
      expect(isOfflineOrReadOnly()).toBe(true);
    } finally { second.closeOfflineDB(); }
  });
});

import { describe, it, expect, beforeEach, afterEach } from "vitest";
import "fake-indexeddb/auto";
import { offlineManager } from "./manager";
import {
  closeOfflineDB,
  getCachedUser,
  getJournalSnapshot,
  getDetailSnapshot,
  getDraft,
  saveDraft,
  getOfflineSettings,
} from "./db";
import type { User } from "@avari/shared";

describe("OfflineManager Integration", () => {
  const mockUser: User = {
    id: "user-1",
    email: "user1@test.com",
    status: "active",
    timezone: "Europe/Moscow",
    createdAt: "2026-10-01T00:00:00Z",
  };

  const otherUser: User = {
    id: "user-2",
    email: "user2@test.com",
    status: "active",
    timezone: "UTC",
    createdAt: "2026-10-02T00:00:00Z",
  };

  beforeEach(async () => {
    closeOfflineDB();
    await new Promise<void>((resolve) => {
      const req = indexedDB.deleteDatabase("avari_offline_v1");
      req.onsuccess = () => resolve();
      req.onerror = () => resolve();
    });
    // Ensure manager is initialized
    await offlineManager.whenReady();
  });

  afterEach(() => {
    closeOfflineDB();
  });

  it("does not cache data when optIn is false (default)", async () => {
    await offlineManager.setOptIn(false);

    await offlineManager.recordSuccessfulFetch("user-1", mockUser, {
      applications: [{ id: "app-1", company: "TestCorp" }],
    });

    const cachedUser = await getCachedUser("user-1");
    expect(cachedUser).toBeNull();
    const cachedJournal = await getJournalSnapshot("user-1");
    expect(cachedJournal).toBeNull();
  });

  it("strictly enforces account-specific opt-in (account B cannot cache from account A consent)", async () => {
    // User 1 opts in
    await offlineManager.setOptIn(true, "user-1");

    // Attempt to cache for user 2 (who did NOT opt in)
    await offlineManager.recordSuccessfulFetch("user-2", otherUser, {
      applications: [{ id: "app-2", company: "OtherCorp" }],
    });
    await offlineManager.recordDetailFetch("user-2", "app-2", {
      application: { id: "app-2" },
    });

    // User 2 data must NOT be cached
    expect(await getCachedUser("user-2")).toBeNull();
    expect(await getJournalSnapshot("user-2")).toBeNull();
    expect(await offlineManager.getCachedDetail("user-2", "app-2")).toBeNull();

    // User 1 data CAN be cached
    await offlineManager.recordSuccessfulFetch("user-1", mockUser, {
      applications: [{ id: "app-1", company: "TestCorp" }],
    });
    expect(await getCachedUser("user-1")).not.toBeNull();
  });

  it("caches and restores data when optIn is true for the opted-in user", async () => {
    await offlineManager.setOptIn(true, "user-1");

    await offlineManager.recordSuccessfulFetch("user-1", mockUser, {
      applications: [{ id: "app-1", company: "TestCorp" }],
      tasks: [],
      fields: [],
      proposals: [],
    });

    await offlineManager.recordDetailFetch("user-1", "app-1", {
      application: { id: "app-1", company: "TestCorp" },
      notes: [],
      events: [],
      tasks: [],
      proposals: [],
    });

    const restored = await offlineManager.restoreLastOptedInAccount();
    expect(restored).not.toBeNull();
    expect(restored?.user?.email).toBe("user1@test.com");
    expect(restored?.user?.timezone).toBe("Europe/Moscow");
    expect(restored?.journal?.applications[0].company).toBe("TestCorp");

    const detail = await offlineManager.getCachedDetail("user-1", "app-1");
    expect(detail?.detail.application.company).toBe("TestCorp");
  });

  it("handleLogout purges drafts, read cache, and resets optIn and lastOptedInUserKey", async () => {
    await offlineManager.setOptIn(true, "user-1");
    await offlineManager.recordSuccessfulFetch("user-1", mockUser, {
      applications: [{ id: "app-1" }],
    });
    await saveDraft("user-1", "application", "new", { company: "Draft" });

    // Handle logout
    await offlineManager.handleLogout("user-1");

    // All caches and drafts purged
    expect(await getCachedUser("user-1")).toBeNull();
    expect(await getJournalSnapshot("user-1")).toBeNull();
    expect(await getDraft("user-1", "application", "new")).toBeNull();

    // Settings reset
    const settings = await getOfflineSettings();
    expect(settings.optIn).toBe(false);
    expect(settings.lastOptedInUserKey).toBeNull();
  });

  it("clears cached snapshots and drafts when opt-in is disabled", async () => {
    await offlineManager.setOptIn(true, "user-1");
    await offlineManager.recordSuccessfulFetch("user-1", mockUser, {
      applications: [{ id: "app-1" }],
    });

    await offlineManager.setOptIn(false, "user-1");

    const cachedUser = await getCachedUser("user-1");
    expect(cachedUser).toBeNull();
    const settings = await getOfflineSettings();
    expect(settings.optIn).toBe(false);
    expect(settings.lastOptedInUserKey).toBeNull();
  });
});

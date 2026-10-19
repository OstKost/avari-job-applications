import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import "fake-indexeddb/auto";
import {
  openOfflineDB,
  closeOfflineDB,
  getOfflineSettings,
  saveOfflineSettings,
  saveCachedUser,
  getCachedUser,
  saveJournalSnapshot,
  getJournalSnapshot,
  saveDetailSnapshot,
  getDetailSnapshot,
  saveDraft,
  getDraft,
  deleteDraft,
  getAllUserDrafts,
  clearOfflineCache,
  getUserGeneration,
  bumpUserGeneration,
  initOrActivateSession,
  getSessionState,
} from "./db";
import type { User } from "@avari/shared";

describe("Native IndexedDB Offline Storage", () => {
  beforeEach(async () => {
    closeOfflineDB();
    await new Promise<void>((resolve) => {
      const req = indexedDB.deleteDatabase("avari_offline_v1");
      req.onsuccess = () => resolve();
      req.onerror = () => resolve();
      req.onblocked = () => resolve();
    });
  });

  afterEach(() => {
    closeOfflineDB();
  });

  it("initializes with default offline settings (opt-in false)", async () => {
    const settings = await getOfflineSettings();
    expect(settings.optIn).toBe(false);
    expect(settings.lastOptedInUserKey).toBeNull();
  });

  it("updates and retrieves offline settings", async () => {
    const updated = await saveOfflineSettings({
      optIn: true,
      lastOptedInUserKey: "user-123",
    });
    expect(updated.optIn).toBe(true);
    expect(updated.lastOptedInUserKey).toBe("user-123");

    const reloaded = await getOfflineSettings();
    expect(reloaded.optIn).toBe(true);
    expect(reloaded.lastOptedInUserKey).toBe("user-123");
  });

  it("stores and isolates cached user metadata matching shared User schema", async () => {
    const user1: User = {
      id: "u1",
      email: "user1@example.com",
      status: "active",
      timezone: "Europe/Moscow",
      createdAt: "2026-10-01T12:00:00Z",
    };

    const user2: User = {
      id: "u2",
      email: "user2@example.com",
      status: "pending",
      timezone: "UTC",
      createdAt: "2026-10-02T12:00:00Z",
    };

    await saveCachedUser("user-1", user1);
    await saveCachedUser("user-2", user2);

    const stored1 = await getCachedUser("user-1");
    const stored2 = await getCachedUser("user-2");
    expect(stored1?.email).toBe("user1@example.com");
    expect(stored1?.timezone).toBe("Europe/Moscow");
    expect(stored1?.createdAt).toBe("2026-10-01T12:00:00Z");
    expect(stored1?.status).toBe("active");

    expect(stored2?.email).toBe("user2@example.com");
    expect(stored2?.timezone).toBe("UTC");
    expect(stored2?.status).toBe("pending");
  });

  it("saves journal snapshots and sanitizes resume file contents", async () => {
    const applications = [
      { id: "app-1", company: "Acme", resumeFile: "secret.pdf", resumeContent: "binary" },
    ];
    const tasks = [{ id: "task-1", title: "Interview" }];
    const fields = [{ id: "f-1", name: "Salary" }];
    const proposals = [{ id: "p-1", text: "Proposal" }];

    await saveJournalSnapshot("user-1", { applications, tasks, fields, proposals });

    const snapshot = await getJournalSnapshot("user-1");
    expect(snapshot).not.toBeNull();
    expect(snapshot?.applications).toHaveLength(1);
    expect(snapshot?.applications[0].company).toBe("Acme");
    expect(snapshot?.applications[0]).not.toHaveProperty("resumeFile");
    expect(snapshot?.applications[0]).not.toHaveProperty("resumeContent");
    expect(snapshot?.tasks).toHaveLength(1);
    expect(snapshot?.fields).toHaveLength(1);
    expect(snapshot?.proposals).toHaveLength(1);
  });

  it("saves and retrieves application details snapshots with isolation", async () => {
    const detail = {
      application: { id: "app-1", company: "Google" },
      notes: [{ id: "n-1", text: "Great conversation" }],
      events: [],
      tasks: [],
      proposals: [],
    };

    await saveDetailSnapshot("user-1", "app-1", detail);
    const stored = await getDetailSnapshot("user-1", "app-1");
    expect(stored?.detail.application.company).toBe("Google");
    expect(stored?.detail.notes).toHaveLength(1);

    // Another user cannot access user-1's details
    const otherUser = await getDetailSnapshot("user-2", "app-1");
    expect(otherUser).toBeNull();
  });

  it("persists form drafts across kinds and entities independently from opt-in", async () => {
    await saveDraft("user-1", "application", "new", { company: "Draft Company", position: "Dev" });
    await saveDraft("user-1", "task", "task-99", { title: "Standalone task", date: "2026-10-20" });
    await saveDraft("user-1", "note", "app-1:new", { text: "Meeting notes" });

    const appDraft = await getDraft("user-1", "application", "new");
    expect(appDraft?.data.company).toBe("Draft Company");

    const taskDraft = await getDraft("user-1", "task", "task-99");
    expect(taskDraft?.data.title).toBe("Standalone task");

    const allDrafts = await getAllUserDrafts("user-1");
    expect(allDrafts).toHaveLength(3);

    // Isolated from user-2
    const user2Drafts = await getAllUserDrafts("user-2");
    expect(user2Drafts).toHaveLength(0);

    // Deletion after submit
    await deleteDraft("user-1", "application", "new");
    const reloadedAppDraft = await getDraft("user-1", "application", "new");
    expect(reloadedAppDraft).toBeNull();
  });

  it("purges user drafts and cache when clearDrafts=true (logout/401/403)", async () => {
    const user1: User = { id: "u1", email: "u1@test.com", status: "active", timezone: "UTC", createdAt: "2026-10-01" };
    await saveCachedUser("user-1", user1);
    await saveJournalSnapshot("user-1", { applications: [{ id: "app-1" }] });
    await saveDetailSnapshot("user-1", "app-1", { application: { id: "app-1" } });
    await saveDraft("user-1", "application", "new", { company: "Draft To Purge" });

    // Logout clears everything including drafts
    await clearOfflineCache("user-1", true);

    expect(await getCachedUser("user-1")).toBeNull();
    expect(await getJournalSnapshot("user-1")).toBeNull();
    expect(await getDetailSnapshot("user-1", "app-1")).toBeNull();
    expect(await getDraft("user-1", "application", "new")).toBeNull();
  });

  it("discards late in-flight writes started before logout/clear via generation tracking", async () => {
    const genBeforeLogout = getUserGeneration("user-1");

    // Clear / logout happens and bumps generation
    await clearOfflineCache("user-1", true);
    const genAfterLogout = getUserGeneration("user-1");
    expect(genAfterLogout).toBeGreaterThan(genBeforeLogout);

    // Late in-flight write resolving after logout attempts to save with stale generation
    await saveDraft("user-1", "application", "new", { company: "Ghost Draft" }, genBeforeLogout);
    await saveJournalSnapshot("user-1", { applications: [{ id: "ghost" }] }, genBeforeLogout);

    // Must be discarded and not written into IndexedDB
    expect(await getDraft("user-1", "application", "new")).toBeNull();
    expect(await getJournalSnapshot("user-1")).toBeNull();
  });

  it("persists session epoch in IndexedDB and revokes writes across tabs after Tab A logout", async () => {
    // Tab A initializes session for user-1
    const epochTabA = await initOrActivateSession("user-1");
    expect(epochTabA).toBeGreaterThanOrEqual(1);

    // Tab B saves draft under this active session
    await saveDraft("user-1", "application", "new", { company: "Active Draft" }, epochTabA);
    const saved = await getDraft("user-1", "application", "new");
    expect(saved?.data.company).toBe("Active Draft");

    // Tab A logs out: atomic clear and session revocation in IndexedDB
    await clearOfflineCache("user-1", true);

    // Verify session state in DB is marked revoked and epoch incremented
    const sessionState = await getSessionState("user-1");
    expect(sessionState?.revoked).toBe(true);
    expect(sessionState?.active).toBe(false);
    expect(sessionState?.epoch).toBeGreaterThan(epochTabA);

    // Tab B had an in-flight saveDraft delayed write: tries to write using Tab B's old epoch
    // Even if Tab B's in-memory generation wasn't bumped yet, the IndexedDB transaction
    // checks the persistent session state and aborts write!
    await saveDraft("user-1", "application", "new", { company: "Resurrected Draft" }, epochTabA);

    // Draft must NOT be resurrected in IndexedDB
    const afterLateWrite = await getDraft("user-1", "application", "new");
    expect(afterLateWrite).toBeNull();
  });

  it("prevents stale writes from old session even after user logs back in (same user relogin)", async () => {
    // 1. User logs in (Session 1)
    const epochSession1 = await initOrActivateSession("user-relogin");
    await saveDraft("user-relogin", "application", "new", { company: "Session 1 App" }, epochSession1);
    expect((await getDraft("user-relogin", "application", "new"))?.data.company).toBe("Session 1 App");

    // 2. User logs out: epoch incremented and session revoked
    await clearOfflineCache("user-relogin", true);

    // 3. User logs back in (Session 2): new higher epoch
    const epochSession2 = await initOrActivateSession("user-relogin");
    expect(epochSession2).toBeGreaterThan(epochSession1);

    // 4. Stale tab still holding Session 1's epoch tries to write
    await saveDraft("user-relogin", "application", "new", { company: "Zombie Session 1" }, epochSession1);
    await saveCachedUser("user-relogin", {
      id: "user-relogin",
      email: "test@example.com",
      status: "active",
      timezone: "UTC",
      createdAt: "2026-10-01",
    }, epochSession1);

    // 5. Must NOT be written into IndexedDB under Session 1's stale epoch
    const draft = await getDraft("user-relogin", "application", "new");
    expect(draft).toBeNull();
    const userMeta = await getCachedUser("user-relogin");
    expect(userMeta).toBeNull();

    // 6. Valid write from Session 2 succeeds
    await saveDraft("user-relogin", "application", "new", { company: "Fresh Session 2" }, epochSession2);
    expect((await getDraft("user-relogin", "application", "new"))?.data.company).toBe("Fresh Session 2");
  });

  it("revokes cached data across tabs when opt-in is disabled in settings", async () => {
    // Opt-in enabled for user-1
    await saveOfflineSettings({ optIn: true, lastOptedInUserKey: "user-optin" });
    const user: User = {
      id: "user-optin",
      email: "optin@example.com",
      status: "active",
      timezone: "UTC",
      createdAt: "2026-10-01",
    };
    await saveCachedUser("user-optin", user);
    await saveJournalSnapshot("user-optin", { applications: [{ id: "app-1", company: "OptIn Co" }] });

    expect(await getCachedUser("user-optin")).not.toBeNull();
    expect(await getJournalSnapshot("user-optin")).not.toBeNull();

    // Cross-tab opt-in disabled (e.g. settings toggle off)
    await saveOfflineSettings({ optIn: false, lastOptedInUserKey: null });
    await clearOfflineCache(undefined, false); // read cache purged across users

    expect(await getCachedUser("user-optin")).toBeNull();
    expect(await getJournalSnapshot("user-optin")).toBeNull();
  });

  it("saveDraft strictly rejects with throwOnError when writing with stale epoch", async () => {
    const epoch1 = await initOrActivateSession("user-strict");
    // Logout revokes session and bumps epoch
    await clearOfflineCache("user-strict", true);

    // Non-strict autosave silently resolves without writing
    await expect(saveDraft("user-strict", "application", "new", { company: "NonStrict" }, epoch1)).resolves.toBeUndefined();
    expect(await getDraft("user-strict", "application", "new")).toBeNull();

    // Strict save (flush/submit) rejects with error
    await expect(
      saveDraft("user-strict", "application", "new", { company: "Strict" }, epoch1, { throwOnError: true }),
    ).rejects.toThrow();
  });

  it("clearOfflineCache with clearDrafts=false does not revoke active session or clear drafts", async () => {
    const epoch = await initOrActivateSession("user-optout");
    await saveDraft("user-optout", "application", "new", { company: "Persistent Draft" }, epoch);
    await saveJournalSnapshot("user-optout", { applications: [{ id: "app-1", company: "Cache" }] }, epoch);

    // User toggles off offline read cache (clearDrafts = false)
    await clearOfflineCache("user-optout", false);

    // Read cache cleared
    expect(await getJournalSnapshot("user-optout")).toBeNull();

    // Draft is preserved
    const draft = await getDraft("user-optout", "application", "new");
    expect(draft?.data.company).toBe("Persistent Draft");

    // Session remains active (not revoked) so continuing to save drafts under current epoch succeeds
    const session = await getSessionState("user-optout");
    expect(session?.revoked).toBe(false);
    expect(session?.active).toBe(true);

    await saveDraft("user-optout", "application", "new", { company: "Updated Draft" }, epoch, { throwOnError: true });
    expect((await getDraft("user-optout", "application", "new"))?.data.company).toBe("Updated Draft");
  });
  it("rejects an unexpected transaction abort during strict flush", async () => {
    const epoch = await initOrActivateSession("abort-user");
    const db = await openOfflineDB();
    const transaction = db.transaction.bind(db);
    const spy = vi.spyOn(db, "transaction").mockImplementation(((...args: any[]) => {
      const tx = transaction(...args as Parameters<typeof transaction>);
      queueMicrotask(() => tx.abort());
      return tx;
    }) as typeof db.transaction);
    try {
      await expect(saveDraft("abort-user", "application", "new", { company: "unsaved" }, epoch, { throwOnError: true })).rejects.toThrow();
    } finally { spy.mockRestore(); }
  });

  it("rejects strict dirty draft saving without IndexedDB", async () => {
    vi.stubGlobal("indexedDB", undefined);
    try {
      await expect(saveDraft("no-db", "application", "new", { company: "unsaved" }, 1, { throwOnError: true })).rejects.toThrow("IndexedDB");
    } finally { vi.unstubAllGlobals(); }
  });

});

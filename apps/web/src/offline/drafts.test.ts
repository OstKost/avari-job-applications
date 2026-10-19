import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import "fake-indexeddb/auto";
import {
  registerDraftHandler,
  hasDirtyDrafts,
  flushAllDrafts,
  persistDraft,
  discardDraft,
  loadDraft,
} from "./drafts";
import { closeOfflineDB } from "./db";

describe("Draft Registry and Handshake", () => {
  beforeEach(async () => {
    closeOfflineDB();
    await new Promise<void>((resolve) => {
      const req = indexedDB.deleteDatabase("avari_offline_v1");
      req.onsuccess = () => resolve();
      req.onerror = () => resolve();
    });
  });

  afterEach(() => {
    closeOfflineDB();
  });

  it("accurately detects dirty drafts across registered handlers", () => {
    let dirty1 = false;
    let dirty2 = false;

    const unreg1 = registerDraftHandler("user-1", "application", "new", {
      isDirty: () => dirty1,
      flush: async () => {},
      clear: async () => {},
    });

    const unreg2 = registerDraftHandler("user-1", "task", "t-1", {
      isDirty: () => dirty2,
      flush: async () => {},
      clear: async () => {},
    });

    expect(hasDirtyDrafts()).toBe(false);

    dirty1 = true;
    expect(hasDirtyDrafts()).toBe(true);

    dirty1 = false;
    dirty2 = true;
    expect(hasDirtyDrafts()).toBe(true);

    dirty2 = false;
    expect(hasDirtyDrafts()).toBe(false);

    unreg1();
    unreg2();
  });

  it("flushes all active handlers upon flushAllDrafts call", async () => {
    const flushSpy1 = vi.fn().mockResolvedValue(undefined);
    const flushSpy2 = vi.fn().mockResolvedValue(undefined);

    const unreg1 = registerDraftHandler("user-1", "application", "new", {
      isDirty: () => true,
      flush: flushSpy1,
      clear: async () => {},
    });

    const unreg2 = registerDraftHandler("user-1", "task", "t-1", {
      isDirty: () => true,
      flush: flushSpy2,
      clear: async () => {},
    });

    await flushAllDrafts();

    expect(flushSpy1).toHaveBeenCalledTimes(1);
    expect(flushSpy2).toHaveBeenCalledTimes(1);

    unreg1();
    unreg2();
  });

  it("persists and discards drafts with helper methods", async () => {
    await persistDraft("user-1", "application", "new", { company: "Persisted Ltd" });
    const loaded = await loadDraft("user-1", "application", "new");
    expect(loaded?.company).toBe("Persisted Ltd");

    await discardDraft("user-1", "application", "new");
    const reloaded = await loadDraft("user-1", "application", "new");
    expect(reloaded).toBeNull();
  });
});

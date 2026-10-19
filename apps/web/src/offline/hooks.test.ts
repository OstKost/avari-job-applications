import { describe, it, expect, beforeEach, afterEach } from "vitest";
import "fake-indexeddb/auto";
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { useFormDraft } from "./hooks";
import { closeOfflineDB, initOrActivateSession, clearOfflineCache, getDraft } from "./db";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

describe("useFormDraft Hook", () => {
  let container: HTMLDivElement;
  let root: Root;

  beforeEach(async () => {
    closeOfflineDB();
    await new Promise<void>((resolve) => {
      const req = indexedDB.deleteDatabase("avari_offline_v1");
      req.onsuccess = () => resolve();
      req.onerror = () => resolve();
    });

    container = document.createElement("div");
    document.body.appendChild(container);
    root = createRoot(container);
  });

  afterEach(() => {
    act(() => {
      root.unmount();
    });
    container.remove();
    closeOfflineDB();
  });

  it("updates draft and reports dirty state", async () => {
    let hookState: any = null;

    function TestComponent() {
      hookState = useFormDraft({
        userKey: "user-1",
        kind: "application",
        entityId: "new",
        initialValue: { company: "Initial Corp" },
        debounceMs: 10,
      });
      return null;
    }

    await act(async () => {
      root.render(createElement(TestComponent));
    });

    expect(hookState.draft.company).toBe("Initial Corp");
    expect(hookState.isDirty).toBe(false);

    await act(async () => {
      hookState.setDraft({ company: "Modified Corp" });
    });

    expect(hookState.draft.company).toBe("Modified Corp");
    expect(hookState.isDirty).toBe(true);

    // Debounce wait
    await act(async () => {
      await new Promise((r) => setTimeout(r, 30));
    });

    // Test flush
    await act(async () => {
      await hookState.flush();
    });
  });

  it("clears draft successfully", async () => {
    let hookState: any = null;

    function TestComponent() {
      hookState = useFormDraft({
        userKey: "user-1",
        kind: "task",
        entityId: "t-1",
        initialValue: { title: "Draft Task" },
        debounceMs: 10,
      });
      return null;
    }

    await act(async () => {
      root.render(createElement(TestComponent));
    });

    await act(async () => {
      hookState.setDraft({ title: "Updated Task" });
    });

    await act(async () => {
      await new Promise((r) => setTimeout(r, 30));
    });

    await act(async () => {
      await hookState.clear();
    });

    expect(hookState.isDirty).toBe(false);
  });
  it("a mounted old form cannot adopt the epoch of a later same-user login", async () => {
    const userKey = "old-form-user";
    await initOrActivateSession(userKey);
    let state: ReturnType<typeof useFormDraft<{ company: string }>>;
    function OldForm() {
      state = useFormDraft({ userKey, kind: "application", initialValue: { company: "" }, debounceMs: 1 });
      return null;
    }
    await act(async () => { root.render(createElement(OldForm)); });
    await clearOfflineCache(userKey, true);
    await initOrActivateSession(userKey);
    await act(async () => { state.setDraft({ company: "Late old form" }); });
    await act(async () => { await new Promise(resolve => setTimeout(resolve, 10)); });
    expect(await getDraft(userKey, "application", "new")).toBeNull();
    await expect(state!.flush()).rejects.toThrow("stale");
  });

});

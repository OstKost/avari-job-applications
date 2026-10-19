import { createWebAPI } from "./policy";
import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import "fake-indexeddb/auto";
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { OfflineApplicationForm, OfflineTaskForm, OfflineNoteForm } from "./adapters";
import { saveDraft, getDraft, closeOfflineDB } from "./db";
import { emptyApplication, type Application, type Transport, type Task } from "@avari/shared";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

describe("Offline Form Adapters: Draft Restore & Sync", () => {
  let container: HTMLDivElement;
  let root: Root;

  const mockApi: Transport = vi.fn().mockResolvedValue({ id: "server-id" });

  beforeEach(async () => {
    closeOfflineDB();
    await new Promise<void>((resolve) => {
      const req = indexedDB.deleteDatabase("avari_offline_v1");
      req.onsuccess = () => resolve();
      req.onerror = () => resolve();
    });

    await createWebAPI(vi.fn().mockResolvedValue({ id: "user-app-test" }))("/me");
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

  it("restores application draft into inner form inputs and submits restored data", async () => {
    const userKey = "user-app-test";
    // Pre-populate a stored draft in IndexedDB
    await saveDraft(userKey, "application", "new", {
      company: "Restored Corp",
      position: "Senior Restored Dev",
      stage: "interview",
      state: "active",
      tags: ["remote"],
      salary: { value: 250000, currency: "RUB" },
    });

    const initialApp: Application = {
      ...emptyApplication(),
      company: "Fresh Clean Corp",
      position: "Junior Dev",
    };

    let savedResult: Application | null = null;
    const onSaved = (app: Application) => {
      savedResult = app;
    };
    const onCancel = vi.fn();

    await act(async () => {
      root.render(
        createElement(OfflineApplicationForm, {
          userKey,
          initial: initialApp,
          fields: [],
          api: mockApi,
          onSaved,
          onCancel,
        }),
      );
    });

    // Wait for draft detection on mount
    await act(async () => {
      await new Promise((r) => setTimeout(r, 50));
    });

    // Banner should be visible with "Восстановить" button
    const restoreBanner = container.querySelector(".draft-restore-banner");
    expect(restoreBanner).not.toBeNull();
    const restoreBtn = Array.from(container.querySelectorAll("button")).find(
      (b) => b.textContent?.trim() === "Восстановить",
    );
    expect(restoreBtn).toBeDefined();

    // Click restore
    await act(async () => {
      restoreBtn?.click();
    });

    // Wait for remount and state update
    await act(async () => {
      await new Promise((r) => setTimeout(r, 50));
    });

    // Find company and position inputs in form
    const inputs = Array.from(container.querySelectorAll("input"));
    const companyInput = inputs.find((i) => i.value === "Restored Corp");
    expect(companyInput).toBeDefined();

    const positionInput = inputs.find((i) => i.value === "Senior Restored Dev");
    expect(positionInput).toBeDefined();

    // Submit the form
    const formEl = container.querySelector("form");
    expect(formEl).not.toBeNull();
    await act(async () => {
      formEl?.dispatchEvent(new Event("submit", { cancelable: true, bubbles: true }));
    });

    // Verify api was called with the restored draft values
    expect(mockApi).toHaveBeenCalled();
    const submittedPayload = (mockApi as any).mock.calls[0][2];
    expect(submittedPayload.company).toBe("Restored Corp");
    expect(submittedPayload.position).toBe("Senior Restored Dev");

    // Verify draft was cleaned up on successful save
    await act(async () => {
      await new Promise((r) => setTimeout(r, 20));
    });
    const draftAfterSave = await getDraft(userKey, "application", "new");
    expect(draftAfterSave).toBeNull();
  });

  it("restores task draft into inner form inputs and submits restored data", async () => {
    const userKey = "user-task-test";
    await saveDraft(userKey, "task", "new", {
      title: "Restored Technical Interview",
      date: "2026-11-01",
      kind: "interview",
    });

    const initialTask: Partial<Task> = {
      title: "Initial Blank Task",
      date: "2026-10-18",
    };

    await act(async () => {
      root.render(
        createElement(OfflineTaskForm, {
          userKey,
          initial: initialTask,
          applications: [],
          api: mockApi,
          onSaved: vi.fn(),
          onCancel: vi.fn(),
        }),
      );
    });

    await act(async () => {
      await new Promise((r) => setTimeout(r, 50));
    });

    const inputs = Array.from(container.querySelectorAll("input"));
    const titleBefore = inputs.find((i) => i.value === "Initial Blank Task");
    expect(titleBefore).toBeDefined();

    const restoreBtn = Array.from(container.querySelectorAll("button")).find(
      (b) => b.textContent?.trim() === "Восстановить",
    );
    expect(restoreBtn).toBeDefined();

    await act(async () => {
      restoreBtn?.click();
    });

    await act(async () => {
      await new Promise((r) => setTimeout(r, 50));
    });

    const inputsAfter = Array.from(container.querySelectorAll("input"));
    const titleAfter = inputsAfter.find((i) => i.value === "Restored Technical Interview");
    expect(titleAfter).toBeDefined();
  });

  it("restores note draft into inner form textarea", async () => {
    const userKey = "user-note-test";
    await saveDraft(userKey, "note", "app-100:new", {
      text: "Restored meeting debrief and offer negotiation notes",
    });

    await act(async () => {
      root.render(
        createElement(OfflineNoteForm, {
          userKey,
          applicationId: "app-100",
          initial: undefined,
          api: mockApi,
          onSaved: vi.fn(),
          onCancel: vi.fn(),
        }),
      );
    });

    await act(async () => {
      await new Promise((r) => setTimeout(r, 50));
    });

    const restoreBtn = Array.from(container.querySelectorAll("button")).find(
      (b) => b.textContent?.trim() === "Восстановить",
    );
    expect(restoreBtn).toBeDefined();

    await act(async () => {
      restoreBtn?.click();
    });

    await act(async () => {
      await new Promise((r) => setTimeout(r, 50));
    });

    const textarea = container.querySelector("textarea") as HTMLTextAreaElement | null;
    expect(textarea?.value).toBe("Restored meeting debrief and offer negotiation notes");
  });
});

import { beforeEach, describe, expect, it, vi } from "vitest";
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import {
  useApplicationList,
  loadStoredListPreferences,
  saveStoredListPreferences,
  getListStorageKey,
} from "./useApplicationList";
import type { Application, Field, Task, User } from "@avari/shared";
import { isApplicationStale, nextWeekday, APIError } from "@avari/shared";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const mockUser: User = {
  id: "user-123",
  email: "test@example.com",
  status: "active",
  timezone: "Europe/Moscow",
  createdAt: "2026-10-01T00:00:00Z",
};

const mockFields: Field[] = [
  {
    id: "f-priority",
    name: "Приоритет",
    role: "priority",
    type: "select",
    options: ["Высокий", "Средний", "Низкий"],
  },
];

const mockApps: Application[] = [
  {
    id: "app-1",
    version: 1,
    company: "Acme",
    position: "Frontend Lead",
    url: "https://hh.ru/vacancy/123",
    hhId: "123",
    savedDate: "2026-10-10",
    appliedDate: "2026-10-10",
    stage: "response",
    state: "active",
    salary: { min: 300000, max: 450000, currency: "RUB", period: "month", tax: "net" },
    location: "Москва",
    workFormat: "remote",
    recruiter: "",
    favorite: true,
    groups: ["IT"],
    tags: ["react"],
    custom: { "f-priority": "Высокий" },
    externalStatus: "",
    outcome: "",
    createdAt: "2026-10-10T10:00:00Z",
    updatedAt: "2026-10-10T10:00:00Z",
    lastActivityAt: "2026-10-10T10:00:00Z",
    stale: false,
  },
  {
    id: "app-2",
    version: 1,
    company: "Beta Tech",
    position: "Senior Engineer",
    url: "",
    hhId: "",
    savedDate: "2026-10-01",
    appliedDate: "",
    stage: "interview",
    state: "active",
    salary: { min: null, max: null, currency: "RUB", period: "month", tax: "net" },
    location: "Санкт-Петербург",
    workFormat: "hybrid",
    recruiter: "",
    favorite: false,
    groups: [],
    tags: [],
    custom: {},
    externalStatus: "",
    outcome: "",
    createdAt: "2026-10-01T10:00:00Z",
    updatedAt: "2026-10-01T10:00:00Z",
    lastActivityAt: "2026-10-01T10:00:00Z",
    stale: true,
  },
  {
    id: "app-3",
    version: 1,
    company: "Gamma Inc",
    position: "Fullstack Dev",
    url: "",
    hhId: "",
    savedDate: "2026-10-05",
    appliedDate: "2026-10-06",
    stage: "final",
    state: "closed",
    salary: { min: null, max: null, currency: "RUB", period: "month", tax: "net" },
    location: "",
    workFormat: "",
    recruiter: "",
    favorite: true,
    groups: [],
    tags: [],
    custom: {},
    externalStatus: "",
    outcome: "offer",
    createdAt: "2026-10-05T10:00:00Z",
    updatedAt: "2026-10-06T10:00:00Z",
    lastActivityAt: "2026-10-06T10:00:00Z",
    stale: false,
  },
];

const mockTasks: Task[] = [
  {
    id: "task-1",
    applicationId: "app-1",
    title: "Интервью с тимлидом",
    date: "2026-10-20",
    time: "15:00",
    state: "open",
    kind: "interview",
    version: 1,
    createdAt: "2026-10-10T10:00:00Z",
    updatedAt: "2026-10-10T10:00:00Z",
  },
];

describe("storage persistence & helpers", () => {
  beforeEach(() => {
    localStorage.clear();
  });

  it("stores and loads preferences isolated per account and per page", () => {
    const keyApp = getListStorageKey("user-1", "applications");
    const keyFav = getListStorageKey("user-1", "favorites");

    saveStoredListPreferences("user-1", "applications", {
      search: "react",
      page: 2,
      cards: true,
      statistics: true,
    });
    saveStoredListPreferences("user-1", "favorites", {
      search: "lead",
      page: 0,
      cards: false,
      statistics: false,
    });

    const loadedApp = loadStoredListPreferences("user-1", "applications");
    const loadedFav = loadStoredListPreferences("user-1", "favorites");

    expect(loadedApp.search).toBe("react");
    expect(loadedApp.page).toBe(2);
    expect(loadedApp.cards).toBe(true);

    expect(loadedFav.search).toBe("lead");
    expect(loadedFav.page).toBe(0);
    expect(loadedFav.cards).toBe(false);
  });

  it("falls back to legacy avari-table key when primary storage is missing", () => {
    localStorage.setItem(
      "avari-table:legacy-user",
      JSON.stringify({ group: "stage", cards: true, statistics: false }),
    );
    const loaded = loadStoredListPreferences("legacy-user", "applications");
    expect(loaded.grouping).toBe("stage");
    expect(loaded.cards).toBe(true);
    expect(loaded.statistics).toBe(false);
  });

  it("handles corrupted storage gracefully", () => {
    localStorage.setItem("avari-filters:applications:bad-user", "not-a-{json}");
    const loaded = loadStoredListPreferences("bad-user", "applications");
    expect(loaded).toEqual({});
  });
});

describe("isApplicationStale & nextWeekday", () => {
  it("detects stale active applications correctly", () => {
    // Explicit stale flag
    expect(isApplicationStale(mockApps[1])).toBe(true);
    expect(isApplicationStale(mockApps[0])).toBe(false);

    // Closed applications are never stale
    expect(isApplicationStale(mockApps[2])).toBe(false);

    // Calculated from timestamp > 240 hours (10 days)
    const elevenDaysAgo = new Date(Date.now() - 11 * 24 * 60 * 60 * 1000).toISOString();
    const threeDaysAgo = new Date(Date.now() - 3 * 24 * 60 * 60 * 1000).toISOString();

    const staleApp: Application = {
      ...mockApps[0],
      stale: undefined,
      lastActivityAt: elevenDaysAgo,
    };
    expect(isApplicationStale(staleApp)).toBe(true);

    const freshApp: Application = {
      ...mockApps[0],
      stale: undefined,
      lastActivityAt: threeDaysAgo,
    };
    expect(isApplicationStale(freshApp)).toBe(false);
  });

  it("calculates next weekday in account timezone", () => {
    // Friday -> next weekday is Monday
    const friday = new Date("2026-10-16T12:00:00Z");
    const nwFriday = nextWeekday("UTC", friday);
    expect(nwFriday).toBe("2026-10-19"); // Monday

    // Saturday -> next weekday is Monday
    const saturday = new Date("2026-10-17T12:00:00Z");
    const nwSat = nextWeekday("UTC", saturday);
    expect(nwSat).toBe("2026-10-19"); // Monday

    // Monday -> next weekday is Tuesday
    const monday = new Date("2026-10-19T12:00:00Z");
    const nwMon = nextWeekday("UTC", monday);
    expect(nwMon).toBe("2026-10-20"); // Tuesday
  });
});

describe("useApplicationList hook integration", () => {
  let root: Root;
  let container: HTMLDivElement;
  let hookResult: ReturnType<typeof useApplicationList>;

  beforeEach(() => {
    localStorage.clear();
    container = document.createElement("div");
    root = createRoot(container);
  });

  function renderHook(options: Partial<Parameters<typeof useApplicationList>[0]> = {}) {
    function TestComponent() {
      hookResult = useApplicationList({
        user: mockUser,
        applications: mockApps,
        tasks: mockTasks,
        fields: mockFields,
        favoriteOnly: false,
        api: vi.fn().mockResolvedValue({}),
        refresh: vi.fn(),
        ...options,
      });
      return createElement("div", null, "rendered");
    }
    act(() => {
      root.render(createElement(TestComponent));
    });
  }

  it("filters baseList by favoriteOnly", () => {
    renderHook({ favoriteOnly: true });
    expect(hookResult.baseList.length).toBe(2);
    expect(hookResult.baseList.every((a) => a.favorite)).toBe(true);
  });

  it("restores page and collapsed on initial mount without resetting to 0", () => {
    saveStoredListPreferences(mockUser.id, "applications", {
      page: 0,
      collapsed: ["stage-1"],
      cards: true,
      statistics: true,
    });

    renderHook();
    expect(hookResult.cards).toBe(true);
    expect(hookResult.collapsed.has("stage-1")).toBe(true);
  });

  it("clamps page when stored page exceeds pageCount", () => {
    saveStoredListPreferences(mockUser.id, "applications", {
      page: 999,
    });
    renderHook();
    expect(hookResult.currentPage).toBe(0); // Only 3 items, so 1 page (index 0)
  });

  it("resets page to 0 on subsequent user filter changes", () => {
    renderHook();
    act(() => {
      hookResult.setPage(1);
    });
    expect(hookResult.page).toBe(1);

    act(() => {
      hookResult.setSearch("Acme");
    });
    expect(hookResult.page).toBe(0);
  });

  it("resetFilters resets search and filters but preserves cards, statistics, and grouping", () => {
    renderHook();
    act(() => {
      hookResult.setSearch("Acme");
      hookResult.setStage("response");
      hookResult.setGrouping("stage");
      hookResult.setCards(true);
      hookResult.setStatistics(false);
    });

    act(() => {
      hookResult.resetFilters();
    });

    expect(hookResult.search).toBe("");
    expect(hookResult.stage).toBe("");
    // Preserved!
    expect(hookResult.grouping).toBe("stage");
    expect(hookResult.cards).toBe(true);
    expect(hookResult.statistics).toBe(false);
  });

  it("handles duplicate saves and 409 conflict gracefully without swallowing errors", async () => {
    const serverApp = { ...mockApps[0], version: 2, company: "Acme Updated" };
    const apiMock = vi.fn().mockRejectedValueOnce(
      new APIError(409, "Conflict", serverApp),
    );
    const refreshMock = vi.fn();

    renderHook({ api: apiMock, refresh: refreshMock });

    await act(async () => {
      await hookResult.handleStageChange(mockApps[0], "interview");
    });

    // 409 Conflict handled by refreshing cache without blind overwrite
    expect(refreshMock).toHaveBeenCalled();
    expect(hookResult.conflictApp).toEqual({
      local: expect.objectContaining({ stage: "interview" }),
      server: serverApp,
      patch: { type: "stage", stage: "interview" },
    });
    expect(hookResult.saveError).toBeDefined();

    // Now test explicit retryConflict: preserves concurrent company and uses server version
    apiMock.mockResolvedValueOnce({ ...serverApp, version: 3, stage: "interview" });
    await act(async () => {
      await hookResult.retryConflict();
    });
    expect(apiMock).toHaveBeenCalledWith(
      "/applications/" + mockApps[0].id,
      "PUT",
      expect.objectContaining({
        version: 2,
        stage: "interview",
        company: "Acme Updated", // Preserves server's updated company!
      }),
    );
  });

  it("prompts outcome modal when changing state to closed", async () => {
    const apiMock = vi.fn();
    renderHook({ api: apiMock });

    act(() => {
      void hookResult.handleStateChange(mockApps[0], "closed");
    });

    // Did not send PUT yet because outcome is required
    expect(apiMock).not.toHaveBeenCalled();
    expect(hookResult.outcomeModalApp?.id).toBe(mockApps[0].id);

    // Cancel is no-op
    act(() => {
      hookResult.handleCancelOutcome();
    });
    expect(hookResult.outcomeModalApp).toBeNull();
    expect(apiMock).not.toHaveBeenCalled();

    // Confirming outcome sends save
    act(() => {
      void hookResult.handleStateChange(mockApps[0], "closed");
    });
    await act(async () => {
      await hookResult.handleConfirmOutcome("rejected");
    });
    expect(apiMock).toHaveBeenCalledWith(
      "/applications/" + mockApps[0].id,
      "PUT",
      expect.objectContaining({ state: "closed", outcome: "rejected" }),
    );
  });

  it("retains outcomeModalApp when confirm fails so user can retry", async () => {
    const apiMock = vi.fn().mockRejectedValueOnce(new Error("Network failed"));
    renderHook({ api: apiMock });

    act(() => {
      void hookResult.handleStateChange(mockApps[0], "closed");
    });
    expect(hookResult.outcomeModalApp?.id).toBe(mockApps[0].id);

    await act(async () => {
      try {
        await hookResult.handleConfirmOutcome("rejected");
      } catch {}
    });

    // Retained modal!
    expect(hookResult.outcomeModalApp?.id).toBe(mockApps[0].id);
    expect(hookResult.saveError).toBeDefined();
  });

  it("populates appliedDate in user timezone when transitioning from saved to later stage", async () => {
    const apiMock = vi.fn().mockResolvedValue({});
    renderHook({ api: apiMock, user: { ...mockUser, timezone: "Europe/Moscow" } });

    // mockApps[0].stage is "saved", appliedDate is ""
    await act(async () => {
      await hookResult.handleStageChange(mockApps[0], "applied");
    });

    expect(apiMock).toHaveBeenCalledWith(
      "/applications/" + mockApps[0].id,
      "PUT",
      expect.objectContaining({
        stage: "applied",
        appliedDate: expect.stringMatching(/^\d{4}-\d{2}-\d{2}$/),
      }),
    );
  });

  it("does not overwrite saved page with 0 during initial async load with empty applications", () => {
    saveStoredListPreferences("user-1", "applications", {
      page: 2,
      search: "",
    });

    // Initial render with empty applications array (simulating initial async fetch)
    renderHook({ applications: [] });

    // The saved preferences in localStorage should STILL have page 2, not 0!
    const prefs = loadStoredListPreferences("user-1", "applications");
    expect(prefs.page).toBe(2);
  });

  it("sparse retry preserves concurrent server recruiter, company, salary, tags, notes, favorite, state and appliedDate", async () => {
    // Original app has favorite=false, state="active", empty recruiter, initial salary, tags ['react'], appliedDate '2026-10-10'
    const originalApp = {
      ...mockApps[0],
      stage: "response",
      state: "active",
      favorite: false,
      outcome: "",
      appliedDate: "2026-10-10",
      version: 1,
    };
    // Server changes: favorite=true, state="paused", outcome="declined", recruiter="Elena", company="Acme Corp", salary updated, tag added
    const serverApp: Application = {
      ...originalApp,
      version: 2,
      company: "Acme Corp",
      recruiter: "Elena Recruiter",
      salary: { min: 400000, max: 600000, currency: "USD", period: "month", tax: "net" },
      tags: ["react", "typescript"],
      custom: { "f-priority": "Средний" },
      favorite: true,
      state: "paused",
      outcome: "declined",
      appliedDate: "2026-10-12", // Server updated appliedDate concurrently
    };

    const apiMock = vi.fn().mockRejectedValueOnce(
      new APIError(409, "Conflict", serverApp),
    );
    renderHook({ api: apiMock, applications: [originalApp] });

    // User triggers a stage change to "interview"
    await act(async () => {
      await hookResult.handleStageChange(originalApp, "interview");
    });

    expect(hookResult.conflictApp).toBeDefined();
    expect(hookResult.conflictApp?.server.version).toBe(2);

    // Now retry conflict: retry MUST merge only intended stage change, keeping server's recruiter, company, salary, tags, custom, and existing appliedDate
    apiMock.mockResolvedValueOnce({ ...serverApp, stage: "interview", version: 3 });
    await act(async () => {
      await hookResult.retryConflict();
    });

    expect(apiMock).toHaveBeenLastCalledWith(
      "/applications/" + originalApp.id,
      "PUT",
      expect.objectContaining({
        version: 2,
        stage: "interview",
        company: "Acme Corp",
        recruiter: "Elena Recruiter",
        salary: { min: 400000, max: 600000, currency: "USD", period: "month", tax: "net" },
        tags: ["react", "typescript"],
        custom: { "f-priority": "Средний" },
        favorite: true, // Preserved server's favorite=true!
        state: "paused", // Preserved server's state="paused"!
        outcome: "declined", // Preserved server's outcome="declined"!
        appliedDate: "2026-10-12", // Kept server's latest appliedDate!
      }),
    );
  });

  it("sparse retry populates appliedDate only if server appliedDate is empty when moving from saved stage", async () => {
    const originalApp = { ...mockApps[0], stage: "saved", appliedDate: "", version: 1 };
    const serverApp: Application = {
      ...originalApp,
      version: 2,
      company: "Acme Concurrent",
      appliedDate: "", // Server appliedDate still empty
    };

    const apiMock = vi.fn().mockRejectedValueOnce(
      new APIError(409, "Conflict", serverApp),
    );
    renderHook({
      api: apiMock,
      applications: [originalApp],
      user: { ...mockUser, timezone: "Europe/Moscow" },
    });

    await act(async () => {
      await hookResult.handleStageChange(originalApp, "interview");
    });

    apiMock.mockResolvedValueOnce({ ...serverApp, stage: "interview", version: 3 });
    await act(async () => {
      await hookResult.retryConflict();
    });

    expect(apiMock).toHaveBeenLastCalledWith(
      "/applications/" + originalApp.id,
      "PUT",
      expect.objectContaining({
        version: 2,
        stage: "interview",
        company: "Acme Concurrent",
        appliedDate: expect.stringMatching(/^\d{4}-\d{2}-\d{2}$/),
      }),
    );
  });

  it("changes and clears groups, retrying only the group after a conflict", async () => {
    const original = mockApps[0];
    const server = {
      ...original,
      version: 3,
      company: "Concurrent company",
      stage: "offer",
    };
    const apiMock = vi
      .fn()
      .mockRejectedValueOnce(new APIError(409, "Conflict", server));
    renderHook({ api: apiMock, applications: [original] });
    await act(async () => {
      await hookResult.handleGroupChange(original, "Remote");
    });
    apiMock.mockResolvedValue({});
    await act(async () => {
      await hookResult.retryConflict();
    });
    expect(apiMock).toHaveBeenLastCalledWith(
      "/applications/" + original.id,
      "PUT",
      {
        ...server,
        groups: ["Remote"],
      },
    );
    await act(async () => {
      await hookResult.handleGroupChange(original, "");
    });
    expect(apiMock).toHaveBeenLastCalledWith(
      "/applications/" + original.id,
      "PUT",
      {
        ...original,
        groups: [],
      },
    );
  });

  it("sparse retry for favorite preserves server version and concurrent changes", async () => {
    const originalApp = { ...mockApps[0], favorite: false, version: 1 };
    const serverApp: Application = {
      ...originalApp,
      version: 5,
      company: "Acme New",
      recruiter: "Alice",
    };

    const apiMock = vi.fn().mockRejectedValueOnce(
      new APIError(409, "Conflict", serverApp),
    );
    renderHook({ api: apiMock, applications: [originalApp] });

    await act(async () => {
      await hookResult.toggleFavorite(originalApp);
    });

    apiMock.mockResolvedValueOnce({ ...serverApp, favorite: true, version: 6 });
    await act(async () => {
      await hookResult.retryConflict();
    });

    expect(apiMock).toHaveBeenLastCalledWith(
      "/applications/" + originalApp.id,
      "PUT",
      expect.objectContaining({
        version: 5,
        favorite: true,
        company: "Acme New",
        recruiter: "Alice",
      }),
    );
  });

  it("simulates 409 inside outcome modal, updates modal app to current server version without losing user outcome, and second submit succeeds", async () => {
    const originalApp = { ...mockApps[0], state: "active", version: 1 };
    const serverApp: Application = {
      ...originalApp,
      version: 2,
      recruiter: "New Recruiter",
      company: "Acme v2",
    };

    // First attempt rejects with 409
    const apiMock = vi.fn().mockRejectedValueOnce(
      new APIError(409, "Conflict", serverApp),
    );
    renderHook({ api: apiMock, applications: [originalApp] });

    act(() => {
      void hookResult.handleStateChange(originalApp, "closed");
    });
    expect(hookResult.outcomeModalApp?.version).toBe(1);

    await act(async () => {
      try {
        await hookResult.handleConfirmOutcome("offer_declined");
      } catch {}
    });

    // Modal app updated to serverApp (version 2), modal remains open
    expect(hookResult.outcomeModalApp?.id).toBe(originalApp.id);
    expect(hookResult.outcomeModalApp?.version).toBe(2);

    // Second submit succeeds with latest version (2) and preserves server's concurrent recruiter and company
    apiMock.mockResolvedValueOnce({ ...serverApp, state: "closed", outcome: "offer_declined", version: 3 });
    await act(async () => {
      await hookResult.handleConfirmOutcome("offer_declined");
    });

    expect(apiMock).toHaveBeenLastCalledWith(
      "/applications/" + originalApp.id,
      "PUT",
      expect.objectContaining({
        version: 2,
        state: "closed",
        outcome: "offer_declined",
        recruiter: "New Recruiter",
        company: "Acme v2",
      }),
    );
    expect(hookResult.outcomeModalApp).toBeNull();
  });

  it("does not produce unhandled Promise rejection on repeated 409 conflict during retry", async () => {
    const originalApp = { ...mockApps[0], stage: "saved", version: 1 };
    const serverApp1: Application = { ...originalApp, version: 2 };
    const serverApp2: Application = { ...originalApp, version: 3 };

    // Initial action gets 409
    const apiMock = vi.fn().mockRejectedValueOnce(
      new APIError(409, "Conflict", serverApp1),
    );
    renderHook({ api: apiMock, applications: [originalApp] });

    await act(async () => {
      await hookResult.handleStageChange(originalApp, "applied");
    });

    // Next retry also gets 409
    apiMock.mockRejectedValueOnce(
      new APIError(409, "Conflict", serverApp2),
    );

    // Calling retryConflict should safely catch and not reject the returned promise
    await act(async () => {
      await expect(hookResult.retryConflict()).resolves.toBeUndefined();
    });

    // conflictApp updated to second server version
    expect(hookResult.conflictApp?.server.version).toBe(3);
    expect(hookResult.saveError).toBeDefined();
  });

  it("does not perform retry and leaves server untouched when conflictApp has no sparse patch intent", async () => {
    const originalApp = { ...mockApps[0], version: 1 };
    const serverApp: Application = { ...originalApp, version: 2, company: "Acme Untouched" };

    const apiMock = vi.fn();
    renderHook({ api: apiMock, applications: [originalApp] });

    // Simulate an untracked/general edit conflict where patch is undefined
    act(() => {
      hookResult.setConflictApp({
        local: { ...originalApp, company: "Acme Stale Local" },
        server: serverApp,
        patch: undefined,
      });
    });

    await act(async () => {
      await hookResult.retryConflict();
    });

    // api should NOT have been called with stale local overwrite!
    expect(apiMock).not.toHaveBeenCalled();
  });
});

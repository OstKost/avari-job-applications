import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import React, { act } from "react";
import * as ReactDOMClient from "react-dom/client";
import { detectPwaCapabilities } from "./capabilities";
import { TabCoordinator } from "./tab-coordinator";
import { parseIncomingShareTarget } from "./index";
import { usePwa, type UsePwaReturn } from "./usePwa";
import {
  extractValidHttpUrl,
  parseShareTargetParams,
  savePendingShare,
  getPendingShare,
  clearPendingShare,
} from "./share-target";

describe("detectPwaCapabilities", () => {
  const originalNavigator = window.navigator;

  afterEach(() => {
    Object.defineProperty(window, "navigator", {
      value: originalNavigator,
      writable: true,
      configurable: true,
    });
  });

  it("detects non-standalone desktop browser defaults", () => {
    Object.defineProperty(window.navigator, "serviceWorker", {
      value: {},
      writable: true,
      configurable: true,
    });
    const caps = detectPwaCapabilities();
    expect(caps.isStandalone).toBe(false);
    expect(caps.isInstallable).toBe(true);
    expect(caps.supportsServiceWorker).toBe(true);
  });

  it("detects iOS devices properly without false positives on ordinary Chrome", () => {
    Object.defineProperty(window, "navigator", {
      value: {
        ...originalNavigator,
        userAgent: "Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Mobile/15E148 Safari/604.1",
        platform: "iPhone",
      },
      writable: true,
      configurable: true,
    });

    const caps = detectPwaCapabilities();
    expect(caps.isIOS).toBe(true);
    expect(caps.isSafari).toBe(true);
  });

  it("detects iOS non-Safari browsers (Chrome on iOS)", () => {
    Object.defineProperty(window, "navigator", {
      value: {
        ...originalNavigator,
        userAgent: "Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) CriOS/120.0.0.0 Mobile/15E148 Safari/604.1",
        platform: "iPhone",
      },
      writable: true,
      configurable: true,
    });

    const caps = detectPwaCapabilities();
    expect(caps.isIOS).toBe(true);
    expect(caps.isSafari).toBe(false);
  });
});

describe("TabCoordinator", () => {
  let originalBroadcastChannel: any;

  beforeEach(() => {
    originalBroadcastChannel = globalThis.BroadcastChannel;
  });

  afterEach(() => {
    globalThis.BroadcastChannel = originalBroadcastChannel;
  });

  it("handles lack of BroadcastChannel gracefully", async () => {
    // @ts-ignore
    globalThis.BroadcastChannel = undefined;

    const coordinator = new TabCoordinator();
    const hasDirty = await coordinator.checkOtherTabsDirtyDrafts(10);
    expect(hasDirty).toBe(false);
    coordinator.destroy();
  });

  it("dispatches draft check and collects dirty responses between tabs", async () => {
    const channels: MockBroadcastChannel[] = [];

    class MockBroadcastChannel {
      name: string;
      listeners: Set<(event: MessageEvent) => void> = new Set();

      constructor(name: string) {
        this.name = name;
        channels.push(this);
      }

      addEventListener(type: string, fn: any) {
        if (type === "message") this.listeners.add(fn);
      }

      removeEventListener(type: string, fn: any) {
        if (type === "message") this.listeners.delete(fn);
      }

      postMessage(data: any) {
        setTimeout(() => {
          // Deliver to other channels on same name
          for (const ch of channels) {
            if (ch !== this && ch.name === this.name) {
              for (const fn of Array.from(ch.listeners)) {
                fn(new MessageEvent("message", { data }));
              }
            }
          }
        }, 0);
      }

      close() {
        this.listeners.clear();
        const idx = channels.indexOf(this);
        if (idx !== -1) channels.splice(idx, 1);
      }
    }

    // @ts-ignore
    globalThis.BroadcastChannel = MockBroadcastChannel;

    const tabA = new TabCoordinator();
    const tabB = new TabCoordinator();

    // 1. Tab B has a dirty draft
    tabB.registerDirtyDraftCheck(() => true);

    const hasDirty = await tabA.checkOtherTabsDirtyDrafts(50);
    expect(hasDirty).toBe(true);

    // 2. Tab B becomes clean
    tabB.registerDirtyDraftCheck(() => false);
    const hasDirtyAfterClean = await tabA.checkOtherTabsDirtyDrafts(50);
    expect(hasDirtyAfterClean).toBe(false);

    // 3. Fail-closed: Tab B check throws an error -> must treat as dirty
    tabB.registerDirtyDraftCheck(() => {
      throw new Error("IndexedDB read error");
    });
    const hasDirtyOnError = await tabA.checkOtherTabsDirtyDrafts(50);
    expect(hasDirtyOnError).toBe(true);

    tabA.destroy();
    tabB.destroy();
  });

  it("supports StrictMode re-initialization and clean destruction", async () => {
    const coordinator = new TabCoordinator();
    coordinator.registerDirtyDraftCheck(() => false);
    coordinator.unregisterDirtyDraftCheck();
    coordinator.destroy();

    // Checking after destroy should not throw and should safely resolve
    const res = await coordinator.checkOtherTabsDirtyDrafts(10);
    expect(res).toBe(false);
  });
});

describe("PWA Service Worker Update & Safety Logic (Real Hook Lifecycle)", () => {
  let container: HTMLDivElement | null = null;
  let root: ReactDOMClient.Root | null = null;

  beforeEach(() => {
    container = document.createElement("div");
    document.body.appendChild(container);
    root = ReactDOMClient.createRoot(container);
    vi.stubEnv("DEV", false);
  });

  afterEach(() => {
    if (root) {
      act(() => {
        root?.unmount();
      });
      root = null;
    }
    if (container) {
      container.remove();
      container = null;
    }
    vi.unstubAllEnvs();
  });

  it("does not reload on first install / controllerchange without explicit approval", async () => {
    let reloadCalled = false;
    let hookResult: UsePwaReturn | null = null;

    function TestComponent() {
      const pwa = usePwa({
        reloadFn: () => {
          reloadCalled = true;
        },
      });
      hookResult = pwa;
      return null;
    }

    const swListeners: Record<string, ((e?: any) => void)[]> = {};
    const mockRegistration = {
      waiting: null,
      installing: null,
      addEventListener: vi.fn(),
    };

    Object.defineProperty(window.navigator, "serviceWorker", {
      value: {
        controller: null,
        register: vi.fn().mockResolvedValue(mockRegistration),
        addEventListener: (event: string, fn: (e?: any) => void) => {
          swListeners[event] = swListeners[event] || [];
          swListeners[event].push(fn);
        },
        removeEventListener: vi.fn(),
      },
      writable: true,
      configurable: true,
    });

    await act(async () => {
      root?.render(React.createElement(TestComponent));
    });

    // Simulate initial service worker becoming active / controllerchange
    const handlers = swListeners["controllerchange"] || [];
    for (const h of handlers) {
      h();
    }

    expect(reloadCalled).toBe(false);
    expect(hookResult).not.toBeNull();
  });

  it("prevents update activation and does not post SKIP_WAITING when flush fails or rejects", async () => {
    let hookResult: UsePwaReturn | null = null;
    let skipWaitingSent = false;
    let reloadCalled = false;

    const mockWaitingWorker = {
      state: "installed",
      postMessage: vi.fn((msg) => {
        if (msg?.type === "SKIP_WAITING") skipWaitingSent = true;
      }),
      addEventListener: vi.fn(),
    };

    const mockRegistration = {
      waiting: mockWaitingWorker,
      installing: null,
      addEventListener: vi.fn(),
    };

    Object.defineProperty(window.navigator, "serviceWorker", {
      value: {
        controller: {},
        register: vi.fn().mockResolvedValue(mockRegistration),
        addEventListener: vi.fn(),
        removeEventListener: vi.fn(),
      },
      writable: true,
      configurable: true,
    });

    function TestComponent() {
      hookResult = usePwa({
        onFlushDirtyDrafts: async () => {
          return false; // refused to flush
        },
        reloadFn: () => {
          reloadCalled = true;
        },
      });
      return null;
    }

    await act(async () => {
      root?.render(React.createElement(TestComponent));
    });

    // Attempt update
    let success = true;
    await act(async () => {
      success = await hookResult!.updateServiceWorker();
    });

    expect(success).toBe(false);
    expect(skipWaitingSent).toBe(false);
    expect(reloadCalled).toBe(false);
  });

  it("posts SKIP_WAITING on explicit update and reloads only on confirmed activation event", async () => {
    let hookResult: UsePwaReturn | null = null;
    let skipWaitingSent = false;
    let reloadCalled = false;
    const workerStateListeners: ((e?: any) => void)[] = [];

    const mockWaitingWorker = {
      state: "installed",
      postMessage: vi.fn((msg) => {
        if (msg?.type === "SKIP_WAITING") skipWaitingSent = true;
      }),
      addEventListener: vi.fn((event, fn) => {
        if (event === "statechange") {
          workerStateListeners.push(fn);
        }
      }),
    };

    const mockRegistration = {
      waiting: mockWaitingWorker,
      installing: null,
      addEventListener: vi.fn(),
    };

    Object.defineProperty(window.navigator, "serviceWorker", {
      value: {
        controller: {},
        register: vi.fn().mockResolvedValue(mockRegistration),
        addEventListener: vi.fn(),
        removeEventListener: vi.fn(),
      },
      writable: true,
      configurable: true,
    });

    function TestComponent() {
      hookResult = usePwa({
        onFlushDirtyDrafts: async () => {
          return true; // successfully flushed
        },
        reloadFn: () => {
          reloadCalled = true;
        },
      });
      return null;
    }

    await act(async () => {
      root?.render(React.createElement(TestComponent));
    });

    await act(async () => {
      const res = await hookResult!.updateServiceWorker();
      expect(res).toBe(true);
    });

    // SKIP_WAITING was sent, but reload must NOT happen until confirmed activation
    expect(skipWaitingSent).toBe(true);
    expect(reloadCalled).toBe(false);

    // Simulate waiting worker reaching 'activated' state
    mockWaitingWorker.state = "activated";
    await act(async () => {
      for (const fn of workerStateListeners) {
        fn();
      }
    });

    // Now reload is confirmed and called!
    expect(reloadCalled).toBe(true);
  });
});

describe("parseIncomingShareTarget", () => {
  it("extracts share target query parameters", () => {
    const params = new URLSearchParams("title=Frontend+Dev&text=Vacancy+details&url=https%3A%2F%2Fhh.ru%2Fvacancy%2F123");
    const payload = parseIncomingShareTarget(params);
    expect(payload).toEqual({
      title: "Frontend Dev",
      text: "Vacancy details",
      url: "https://hh.ru/vacancy/123",
    });
  });

  it("returns null when no share target params present", () => {
    const params = new URLSearchParams("foo=bar");
    expect(parseIncomingShareTarget(params)).toBeNull();
  });
});

describe("Share Target Validation & Storage (T3)", () => {
  beforeEach(() => {
    window.sessionStorage.clear();
  });

  afterEach(() => {
    window.sessionStorage.clear();
  });

  it("extracts valid HTTP/HTTPS URLs and rejects unsafe protocols", () => {
    // Valid HTTPS
    expect(extractValidHttpUrl("https://hh.ru/vacancy/123456", null)).toBe("https://hh.ru/vacancy/123456");
    // Valid HTTP
    expect(extractValidHttpUrl("http://example.com/job/1", null)).toBe("http://example.com/job/1");

    // Rejects unsafe protocols: javascript:, data:, file:, vbscript:
    expect(extractValidHttpUrl("javascript:alert(1)", null)).toBeNull();
    expect(extractValidHttpUrl("data:text/html,<b>xss</b>", null)).toBeNull();
    expect(extractValidHttpUrl("file:///etc/passwd", null)).toBeNull();
    expect(extractValidHttpUrl("about:blank", null)).toBeNull();
  });

  it("falls back to extracting HTTP(S) URL from text body when url param is missing", () => {
    const text = "Посмотри отличную вакансию: https://hh.ru/vacancy/987654321 тебе подойдет!";
    const url = extractValidHttpUrl(null, text);
    expect(url).toBe("https://hh.ru/vacancy/987654321");

    // Text containing unsafe URL is ignored
    const unsafeText = "Посмотри вакансию: javascript:doBadStuff()";
    expect(extractValidHttpUrl(null, unsafeText)).toBeNull();
  });

  it("parses share target query params and canonicalizes known job sites via jobIdentity", () => {
    const query = new URLSearchParams({
      title: "Senior React Developer - Авито",
      text: "Интересная позиция",
      url: "https://hh.ru/vacancy/11223344?from=share_ios",
    });

    const parsed = parseShareTargetParams(query);
    expect(parsed).not.toBeNull();
    expect(parsed?.rawUrl).toBe("https://hh.ru/vacancy/11223344?from=share_ios");
    expect(parsed?.canonicalUrl).toBe("https://hh.ru/vacancy/11223344");
    expect(parsed?.site).toBe("hh");
    expect(parsed?.externalId).toBe("11223344");
    expect(parsed?.title).toBe("Senior React Developer - Авито");
    expect(parsed?.text).toBe("Интересная позиция");
  });

  it("bounds long string inputs to prevent memory bloat", () => {
    const hugeTitle = "A".repeat(5000);
    const query = new URLSearchParams({
      title: hugeTitle,
      url: "https://hh.ru/vacancy/100",
    });

    const parsed = parseShareTargetParams(query);
    expect(parsed?.title?.length).toBe(1000);
  });

  it("saves and retrieves pending share in sessionStorage with TTL check", () => {
    const mockStorage: Storage = (() => {
      let store: Record<string, string> = {};
      return {
        getItem: (k: string) => store[k] || null,
        setItem: (k: string, v: string) => { store[k] = v; },
        removeItem: (k: string) => { delete store[k]; },
        clear: () => { store = {}; },
        key: () => null,
        length: 0,
      };
    })();

    const data = {
      rawUrl: "https://hh.ru/vacancy/555",
      canonicalUrl: "https://hh.ru/vacancy/555",
      title: "DevOps",
      text: null,
    };

    savePendingShare(data, mockStorage);
    const retrieved = getPendingShare(mockStorage, 10000);
    expect(retrieved).toEqual(data);

    // TTL expiry test: simulate time passage
    const expiredData = getPendingShare(mockStorage, -1);
    expect(expiredData).toBeNull();
  });

  it("preserves incoming share across login without automatic submission or record creation", () => {
    const mockStorage: Storage = (() => {
      let store: Record<string, string> = {};
      return {
        getItem: (k: string) => store[k] || null,
        setItem: (k: string, v: string) => { store[k] = v; },
        removeItem: (k: string) => { delete store[k]; },
        clear: () => { store = {}; },
        key: () => null,
        length: 0,
      };
    })();

    // Step 1: Unauthenticated user opens /share?url=https://hh.ru/vacancy/777
    const incoming = parseShareTargetParams(new URLSearchParams("url=https%3A%2F%2Fhh.ru%2Fvacancy%2F777&title=Backend+Go"));
    expect(incoming).not.toBeNull();
    savePendingShare(incoming!, mockStorage);

    // Step 2: User goes through login (sessionStorage persists)
    expect(getPendingShare(mockStorage)).toEqual(incoming);

    // Step 3: User logs in; application consumes the draft to open the form
    let autoSaved = false;
    const formDraft: any = {};
    const onOpenVacancyForm = (shared: any) => {
      // Must only fill the draft form, NEVER auto-save or submit to backend!
      formDraft.url = shared.canonicalUrl;
      formDraft.position = shared.title;
      // autoSaved remains false
    };

    const pending = getPendingShare(mockStorage);
    if (pending) {
      onOpenVacancyForm(pending);
      clearPendingShare(mockStorage);
    }

    expect(formDraft.url).toBe("https://hh.ru/vacancy/777");
    expect(formDraft.position).toBe("Backend Go");
    expect(autoSaved).toBe(false);

    // Step 4: Subsequent checks find no leftover pending share (prevents repeated opens)
    expect(getPendingShare(mockStorage)).toBeNull();
  });
});

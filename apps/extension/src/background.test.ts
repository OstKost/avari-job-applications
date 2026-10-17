import { afterEach, expect, it, vi } from "vitest";

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

async function background(
  url = "https://example.com/",
  initialStorage: Record<string, any> = {},
) {
  vi.resetModules();
  let listener: (
    message: unknown,
    sender: chrome.runtime.MessageSender,
    reply: (value: any) => void,
  ) => void;
  const tab = { id: 7, url };
  const chromeMock = {
    runtime: {
      id: "avari",
      getURL: (path: string) => "chrome-extension://avari/" + path,
      onMessage: {
        addListener: (fn: typeof listener) => {
          listener = fn;
        },
      },
      onInstalled: { addListener: vi.fn() },
    },
    storage: {
      local: {
        setAccessLevel: vi.fn(),
        get: vi.fn().mockImplementation(async (keys: any) => {
          if (Array.isArray(keys)) {
            const out: Record<string, any> = {};
            for (const k of keys) out[k] = initialStorage[k];
            return out;
          }
          return { ...initialStorage };
        }),
        set: vi.fn(),
        remove: vi.fn(),
      },
    },
    permissions: { onAdded: { addListener: vi.fn() } },
    tabs: {
      query: vi.fn().mockResolvedValue([tab]),
      get: vi.fn().mockResolvedValue(tab),
      sendMessage: vi
        .fn()
        .mockResolvedValue({ opened: true, supported: false }),
    },
    scripting: { executeScript: vi.fn().mockResolvedValue([]) },
    windows: { create: vi.fn().mockResolvedValue({}) },
  };
  vi.stubGlobal("chrome", chromeMock);
  await import("./background");
  const send = (
    message: unknown,
    sender: chrome.runtime.MessageSender = {
      id: "avari",
      url: "chrome-extension://avari/action.html",
    },
  ) => new Promise<any>((resolve) => listener(message, sender, resolve));
  return { chromeMock, send };
}

it("opens on an unrelated site using activeTab injection", async () => {
  const { chromeMock: c, send } = await background();
  c.tabs.sendMessage.mockRejectedValueOnce(new Error("No content script"));
  expect(await send({ type: "OPEN_PANEL" })).toMatchObject({
    ok: true,
    data: { opened: true },
  });
  expect(c.scripting.executeScript).toHaveBeenCalledWith({
    target: { tabId: 7 },
    files: ["content.js"],
  });
  expect(c.windows.create).not.toHaveBeenCalled();
});

it("falls back to an extension window bound to the original restricted tab", async () => {
  const { chromeMock: c, send } = await background("chrome://settings/");
  c.tabs.sendMessage.mockRejectedValue(new Error("Cannot access page"));
  c.scripting.executeScript.mockRejectedValue(new Error("Cannot inject"));
  expect(await send({ type: "OPEN_PANEL" })).toMatchObject({ ok: true });
  expect(c.windows.create).toHaveBeenCalledWith(
    expect.objectContaining({
      url: "chrome-extension://avari/index.html?tabId=7",
      type: "popup",
    }),
  );
});

it("reads the iframe's own tab even when another tab is active", async () => {
  const { chromeMock: c, send } = await background();
  const snapshot = { supported: true, kind: "favorites", observations: [] };
  c.tabs.sendMessage.mockResolvedValue(snapshot as any);
  const reply = await send(
    { type: "READ_ACTIVE" },
    {
      id: "avari",
      url: "chrome-extension://avari/index.html?embedded=1",
      tab: {
        id: 12,
        url: "https://hh.ru/applicant/vacancies",
        index: 0,
        pinned: false,
        highlighted: false,
        windowId: 1,
        active: false,
        incognito: false,
        selected: false,
        discarded: false,
        frozen: false,
        autoDiscardable: true,
        groupId: -1,
      },
    },
  );
  expect(reply.data).toEqual(snapshot);
  expect(c.tabs.sendMessage).toHaveBeenCalledWith(12, { type: "READ_PAGE" });
  expect(c.tabs.query).not.toHaveBeenCalled();
});

it("keeps a closed source tab unsupported instead of reading another tab", async () => {
  const { chromeMock: c, send } = await background("https://hh.ru/vacancy/123");
  c.tabs.get.mockRejectedValue(new Error("Tab closed"));
  expect(await send({ type: "READ_ACTIVE", tabId: 12 })).toMatchObject({
    ok: true,
    data: { supported: false },
  });
  expect(c.tabs.query).not.toHaveBeenCalled();
  expect(c.tabs.sendMessage).not.toHaveBeenCalled();
});

it("rejects page snapshots from an unrelated website", async () => {
  const { send } = await background();
  expect(
    await send(
      {
        type: "PAGE_SNAPSHOT",
        snapshot: { supported: true, observations: [] },
      },
      {
        id: "avari",
        url: "https://example.com/",
        tab: { id: 7 } as chrome.tabs.Tab,
      },
    ),
  ).toMatchObject({ ok: false });
});

it("reads a content script when Chrome omits tab URLs without tabs permission", async () => {
  const { chromeMock: c, send } = await background();
  c.tabs.query.mockResolvedValue([{ id: 7 } as any]);
  c.tabs.sendMessage.mockResolvedValue({
    supported: true,
    kind: "favorites",
    observations: [],
  } as any);
  expect(await send({ type: "READ_ACTIVE" })).toMatchObject({
    ok: true,
    data: { supported: true },
  });
});

it("enriches existing application companyLogo on revisit without overwriting manual fields and safely ignores 409 conflict", async () => {
  const fetchMock = vi.fn();
  vi.stubGlobal("fetch", fetchMock);

  const existingApp = {
    id: "app-123",
    version: 1,
    url: "https://hh.ru/vacancy/999",
    position: "Senior Go Developer",
    company: "Acme Corp",
    companyLogo: "",
    notes: "Custom user note",
    salary: { min: 300000, currency: "RUB" },
  };

  // Mock chrome storage with server & token
  const { chromeMock: c, send } = await background(
    "https://hh.ru/vacancy/999",
    {
      server: "https://avari.example.com",
      token: "secret-token",
    },
  );

  let putCallCount = 0;
  fetchMock.mockImplementation(async (url: string, options: any) => {
    if (url.endsWith("/api/v1/applications") && (options?.method === "GET" || !options?.method)) {
      return {
        ok: true,
        status: 200,
        json: async () => [existingApp],
      };
    }
    if (
      url.endsWith("/api/v1/applications/app-123") &&
      options?.method === "PUT"
    ) {
      putCallCount++;
      const body = JSON.parse(options.body);
      return {
        ok: true,
        status: 200,
        json: async () => ({ ...body, version: 2 }),
      };
    }
    if (url.endsWith("/api/v1/proposals")) {
      return {
        ok: true,
        status: 200,
        json: async () => [],
      };
    }
    return {
      ok: true,
      status: 200,
      json: async () => ({}),
    };
  });

  const snapshot = {
    supported: true,
    kind: "vacancy",
    vacancy: {
      url: "https://hh.ru/vacancy/999",
      hhId: "999",
      company: "Acme Corp (Updated in DOM)",
      position: "Junior Go Developer (Different in DOM)",
      companyLogo: "https://hh.ru/employer-logo/123.png",
    },
    observations: [],
  };

  const response = await send(
    { type: "PAGE_SNAPSHOT", snapshot },
    {
      id: "avari",
      url: "https://hh.ru/vacancy/999",
      tab: { id: 7 } as chrome.tabs.Tab,
    },
  );

  expect(response.ok).toBe(true);

  // Verify PUT /applications/app-123 was called with enriched companyLogo while preserving existing user fields
  const putCall = fetchMock.mock.calls.find(
    ([url, opts]) =>
      url === "https://avari.example.com/api/v1/applications/app-123" &&
      opts?.method === "PUT",
  );
  expect(putCall).toBeDefined();
  const putBody = JSON.parse(putCall![1].body);
  expect(putBody.companyLogo).toBe("https://hh.ru/employer-logo/123.png");
  expect(putBody.position).toBe("Senior Go Developer"); // NOT overwritten by DOM
  expect(putBody.company).toBe("Acme Corp"); // NOT overwritten by DOM
  expect(putBody.notes).toBe("Custom user note"); // preserved
  expect(putBody.version).toBe(1);

  // Now test 409 conflict safety: when server responds with 409, revisit finishes gracefully without blind retry
  fetchMock.mockClear();
  let conflictPutCalls = 0;
  fetchMock.mockImplementation(async (url: string, options: any) => {
    if (url.endsWith("/api/v1/applications") && (options?.method === "GET" || !options?.method)) {
      return {
        ok: true,
        status: 200,
        json: async () => [{ ...existingApp, companyLogo: "" }],
      };
    }
    if (
      url.endsWith("/api/v1/applications/app-123") &&
      options?.method === "PUT"
    ) {
      conflictPutCalls++;
      return {
        ok: false,
        status: 409,
        json: async () => ({ error: "Запись изменилась" }),
      };
    }
    return {
      ok: true,
      status: 200,
      json: async () => ([]),
    };
  });

  const conflictResponse = await send(
    { type: "PAGE_SNAPSHOT", snapshot },
    {
      id: "avari",
      url: "https://hh.ru/vacancy/999",
      tab: { id: 7 } as chrome.tabs.Tab,
    },
  );
  expect(conflictResponse.ok).toBe(true);
  expect(conflictPutCalls).toBe(1); // exactly 1 attempt, no blind retry loops
});

it("strips companyLogo on compatibility retry when server rejects with invalid JSON/unknown fields, but not for other errors", async () => {
  const fetchMock = vi.fn();
  vi.stubGlobal("fetch", fetchMock);

  const { chromeMock: c, send } = await background(
    "https://example.com/",
    {
      server: "https://avari.example.com",
      token: "secret-token",
    },
  );

  let attempts = 0;
  fetchMock.mockImplementation(async (url: string, options: any) => {
    attempts++;
    const body = options?.body ? JSON.parse(options.body) : {};
    if (attempts === 1) {
      expect(body.companyLogo).toBe("https://example.com/logo.png");
      return {
        ok: false,
        status: 400,
        json: async () => ({ error: "Некорректный JSON запроса" }),
      };
    }
    expect(body.companyLogo).toBeUndefined();
    return {
      ok: true,
      status: 200,
      json: async () => ({ id: "saved-app" }),
    };
  });

  const res = await send({
    type: "API",
    path: "/applications",
    method: "POST",
    body: {
      position: "Engineer",
      company: "Corp",
      companyLogo: "https://example.com/logo.png",
    },
  });

  expect(res.ok).toBe(true);
  expect(attempts).toBe(2);

  // Other 400 errors (e.g. validation error) should NOT strip logo and retry
  fetchMock.mockClear();
  let validationAttempts = 0;
  fetchMock.mockImplementation(async (url: string, options: any) => {
    validationAttempts++;
    return {
      ok: false,
      status: 400,
      json: async () => ({ error: "Некорректный адрес URL" }),
    };
  });

  const failRes = await send({
    type: "API",
    path: "/applications",
    method: "POST",
    body: {
      position: "Engineer",
      company: "Corp",
      companyLogo: "https://example.com/logo.png",
    },
  });
  expect(failRes.ok).toBe(false);
  expect(validationAttempts).toBe(1); // No retry
});


import { afterEach, expect, it, vi } from "vitest";

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

async function background(url = "https://example.com/") {
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
        get: vi.fn().mockResolvedValue({}),
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

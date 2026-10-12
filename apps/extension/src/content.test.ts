import { expect, it, vi } from "vitest";
const page = vi.hoisted(() => ({
  vacancy: { url: "https://hh.ru/vacancy/123", company: "", position: "" },
}));
vi.mock("./parser", () => ({
  parsePage: () => ({
    supported: true,
    kind: "vacancy",
    observations: [],
    vacancy: page.vacancy,
  }),
}));
it("opens manually and auto-opens compactly for new content, respecting dismissal", async () => {
  vi.useFakeTimers();
  let receive: (
    message: unknown,
    sender: unknown,
    reply: (value: unknown) => void,
  ) => void;
  vi.stubGlobal("chrome", {
    runtime: {
      id: "avari",
      getURL: (path: string) =>
        "chrome-extension://avari/" + path.replace(/^\//, ""),
      sendMessage: vi.fn().mockResolvedValue({ ok: true }),
      onMessage: {
        addListener: (listener: typeof receive) => {
          receive = listener;
        },
      },
    },
  });
  await import("./content");
  expect(document.querySelector("#avari-quick-popup")).toBeNull();
  receive!({ type: "OPEN_PANEL" }, {}, vi.fn());
  const host = document.querySelector<HTMLElement>("#avari-quick-popup")!;
  expect(host.shadowRoot!.querySelector("iframe")!.src).toContain("embedded=1");
  const iframe = host.shadowRoot!.querySelector("iframe")!;
  Object.defineProperty(iframe, "contentWindow", { value: window });
  window.dispatchEvent(
    new MessageEvent("message", {
      source: iframe.contentWindow,
      origin: "chrome-extension://avari",
      data: { type: "AVARI_COLLAPSED", collapsed: true },
    }),
  );
  expect(host.hasAttribute("data-collapsed")).toBe(true);
  const initialLeft = host.style.left;
  const initialTop = host.style.top;
  window.dispatchEvent(
    new MessageEvent("message", {
      source: iframe.contentWindow,
      origin: "chrome-extension://avari",
      data: { type: "AVARI_MOVE", dx: -20, dy: 15 },
    }),
  );
  expect(host.style.left).not.toBe(initialLeft);
  expect(host.style.top).not.toBe(initialTop);
  window.dispatchEvent(
    new MessageEvent("message", {
      source: iframe.contentWindow,
      origin: "https://hh.ru",
      data: { type: "AVARI_THEME", theme: "light" },
    }),
  );
  expect(host.getAttribute("data-theme")).toBeNull();
  for (const theme of ["light", "dark"]) {
    window.dispatchEvent(
      new MessageEvent("message", {
        source: iframe.contentWindow,
        origin: "chrome-extension://avari",
        data: { type: "AVARI_THEME", theme },
      }),
    );
    expect(host.getAttribute("data-theme")).toBe(theme);
  }

  receive!({ type: "OPEN_PANEL" }, {}, vi.fn());
  expect(host.hasAttribute("data-collapsed")).toBe(false);
  (
    host.shadowRoot!.querySelector(
      '[aria-label="Закрыть мини-окно"]',
    ) as HTMLButtonElement
  ).click();
  expect(document.querySelector("#avari-quick-popup")).toBeNull();
  receive!({ type: "READ_PAGE" }, {}, vi.fn());
  expect(document.querySelector("#avari-quick-popup")).toBeNull();
  receive!({ type: "OPEN_PANEL" }, {}, vi.fn());
  expect(document.querySelector("#avari-quick-popup")).not.toBeNull();
  (
    document
      .querySelector<HTMLElement>("#avari-quick-popup")!
      .shadowRoot!.querySelector(
        '[aria-label="Закрыть мини-окно"]',
      ) as HTMLButtonElement
  ).click();
  page.vacancy.company = "Avari";
  page.vacancy.position = "Developer";
  receive!({ type: "READ_PAGE" }, {}, vi.fn());
  await Promise.resolve();
  const automatic = document.querySelector<HTMLElement>("#avari-quick-popup")!;
  expect(automatic.hasAttribute("data-collapsed")).toBe(true);
  expect(automatic.shadowRoot!.querySelector("iframe")!.src).toContain(
    "collapsed=1",
  );
  (
    automatic.shadowRoot!.querySelector(
      '[aria-label="Закрыть мини-окно"]',
    ) as HTMLButtonElement
  ).click();
  receive!({ type: "READ_PAGE" }, {}, vi.fn());
  await Promise.resolve();
  expect(document.querySelector("#avari-quick-popup")).toBeNull();
  page.vacancy.position = "Senior developer";
  receive!({ type: "READ_PAGE" }, {}, vi.fn());
  await Promise.resolve();
  expect(
    document
      .querySelector("#avari-quick-popup")!
      .hasAttribute("data-collapsed"),
  ).toBe(true);
  Object.defineProperty(chrome.runtime, "id", {
    value: undefined,
    configurable: true,
  });
  vi.advanceTimersByTime(1000);
  expect(document.querySelector("#avari-quick-popup")).toBeNull();
  const calls = vi.mocked(chrome.runtime.sendMessage).mock.calls.length;
  vi.advanceTimersByTime(30000);
  expect(chrome.runtime.sendMessage).toHaveBeenCalledTimes(calls);
  vi.clearAllTimers();
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

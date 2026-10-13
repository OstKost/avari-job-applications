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
  const postMessage = vi
    .spyOn(window, "postMessage")
    .mockImplementation(() => {});
  window.dispatchEvent(
    new MessageEvent("message", {
      source: iframe.contentWindow,
      origin: "chrome-extension://avari",
      data: { type: "AVARI_COLLAPSED", collapsed: true },
    }),
  );
  // The frame can initialize collapsed after OPEN_PANEL; resend expansion once it is ready.
  expect(postMessage).toHaveBeenCalledWith(
    { type: "AVARI_EXPAND" },
    "chrome-extension://avari",
  );
  expect(host.hasAttribute("data-collapsed")).toBe(false);
  for (const collapsed of [false, true]) {
    window.dispatchEvent(
      new MessageEvent("message", {
        source: iframe.contentWindow,
        origin: "chrome-extension://avari",
        data: { type: "AVARI_COLLAPSED", collapsed },
      }),
    );
  }
  postMessage.mockRestore();
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

  // Toast notifications testing
  window.dispatchEvent(
    new MessageEvent("message", {
      source: iframe.contentWindow,
      origin: "chrome-extension://avari",
      data: {
        type: "AVARI_TOAST",
        message: "Вакансия сохранена",
        kind: "success",
        subtitle: "Все изменения сохранены",
      },
    }),
  );
  const toastHost = document.querySelector<HTMLElement>("#avari-toast-host")!;
  expect(toastHost).not.toBeNull();
  expect(toastHost.getAttribute("data-theme")).toBe("dark");
  const toastEl = toastHost.shadowRoot!.querySelector(".toast.kind-success")!;
  expect(toastEl).not.toBeNull();
  expect(toastEl.textContent).toContain("Вакансия сохранена");
  expect(toastEl.textContent).toContain("Все изменения сохранены");

  // Warning toast
  window.dispatchEvent(
    new MessageEvent("message", {
      source: iframe.contentWindow,
      origin: "chrome-extension://avari",
      data: {
        type: "AVARI_TOAST",
        message: "Обнаружены изменения вакансии",
        kind: "warning",
        subtitle: "Найдено 1 предложение для обновления",
      },
    }),
  );
  const warningToast = toastHost.shadowRoot!.querySelector(
    ".toast.kind-warning",
  )!;
  expect(warningToast).not.toBeNull();
  expect(warningToast.textContent).toContain("Обнаружены изменения вакансии");

  // Info toast
  window.dispatchEvent(
    new MessageEvent("message", {
      source: iframe.contentWindow,
      origin: "chrome-extension://avari",
      data: {
        type: "AVARI_TOAST",
        message: "Вакансия уже в журнале",
        kind: "info",
        subtitle: "Компания: Acme",
      },
    }),
  );
  const infoToast = toastHost.shadowRoot!.querySelector(".toast.kind-info")!;
  expect(infoToast).not.toBeNull();
  expect(infoToast.textContent).toContain("Вакансия уже в журнале");

  // Error toast
  window.dispatchEvent(
    new MessageEvent("message", {
      source: iframe.contentWindow,
      origin: "chrome-extension://avari",
      data: {
        type: "AVARI_TOAST",
        message: "Сервер недоступен",
        kind: "error",
      },
    }),
  );
  const errorToast = toastHost.shadowRoot!.querySelector(".toast.kind-error")!;
  expect(errorToast).not.toBeNull();
  expect(errorToast.textContent).toContain("Сервер недоступен");

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

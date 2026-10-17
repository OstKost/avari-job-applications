import { parsePage, type Snapshot } from "./parser";
let stopped = false;
let toastHost: HTMLDivElement | undefined;
let toastTimeout: ReturnType<typeof setTimeout> | undefined;
function contextAlive() {
  if (stopped) return false;
  if (chrome.runtime.id) return true;
  stopped = true;
  observer.disconnect();
  clearTimeout(timer);
  clearInterval(urlTimer);
  clearTimeout(toastTimeout);
  host?.remove();
  host = undefined;
  frame = undefined;
  toastHost?.remove();
  toastHost = undefined;
  return false;
}
let currentTheme: "dark" | "light" = "dark";
function showToast(
  message: string,
  kind: "success" | "error" | "info" | "warning" = "success",
  subtitle?: string,
) {
  if (!contextAlive()) return;
  if (!toastHost) {
    toastHost = document.createElement("div");
    toastHost.id = "avari-toast-host";
    const shadow = toastHost.attachShadow({ mode: "open" });
    const style = document.createElement("style");
    style.textContent = `
      :host {
        all: initial;
        position: fixed;
        top: 24px;
        left: 50%;
        transform: translateX(-50%);
        z-index: 2147483647;
        pointer-events: none;
        font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, Helvetica, Arial, sans-serif;
      }
      .toast {
        pointer-events: auto;
        display: flex;
        align-items: center;
        gap: 12px;
        min-width: 280px;
        max-width: min(440px, calc(100vw - 32px));
        padding: 12px 16px;
        border-radius: 14px;
        font-size: 13px;
        line-height: 1.4;
        box-shadow: 0 16px 36px rgba(0, 0, 0, 0.4), 0 0 0 1px rgba(255, 255, 255, 0.08);
        animation: avari-toast-in 260ms cubic-bezier(0.16, 1, 0.3, 1) both;
        backdrop-filter: blur(16px);
        -webkit-backdrop-filter: blur(16px);
        box-sizing: border-box;
      }
      .toast.closing {
        animation: avari-toast-out 200ms cubic-bezier(0.4, 0, 1, 1) both;
      }
      @keyframes avari-toast-in {
        from { opacity: 0; transform: translateY(-16px) scale(0.96); }
        to { opacity: 1; transform: translateY(0) scale(1); }
      }
      @keyframes avari-toast-out {
        from { opacity: 1; transform: translateY(0) scale(1); }
        to { opacity: 0; transform: translateY(-12px) scale(0.96); }
      }
      .icon-wrap {
        display: flex;
        align-items: center;
        justify-content: center;
        width: 32px;
        height: 32px;
        border-radius: 10px;
        flex-shrink: 0;
      }
      .icon-wrap svg {
        width: 18px;
        height: 18px;
        stroke-width: 2.2;
      }
      .content {
        flex: 1;
        min-width: 0;
        display: flex;
        flex-direction: column;
        gap: 2px;
      }
      .title {
        font-weight: 600;
        letter-spacing: -0.2px;
        word-break: break-word;
      }
      .subtitle {
        font-size: 11px;
        opacity: 0.8;
        word-break: break-word;
      }
      .close {
        background: transparent;
        border: 0;
        color: inherit;
        font-size: 18px;
        line-height: 1;
        cursor: pointer;
        padding: 4px;
        border-radius: 6px;
        opacity: 0.6;
        transition: opacity 0.15s, background 0.15s;
        display: flex;
        align-items: center;
        justify-content: center;
      }
      .close:hover {
        opacity: 1;
        background: rgba(255, 255, 255, 0.12);
      }
      /* Success style (Emerald - Dark & Light) */
      :host([data-theme="dark"]) .toast.kind-success,
      :host(:not([data-theme="light"])) .toast.kind-success {
        background: rgba(13, 38, 28, 0.95);
        color: #ecfdf5;
        border: 1px solid rgba(52, 211, 153, 0.4);
      }
      :host([data-theme="dark"]) .toast.kind-success .icon-wrap,
      :host(:not([data-theme="light"])) .toast.kind-success .icon-wrap {
        background: rgba(52, 211, 153, 0.18);
        color: #34d399;
      }
      :host([data-theme="light"]) .toast.kind-success {
        background: rgba(255, 255, 255, 0.98);
        color: #064e3b;
        border: 1px solid rgba(16, 185, 129, 0.35);
        box-shadow: 0 16px 36px rgba(16, 185, 129, 0.15), 0 0 0 1px rgba(0, 0, 0, 0.04);
      }
      :host([data-theme="light"]) .toast.kind-success .icon-wrap {
        background: #ecfdf5;
        color: #059669;
      }
      :host([data-theme="light"]) .close:hover {
        background: rgba(0, 0, 0, 0.06);
      }

      /* Warning style (Amber - Dark & Light) */
      :host([data-theme="dark"]) .toast.kind-warning,
      :host(:not([data-theme="light"])) .toast.kind-warning {
        background: rgba(43, 32, 12, 0.95);
        color: #fffbeb;
        border: 1px solid rgba(251, 191, 36, 0.4);
      }
      :host([data-theme="dark"]) .toast.kind-warning .icon-wrap,
      :host(:not([data-theme="light"])) .toast.kind-warning .icon-wrap {
        background: rgba(251, 191, 36, 0.18);
        color: #fbbf24;
      }
      :host([data-theme="light"]) .toast.kind-warning {
        background: rgba(255, 255, 255, 0.98);
        color: #78350f;
        border: 1px solid rgba(217, 119, 6, 0.35);
        box-shadow: 0 16px 36px rgba(217, 119, 6, 0.15), 0 0 0 1px rgba(0, 0, 0, 0.04);
      }
      :host([data-theme="light"]) .toast.kind-warning .icon-wrap {
        background: #fffbeb;
        color: #d97706;
      }

      /* Error style (Coral - Dark & Light) */
      :host([data-theme="dark"]) .toast.kind-error,
      :host(:not([data-theme="light"])) .toast.kind-error {
        background: rgba(45, 21, 28, 0.95);
        color: #ffeef0;
        border: 1px solid rgba(248, 113, 113, 0.4);
      }
      :host([data-theme="dark"]) .toast.kind-error .icon-wrap,
      :host(:not([data-theme="light"])) .toast.kind-error .icon-wrap {
        background: rgba(248, 113, 113, 0.18);
        color: #f87171;
      }
      :host([data-theme="light"]) .toast.kind-error {
        background: rgba(255, 255, 255, 0.98);
        color: #4a151b;
        border: 1px solid rgba(180, 35, 60, 0.3);
        box-shadow: 0 16px 36px rgba(180, 35, 60, 0.15), 0 0 0 1px rgba(0, 0, 0, 0.04);
      }
      :host([data-theme="light"]) .toast.kind-error .icon-wrap {
        background: #fff1f3;
        color: #b4233c;
      }

      /* Info style (Cyan/Sky - Dark & Light) */
      :host([data-theme="dark"]) .toast.kind-info,
      :host(:not([data-theme="light"])) .toast.kind-info {
        background: rgba(14, 34, 48, 0.95);
        color: #eef6fc;
        border: 1px solid rgba(56, 189, 248, 0.35);
      }
      :host([data-theme="dark"]) .toast.kind-info .icon-wrap,
      :host(:not([data-theme="light"])) .toast.kind-info .icon-wrap {
        background: rgba(56, 189, 248, 0.18);
        color: #38bdf8;
      }
      :host([data-theme="light"]) .toast.kind-info {
        background: rgba(255, 255, 255, 0.98);
        color: #0c4a6e;
        border: 1px solid rgba(14, 165, 233, 0.3);
        box-shadow: 0 16px 36px rgba(14, 165, 233, 0.15), 0 0 0 1px rgba(0, 0, 0, 0.04);
      }
      :host([data-theme="light"]) .toast.kind-info .icon-wrap {
        background: #f0f9ff;
        color: #0284c7;
      }
    `;
    shadow.append(style);
    document.documentElement.append(toastHost);
  }
  toastHost.setAttribute("data-theme", currentTheme);
  const shadow = toastHost.shadowRoot!;
  const oldToast = shadow.querySelector(".toast");
  if (oldToast) oldToast.remove();
  clearTimeout(toastTimeout);

  const toast = document.createElement("div");
  toast.className = `toast kind-${kind}`;
  toast.setAttribute("role", kind === "error" ? "alert" : "status");

  const iconWrap = document.createElement("div");
  iconWrap.className = "icon-wrap";
  if (kind === "success") {
    iconWrap.innerHTML = `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor"><polyline points="20 6 9 17 4 12"></polyline></svg>`;
  } else if (kind === "warning") {
    iconWrap.innerHTML = `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor"><path d="m21.73 18-8-14a2 2 0 0 0-3.48 0l-8 14A2 2 0 0 0 4 21h16a2 2 0 0 0 1.73-3Z"></path><line x1="12" y1="9" x2="12" y2="13"></line><line x1="12" y1="17" x2="12.01" y2="17"></line></svg>`;
  } else if (kind === "error") {
    iconWrap.innerHTML = `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor"><circle cx="12" cy="12" r="10"></circle><line x1="12" y1="8" x2="12" y2="12"></line><line x1="12" y1="16" x2="12.01" y2="16"></line></svg>`;
  } else {
    iconWrap.innerHTML = `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor"><circle cx="12" cy="12" r="10"></circle><line x1="12" y1="8" x2="12" y2="12"></line><line x1="12" y1="8" x2="12.01" y2="8"></line></svg>`;
  }

  const content = document.createElement("div");
  content.className = "content";
  const titleEl = document.createElement("div");
  titleEl.className = "title";
  titleEl.textContent = message;
  content.append(titleEl);
  if (subtitle) {
    const subtitleEl = document.createElement("div");
    subtitleEl.className = "subtitle";
    subtitleEl.textContent = subtitle;
    content.append(subtitleEl);
  }

  const closeBtn = document.createElement("button");
  closeBtn.className = "close";
  closeBtn.setAttribute("aria-label", "Закрыть");
  closeBtn.textContent = "×";
  const dismiss = () => {
    toast.classList.add("closing");
    setTimeout(() => {
      toast.remove();
      if (!shadow.querySelector(".toast")) {
        toastHost?.remove();
        toastHost = undefined;
      }
    }, 200);
  };
  closeBtn.onclick = dismiss;

  toast.append(iconWrap, content, closeBtn);
  shadow.append(toast);

  toastTimeout = setTimeout(dismiss, kind === "error" ? 6000 : 4000);
}
let last = "";
let lastScanNotified = "";
let panelURL = "";
let host: HTMLDivElement | undefined;
let frame: HTMLIFrameElement | undefined;
let opened = false;
let frameReady = false;
const readyWaiters = new Set<(ready: boolean) => void>();
let pendingExpand = false;
let collapsed = false;
let dismissed = "";
let position = { x: Math.max(8, window.innerWidth - 413), y: 81 };
function place() {
  if (!host) return;
  position.x = Math.max(
    8,
    Math.min(position.x, window.innerWidth - host.offsetWidth - 33),
  );
  position.y = Math.max(
    8,
    Math.min(position.y, window.innerHeight - host.offsetHeight - 8),
  );
  host.style.left = position.x + "px";
  host.style.top = position.y + "px";
}
function showPanel(snapshot: Snapshot) {
  if (!contextAlive()) return;
  if (!opened) {
    frameReady = false;
    host?.remove();
    host = undefined;
    frame = undefined;
    panelURL = "";
    return;
  }
  const url = snapshot.vacancy?.url ?? location.origin + location.pathname;
  if (host) {
    panelURL = url;
    return;
  }
  panelURL = url;
  frameReady = false;
  host = document.createElement("div");
  host.id = "avari-quick-popup";
  const shadow = host.attachShadow({ mode: "open" });
  const style = document.createElement("style");
  style.textContent = `
    :host { all: initial; position: fixed; z-index: 2147483647; width: min(380px, calc(100vw - 16px)); filter: drop-shadow(0 12px 28px rgba(0, 0, 0, 0.3)); }
    :host { border-radius: 20px; overflow: hidden; animation: avari-enter 260ms ease-out both; }
    @keyframes avari-enter { from { opacity: 0; transform: translateY(-8px) scale(.97); } to { opacity: 1; transform: none; } }
    @media (prefers-reduced-motion: reduce) { :host { animation: none; } iframe { transition: none !important; } }
    :host([data-collapsed]) .handle { display: none; }
    :host([data-collapsed]) iframe { border-radius: 20px; border-top: 1px solid #38bdf833; }
    .handle { display: flex; align-items: center; justify-content: space-between; padding: 10px 14px; background: #151f2d; color: #f0f6fc; border: 1px solid #38bdf833; border-bottom: 0; border-radius: 20px 20px 0 0; font: 600 13px system-ui, -apple-system, sans-serif; cursor: move; touch-action: none; letter-spacing: -0.2px; box-shadow: none; }
    :host([data-theme="light"]) { filter: drop-shadow(0 12px 28px rgba(35, 59, 88, 0.16)); }
    :host([data-theme="light"]) .handle { background: #ffffff; color: #1e293b; border-color: #dce4ee; box-shadow: none; }
    :host([data-theme="light"]) iframe { background: #f5f7fb; border-color: #dce4ee; }
    :host([data-theme="light"]) button:hover { background: #eaf3fc; }
    button { background: transparent; color: inherit; border: 0; font-size: 20px; line-height: 1; cursor: pointer; padding: 2px 6px; border-radius: 6px; opacity: 0.8; transition: opacity 0.15s; }
    button:hover { opacity: 1; background: rgba(56, 189, 248, 0.15); }
    iframe { display: block; box-sizing: border-box; width: 100%; height: 300px; transition: height 240ms cubic-bezier(.22, 1, .36, 1); max-height: calc(100vh - 64px); border: 1px solid #38bdf833; border-top: 0; border-radius: 0 0 20px 20px; background: #0e1520; overflow: hidden; }
  `;
  const handle = document.createElement("div");
  handle.className = "handle";
  handle.textContent = "Avari.Jobs · Быстрое сохранение";
  const close = document.createElement("button");
  close.textContent = "×";
  close.setAttribute("aria-label", "Закрыть мини-окно");
  close.onclick = () => {
    opened = false;
    dismissed = last;
    showPanel(snapshot);
  };
  const minimize = document.createElement("button");
  minimize.textContent = "−";
  minimize.setAttribute("aria-label", "Свернуть окно");
  minimize.onclick = () => {
    if (!contextAlive()) return;
    frame?.contentWindow?.postMessage(
      { type: "AVARI_COLLAPSE" },
      chrome.runtime.getURL("/").replace(/\/$/, ""),
    );
  };
  const controls = document.createElement("span");
  controls.append(minimize, close);
  handle.append(controls);
  handle.onpointerdown = (event) => {
    if ((event.target as Element).closest("button")) return;
    const origin = { ...position };
    const x = event.clientX;
    const y = event.clientY;
    handle.setPointerCapture(event.pointerId);
    if (frame) frame.style.pointerEvents = "none";
    handle.onpointermove = (move) => {
      position = {
        x: origin.x + move.clientX - x,
        y: origin.y + move.clientY - y,
      };
      place();
    };
    const stop = () => {
      handle.onpointermove = null;
      if (frame) frame.style.pointerEvents = "";
    };
    handle.onpointerup = stop;
    handle.onpointercancel = stop;
  };
  frame = document.createElement("iframe");
  frame.title = "Avari.Jobs — быстрое сохранение";
  host.toggleAttribute("data-collapsed", collapsed);
  if (collapsed) frame.style.height = "56px";
  frame.src = chrome.runtime.getURL(
    "index.html?embedded=1" + (collapsed ? "&collapsed=1" : ""),
  );
  shadow.append(style, handle, frame);
  document.documentElement.append(host);
  place();
}
window.addEventListener("resize", place);
window.addEventListener("message", (event) => {
  if (!contextAlive()) return;
  if (
    !frame ||
    event.source !== frame.contentWindow ||
    event.origin !== chrome.runtime.getURL("/").replace(/\/$/, "")
  )
    return;
  if (event.data?.type === "AVARI_READY") {
    frameReady = true;
    for (const ready of readyWaiters) ready(true);
  }
  if (
    event.data?.type === "AVARI_THEME" &&
    (event.data.theme === "light" || event.data.theme === "dark")
  ) {
    currentTheme = event.data.theme;
    host?.setAttribute("data-theme", event.data.theme);
    toastHost?.setAttribute("data-theme", event.data.theme);
  }
  if (
    event.data?.type === "AVARI_TOAST" &&
    typeof event.data.message === "string"
  ) {
    showToast(
      event.data.message,
      event.data.kind === "error" ||
        event.data.kind === "warning" ||
        event.data.kind === "info"
        ? event.data.kind
        : "success",
      typeof event.data.subtitle === "string" ? event.data.subtitle : undefined,
    );
  }
  if (event.data?.type === "AVARI_CLOSE") {
    opened = false;
    dismissed = last;
    showPanel(parsePage(document, location.href));
  }
  if (event.data?.type === "AVARI_COLLAPSED") {
    if (pendingExpand && event.data.collapsed) {
      frame.contentWindow?.postMessage({ type: "AVARI_EXPAND" }, event.origin);
      return;
    }
    pendingExpand = false;
    collapsed = !!event.data.collapsed;
    host?.toggleAttribute("data-collapsed", collapsed);
  }
  if (
    event.data?.type === "AVARI_MOVE" &&
    Number.isFinite(event.data.dx) &&
    Number.isFinite(event.data.dy)
  ) {
    position.x += event.data.dx;
    position.y += event.data.dy;
    place();
  }
  if (
    event.data?.type === "AVARI_RESIZE" &&
    Number.isFinite(event.data.height)
  ) {
    // The iframe uses border-box sizing; its borders sit outside the content viewport.
    const frameStyle = getComputedStyle(frame);
    const borderHeight =
      (collapsed ? parseFloat(frameStyle.borderTopWidth) : 0) +
      parseFloat(frameStyle.borderBottomWidth);
    frame.style.height =
      Math.max(
        collapsed ? 54 : 140,
        Math.min(600, Math.ceil(event.data.height) + borderHeight),
      ) + "px";
    place();
  }
});
let timer: ReturnType<typeof setTimeout> | undefined;
function send() {
  if (!contextAlive()) return;
  const snapshot = parsePage(document, location.href);
  showPanel(snapshot);
  const fingerprint = JSON.stringify(snapshot);
  if (fingerprint === last) return;
  last = fingerprint;
  const observedURL = location.href;
  if (!snapshot.supported) {
    frame?.contentWindow?.postMessage(
      { type: "AVARI_PAGE_UPDATED" },
      chrome.runtime.getURL("/").replace(/\/$/, ""),
    );
    return;
  }
  chrome.runtime
    .sendMessage({ type: "PAGE_SNAPSHOT", snapshot })
    .then((reply) => {
      if (!contextAlive()) return;
      if (!reply?.ok) throw new Error("Observation failed");
      if (observedURL === location.href && last === fingerprint) {
        const vacancy = snapshot.vacancy;
        const useful =
          !!(vacancy?.company && vacancy?.position) || reply.data?.created > 0;
        if (useful && !opened && dismissed !== fingerprint) {
          opened = true;
          collapsed = true;
          showPanel(snapshot);
        }

        // Notify user about scan results
        const scanKey = observedURL + ":" + (vacancy?.url || "");
        if (lastScanNotified !== scanKey) {
          lastScanNotified = scanKey;
          if (reply.data?.created > 0) {
            showToast(
              "Обнаружены изменения вакансии",
              "warning",
              reply.data.created === 1
                ? "Найдено 1 предложение для обновления"
                : `Найдено предложений: ${reply.data.created}`,
            );
          } else if (vacancy?.company && vacancy?.position) {
            showToast(
              "Обнаружена вакансия",
              "info",
              `${vacancy.company} · ${vacancy.position}`,
            );
          }
        }

        frame?.contentWindow?.postMessage(
          { type: "AVARI_PAGE_UPDATED" },
          chrome.runtime.getURL("/").replace(/\/$/, ""),
        );
      }
    })
    .catch(() => {
      if (!contextAlive()) return;
      last = "";
      clearTimeout(timer);
      timer = setTimeout(send, 15000);
    });
}
function schedule() {
  if (!contextAlive()) return;
  clearTimeout(timer);
  timer = setTimeout(send, 600);
}
const observer = new MutationObserver(schedule);
observer.observe(document.documentElement, {
  childList: true,
  subtree: true,
  characterData: true,
  attributes: true,
  attributeFilter: [
    "href",
    "data-qa",
    "data-job-id",
    "data-sdui-screen",
    "hidden",
    "aria-hidden",
    "aria-pressed",
    "aria-label",
    "title",
    "class",
    "data-active",
  ],
});
chrome.runtime.onMessage.addListener((message, _sender, reply) => {
  if (message?.type === "OPEN_PANEL") {
    const snapshot = parsePage(document, location.href);
    opened = true;
    pendingExpand = true;
    collapsed = false;
    host?.removeAttribute("data-collapsed");
    frame?.contentWindow?.postMessage(
      { type: "AVARI_EXPAND" },
      chrome.runtime.getURL("/").replace(/\/$/, ""),
    );
    showPanel(snapshot);
    if (frameReady) {
      reply({ opened: true, supported: snapshot.supported });
    } else {
      const done = (ready: boolean) => {
        clearTimeout(timeout);
        readyWaiters.delete(done);
        if (!ready) {
          opened = false;
          showPanel(snapshot);
        }
        reply({ opened: ready, supported: snapshot.supported });
      };
      const timeout = setTimeout(() => done(false), 4000);
      readyWaiters.add(done);
    }
    return true;
  }
  if (message?.type === "READ_PAGE") {
    const snapshot = parsePage(document, location.href);
    reply(snapshot);
    send();
  }
});
window.addEventListener("popstate", schedule);
window.addEventListener("hashchange", schedule);
let lastURL = location.href;
const urlTimer = setInterval(() => {
  if (!contextAlive()) return;
  if (location.href !== lastURL) {
    lastURL = location.href;
    schedule();
  }
}, 1000);
send();

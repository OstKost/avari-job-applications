import { parsePage, type Snapshot } from "./parser";
let stopped = false;
function contextAlive() {
  if (stopped) return false;
  if (chrome.runtime.id) return true;
  stopped = true;
  observer.disconnect();
  clearTimeout(timer);
  clearInterval(urlTimer);
  host?.remove();
  host = undefined;
  frame = undefined;
  return false;
}
let last = "";
let panelURL = "";
let host: HTMLDivElement | undefined;
let frame: HTMLIFrameElement | undefined;
let opened = false;
let collapsed = false;
let dismissed = "";
let position = { x: Math.max(8, window.innerWidth - 356), y: 16 };
function place() {
  if (!host) return;
  position.x = Math.max(
    8,
    Math.min(position.x, window.innerWidth - host.offsetWidth - 8),
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
  if (!snapshot.supported || !opened) {
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
  host = document.createElement("div");
  host.id = "avari-quick-popup";
  const shadow = host.attachShadow({ mode: "open" });
  const style = document.createElement("style");
  style.textContent = `
    :host { all: initial; position: fixed; z-index: 2147483647; width: min(348px, calc(100vw - 16px)); filter: drop-shadow(0 12px 28px rgba(0, 0, 0, 0.3)); }
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
    iframe { display: block; box-sizing: border-box; width: 100%; height: 300px; transition: height 240ms cubic-bezier(.22, 1, .36, 1); max-height: calc(100vh - 64px); border: 1px solid #38bdf833; border-top: 0; border-radius: 0 0 20px 20px; background: #090d12; overflow: hidden; }
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
  if (
    event.data?.type === "AVARI_THEME" &&
    (event.data.theme === "light" || event.data.theme === "dark")
  ) {
    host?.setAttribute("data-theme", event.data.theme);
  }
  if (event.data?.type === "AVARI_CLOSE") {
    opened = false;
    dismissed = last;
    showPanel(parsePage(document, location.href));
  }
  if (event.data?.type === "AVARI_COLLAPSED") {
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
    "class",
  ],
});
chrome.runtime.onMessage.addListener((message, _sender, reply) => {
  if (message?.type === "OPEN_PANEL") {
    const snapshot = parsePage(document, location.href);
    opened = snapshot.supported;
    collapsed = false;
    host?.removeAttribute("data-collapsed");
    frame?.contentWindow?.postMessage(
      { type: "AVARI_EXPAND" },
      chrome.runtime.getURL("/").replace(/\/$/, ""),
    );
    showPanel(snapshot);
    reply({ supported: snapshot.supported });
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

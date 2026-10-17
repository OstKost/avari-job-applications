import {
  type Application,
  type Proposal,
  type User,
  type Session,
  jobIdentity,
  jobSite,
  observationBelongsToPage,
} from "@avari/shared";
import type { Snapshot } from "./parser";
type Config = {
  server?: string;
  storageMode?: "online" | "local";
  serverAddresses?: { online: string; local: string };
  token?: string;
  notifications?: boolean;
  lastNotification?: string;
};
void chrome.storage.local.setAccessLevel({ accessLevel: "TRUSTED_CONTEXTS" });
const inFlight = new Map<string, Promise<unknown>>();
async function config(): Promise<Config> {
  const saved: Config = await chrome.storage.local.get([
    "server",
    "storageMode",
    "serverAddresses",
    "token",
    "notifications",
    "lastNotification",
  ]);
  const defaultServer = import.meta.env.VITE_AVARI_DEFAULT_SERVER;
  if (!saved.server && defaultServer) {
    // Bind credentials to the chosen server, including across future updates.
    await chrome.storage.local.remove(["token", "lastNotification"]);
    await chrome.storage.local.set({ server: defaultServer });
    return {
      ...saved,
      server: defaultServer,
      token: undefined,
      lastNotification: undefined,
    };
  }
  return saved;
}
function cleanPayload(val: unknown): unknown {
  if (!val || typeof val !== "object") return val;
  const clone = { ...(val as Record<string, any>) };
  if (clone.companyLogo === "") delete clone.companyLogo;
  if (
    clone.candidate &&
    typeof clone.candidate === "object" &&
    clone.candidate.companyLogo === ""
  ) {
    clone.candidate = { ...clone.candidate };
    delete clone.candidate.companyLogo;
  }
  return clone;
}
function stripLogo(val: unknown): { payload: unknown; hadLogo: boolean } {
  if (!val || typeof val !== "object") return { payload: val, hadLogo: false };
  let hadLogo = false;
  const clone = { ...(val as Record<string, any>) };
  if ("companyLogo" in clone) {
    delete clone.companyLogo;
    hadLogo = true;
  }
  if (
    clone.candidate &&
    typeof clone.candidate === "object" &&
    "companyLogo" in clone.candidate
  ) {
    clone.candidate = { ...clone.candidate };
    delete clone.candidate.companyLogo;
    hadLogo = true;
  }
  return { payload: clone, hadLogo };
}
async function request(
  path: string,
  method = "GET",
  body?: unknown,
  key?: string,
): Promise<unknown> {
  const c = await config();
  if (!c.server) throw new Error("Укажите адрес сервиса");
  const headers: Record<string, string> = {};
  const preparedBody = cleanPayload(body);
  if (preparedBody !== undefined) headers["Content-Type"] = "application/json";
  if (c.token) headers.Authorization = "Bearer " + c.token;
  if (key) headers["Idempotency-Key"] = key;
  const response = await fetch(c.server + "/api/v1" + path, {
    method,
    headers,
    credentials: "omit",
    body: preparedBody === undefined ? undefined : JSON.stringify(preparedBody),
  }).catch(() => {
    const local = ["localhost", "127.0.0.1"].includes(
      new URL(c.server!).hostname,
    );
    throw new Error(
      local
        ? "Нет соединения с локальным Avari.Jobs. Запустите приложение через его иконку и повторите."
        : "Нет соединения с сервером. Проверьте адрес и повторите.",
    );
  });
  const data = await response.json().catch(() => {
    throw new Error("Некорректный ответ сервера. Проверьте адрес сервиса.");
  });
  if (!response.ok) {
    if (response.status === 401) {
      await chrome.storage.local.remove("token");
      await chrome.action.setBadgeText({ text: "" });
    }
    if (
      response.status === 400 &&
      data.error === "Некорректный JSON запроса" &&
      preparedBody !== undefined
    ) {
      const { payload: fallbackBody, hadLogo } = stripLogo(preparedBody);
      if (hadLogo) {
        return await request(path, method, fallbackBody, key);
      }
    }
    const error = new Error(data.error ?? "Ошибка сервера") as Error & {
      status: number;
      current: unknown;
    };
    error.status = response.status;
    error.current = data.current;
    throw error;
  }
  return data;
}
async function updateBadge() {
  const c = await config();
  if (!c.token) return;
  try {
    const proposals = (await request("/proposals")) as Proposal[];
    const pending = proposals.filter((p) => p.status === "pending");
    await chrome.action.setBadgeBackgroundColor({ color: "#416fec" });
    await chrome.action.setBadgeText({
      text: pending.length ? String(pending.length) : "",
    });
    return pending;
  } catch {
    return [];
  }
}
async function observe(snapshot: Snapshot, tabId?: number) {
  const key = String(tabId);
  const previous = inFlight.get(key) ?? Promise.resolve();
  const work = previous
    .catch(() => {})
    .then(() => processObservation(snapshot));
  inFlight.set(key, work);
  try {
    return await work;
  } finally {
    if (inFlight.get(key) === work) inFlight.delete(key);
  }
}
async function processObservation(snapshot: Snapshot) {
  const c = await config();
  if (!c.token || !snapshot.supported) return;
  try {
    const apps = (await request("/applications")) as Application[];
    const known = new Set(
      apps.map((a) => jobIdentity(a.url)?.url).filter(Boolean),
    );
    let newest = "";
    let created = 0;
    for (const o of snapshot.observations.slice(0, 200)) {
      const vacancyUrl =
        o.vacancyUrl ?? (o.hhId ? "https://hh.ru/vacancy/" + o.hhId : "");
      if (!known.has(vacancyUrl) && !o.candidate) continue;
      const result = (await request("/observations", "POST", o)) as {
        proposal?: Proposal;
      };
      if (result.proposal) {
        newest = result.proposal.observationId;
        created++;
      }
    }
    const pending = await updateBadge();
    if (
      created &&
      c.notifications &&
      newest !== c.lastNotification &&
      (await chrome.permissions.contains({ permissions: ["notifications"] }))
    ) {
      await chrome.notifications.create("avari-proposals", {
        type: "basic",
        iconUrl: "icon.png",
        title: "Avari.Jobs",
        message:
          created === 1
            ? "Найдено новое предложение для журнала откликов"
            : `Найдено ${created} предложения обновления`,
      });
      await chrome.storage.local.set({ lastNotification: newest });
    }
    return { pending, created };
  } catch (error) {
    throw error;
  }
}
chrome.runtime.onMessage.addListener((message, sender, reply) => {
  const fromPopup =
    sender.id === chrome.runtime.id &&
    ["index.html", "action.html"].some(
      (page) => sender.url?.split("?")[0] === chrome.runtime.getURL(page),
    );
  const fromJobSite = !!sender.tab && !!sender.url && !!jobSite(sender.url);
  const run = async () => {
    if (message?.type === "PAGE_SNAPSHOT" && fromJobSite) {
      const snapshot = message.snapshot as Snapshot;
      if (
        snapshot &&
        Array.isArray(snapshot.observations) &&
        snapshot.observations.length <= 200
      ) {
        const valid = snapshot.observations.every((o) =>
          observationBelongsToPage(o, sender.url!),
        );
        if (!valid)
          throw new Error("Наблюдение не соответствует открытой странице");
        return { ok: true, data: await observe(snapshot, sender.tab?.id) };
      }
      return { ok: true };
    }
    if (!fromPopup) throw new Error("Недопустимый источник");
    switch (message?.type) {
      case "CONFIG":
        return await config();
      case "SAVE_SERVER": {
        const u = new URL(message.server);
        if (
          u.protocol !== "https:" &&
          !(
            u.protocol === "http:" &&
            ["localhost", "127.0.0.1", "[::1]"].includes(u.hostname)
          )
        )
          throw new Error(
            "Используйте HTTPS; HTTP доступен только на localhost",
          );
        if (
          u.username ||
          u.password ||
          u.pathname !== "/" ||
          u.search ||
          u.hash
        )
          throw new Error(
            "Укажите только адрес сервиса, например https://avari.example.com",
          );
        const previous = await config();
        if (previous.server !== u.origin) {
          if (previous.token) {
            try {
              await request("/auth/logout", "POST", {});
            } catch {}
          }
          await chrome.storage.local.remove(["token", "lastNotification"]);
        }
        await chrome.storage.local.set({
          server: u.origin,
          storageMode: message.storageMode,
          serverAddresses: message.serverAddresses,
        });
        return { ok: true };
      }
      case "API": {
        if (
          typeof message.path !== "string" ||
          !/^\/(?:auth\/(?:login|logout)|me|applications(?:\/[a-f0-9]+)?|tasks(?:\/[a-f0-9]+)?|notes(?:\/[a-f0-9]+)?|fields|proposals(?:\/[a-f0-9]+)?|observations)$/.test(
            message.path,
          )
        )
          throw new Error("Неподдерживаемый запрос");
        const result = await request(
          message.path,
          message.method,
          message.body,
          message.key,
        );
        if (message.path === "/auth/login") {
          const login = result as {
            token: string;
            user: User;
            session: Session;
          };
          await chrome.storage.local.set({ token: login.token });
          await updateBadge();
          return { user: login.user, session: login.session };
        }
        if (message.path === "/auth/logout") {
          await chrome.storage.local.remove("token");
          await chrome.action.setBadgeText({ text: "" });
        }
        if (message.path.startsWith("/proposals") && message.method === "POST")
          await updateBadge();
        return result;
      }
      case "OPEN_PANEL": {
        const [tab] = await chrome.tabs.query({
          active: true,
          currentWindow: true,
        });
        if (!tab?.id) throw new Error("Не найдена открытая вкладка");
        try {
          let result;
          try {
            result = await chrome.tabs.sendMessage(tab.id, {
              type: "OPEN_PANEL",
            });
          } catch {
            await chrome.scripting.executeScript({
              target: { tabId: tab.id },
              files: ["content.js"],
            });
            result = await chrome.tabs.sendMessage(tab.id, {
              type: "OPEN_PANEL",
            });
          }
          if (!result?.opened) throw new Error("Панель не открылась");
          return result;
        } catch {
          await chrome.windows.create({
            url: chrome.runtime.getURL("index.html?tabId=" + tab.id),
            type: "popup",
            width: 420,
            height: 720,
          });
          return { opened: true };
        }
      }
      case "READ_ACTIVE": {
        // Chrome can omit tab.url without the tabs permission; READ_PAGE is handled by our script.
        const requestedId = message.tabId;
        const embedded = new URL(sender.url!).searchParams.has("embedded");
        const tab =
          (embedded ? sender.tab : undefined) ??
          (Number.isInteger(requestedId) && requestedId > 0
            ? await chrome.tabs.get(requestedId).catch(() => undefined)
            : (
                await chrome.tabs.query({ active: true, currentWindow: true })
              )[0]);
        if (!tab?.id)
          return { supported: false, kind: "unsupported", observations: [] };
        try {
          const snapshot = (await chrome.tabs.sendMessage(tab.id, {
            type: "READ_PAGE",
          })) as Snapshot;
          await observe(snapshot, tab.id);
          return snapshot;
        } catch {
          return { supported: false, kind: "unsupported", observations: [] };
        }
      }
      case "NOTIFICATIONS":
        await chrome.storage.local.set({ notifications: !!message.enabled });
        return { ok: true };
      default:
        throw new Error("Неизвестное действие");
    }
  };
  run()
    .then((data) => reply({ ok: true, data }))
    .catch((e) =>
      reply({
        ok: false,
        error: e.message,
        status: e.status,
        current: e.current,
      }),
    );
  return true;
});
let notificationListenerAdded = false;
function registerNotifications() {
  if (chrome.notifications && !notificationListenerAdded) {
    notificationListenerAdded = true;
    chrome.notifications.onClicked.addListener(async () => {
      const c = await config();
      if (c.server) await chrome.tabs.create({ url: c.server + "/proposals" });
    });
  }
}
registerNotifications();
chrome.permissions.onAdded.addListener(registerNotifications);
chrome.runtime.onInstalled.addListener(() => {
  void chrome.storage.local.setAccessLevel({ accessLevel: "TRUSTED_CONTEXTS" });
});

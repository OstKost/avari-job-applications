import { precacheAndRoute, cleanupOutdatedCaches, matchPrecache } from "workbox-precaching";
import { registerRoute, NavigationRoute } from "workbox-routing";

interface ServiceWorkerClient {
  url: string;
  focus(): Promise<ServiceWorkerClient>;
  navigate(url: string): Promise<ServiceWorkerClient | null>;
}

interface CustomSWGlobal {
  __WB_MANIFEST: Array<{ url: string; revision: string | null }>;
  location: { origin: string; href: string };
  registration: {
    showNotification(title: string, options?: Record<string, unknown>): Promise<void>;
  };
  clients: {
    matchAll(options?: { type?: string; includeUncontrolled?: boolean }): Promise<ServiceWorkerClient[]>;
    openWindow?(url: string): Promise<ServiceWorkerClient | null>;
  };
  skipWaiting(): Promise<void>;
  addEventListener(type: string, listener: (event: any) => void): void;
}

declare const self: unknown;

const sw = self as unknown as CustomSWGlobal;

// Clean old caches and precache assets injected by vite-plugin-pwa
cleanupOutdatedCaches();
precacheAndRoute((self as any).__WB_MANIFEST || []);

// Navigation fallback ONLY for app HTML routes; strictly exclude /api, /downloads, /resumes, and assets with extensions
const navigationRoute = new NavigationRoute(async (params) => {
  return (await matchPrecache("index.html")) || fetch(params.request);
}, {
  denylist: [
    /^\/api\//,
    /^\/downloads\//,
    /^\/resumes\//,
    /[^/?]+\.[^/]+$/,
  ],
});
registerRoute(navigationRoute);

// Listen for message events (e.g. SKIP_WAITING triggered by user confirmation)
sw.addEventListener("message", (event: { data?: { type?: string } }) => {
  if (event.data && event.data.type === "SKIP_WAITING") {
    sw.skipWaiting();
  }
});

// Push notification payload structure:
// Versioned aggregate-only payload: { version: 1, title: string, body: string, url: string, tag?: string }
export interface PushPayload {
  version: 1;
  title: string;
  body: string;
  url: string;
  tag?: string;
}

const MAX_STRING_LENGTH = 1000;

function sanitizeString(val: unknown, maxLen = MAX_STRING_LENGTH): string | null {
  if (typeof val !== "string") return null;
  const trimmed = val.trim();
  if (trimmed.length > maxLen) {
    return trimmed.slice(0, maxLen);
  }
  return trimmed;
}

sw.addEventListener("push", (event: { data?: { json(): unknown; text(): string }; waitUntil(p: Promise<unknown>): void }) => {
  let title = "Avari.Jobs";
  let body = "Новое уведомление в журнале вакансий";
  let url = "/";
  let tag = "avari-jobs-notification";

  if (event.data) {
    let isValid = false;
    try {
      const parsed = event.data.json();
      if (
        parsed &&
        typeof parsed === "object" &&
        !Array.isArray(parsed) &&
        (parsed as any).version === 1
      ) {
        const obj = parsed as Record<string, unknown>;
        const sanitizedTitle = sanitizeString(obj.title);
        const sanitizedBody = sanitizeString(obj.body);
        const sanitizedUrl = sanitizeString(obj.url);
        const sanitizedTag = sanitizeString(obj.tag);

        if (sanitizedTitle && sanitizedUrl) {
          // Validate same-origin URL
          try {
            const parsedUrl = new URL(sanitizedUrl, sw.location.origin);
            if (parsedUrl.origin === sw.location.origin) {
              title = sanitizedTitle;
              body = sanitizedBody || "";
              url = parsedUrl.pathname + parsedUrl.search + parsedUrl.hash;
              if (sanitizedTag) tag = sanitizedTag;
              isValid = true;
            }
          } catch {
            // invalid URL
          }
        }
      }
    } catch {
      // JSON parse error or primitive
    }

    if (!isValid) {
      // Malformed payload: safe generic notification, do NOT output raw untrusted text
      title = "Avari.Jobs";
      body = "Обновление статуса отклика или задачи";
      url = "/";
      tag = "avari-jobs-generic";
    }
  }

  const options = {
    body,
    icon: "/brand/icon-192.png",
    badge: "/brand/icon-192.png",
    tag,
    data: {
      url,
    },
  };

  event.waitUntil(sw.registration.showNotification(title, options));
});

sw.addEventListener("notificationclick", (event: { notification: { close(): void; data?: { url?: string } }; waitUntil(p: Promise<unknown>): void }) => {
  event.notification.close();

  const rawUrl = event.notification.data?.url || "/";
  // Validate same-origin click targets
  let targetUrl: URL;
  try {
    targetUrl = new URL(rawUrl, sw.location.origin);
  } catch {
    targetUrl = new URL("/", sw.location.origin);
  }

  // Enforce same-origin navigation target
  if (targetUrl.origin !== sw.location.origin) {
    targetUrl = new URL("/", sw.location.origin);
  }

  const targetHref = targetUrl.href;

  event.waitUntil(
    sw.clients.matchAll({ type: "window", includeUncontrolled: true }).then((clientList: ServiceWorkerClient[]) => {
      // Look for an existing client window with the exact matching URL to focus
      for (const client of clientList) {
        if ("focus" in client && client.url === targetHref) {
          return client.focus();
        }
      }
      // Never navigate an existing client to prevent discarding unsaved drafts/forms.
      // Open a separate target window instead.
      if (sw.clients.openWindow) {
        return sw.clients.openWindow(targetHref);
      }
    })
  );
});

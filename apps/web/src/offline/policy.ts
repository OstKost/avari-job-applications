import { APIError, createAPI, type Transport, type User } from "@avari/shared";
import { initOrActivateSession } from "./db";

export function isNetworkError(error: unknown): boolean {
  return error instanceof APIError && error.status === 0;
}

let verified = false;
let revision = 0;
const listeners = new Set<() => void>();
export function isOfflineOrReadOnly(): boolean {
  return !verified || (typeof navigator !== "undefined" && !navigator.onLine);
}
export function subscribeTransportPolicy(listener: () => void): () => void {
  listeners.add(listener);
  return () => { listeners.delete(listener); };
}
export function requireLiveVerification(): void {
  verified = false;
  revision++;
  listeners.forEach((listener) => listener());
}
export function assertServerMutationAllowed(): void {
  if (isOfflineOrReadOnly()) {
    throw new Error("Сервер недоступен или сессия ещё проверяется. Изменения можно оставить в локальном черновике; отправка пока недоступна.");
  }
}
if (typeof window !== "undefined") {
  window.addEventListener("offline", requireLiveVerification);
  window.addEventListener("online", requireLiveVerification);
}

// Web-only policy: shared transports (including the extension) retain their behavior.
export function createWebAPI(transport: Transport = createAPI()): Transport {
  return async <T,>(path: string, method = "GET", body?: unknown, key?: string, options?: { signal?: AbortSignal }): Promise<T> => {
    const telegramLoginFlow = /^\/auth\/telegram\/requests(?:\/[^/]+(?:\/complete)?)?$/.test(path);
    const publicFlow = telegramLoginFlow || ["/auth/login", "/auth/register", "/auth/recovery", "/auth/logout", "/local/setup"].includes(path);
    if (!["GET", "HEAD"].includes(method.toUpperCase()) && !publicFlow) assertServerMutationAllowed();
    if (path === "/auth/logout") requireLiveVerification();
    const startedAt = revision;
    try {
      const result = await transport<T>(path, method, body, key, options);
      if (path === "/me" || path === "/auth/login" || (telegramLoginFlow && path.endsWith("/complete"))) {
        if (startedAt !== revision) throw new Error("Сессия изменилась во время проверки. Повторите вход.");
        const user = path === "/me" ? result as User : (result as { user: User }).user;
        await initOrActivateSession(user.id, () => startedAt === revision);
        if (startedAt !== revision) throw new Error("Сессия изменилась во время проверки. Повторите вход.");
        verified = true;
        listeners.forEach((listener) => listener());
      }
      return result;
    } catch (error) {
      if (isNetworkError(error)) requireLiveVerification();
      if (error instanceof APIError && [401, 403].includes(error.status) && !publicFlow) {
        requireLiveVerification();
        // Shared API already emits for 401 except /me. The app purges storage on this event.
        if (typeof window !== "undefined" && (error.status === 403 || path === "/me")) {
          window.dispatchEvent(new Event("avari-session-expired"));
        }
      }
      throw error;
    }
  };
}

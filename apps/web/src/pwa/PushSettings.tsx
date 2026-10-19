import React, { useEffect, useState, useCallback, useRef } from "react";
import type { Transport } from "@avari/shared";
import "./push-settings.css";
import { isNetworkError } from "../offline/policy";

export interface PushSettingsProps {
  userId: string;
  api: Transport;
}

export interface PushConfigResponse {
  enabled: boolean;
  publicKey: string;
  subscribed?: boolean;
}

export interface PushSubscribePayload {
  endpoint: string;
  keys: {
    auth: string;
    p256dh: string;
  };
}

export interface PushUnsubscribePayload {
  endpoint: string;
}

export interface PushTestResponse {
  queued: boolean;
}

/**
 * Converts a Base64 URL string to a Uint8Array required for PushManager applicationServerKey.
 */
export function urlBase64ToUint8Array(base64String: string): Uint8Array {
  const padding = "=".repeat((4 - (base64String.length % 4)) % 4);
  const base64 = (base64String + padding).replace(/-/g, "+").replace(/_/g, "/");

  const rawData = window.atob(base64);
  const outputArray = new Uint8Array(rawData.length);

  for (let i = 0; i < rawData.length; ++i) {
    outputArray[i] = rawData.charCodeAt(i);
  }
  return outputArray;
}

/**
 * Compares an existing subscription's applicationServerKey against the target VAPID public key.
 */
export function isSameApplicationServerKey(
  subscription: PushSubscription,
  publicKey: string,
): boolean {
  if (!subscription.options?.applicationServerKey) {
    return false;
  }
  try {
    const existingKey = new Uint8Array(
      subscription.options.applicationServerKey,
    );
    const targetKey = urlBase64ToUint8Array(publicKey);
    if (existingKey.byteLength !== targetKey.byteLength) {
      return false;
    }
    for (let i = 0; i < existingKey.byteLength; i++) {
      if (existingKey[i] !== targetKey[i]) {
        return false;
      }
    }
    return true;
  } catch {
    return false;
  }
}

/**
 * Best-effort helper for logout cleanup.
 * Removes local push subscription and server registration, closes active notifications,
 * without blocking logout indefinitely.
 */
export async function disableDevicePushOnLogout(api: Transport, options: { notifyServer?: boolean } = {}): Promise<void> {
  const timeoutPromise = new Promise<void>((resolve) =>
    setTimeout(resolve, 2500),
  );

  const cleanupPromise = (async () => {
    try {
      if (typeof navigator === "undefined" || !("serviceWorker" in navigator)) {
        return;
      }
      const reg = await navigator.serviceWorker.getRegistration();
      if (!reg) return;

      // Close open notifications if method exists
      if (typeof reg.getNotifications === "function") {
        try {
          const notifications = await reg.getNotifications();
          for (const n of notifications) {
            n.close();
          }
        } catch {
          // ignore
        }
      }

      if (reg.pushManager) {
        const sub = await reg.pushManager.getSubscription();
        if (sub) {
          const endpoint = sub.endpoint;
          // Unsubscribe from browser push manager
          try {
            await sub.unsubscribe();
          } catch {
            // ignore
          }
          // Best effort inform server
          if (endpoint && options.notifyServer !== false) {
            try {
              await api<{ ok: boolean }>("/push/unsubscribe", "POST", {
                endpoint,
              });
            } catch {
              // ignore network / server errors during logout
            }
          }
        }
      }
    } catch {
      // Best effort ignore
    }
  })();

  await Promise.race([cleanupPromise, timeoutPromise]);
}

export function PushSettings({ userId, api }: PushSettingsProps) {
  const [loadingConfig, setLoadingConfig] = useState(true);
  const [config, setConfig] = useState<PushConfigResponse | null>(null);
  const [configError, setConfigError] = useState<string | null>(null);

  const [localSub, setLocalSub] = useState<PushSubscription | null>(null);
  const [permissionState, setPermissionState] =
    useState<NotificationPermission>(() => {
      return typeof Notification !== "undefined"
        ? Notification.permission
        : "default";
    });

  const [actionLoading, setActionLoading] = useState(false);
  const actionInFlight = useRef(false);
  const [actionMessage, setActionMessage] = useState<string | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);

  // Cached ref of current registration
  const regRef = useRef<ServiceWorkerRegistration | null>(null);

  // Readiness / capabilities detection
  const isSecure =
    typeof window !== "undefined" && (window.isSecureContext ?? true);
  const hasSW =
    typeof navigator !== "undefined" && "serviceWorker" in navigator;
  const hasPush = typeof window !== "undefined" && "PushManager" in window;
  const hasNotification =
    typeof window !== "undefined" && "Notification" in window;

  const isIOS =
    typeof navigator !== "undefined" &&
    (/iPad|iPhone|iPod/.test(navigator.userAgent || "") ||
      (navigator.platform === "MacIntel" &&
        (navigator.maxTouchPoints || 0) > 1));

  const isStandalone =
    typeof window !== "undefined" &&
    ((window.matchMedia &&
      window.matchMedia("(display-mode: standalone)").matches) ||
      (navigator as unknown as { standalone?: boolean })?.standalone === true);

  const isSupported = isSecure && hasSW && hasPush && hasNotification;

  // Retrieve service worker registration with bounded timeout (no hanging UI)
  const getBoundedRegistration =
    useCallback(async (): Promise<ServiceWorkerRegistration | null> => {
      if (!hasSW) return null;
      if (regRef.current) return regRef.current;

      try {
        const getRegPromise = navigator.serviceWorker.getRegistration();
        const readyPromise = navigator.serviceWorker.ready;

        // Timeout after 1.5s so we don't hang if service worker is not active
        const timeout = new Promise<null>((resolve) =>
          setTimeout(() => resolve(null), 1500),
        );

        const reg = await Promise.race([getRegPromise, timeout]);
        if (reg) {
          regRef.current = reg;
          return reg;
        }

        // Try ready with timeout
        const readyReg = await Promise.race([readyPromise, timeout]);
        if (readyReg) {
          regRef.current = readyReg;
          return readyReg;
        }
      } catch {
        // SW not available or blocked
      }
      return null;
    }, [hasSW]);

  // Synchronize local subscription and permission state
  const syncLocalState = useCallback(async () => {
    if (typeof Notification !== "undefined") {
      setPermissionState(Notification.permission);
    }
    const reg = await getBoundedRegistration();
    if (reg && reg.pushManager) {
      try {
        const sub = await reg.pushManager.getSubscription();
        setLocalSub(sub);
      } catch {
        setLocalSub(null);
      }
    } else {
      setLocalSub(null);
    }
  }, [getBoundedRegistration]);

  // Fetch config from server
  const fetchConfig = useCallback(async () => {
    setLoadingConfig(true);
    setConfigError(null);
    try {
      const res = await api<PushConfigResponse>("/push/config", "GET");
      setConfig(res);
      await syncLocalState();
    } catch (err: unknown) {
      const apiErr = err as { status?: number; message?: string };
      if (apiErr?.status === 503) {
        setConfigError("Уведомления временно отключены на сервере.");
      } else if (isNetworkError(err)) {
        setConfigError("Нет подключения к сети. Проверьте интернет.");
      } else {
        setConfigError("Не удалось загрузить настройки уведомлений.");
      }
    } finally {
      setLoadingConfig(false);
    }
  }, [api, syncLocalState]);

  // Initial fetch and focus / online listeners
  useEffect(() => {
    fetchConfig();

    const handleFocus = () => {
      fetchConfig();
    };

    const handleOnline = () => {
      fetchConfig();
    };

    window.addEventListener("focus", handleFocus);
    window.addEventListener("online", handleOnline);

    return () => {
      window.removeEventListener("focus", handleFocus);
      window.removeEventListener("online", handleOnline);
    };
  }, [fetchConfig, userId]);

  // Device enabled requires:
  // 1. local PushSubscription exists
  // 2. server current-session subscribed is true (config.subscribed === true)
  const isServerSubscribed = Boolean(config?.subscribed);
  const isDeviceEnabled = Boolean(localSub) && isServerSubscribed;

  // Turn on push notifications (MUST be invoked from explicit direct user click gesture)
  const handleEnable = async () => {
    setActionError(null);
    setActionMessage(null);

    if (!isSupported) {
      setActionError("Push-уведомления не поддерживаются в этом браузере.");
      return;
    }

    if (!config?.enabled || !config.publicKey) {
      setActionError("Уведомления отключены на стороне сервера.");
      return;
    }

    if (actionInFlight.current) return;
    actionInFlight.current = true;
    setActionLoading(true);
    let newlyCreatedSub: PushSubscription | null = null;
    try {
      // Keep the browser permission call in the direct click gesture, before any await.
      let permissionResult: NotificationPermission = "default";
      try {
        // Direct call to Notification.requestPermission()
        const req = Notification.requestPermission();
        if (req && typeof req.then === "function") {
          permissionResult = await req;
        } else {
          permissionResult = Notification.permission;
        }
      } catch (err) {
        permissionResult = Notification.permission;
      }

      setPermissionState(permissionResult);

      if (permissionResult !== "granted") {
        if (permissionResult === "denied") {
          setActionError(
            "Разрешение на уведомления заблокировано в браузере. Разрешите их в настройках сайта.",
          );
        } else {
          setActionError(
            "Разрешение на отправку уведомлений не было предоставлено.",
          );
        }
        return;
      }

      const reg = await getBoundedRegistration();
      if (!reg || !reg.pushManager) {
        throw new Error(
          "Приложение ещё не готово к уведомлениям. Обновите страницу и повторите.",
        );
      }

      let sub = await reg.pushManager.getSubscription();

      // Check if existing sub has the same applicationServerKey
      if (sub && !isSameApplicationServerKey(sub, config.publicKey)) {
        // Different VAPID key: unsubscribe previous
        try {
          await sub.unsubscribe();
        } catch {
          // ignore
        }
        sub = null;
      }

      // If no valid subscription exists, create one
      if (!sub) {
        const appServerKey = urlBase64ToUint8Array(config.publicKey);
        sub = await reg.pushManager.subscribe({
          userVisibleOnly: true,
          applicationServerKey: appServerKey as unknown as BufferSource,
        });
        newlyCreatedSub = sub;
      }

      // Send to server
      const json = sub.toJSON();
      const endpoint = sub.endpoint;
      const auth = json.keys?.auth;
      const p256dh = json.keys?.p256dh;

      if (!endpoint || !auth || !p256dh) {
        throw new Error(
          "Не удалось настроить уведомления в браузере. Повторите попытку.",
        );
      }

      await api<{ ok: boolean }>("/push/subscribe", "POST", {
        endpoint,
        keys: { auth, p256dh },
      });

      setLocalSub(sub);
      setConfig((prev) => (prev ? { ...prev, subscribed: true } : prev));
      setActionMessage("Уведомления успешно включены на этом устройстве.");
    } catch (err: unknown) {
      // Rollback newly created subscription on server or client error
      if (newlyCreatedSub) {
        try {
          await newlyCreatedSub.unsubscribe();
        } catch {
          // ignore rollback errors
        }
      }
      const apiErr = err as { status?: number; message?: string };
      if (apiErr?.status === 503) {
        setActionError("Сервер временно не принимает подписки.");
      } else {
        setActionError(
          apiErr?.message || "Не удалось активировать уведомления на сервере.",
        );
      }
      await syncLocalState();
    } finally {
      actionInFlight.current = false;
      setActionLoading(false);
    }
  };

  // Turn off push notifications
  const handleDisable = async () => {
    if (actionInFlight.current) return;
    actionInFlight.current = true;
    setActionError(null);
    setActionMessage(null);
    setActionLoading(true);

    try {
      let endpointToUnsubscribe: string | null = localSub?.endpoint || null;

      if (!endpointToUnsubscribe) {
        const reg = await getBoundedRegistration();
        if (reg?.pushManager) {
          const sub = await reg.pushManager.getSubscription();
          if (sub) {
            endpointToUnsubscribe = sub.endpoint;
            try {
              await sub.unsubscribe();
            } catch {
              // ignore
            }
          }
        }
      } else {
        try {
          await localSub?.unsubscribe();
        } catch {
          // ignore
        }
      }

      if (endpointToUnsubscribe) {
        await api<{ ok: boolean }>("/push/unsubscribe", "POST", {
          endpoint: endpointToUnsubscribe,
        });
      }

      setLocalSub(null);
      setConfig((prev) => (prev ? { ...prev, subscribed: false } : prev));
      setActionMessage("Уведомления отключены для этого устройства.");
    } catch (err: unknown) {
      const apiErr = err as { status?: number; message?: string };
      setActionError(
        apiErr?.message || "Ошибка при отключении уведомлений на сервере.",
      );
    } finally {
      await syncLocalState();
      actionInFlight.current = false;
      setActionLoading(false);
    }
  };

  // Test push notification
  const handleTest = async () => {
    if (actionInFlight.current) return;
    actionInFlight.current = true;
    setActionError(null);
    setActionMessage(null);
    setActionLoading(true);

    try {
      const endpoint = localSub?.endpoint;
      if (!endpoint) {
        throw new Error("Активная подписка на устройстве не найдена.");
      }

      const res = await api<PushTestResponse>("/push/test", "POST", {
        endpoint,
      });
      if (res?.queued) {
        setActionMessage(
          "Тестовое уведомление поставлено в очередь на отправку.",
        );
      } else {
        setActionMessage("Запрос отправлен.");
      }
    } catch (err: unknown) {
      const apiErr = err as { status?: number; message?: string };
      if (apiErr?.status === 404) {
        setActionError(
          "Устройство не зарегистрировано на сервере. Включите уведомления повторно.",
        );
      } else if (apiErr?.status === 503) {
        setActionError("Служба уведомлений недоступна на сервере.");
      } else {
        setActionError(
          apiErr?.message || "Не удалось отправить тестовое уведомление.",
        );
      }
    } finally {
      actionInFlight.current = false;
      setActionLoading(false);
    }
  };

  return (
    <div className="push-settings-card" data-testid="push-settings-card">
      <div className="push-header">
        <div className="push-title-wrap">
          <h3>Push-уведомления</h3>
          {config?.enabled === false ? (
            <span className="push-badge push-badge-disabled">
              Отключено сервером
            </span>
          ) : isDeviceEnabled ? (
            <span className="push-badge push-badge-active">Активны</span>
          ) : (
            <span className="push-badge push-badge-inactive">Не активны</span>
          )}
        </div>
      </div>

      <p className="push-desc">
        Получайте план на день в 09:00 и итог поиска работы в 18:00 по будням, в
        часовом поясе аккаунта. Уведомления включаются отдельно на каждом
        устройстве.
      </p>

      {/* iOS guidance */}
      {isIOS && !isStandalone && (
        <div
          className="push-notice push-notice-warning"
          data-testid="ios-guidance"
        >
          Для работы уведомлений на iOS добавьте приложение на главный экран:
          нажмите кнопку «Поделиться» в Safari и выберите «На экран „Домой“».
        </div>
      )}

      {/* Unsupported browser */}
      {!isSupported && (
        <div
          className="push-notice push-notice-error"
          data-testid="unsupported-notice"
        >
          Push-уведомления не поддерживаются в этом браузере или требуется
          безопасное соединение (HTTPS).
        </div>
      )}

      {/* Permission denied */}
      {permissionState === "denied" && (
        <div
          className="push-notice push-notice-error"
          data-testid="permission-denied-notice"
        >
          Уведомления заблокированы в настройках браузера. Чтобы включить их,
          разрешите доступ в настройках сайта.
        </div>
      )}

      {/* Another account or server mismatch: localSub exists but server subscribed is false */}
      {localSub && !isServerSubscribed && (
        <div
          className="push-notice push-notice-info"
          data-testid="account-rebind-notice"
        >
          В этом браузере настроены уведомления для другого профиля или
          требуется повторная привязка к текущему аккаунту.
        </div>
      )}

      {/* Config loading or general error */}
      {configError && (
        <div
          className="push-notice push-notice-error"
          data-testid="config-error-notice"
        >
          {configError}
        </div>
      )}

      {/* Action feedback */}
      {actionMessage && (
        <div
          className="push-notice push-notice-info"
          data-testid="action-message"
        >
          {actionMessage}
        </div>
      )}
      {actionError && (
        <div
          className="push-notice push-notice-error"
          data-testid="action-error"
        >
          {actionError}
        </div>
      )}

      {/* Controls */}
      <div className="push-actions">
        {loadingConfig ? (
          <span style={{ fontSize: 13, color: "var(--muted)" }}>
            Загрузка настроек...
          </span>
        ) : isDeviceEnabled ? (
          <>
            <button
              type="button"
              className="push-btn push-btn-outline"
              onClick={handleTest}
              disabled={actionLoading}
              data-testid="test-push-btn"
            >
              {actionLoading ? "Отправка..." : "Проверить"}
            </button>
            <button
              type="button"
              className="push-btn push-btn-danger"
              onClick={handleDisable}
              disabled={actionLoading}
              data-testid="disable-push-btn"
            >
              {actionLoading ? "Отключение..." : "Отключить"}
            </button>
          </>
        ) : (
          <button
            type="button"
            className="push-btn push-btn-primary"
            onClick={handleEnable}
            disabled={
              actionLoading ||
              config?.enabled === false ||
              !isSupported ||
              permissionState === "denied"
            }
            data-testid="enable-push-btn"
          >
            {actionLoading
              ? "Включение..."
              : localSub
                ? "Привязать к этому аккаунту"
                : "Включить уведомления"}
          </button>
        )}
      </div>
    </div>
  );
}
export default PushSettings;

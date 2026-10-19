import { beforeEach, afterEach, describe, expect, it, vi } from "vitest";
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import {
  PushSettings,
  disableDevicePushOnLogout,
  urlBase64ToUint8Array,
  isSameApplicationServerKey,
  type PushConfigResponse,
} from "./PushSettings";
import type { Transport } from "@avari/shared";

(
  globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }
).IS_REACT_ACT_ENVIRONMENT = true;

const SAMPLE_PUBLIC_KEY =
  "BC6K8q8E_3U2r7b0R3-QW2t9Z3P6b1y2a4C8e0G2i4k6m8o0q2s4u6w8y0A2C4E6G8I0K2M4O6Q8S0U2W4Y6";

function createMockPushSubscription(
  endpoint = "https://push.example.com/sub/123",
  keyStr = SAMPLE_PUBLIC_KEY,
) {
  const keyBytes = urlBase64ToUint8Array(keyStr);
  const sub = {
    endpoint,
    options: {
      applicationServerKey: keyBytes.buffer,
      userVisibleOnly: true,
    },
    getKey: vi.fn((name: string) => {
      if (name === "auth") return new Uint8Array([1, 2, 3, 4]).buffer;
      if (name === "p256dh") return new Uint8Array([5, 6, 7, 8]).buffer;
      return null;
    }),
    toJSON: vi.fn(() => ({
      endpoint,
      keys: {
        auth: "AQIDBA",
        p256dh: "BQYHCA",
      },
    })),
    unsubscribe: vi.fn(async () => true),
  };
  return sub as unknown as PushSubscription;
}

describe("PushSettings", () => {
  let root: Root;
  let container: HTMLDivElement;
  let mockApi: ReturnType<typeof vi.fn>;
  let mockPushManager: {
    getSubscription: ReturnType<typeof vi.fn>;
    subscribe: ReturnType<typeof vi.fn>;
  };
  let mockRegistration: {
    pushManager: typeof mockPushManager;
    getNotifications?: ReturnType<typeof vi.fn>;
  };

  beforeEach(() => {
    container = document.createElement("div");
    document.body.appendChild(container);
    root = createRoot(container);

    mockApi = vi.fn();

    // Default mock PushManager
    mockPushManager = {
      getSubscription: vi.fn(async () => null),
      subscribe: vi.fn(async () => createMockPushSubscription()),
    };

    mockRegistration = {
      pushManager: mockPushManager,
      getNotifications: vi.fn(async () => []),
    };

    // Navigator mocks
    Object.defineProperty(navigator, "serviceWorker", {
      value: {
        getRegistration: vi.fn(
          async () => mockRegistration as unknown as ServiceWorkerRegistration,
        ),
        ready: Promise.resolve(
          mockRegistration as unknown as ServiceWorkerRegistration,
        ),
      },
      writable: true,
      configurable: true,
    });

    // Window mocks
    (window as unknown as { isSecureContext: boolean }).isSecureContext = true;
    (window as unknown as { PushManager: unknown }).PushManager =
      function () {};

    // Notification mock
    let permission: NotificationPermission = "default";
    const mockNotification = {
      get permission() {
        return permission;
      },
      set permission(val: NotificationPermission) {
        permission = val;
      },
      requestPermission: vi.fn(async () => {
        permission = "granted";
        return "granted";
      }),
    };
    (
      window as unknown as { Notification: typeof mockNotification }
    ).Notification = mockNotification;
  });

  afterEach(() => {
    act(() => {
      root.unmount();
    });
    container.remove();
    vi.clearAllMocks();
  });

  it("does NOT request permission on initial mount", async () => {
    mockApi.mockImplementation(async (path: string) => {
      if (path === "/push/config") {
        return {
          enabled: true,
          publicKey: SAMPLE_PUBLIC_KEY,
          subscribed: false,
        };
      }
      return {};
    });

    await act(async () => {
      root.render(
        createElement(PushSettings, {
          userId: "user-1",
          api: mockApi as unknown as Transport,
        }),
      );
    });

    expect(window.Notification.requestPermission).not.toHaveBeenCalled();
    expect(mockPushManager.subscribe).not.toHaveBeenCalled();
    expect(container.textContent).toContain("Push-уведомления");
    expect(container.textContent).toContain("Не активны");
  });

  it("executes explicit user click gesture before subscription and sends correct payload", async () => {
    mockApi.mockImplementation(
      async (path: string, method?: string, body?: unknown) => {
        if (path === "/push/config") {
          return {
            enabled: true,
            publicKey: SAMPLE_PUBLIC_KEY,
            subscribed: false,
          };
        }
        if (path === "/push/subscribe" && method === "POST") {
          return { ok: true };
        }
        return {};
      },
    );

    await act(async () => {
      root.render(
        createElement(PushSettings, {
          userId: "user-1",
          api: mockApi as unknown as Transport,
        }),
      );
    });

    const enableBtn = container.querySelector<HTMLButtonElement>(
      '[data-testid="enable-push-btn"]',
    );
    expect(enableBtn).toBeTruthy();
    expect(enableBtn?.textContent).toContain("Включить уведомления");

    await act(async () => {
      enableBtn?.click();
    });

    // Permission was requested upon gesture
    expect(window.Notification.requestPermission).toHaveBeenCalledTimes(1);

    // PushManager subscribe called with userVisibleOnly: true and uint8array
    expect(mockPushManager.subscribe).toHaveBeenCalledTimes(1);
    const subscribeArgs = mockPushManager.subscribe.mock.calls[0][0];
    expect(subscribeArgs.userVisibleOnly).toBe(true);
    expect(subscribeArgs.applicationServerKey).toBeInstanceOf(Uint8Array);

    // /push/subscribe called with endpoint and auth/p256dh keys
    expect(mockApi).toHaveBeenCalledWith(
      "/push/subscribe",
      "POST",
      expect.objectContaining({
        endpoint: "https://push.example.com/sub/123",
        keys: {
          auth: "AQIDBA",
          p256dh: "BQYHCA",
        },
      }),
    );

    // Active state shown in Russian
    expect(container.textContent).toContain("Активны");
    expect(container.textContent).toContain(
      "Уведомления успешно включены на этом устройстве",
    );
  });

  it("allows only one enable operation while the browser permission prompt is pending", async () => {
    let resolvePermission!: (value: NotificationPermission) => void;
    const pendingPermission = new Promise<NotificationPermission>((resolve) => {
      resolvePermission = resolve;
    });
    vi.mocked(Notification.requestPermission).mockReturnValue(
      pendingPermission,
    );
    mockApi.mockResolvedValue({
      enabled: true,
      publicKey: SAMPLE_PUBLIC_KEY,
      subscribed: false,
    });
    await act(async () => {
      root.render(
        createElement(PushSettings, {
          userId: "prompt-user",
          api: mockApi as unknown as Transport,
        }),
      );
    });
    const button = container.querySelector<HTMLButtonElement>(
      '[data-testid="enable-push-btn"]',
    )!;
    await act(async () => {
      button.click();
      button.click();
    });
    expect(Notification.requestPermission).toHaveBeenCalledTimes(1);
    expect(button.disabled).toBe(true);
    expect(mockPushManager.subscribe).not.toHaveBeenCalled();
    await act(async () => {
      resolvePermission("default");
      await pendingPermission;
    });
    expect(button.disabled).toBe(false);
    expect(mockPushManager.subscribe).not.toHaveBeenCalled();
  });

  it("does not call API subscribe when permission is denied and presents clear Russian notice", async () => {
    (
      window.Notification.requestPermission as unknown as ReturnType<
        typeof vi.fn
      >
    ).mockImplementation(async () => "denied");
    mockApi.mockImplementation(async (path: string) => {
      if (path === "/push/config") {
        return {
          enabled: true,
          publicKey: SAMPLE_PUBLIC_KEY,
          subscribed: false,
        };
      }
      return {};
    });

    await act(async () => {
      root.render(
        createElement(PushSettings, {
          userId: "user-1",
          api: mockApi as unknown as Transport,
        }),
      );
    });

    const enableBtn = container.querySelector<HTMLButtonElement>(
      '[data-testid="enable-push-btn"]',
    );
    await act(async () => {
      enableBtn?.click();
    });

    expect(window.Notification.requestPermission).toHaveBeenCalled();
    expect(mockPushManager.subscribe).not.toHaveBeenCalled();
    expect(mockApi).not.toHaveBeenCalledWith(
      "/push/subscribe",
      expect.anything(),
      expect.anything(),
    );
    expect(container.textContent).toContain(
      "Уведомления заблокированы в настройках браузера",
    );
  });

  it("rolls back newly created local subscription if server subscribe fails", async () => {
    const mockCreatedSub = createMockPushSubscription(
      "https://push.example.com/rollback",
    );
    mockPushManager.subscribe.mockResolvedValueOnce(mockCreatedSub);

    mockApi.mockImplementation(async (path: string, method?: string) => {
      if (path === "/push/config") {
        return {
          enabled: true,
          publicKey: SAMPLE_PUBLIC_KEY,
          subscribed: false,
        };
      }
      if (path === "/push/subscribe" && method === "POST") {
        const error = new Error("503 Service Unavailable");
        (error as unknown as { status: number }).status = 503;
        throw error;
      }
      return {};
    });

    await act(async () => {
      root.render(
        createElement(PushSettings, {
          userId: "user-1",
          api: mockApi as unknown as Transport,
        }),
      );
    });

    const enableBtn = container.querySelector<HTMLButtonElement>(
      '[data-testid="enable-push-btn"]',
    );
    await act(async () => {
      enableBtn?.click();
    });

    // Unsubscribe was triggered on rollback
    expect(mockCreatedSub.unsubscribe).toHaveBeenCalledTimes(1);
    expect(container.textContent).toContain(
      "Сервер временно не принимает подписки",
    );
    expect(container.textContent).toContain("Не активны");
  });

  it("shows rebind notice when another user or local subscription exists with server subscribed=false", async () => {
    // Browser already has a subscription
    const existingSub = createMockPushSubscription(
      "https://push.example.com/other-user",
    );
    mockPushManager.getSubscription.mockResolvedValue(existingSub);

    // Server config has subscribed: false
    mockApi.mockImplementation(async (path: string) => {
      if (path === "/push/config") {
        return {
          enabled: true,
          publicKey: SAMPLE_PUBLIC_KEY,
          subscribed: false,
        };
      }
      return {};
    });

    await act(async () => {
      root.render(
        createElement(PushSettings, {
          userId: "user-2",
          api: mockApi as unknown as Transport,
        }),
      );
    });

    // Device should NOT be considered enabled without server consent
    expect(container.textContent).toContain("Не активны");
    expect(
      container.querySelector('[data-testid="account-rebind-notice"]')
        ?.textContent,
    ).toContain(
      "настроены уведомления для другого профиля или требуется повторная привязка",
    );

    const rebindBtn = container.querySelector<HTMLButtonElement>(
      '[data-testid="enable-push-btn"]',
    );
    expect(rebindBtn?.textContent).toContain("Привязать к этому аккаунту");

    // Do NOT auto-register without user click
    expect(mockApi).not.toHaveBeenCalledWith(
      "/push/subscribe",
      expect.anything(),
      expect.anything(),
    );
  });

  it("sends test push message and displays queued text", async () => {
    const existingSub = createMockPushSubscription(
      "https://push.example.com/my-endpoint",
    );
    mockPushManager.getSubscription.mockResolvedValue(existingSub);

    mockApi.mockImplementation(
      async (path: string, method?: string, body?: unknown) => {
        if (path === "/push/config") {
          return {
            enabled: true,
            publicKey: SAMPLE_PUBLIC_KEY,
            subscribed: true,
          };
        }
        if (path === "/push/test" && method === "POST") {
          return { queued: true };
        }
        return {};
      },
    );

    await act(async () => {
      root.render(
        createElement(PushSettings, {
          userId: "user-1",
          api: mockApi as unknown as Transport,
        }),
      );
    });

    expect(container.textContent).toContain("Активны");
    const testBtn = container.querySelector<HTMLButtonElement>(
      '[data-testid="test-push-btn"]',
    );
    expect(testBtn).toBeTruthy();

    await act(async () => {
      testBtn?.click();
    });

    expect(mockApi).toHaveBeenCalledWith("/push/test", "POST", {
      endpoint: "https://push.example.com/my-endpoint",
    });
    expect(container.textContent).toContain("поставлено в очередь на отправку");
    expect(container.textContent).not.toContain("доставлено");
  });

  it("disables push notifications and scopes endpoint to server", async () => {
    const existingSub = createMockPushSubscription(
      "https://push.example.com/to-disable",
    );
    mockPushManager.getSubscription.mockResolvedValue(existingSub);

    mockApi.mockImplementation(async (path: string, method?: string) => {
      if (path === "/push/config") {
        return {
          enabled: true,
          publicKey: SAMPLE_PUBLIC_KEY,
          subscribed: true,
        };
      }
      if (path === "/push/unsubscribe" && method === "POST") {
        return { ok: true };
      }
      return {};
    });

    await act(async () => {
      root.render(
        createElement(PushSettings, {
          userId: "user-1",
          api: mockApi as unknown as Transport,
        }),
      );
    });

    const disableBtn = container.querySelector<HTMLButtonElement>(
      '[data-testid="disable-push-btn"]',
    );
    expect(disableBtn).toBeTruthy();

    await act(async () => {
      disableBtn?.click();
    });

    expect(existingSub.unsubscribe).toHaveBeenCalledTimes(1);
    expect(mockApi).toHaveBeenCalledWith("/push/unsubscribe", "POST", {
      endpoint: "https://push.example.com/to-disable",
    });
    expect(container.textContent).toContain(
      "Уведомления отключены для этого устройства",
    );
  });

  it("disableDevicePushOnLogout helper performs best-effort unsubscribe, server removal, and closes notifications", async () => {
    const existingSub = createMockPushSubscription(
      "https://push.example.com/logout-sub",
    );
    const mockClose = vi.fn();
    mockPushManager.getSubscription.mockResolvedValue(existingSub);
    mockRegistration.getNotifications = vi.fn(async () => [
      { close: mockClose } as unknown as Notification,
    ]);

    mockApi.mockResolvedValue({ ok: true });

    await disableDevicePushOnLogout(mockApi as unknown as Transport);

    expect(mockClose).toHaveBeenCalledTimes(1);
    expect(existingSub.unsubscribe).toHaveBeenCalledTimes(1);
    expect(mockApi).toHaveBeenCalledWith("/push/unsubscribe", "POST", {
      endpoint: "https://push.example.com/logout-sub",
    });
  });
  it("session expiry cleanup removes local push without another authenticated API call", async () => {
    const sub = createMockPushSubscription();
    mockPushManager.getSubscription.mockResolvedValue(sub);
    await disableDevicePushOnLogout(mockApi as unknown as Transport, { notifyServer: false });
    expect(sub.unsubscribe).toHaveBeenCalledTimes(1);
    expect(mockApi).not.toHaveBeenCalled();
  });

});

import { useState, useEffect, useRef, useCallback } from "react";
import { detectPwaCapabilities, type PwaCapabilities } from "./capabilities";
import { TabCoordinator } from "./tab-coordinator";

// BeforeInstallPromptEvent type declaration
export interface BeforeInstallPromptEvent extends Event {
  readonly platforms: string[];
  readonly userChoice: Promise<{
    outcome: "accepted" | "dismissed";
    platform: string;
  }>;
  prompt(): Promise<void>;
}

export interface UsePwaOptions {
  /**
   * Optional async callback to flush dirty drafts before a service worker update triggers reload.
   * If it returns false or throws, reload will be prevented/delayed.
   */
  onFlushDirtyDrafts?: () => Promise<boolean | void> | boolean | void;
  /**
   * Optional reload implementation (defaults to window.location.reload).
   * Useful for test verification and graceful reloads.
   */
  reloadFn?: () => void;
}

export interface UsePwaReturn {
  capabilities: PwaCapabilities;
  isInstallable: boolean;
  isInstalled: boolean;
  needRefresh: boolean;
  isUpdating: boolean;
  otherTabsDirty: boolean;
  promptInstall: () => Promise<boolean>;
  updateServiceWorker: () => Promise<boolean>;
  dismissUpdate: () => void;
  tabCoordinator: TabCoordinator;
}

export function usePwa(options: UsePwaOptions = {}): UsePwaReturn {
  const [capabilities] = useState<PwaCapabilities>(() => detectPwaCapabilities());
  const [installPrompt, setInstallPrompt] = useState<BeforeInstallPromptEvent | null>(null);
  const [isInstalled, setIsInstalled] = useState<boolean>(() => capabilities.isStandalone);
  const [needRefresh, setNeedRefresh] = useState(false);
  const [isUpdating, setIsUpdating] = useState(false);
  const [otherTabsDirty, setOtherTabsDirty] = useState(false);

  const registrationRef = useRef<ServiceWorkerRegistration | null>(null);
  const [tabCoordinator] = useState<TabCoordinator>(() => new TabCoordinator());
  const optionsRef = useRef(options);
  optionsRef.current = options;

  // StrictMode compatible TabCoordinator lifecycle & dirty draft registration
  useEffect(() => {
    if (options.onFlushDirtyDrafts) {
      tabCoordinator.registerDirtyDraftCheck(async () => {
        try {
          const res = await optionsRef.current.onFlushDirtyDrafts?.();
          return res === false; // If flush says not ready/dirty
        } catch {
          // Fail-closed
          return true;
        }
      });
    }

    return () => {
      tabCoordinator.unregisterDirtyDraftCheck();
    };
  }, [tabCoordinator, options.onFlushDirtyDrafts]);

  // Clean up TabCoordinator on ultimate unmount
  useEffect(() => {
    return () => {
      tabCoordinator.destroy();
    };
  }, [tabCoordinator]);

  // Listen for beforeinstallprompt and appinstalled events
  useEffect(() => {
    const handleBeforeInstallPrompt = (e: Event) => {
      e.preventDefault();
      setInstallPrompt(e as BeforeInstallPromptEvent);
    };

    const handleAppInstalled = () => {
      setInstallPrompt(null);
      setIsInstalled(true);
    };

    window.addEventListener("beforeinstallprompt", handleBeforeInstallPrompt);
    window.addEventListener("appinstalled", handleAppInstalled);

    return () => {
      window.removeEventListener("beforeinstallprompt", handleBeforeInstallPrompt);
      window.removeEventListener("appinstalled", handleAppInstalled);
    };
  }, []);

  // Register production Service Worker with manual update prompt
  useEffect(() => {
    // Ordinary dev mode does not run production SW
    if (import.meta.env.DEV) {
      return;
    }

    if (!("serviceWorker" in navigator)) {
      return;
    }

    navigator.serviceWorker
      .register("/sw.js", { scope: "/" })
      .then((reg) => {
        registrationRef.current = reg;

        // Check if an updated worker is already waiting
        if (reg.waiting) {
          setNeedRefresh(true);
        }

        reg.addEventListener("updatefound", () => {
          const newWorker = reg.installing;
          if (!newWorker) return;

          newWorker.addEventListener("statechange", () => {
            if (newWorker.state === "installed" && navigator.serviceWorker.controller) {
              // New update available, prompt user explicitly!
              setNeedRefresh(true);
            }
          });
        });
      })
      .catch((err) => {
        console.warn("[PWA] Service Worker registration failed:", err);
      });
  }, []);

  // Trigger browser install prompt
  const promptInstall = useCallback(async (): Promise<boolean> => {
    if (!installPrompt) {
      return false;
    }
    try {
      await installPrompt.prompt();
      const choice = await installPrompt.userChoice;
      if (choice.outcome === "accepted") {
        setInstallPrompt(null);
        return true;
      }
      return false;
    } catch (err) {
      console.warn("[PWA] promptInstall error:", err);
      return false;
    }
  }, [installPrompt]);

  // Explicit user update activation in requesting tab only
  const updateServiceWorker = useCallback(async (): Promise<boolean> => {
    setIsUpdating(true);
    try {
      // 1. Check if other tabs have dirty drafts
      const othersDirty = await tabCoordinator.checkOtherTabsDirtyDrafts();
      if (othersDirty) {
        setOtherTabsDirty(true);
        setIsUpdating(false);
        return false;
      }

      // 2. Flush dirty drafts in current tab if handler provided
      if (optionsRef.current.onFlushDirtyDrafts) {
        try {
          const result = await optionsRef.current.onFlushDirtyDrafts();
          if (result === false) {
            setIsUpdating(false);
            return false;
          }
        } catch {
          // Fail-closed on flush error
          setIsUpdating(false);
          return false;
        }
      }

      // 3. Notify other tabs that update is confirmed (without forcing them to reload)
      tabCoordinator.notifyUpdateConfirmed();

      // 4. Send SKIP_WAITING to waiting service worker and await confirmed activation in requesting tab
      const reg = registrationRef.current;
      const waitingWorker = reg?.waiting;
      if (waitingWorker) {
        let hasReloaded = false;
        const doReload = () => {
          if (!hasReloaded) {
            hasReloaded = true;
            if (optionsRef.current.reloadFn) {
              optionsRef.current.reloadFn();
            } else {
              window.location.reload();
            }
          }
        };

        // Reload ONLY when confirmed activation occurs
        const onStateChange = () => {
          if (waitingWorker.state === "activated") {
            try {
              if (typeof waitingWorker.removeEventListener === "function") {
                waitingWorker.removeEventListener("statechange", onStateChange);
              }
            } catch {}
            doReload();
          }
        };
        waitingWorker.addEventListener("statechange", onStateChange);

        // Immediate check in case the worker already activated
        if (waitingWorker.state === "activated") {
          doReload();
        }

        // Also listen for controllerchange if clients.claim() is used
        if ("serviceWorker" in navigator) {
          navigator.serviceWorker.addEventListener("controllerchange", doReload, { once: true });
        }

        waitingWorker.postMessage({ type: "SKIP_WAITING" });
        return true;
      }

      setIsUpdating(false);
      return false;
    } catch (err) {
      console.error("[PWA] Update service worker error:", err);
      setIsUpdating(false);
      return false;
    }
  }, [tabCoordinator]);

  const dismissUpdate = useCallback(() => {
    setNeedRefresh(false);
    setOtherTabsDirty(false);
  }, []);

  return {
    capabilities,
    isInstallable: !!installPrompt || (capabilities.isIOS && !isInstalled),
    isInstalled,
    needRefresh,
    isUpdating,
    otherTabsDirty,
    promptInstall,
    updateServiceWorker,
    dismissUpdate,
    tabCoordinator,
  };
}

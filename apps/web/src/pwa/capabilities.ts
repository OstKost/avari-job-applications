export interface PwaCapabilities {
  isStandalone: boolean;
  isInstallable: boolean;
  isIOS: boolean;
  isSafari: boolean;
  supportsServiceWorker: boolean;
  supportsPush: boolean;
  supportsShareTarget: boolean;
}

export function detectPwaCapabilities(): PwaCapabilities {
  if (typeof window === "undefined" || typeof navigator === "undefined") {
    return {
      isStandalone: false,
      isInstallable: false,
      isIOS: false,
      isSafari: false,
      supportsServiceWorker: false,
      supportsPush: false,
      supportsShareTarget: false,
    };
  }

  // Standalone detection
  const isStandalone = Boolean(
    (typeof window.matchMedia === "function" &&
      window.matchMedia("(display-mode: standalone)").matches) ||
      // iOS Safari standalone flag
      (navigator as unknown as { standalone?: boolean }).standalone === true ||
      (typeof document !== "undefined" &&
        document.referrer &&
        document.referrer.includes("android-app://"))
  );

  const ua = navigator.userAgent || "";
  // iOS detection (including iPadOS on desktop Safari mode)
  const isIOS =
    /iPad|iPhone|iPod/.test(ua) ||
    (navigator.platform === "MacIntel" && navigator.maxTouchPoints > 1);

  // Safari detection (not Chrome or Firefox on iOS)
  const isSafari =
    isIOS &&
    /WebKit/.test(ua) &&
    !/CriOS|FxiOS|OPiOS|EdgiOS|mercury/i.test(ua);

  const supportsServiceWorker = "serviceWorker" in navigator;
  const supportsPush = "PushManager" in window;
  const supportsShareTarget = true; // Manifest share target supported via OS/browser

  return {
    isStandalone,
    isInstallable: !isStandalone,
    isIOS,
    isSafari,
    supportsServiceWorker,
    supportsPush,
    supportsShareTarget,
  };
}

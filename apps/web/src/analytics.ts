export function initGoogleAnalytics(measurementId?: string) {
  const id = measurementId || import.meta.env.VITE_GA_MEASUREMENT_ID;
  if (!id || typeof window === "undefined") {
    return;
  }

  // Prevent duplicate script injection
  if (document.querySelector(`script[src*="googletagmanager.com/gtag/js"]`)) {
    return;
  }

  window.dataLayer = window.dataLayer || [];
  window.gtag = function () {
    window.dataLayer.push(arguments);
  };

  window.gtag("js", new Date());
  // Disable automatic pageview to handle it via React Router
  window.gtag("config", id, {
    send_page_view: false,
    allow_google_signals: false,
    allow_ad_personalization_signals: false,
  });

  const script = document.createElement("script");
  script.async = true;
  script.src = `https://www.googletagmanager.com/gtag/js?id=${encodeURIComponent(id)}`;
  document.head.appendChild(script);
}

export function trackPageView(path: string, title?: string) {
  if (typeof window === "undefined" || typeof window.gtag !== "function") {
    return;
  }
  const id = import.meta.env.VITE_GA_MEASUREMENT_ID;
  if (!id) return;

  const safePath = path.startsWith("/applications/")
    ? "/applications/detail"
    : path;
  window.gtag("event", "page_view", {
    send_to: id,
    page_path: safePath,
    page_title: title || document.title,
    page_location: window.location.origin + safePath,
  });
}

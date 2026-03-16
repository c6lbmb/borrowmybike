// src/lib/analytics.ts
declare global {
  interface Window {
    dataLayer?: unknown[];
    gtag?: (...args: any[]) => void;
  }
}

type EventParams = Record<string, string | number | boolean | null | undefined>;

export function trackEvent(name: string, params: EventParams = {}) {
  if (typeof window === "undefined") return;
  if (typeof window.gtag !== "function") return;

  window.gtag("event", name, params);
}

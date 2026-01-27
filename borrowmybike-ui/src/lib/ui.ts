// src/lib/ui.ts
export function isSmallScreen() {
  return typeof window !== "undefined" && window.matchMedia && window.matchMedia("(max-width: 640px)").matches;
}

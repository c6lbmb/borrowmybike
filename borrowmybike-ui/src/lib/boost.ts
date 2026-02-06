// src/lib/boost.ts
// Backward-compatible helpers for boosted listings.
// Accepts ISO strings OR epoch milliseconds.

export function getBoostUntil(bike: any): string | number | null {
  if (!bike) return null;
  // Support both common column names
  return bike.boosted_until ?? bike.boost_until ?? null;
}

export function isBikeBoosted(until: string | number | null | undefined): boolean {
  if (!until) return false;

  let t: number;

  if (typeof until === "number") {
    t = until;
  } else {
    const d = new Date(until);
    if (isNaN(d.getTime())) return false;
    t = d.getTime();
  }

  return t > Date.now();
}

export function boostedLabel(until: string | number | null | undefined): string | null {
  if (!until) return null;

  const d = typeof until === "number" ? new Date(until) : new Date(until);
  if (isNaN(d.getTime())) return null;

  return d.toLocaleString();
}

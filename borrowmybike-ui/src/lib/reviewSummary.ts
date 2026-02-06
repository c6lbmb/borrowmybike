// src/lib/reviewSummary.ts
import { sb } from "./supabase";

/**
 * We don't assume exact reviewA / schema yet.
 * We'll try common column names and fail gracefully.
 *
 * Goal: show ratings in Browse + Bike Detail without breaking if schema differs.
 */

export type BikeRatingSummary = {
  bike_id: string;
  avg_bike_rating: number;   // 0..5
  review_count: number;
};

function safeNum(v: any, fallback = 0) {
  const n = Number(v);
  return Number.isFinite(n) ? n : fallback;
}

export async function fetchBikeRatingSummaries(bikeIds: string[]) {
  const unique = Array.from(new Set(bikeIds)).filter(Boolean);
  if (!unique.length) return new Map<string, BikeRatingSummary>();

  // Try: reviews has bike_id + bike_rating (or rating) numeric
  // We'll pull raw rows (limited) and compute client-side for now.
  // Later we can replace with a view/RPC for performance.
  const res = await sb
    .from("reviews")
    .select("bike_id,bike_rating,rating,created_at")
    .in("bike_id", unique)
    .limit(500);

  if (res.error || !res.data) {
    // Fail gracefully: no ratings
    return new Map<string, BikeRatingSummary>();
  }

  const sums = new Map<string, { sum: number; count: number }>();

  for (const row of res.data as any[]) {
    const bike_id = String(row.bike_id || "");
    if (!bike_id) continue;

    const r = row.bike_rating ?? row.rating; // support either column name
    const val = safeNum(r, 0);
    if (val <= 0) continue;

    const cur = sums.get(bike_id) || { sum: 0, count: 0 };
    cur.sum += val;
    cur.count += 1;
    sums.set(bike_id, cur);
  }

  const out = new Map<string, BikeRatingSummary>();
  for (const [bike_id, v] of sums.entries()) {
    out.set(bike_id, {
      bike_id,
      avg_bike_rating: v.count ? v.sum / v.count : 0,
      review_count: v.count,
    });
  }

  return out;
}

export function formatStars(avg: number) {
  // returns "★★★★☆" style string
  const clamped = Math.max(0, Math.min(5, avg));
  const full = Math.floor(clamped);
  const half = clamped - full >= 0.5 ? 1 : 0;
  const empty = 5 - full - half;

  return "★".repeat(full) + (half ? "⯪" : "") + "☆".repeat(empty);
}

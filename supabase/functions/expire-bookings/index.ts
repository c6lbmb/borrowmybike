import { serve } from "https://deno.land/std@0.192.0/http/server.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type, x-admin-key",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

function json(status: number, body: unknown) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json", ...corsHeaders },
  });
}

function acceptanceHoursFor(args: {
  createdAtIso?: string | null;
  scheduledIso?: string | null;
}) {
  // Mirrors UI logic:
  // default 8h
  // <24h to test -> 2h
  // 24-72h -> 4h
  const scheduledIso = args.scheduledIso ?? null;
  if (!scheduledIso) return 8;

  const scheduled = new Date(scheduledIso);
  if (isNaN(scheduled.getTime())) return 8;

  const msUntil = scheduled.getTime() - Date.now();
  const hoursUntil = msUntil / (1000 * 60 * 60);

  if (hoursUntil < 24) return 2;
  if (hoursUntil < 72) return 4;
  return 8;
}

function acceptanceDeadlineMs(args: {
  createdAtIso?: string | null;
  scheduledIso?: string | null;
}) {
  const created = args.createdAtIso ? new Date(args.createdAtIso) : null;
  if (!created || isNaN(created.getTime())) return null;
  const hours = acceptanceHoursFor(args);
  return created.getTime() + hours * 60 * 60 * 1000;
}

async function callCancelBooking(opts: {
  supabaseUrl: string;
  serviceRoleKey: string;
  bookingId: string;
}) {
  const { supabaseUrl, serviceRoleKey, bookingId } = opts;

  const res = await fetch(`${supabaseUrl}/functions/v1/cancel-booking`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      // service role key works as a bearer token for edge functions
      Authorization: `Bearer ${serviceRoleKey}`,
      apikey: serviceRoleKey,
    },
    body: JSON.stringify({ booking_id: bookingId, cancelled_by: "system_expired" }),
  });

  let payload: any = null;
  try {
    payload = await res.json();
  } catch {
    // ignore
  }

  return { ok: res.ok, status: res.status, payload };
}

serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  if (req.method !== "POST") return json(405, { error: "Method not allowed" });

  const version = "expire-bookings/v1";
const ADMIN_KEY = Deno.env.get("SETTLE_ADMIN_KEY") ?? "";
if (!ADMIN_KEY) {
  return json(500, { error: "Missing env SETTLE_ADMIN_KEY", version });
}

const incoming = req.headers.get("x-admin-key") ?? req.headers.get("X-Admin-Key") ?? "";
if (!incoming) {
  return json(401, { error: "Missing x-admin-key header", version });
}
if (incoming !== ADMIN_KEY) {
  return json(401, { error: "Invalid admin key", version });
}

  const SUPABASE_URL = Deno.env.get("MY_SUPABASE_URL") ?? Deno.env.get("SUPABASE_URL") ?? "";
  const SERVICE_ROLE_KEY =
    Deno.env.get("MY_SUPABASE_SERVICE_ROLE_KEY") ??
    Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ??
    "";

  if (!SUPABASE_URL || !SERVICE_ROLE_KEY) {
    return json(500, { error: "Missing env MY_SUPABASE_URL or MY_SUPABASE_SERVICE_ROLE_KEY", version });
  }

  const { createClient } = await import("https://esm.sh/@supabase/supabase-js@2?target=deno");
  const supabase = createClient(SUPABASE_URL, SERVICE_ROLE_KEY);

  // Allow optional request body: { limit?: number }
  let limit = 50;
  try {
    const body = await req.json().catch(() => null);
    if (body?.limit && Number.isFinite(body.limit)) limit = Math.min(200, Math.max(1, body.limit));
  } catch {
    // ignore
  }

  // Candidates: borrower paid, owner not paid, not cancelled.
  // We keep the filter broad and compute expiry ourselves.
  const { data: bookings, error } = await supabase
    .from("bookings")
    .select("id, created_at, scheduled_start_at, booking_date, cancelled, owner_deposit_paid, borrower_paid")
    .eq("cancelled", false)
    .eq("borrower_paid", true)
    .eq("owner_deposit_paid", false)
    .order("created_at", { ascending: true })
    .limit(limit);

  if (error) return json(500, { error: "Failed to query bookings", details: error, version });

  const now = Date.now();
  const candidates = (bookings ?? []).map((b: any) => {
    const scheduledIso = b.scheduled_start_at ?? b.booking_date ?? null;
    const createdAtIso = b.created_at ?? null;
    const deadline = acceptanceDeadlineMs({ createdAtIso, scheduledIso });
    const expired = deadline !== null ? now > deadline : false;
    const hours = acceptanceHoursFor({ createdAtIso, scheduledIso });
    return { ...b, scheduledIso, deadlineMs: deadline, expired, hours };
  });

  const expired = candidates.filter((c: any) => c.expired);

  const results: Array<any> = [];
  let expiredProcessed = 0;
  let expiredSucceeded = 0;

  for (const b of expired) {
    expiredProcessed++;
    const r = await callCancelBooking({
      supabaseUrl: SUPABASE_URL,
      serviceRoleKey: SERVICE_ROLE_KEY,
      bookingId: b.id,
    });

    if (r.ok) expiredSucceeded++;
    results.push({
      booking_id: b.id,
      acceptance_hours: b.hours,
      deadlineMs: b.deadlineMs,
      call_ok: r.ok,
      http_status: r.status,
      payload: r.payload,
    });
  }

  return json(200, {
    ok: true,
    version,
    now,
    scanned: candidates.length,
    expired_found: expired.length,
    expiredProcessed,
    expiredSucceeded,
    sample: results.slice(0, 10),
  });
});

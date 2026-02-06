import { serve } from "https://deno.land/std@0.177.0/http/server.ts";
import { createClient } from "https://cdn.jsdelivr.net/npm/@supabase/supabase-js/+esm";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

const supabaseUrl = Deno.env.get("MY_SUPABASE_URL")!;
const serviceRoleKey = Deno.env.get("MY_SUPABASE_SERVICE_ROLE_KEY")!;
if (!supabaseUrl) throw new Error("Missing MY_SUPABASE_URL secret");
if (!serviceRoleKey) throw new Error("Missing MY_SUPABASE_SERVICE_ROLE_KEY secret");

const supabase = createClient(supabaseUrl, serviceRoleKey);

function toMs(iso: string | null): number {
  if (!iso) return NaN;
  const t = Date.parse(iso);
  return Number.isFinite(t) ? t : NaN;
}

/**
 * Check-in window rules:
 * - Opens 15 minutes before scheduled start
 * - Closes 60 minutes after scheduled start
 */
function checkInWindow(startIso: string, durationMinutes: number) {
  const start = toMs(startIso);
  const durMs = (Number(durationMinutes || 30) * 60 * 1000);
  const end = start + durMs;

  const open = start - (15 * 60 * 1000);
  const close = start + (60 * 60 * 1000);

  return { start, end, open, close };
}

function json(status: number, body: unknown) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}

function normalizeActor(raw: unknown): "borrower" | "owner" | null {
  const a = String(raw ?? "").toLowerCase().trim();
  if (a === "borrower") return "borrower";
  if (a === "owner") return "owner";
  if (a === "mentor") return "owner"; // ✅ mentor is alias for owner
  return null;
}

serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  if (req.method !== "POST") return json(405, { error: "Only POST is allowed" });

  let body: any;
  try {
    body = await req.json();
  } catch {
    return json(400, { error: "Invalid JSON body" });
  }

  const booking_id = body?.booking_id;
  if (!booking_id) return json(400, { error: "booking_id is required" });

  const normalizedActor = normalizeActor(body?.actor ?? body?.role);
  if (!normalizedActor) {
    return json(400, {
      error: "actor must be 'borrower' or 'owner' (mentor accepted as alias)",
      received: body?.actor ?? body?.role ?? null,
    });
  }

  const { data: booking, error: bookingErr } = await supabase
    .from("bookings")
    .select([
      "id",
      "booking_date",
      "scheduled_start_at",
      "duration_minutes",
      "cancelled",
      "completed",
      "borrower_paid",
      "owner_deposit_paid",
      "borrower_checked_in",
      "borrower_checked_in_at",
      "owner_checked_in",
      "owner_checked_in_at",
    ].join(","))
    .eq("id", booking_id)
    .single();

  if (bookingErr) return json(500, { error: "Booking lookup failed", details: bookingErr.message });
  if (!booking) return json(404, { error: "Booking not found" });

  if (booking.cancelled) return json(400, { error: "Booking is cancelled" });
  if (booking.completed) return json(400, { error: "Booking is already completed" });

  if (!booking.borrower_paid) return json(400, { error: "Borrower has not paid yet" });
  if (!booking.owner_deposit_paid) return json(400, { error: "Owner deposit has not been paid yet" });

  // ✅ Use scheduled_start_at if present, else booking_date
  const effectiveStart = booking.scheduled_start_at ?? booking.booking_date;
  if (!effectiveStart) return json(400, { error: "Booking start time missing" });

  const { open, close, start, end } = checkInWindow(effectiveStart, booking.duration_minutes ?? 30);
  const now = Date.now();

  if (!Number.isFinite(open) || !Number.isFinite(close) || !Number.isFinite(start)) {
    return json(400, { error: "Invalid start time format", effectiveStart });
  }

  // Helpful debug
  console.log("check-in timing", {
    booking_id,
    actor: normalizedActor,
    now: new Date(now).toISOString(),
    booking_start: new Date(start).toISOString(),
    opens_at: new Date(open).toISOString(),
    closes_at: new Date(close).toISOString(),
    booking_end: Number.isFinite(end) ? new Date(end).toISOString() : null,
  });

  if (now < open) {
    return json(400, {
      error: "Check-in not open yet",
      opens_at: new Date(open).toISOString(),
      booking_start: new Date(start).toISOString(),
    });
  }

  if (now > close) {
    return json(400, {
      error: "Check-in window closed",
      closes_at: new Date(close).toISOString(),
      booking_start: new Date(start).toISOString(),
      booking_end: Number.isFinite(end) ? new Date(end).toISOString() : null,
    });
  }

  const already = normalizedActor === "borrower"
    ? !!booking.borrower_checked_in
    : !!booking.owner_checked_in;

  if (already) return json(400, { error: "Already checked in" });

  const patch: Record<string, any> = {};
  if (normalizedActor === "borrower") {
    patch.borrower_checked_in = true;
    patch.borrower_checked_in_at = new Date().toISOString();
  } else {
    patch.owner_checked_in = true;
    patch.owner_checked_in_at = new Date().toISOString();
  }

  const { error: updErr } = await supabase
    .from("bookings")
    .update(patch)
    .eq("id", booking_id);

  if (updErr) return json(500, { error: "Failed to update check-in", details: updErr.message });

  const { data: updated, error: readErr } = await supabase
    .from("bookings")
    .select("id, borrower_checked_in, borrower_checked_in_at, owner_checked_in, owner_checked_in_at")
    .eq("id", booking_id)
    .single();

  if (readErr) return json(500, { error: "Check-in updated but readback failed", details: readErr.message });

  return json(200, {
    booking_id,
    actor: normalizedActor,
    message: "Checked in ✅",
    ...updated,
  });
});

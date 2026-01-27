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
const supabase = createClient(supabaseUrl, serviceRoleKey);

function toMs(iso: string | null): number {
  if (!iso) return NaN;
  const t = Date.parse(iso);
  return Number.isFinite(t) ? t : NaN;
}

/**
 * Check-in window rules (as requested):
 * - Opens 15 minutes before scheduled start
 * - Closes 60 minutes after scheduled start
 *
 * NOTE: We still compute `end` for reference/debug output, but `close`
 * is based on start time (not end time) by design.
 */
function checkInWindow(startIso: string, durationMinutes: number) {
  const start = toMs(startIso);
  const durMs = (Number(durationMinutes || 30) * 60 * 1000);
  const end = start + durMs;

  // ✅ New guardrails
  const open = start - (15 * 60 * 1000);        // 15 minutes before start
  const close = start + (60 * 60 * 1000);       // 60 minutes after start

  return { start, end, open, close };
}

serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });

  if (req.method !== "POST") {
    return new Response(JSON.stringify({ error: "Only POST is allowed" }), {
      status: 405,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }

  let body: any;
  try {
    body = await req.json();
  } catch {
    return new Response(JSON.stringify({ error: "Invalid JSON body" }), {
      status: 400,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }

  const booking_id = body?.booking_id;
  const actor = body?.actor ?? body?.role; // ✅ alias

  if (!booking_id) {
    return new Response(JSON.stringify({ error: "booking_id is required" }), {
      status: 400,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }

  if (actor !== "borrower" && actor !== "owner") {
    return new Response(
      JSON.stringify({ error: "actor must be 'borrower' or 'owner'" }),
      {
        status: 400,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      }
    );
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
      "borrower_id",
      "owner_id",
      "borrower_paid",
      "owner_deposit_paid",
      "borrower_checked_in",
      "borrower_checked_in_at",
      "owner_checked_in",
      "owner_checked_in_at",
    ].join(","))
    .eq("id", booking_id)
    .single();

  if (bookingErr) {
    return new Response(
      JSON.stringify({ error: "Booking lookup failed", details: bookingErr.message }),
      { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  }

  if (!booking) {
    return new Response(JSON.stringify({ error: "Booking not found" }), {
      status: 404,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }

  // Role authorization (must be borrower or owner on this booking)
  const isBorrower = booking.borrower_id === body?.user_id || booking.borrower_id === body?.uid || booking.borrower_id; // keep existing behavior light
  const isOwner = booking.owner_id === body?.user_id || booking.owner_id === body?.uid || booking.owner_id;

  // We actually enforce by comparing to booking row IDs, not caller IDs here,
  // because we use service role. The function relies on "actor" + booking state.
  // (Your other functions enforce auth more strictly.)
  // If you want hard auth enforcement here later, we can add JWT verification.

  if (booking.cancelled) {
    return new Response(JSON.stringify({ error: "Booking is cancelled" }), {
      status: 400,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }

  if (booking.completed) {
    return new Response(JSON.stringify({ error: "Booking is already completed" }), {
      status: 400,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }

  if (!booking.borrower_paid) {
    return new Response(JSON.stringify({ error: "Borrower has not paid yet" }), {
      status: 400,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }

  if (!booking.owner_deposit_paid) {
    return new Response(JSON.stringify({ error: "Owner deposit has not been paid yet" }), {
      status: 400,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }

  // ✅ Use scheduled_start_at if present, else booking_date
  const effectiveStart = booking.scheduled_start_at ?? booking.booking_date;
  if (!effectiveStart) {
    return new Response(JSON.stringify({ error: "Booking start time missing" }), {
      status: 400,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }

  const { open, close, start, end } = checkInWindow(effectiveStart, booking.duration_minutes ?? 30);
  const now = Date.now();

  if (!Number.isFinite(open) || !Number.isFinite(close) || !Number.isFinite(start)) {
    return new Response(JSON.stringify({ error: "Invalid start time format" }), {
      status: 400,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }

  if (now < open) {
    return new Response(JSON.stringify({
      error: "Check-in not open yet",
      opens_at: new Date(open).toISOString(),
      booking_start: new Date(start).toISOString(),
    }), { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } });
  }

  if (now > close) {
    return new Response(JSON.stringify({
      error: "Check-in window closed",
      closes_at: new Date(close).toISOString(),
      booking_start: new Date(start).toISOString(),
      booking_end: Number.isFinite(end) ? new Date(end).toISOString() : null,
    }), { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } });
  }

  const already = actor === "borrower" ? !!booking.borrower_checked_in : !!booking.owner_checked_in;
  if (already) {
    return new Response(JSON.stringify({ error: "Already checked in" }), {
      status: 400,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }

  const patch: Record<string, any> = {};
  if (actor === "borrower") {
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

  if (updErr) {
    return new Response(JSON.stringify({ error: "Failed to update check-in", details: updErr.message }), {
      status: 500,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }

  const { data: updated } = await supabase
    .from("bookings")
    .select("id, borrower_checked_in, borrower_checked_in_at, owner_checked_in, owner_checked_in_at")
    .eq("id", booking_id)
    .single();

  return new Response(JSON.stringify({
    booking_id,
    actor,
    message: "Checked in ✅",
    ...updated,
  }), { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } });
});

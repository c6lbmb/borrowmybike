import { serve } from "https://deno.land/std@0.177.0/http/server.ts";
import { createClient } from "https://cdn.jsdelivr.net/npm/@supabase/supabase-js/+esm";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

const supabaseUrl = Deno.env.get("MY_SUPABASE_URL")!;
const supabaseKey = Deno.env.get("MY_SUPABASE_SERVICE_ROLE_KEY")!;
const supabase = createClient(supabaseUrl, supabaseKey);

const SETTLE_FN_URL = `${supabaseUrl}/functions/v1/settle-booking`;

// ✅ Minimum time after scheduled start before completion can be confirmed
const MIN_COMPLETE_MINUTES = 20;

function msFromIso(iso: string | null) {
  if (!iso) return NaN;
  const t = Date.parse(iso);
  return Number.isFinite(t) ? t : NaN;
}

function normalizeOwnerDepositChoice(x: any): "refund" | "keep" | null {
  const v = String(x ?? "").trim().toLowerCase();
  if (v === "refund") return "refund";
  if (v === "keep") return "keep";
  return null;
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
  try { body = await req.json(); } catch {
    return new Response(JSON.stringify({ error: "Invalid JSON body" }), {
      status: 400,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }

  const booking_id = body?.booking_id;
  const actor = body?.actor ?? body?.role;

  if (!booking_id) {
    return new Response(JSON.stringify({ error: "booking_id is required" }), {
      status: 400,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }

  if (actor !== "borrower" && actor !== "owner") {
    return new Response(JSON.stringify({ error: "actor must be 'borrower' or 'owner'" }), {
      status: 400,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }

  const { data: booking, error: bookingError } = await supabase
    .from("bookings")
    .select("*")
    .eq("id", booking_id)
    .single();

  if (bookingError || !booking) {
    return new Response(JSON.stringify({ error: "Booking not found" }), {
      status: 404,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }

  if (booking.cancelled) {
    return new Response(JSON.stringify({ error: "Booking is cancelled and cannot be completed" }), {
      status: 400,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }

  // ✅ Must both be checked in before ANY completion confirmation
  if (!booking.borrower_checked_in || !booking.owner_checked_in) {
    return new Response(JSON.stringify({
      error: "Both parties must check in before confirming completion",
      borrower_checked_in: !!booking.borrower_checked_in,
      owner_checked_in: !!booking.owner_checked_in,
    }), { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } });
  }

  // ✅ Must be at least MIN_COMPLETE_MINUTES after scheduled start (or booking_date fallback)
  const effectiveStartIso = booking.scheduled_start_at ?? booking.booking_date ?? null;
  const startMs = msFromIso(effectiveStartIso);
  if (!Number.isFinite(startMs)) {
    return new Response(JSON.stringify({ error: "Invalid or missing scheduled start time" }), {
      status: 400,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }

  const allowedAt = startMs + MIN_COMPLETE_MINUTES * 60 * 1000;
  if (Date.now() < allowedAt) {
    return new Response(JSON.stringify({
      error: "Too early to confirm completion",
      allowed_at: new Date(allowedAt).toISOString(),
      min_complete_minutes: MIN_COMPLETE_MINUTES,
    }), { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } });
  }

  const nowIso = new Date().toISOString();
  const patch: Record<string, any> = {};

  if (actor === "borrower") {
    if (!booking.borrower_confirmed_complete) {
      patch.borrower_confirmed_complete = true;
      patch.borrower_confirmed_complete_at = nowIso;
    }
  } else {
    if (!booking.owner_confirmed_complete) {
      patch.owner_confirmed_complete = true;
      patch.owner_confirmed_complete_at = nowIso;
    }

    // NEW: owner chooses what happens with their deposit (refund vs keep)
    const choice = normalizeOwnerDepositChoice(body?.owner_deposit_choice);
    if (choice) {
      patch.owner_deposit_choice = choice;
    }
  }

  if (Object.keys(patch).length > 0) {
    const { error: confirmErr } = await supabase
      .from("bookings")
      .update(patch)
      .eq("id", booking_id);

    if (confirmErr) {
      return new Response(JSON.stringify({ error: "Failed to save completion confirmation", details: confirmErr.message }), {
        status: 500,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }
  }

  const { data: updated, error: refetchErr } = await supabase
    .from("bookings")
    .select("*")
    .eq("id", booking_id)
    .single();

  if (refetchErr || !updated) {
    return new Response(JSON.stringify({ error: "Failed to refetch booking after confirmation" }), {
      status: 500,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }

  const bothConfirmed = !!updated.borrower_confirmed_complete && !!updated.owner_confirmed_complete;

  if (bothConfirmed && !updated.completed) {
    const { error: completeErr } = await supabase
      .from("bookings")
      .update({
        completed: true,
        owner_payout_amount: 100,
        owner_payout_done: false,
        owner_payout_at: null,
      })
      .eq("id", booking_id);

    if (completeErr) {
      return new Response(JSON.stringify({ error: "Failed to mark booking completed", details: completeErr.message }), {
        status: 500,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }
  }

  // Auto-settle if completed and not settled
  let autoSettle: any = { attempted: false };

  if (bothConfirmed) {
    const { data: b3 } = await supabase
      .from("bookings")
      .select("id, completed, settled")
      .eq("id", booking_id)
      .single();

    if (b3?.completed && b3?.settled) {
      autoSettle = { attempted: false, reason: "already_settled" };
    } else if (b3?.completed && !b3?.settled) {
      autoSettle.attempted = true;
      try {
        const resp = await fetch(SETTLE_FN_URL, {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            // service role token, settle-booking doesn’t require user auth for action=settle
            "Authorization": `Bearer ${supabaseKey}`,
          },
          body: JSON.stringify({ booking_id, action: "settle" }),
        });

        const text = await resp.text();
        let js: any = null;
        try { js = JSON.parse(text); } catch { js = { raw: text }; }

        autoSettle.ok = resp.ok;
        autoSettle.http_status = resp.status;
        autoSettle.response = js;
      } catch (err) {
        autoSettle.ok = false;
        autoSettle.error = String(err);
      }
    }
  }

  const { data: final } = await supabase
    .from("bookings")
    .select("id, borrower_confirmed_complete, owner_confirmed_complete, completed, settled, settled_at, settlement_outcome, owner_deposit_choice")
    .eq("id", booking_id)
    .single();

  return new Response(JSON.stringify({
    booking_id,
    actor_confirmed: actor,
    borrower_confirmed_complete: !!final?.borrower_confirmed_complete,
    owner_confirmed_complete: !!final?.owner_confirmed_complete,
    completed: !!final?.completed,
    settled: !!final?.settled,
    settled_at: final?.settled_at ?? null,
    settlement_outcome: final?.settlement_outcome ?? null,
    owner_deposit_choice: final?.owner_deposit_choice ?? null,
    auto_settle: autoSettle,
    message: bothConfirmed
      ? "Both parties confirmed ✅ booking marked completed. Auto-settle attempted."
      : "Confirmation saved ✅ waiting on the other party.",
  }), { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } });
});

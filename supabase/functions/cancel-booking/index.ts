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

function cents(amount: number) {
  return Math.round(amount * 100);
}

function nowIso() {
  return new Date().toISOString();
}

function daysBetween(aIso: string, bIso: string) {
  const a = new Date(aIso).getTime();
  const b = new Date(bIso).getTime();
  return (b - a) / (1000 * 60 * 60 * 24);
}

function scheduledIso(booking: any) {
  return booking?.scheduled_start_at ?? booking?.booking_date ?? null;
}

// --- acceptance window helpers (Rahim rule) ---
function acceptanceHoursFor(scheduledIso: string | null | undefined) {
  // Default: 8 hours to accept
  // If test is within 72 hours: shorter window
  //   < 24 hours -> 2 hours
  //   24–72 hours -> 4 hours
  if (!scheduledIso) return 8;
  const scheduled = new Date(scheduledIso);
  if (isNaN(scheduled.getTime())) return 8;

  const msUntil = scheduled.getTime() - Date.now();
  const hoursUntil = msUntil / (1000 * 60 * 60);

  if (hoursUntil < 24) return 2;
  if (hoursUntil < 72) return 4;
  return 8;
}

function isExpiredWindow(booking: any) {
  const createdIso = booking?.created_at;
  if (!createdIso) return false;

  const created = new Date(createdIso);
  if (isNaN(created.getTime())) return false;

  const scheduledIso = booking?.scheduled_start_at ?? booking?.booking_date ?? null;
  const hours = acceptanceHoursFor(scheduledIso);

  const deadlineMs = created.getTime() + hours * 60 * 60 * 1000;
  return Date.now() > deadlineMs;
}

function daysUntilTest(booking: any) {
  const scheduledIso = booking?.scheduled_start_at ?? booking?.booking_date ?? null;
  if (!scheduledIso) return 0;
  const d = new Date(scheduledIso);
  if (isNaN(d.getTime())) return 0;
  return (d.getTime() - Date.now()) / (1000 * 60 * 60 * 24);
}

async function ensureCredit(args: {
  supabase: any;
  user_id: string;
  booking_id: string;
  credit_type: string;
  amount: number;
  expires_at: string | null;
  reason: string;
}) {
  const { supabase, user_id, booking_id, credit_type, amount, expires_at, reason } = args;

  const { data: existing, error: exErr } = await supabase
    .from("credits")
    .select("id")
    .eq("user_id", user_id)
    .eq("booking_id", booking_id)
    .eq("credit_type", credit_type)
    .eq("status", "available")
    .limit(1);

  if (exErr) throw exErr;
  if (existing && existing.length) return { created: false };

  const { error: insErr } = await supabase.from("credits").insert([{
    user_id,
    booking_id,
    amount,
    currency: "CAD",
    credit_type,
    reason,
    status: "available",
    expires_at,
    used_at: null,
    used_on_booking_id: null,
  }]);

  if (insErr) throw insErr;
  return { created: true };
}


async function logBookingAudit(args: {
  supabase: any;
  booking_id: string;
  actor_role: string; // borrower | owner | system | admin
  actor_user_id: string | null;
  action: string;
  note: string | null;
}) {
  const { supabase, booking_id, actor_role, actor_user_id, action, note } = args;
  const { error } = await supabase.from("booking_audit_log").insert([{
    booking_id,
    actor_role,
    actor_user_id,
    action,
    note,
  }]);
  if (error) throw error;
}


async function stripeRefundPartial(
  stripeKey: string,
  paymentIntentId: string,
  amountCents: number,
  idempotencyKey: string,
) {
  // Stripe SDKs can pull in Node polyfills that are unstable in Supabase Edge runtime.
  // Use Stripe REST API directly (form-encoded) to avoid Node compatibility shims.
  const body = new URLSearchParams({
    payment_intent: paymentIntentId,
    amount: String(amountCents),
  });

  const res = await fetch("https://api.stripe.com/v1/refunds", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${stripeKey}`,
      "Content-Type": "application/x-www-form-urlencoded",
      "Idempotency-Key": idempotencyKey,
    },
    body,
  });

  const data = await res.json();
  if (!res.ok) {
    const msg = (data && (data.error?.message || data.error || data.message)) || `Stripe refund failed (${res.status})`;
    throw new Error(typeof msg === "string" ? msg : JSON.stringify(msg));
  }
  return data;
}

serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  if (req.method !== "POST") return json(405, { error: "Method not allowed" });

  const version = "cancel-booking/v9";

  const SUPABASE_URL = Deno.env.get("MY_SUPABASE_URL");
  const SERVICE_ROLE_KEY = Deno.env.get("MY_SUPABASE_SERVICE_ROLE_KEY");
  const STRIPE_SECRET_KEY = Deno.env.get("STRIPE_SECRET_KEY");

  if (!SUPABASE_URL || !SERVICE_ROLE_KEY) return json(500, { error: "Missing Supabase env", version });

  const { createClient } = await import("https://esm.sh/@supabase/supabase-js@2?target=deno");
  const supabase = createClient(SUPABASE_URL, SERVICE_ROLE_KEY);

  let body: any;
  try {
    body = await req.json();
  } catch {
    return json(400, { error: "Invalid JSON body", version });
  }

  const booking_id = body?.booking_id;
  const cancelled_by = body?.cancelled_by;

  if (!booking_id) return json(400, { error: "booking_id is required", version });
  if (!["borrower", "owner", "system_expired"].includes(cancelled_by)) {
    return json(400, { error: "cancelled_by must be borrower | owner | system_expired", version });
  }

  const { data: booking0, error: bErr } = await supabase
    .from("bookings")
    .select("*")
    .eq("id", booking_id)
    .single();

  if (bErr || !booking0) return json(404, { error: "Booking not found", version });
  if (booking0.cancelled) return json(200, { ok: true, message: "Already cancelled", version });

  const borrower_id = booking0.borrower_id;
  const owner_id = booking0.owner_id;

  // --- system expired (owner didn't accept) ---
  if (cancelled_by === "system_expired") {
    if (!booking0.borrower_paid) return json(400, { error: "Borrower not paid; cannot system-expire", version });
    if (booking0.owner_deposit_paid) return json(400, { error: "Owner already accepted; cannot system-expire", version });

    if (!isExpiredWindow(booking0)) {
      return json(400, {
        error: "Not expired yet",
        acceptance_hours: acceptanceHoursFor(scheduledIso(booking0)),
        version,
      });
    }

    const { error: upErr } = await supabase
      .from("bookings")
      .update({
        cancelled: true,
        cancelled_by: "system_expired",
        cancelled_at: nowIso(),
        status: "expired_no_owner_acceptance",
      })
      .eq("id", booking_id);

    if (upErr) return json(500, { error: "Failed to update booking", details: upErr, version });

    await ensureCredit({
      supabase,
      user_id: borrower_id,
      booking_id,
      credit_type: "rebook_credit",
      amount: 150,
      expires_at: null,
      reason: `Owner did not accept in time (booking ${booking_id}). Rebook credit issued.`,
    });

    
    await logBookingAudit({
      supabase,
      booking_id,
      actor_role: "system",
      actor_user_id: null,
      action: "expired_no_owner_acceptance_credit_full",
      note: `Acceptance window expired; borrower credited`,
    });

return json(200, {
      ok: true,
      booking_id,
      cancelled_by,
      acceptance_hours: acceptanceHoursFor(scheduledIso(booking0)),
      message: "Booking expired; borrower credited ✅",
      version,
    });
  }

  // --- borrower/owner cancel (existing logic) ---
  const now = nowIso();
  const scheduled = scheduledIso(booking0);
  const daysUntil = scheduled ? daysBetween(now, scheduled) : 0;

  
  // --- Scenario 1 / Pre-accept cancellation (only borrower paid) ---
  // If borrower paid but owner has not accepted/paid deposit yet:
  // - borrower cancel OR owner decline -> full borrower credit ($150), no Stripe refund.
  if (booking0.borrower_paid && !booking0.owner_deposit_paid && ["borrower", "owner"].includes(cancelled_by)) {
    const now = nowIso();

    const isBorrowerCancel = cancelled_by === "borrower";
    const status = isBorrowerCancel ? "cancelled_before_owner_accept" : "declined_by_owner_before_accept";
    const cancel_scenario = isBorrowerCancel ? "borrower_cancel_pre_accept" : "owner_declined_pre_accept";

    const { error: upErr } = await supabase
      .from("bookings")
      .update({
        cancelled: true,
        cancelled_by,
        cancelled_at: now,
        status,
        cancel_scenario,
        refund_status: "credit",
        refund_amount_cents: 15000,
        updated_at: now,
      })
      .eq("id", booking_id);

    if (upErr) return json(500, { error: "Failed to update booking", details: upErr, version });

    await ensureCredit({
      supabase,
      user_id: borrower_id,
      booking_id,
      credit_type: "rebook_credit",
      amount: 150,
      expires_at: null,
      reason: isBorrowerCancel
        ? `Borrower cancelled before owner accepted (booking ${booking_id}). Full credit issued.`
        : `Owner declined before accepting (booking ${booking_id}). Borrower full credit issued.`,
    });

    await logBookingAudit({
      supabase,
      booking_id,
      actor_role: isBorrowerCancel ? "borrower" : "owner",
      actor_user_id: isBorrowerCancel ? borrower_id : owner_id,
      action: "cancel_pre_accept_credit_full",
      note: cancel_scenario,
    });

    return json(200, {
      ok: true,
      booking_id,
      cancelled_by,
      message: "Pre-accept cancellation handled; borrower credited ✅",
      version,
    });
  }

// Require both paid for borrower/owner cancel logic
  if (!booking0.borrower_paid || !booking0.owner_deposit_paid) {
    return json(400, {
      error: "Cannot cancel this way unless both borrower and owner have paid",
      borrower_paid: booking0.borrower_paid,
      owner_deposit_paid: booking0.owner_deposit_paid,
      version,
    });
  }

  const canceller = cancelled_by; // 'borrower' or 'owner'
  const otherParty = canceller === "borrower" ? "owner" : "borrower";

  const canceller_user_id = canceller === "borrower" ? borrower_id : owner_id;
  const other_user_id = otherParty === "borrower" ? borrower_id : owner_id;

  // Fee rules:
  // > 5 days: 25% platform fee ($37.50) and $112.50 back to canceller
  // <= 5 days: canceller forfeits full $150
  const early = daysUntil > 5;

  const cancellerRefund = early ? 112.5 : 0;
  const platformIncome = early ? 37.5 : 150;

  // Find payment intents for potential Stripe refunds
  const { data: pBorrower, error: pBErr } = await supabase
    .from("payments")
    .select("*")
    .eq("booking_id", booking_id)
    .eq("payment_type", "borrower_booking")
    .maybeSingle();

  if (pBErr) return json(500, { error: "Failed to load borrower payment row", details: pBErr, version });

  const { data: pOwner, error: pOErr } = await supabase
    .from("payments")
    .select("*")
    .eq("booking_id", booking_id)
    .eq("payment_type", "owner_deposit")
    .maybeSingle();

  if (pOErr) return json(500, { error: "Failed to load owner payment row", details: pOErr, version });

  const borrowerPI = (pBorrower as any)?.stripe_payment_intent_id ?? null;
  const ownerPI = (pOwner as any)?.stripe_payment_intent_id ?? null;

  // 1) mark booking cancelled
  const { error: bUpErr } = await supabase
    .from("bookings")
    .update({
      cancelled: true,
      cancelled_by: canceller,
      cancelled_at: now,
      status: early ? "cancelled_early" : "cancelled_late",
    })
    .eq("id", booking_id);

  if (bUpErr) return json(500, { error: "Failed to update booking", details: bUpErr, version });

  // 2) rebook credit for the non-cancelling party (always full 150)
  await ensureCredit({
    supabase,
    user_id: other_user_id,
    booking_id,
    credit_type: "rebook_credit",
    amount: 150,
    expires_at: null,
    reason: `Other party cancelled (${canceller}). Rebook credit issued.`,
  });

  // 3) handle canceller refund:
  // - if early, refund $112.50 back to canceller (prefer Stripe refund if PI exists)
  // - else late, no refund
  const refundResult: any = { performed: false, via: null, stripe_refund_id: null };

  if (early && cancellerRefund > 0) {
    const piToRefund = canceller === "borrower" ? borrowerPI : ownerPI;

    if (piToRefund && STRIPE_SECRET_KEY) {
      try {
        const refund = await stripeRefundPartial(
          STRIPE_SECRET_KEY,
          piToRefund,
          cents(cancellerRefund),
          `cancel_${booking_id}_${canceller}_${now}`,
        );

        refundResult.performed = true;
        refundResult.via = "stripe";
        refundResult.stripe_refund_id = refund.id;

        // Persist refund info onto the payment row for audit/debug (does not change business logic).
        const payType = canceller === "borrower" ? "borrower_booking" : "owner_deposit";
        await supabase
          .from("payments")
          .update({
            refund_id: refund.id,
            refund_status: refund.status ?? "succeeded",
            refunded_amount_cents: cents(cancellerRefund),
          })
          .eq("booking_id", booking_id)
          .eq("payment_type", payType);

      } catch (e: any) {
        // fallback to credit if Stripe refund fails
        await ensureCredit({
          supabase,
          user_id: canceller_user_id,
          booking_id,
          credit_type: "rebook_credit",
          amount: cancellerRefund,
          expires_at: null,
          reason: `Cancellation refund (Stripe refund failed). Credit issued.`,
        });

        refundResult.performed = true;
        refundResult.via = "credit_fallback";
        refundResult.error = e?.message ?? String(e);
      }
    } else {
      // no PI -> credit fallback
      await ensureCredit({
        supabase,
        user_id: canceller_user_id,
        booking_id,
        credit_type: "rebook_credit",
        amount: cancellerRefund,
        expires_at: null,
        reason: `Cancellation refund (no Stripe PI). Credit issued.`,
      });

      refundResult.performed = true;
      refundResult.via = "credit";
    }
  }

  
  // 3b) Persist canceller refund summary onto bookings (UI visibility)
  // This does NOT affect payouts/credits; it only mirrors what happened for transparency.
  if (early && cancellerRefund > 0 && refundResult.performed) {
    const refundStatus =
      refundResult.via === "stripe"
        ? "refunded_partial"
        : refundResult.via === "credit"
        ? "credited_partial"
        : refundResult.via === "credit_fallback"
        ? "credited_partial"
        : "partial";

    await supabase
      .from("bookings")
      .update({
        refund_status: refundStatus,
        refund_amount_cents: cents(cancellerRefund),
      })
      .eq("id", booking_id);
  }

// 4) record platform income payment row
  const { error: platErr } = await supabase.from("payments").insert([{
    booking_id,
    payment_type: "platform_income_cancel_fee",
    status: "paid",
    amount: platformIncome,
    currency: "CAD",
    borrower_id,
    owner_id,
  }]);

  if (platErr) return json(500, { error: "Failed to insert platform income row", details: platErr, version });

  
  await logBookingAudit({
    supabase,
    booking_id,
    actor_role: canceller,
    actor_user_id: canceller_user_id,
    action: early ? "cancel_gt_5_days" : "cancel_lte_5_days",
    note: `cancellerRefund=${cancellerRefund}; platformIncome=${platformIncome}; refundResult=${refundResult?.via ?? "none"}`,
  });

return json(200, {
    ok: true,
    booking_id,
    cancelled_by,
    early,
    daysUntil,
    cancellerRefund,
    platformIncome,
    borrowerPI_present: !!borrowerPI,
    ownerPI_present: !!ownerPI,
    refundResult,
    version,
  });
});

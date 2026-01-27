import { serve } from "https://deno.land/std@0.192.0/http/server.ts";
import Stripe from "https://esm.sh/stripe@14.21.0?target=deno";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type, x-admin-key",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

function json(status: number, body: unknown) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}

function toIso(d: Date) {
  return d.toISOString();
}

function cents(amount: number) {
  return Math.round(amount * 100);
}

function statusCountsAsPaid(status: string | null | undefined) {
  const s = String(status || "").toLowerCase();
  return s === "paid" || s === "succeeded" || s === "captured" || s === "payout_due";
}

function addDaysIso(days: number) {
  const d = new Date();
  d.setDate(d.getDate() + days);
  return d.toISOString();
}

function pickBorrowerPayment(payments: any[]) {
  return (
    payments.find((p) => String(p.payment_type || "").toLowerCase() === "borrower_booking") ||
    payments.find((p) => String(p.payment_type || "").toLowerCase() === "borrower_payment") ||
    payments.find((p) => String(p.payment_type || "").toLowerCase() === "borrower_credit") ||
    payments.find((p) => String(p.payment_type || "").toLowerCase().includes("borrower")) ||
    null
  );
}

function pickOwnerDeposit(payments: any[]) {
  return (
    payments.find((p) => String(p.payment_type || "").toLowerCase() === "owner_deposit") ||
    payments.find((p) => String(p.payment_type || "").toLowerCase().includes("deposit")) ||
    null
  );
}

async function stripeRefund(
  paymentIntentId: string,
  amountCents: number,
  idempotencyKey: string,
) {
  const stripeKey = Deno.env.get("STRIPE_SECRET_KEY");
  if (!stripeKey) throw new Error("Missing STRIPE_SECRET_KEY");
  const stripe = new Stripe(stripeKey, { apiVersion: "2023-10-16" });

  const refund = await stripe.refunds.create(
    { payment_intent: paymentIntentId, amount: amountCents },
    { idempotencyKey },
  );

  return refund;
}

// --- acceptance window helpers (kept) ---
function acceptanceHoursFor(scheduledIso: string | null | undefined) {
  if (!scheduledIso) return 12;
  const scheduled = new Date(scheduledIso);
  if (isNaN(scheduled.getTime())) return 12;

  const msUntil = scheduled.getTime() - Date.now();
  const daysUntil = msUntil / (1000 * 60 * 60 * 24);

  if (daysUntil > 14) return 24;
  if (daysUntil >= 3) return 12;
  return 6;
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
    .limit(1);

  if (exErr) return { ok: false as const, created: false as const, error: exErr.message };
  if (existing && existing.length > 0) return { ok: true as const, created: false as const, error: null };

  const { error: insErr } = await supabase
    .from("credits")
    .insert({
      user_id,
      booking_id,
      amount,
      currency: "CAD",
      credit_type,
      reason,
      status: "available",
      expires_at,
    });

  if (insErr) return { ok: false as const, created: false as const, error: insErr.message };
  return { ok: true as const, created: true as const, error: null };
}

async function restoreUsedCreditIfAny(args: {
  supabase: any;
  booking_id: string;
  user_id: string;
}) {
  const { supabase, booking_id, user_id } = args;

  const { data: usedCredits, error: cuErr } = await supabase
    .from("credits")
    .select("*")
    .eq("user_id", user_id)
    .eq("status", "used")
    .eq("used_on_booking_id", booking_id)
    .limit(10);

  if (cuErr) return { ok: false as const, restored: 0, error: cuErr.message };
  if (!usedCredits || usedCredits.length === 0) return { ok: true as const, restored: 0, error: null };

  let restored = 0;
  for (const c of usedCredits) {
    const { error: ruErr } = await supabase
      .from("credits")
      .update({
        status: "available",
        used_at: null,
        used_on_booking_id: null,
      })
      .eq("id", c.id)
      .eq("status", "used");

    if (!ruErr) restored++;
  }

  return { ok: true as const, restored, error: null };
}

serve(async (req) => {
  if (req.method === "OPTIONS") return json(200, { ok: true });
  if (req.method !== "POST") return json(405, { error: "Method not allowed" });

  let payload: any = null;
  try {
    payload = await req.json();
  } catch {
    return json(400, { error: "Invalid JSON body" });
  }

  const booking_id = payload?.booking_id;
  const cancelled_by = payload?.cancelled_by as "borrower" | "owner" | "system_expired";
  const refund_to_credit = Boolean(payload?.refund_to_credit); // optional UI override for Stripe payers

  if (!booking_id) return json(400, { error: "booking_id is required" });
  if (cancelled_by !== "borrower" && cancelled_by !== "owner" && cancelled_by !== "system_expired") {
    return json(400, { error: "cancelled_by must be 'borrower', 'owner', or 'system_expired'" });
  }

  const version = "cancel-booking v11 (5-day rule + stripe refund default + credit fallback)";

  const supabaseUrl = Deno.env.get("SUPABASE_URL");
  const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
  if (!supabaseUrl || !serviceKey) {
    return json(500, { error: "Missing SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY", version });
  }

  const { createClient } = await import("https://esm.sh/@supabase/supabase-js@2.45.4");
  const supabase = createClient(supabaseUrl, serviceKey);

  // Load booking
  const { data: booking0, error: bErr } = await supabase
    .from("bookings")
    .select("*")
    .eq("id", booking_id)
    .single();

  if (bErr || !booking0) return json(404, { error: "Booking not found", version });

  if (booking0.settled) return json(400, { error: "Booking already settled; cannot cancel", version });
  if (booking0.completed) return json(400, { error: "Booking already completed; cannot cancel", version });

  if (booking0.cancelled) {
    return json(200, { version, booking_id, message: "Already cancelled ✅" });
  }

  // Load payments
  const { data: payments, error: pErr } = await supabase
    .from("payments")
    .select("*")
    .eq("booking_id", booking_id)
    .order("created_at", { ascending: true });

  if (pErr) return json(500, { error: "Failed to load payments", details: pErr.message, version });

  const borrowerPay = pickBorrowerPayment(payments);
  const ownerDep = pickOwnerDeposit(payments);

  // SYSTEM EXPIRED branch kept (credit-only)
  if (cancelled_by === "system_expired") {
    if (!booking0.borrower_paid) return json(400, { error: "Borrower has not paid; cannot system-expire", version });
    if (booking0.owner_deposit_paid) return json(400, { error: "Owner already accepted; cannot system-expire", version });
    if (!isExpiredWindow(booking0)) return json(400, { error: "Booking has NOT expired yet", version });

    const { data: claimed, error: claimErr } = await supabase
      .from("bookings")
      .update({
        cancelled: true,
        cancelled_by: "system",
        cancelled_at: toIso(new Date()),
        status: "expired_no_owner_acceptance",
        needs_rebooking: true,
        rebook_by: addDaysIso(21),
      })
      .eq("id", booking_id)
      .eq("cancelled", false)
      .select("*")
      .single();

    if (claimErr || !claimed) {
      return json(200, { version, booking_id, message: "Already cancelled ✅ (claimed by another call)" });
    }

    const borrower_id = String(booking0.borrower_id);
    const rebook_by = addDaysIso(21);

    const paidViaBorrowerCredit =
      borrowerPay && String(borrowerPay.payment_type || "").toLowerCase() === "borrower_credit";

    if (paidViaBorrowerCredit) {
      const restored = await restoreUsedCreditIfAny({ supabase, booking_id, user_id: borrower_id });
      return json(200, {
        version,
        booking_id,
        scenario: "system_expired_restore_credit",
        message: "Expired. Borrower credit restored (no refunds).",
        restored_credits: restored.restored,
        restore_error: restored.error,
      });
    }

    const creditRes = await ensureCredit({
      supabase,
      booking_id,
      user_id: borrower_id,
      credit_type: "rebook_credit",
      amount: 150,
      expires_at: rebook_by,
      reason: `Owner did not accept in time (booking ${booking_id}). Rebook credit issued.`,
    });

    return json(200, {
      version,
      booking_id,
      scenario: "system_expired_issue_credit",
      message: "Expired. Borrower issued $150 platform credit to rebook (no refunds).",
      credit_created: creditRes.created,
      credit_error: creditRes.error,
      expires_at: rebook_by,
    });
  }

  // From here on: borrower/owner cancellations
  const borrowerPaidByPayments = borrowerPay ? statusCountsAsPaid(borrowerPay.status) : false;
  const ownerPaidByPayments = ownerDep ? statusCountsAsPaid(ownerDep.status) : false;

  const bothPaid = borrowerPaidByPayments && ownerPaidByPayments && booking0.borrower_paid && booking0.owner_deposit_paid;
  if (!bothPaid) {
    return json(400, {
      version,
      booking_id,
      error: "Cancel rules require both parties paid (confirmed).",
      debug: {
        borrowerPaidByPayments,
        ownerPaidByPayments,
        borrower_paid_flag: booking0.borrower_paid,
        owner_deposit_paid_flag: booking0.owner_deposit_paid,
        payment_types_found: payments.map((p: any) => p.payment_type),
      },
    });
  }

  // Time rule: >5 days vs <=5 days
  const dUntil = daysUntilTest(booking0);
  const isMoreThan5Days = dUntil > 5;

  // Amounts
  const adminFee = isMoreThan5Days ? 37.5 : 150;
  const cancellerReturn = isMoreThan5Days ? 112.5 : 0;

  const cancellerUserId = cancelled_by === "borrower" ? String(booking0.borrower_id) : String(booking0.owner_id);
  const otherPartyUserId = cancelled_by === "borrower" ? String(booking0.owner_id) : String(booking0.borrower_id);

  const cancellerPayment = cancelled_by === "borrower" ? borrowerPay : ownerDep;
  const otherPartyPayment = cancelled_by === "borrower" ? ownerDep : borrowerPay;

  // ATOMIC CLAIM: set cancelled
  const { data: claimed, error: claimErr } = await supabase
    .from("bookings")
    .update({
      cancelled: true,
      cancelled_by,
      cancelled_at: toIso(new Date()),
      status: "cancelled",
      needs_rebooking: true,
      rebook_by: addDaysIso(21),
    })
    .eq("id", booking_id)
    .eq("cancelled", false)
    .select("*")
    .single();

  if (claimErr || !claimed) {
    return json(200, { version, booking_id, message: "Already cancelled ✅ (claimed by another call)" });
  }

  // Record platform income (idempotent guard: only insert if not already present)
  let platformIncomeInsertError: string | null = null;
  {
    const { data: existingPI } = await supabase
      .from("payments")
      .select("id")
      .eq("booking_id", booking_id)
      .eq("payment_type", "platform_income_cancel_fee")
      .limit(1);

    if (!existingPI || existingPI.length === 0) {
      const { error: piErr } = await supabase.from("payments").insert({
        booking_id,
        payment_type: "platform_income_cancel_fee",
        status: "succeeded",
        amount: adminFee,
        currency: "CAD",
        borrower_id: booking0.borrower_id,
        owner_id: booking0.owner_id,
      });
      if (piErr) platformIncomeInsertError = piErr.message;
    }
  }

  // 1) Non-cancelling party ALWAYS gets 150 back as platform credit to rebook.
  // If they paid with credit originally, restore it (best). Otherwise issue rebook_credit.
  const rebook_by = addDaysIso(21);
  const otherPaidViaCredit =
    otherPartyPayment && String(otherPartyPayment.payment_type || "").toLowerCase().includes("credit");

  let otherPartyCreditResult: any = null;
  if (otherPaidViaCredit) {
    const restored = await restoreUsedCreditIfAny({
      supabase,
      booking_id,
      user_id: otherPartyUserId,
    });
    if (restored.restored > 0) {
      otherPartyCreditResult = { mode: "restored_used_credit", restored: restored.restored, error: restored.error };
    } else {
      const cred = await ensureCredit({
        supabase,
        booking_id,
        user_id: otherPartyUserId,
        credit_type: "rebook_credit",
        amount: 150,
        expires_at: rebook_by,
        reason:
          cancelled_by === "borrower"
            ? `Borrower cancelled. Owner credited $150 to rebook (booking ${booking_id}).`
            : `Owner cancelled. Borrower credited $150 to rebook (booking ${booking_id}).`,
      });
      otherPartyCreditResult = { mode: "issued_rebook_credit", created: cred.created, error: cred.error };
    }
  } else {
    const cred = await ensureCredit({
      supabase,
      booking_id,
      user_id: otherPartyUserId,
      credit_type: "rebook_credit",
      amount: 150,
      expires_at: rebook_by,
      reason:
        cancelled_by === "borrower"
          ? `Borrower cancelled. Owner credited $150 to rebook (booking ${booking_id}).`
          : `Owner cancelled. Borrower credited $150 to rebook (booking ${booking_id}).`,
    });
    otherPartyCreditResult = { mode: "issued_rebook_credit", created: cred.created, error: cred.error };
  }

  // 2) Canceller gets 112.50 back ONLY if >5 days. (<=5 days => forfeiture)
  let cancellerReturnResult: any = { mode: "forfeiture", returned: 0 };

  if (isMoreThan5Days && cancellerReturn > 0) {
    const cancellerPaidViaCredit =
      cancellerPayment && String(cancellerPayment.payment_type || "").toLowerCase().includes("credit");

    const pi = cancellerPayment
      ? (cancellerPayment.stripe_payment_intent_id || cancellerPayment.stripe_id || null)
      : null;

    // If Stripe payment exists and UI didn't request credit, do Stripe refund
    const shouldStripeRefund = Boolean(pi) && !refund_to_credit;

    if (shouldStripeRefund) {
      // idempotency: if refund already recorded, don’t refund again
      if (cancellerPayment.refund_id || String(cancellerPayment.refund_status || "").toLowerCase() === "succeeded") {
        cancellerReturnResult = {
          mode: "stripe_refund_already_done",
          returned: cancellerReturn,
          refund_id: cancellerPayment.refund_id ?? null,
          refund_status: cancellerPayment.refund_status ?? null,
        };
      } else {
        try {
          const amountCents = cents(cancellerReturn);
          const idemKey = `cancel-refund:${booking_id}:${cancellerPayment.id}:${amountCents}`;
          const refund = await stripeRefund(String(pi), amountCents, idemKey);

          const { error: updErr } = await supabase
            .from("payments")
            .update({
              refund_id: refund?.id ?? null,
              refunded_amount_cents: refund?.amount ?? null,
              refund_status: refund?.status ?? null,
            })
            .eq("id", cancellerPayment.id);

          cancellerReturnResult = {
            mode: "stripe_refund",
            returned: cancellerReturn,
            refund_id: refund?.id ?? null,
            refund_status: refund?.status ?? null,
            payment_update_error: updErr ? updErr.message : null,
          };
        } catch (e: any) {
          // IMPORTANT: booking is already cancelled — surface error clearly for manual action.
          return json(500, {
            version,
            booking_id,
            error: "Stripe refund failed (booking already cancelled).",
            message: e?.message || String(e),
            debug: { adminFee, cancellerReturn, cancelled_by },
          });
        }
      }
    } else {
      // Credit fallback (covers paid-via-credit, missing PI, or user chose credit instead of Stripe refund)
      const creditType = "cancel_refund_credit";
      const reason =
        `Refund for canceller (${cancelled_by}) on booking ${booking_id} (>5 days). ` +
        `Returned ${cancellerReturn.toFixed(2)} (admin fee ${adminFee.toFixed(2)}).`;

      const cred = await ensureCredit({
        supabase,
        booking_id,
        user_id: cancellerUserId,
        credit_type: creditType,
        amount: cancellerReturn,
        expires_at: rebook_by,
        reason,
      });

      cancellerReturnResult = {
        mode: refund_to_credit ? "credit_refund_user_chose" : (cancellerPaidViaCredit ? "credit_refund_paid_via_credit" : "credit_refund_no_pi"),
        returned: cancellerReturn,
        credit_created: cred.created,
        credit_error: cred.error,
      };
    }
  }

  return json(200, {
    version,
    booking_id,
    cancelled_by,
    rule: isMoreThan5Days ? ">5_days" : "<=5_days_forfeit",
    admin_fee_platform_income: adminFee,
    canceller_return: cancellerReturn,
    other_party_rebook_credit: 150,
    results: {
      otherParty: otherPartyCreditResult,
      canceller: cancellerReturnResult,
      platformIncomeInsertError,
    },
  });
});

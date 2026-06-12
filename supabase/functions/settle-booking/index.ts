// supabase/functions/settle-booking/index.ts
import { serve } from "https://deno.land/std@0.177.0/http/server.ts";
import { createClient } from "https://cdn.jsdelivr.net/npm/@supabase/supabase-js/+esm";
import Stripe from "https://esm.sh/stripe@14.21.0?target=deno";
import { sendEmail } from "../_shared/sendEmail.ts";
import { hasNotificationBeenSent, logNotificationSent } from "../_shared/notificationLog.ts";
import { formatBookingTime } from "../_shared/formatBookingTime.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

const supabaseUrl = Deno.env.get("MY_SUPABASE_URL")!;
const serviceRoleKey = Deno.env.get("MY_SUPABASE_SERVICE_ROLE_KEY")!;
const stripeSecretKey = Deno.env.get("STRIPE_SECRET_KEY") || "";
const supabase = createClient(supabaseUrl, serviceRoleKey);

const OWNER_DEPOSIT_AMOUNT = 150;
const BOOKING_FEE_AMOUNT = 150;
const COMP_AMOUNT = 100;
const PLATFORM_INCOME_OWNER_FAULT = 50;
const PLATFORM_INCOME_COMPLETION = BOOKING_FEE_AMOUNT - COMP_AMOUNT;
const SETTLEMENT_VERSION = "v8b";

function json(status: number, body: unknown) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}


async function logBookingAudit(args: {
  booking_id: string;
  actor_role: "borrower" | "owner" | "admin" | "system";
  actor_user_id: string | null;
  action: string;
  note?: string | null;
}) {
  // Best-effort audit log. Never fail the settlement if audit logging fails.
  try {
    const { booking_id, actor_role, actor_user_id, action, note } = args;
    await supabase.from("booking_audit_log").insert([{
      booking_id,
      actor_role,
      actor_user_id,
      action,
      note: note ?? null,
      created_at: new Date().toISOString(),
    }]);
  } catch (e) {
    console.error("booking_audit_log insert failed (ignored):", e);
  }
}

async function ensurePaymentDue(args: {
  booking_id: string;
  payment_type: "owner_payout" | "borrower_compensation";
  amount: number;
  borrower_id: string;
  owner_id: string;
}) {
  const { booking_id, payment_type, amount, borrower_id, owner_id } = args;

  const { data: existing, error: exErr } = await supabase
    .from("payments")
    .select("id,status")
    .eq("booking_id", booking_id)
    .eq("payment_type", payment_type)
    .in("status", ["payout_due", "paid"])
    .limit(1);

  if (exErr) throw exErr;
  if (existing && existing.length) return { created: false };

  const { error: insErr } = await supabase.from("payments").insert([{
    booking_id,
    payment_type,
    status: "payout_due",
    amount,
    currency: "CAD",
    borrower_id,
    owner_id,
    payout_paid_at: null,
    payout_method: null,
    payout_reference: null,
  }]);

  if (insErr) throw insErr;
  return { created: true };
}

async function ensurePlatformIncomePaid(args: {
  booking_id: string;
  amount: number;
  borrower_id: string;
  owner_id: string;
}) {
  const { booking_id, amount, borrower_id, owner_id } = args;

  const { data: existing, error: exErr } = await supabase
    .from("payments")
    .select("id,status")
    .eq("booking_id", booking_id)
    .eq("payment_type", "platform_income_cancel_fee")
    .eq("status", "paid")
    .limit(1);

  if (exErr) throw exErr;
  if (existing && existing.length) return { created: false };

  const { error: insErr } = await supabase.from("payments").insert([{
    booking_id,
    payment_type: "platform_income_cancel_fee",
    status: "paid",
    amount,
    currency: "CAD",
    borrower_id,
    owner_id,
    method: "internal",
    meta: { source: "settle-booking", kind: "platform_income" },
  }]);

  if (insErr) throw insErr;
  return { created: true };
}


async function ensurePlatformIncomeCompletionPaid(args: {
  booking_id: string;
  amount: number;
  borrower_id: string;
  owner_id: string;
}) {
  const { booking_id, amount, borrower_id, owner_id } = args;

  const { data: existing, error: exErr } = await supabase
    .from("payments")
    .select("id,status")
    .eq("booking_id", booking_id)
    .eq("payment_type", "platform_income_completion")
    .eq("status", "paid")
    .limit(1);

  if (exErr) throw exErr;
  if (existing && existing.length) return { created: false };

  const { error: insErr } = await supabase.from("payments").insert([{
    booking_id,
    payment_type: "platform_income_completion",
    status: "paid",
    amount,
    currency: "CAD",
    borrower_id,
    owner_id,
    method: "internal",
    meta: { source: "settle-booking", kind: "platform_income_completion", settlement_version: SETTLEMENT_VERSION },
  }]);

  if (insErr) throw insErr;
  return { created: true };
}

async function ensureCreditAvailable(args: {
  user_id: string;
  credit_type: string;
  amount: number;
  booking_id: string;
  reason: string;
}) {
  const { user_id, credit_type, amount, booking_id, reason } = args;

  // 1) If a credit already exists for this booking+type, reuse it (idempotent behavior)
  const { data: existingByBooking, error: e1 } = await supabase
    .from("credits")
    .select("id,status")
    .eq("booking_id", booking_id)
    .eq("credit_type", credit_type)
    .limit(1);

  if (e1) throw new Error(`credits lookup failed: ${e1.message}`);

  if (existingByBooking && existingByBooking.length > 0) {
    return { created: false, id: existingByBooking[0].id };
  }

  // 2) Some credits are globally unique while 'available' (e.g. uniq_credits_available_once on user_id+credit_type+reason).
  // If an available credit already exists for this user/type/reason, reuse it to avoid unique constraint violations.
  const { data: existingAvailable, error: e1b } = await supabase
    .from("credits")
    .select("id,status")
    .eq("user_id", user_id)
    .eq("credit_type", credit_type)
    .eq("reason", reason)
    .eq("status", "available")
    .limit(1);

  if (e1b) throw new Error(`credits lookup failed: ${e1b.message}`);

  if (existingAvailable && existingAvailable.length > 0) {
    return { created: false, id: existingAvailable[0].id };
  }

  const { data: inserted, error: e2 } = await supabase
    .from("credits")
    .insert([
      {
        user_id,
        credit_type,
        amount,
        status: "available",
        booking_id,
        reason,
      },
    ])
    .select("id")
    .single();

  if (e2) throw new Error(`credit insert failed: ${e2.message}`);

  return { created: true, id: inserted.id };
}

function cents(amount: number): number {
  return Math.round(amount * 100);
}

async function stripeRefundPartial(
  stripeKey: string,
  paymentIntentId: string,
  amountCents: number,
  idempotencyKey: string,
) {
  const stripe = new Stripe(stripeKey, { apiVersion: "2023-10-16" });
  const refund = await stripe.refunds.create(
    { payment_intent: paymentIntentId, amount: amountCents },
    { idempotencyKey },
  );
  return refund;
}

async function findOwnerDepositPaymentIntent(booking_id: string): Promise<string | null> {
  const { data, error } = await supabase
    .from("payments")
    .select("stripe_payment_intent_id, stripe_id, created_at")
    .eq("booking_id", booking_id)
    .eq("payment_type", "owner_deposit")
    .order("created_at", { ascending: false })
    .limit(1);

  if (error) {
    console.error("findOwnerDepositPaymentIntent error:", error);
    return null;
  }

  const row: any = (data && data.length) ? data[0] : null;
  const pi = row?.stripe_payment_intent_id ?? row?.stripe_id ?? null;
  return pi ? String(pi) : null;
}

async function returnOwnerDeposit(args: {
  booking_id: string;
  owner_id: string;
  depositChoice: string | null;
  reasonOverride?: string | null;
}) {
  const { booking_id, owner_id, depositChoice, reasonOverride } = args;

  // NOTE: This helper is used by multiple settlement scenarios.
  // The default reason is the historical happy-path text, but scenarios like force majeure
  // should override it to keep audit/SQL readable.
  const creditReason = (reasonOverride ?? "Owner deposit held on platform after happy-path settlement").toString();

  // Default behavior: KEEP on-platform unless explicitly set to "refund"
  const normalizedChoice =
    (depositChoice ?? "keep").toString().trim().toLowerCase();

  // Grab the deposit payment row so we can refund the right payment intent (if needed)
  const { data: depPay, error: depErr } = await supabase
    .from("payments")
    .select("id, amount, currency, stripe_payment_intent_id, stripe_id, refund_id, refund_status, refunded_amount_cents")
    .eq("booking_id", booking_id)
    .eq("payment_type", "owner_deposit")
    .maybeSingle();

  if (depErr) {
    return { ok: false, error: "Failed to load owner_deposit payment", details: depErr.message };
  }

  // If there is no deposit payment row, nothing to return.
  if (!depPay) {
    return { ok: true, method: "none", message: "No owner_deposit payment row found" };
  }

  // ---------- KEEP (credit) path ----------
  if (normalizedChoice !== "refund") {
    const creditRow = await ensureCreditAvailable({
      user_id: owner_id,
      credit_type: "OWNER_DEPOSIT_HELD",
      amount: OWNER_DEPOSIT_AMOUNT,
      booking_id,
      reason: creditReason,
    });

    return {
      ok: true,
      method: "credit",
      credit_id: creditRow.id,
      amount: OWNER_DEPOSIT_AMOUNT, 
      currency: "CAD",
    };
  }

  // ---------- REFUND path ----------
  const pi = (depPay.stripe_payment_intent_id ?? "").toString().trim();
  const stripeFallback = (depPay.stripe_id ?? "").toString().trim();

  // If we don't have a PaymentIntent id OR the Stripe secret isn't present,
  // fall back to credit so funds are not stuck in limbo.
  if (!pi || !stripeSecretKey) {
    const creditRow = await ensureCreditAvailable({
      user_id: owner_id,
      credit_type: "OWNER_DEPOSIT_HELD",
      amount: OWNER_DEPOSIT_AMOUNT,
      booking_id,
      reason: creditReason,
    });

    return {
      ok: true,
      method: "credit_fallback",
      credit_id: creditRow.id,
      amount: OWNER_DEPOSIT_AMOUNT,
      currency: "CAD",
      warning: !pi
        ? "owner_deposit payment_intent missing (webhook may not have populated it yet)"
        : "stripeSecretKey missing; cannot refund via Stripe",
      debug: { has_pi: !!pi, stripe_id_present: !!stripeFallback },
    };
  }

  const stripe = new Stripe(stripeSecretKey, { apiVersion: "2023-10-16" });

  try {
    // Idempotency: if a refund already exists, don't create another
    if (depPay.refund_id) {
      return {
        ok: true,
        method: "refund",
        refund_id: depPay.refund_id,
        refund_status: depPay.refund_status,
        refunded_amount_cents: depPay.refunded_amount_cents,
      };
    }

    const refund = await stripe.refunds.create({
      payment_intent: pi,
      reason: "requested_by_customer",
      metadata: { booking_id, payment_type: "owner_deposit_refund" },
    });

    // Persist refund reference on the payments row (audit trail)
    await supabase
      .from("payments")
      .update({
        refund_id: refund.id,
        refund_status: refund.status ?? "created",
        refunded_amount_cents: refund.amount ?? OWNER_DEPOSIT_AMOUNT * 100,
      })
      .eq("id", depPay.id);

    return {
      ok: true,
      method: "refund",
      refund_id: refund.id,
      refund_status: refund.status,
      refunded_amount_cents: refund.amount,
    };
  } catch (e) {
    // Critical resiliency: if refund fails, fall back to on-platform credit
    const creditRow = await ensureCreditAvailable({
      user_id: owner_id,
      credit_type: "OWNER_DEPOSIT_HELD",
      amount: OWNER_DEPOSIT_AMOUNT,
      booking_id,
      reason: creditReason,
    });

    return {
      ok: true,
      method: "credit_fallback",
      credit_id: creditRow.id,
      amount: OWNER_DEPOSIT_AMOUNT,
      currency: "CAD",
      warning: "Stripe refund failed; deposit held as platform credit instead",
      stripe_error: String(e),
      debug: { pi_present: !!pi, stripe_id_present: !!stripeFallback },
    };
  }
}


async function loadEmailContext(args: {
  borrower_id: string;
  owner_id: string;
  bike_id?: string | null;
}) {
  const { borrower_id, owner_id, bike_id } = args;

  const { data: borrower } = await supabase
    .from("users")
    .select("id, first_name, full_name, email")
    .eq("id", borrower_id)
    .maybeSingle();

  const { data: owner } = await supabase
    .from("users")
    .select("id, first_name, full_name, email")
    .eq("id", owner_id)
    .maybeSingle();

  let bike: any = null;
  if (bike_id) {
    const { data } = await supabase
      .from("bikes")
      .select("id, title, make, model, year, province")
      .eq("id", bike_id)
      .maybeSingle();
    bike = data ?? null;
  }

  return { borrower, owner, bike };
}

function displayName(user: any) {
  return user?.first_name?.trim() || user?.full_name?.trim() || "there";
}

function bikeLabel(bike: any) {
  if (!bike) return "your booking";
  return (
    bike.title?.trim() ||
    [bike.year, bike.make, bike.model].filter(Boolean).join(" ") ||
    "your booking"
  );
}

async function sendSettlementEmailIfNeeded(args: {
  bookingId: string;
  userId: string | null;
  emailTo: string | null;
  notificationType: string;
  subject: string;
  html: string;
  meta?: Record<string, unknown>;
}) {
  const { bookingId, userId, emailTo, notificationType, subject, html, meta = {} } = args;

  if (!userId || !emailTo) return { skipped: true, reason: "missing-user-or-email" };

  const alreadySent = await hasNotificationBeenSent({
    supabase,
    bookingId,
    userId,
    notificationType,
  });

  if (alreadySent) return { skipped: true, reason: "already-sent" };

  await sendEmail({ to: emailTo, subject, html });

  await logNotificationSent({
    supabase,
    bookingId,
    userId,
    emailTo,
    notificationType,
    meta,
  });

  return { skipped: false };
}

serve(async (req: Request) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  if (req.method !== "POST") return json(405, { error: "Method not allowed" });

  let body: any;
  try {
    body = await req.json();
  } catch {
    return json(400, { error: "Invalid JSON body" });
  }

  const booking_id = body?.booking_id;
  if (!booking_id) return json(400, { error: "booking_id is required" });

  // 1) Load booking
  const { data: booking, error: bErr } = await supabase
    .from("bookings")
    .select([
      "id",
      "bike_id",
      "borrower_id",
      "owner_id",
      "booking_date",
      "scheduled_start_at",
      "duration_minutes",
      "borrower_paid",
      "owner_deposit_paid",
      "stripe_payment_intent_id",
      "borrower_checked_in",
      "borrower_checked_in_at",
      "owner_checked_in",
      "owner_checked_in_at",
      "no_show_claimed_by",
      "no_show_claimed_at",
      "force_majeure_owner_agreed_at",
      "force_majeure_borrower_agreed_at",
      "borrower_no_show_at",
      "completed",
      "cancelled",
      "cancelled_by",
      "refund_status",
      "refund_amount_cents",
      "treat_as_owner_no_show",
      "treat_as_borrower_no_show",
      "bike_invalid",
      "bike_invalid_reason",
      "needs_review",
      "review_reason",
      "settled",
      "owner_deposit_choice",
    ].join(","))
    .eq("id", booking_id)
    .single();

  if (bErr || !booking) return json(404, { error: "Booking not found" });

  if (booking.settled) {
    return json(200, { ok: true, message: "Already settled", booking_id });
  }

  // If an admin (or system) has already set outcome flags, we can settle deterministically
  // without requiring a client to pass claim_no_show payload again.
  // - treat_as_borrower_no_show => owner is the claimant (borrower is offender)
  // - treat_as_owner_no_show    => borrower is the claimant (owner is offender)
  if (!body?.claim_no_show && (booking.treat_as_borrower_no_show || booking.treat_as_owner_no_show)) {
    body = {
      ...body,
      claim_no_show: true,
      claimant_role: booking.treat_as_owner_no_show ? "borrower" : "owner",
      _auto_from_flags: true,
    };
  }

  const { borrower, owner, bike } = await loadEmailContext({
    borrower_id: booking.borrower_id,
    owner_id: booking.owner_id,
    bike_id: booking.bike_id,
  });

  const bookingDateText = formatBookingTime(
    booking.scheduled_start_at || booking.booking_date,
    bike?.province ?? "AB",
  );

  const borrowerName = displayName(borrower);
  const ownerName = displayName(owner);
  const bikeText = bikeLabel(bike);


  // Basic guards: must have both payments and completed flag (happy path uses completed)
  if (!booking.borrower_paid || !booking.owner_deposit_paid) {
    return json(400, { error: "Cannot settle; missing payments", borrower_paid: booking.borrower_paid, owner_deposit_paid: booking.owner_deposit_paid });
  }

  // Determine settlement scenario
  const isHappyPath = !!booking.completed && !booking.cancelled && !booking.needs_review && !booking.bike_invalid;
  const isOwnerFault = !!booking.bike_invalid; // your earlier logic may also classify owner fault; keep existing field
  const isBorrowerFault = !booking.bike_invalid && (String((booking as any).review_reason ?? "").trim().toLowerCase() === "borrower_fault") && !booking.cancelled && !booking.completed;

  
  const isForceMajeure = !!(booking as any).force_majeure_borrower_agreed_at && !!(booking as any).force_majeure_owner_agreed_at && !booking.cancelled && !booking.completed && !booking.bike_invalid && !booking.borrower_checked_in && !booking.owner_checked_in;
// No-show claim path (time-gated + check-in gated)
  const claimNoShow = body?.claim_no_show === true;
  const claimantRoleRaw = (body?.claimant_role ?? "").toString().trim().toLowerCase();
  const claimant_role = (claimantRoleRaw === "owner" || claimantRoleRaw === "borrower") ? (claimantRoleRaw as "owner" | "borrower") : null;

  if (claimNoShow) {
    if (!claimant_role) {
      return json(400, { error: "claimant_role must be 'owner' or 'borrower'" });
    }

    // Guards
    const startAtIso = (booking.booking_date ?? booking.scheduled_start_at) as string;
    const startAt = startAtIso ? new Date(startAtIso) : null;
    if (!startAt || Number.isNaN(startAt.getTime())) {
      return json(400, { error: "Invalid booking start time; cannot evaluate no-show claim" });
    }

    const now = new Date();
    const msSinceStart = now.getTime() - startAt.getTime();
    const minutesSinceStart = msSinceStart / 60000;

    // Must be >= 10 minutes after scheduled start
    if (minutesSinceStart < 10) {
      return json(400, { error: "No-show claim not available yet", minutesSinceStart });
    }

    const ownerCheckedIn = !!booking.owner_checked_in;
    const borrowerCheckedIn = !!booking.borrower_checked_in;

    // claimant must have checked in; other party must NOT have checked in
    if (claimant_role === "owner") {
      if (!ownerCheckedIn || borrowerCheckedIn) {
        return json(400, { error: "No-show claim not valid for this booking state", ownerCheckedIn, borrowerCheckedIn });
      }
    } else {
      if (!borrowerCheckedIn || ownerCheckedIn) {
        return json(400, { error: "No-show claim not valid for this booking state", ownerCheckedIn, borrowerCheckedIn });
      }
    }

    // Must have both payments in escrow
    if (!booking.borrower_paid || !booking.owner_deposit_paid) {
      return json(400, {
        error: "Cannot settle no-show; missing payments",
        borrower_paid: booking.borrower_paid,
        owner_deposit_paid: booking.owner_deposit_paid,
      });
    }

    // Compute outcome:
    // - Offending party forfeits THEIR payment (borrower fee or owner deposit).
    // - $50 platform income, $100 compensation to non-offending party.
    // - Non-offending party gets THEIR own payment back (owner deposit return choice, borrower fee via refund/credit).
    const platformIncome = 50;
    const compensation = 100;

    if (claimant_role === "owner") {
      // Borrower no-show: borrower fee is forfeited -> split 50 platform + 100 owner compensation.
      await ensurePlatformIncomePaid({ booking_id, amount: platformIncome, borrower_id: booking.borrower_id, owner_id: booking.owner_id });
      const compPayout = await ensurePaymentDue({
        booking_id,
        payment_type: "owner_payout",
        amount: compensation,
        borrower_id: booking.borrower_id,
        owner_id: booking.owner_id,
      });

      // Return/hold owner's deposit based on choice (refund or keep credit)
      const ownerDepositReturn = await returnOwnerDeposit({
        booking_id,
        owner_id: booking.owner_id,
        depositChoice: "keep",
        reasonOverride: "Owner deposit returned after borrower no-show settlement",
      });

      await supabase.from("bookings").update({
        settled: true,
        settled_at: now.toISOString(),
        settlement_outcome: "borrower_no_show",
        settlement_version: SETTLEMENT_VERSION,
        no_show_claimed_by: "owner",
        no_show_claimed_at: now.toISOString(),
        treat_as_borrower_no_show: true,
        treat_as_owner_no_show: false,
        borrower_no_show_at: now.toISOString(),
        needs_review: false,
        review_reason: null,
      }).eq("id", booking_id);

      await logBookingAudit({
        booking_id,
        actor_role: "owner",
        actor_user_id: booking.owner_id,
        action: "no_show_claim_owner_vs_borrower",
        note: `borrower_no_show; platformIncome=${platformIncome}; ownerComp=${compensation}`,
      });

      await sendSettlementEmailIfNeeded({
        bookingId: booking_id,
        userId: borrower?.id ?? null,
        emailTo: borrower?.email ?? null,
        notificationType: "settled_borrower_no_show_borrower",
        subject: "Your BorrowMyBike booking was settled as a no-show",
        html: `
          <div style="font-family:Arial,Helvetica,sans-serif;line-height:1.5;color:#0f172a">
            <p>Hi ${borrowerName},</p>
            <p>Your booking was settled as a borrower no-show under the platform rules.</p>
            <p><strong>Booking:</strong> ${bikeText}<br><strong>Scheduled time:</strong> ${bookingDateText}</p>
            <p>Your booking fee was forfeited as part of this outcome.</p>
            <p>If you believe this settlement was made in error, please reply to this email or contact support@borrowmybike.ca to dispute it.</p>
          </div>
        `,
        meta: { source: "settle-booking", scenario: "borrower_no_show", role: "borrower" },
      });

      await sendSettlementEmailIfNeeded({
        bookingId: booking_id,
        userId: owner?.id ?? null,
        emailTo: owner?.email ?? null,
        notificationType: "settled_borrower_no_show_owner",
        subject: "Your BorrowMyBike compensation has been recorded",
        html: `
          <div style="font-family:Arial,Helvetica,sans-serif;line-height:1.5;color:#0f172a">
            <p>Hi ${ownerName},</p>
            <p>This booking was settled as a borrower no-show.</p>
            <p><strong>Booking:</strong> ${bikeText}<br><strong>Scheduled time:</strong> ${bookingDateText}</p>
            <p>Your compensation payout has been recorded and is being processed.</p>
            <p>Thank you for showing up prepared. We’d love to have you accept more bookings.</p>
            <p>
              <a href="https://borrowmybike.ca/dashboard" style="display:inline-block;padding:10px 14px;background:#0b1f3b;color:#ffffff;text-decoration:none;border-radius:8px;font-weight:700;">
                View dashboard
              </a>
            </p>
          </div>
        `,
        meta: { source: "settle-booking", scenario: "borrower_no_show", role: "owner" },
      });

      return json(200, {
        ok: true,
        booking_id,
        scenario: "borrower_no_show",
        platformIncome,
        compensation_to_owner_payout_due: compPayout,
        owner_deposit_return: ownerDepositReturn,
        platform_income: platformIncome,
      });
    } else {
      // Owner no-show: owner deposit is forfeited -> split 50 platform + 100 borrower compensation.
      await ensurePlatformIncomePaid({ booking_id, amount: platformIncome, borrower_id: booking.borrower_id, owner_id: booking.owner_id });

      // Borrower compensation as payout_due (short-term e-transfer payouts until Stripe Connect)
      const compPayout = await ensurePaymentDue({
        booking_id,
        payment_type: "borrower_compensation",
        amount: compensation,
        borrower_id: booking.borrower_id,
        owner_id: booking.owner_id,
      });

      // Return borrower booking fee as platform credit (no Stripe refunds in no-show scenarios)
      const borrowerRefundResult: any = { performed: true, via: "credit", stripe_refund_id: null };

      await ensureCreditAvailable({
        user_id: booking.borrower_id,
        credit_type: "rebook_credit",
        amount: BOOKING_FEE_AMOUNT,
        booking_id,
        reason: "Owner no-show: booking fee returned as credit",
      });

      await supabase.from("bookings").update({
        settled: true,
        settled_at: now.toISOString(),
        settlement_outcome: "owner_no_show",
        settlement_version: SETTLEMENT_VERSION,
        no_show_claimed_by: "borrower",
        no_show_claimed_at: now.toISOString(),
        treat_as_owner_no_show: true,
        treat_as_borrower_no_show: false,
        needs_review: false,
        review_reason: null,
      }).eq("id", booking_id);

      await logBookingAudit({
        booking_id,
        actor_role: "borrower",
        actor_user_id: booking.borrower_id,
        action: "no_show_claim_borrower_vs_owner",
        note: `owner_no_show; platformIncome=${platformIncome}; borrowerComp=${compensation}; bookingFeeReturn=${borrowerRefundResult.via}`,
      });

      await sendSettlementEmailIfNeeded({
        bookingId: booking_id,
        userId: owner?.id ?? null,
        emailTo: owner?.email ?? null,
        notificationType: "settled_owner_no_show_owner",
        subject: "Your BorrowMyBike booking was settled as a no-show",
        html: `
          <div style="font-family:Arial,Helvetica,sans-serif;line-height:1.5;color:#0f172a">
            <p>Hi ${ownerName},</p>
            <p>Your booking was settled as an owner no-show under the platform rules.</p>
            <p><strong>Booking:</strong> ${bikeText}<br><strong>Scheduled time:</strong> ${bookingDateText}</p>
            <p>The applicable penalty has been recorded under the platform settlement rules.</p>
            <p>If you believe this settlement was made in error, please reply to this email or contact support@borrowmybike.ca to dispute it.</p>
          </div>
        `,
        meta: { source: "settle-booking", scenario: "owner_no_show", role: "owner" },
      });

      await sendSettlementEmailIfNeeded({
        bookingId: booking_id,
        userId: borrower?.id ?? null,
        emailTo: borrower?.email ?? null,
        notificationType: "settled_owner_no_show_borrower",
        subject: "You’ve been compensated for your BorrowMyBike booking",
        html: `
          <div style="font-family:Arial,Helvetica,sans-serif;line-height:1.5;color:#0f172a">
            <p>Hi ${borrowerName},</p>
            <p>Your booking was settled as an owner no-show.</p>
            <p><strong>Booking:</strong> ${bikeText}<br><strong>Scheduled time:</strong> ${bookingDateText}</p>
            <p>You have been issued a $150 rebook credit for your booking fee, and your $100 compensation payout has been recorded and is being processed.</p>
            <p>
              <a href="https://borrowmybike.ca/browse" style="display:inline-block;padding:10px 14px;background:#0b1f3b;color:#ffffff;text-decoration:none;border-radius:8px;font-weight:700;">
                Find another bike
              </a>
            </p>
            <p>If you have any questions, contact support@borrowmybike.ca.</p>
          </div>
        `,
        meta: { source: "settle-booking", scenario: "owner_no_show", role: "borrower" },
      });

      return json(200, {
        ok: true,
        booking_id,
        scenario: "owner_no_show",
        platformIncome,
        borrower_compensation_payout_due: compPayout,
        borrower_fee_return: borrowerRefundResult,
      });
    }
  }


  try {
    // Happy path: pay owner $100, return/hold deposit, record platform income completion
    if (isHappyPath) {
      const payout = await ensurePaymentDue({
        booking_id,
        payment_type: "owner_payout",
        amount: COMP_AMOUNT,
        borrower_id: booking.borrower_id,
        owner_id: booking.owner_id,
      });

      const ownerDepositReturn = await returnOwnerDeposit({
        booking_id,
        owner_id: booking.owner_id,
        depositChoice: booking.owner_deposit_choice,
      });


      // Record platform income on completion (idempotent)
      const platformIncome = await ensurePlatformIncomeCompletionPaid({
        booking_id,
        amount: PLATFORM_INCOME_COMPLETION,
        borrower_id: booking.borrower_id,
        owner_id: booking.owner_id,
      });


      const { error: upErr } = await supabase
        .from("bookings")
        .update({
          settled: true,
          settled_at: new Date().toISOString(),
          settlement_outcome: "happy_path",
          settlement_version: SETTLEMENT_VERSION,
        })
        .eq("id", booking_id);

      if (upErr) throw upErr;

      await sendSettlementEmailIfNeeded({
        bookingId: booking_id,
        userId: borrower?.id ?? null,
        emailTo: borrower?.email ?? null,
        notificationType: "settled_happy_path_borrower",
        subject: "Thanks for using BorrowMyBike",
        html: `
          <div style="font-family:Arial,Helvetica,sans-serif;line-height:1.5;color:#0f172a">
            <p>Hi ${borrowerName},</p>
            <p>Thank you for using BorrowMyBike for your road test booking.</p>
            <p><strong>Booking:</strong> ${bikeText}<br><strong>Scheduled time:</strong> ${bookingDateText}</p>
            <p>If you passed and now have, or plan to have, a road-test-ready motorcycle, consider joining BorrowMyBike as a mentor to help others and offset some of the cost of your bike.</p>
            <p>
              <a href="https://borrowmybike.ca/become-a-mentor" style="display:inline-block;padding:10px 14px;background:#0b1f3b;color:#ffffff;text-decoration:none;border-radius:8px;font-weight:700;">
                Become a mentor
              </a>
            </p>
            <p>If you have any questions, contact support@borrowmybike.ca.</p>
          </div>
        `,
        meta: { source: "settle-booking", scenario: "happy_path", role: "borrower" },
      });

      await sendSettlementEmailIfNeeded({
        bookingId: booking_id,
        userId: owner?.id ?? null,
        emailTo: owner?.email ?? null,
        notificationType: "settled_happy_path_owner",
        subject: "Your BorrowMyBike payout has been recorded",
        html: `
          <div style="font-family:Arial,Helvetica,sans-serif;line-height:1.5;color:#0f172a">
            <p>Hi ${ownerName},</p>
            <p>Thank you for completing your BorrowMyBike booking.</p>
            <p><strong>Booking:</strong> ${bikeText}<br><strong>Scheduled time:</strong> ${bookingDateText}</p>
            <p>Your payout has been recorded and is being processed according to the platform payout method currently on file.</p>
            <p>We’d love to have you accept another booking when your bike is available.</p>
            <p>
              <a href="https://borrowmybike.ca/dashboard" style="display:inline-block;padding:10px 14px;background:#0b1f3b;color:#ffffff;text-decoration:none;border-radius:8px;font-weight:700;">
                View dashboard
              </a>
            </p>
            <p>If you have any questions, contact support@borrowmybike.ca.</p>
          </div>
        `,
        meta: { source: "settle-booking", scenario: "happy_path", role: "owner" },
      });

      return json(200, {
        ok: true,
        booking_id,
        scenario: "happy_path",
        payout,
        owner_deposit_return: ownerDepositReturn,
        platform_income: platformIncome,
      });
    }

    // Owner fault: borrower gets booking fee back as credit + $100 compensation.
    // Platform keeps $50. Owner loses deposit.
    if (isOwnerFault) {
      const borrowerFeeReturn = await ensureCreditAvailable({
        user_id: booking.borrower_id,
        credit_type: "rebook_credit",
        amount: BOOKING_FEE_AMOUNT,
        booking_id,
        reason: "Owner fault: booking fee returned as credit",
      });

      const borrowerCompensation = await ensurePaymentDue({
        booking_id,
        payment_type: "borrower_compensation",
        amount: COMP_AMOUNT,
        borrower_id: booking.borrower_id,
        owner_id: booking.owner_id,
      });

      const platformIncome = await ensurePlatformIncomePaid({
        booking_id,
        amount: PLATFORM_INCOME_OWNER_FAULT,
        borrower_id: booking.borrower_id,
        owner_id: booking.owner_id,
      });

      const { error: upErr } = await supabase
        .from("bookings")
        .update({
          settled: true,
          settled_at: new Date().toISOString(),
          settlement_outcome: "owner_fault",
          settlement_version: SETTLEMENT_VERSION,
          needs_review: false,
          review_reason: "owner_fault",
          treat_as_owner_no_show: false,
          treat_as_borrower_no_show: false,
        })
        .eq("id", booking_id);

      if (upErr) throw upErr;

      await logBookingAudit({
        booking_id,
        actor_role: "system",
        actor_user_id: booking.owner_id,
        action: "settle_owner_fault",
        note: `owner_fault; borrowerFeeReturn=credit; borrowerComp=${COMP_AMOUNT}; platformIncome=${PLATFORM_INCOME_OWNER_FAULT}; ownerDepositReturn=forfeited`,
      });

      await sendSettlementEmailIfNeeded({
        bookingId: booking_id,
        userId: owner?.id ?? null,
        emailTo: owner?.email ?? null,
        notificationType: "settled_owner_fault_owner",
        subject: "Your BorrowMyBike booking was settled as a mentor issue",
        html: `
          <div style="font-family:Arial,Helvetica,sans-serif;line-height:1.5;color:#0f172a">
            <p>Hi ${ownerName},</p>
            <p>Your booking was settled as an owner/mentor fault under the platform rules.</p>
            <p><strong>Booking:</strong> ${bikeText}<br><strong>Scheduled time:</strong> ${bookingDateText}</p>
            <p>Your deposit was forfeited and the applicable platform outcome has been recorded for this booking.</p>
            <p>If you believe this settlement was made in error, please reply to this email or contact support@borrowmybike.ca to dispute it.</p>
          </div>
        `,
        meta: { source: "settle-booking", scenario: "owner_fault", role: "owner" },
      });

      await sendSettlementEmailIfNeeded({
        bookingId: booking_id,
        userId: borrower?.id ?? null,
        emailTo: borrower?.email ?? null,
        notificationType: "settled_owner_fault_borrower",
        subject: "Your BorrowMyBike booking was resolved",
        html: `
          <div style="font-family:Arial,Helvetica,sans-serif;line-height:1.5;color:#0f172a">
            <p>Hi ${borrowerName},</p>
            <p>Your booking was settled as an owner/mentor fault.</p>
            <p><strong>Booking:</strong> ${bikeText}<br><strong>Scheduled time:</strong> ${bookingDateText}</p>
            <p>You have been issued a $150 rebook credit for your booking fee, and your $100 compensation payout has been recorded and is being processed.</p>
            <p>If you need another bike, you can browse and submit a new request when ready.</p>
            <p>
              <a href="https://borrowmybike.ca/browse" style="display:inline-block;padding:10px 14px;background:#0b1f3b;color:#ffffff;text-decoration:none;border-radius:8px;font-weight:700;">
                Find another bike
              </a>
            </p>
            <p>If you have any questions, contact support@borrowmybike.ca.</p>
          </div>
        `,
        meta: { source: "settle-booking", scenario: "owner_fault", role: "borrower", fee_return_via: "credit" },
      });

      return json(200, {
        ok: true,
        booking_id,
        scenario: "owner_fault",
        borrower_fee_return: { performed: true, via: "credit", credit_id: borrowerFeeReturn.id },
        borrower_compensation_payout_due: borrowerCompensation,
        owner_deposit_return: { performed: false, method: "forfeited" },
        platform_income: platformIncome,
      });
    }

// Borrower fault: borrower forfeits booking fee -> split $50 platform income + $100 owner payout_due.
// Non-offending owner gets their deposit returned as platform credit (no Stripe refund for fault scenarios).
if (isBorrowerFault) {
  const platformIncome = 50;
  const compensation = 100;

  await ensurePlatformIncomePaid({
    booking_id,
    amount: platformIncome,
    borrower_id: booking.borrower_id,
    owner_id: booking.owner_id,
  });

  const ownerPayout = await ensurePaymentDue({
    booking_id,
    payment_type: "owner_payout",
    amount: compensation,
    borrower_id: booking.borrower_id,
    owner_id: booking.owner_id,
  });

  const ownerDepositReturn = await returnOwnerDeposit({
    booking_id,
    owner_id: booking.owner_id,
    depositChoice: "keep",
    reasonOverride: "Owner deposit returned after borrower-fault settlement",
  });

  const { error: upErr } = await supabase
    .from("bookings")
    .update({
      settled: true,
      settled_at: new Date().toISOString(),
      settlement_outcome: "borrower_fault",
      settlement_version: SETTLEMENT_VERSION,
      needs_review: false,
      review_reason: "borrower_fault",
      treat_as_owner_no_show: false,
      treat_as_borrower_no_show: false,
    })
    .eq("id", booking_id);

  if (upErr) throw upErr;

  await logBookingAudit({
    booking_id,
    actor_role: "system",
    actor_user_id: booking.owner_id,
    action: "settle_borrower_fault",
    note: `borrower_fault; platformIncome=${platformIncome}; ownerPayoutDue=${compensation}; depositReturn=${ownerDepositReturn.method ?? ownerDepositReturn?.method ?? "credit"}`,
  });

  await sendSettlementEmailIfNeeded({
    bookingId: booking_id,
    userId: borrower?.id ?? null,
    emailTo: borrower?.email ?? null,
    notificationType: "settled_borrower_fault_borrower",
    subject: "Your BorrowMyBike booking was settled under the fault rules",
    html: `
      <div style="font-family:Arial,Helvetica,sans-serif;line-height:1.5;color:#0f172a">
        <p>Hi ${borrowerName},</p>
        <p>Your booking was settled as a borrower/test-taker fault under the platform rules.</p>
        <p><strong>Booking:</strong> ${bikeText}<br><strong>Scheduled time:</strong> ${bookingDateText}</p>
        <p>Your booking fee was forfeited as part of this outcome.</p>
        <p>If you believe this settlement was made in error, please reply to this email or contact support@borrowmybike.ca to dispute it.</p>
      </div>
    `,
    meta: { source: "settle-booking", scenario: "borrower_fault", role: "borrower" },
  });

  await sendSettlementEmailIfNeeded({
    bookingId: booking_id,
    userId: owner?.id ?? null,
    emailTo: owner?.email ?? null,
    notificationType: "settled_borrower_fault_owner",
    subject: "Your BorrowMyBike payout has been recorded",
    html: `
      <div style="font-family:Arial,Helvetica,sans-serif;line-height:1.5;color:#0f172a">
        <p>Hi ${ownerName},</p>
        <p>This booking was settled as a borrower/test-taker fault.</p>
        <p><strong>Booking:</strong> ${bikeText}<br><strong>Scheduled time:</strong> ${bookingDateText}</p>
        <p>Your payout has been recorded and is being processed. Your deposit return has also been recorded according to the current platform policy.</p>
        <p>Thank you for being prepared. We’d love to have you accept more bookings.</p>
        <p>
          <a href="https://borrowmybike.ca/dashboard" style="display:inline-block;padding:10px 14px;background:#0b1f3b;color:#ffffff;text-decoration:none;border-radius:8px;font-weight:700;">
            View dashboard
          </a>
        </p>
      </div>
    `,
    meta: { source: "settle-booking", scenario: "borrower_fault", role: "owner" },
  });

  return json(200, {
    ok: true,
    booking_id,
    scenario: "borrower_fault",
    platformIncome,
    owner_payout_payout_due: ownerPayout,
    owner_deposit_return: ownerDepositReturn,
  });
}


    // Force majeure: both parties agreed within window; no one penalized.
    // Both borrower fee and owner deposit are returned as PLATFORM CREDIT only. No platform income, no payout_due.
    if (isForceMajeure) {
      const startISO = (booking as any).scheduled_start_at || booking.booking_date;
      if (startISO) {
        const startAt = new Date(startISO);
        const now = new Date();
        if (now > startAt) {
          return json(400, { error: "Force majeure closed at start time", booking_id, now: now.toISOString(), start_at: startAt.toISOString() });
        }
      }
      // Return borrower fee as credit (idempotent)
      const borrowerCredit = await ensureCreditAvailable({
        user_id: booking.borrower_id,
        credit_type: "rebook_credit",
        amount: BOOKING_FEE_AMOUNT,
        booking_id,
        reason: "Force majeure: booking fee returned as credit",
      });

      // Return owner deposit as credit (always keep as credit for force majeure)
      const ownerDepositReturn = await returnOwnerDeposit({
        booking_id,
        owner_id: booking.owner_id,
        depositChoice: "keep",
        reasonOverride: "Force majeure: deposit returned as credit",
      });

      const { error: upErr } = await supabase
        .from("bookings")
        .update({
          settled: true,
          settled_at: new Date().toISOString(),
          settlement_outcome: "force_majeure",
        settlement_version: SETTLEMENT_VERSION,
          needs_review: false,
          review_reason: "force_majeure",
          treat_as_owner_no_show: false,
          treat_as_borrower_no_show: false,
        })
        .eq("id", booking_id);

      if (upErr) throw upErr;

      await logBookingAudit({
        booking_id,
        actor_role: "system",
        actor_user_id: booking.owner_id,
        action: "settle_force_majeure",
        note: "force_majeure; borrower fee + owner deposit returned as credit; no penalties",
      });

      return json(200, {
        ok: true,
        booking_id,
        scenario: "force_majeure",
        borrower_fee_return: { performed: true, via: "credit", credit_id: borrowerCredit?.id ?? null },
        owner_deposit_return: ownerDepositReturn,
        platform_income: null,
      });
    }
// Fallback: unsupported scenario
return json(400, {
  error: "Unsupported settlement scenario",
  booking_id,
  hint: "Only happy_path, owner_fault, borrower_fault, and claim_no_show are supported by this function.",
  note: "force_majeure is supported when both parties have agreed (force_majeure_*_agreed_at set) before any check-in.",
});
  } catch (e) {
    console.error("settle-booking error:", e);
    return json(500, { error: "Settlement failed", details: String(e) });
  }
});

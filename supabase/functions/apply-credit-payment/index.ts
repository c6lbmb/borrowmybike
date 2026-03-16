import { serve } from "https://deno.land/std@0.192.0/http/server.ts";
import { sendEmail } from "../_shared/sendEmail.ts";
import { hasNotificationBeenSent, logNotificationSent } from "../_shared/notificationLog.ts";
import { formatBookingTime } from "../_shared/formatBookingTime.ts";

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

function isAlreadyExistsError(msg: string | null | undefined) {
  const m = String(msg || "").toLowerCase();
  // Postgres unique violation
  return m.includes("duplicate key") || m.includes("already exists") || m.includes("23505");
}
function scheduledIsoFor(booking: {
  scheduled_start_at?: string | null;
  booking_date?: string | null;
}) {
  return booking.scheduled_start_at ?? booking.booking_date ?? null;
}

function acceptanceHoursForBooking(booking: { booking_date?: string | null; created_at?: string | null }) {
  const createdIso = booking?.created_at ?? null;
  const scheduledIso = scheduledIsoFor(booking);
  if (!createdIso || !scheduledIso) return 8;

  const created = new Date(createdIso);
  const scheduled = new Date(scheduledIso);
  if (isNaN(created.getTime()) || isNaN(scheduled.getTime())) return 8;

  const hoursBetween = (scheduled.getTime() - created.getTime()) / (1000 * 60 * 60);

  if (hoursBetween < 24) return 2;
  if (hoursBetween <= 72) return 4;
  return 8;
}

async function sendOwnerRequestEmailIfNeeded(supabase: any, bookingId: string) {
  const { data: booking, error: bookingError } = await supabase
    .from("bookings")
    .select("id, owner_id, borrower_id, booking_date, created_at")
    .eq("id", bookingId)
    .maybeSingle();

  if (bookingError) {
    console.error("❌ booking lookup failed:", bookingError);
    throw bookingError;
  }

  if (!booking?.owner_id) {
    console.warn("⚠️ booking missing owner_id, skipping email", { bookingId });
    return;
  }

  const { data: owner, error: ownerError } = await supabase
    .from("users")
    .select("id, first_name, full_name, email")
    .eq("id", booking.owner_id)
    .maybeSingle();

  if (ownerError) {
    console.error("❌ owner lookup failed:", ownerError);
    throw ownerError;
  }

  if (!owner?.email) {
    console.warn("⚠️ owner missing email, skipping email", { bookingId, ownerId: booking.owner_id });
    return;
  }

  const alreadySent = await hasNotificationBeenSent({
    supabase,
    bookingId: booking.id,
    userId: owner.id,
    notificationType: "booking_request_sent_to_owner",
  });

  if (alreadySent) {
    console.log("ℹ️ owner request email already sent, skipping", { bookingId, ownerId: owner.id });
    return;
  }

  const ownerName =
    owner.first_name?.trim() ||
    owner.full_name?.trim() ||
    "there";

   const bookingDateText = formatBookingTime(booking.booking_date, "AB");

  const acceptanceHours = acceptanceHoursForBooking(booking);

  await sendEmail({
    to: owner.email,
    subject: "New BorrowMyBike request",
    html: `
      <div style="font-family:Arial,Helvetica,sans-serif;line-height:1.5;color:#0f172a">
        <p>Hi ${ownerName},</p>

        <p>You have a new BorrowMyBike road-test request.</p>

        <p>
          <strong>Test time:</strong> ${bookingDateText}
        </p>

        <p>Please log in to review the request and decide whether to accept.</p>

        <p>
          <strong>Acceptance window:</strong> You now have ${acceptanceHours} hours to accept or decline this request before it expires automatically.
        </p>

        <p>
          <a href="https://borrowmybike.ca/dashboard" style="display:inline-block;padding:10px 14px;background:#0b1f3b;color:#ffffff;text-decoration:none;border-radius:8px;font-weight:700;">
            Review request
          </a>
        </p>

        <p>If you didn’t expect this email, contact support@borrowmybike.ca.</p>
      </div>
    `,
  });

  await logNotificationSent({
    supabase,
    bookingId: booking.id,
    userId: owner.id,
    emailTo: owner.email,
    notificationType: "booking_request_sent_to_owner",
    meta: {
      source: "apply-credit-payment",
      booking_date: booking.booking_date ?? null,
      acceptance_hours: acceptanceHours,
    },
  });
}

async function sendBorrowerAcceptedEmailIfNeeded(supabase: any, bookingId: string) {
  const { data: booking, error: bookingError } = await supabase
    .from("bookings")
    .select("id, owner_id, borrower_id, booking_date, scheduled_start_at")
    .eq("id", bookingId)
    .maybeSingle();

  if (bookingError) {
    console.error("❌ accepted-email booking lookup failed:", bookingError);
    throw bookingError;
  }

  if (!booking?.borrower_id) {
    console.warn("⚠️ booking missing borrower_id, skipping accepted email", { bookingId });
    return;
  }

  const { data: borrower, error: borrowerError } = await supabase
    .from("users")
    .select("id, first_name, full_name, email")
    .eq("id", booking.borrower_id)
    .maybeSingle();

  if (borrowerError) {
    console.error("❌ borrower lookup failed:", borrowerError);
    throw borrowerError;
  }

  if (!borrower?.email) {
    console.warn("⚠️ borrower missing email, skipping accepted email", {
      bookingId,
      borrowerId: booking.borrower_id,
    });
    return;
  }

  const alreadySent = await hasNotificationBeenSent({
    supabase,
    bookingId: booking.id,
    userId: borrower.id,
    notificationType: "booking_request_accepted_sent_to_borrower",
  });

  if (alreadySent) {
    console.log("ℹ️ borrower accepted email already sent, skipping", {
      bookingId,
      borrowerId: borrower.id,
    });
    return;
  }

  const borrowerName =
    borrower.first_name?.trim() ||
    borrower.full_name?.trim() ||
    "there";

  const bookingDateText = formatBookingTime(scheduledIsoFor(booking), "AB");

  await sendEmail({
    to: borrower.email,
    subject: "Your BorrowMyBike request was accepted",
    html: `
      <div style="font-family:Arial,Helvetica,sans-serif;line-height:1.5;color:#0f172a">
        <p>Hi ${borrowerName},</p>

        <p>Your BorrowMyBike request was accepted by the mentor.</p>

        <p>
          <strong>Test time:</strong> ${bookingDateText}
        </p>

        <p>Please review your booking details and prepare for your road test.</p>

        <p>
          <a href="https://borrowmybike.ca/dashboard" style="display:inline-block;padding:10px 14px;background:#0b1f3b;color:#ffffff;text-decoration:none;border-radius:8px;font-weight:700;">
            View booking
          </a>
        </p>

        <p>If you didn’t expect this email, contact support@borrowmybike.ca.</p>
      </div>
    `,
  });

  await logNotificationSent({
    supabase,
    bookingId: booking.id,
    userId: borrower.id,
    emailTo: borrower.email,
    notificationType: "booking_request_accepted_sent_to_borrower",
    meta: {
      source: "apply-credit-payment",
      booking_date: booking.booking_date ?? null,
    },
  });
}

serve(async (req: Request) => {
  if (req.method === "OPTIONS") return json(200, { ok: true });
  if (req.method !== "POST") return json(405, { error: "Only POST is allowed" });

  let body: any;
  try {
    body = await req.json();
  } catch {
    return json(400, { error: "Invalid JSON body" });
  }

  const booking_id = body?.booking_id;
  const actor = body?.actor; // "borrower" | "owner"

  if (!booking_id) return json(400, { error: "booking_id is required" });
  if (actor !== "borrower" && actor !== "owner") {
    return json(400, { error: "actor must be 'borrower' or 'owner'" });
  }

  const REQUIRED_AMOUNT = 150.0;
  const CURRENCY = "CAD";
  const payment_type = actor === "borrower" ? "borrower_credit" : "owner_credit";

  const supabaseUrl = Deno.env.get("MY_SUPABASE_URL");
  const serviceRoleKey = Deno.env.get("MY_SUPABASE_SERVICE_ROLE_KEY");
  if (!supabaseUrl || !serviceRoleKey) {
    return json(500, { error: "Missing MY_SUPABASE_URL or MY_SUPABASE_SERVICE_ROLE_KEY" });
  }

  const { createClient } = await import("https://esm.sh/@supabase/supabase-js@2.45.4");
  const supabase = createClient(supabaseUrl, serviceRoleKey);

  // 1) Load booking
  const { data: booking, error: bErr } = await supabase
    .from("bookings")
    .select("*")
    .eq("id", booking_id)
    .single();

  if (bErr || !booking) return json(404, { error: "Booking not found" });
  if (booking.cancelled) return json(400, { error: "Booking is cancelled" });
  if (booking.completed) return json(400, { error: "Booking already completed" });

  const user_id = actor === "borrower" ? booking.borrower_id : booking.owner_id;
  if (!user_id) return json(400, { error: `Booking missing ${actor}_id` });

  // 2) Fast idempotency: if payment already exists, ensure booking flags and return OK.
  const { data: existingPay, error: existingPayErr } = await supabase
    .from("payments")
    .select("id, status")
    .eq("booking_id", booking_id)
    .eq("payment_type", payment_type)
    .limit(1);

  if (!existingPayErr && existingPay?.length) {
    // Ensure booking paid flag is true (in case a previous call died after inserting payment)
    const patch: Record<string, any> = {};
    if (actor === "borrower" && !booking.borrower_paid) patch.borrower_paid = true;
    if (actor === "owner" && !booking.owner_deposit_paid) patch.owner_deposit_paid = true;

    if (Object.keys(patch).length) {
      await supabase.from("bookings").update(patch).eq("id", booking_id);
    }

    return json(200, {
      booking_id,
      actor,
      message: "Credit already applied ✅ (payment row already exists)",
      payment_type,
    });
  }

  // 3) Prevent re-paying (booking flags already set)
  if (actor === "borrower" && booking.borrower_paid) {
    return json(200, { booking_id, actor, message: "Borrower already marked paid ✅" });
  }
  if (actor === "owner" && booking.owner_deposit_paid) {
    return json(200, { booking_id, actor, message: "Owner deposit already marked paid ✅" });
  }

  // 4) PAYMENT CLAIM FIRST (atomicity hardening)
  // Create a "claim" row so we don't consume credits and then fail with no ledger row.
  // If this insert collides (unique constraint), treat as idempotent success.
  const { error: claimErr } = await supabase.from("payments").insert([{
    booking_id,
    currency: CURRENCY,
    payment_type,
    status: "initiated", // will flip to "succeeded" after credit consumption
    amount: REQUIRED_AMOUNT,
    method: "credit",
    meta: { source: "apply-credit-payment", actor },
    stripe_payment_intent_id: null,
    stripe_id: null,
    borrower_id: booking.borrower_id,
    owner_id: booking.owner_id,
    refund_id: null,
    refunded_amount_cents: null,
    refund_status: null,
  }]);

  if (claimErr) {
    if (isAlreadyExistsError(claimErr.message)) {
      // Another request created it first. Treat as idempotent.
      return json(200, {
        booking_id,
        actor,
        message: "Credit already applying/applied ✅ (payment claim already exists)",
        payment_type,
      });
    }
    return json(500, { error: "Failed to create payment claim row", details: claimErr.message });
  }

  // 5) Consume credits (RPC)
  const { data: rpcData, error: rpcErr } = await supabase.rpc("consume_credits", {
    p_user_id: user_id,
    p_booking_id: booking_id,
    p_amount: REQUIRED_AMOUNT,
    p_currency: CURRENCY,
  });

  if (rpcErr) {
    // Best-effort: remove the "initiated" claim row so you don't have dangling initiated payments.
    await supabase
      .from("payments")
      .delete()
      .eq("booking_id", booking_id)
      .eq("payment_type", payment_type)
      .eq("status", "initiated");

    return json(400, {
      error: "Credit consume failed",
      message: rpcErr.message,
    });
  }

  const row = Array.isArray(rpcData) ? rpcData[0] : rpcData;
  const used_credit_ids = row?.used_credit_ids ?? [];

  // 6) Mark payment as succeeded (idempotent)
  const { error: payUpdErr } = await supabase
    .from("payments")
    .update({ status: "succeeded" })
    .eq("booking_id", booking_id)
    .eq("payment_type", payment_type);

  if (payUpdErr) {
    // Not fatal: we already consumed credit. A retry will find payment row and fix booking flags.
    return json(500, {
      error: "Credits consumed but failed to mark payment succeeded",
      details: payUpdErr.message,
      booking_id,
      actor,
      used_credit_ids,
      payment_type,
    });
  }

  // 7) Update booking paid flags (idempotent)
  const patch: Record<string, any> = {};
  if (actor === "borrower") patch.borrower_paid = true;
  if (actor === "owner") patch.owner_deposit_paid = true;

  const { error: updErr } = await supabase.from("bookings").update(patch).eq("id", booking_id);

  if (updErr) {
    // Not fatal. Payment row exists; retry will fix booking flags.
    return json(500, {
      error: "Payment succeeded but failed to update booking paid flag(s)",
      details: updErr.message,
      booking_id,
      actor,
      used_credit_ids,
      payment_type,
    });
  }
  if (actor === "borrower") {
  try {
    await sendOwnerRequestEmailIfNeeded(supabase, booking_id);
  } catch (emailError) {
    console.error("❌ owner request email failed (credit path):", emailError);
  }
}

if (actor === "owner") {
  try {
    await sendBorrowerAcceptedEmailIfNeeded(supabase, booking_id);
  } catch (emailError) {
    console.error("❌ borrower accepted email failed (credit path):", emailError);
  }
}

  return json(200, {
    booking_id,
    actor,
    message: "Credit applied ✅ (atomic + idempotent)",
    used_credit_ids,
    payment_type,
    amount: REQUIRED_AMOUNT,
    currency: CURRENCY,
  });
});

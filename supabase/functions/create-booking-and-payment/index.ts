import { serve } from "https://deno.land/std@0.192.0/http/server.ts";
import { createClient } from "https://cdn.jsdelivr.net/npm/@supabase/supabase-js/+esm";
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
const stripeSecretKey = Deno.env.get("STRIPE_SECRET_KEY")!;
const FRONTEND_BASE_URL = Deno.env.get("FRONTEND_BASE_URL"); // require it

const supabase = createClient(supabaseUrl, serviceRoleKey);

const BORROWER_FEE = 150;

function json(status: number, body: unknown) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}

function cents(n: number) {
  return Math.round(n * 100);
}

function hasTimezone(iso: string) {
  return /Z$/.test(iso) || /[+-]\d{2}:\d{2}$/.test(iso);
}

async function findAvailableBorrowerCredit(borrower_id: string) {
  const { data, error } = await supabase
    .from("credits")
    .select("*")
    .eq("user_id", borrower_id)
    .eq("status", "available")
    .eq("credit_type", "rebook_credit")
    .gt("amount", 0)
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle();

  if (error) throw error;
  return data ?? null;
}

async function consumeUpToCreditRow(args: { creditRow: any; booking_id: string; need: number }) {
  const { creditRow, booking_id, need } = args;
  const creditAmount = Number(creditRow.amount ?? 0);
  const usedAmount = Math.min(need, creditAmount);
  const leftover = Math.max(0, creditAmount - usedAmount);
  const nowIso = new Date().toISOString();

  const { error: useErr } = await supabase
    .from("credits")
    .update({
      status: "used",
      used_at: nowIso,
      used_on_booking_id: booking_id,
    })
    .eq("id", creditRow.id)
    .eq("status", "available");

  if (useErr) throw useErr;

  if (leftover > 0.00001) {
    const { error: insErr } = await supabase.from("credits").insert([{
      user_id: creditRow.user_id,
      status: "available",
      credit_type: creditRow.credit_type,
      amount: leftover,
      currency: creditRow.currency ?? "CAD",
      reason: `Leftover credit reissued (partial use on booking ${booking_id})`,
      booking_id: null,
      expires_at: creditRow.expires_at ?? null,
    }]);
    if (insErr) throw insErr;
  }

  return { usedAmount, creditId: creditRow.id };
}
function scheduledIsoFor(booking: { booking_date?: string | null }) {
  return booking.booking_date ?? null;
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
      source: "create-booking-and-payment",
      booking_date: booking.booking_date ?? null,
      acceptance_hours: acceptanceHours,
    },
  });
}

serve(async (req: Request) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  if (req.method !== "POST") return json(405, { error: "Method not allowed" });

  if (!FRONTEND_BASE_URL) {
    return json(500, { error: "Missing FRONTEND_BASE_URL env var (set it to https://borrowmybike.ca)" });
  }

  let body: any;
  try {
    body = await req.json();
  } catch {
    return json(400, { error: "Invalid JSON body" });
  }

  const { borrower_id, owner_id, bike_id, booking_date, scheduled_start_at, duration_minutes, registry_id } = body ?? {};
  const {
    test_taker_intro,
    time_window,
    registry_quadrant,
  } = body ?? {};

  if (!borrower_id || !bike_id || !booking_date) {
    return json(400, { error: "borrower_id, bike_id, booking_date are required" });
  }

  const effectiveScheduledStart = scheduled_start_at ?? booking_date;
  const effectiveDuration = duration_minutes ?? 30;

  if (typeof booking_date !== "string" || !hasTimezone(booking_date)) {
    return json(400, { error: "booking_date must be ISO8601 with timezone (Z or ±HH:MM)", got: booking_date });
  }

  if (typeof effectiveScheduledStart !== "string" || !hasTimezone(effectiveScheduledStart)) {
    return json(400, { error: "scheduled_start_at must be ISO8601 with timezone (Z or ±HH:MM)", got: effectiveScheduledStart });
  }

  // 1) Create pending booking hold (RPC)
  const { data: booking, error: bookingErr } = await supabase.rpc("create_pending_booking", {
    p_borrower_id: borrower_id,
    p_owner_id: owner_id ?? null,
    p_bike_id: bike_id,
    p_booking_date: booking_date,
    p_scheduled_start_at: effectiveScheduledStart,
    p_duration_minutes: effectiveDuration,
    p_registry_id: registry_id ?? null,
  });

  if (bookingErr || !booking) {
    const msg = (bookingErr as any)?.message ?? "Failed to create booking";
    if (msg.toLowerCase().includes("slot not available")) return json(409, { error: "Slot not available" });
    return json(500, { error: "Failed to create pending booking", details: msg });
  }

  const bookingId = booking.id as string;

  // 1b) Optional: persist mentor-decision context (safe if columns don't exist yet)
  try {
    const intro = typeof test_taker_intro === "string" ? test_taker_intro.trim().slice(0, 240) : null;
    const twOk = ["morning", "early_afternoon", "late_afternoon"].includes(String(time_window));
    const quadOk = ["NE", "NW", "SE", "SW"].includes(String(registry_quadrant));

    const patch: any = {};
    if (intro) patch.test_taker_intro = intro;
    if (twOk) patch.time_window = String(time_window);
    if (quadOk) patch.registry_quadrant = String(registry_quadrant);

    if (Object.keys(patch).length) {
      const { error: upErr } = await supabase.from("bookings").update(patch).eq("id", bookingId);
      // Ignore "column does not exist" until migration is applied.
      if (upErr && !(String((upErr as any).message || "").toLowerCase().includes("column") && String((upErr as any).message || "").toLowerCase().includes("does not exist"))) {
        // Non-fatal: do not block payments.
        console.warn("Could not persist booking context:", (upErr as any).message);
      }
    }
  } catch {
    // ignore
  }

  // 2) Consume borrower credit (partial supported, leftover reissued)
  let creditApplied = 0;
  try {
    const creditRow = await findAvailableBorrowerCredit(borrower_id);
    if (creditRow) {
      const res = await consumeUpToCreditRow({ creditRow, booking_id: bookingId, need: BORROWER_FEE });
      creditApplied = res.usedAmount;

      if (creditApplied > 0) {
        // record one borrower_credit row (even if partial)
        await supabase.from("payments").insert([{
          booking_id: bookingId,
          borrower_id,
          owner_id: owner_id ?? null,
          payment_type: "borrower_credit",
          status: "succeeded",
          amount: creditApplied,
          currency: "CAD",
          method: "credit",
          meta: { source: "create-booking-and-payment", creditApplied },
        }]);
      }

     if (creditApplied >= BORROWER_FEE) {
  await supabase
    .from("bookings")
    .update({ borrower_paid: true, status: "confirmed", payment_expires_at: null })
    .eq("id", bookingId);

  try {
    await sendOwnerRequestEmailIfNeeded(supabase, bookingId);
  } catch (emailError) {
    console.error("❌ owner request email failed (credit-covered path):", emailError);
  }

  return json(200, {
    booking_id: bookingId,
    used_credit: true,
    credit_applied: creditApplied,
    amount_due: 0,
    checkout_url: null,
    stripe_checkout_session_id: null,
    scheduled_start_at: effectiveScheduledStart,
    message: "Booking created and paid with credit.",
  });
}
    }
  } catch {
    creditApplied = 0; // safe fallback
  }

  const remaining = Math.max(0, BORROWER_FEE - creditApplied);

  // 3) Stripe Checkout for remainder
  const params = new URLSearchParams();
  params.append("mode", "payment");

  params.append("success_url", `${FRONTEND_BASE_URL}/dashboard?stripe=success&booking_id=${bookingId}`);
  params.append("cancel_url", `${FRONTEND_BASE_URL}/dashboard?stripe=cancel&booking_id=${bookingId}`);

  params.append("line_items[0][price_data][currency]", "cad");
  params.append("line_items[0][price_data][product_data][name]",
    remaining === BORROWER_FEE ? "Borrower booking fee" : "Borrower booking fee (remaining)"
  );
  params.append("line_items[0][price_data][unit_amount]", String(cents(remaining)));
  params.append("line_items[0][quantity]", "1");

  params.append("payment_intent_data[metadata][payment_type]", "borrower_booking");
  params.append("payment_intent_data[metadata][booking_id]", bookingId);
  params.append("payment_intent_data[metadata][borrower_id]", String(borrower_id));
  if (owner_id) params.append("payment_intent_data[metadata][owner_id]", String(owner_id));
  params.append("payment_intent_data[metadata][bike_id]", String(bike_id));
  params.append("payment_intent_data[metadata][fee_total_cents]", String(cents(BORROWER_FEE)));
  params.append("payment_intent_data[metadata][credit_applied_cents]", String(cents(creditApplied)));
  params.append("payment_intent_data[metadata][expected_charge_cents]", String(cents(remaining)));

  const resp = await fetch("https://api.stripe.com/v1/checkout/sessions", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${stripeSecretKey}`,
      "Content-Type": "application/x-www-form-urlencoded",
    },
    body: params.toString(),
  });

  const text = await resp.text();
  let session: any = null;
  try { session = JSON.parse(text); } catch {}

  if (!resp.ok || !session?.id || !session?.url) {
    await supabase
      .from("bookings")
      .update({ cancelled: true, cancelled_by: "system", status: "expired" })
      .eq("id", bookingId);

    return json(500, { error: "Failed to create Stripe checkout session", details: text });
  }

  await supabase.from("bookings").update({ stripe_checkout_session_id: session.id }).eq("id", bookingId);

  return json(200, {
    booking_id: bookingId,
    used_credit: creditApplied > 0,
    credit_applied: creditApplied,
    amount_due: remaining,
    checkout_url: session.url,
    stripe_checkout_session_id: session.id,
    scheduled_start_at: effectiveScheduledStart,
    message: creditApplied > 0
      ? "Partial credit applied. Stripe checkout required for remaining amount."
      : "Pending hold created. Stripe checkout required.",
  });
});

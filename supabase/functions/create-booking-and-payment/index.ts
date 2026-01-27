import { serve } from "https://deno.land/std@0.192.0/http/server.ts";
import { createClient } from "https://cdn.jsdelivr.net/npm/@supabase/supabase-js/+esm";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

const supabaseUrl = Deno.env.get("MY_SUPABASE_URL")!;
const serviceRoleKey = Deno.env.get("MY_SUPABASE_SERVICE_ROLE_KEY")!;
const stripeSecretKey = Deno.env.get("STRIPE_SECRET_KEY")!;
const supabase = createClient(supabaseUrl, serviceRoleKey);

function json(status: number, body: unknown) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}

// ✅ Guardrail: require ISO8601 with timezone suffix (Z or ±HH:MM)
function hasTimezone(iso: string) {
  return /Z$/.test(iso) || /[+-]\d{2}:\d{2}$/.test(iso);
}

serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  if (req.method !== "POST") return json(405, { error: "Method not allowed" });

  let body: any;
  try {
    body = await req.json();
  } catch {
    return json(400, { error: "Invalid JSON body" });
  }

  const {
    borrower_id,
    owner_id,
    bike_id,
    booking_date,
    scheduled_start_at,
    duration_minutes,
    registry_id,
  } = body ?? {};

  if (!borrower_id || !bike_id || !booking_date) {
    return json(400, { error: "borrower_id, bike_id, booking_date are required" });
  }

  const effectiveScheduledStart = scheduled_start_at ?? booking_date;
  const effectiveDuration = duration_minutes ?? 30;

  // ✅ NEW: timezone validation (prevents silent UTC/local shifts)
  if (typeof booking_date !== "string" || !hasTimezone(booking_date)) {
    return json(400, {
      error: "booking_date must be ISO8601 with timezone (Z or ±HH:MM)",
      got: booking_date,
      examples: [
        "2026-01-12T22:15:00Z",
        "2026-01-12T15:15:00-07:00",
      ],
    });
  }

  if (typeof effectiveScheduledStart !== "string" || !hasTimezone(effectiveScheduledStart)) {
    return json(400, {
      error: "scheduled_start_at must be ISO8601 with timezone (Z or ±HH:MM)",
      got: effectiveScheduledStart,
      examples: [
        "2026-01-12T22:15:00Z",
        "2026-01-12T15:15:00-07:00",
      ],
    });
  }

  // 1) ATOMIC: create a pending hold booking (15 min)
  const { data: booking, error: bookingErr } = await supabase
    .rpc("create_pending_booking", {
      p_borrower_id: borrower_id,
      p_owner_id: owner_id ?? null,
      p_bike_id: bike_id,
      p_booking_date: booking_date,
      p_scheduled_start_at: effectiveScheduledStart,
      p_duration_minutes: effectiveDuration,
      p_registry_id: registry_id ?? null,
    });

  if (bookingErr || !booking) {
    // 23505 from the function => slot conflict
    const msg = (bookingErr as any)?.message ?? "Failed to create booking";
    if (msg.toLowerCase().includes("slot not available")) {
      return json(409, { error: "Slot not available" });
    }
    console.error("create_pending_booking failed:", bookingErr);
    return json(500, { error: "Failed to create pending booking" });
  }

  const bookingId = booking.id;

  // 2) Try to consume borrower credit FIRST (rebook_credit)
  const { data: creditRow, error: creditErr } = await supabase
    .from("credits")
    .select("*")
    .eq("user_id", borrower_id)
    .eq("status", "available")
    .eq("credit_type", "rebook_credit")
    .gte("amount", 150)
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle();

  if (!creditErr && creditRow) {
    const nowIso = new Date().toISOString();

    const { error: useErr } = await supabase
      .from("credits")
      .update({
        status: "used",
        used_at: nowIso,
        used_on_booking_id: bookingId,
      })
      .eq("id", creditRow.id);

    if (!useErr) {
      // Mark booking paid + confirmed; clear hold expiry
      await supabase
        .from("bookings")
        .update({ borrower_paid: true, status: "confirmed", payment_expires_at: null })
        .eq("id", bookingId);

      // Record payment as borrower_credit
      await supabase.from("payments").insert([{
        booking_id: bookingId,
        borrower_id,
        owner_id: owner_id ?? null,
        payment_type: "borrower_credit",
        status: "succeeded",
        amount: 150,
        currency: "CAD",
        stripe_id: null,
        stripe_payment_intent_id: null,
        refund_id: null,
        refund_status: null,
        refunded_amount_cents: null,
      }]);

      return json(200, {
        booking_id: bookingId,
        used_credit: true,
        checkout_url: null,
        stripe_checkout_session_id: null,
        scheduled_start_at: effectiveScheduledStart,
        message: "Booking created and paid with credit.",
      });
    }
  }

  // 3) Create Stripe Checkout Session
  const params = new URLSearchParams();
  params.append("mode", "payment");
  params.append("success_url", "https://example.com/success?booking_id=" + bookingId);
  params.append("cancel_url", "https://example.com/cancel?booking_id=" + bookingId);

  params.append("line_items[0][price_data][currency]", "cad");
  params.append("line_items[0][price_data][product_data][name]", "Borrower booking fee");
  params.append("line_items[0][price_data][unit_amount]", String(150 * 100));
  params.append("line_items[0][quantity]", "1");

  // Put everything we need into PaymentIntent metadata so webhook can update booking
  params.append("payment_intent_data[metadata][payment_type]", "borrower_booking");
  params.append("payment_intent_data[metadata][booking_id]", bookingId);
  params.append("payment_intent_data[metadata][borrower_id]", String(borrower_id));
  if (owner_id) params.append("payment_intent_data[metadata][owner_id]", String(owner_id));
  params.append("payment_intent_data[metadata][bike_id]", String(bike_id));

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
  try {
    session = JSON.parse(text);
  } catch {
    // ignore
  }

  if (!resp.ok || !session?.id || !session?.url) {
    console.error("Stripe session create failed:", text);

    // Cancel/expire the pending booking so it stops blocking the slot
    await supabase
      .from("bookings")
      .update({ cancelled: true, cancelled_by: "system", status: "expired" })
      .eq("id", bookingId);

    return json(500, { error: "Failed to create Stripe checkout session" });
  }

  // Store session id for traceability
  await supabase
    .from("bookings")
    .update({ stripe_checkout_session_id: session.id })
    .eq("id", bookingId);

  return json(200, {
    booking_id: bookingId,
    used_credit: false,
    checkout_url: session.url,
    stripe_checkout_session_id: session.id,
    scheduled_start_at: effectiveScheduledStart,
    message: "Pending hold created. Stripe checkout required.",
  });
});

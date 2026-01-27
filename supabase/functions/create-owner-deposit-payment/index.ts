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
const stripeSecretKey = Deno.env.get("STRIPE_SECRET_KEY")!;
const supabase = createClient(supabaseUrl, serviceRoleKey);

const OWNER_DEPOSIT_AMOUNT = 150;

// ✅ Single rule: owner has 8 hours to accept (pay deposit)
const ACCEPTANCE_WINDOW_HOURS = 8;

function json(status: number, body: unknown) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}

function cents(n: number) {
  return Math.round(n * 100);
}

function isAcceptWindowExpired(created_at: string | null | undefined) {
  if (!created_at) return false;
  const created = new Date(created_at);
  if (isNaN(created.getTime())) return false;

  const deadlineMs =
    created.getTime() + ACCEPTANCE_WINDOW_HOURS * 60 * 60 * 1000;
  return Date.now() > deadlineMs;
}

async function tryConsumeCredit(args: {
  owner_id: string;
  booking_id: string;
  credit_type: string;
  min_amount: number;
}) {
  const { owner_id, booking_id, credit_type, min_amount } = args;

  const { data: creditRow, error: creditErr } = await supabase
    .from("credits")
    .select("*")
    .eq("user_id", owner_id)
    .eq("status", "available")
    .eq("credit_type", credit_type)
    .gte("amount", min_amount)
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle();

  if (creditErr) {
    console.error("Credit lookup error:", { credit_type, creditErr });
    return { ok: false as const, used: false as const, error: creditErr };
  }
  if (!creditRow) return { ok: true as const, used: false as const };

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

  if (useErr) {
    console.error("Failed to mark credit used:", useErr);
    return { ok: false as const, used: false as const, error: useErr };
  }

  return { ok: true as const, used: true as const, creditRow };
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

  const { booking_id } = body ?? {};
  if (!booking_id) return json(400, { error: "booking_id is required" });

  // 1) Load booking
  const { data: booking, error: bErr } = await supabase
    .from("bookings")
    .select("*")
    .eq("id", booking_id)
    .single();

  if (bErr || !booking) return json(404, { error: "Booking not found" });

  if (booking.cancelled) return json(400, { error: "Booking is cancelled" });
  if (booking.completed) return json(400, { error: "Booking is already completed" });
  if (!booking.borrower_paid) return json(400, { error: "Borrower has not paid yet" });
  if (booking.owner_deposit_paid) return json(400, { error: "Owner deposit already paid" });
  if (!booking.owner_id) return json(400, { error: "Booking has no owner_id" });

  // ✅ Backend enforcement: 8 hour acceptance window
  if (isAcceptWindowExpired(booking.created_at)) {
    return json(409, {
      error: "Booking request expired (owner did not accept in time).",
      code: "EXPIRED_ACCEPT_WINDOW",
      booking_id,
      acceptance_window_hours: ACCEPTANCE_WINDOW_HOURS,
    });
  }

  const owner_id = String(booking.owner_id);

  // 2) Try OWNER_DEPOSIT_HELD first
  const held = await tryConsumeCredit({
    owner_id,
    booking_id,
    credit_type: "OWNER_DEPOSIT_HELD",
    min_amount: OWNER_DEPOSIT_AMOUNT,
  });

  if (held.ok && held.used) {
    await supabase.from("bookings").update({ owner_deposit_paid: true }).eq("id", booking_id);

    await supabase.from("payments").insert([{
      booking_id,
      borrower_id: booking.borrower_id,
      owner_id,
      payment_type: "owner_deposit",
      status: "succeeded",
      amount: OWNER_DEPOSIT_AMOUNT,
      currency: "CAD",
      stripe_id: null,
      stripe_payment_intent_id: null,
      refund_id: null,
      refund_status: null,
      refunded_amount_cents: null,
    }]);

    return json(200, {
      booking_id,
      used_credit: true,
      credit_type: "OWNER_DEPOSIT_HELD",
      credit_id: held.creditRow.id,
      message: "Owner deposit satisfied by held deposit credit. No Stripe checkout needed.",
    });
  }

  // 2b) Legacy fallback: rebook_credit
  const legacy = await tryConsumeCredit({
    owner_id,
    booking_id,
    credit_type: "rebook_credit",
    min_amount: OWNER_DEPOSIT_AMOUNT,
  });

  if (legacy.ok && legacy.used) {
    await supabase.from("bookings").update({ owner_deposit_paid: true }).eq("id", booking_id);

    await supabase.from("payments").insert([{
      booking_id,
      borrower_id: booking.borrower_id,
      owner_id,
      payment_type: "owner_deposit",
      status: "succeeded",
      amount: OWNER_DEPOSIT_AMOUNT,
      currency: "CAD",
      stripe_id: null,
      stripe_payment_intent_id: null,
      refund_id: null,
      refund_status: null,
      refunded_amount_cents: null,
    }]);

    return json(200, {
      booking_id,
      used_credit: true,
      credit_type: "rebook_credit",
      credit_id: legacy.creditRow.id,
      message: "Owner deposit satisfied by legacy credit. No Stripe checkout needed.",
    });
  }

  // 3) Stripe fallback: create Checkout Session for $150 owner deposit
  const params = new URLSearchParams();
  params.append("mode", "payment");
  params.append("success_url", "https://example.com/success?booking_id=" + booking_id);
  params.append("cancel_url", "https://example.com/cancel?booking_id=" + booking_id);

  params.append("line_items[0][price_data][currency]", "cad");
  params.append("line_items[0][price_data][product_data][name]", "BorrowMyBike owner deposit");
  params.append("line_items[0][price_data][unit_amount]", String(cents(OWNER_DEPOSIT_AMOUNT)));
  params.append("line_items[0][quantity]", "1");

  params.append("payment_intent_data[metadata][payment_type]", "owner_deposit");
  params.append("payment_intent_data[metadata][booking_id]", booking_id);
  params.append("payment_intent_data[metadata][owner_id]", String(owner_id));
  if (booking.borrower_id) params.append("payment_intent_data[metadata][borrower_id]", String(booking.borrower_id));
  if (booking.bike_id) params.append("payment_intent_data[metadata][bike_id]", String(booking.bike_id));

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
  try { session = JSON.parse(text); } catch { /* ignore */ }

  if (!resp.ok || !session?.url) {
    console.error("Stripe session create failed:", text);
    return json(500, { error: "Stripe session create failed" });
  }

  return json(200, {
    booking_id,
    used_credit: false,
    checkout_url: session.url,
    stripe_checkout_session_id: session.id,
    message: "Owner deposit requires Stripe checkout.",
  });
});

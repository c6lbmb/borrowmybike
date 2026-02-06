import { serve } from "https://deno.land/std@0.177.0/http/server.ts";
import { createClient } from "https://cdn.jsdelivr.net/npm/@supabase/supabase-js/+esm";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

const supabaseUrl = Deno.env.get("MY_SUPABASE_URL")!;
const serviceRoleKey = Deno.env.get("MY_SUPABASE_SERVICE_ROLE_KEY")!;
const stripeSecretKey = Deno.env.get("STRIPE_SECRET_KEY")!;
const supabase = createClient(supabaseUrl, serviceRoleKey);

const OWNER_DEPOSIT_AMOUNT = 150;
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
  const deadlineMs = created.getTime() + ACCEPTANCE_WINDOW_HOURS * 60 * 60 * 1000;
  return Date.now() > deadlineMs;
}

async function findBestCredit(owner_id: string, credit_types: string[]) {
  // Find most recent available credit among allowed types
  for (const ct of credit_types) {
    const { data, error } = await supabase
      .from("credits")
      .select("*")
      .eq("user_id", owner_id)
      .eq("status", "available")
      .eq("credit_type", ct)
      .gt("amount", 0)
      .order("created_at", { ascending: false })
      .limit(1)
      .maybeSingle();

    if (error) {
      console.error("Credit lookup error:", { ct, error });
      continue;
    }
    if (data) return data;
  }
  return null;
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

  const { data: booking, error: bErr } = await supabase.from("bookings").select("*").eq("id", booking_id).single();
  if (bErr || !booking) return json(404, { error: "Booking not found" });

  if (booking.cancelled) return json(400, { error: "Booking is cancelled" });
  if (booking.completed) return json(400, { error: "Booking is already completed" });
  if (!booking.borrower_paid) return json(400, { error: "Borrower has not paid yet" });
  if (booking.owner_deposit_paid) return json(400, { error: "Owner deposit already paid" });
  if (!booking.owner_id) return json(400, { error: "Booking has no owner_id" });

  if (isAcceptWindowExpired(booking.created_at)) {
    return json(409, {
      error: "Booking request expired (owner did not accept in time).",
      code: "EXPIRED_ACCEPT_WINDOW",
      booking_id,
      acceptance_window_hours: ACCEPTANCE_WINDOW_HOURS,
    });
  }

  const owner_id = String(booking.owner_id);

  // ✅ Try credits first (supports PARTIAL)
  // Priority: OWNER_DEPOSIT_HELD, then rebook_credit
  const creditRow = await findBestCredit(owner_id, ["OWNER_DEPOSIT_HELD", "rebook_credit"]);

  let creditApplied = 0;

  if (creditRow) {
    const available = Number(creditRow.amount || 0);
    creditApplied = Math.min(OWNER_DEPOSIT_AMOUNT, Math.max(0, available));

    if (creditApplied > 0) {
      const nowIso = new Date().toISOString();

      const { error: useErr } = await supabase
        .from("credits")
        .update({ status: "used", used_at: nowIso, used_on_booking_id: booking_id })
        .eq("id", creditRow.id)
        .eq("status", "available");

      if (!useErr) {
        await supabase.from("payments").insert([
          {
            booking_id,
            borrower_id: booking.borrower_id,
            owner_id,
            payment_type: "owner_deposit_credit",
            status: "succeeded",
            amount: creditApplied,
            currency: "CAD",
            stripe_id: null,
            stripe_payment_intent_id: null,
            refund_id: null,
            refund_status: null,
            refunded_amount_cents: null,
          },
        ]);

        if (creditApplied >= OWNER_DEPOSIT_AMOUNT) {
          await supabase.from("bookings").update({ owner_deposit_paid: true }).eq("id", booking_id);

          return json(200, {
            booking_id,
            used_credit: true,
            credit_type: creditRow.credit_type,
            credit_id: creditRow.id,
            credit_applied: creditApplied,
            message: "Owner deposit satisfied by credit. No Stripe checkout needed.",
          });
        }
      } else {
        creditApplied = 0;
      }
    }
  }

  const remaining = Math.max(0, OWNER_DEPOSIT_AMOUNT - creditApplied);

  // Stripe checkout for remaining
  const params = new URLSearchParams();
  params.append("mode", "payment");

  // NOTE: replace example.com with your real frontend URL when ready
  const FRONTEND_BASE_URL = Deno.env.get("FRONTEND_BASE_URL") ?? "https://class6loaner.com";

  params.append("success_url", `${FRONTEND_BASE_URL}/dashboard?stripe=success&booking_id=${bookingId}`);
  params.append("cancel_url", `${FRONTEND_BASE_URL}/dashboard?stripe=cancel&booking_id=${bookingId}`);

  params.append("line_items[0][price_data][currency]", "cad");
  params.append(
    "line_items[0][price_data][product_data][name]",
    remaining === OWNER_DEPOSIT_AMOUNT ? "BorrowMyBike owner deposit" : "BorrowMyBike owner deposit (remaining)"
  );
  params.append("line_items[0][price_data][unit_amount]", String(cents(remaining)));
  params.append("line_items[0][quantity]", "1");

  params.append("payment_intent_data[metadata][payment_type]", "owner_deposit");
  params.append("payment_intent_data[metadata][booking_id]", booking_id);
  params.append("payment_intent_data[metadata][owner_id]", String(owner_id));
  if (booking.borrower_id) params.append("payment_intent_data[metadata][borrower_id]", String(booking.borrower_id));
  if (booking.bike_id) params.append("payment_intent_data[metadata][bike_id]", String(booking.bike_id));
  params.append("payment_intent_data[metadata][deposit_total_cents]", String(cents(OWNER_DEPOSIT_AMOUNT)));
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
  try {
    session = JSON.parse(text);
  } catch {
    /* ignore */
  }

  if (!resp.ok || !session?.url) {
    console.error("Stripe session create failed:", text);
    return json(500, { error: "Stripe session create failed" });
  }

  return json(200, {
    booking_id,
    used_credit: creditApplied > 0,
    credit_applied: creditApplied,
    amount_due: remaining,
    checkout_url: session.url,
    stripe_checkout_session_id: session.id,
    message:
      creditApplied > 0
        ? "Partial credit applied. Stripe checkout required for remaining deposit."
        : "Owner deposit requires Stripe checkout.",
  });
});

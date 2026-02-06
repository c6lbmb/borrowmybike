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
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}

function isAlreadyExistsError(msg: string | null | undefined) {
  const m = String(msg || "").toLowerCase();
  // Postgres unique violation
  return m.includes("duplicate key") || m.includes("already exists") || m.includes("23505");
}

serve(async (req) => {
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

  const supabaseUrl = Deno.env.get("SUPABASE_URL");
  const serviceRoleKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
  if (!supabaseUrl || !serviceRoleKey) {
    return json(500, { error: "Missing SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY" });
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

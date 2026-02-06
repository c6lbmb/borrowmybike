// supabase/functions/create-owner-deposit-payment/index.ts
import { serve } from "https://deno.land/std@0.177.0/http/server.ts";
import Stripe from "https://esm.sh/stripe@14.21.0?target=deno";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2?target=deno";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

const supabaseUrl = Deno.env.get("MY_SUPABASE_URL")!;
const serviceRoleKey = Deno.env.get("MY_SUPABASE_SERVICE_ROLE_KEY")!;
const stripeSecretKey = Deno.env.get("STRIPE_SECRET_KEY")!;
const frontendBaseUrl =
  Deno.env.get("FRONTEND_BASE_URL") || "http://localhost:5173";

// 🔍 TEMP DEBUG — remove after verification
console.log("FRONTEND_BASE_URL =", frontendBaseUrl);


const supabase = createClient(supabaseUrl, serviceRoleKey);

const OWNER_DEPOSIT_AMOUNT = 150;


async function auditLog(args: {
  booking_id: string;
  actor_role: "borrower" | "owner" | "system" | "admin";
  actor_user_id?: string | null;
  action: string;
  note?: string | null;
}) {
  const { booking_id, actor_role, actor_user_id, action, note } = args;
  try {
    await supabase.from("booking_audit_log").insert([{
      booking_id,
      actor_role,
      actor_user_id: actor_user_id ?? null,
      action,
      note: note ?? null,
    }]);
  } catch (e) {
    // Never block core flow due to audit failure
    console.warn("booking_audit_log insert failed:", e);
  }
}

function json(status: number, body: unknown) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}

function cents(n: number) {
  return Math.round(n * 100);
}

function scheduledIsoFor(booking: any): string | null {
  return booking?.scheduled_start_at ?? booking?.booking_date ?? null;
}

// ✅ Rahim rule: acceptance window is based on how far in advance the booking was requested
// i.e., (scheduled_start_at/booking_date - created_at):
// - < 24h  => 2h to accept
// - 24–72h => 4h to accept
// - > 72h  => 8h to accept
function acceptanceHoursForBooking(booking: any) {
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

function isAcceptWindowExpired(booking: any) {
  const createdIso = booking?.created_at;
  if (!createdIso) return false;

  const created = new Date(createdIso);
  if (isNaN(created.getTime())) return false;

  const hours = acceptanceHoursForBooking(booking);
  const deadlineMs = created.getTime() + hours * 60 * 60 * 1000;
  return Date.now() > deadlineMs;
}

// ✅ Hard guard: do not accept if scheduled time already passed
function isScheduledAlreadyPassed(booking: any) {
  const scheduledIso = scheduledIsoFor(booking);
  if (!scheduledIso) return false;

  const scheduled = new Date(scheduledIso);
  if (isNaN(scheduled.getTime())) return false;

  return scheduled.getTime() < Date.now();
}

async function findAvailableCreditRow(args: {
  owner_id: string;
  credit_type: string;
}) {
  const { owner_id, credit_type } = args;

  const { data, error } = await supabase
    .from("credits")
    .select("*")
    .eq("user_id", owner_id)
    .eq("status", "available")
    .eq("credit_type", credit_type)
    .gt("amount", 0)
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle();

  if (error) throw error;
  return data ?? null;
}

async function consumeUpToFromCreditRow(args: {
  creditRow: any;
  booking_id: string;
  need: number;
}) {
  const { creditRow, booking_id, need } = args;

  const creditAmount = Number(creditRow.amount ?? 0);
  const usedAmount = Math.min(need, creditAmount);
  const leftover = Math.max(0, creditAmount - usedAmount);

  const nowIso = new Date().toISOString();

  // Mark original row used
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

serve(async (req: Request) => {
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

  const { data: booking, error: bErr } = await supabase
    .from("bookings")
    .select("*")
    .eq("id", booking_id)
    .single();

  if (bErr || !booking) return json(404, { error: "Booking not found" });

  if (booking.cancelled) return json(400, { error: "Booking cancelled" });
  if (booking.completed) return json(400, { error: "Booking already completed" });
  if (!booking.borrower_paid) return json(400, { error: "Borrower not paid yet" });
  if (booking.owner_deposit_paid) return json(200, { ok: true, message: "Owner deposit already paid" });

  // ✅ Guard: scheduled already passed
  if (isScheduledAlreadyPassed(booking)) {
    return json(400, { error: "Scheduled time already passed (request expired)" });
  }

  // ✅ enforce acceptance window
  if (isAcceptWindowExpired(booking)) {
    const hours = acceptanceHoursForBooking(booking);
    await auditLog({
      booking_id,
      actor_role: "owner",
      actor_user_id: String(booking.owner_id ?? ""),
      action: "owner_acceptance_window_expired",
      note: `Owner attempted to accept/pay deposit after acceptance window expired (acceptance_hours=${hours})`,
    });

    return json(400, {
      error: "Acceptance window expired",
      acceptance_hours: hours,
    });
  }

  const owner_id = String(booking.owner_id || "");
  const borrower_id = String(booking.borrower_id || "");
  if (!owner_id) return json(400, { error: "booking.owner_id missing" });
  if (!borrower_id) return json(400, { error: "booking.borrower_id missing" });

  // Try credits first: OWNER_DEPOSIT_HELD then rebook_credit
  let remaining = OWNER_DEPOSIT_AMOUNT;
  const used: any[] = [];

  for (const credit_type of ["OWNER_DEPOSIT_HELD", "rebook_credit"]) {
    if (remaining <= 0) break;

    const row = await findAvailableCreditRow({ owner_id, credit_type });
    if (!row) continue;

    const res = await consumeUpToFromCreditRow({ creditRow: row, booking_id, need: remaining });
    used.push({ credit_type, ...res });
    remaining = Math.max(0, remaining - res.usedAmount);
  }

  // Fully covered by credit
  if (remaining <= 0.00001) {
    const { error: pErr } = await supabase.from("payments").insert([{
      booking_id,
      payment_type: "owner_deposit",
      status: "paid",
      amount: OWNER_DEPOSIT_AMOUNT,
      currency: "CAD",
      borrower_id,
      owner_id,
      method: "credit",
      meta: { source: "create-owner-deposit-payment", used },
    }]);

    if (pErr) return json(500, { error: "Failed to insert owner_deposit payment", details: pErr });

    const { error: upErr } = await supabase
      .from("bookings")
      .update({ owner_deposit_paid: true })
      .eq("id", booking_id);

    if (upErr) return json(500, { error: "Failed to update booking owner_deposit_paid", details: upErr });

await auditLog({
  booking_id,
  actor_role: "owner",
  actor_user_id: owner_id,
  action: "owner_deposit_paid_with_credit",
  note: `Owner deposit covered by credit; used_types=${used.map(u => u.credit_type).join(",")}`,
});

return json(200, {
      ok: true,
      method: "credit",
      used,
      remaining_due: 0,
      message: "Owner deposit covered by credit ✅",
    });
  }

  // Otherwise charge remainder via Stripe checkout
  const stripe = new Stripe(stripeSecretKey, { apiVersion: "2023-10-16" });

  const successUrl = `${frontendBaseUrl}/owner?deposit_success=1&booking_id=${booking_id}`;
  const cancelUrl = `${frontendBaseUrl}/owner?deposit_cancelled=1&booking_id=${booking_id}`;

const meta = {
  booking_id,
  payment_type: "owner_deposit",
  owner_id,
  borrower_id,
  credit_used_total: String(OWNER_DEPOSIT_AMOUNT - remaining),
};

const session = await stripe.checkout.sessions.create({
  mode: "payment",
  payment_method_types: ["card"],
  line_items: [{
    quantity: 1,
    price_data: {
      currency: "cad",
      unit_amount: cents(remaining),
      product_data: {
        name: "Owner Deposit (Road Test Booking)",
        description: `Deposit remainder after applying credit ($${(OWNER_DEPOSIT_AMOUNT - remaining).toFixed(2)} credit used)`,
      },
    },
  }],

  // Keep this (helps for session-level visibility)
  metadata: meta,

  // 🔥 THIS is what ensures your webhook always gets booking_id/payment_type
  payment_intent_data: {
    metadata: meta,
  },

  success_url: successUrl,
  cancel_url: cancelUrl,
});

  if (!session.url) {
    return json(500, { error: "Stripe session created but no checkout URL returned" });
  }

await auditLog({
  booking_id,
  actor_role: "owner",
  actor_user_id: owner_id,
  action: "owner_deposit_checkout_created",
  note: `Stripe checkout created for remaining deposit; remaining_due=${remaining}`,
});

return json(200, {
    ok: true,
    method: "stripe",
    used,
    remaining_due: remaining,
    checkout_url: session.url,
  });
});

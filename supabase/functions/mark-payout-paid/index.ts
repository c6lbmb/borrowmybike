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
const supabase = createClient(supabaseUrl, serviceRoleKey);

function json(status: number, body: unknown) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}

type PayoutType = "owner_payout" | "borrower_compensation";

serve(async (req) => {
  // CORS
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  if (req.method !== "POST") return json(405, { error: "Only POST is allowed" });

  let body: any = null;
  try {
    body = await req.json();
  } catch {
    return json(400, { error: "Invalid JSON body" });
  }

  const booking_id = body?.booking_id as string | undefined;
  const payout_type = body?.payout_type as PayoutType | undefined;
  const payout_method = (body?.payout_method ?? "manual") as string;
  const payout_reference = (body?.payout_reference ?? null) as string | null;

  if (!booking_id) return json(400, { error: "booking_id is required" });
  if (payout_type !== "owner_payout" && payout_type !== "borrower_compensation") {
    return json(400, { error: "payout_type must be 'owner_payout' or 'borrower_compensation'" });
  }

  // 1) Find payout_due row for this booking + payout_type
  const { data: dueRows, error: dueErr } = await supabase
    .from("payments")
    .select("*")
    .eq("booking_id", booking_id)
    .eq("payment_type", payout_type)
    .order("created_at", { ascending: false })
    .limit(5);

  if (dueErr) return json(500, { error: "Failed to load payments", details: dueErr });

  const rows = dueRows ?? [];

  // If already paid, return success idempotently
  const alreadyPaid = rows.find((p: any) => String(p.status).toLowerCase() === "paid");
  if (alreadyPaid) {
    return json(200, {
      booking_id,
      payout_type,
      message: "Already marked paid ✅",
      payment_id: alreadyPaid.id,
      payout_paid_at: alreadyPaid.payout_paid_at ?? null,
      payout_method: alreadyPaid.payout_method ?? null,
      payout_reference: alreadyPaid.payout_reference ?? null,
    });
  }

  const payoutDue = rows.find((p: any) => String(p.status).toLowerCase() === "payout_due");
  if (!payoutDue) {
    return json(400, {
      booking_id,
      payout_type,
      error: "No payout_due row found for this booking/type",
      payment_types_found: rows.map((r: any) => ({ id: r.id, payment_type: r.payment_type, status: r.status })),
      hint: "This booking must have recorded a payout_due payment row first (via settle-booking).",
    });
  }

  const nowIso = new Date().toISOString();

  // 2) Mark payment row paid
  const { data: updatedPay, error: updErr } = await supabase
    .from("payments")
    .update({
      status: "paid",
      payout_paid_at: nowIso,
      payout_method,
      payout_reference,
    })
    .eq("id", payoutDue.id)
    .select("*")
    .single();

  if (updErr || !updatedPay) {
    return json(500, { error: "Failed to mark payout paid", details: updErr });
  }

  // 3) If owner payout, also mark bookings fields (you already have these)
  if (payout_type === "owner_payout") {
    const { error: bErr } = await supabase
      .from("bookings")
      .update({
        owner_payout_done: true,
        owner_payout_at: nowIso,
      })
      .eq("id", booking_id);

    if (bErr) {
      // Payment marked paid, but booking update failed (warn, don't fail)
      return json(200, {
        booking_id,
        payout_type,
        message: "Payout marked paid ✅ (but booking owner_payout fields failed to update)",
        payment: updatedPay,
        booking_update_error: bErr,
      });
    }
  }

  return json(200, {
    booking_id,
    payout_type,
    message: "Payout marked paid ✅",
    payment: updatedPay,
  });
});

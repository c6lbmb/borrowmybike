import { serve } from "https://deno.land/std@0.177.0/http/server.ts";
import { createClient } from "https://cdn.jsdelivr.net/npm/@supabase/supabase-js/+esm";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type, x-admin-key",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

const supabaseUrl = Deno.env.get("MY_SUPABASE_URL")!;
const serviceRoleKey = Deno.env.get("MY_SUPABASE_SERVICE_ROLE_KEY")!;
const adminKey = Deno.env.get("ADMIN_API_KEY")!;
const supabase = createClient(supabaseUrl, serviceRoleKey);

function json(status: number, body: unknown) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}

type Decision =
  | "approve_owner_no_show"
  | "approve_borrower_no_show"
  | "reject_claim";

serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  if (req.method !== "POST") return json(405, { error: "Only POST is allowed" });

  // 🔐 Admin key check
  const provided = req.headers.get("x-admin-key") || "";
  if (!adminKey || provided !== adminKey) {
    return json(401, { error: "Unauthorized: invalid x-admin-key" });
  }

  let body: any;
  try {
    body = await req.json();
  } catch {
    return json(400, { error: "Invalid JSON body" });
  }

  const booking_id = body?.booking_id;
  const decision: Decision | undefined = body?.decision;

  if (!booking_id) return json(400, { error: "booking_id is required" });
  if (!decision) {
    return json(400, {
      error: "decision must be approve_owner_no_show | approve_borrower_no_show | reject_claim",
    });
  }

  // Load booking
  const { data: booking, error: bErr } = await supabase
    .from("bookings")
    .select("*")
    .eq("id", booking_id)
    .single();

  if (bErr || !booking) return json(404, { error: "Booking not found" });
  if (booking.cancelled) return json(400, { error: "Booking is cancelled" });
  if (!booking.needs_review && decision !== "reject_claim") {
    return json(400, { error: "Booking is not under review" });
  }

  const patch: Record<string, any> = {
    needs_review: false,
  };

  if (decision === "approve_owner_no_show") {
    patch.treat_as_owner_no_show = true;
    patch.treat_as_borrower_no_show = false;
    patch.review_reason = "admin_approved_owner_no_show";
  }

  if (decision === "approve_borrower_no_show") {
    patch.treat_as_owner_no_show = false;
    patch.treat_as_borrower_no_show = true;
    patch.review_reason = "admin_approved_borrower_no_show";
  }

  if (decision === "reject_claim") {
    patch.treat_as_owner_no_show = false;
    patch.treat_as_borrower_no_show = false;
    patch.review_reason = "admin_rejected_no_show_claim";
    patch.no_show_claimed_by = null;
    patch.no_show_claimed_at = null;
  }

  const { data: updated, error: uErr } = await supabase
    .from("bookings")
    .update(patch)
    .eq("id", booking_id)
    .select("*")
    .single();

  if (uErr || !updated) {
    return json(500, { error: "Failed to update booking", details: uErr });
  }

  return json(200, {
    booking_id,
    decision,
    updated_booking: {
      needs_review: updated.needs_review,
      treat_as_owner_no_show: updated.treat_as_owner_no_show,
      treat_as_borrower_no_show: updated.treat_as_borrower_no_show,
      review_reason: updated.review_reason,
    },
    message:
      decision === "reject_claim"
        ? "No-show claim rejected and cleared ✅"
        : "No-show approved and finalized (manual payout required) ✅",
  });
});

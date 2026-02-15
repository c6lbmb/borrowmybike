// supabase/functions/examiner-refusal/index.ts
// Marks a booking as "needs_review" due to an examiner refusing to start the road test.
// IMPORTANT: This does NOT auto-settle; it preserves an audit trail and triggers admin review / rebooking.
//
// Allowed submitters: booking borrower OR booking owner (mentor).
// Window: only after BOTH parties have checked in, and only until 10 minutes after scheduled start.

import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

type Json = Record<string, unknown>;

const corsHeaders: Record<string, string> = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

function json(status: number, body: Json) {
  return new Response(JSON.stringify(body), { status, headers: { ...corsHeaders, "Content-Type": "application/json" } });
}

function reasonLabel(reasonCode: string): string {
  switch (reasonCode) {
    case "motorcycle_issue":
      return "Issue with the motorcycle (not ready / not acceptable today)";
    case "not_ready":
      return "Test-taker not ready (gear / paperwork / eligibility)";
    case "registry_reschedule":
      return "Registry rescheduled / examiner unavailable";
    case "weather_conditions":
      return "Weather / road conditions";
    case "other":
      return "Other";
    default:
      return "Unspecified";
  }
}

function getStartIso(b: any): string | null {
  return (b?.scheduled_start_at as string | null) || (b?.booking_date as string | null) || null;
}

function toMs(iso: string | null): number {
  if (!iso) return NaN;
  const t = new Date(iso).getTime();
  return Number.isFinite(t) ? t : NaN;
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { status: 204, headers: corsHeaders });
  if (req.method !== "POST") return json(405, { error: "Method not allowed" });

  try {
    const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
    const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
    const supabase = createClient(supabaseUrl, serviceKey);

    // Identify caller (must be borrower or owner on this booking)
    const authHeader = req.headers.get("Authorization") || "";
    const token = authHeader.startsWith("Bearer ") ? authHeader.slice(7) : null;
    if (!token) return json(401, { error: "Missing bearer token" });

    const authed = createClient(supabaseUrl, Deno.env.get("SUPABASE_ANON_KEY")!, {
      global: { headers: { Authorization: `Bearer ${token}` } },
    });
    const { data: userData, error: userErr } = await authed.auth.getUser();
    if (userErr || !userData?.user) return json(401, { error: "Invalid user" });
    const callerId = userData.user.id;

    const body = (await req.json().catch(() => null)) as any;
    const bookingId = (body?.booking_id as string | undefined) || null;
    const reasonCode = (body?.reason_code as string | undefined) || "other";
    const note = (typeof body?.note === "string" ? body.note.trim() : "") || "";

    if (!bookingId) return json(400, { error: "Missing booking_id" });

    // Load booking
    const { data: booking, error: bErr } = await supabase
      .from("bookings")
      .select(
        "id,borrower_id,owner_id,status,borrower_paid,owner_deposit_paid,cancelled,settled,completed,borrower_checked_in,owner_checked_in,borrower_checked_in_at,owner_checked_in_at,scheduled_start_at,booking_date"
      )
      .eq("id", bookingId)
      .maybeSingle();

    if (bErr || !booking) return json(404, { error: "Booking not found" });

    const isBorrower = booking.borrower_id === callerId;
    const isOwner = booking.owner_id === callerId;
    if (!isBorrower && !isOwner) return json(403, { error: "Not allowed for this booking" });

    const bothPaid = !!booking.borrower_paid && !!booking.owner_deposit_paid && booking.status === "confirmed";
    if (!bothPaid) return json(400, { error: "Booking must be confirmed and both paid" });
    if (booking.cancelled || booking.settled || booking.completed) return json(400, { error: "Booking is not actionable" });

    const borrowerChecked = !!booking.borrower_checked_in || !!booking.borrower_checked_in_at;
    const ownerChecked = !!booking.owner_checked_in || !!booking.owner_checked_in_at;
    if (!borrowerChecked || !ownerChecked) {
      return json(400, { error: "Both parties must check in before examiner refusal can be recorded" });
    }

    const startIso = getStartIso(booking);
    const startMs = toMs(startIso);
    if (!Number.isFinite(startMs)) return json(400, { error: "Invalid scheduled start time" });

    const now = Date.now();
    if (now < startMs) return json(400, { error: "Too early (before scheduled start)" });
    if (now > startMs + 10 * 60 * 1000) return json(400, { error: "Too late (past 10-minute window)" });

    const submittedBy = isBorrower ? "borrower" : "owner";
    const tag = `Examiner refused road test — ${reasonLabel(reasonCode)} (submitted by ${submittedBy})${note ? ` — Note: ${note}` : ""}`;

    const update: any = {
      needs_review: true,
      review_reason: "examiner_refusal",
      needs_rebooking: true,
      tag_reason: tag,
    };

    if (reasonCode === "motorcycle_issue") {
      update.bike_invalid = true;
      update.bike_invalid_reason = tag;
      update.bike_invalid_at = new Date().toISOString();
    }

    const { error: uErr } = await supabase.from("bookings").update(update).eq("id", bookingId);
    if (uErr) return json(500, { error: "Update failed", message: uErr.message });

    return json(200, { ok: true, booking_id: bookingId, submitted_by: submittedBy });
  } catch (e: any) {
    return json(500, { error: "Internal Server Error", message: e?.message || String(e) });
  }
});

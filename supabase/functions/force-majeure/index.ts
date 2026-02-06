// supabase/functions/force-majeure/index.ts
import { serve } from "https://deno.land/std@0.177.0/http/server.ts";
import { createClient } from "https://cdn.jsdelivr.net/npm/@supabase/supabase-js/+esm";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

const supabaseUrl = Deno.env.get("MY_SUPABASE_URL")!;
const serviceRoleKey = Deno.env.get("MY_SUPABASE_SERVICE_ROLE_KEY")!;

function json(status: number, body: unknown) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}

function mustAuth(req: Request) {
  const auth = req.headers.get("Authorization") || "";
  if (!auth.toLowerCase().startsWith("bearer ")) return null;
  return auth;
}

function parseStartISO(booking: any): string | null {
  return booking?.scheduled_start_at || booking?.booking_date || null;
}

serve(async (req: Request) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  if (req.method !== "POST") return json(405, { error: "Method not allowed" });

  const authHeader = mustAuth(req);
  if (!authHeader) return json(401, { error: "Missing Authorization bearer token" });

  let body: any;
  try {
    body = await req.json();
  } catch {
    return json(400, { error: "Invalid JSON body" });
  }

  const booking_id = body?.booking_id?.toString?.();
  const roleRaw = (body?.role ?? "").toString().trim().toLowerCase();

  if (!booking_id) return json(400, { error: "booking_id is required" });
  if (roleRaw !== "borrower" && roleRaw !== "owner") {
    return json(400, { error: "role must be borrower | owner" });
  }

  // Get caller user id from JWT (anon client uses the Authorization header)
  const authed = createClient(supabaseUrl, serviceRoleKey, {
    global: { headers: { Authorization: authHeader } },
  });

  const { data: userData, error: userErr } = await authed.auth.getUser();
  if (userErr || !userData?.user) return json(401, { error: "Invalid JWT" });
  const caller_id = userData.user.id;

  // Service role client for DB writes
  const admin = createClient(supabaseUrl, serviceRoleKey);

  const { data: booking, error: bErr } = await admin
    .from("bookings")
    .select([
      "id",
      "borrower_id",
      "owner_id",
      "booking_date",
      "scheduled_start_at",
      "cancelled",
      "settled",
      "force_majeure_borrower_agreed_at",
      "force_majeure_owner_agreed_at",
      "borrower_checked_in",
      "owner_checked_in",
      "borrower_paid",
      "owner_deposit_paid",
    ].join(","))
    .eq("id", booking_id)
    .single();

  if (bErr || !booking) return json(404, { error: "Booking not found" });
  if (booking.settled) return json(400, { error: "Booking already settled" });
  if (booking.cancelled) return json(400, { error: "Booking is cancelled" });

  // Force majeure is only available once the booking is fully active (both parties have paid).
  if (!booking.borrower_paid || !booking.owner_deposit_paid) {
    return json(400, {
      error: "Force majeure requires an accepted booking (both paid)",
      borrower_paid: booking.borrower_paid,
      owner_deposit_paid: booking.owner_deposit_paid,
    });
  }
  if (booking.borrower_checked_in || booking.owner_checked_in) {
    return json(400, { error: "Force majeure unavailable after check-in", borrower_checked_in: booking.borrower_checked_in, owner_checked_in: booking.owner_checked_in });
  }

  // Role/caller validation
  if (roleRaw === "borrower" && caller_id !== booking.borrower_id) {
    return json(403, { error: "Not authorized for borrower on this booking" });
  }
  if (roleRaw === "owner" && caller_id !== booking.owner_id) {
    return json(403, { error: "Not authorized for owner on this booking" });
  }

  // Time gate: only within 2 hours before start time, and not after start
  const startISO = parseStartISO(booking);
  if (!startISO) return json(400, { error: "Booking start time missing" });

  const startAt = new Date(startISO);
  const now = new Date();
  const windowStart = new Date(startAt.getTime() - 2 * 60 * 60 * 1000); // -2h
  const windowEnd = startAt; // up to start time

  if (now < windowStart || now > windowEnd) {
    return json(400, {
      error: "Force majeure window closed",
      window: { opens_at: windowStart.toISOString(), closes_at: windowEnd.toISOString() },
      now: now.toISOString(),
    });
  }

  const patch: any = {};
  if (roleRaw === "borrower") {
    patch.force_majeure_borrower_agreed_at = booking.force_majeure_borrower_agreed_at || now.toISOString();
  } else {
    patch.force_majeure_owner_agreed_at = booking.force_majeure_owner_agreed_at || now.toISOString();
  }

  // Keep a clear reason for settlement classification
  patch.review_reason = "force_majeure";
  patch.needs_review = false;

  const { data: updated, error: upErr } = await admin
    .from("bookings")
    .update(patch)
    .eq("id", booking_id)
    .select("id, force_majeure_borrower_agreed_at, force_majeure_owner_agreed_at, review_reason")
    .single();

  if (upErr || !updated) return json(500, { error: "Failed to record force majeure agreement", details: upErr?.message });

  const bothAgreed = !!updated.force_majeure_borrower_agreed_at && !!updated.force_majeure_owner_agreed_at;

  return json(200, {
    ok: true,
    booking_id,
    role: roleRaw,
    agreed_at: roleRaw === "borrower" ? updated.force_majeure_borrower_agreed_at : updated.force_majeure_owner_agreed_at,
    both_agreed: bothAgreed,
    message: bothAgreed
      ? "Both parties agreed ✅ Now call settle-booking to complete force majeure settlement."
      : "Agreement recorded ✅ Waiting for the other party.",
  });
});
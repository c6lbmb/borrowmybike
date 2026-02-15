// supabase/functions/agree-force-majeure/index.ts
// Records a Force Majeure agreement timestamp for the caller (borrower or owner) WITHOUT requiring direct client UPDATEs on bookings.
// This avoids RLS "permission denied for table bookings" while still validating the caller is a participant.

import { serve } from "https://deno.land/std@0.224.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.4";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

type AgreeRole = "borrower" | "owner";

serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }

  try {
    if (req.method !== "POST") {
      return json({ error: "Method not allowed" }, 405);
    }

    const supabaseUrl = Deno.env.get("SUPABASE_URL") ?? Deno.env.get("SUPABASE_PROJECT_URL");
    const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
    if (!supabaseUrl || !serviceKey) {
      return json({ error: "Missing server env (SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY)" }, 500);
    }

    const authHeader = req.headers.get("Authorization") ?? "";
    const anonKey = req.headers.get("apikey") ?? undefined;

    // Client scoped to the caller token (for auth.uid validation)
    const callerSb = createClient(supabaseUrl, anonKey ?? serviceKey, {
      global: { headers: { Authorization: authHeader } },
      auth: { persistSession: false, autoRefreshToken: false },
    });

    const { data: userData, error: userErr } = await callerSb.auth.getUser();
    if (userErr || !userData?.user) {
      return json({ error: "Unauthorized" }, 401);
    }
    const userId = userData.user.id;

    const body = await req.json().catch(() => ({}));
    const bookingId: string | undefined = body?.booking_id;
    const role: AgreeRole | undefined = body?.role;

    if (!bookingId || (role !== "borrower" && role !== "owner")) {
      return json({ error: "Missing booking_id or invalid role" }, 400);
    }

    // Service client to read/update booking (bypasses RLS) but we validate caller is participant.
    const adminSb = createClient(supabaseUrl, serviceKey, {
      auth: { persistSession: false, autoRefreshToken: false },
    });

    const { data: booking, error: bErr } = await adminSb
      .from("bookings")
      .select(
        "id, borrower_id, owner_id, borrower_checked_in, owner_checked_in, borrower_checked_in_at, owner_checked_in_at, scheduled_start_at, settled, cancelled, status, force_majeure_borrower_agreed_at, force_majeure_owner_agreed_at",
      )
      .eq("id", bookingId)
      .maybeSingle();

    if (bErr) return json({ error: "Failed to load booking", details: bErr.message }, 500);
    if (!booking) return json({ error: "Booking not found" }, 404);

    // Validate caller role matches booking participant
    if (role === "borrower" && booking.borrower_id !== userId) {
      return json({ error: "Not permitted (not booking borrower)" }, 403);
    }
    if (role === "owner" && booking.owner_id !== userId) {
      return json({ error: "Not permitted (not booking owner)" }, 403);
    }

    // Must be before ANY check-in
    const borrowerChecked = !!(booking.borrower_checked_in || booking.borrower_checked_in_at);
    const ownerChecked = !!(booking.owner_checked_in || booking.owner_checked_in_at);
    if (borrowerChecked || ownerChecked) {
      return json({ error: "Force majeure not allowed after check-in" }, 400);
    }

    // Must be before scheduled start, and within 24h before start
    const scheduledIso = booking.scheduled_start_at;
    if (!scheduledIso) {
      return json({ error: "Booking has no scheduled_start_at" }, 400);
    }
    const scheduledMs = new Date(scheduledIso).getTime();
    const nowMs = Date.now();

    if (!Number.isFinite(scheduledMs)) {
      return json({ error: "Invalid scheduled_start_at" }, 400);
    }
    if (nowMs >= scheduledMs) {
      return json({ error: "Force majeure must be claimed before scheduled start" }, 400);
    }
    const within24h = nowMs >= scheduledMs - 24 * 60 * 60 * 1000;
    if (!within24h) {
      return json({ error: "Force majeure is only available within 24h of the test start time" }, 400);
    }

    // Don't allow agreement if already settled/cancelled
    if (booking.settled) return json({ error: "Booking already settled" }, 400);
    if (booking.cancelled) return json({ error: "Booking is cancelled" }, 400);

    const nowIso = new Date().toISOString();
    const patch: Record<string, string> = {};
    if (role === "borrower") patch.force_majeure_borrower_agreed_at = nowIso;
    if (role === "owner") patch.force_majeure_owner_agreed_at = nowIso;

    const { data: updated, error: uErr } = await adminSb
      .from("bookings")
      .update(patch)
      .eq("id", bookingId)
      .select(
        "id, force_majeure_borrower_agreed_at, force_majeure_owner_agreed_at, scheduled_start_at, borrower_checked_in, owner_checked_in",
      )
      .single();

    if (uErr) return json({ error: "Failed to record agreement", details: uErr.message }, 500);

    const bothAgreed = !!updated.force_majeure_borrower_agreed_at && !!updated.force_majeure_owner_agreed_at;

    return json({ ok: true, booking_id: bookingId, role, both_agreed: bothAgreed, booking: updated }, 200);
  } catch (e) {
    return json({ error: "Internal Server Error", message: e?.message ?? String(e) }, 500);
  }
});

function json(payload: unknown, status = 200) {
  return new Response(JSON.stringify(payload), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}

// supabase/functions/set-owner-deposit-choice/index.ts
// Allows the booking owner to set how their deposit should be handled after settlement.

import { serve } from "https://deno.land/std@0.224.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

function json(status: number, body: unknown) {
  return new Response(JSON.stringify(body), {
    status,
    headers: {
      "Content-Type": "application/json",
      "Access-Control-Allow-Origin": "*",
      "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
      "Access-Control-Allow-Methods": "POST, OPTIONS",
    },
  });
}

serve(async (req) => {
  if (req.method === "OPTIONS") return json(200, { ok: true });
  if (req.method !== "POST") return json(405, { error: "Method not allowed" });

  try {
    const SUPABASE_URL = Deno.env.get("MY_SUPABASE_URL");
    const SERVICE_ROLE_KEY = Deno.env.get("MY_SUPABASE_SERVICE_ROLE_KEY");
    if (!SUPABASE_URL || !SERVICE_ROLE_KEY) {
      return json(500, { error: "Missing Supabase env" });
    }

    const supabase = createClient(SUPABASE_URL, SERVICE_ROLE_KEY, {
      global: { headers: { Authorization: req.headers.get("Authorization") ?? "" } },
    });

    // Authenticate caller
    const { data: userRes, error: userErr } = await supabase.auth.getUser();
    if (userErr || !userRes?.user) {
      return json(401, { error: "Unauthorized" });
    }

    const body = await req.json().catch(() => ({}));
    const booking_id = body.booking_id as string | undefined;
    const owner_deposit_choice = body.owner_deposit_choice as string | undefined;

    if (!booking_id) return json(400, { error: "Missing booking_id" });
    if (owner_deposit_choice !== "keep" && owner_deposit_choice !== "refund") {
      return json(400, { error: "Invalid owner_deposit_choice", allowed: ["keep", "refund"] });
    }

    // Fetch booking
    const { data: booking, error: bErr } = await supabase
      .from("bookings")
      .select("id, owner_id, settled")
      .eq("id", booking_id)
      .maybeSingle();

    if (bErr) return json(500, { error: "DB error", details: bErr.message });
    if (!booking) return json(404, { error: "Booking not found" });

    if (booking.owner_id !== userRes.user.id) {
      return json(403, { error: "Not the booking owner" });
    }

    if (booking.settled) {
      return json(409, { error: "Booking already settled" });
    }

    const { error: uErr } = await supabase
      .from("bookings")
      .update({ owner_deposit_choice })
      .eq("id", booking_id);

    if (uErr) {
      return json(500, { error: "Update failed", details: uErr.message });
    }

    return json(200, { ok: true, booking_id, owner_deposit_choice });
  } catch (e) {
    return json(500, { error: "Unexpected error", details: String(e) });
  }
});
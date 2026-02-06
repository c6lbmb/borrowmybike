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
const adminUserId = Deno.env.get("ADMIN_USER_ID")!;

// service role DB client (bypasses RLS)
const db = createClient(supabaseUrl, serviceRoleKey);

const SETTLE_FN_URL = `${supabaseUrl}/functions/v1/settle-booking`;

type Decision =
  | "approve_settle"
  | "reject_clear_flags"
  | "owner_fault"
  | "borrower_fault";

function json(status: number, body: unknown) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}

function getBearerToken(req: Request): string | null {
  const h = req.headers.get("Authorization") || req.headers.get("authorization");
  if (!h) return null;
  const m = h.match(/^Bearer\s+(.+)$/i);
  return m ? m[1] : null;
}

async function requireAdmin(req: Request): Promise<
  | { ok: true; admin_user_id: string }
  | { ok: false; status: number; error: string }
> {
  const token = getBearerToken(req);
  if (!token) return { ok: false, status: 401, error: "Missing Bearer token" };

  const { data, error } = await db.auth.getUser(token);
  if (error || !data?.user) {
    return { ok: false, status: 401, error: "Invalid token" };
  }

  const uid = data.user.id;
  if (!adminUserId) return { ok: false, status: 500, error: "ADMIN_USER_ID missing in secrets" };

  if (uid !== adminUserId) {
    return { ok: false, status: 403, error: "Not authorized (admin only)" };
  }

  return { ok: true, admin_user_id: uid };
}

async function logAction(
  booking_id: string,
  admin_user_id: string,
  action: string,
  note: string | null,
) {
  // Matches your table columns exactly: booking_id, admin_user_id, action, note
  const { error } = await db.from("admin_resolve_review_log").insert([{
    booking_id,
    admin_user_id,
    action,
    note,
  }]);

  if (error) {
    console.error("Failed to write admin_resolve_review_log:", error);
  }
}

async function callSettleBooking(booking_id: string) {
  const resp = await fetch(SETTLE_FN_URL, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      // service role bearer so settle-booking always has permissions
      "Authorization": `Bearer ${serviceRoleKey}`,
    },
    body: JSON.stringify({ booking_id, action: "settle" }),
  });

  const text = await resp.text();
  let jsonBody: any = null;
  try { jsonBody = JSON.parse(text); } catch { jsonBody = { raw: text }; }

  return { ok: resp.ok, http_status: resp.status, response: jsonBody };
}

serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  if (req.method !== "POST") return json(405, { error: "Only POST is allowed" });

  // 1) Admin auth
  const adminCheck = await requireAdmin(req);
  if (!adminCheck.ok) return json(adminCheck.status, { error: adminCheck.error });

  // 2) Parse body
  let body: any = null;
  try { body = await req.json(); } catch {
    return json(400, { error: "Invalid JSON body" });
  }

  const booking_id = String(body?.booking_id ?? "").trim();
  const decision = body?.decision as Decision | undefined;
  const note = (body?.note ?? null) as string | null;

  if (!booking_id) return json(400, { error: "booking_id is required" });
  if (!decision) {
    return json(400, {
      error: "decision is required",
      allowed: ["approve_settle", "reject_clear_flags", "owner_fault", "borrower_fault"],
    });
  }

  // 3) Load booking
  const { data: booking, error: bErr } = await db
    .from("bookings")
    .select("*")
    .eq("id", booking_id)
    .single();

  if (bErr || !booking) return json(404, { error: "Booking not found" });
  if (booking.cancelled) return json(400, { error: "Booking is cancelled" });
  if (booking.settled) return json(400, { error: "Booking already settled; cannot admin-resolve" });

  // 4) Apply decision
  if (decision === "reject_clear_flags") {
    const patch: Record<string, any> = {
      needs_review: false,

      // clear no-show flags
      treat_as_owner_no_show: false,
      treat_as_borrower_no_show: false,
      no_show_claimed_at: null,
      no_show_claimed_by: null,

      // clear bike invalid flags
      bike_invalid: false,
      bike_invalid_reason: null,
      bike_invalid_at: null,

      review_reason: null,
    };

    const { error: uErr } = await db.from("bookings").update(patch).eq("id", booking_id);
    if (uErr) return json(500, { error: "Failed to update booking", details: uErr });

    await logAction(booking_id, adminCheck.admin_user_id, "reject_clear_flags", note);

    return json(200, {
      booking_id,
      decision,
      message: "Review rejected. Flags cleared. No settlement executed.",
      needs_review: false,
    });
  }

  if (decision === "approve_settle") {
    const { error: uErr } = await db.from("bookings").update({
      needs_review: false,
    }).eq("id", booking_id);

    if (uErr) return json(500, { error: "Failed to update booking", details: uErr });

    const settle = await callSettleBooking(booking_id);
    await logAction(booking_id, adminCheck.admin_user_id, "approve_settle", note);

    return json(200, {
      booking_id,
      decision,
      message: "Approved. Settlement attempted.",
      settle,
    });
  }

  if (decision === "owner_fault") {
    const { error: uErr } = await db.from("bookings").update({
      needs_review: false,
      treat_as_owner_no_show: true,
      treat_as_borrower_no_show: false,
    }).eq("id", booking_id);

    if (uErr) return json(500, { error: "Failed to update booking", details: uErr });

    const settle = await callSettleBooking(booking_id);
    await logAction(booking_id, adminCheck.admin_user_id, "owner_fault", note);

    return json(200, {
      booking_id,
      decision,
      message: "Owner fault approved. Settlement attempted.",
      settle,
    });
  }

  if (decision === "borrower_fault") {
    const { error: uErr } = await db.from("bookings").update({
      needs_review: false,
      treat_as_borrower_no_show: true,
      treat_as_owner_no_show: false,
    }).eq("id", booking_id);

    if (uErr) return json(500, { error: "Failed to update booking", details: uErr });

    const settle = await callSettleBooking(booking_id);
    await logAction(booking_id, adminCheck.admin_user_id, "borrower_fault", note);

    return json(200, {
      booking_id,
      decision,
      message: "Borrower fault approved. Settlement attempted.",
      settle,
    });
  }

  return json(400, {
    error: "Unknown decision",
    allowed: ["approve_settle", "reject_clear_flags", "owner_fault", "borrower_fault"],
  });
});

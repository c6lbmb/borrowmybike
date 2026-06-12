import { serve } from "https://deno.land/std@0.177.0/http/server.ts";
import { createClient } from "https://cdn.jsdelivr.net/npm/@supabase/supabase-js/+esm";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "GET, OPTIONS",
};

const supabaseUrl = Deno.env.get("MY_SUPABASE_URL")!;
const serviceRoleKey = Deno.env.get("MY_SUPABASE_SERVICE_ROLE_KEY")!;
const adminUserId = Deno.env.get("ADMIN_USER_ID")!;

const db = createClient(supabaseUrl, serviceRoleKey);

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
  if (uid !== adminUserId) return { ok: false, status: 403, error: "Not authorized (admin only)" };

  return { ok: true, admin_user_id: uid };
}

serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  if (req.method !== "GET") return json(405, { error: "Only GET is allowed" });

  const adminCheck = await requireAdmin(req);
  if (!adminCheck.ok) return json(adminCheck.status, { error: adminCheck.error });

  const { data, error } = await db
    .from("bookings")
    .select("id,bike_id,borrower_id,owner_id,booking_date,scheduled_start_at,status,cancelled,settled,completed,needs_review,review_reason,needs_rebooking,registry_quadrant,test_taker_intro,tag_reason,borrower_checked_in,owner_checked_in,borrower_checked_in_at,owner_checked_in_at,created_at")
    .eq("needs_review", true)
    .order("scheduled_start_at", { ascending: true, nullsFirst: false })
    .order("booking_date", { ascending: true, nullsFirst: false });

  if (error) return json(500, { error: "Failed to fetch review bookings", details: error.message });

  return json(200, { bookings: data || [] });
});

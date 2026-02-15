import { serve } from "https://deno.land/std@0.192.0/http/server.ts";
import { createClient } from "https://cdn.jsdelivr.net/npm/@supabase/supabase-js/+esm";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

function json(status: number, body: unknown) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}

function isQuadrant(x: string) {
  return x === "NE" || x === "NW" || x === "SE" || x === "SW";
}

serve(async (req) => {
  // Always answer preflight
  if (req.method === "OPTIONS") return new Response(null, { status: 204, headers: corsHeaders });
  if (req.method !== "POST") return json(405, { error: "Method not allowed" });

  // ✅ Use Supabase-provided env vars (no MY_* custom names)
  const supabaseUrl = Deno.env.get("SUPABASE_URL");
  const serviceRoleKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
  const anonKey = Deno.env.get("SUPABASE_ANON_KEY");

  if (!supabaseUrl || !serviceRoleKey || !anonKey) {
    return json(500, {
      error: "Missing Supabase env vars in function runtime",
      details: {
        has_SUPABASE_URL: !!supabaseUrl,
        has_SUPABASE_SERVICE_ROLE_KEY: !!serviceRoleKey,
        has_SUPABASE_ANON_KEY: !!anonKey,
      },
    });
  }

  const service = createClient(supabaseUrl, serviceRoleKey);

  // Verify caller via Supabase Auth JWT
  const authHeader = req.headers.get("Authorization") || "";
  if (!authHeader.toLowerCase().startsWith("bearer ")) {
    return json(401, { error: "Missing Authorization bearer token" });
  }

  const authed = createClient(supabaseUrl, anonKey, {
    global: { headers: { Authorization: authHeader } },
  });

  const { data: u, error: uErr } = await authed.auth.getUser();
  if (uErr || !u?.user?.id) {
    return json(401, { error: "Invalid or expired session" });
  }

  let body: any;
  try {
    body = await req.json();
  } catch {
    return json(400, { error: "Invalid JSON body" });
  }

  const first_name =
    typeof body?.first_name === "string" ? body.first_name.trim().slice(0, 50) : "";
  const years_riding_raw = body?.years_riding;
  const years_riding =
    years_riding_raw === null || years_riding_raw === undefined || years_riding_raw === ""
      ? null
      : Number(years_riding_raw);

  const travel_raw = Array.isArray(body?.travel_quadrants) ? body.travel_quadrants : [];
  const travel_quadrants = travel_raw
    .map((x: any) => String(x || "").trim().toUpperCase())
    .filter((x: string) => isQuadrant(x));

  if (!first_name) return json(400, { error: "first_name is required" });
  if (years_riding !== null && (!Number.isFinite(years_riding) || years_riding < 0 || years_riding > 60)) {
    return json(400, { error: "years_riding must be a number between 0 and 60" });
  }
  if (!travel_quadrants.length) return json(400, { error: "travel_quadrants must include at least one quadrant" });

  const patch: any = { first_name, years_riding, travel_quadrants };

  const { data, error } = await service
    .from("users")
    .update(patch)
    .eq("id", u.user.id)
    .select("id, first_name, years_riding, travel_quadrants")
    .maybeSingle();

  if (error) return json(500, { error: "Failed to update profile", details: error.message });

  return json(200, { ok: true, profile: data });
});

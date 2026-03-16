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

function cleanText(value: unknown, max = 100): string {
  return typeof value === "string" ? value.trim().slice(0, max) : "";
}

function cleanStringArray(value: unknown, maxItems = 20, maxLen = 50): string[] {
  if (!Array.isArray(value)) return [];
  const seen = new Set<string>();

  const cleaned = value
    .map((x) => String(x ?? "").trim())
    .filter(Boolean)
    .map((x) => x.slice(0, maxLen))
    .filter((x) => {
      const key = x.toLowerCase();
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    });

  return cleaned.slice(0, maxItems);
}

function cleanNullableInt(value: unknown): number | null {
  if (value === null || value === undefined || value === "") return null;
  const n = Number(value);
  return Number.isFinite(n) ? Math.trunc(n) : null;
}

function cleanNullableBool(value: unknown): boolean | null {
  if (value === true) return true;
  if (value === false) return false;
  return null;
}

serve(async (req: Request) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { status: 204, headers: corsHeaders });
  }
  if (req.method !== "POST") {
    return json(405, { error: "Method not allowed" });
  }

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

  let body: Record<string, unknown>;
  try {
    body = await req.json();
  } catch {
    return json(400, { error: "Invalid JSON body" });
  }

  const first_name = cleanText(body.first_name, 50);
  const years_riding = cleanNullableInt(body.years_riding);

  const travel_raw = Array.isArray(body.travel_quadrants) ? body.travel_quadrants : [];
  const travel_quadrants = travel_raw
    .map((x) => String(x ?? "").trim().toUpperCase())
    .filter((x) => isQuadrant(x));

  const base_city = cleanText(body.base_city, 80);
  const service_cities = cleanStringArray(body.service_cities, 20, 80);
  const available_weekdays = cleanNullableBool(body.available_weekdays);
  const available_weekends = cleanNullableBool(body.available_weekends);
  const available_morning = cleanNullableBool(body.available_morning);
  const available_afternoon = cleanNullableBool(body.available_afternoon);
  const available_evening = cleanNullableBool(body.available_evening);
  const advance_notice_hours = cleanNullableInt(body.advance_notice_hours);
  const availability_notes = cleanText(body.availability_notes, 500);

  if (!first_name) {
    return json(400, { error: "first_name is required" });
  }

  if (
    years_riding !== null &&
    (!Number.isFinite(years_riding) || years_riding < 0 || years_riding > 80)
  ) {
    return json(400, { error: "years_riding must be a whole number between 0 and 80" });
  }

  if (
    advance_notice_hours !== null &&
    (!Number.isFinite(advance_notice_hours) ||
      advance_notice_hours < 0 ||
      advance_notice_hours > 336)
  ) {
    return json(400, {
      error: "advance_notice_hours must be a whole number between 0 and 336",
    });
  }

  const patch: Record<string, unknown> = {
    first_name,
    years_riding,
    travel_quadrants,
  };

  // Backward-compatible:
  // only update the newer fields if they were actually sent by the client.
  if ("base_city" in body) patch.base_city = base_city || null;
  if ("service_cities" in body) patch.service_cities = service_cities;
  if ("available_weekdays" in body) patch.available_weekdays = available_weekdays;
  if ("available_weekends" in body) patch.available_weekends = available_weekends;
  if ("available_morning" in body) patch.available_morning = available_morning;
  if ("available_afternoon" in body) patch.available_afternoon = available_afternoon;
  if ("available_evening" in body) patch.available_evening = available_evening;
  if ("advance_notice_hours" in body) patch.advance_notice_hours = advance_notice_hours;
  if ("availability_notes" in body) patch.availability_notes = availability_notes || null;

  const { data, error } = await service
    .from("users")
    .update(patch)
    .eq("id", u.user.id)
    .select(`
      id,
      first_name,
      years_riding,
      travel_quadrants,
      base_city,
      service_cities,
      available_weekdays,
      available_weekends,
      available_morning,
      available_afternoon,
      available_evening,
      advance_notice_hours,
      availability_notes
    `)
    .maybeSingle();

  if (error) {
    return json(500, { error: "Failed to update profile", details: error.message });
  }

  return json(200, { ok: true, profile: data });
});
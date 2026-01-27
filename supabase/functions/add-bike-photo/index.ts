import { serve } from "https://deno.land/std@0.177.0/http/server.ts";
import { createClient } from "https://cdn.jsdelivr.net/npm/@supabase/supabase-js/+esm";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

const supabaseUrl = Deno.env.get("MY_SUPABASE_URL")!;
const anonKey = Deno.env.get("MY_SUPABASE_ANON_KEY")!;

// This client uses the caller's JWT (RLS enforced)
function supabaseForUser(req: Request) {
  return createClient(supabaseUrl, anonKey, {
    global: { headers: { Authorization: req.headers.get("Authorization") || "" } },
  });
}

function json(status: number, body: unknown) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}

function isValidBikePhotoUrl(urlStr: string, bikeId: string) {
  try {
    const u = new URL(urlStr);

    // Must be from this project’s storage public endpoint
    // Example:
    // https://<project>.supabase.co/storage/v1/object/public/bike-photos/bikes/<bike_id>/<file>
    const path = u.pathname;

    if (!path.includes("/storage/v1/object/public/")) return { ok: false, reason: "Not a public storage URL" };

    const mustContain = `/storage/v1/object/public/bike-photos/bikes/${bikeId}/`;
    if (!path.includes(mustContain)) {
      return { ok: false, reason: `URL must be in bike-photos/bikes/${bikeId}/...` };
    }

    return { ok: true };
  } catch {
    return { ok: false, reason: "Invalid URL format" };
  }
}

serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  if (req.method !== "POST") return json(405, { error: "Only POST is allowed" });

  const supabase = supabaseForUser(req);

  // 1) Ensure user is authenticated
  const { data: authData, error: authErr } = await supabase.auth.getUser();
  if (authErr || !authData?.user) return json(401, { error: "Unauthorized" });
  const userId = authData.user.id;

  // 2) Parse body
  let body: any = null;
  try {
    body = await req.json();
  } catch {
    return json(400, { error: "Invalid JSON body" });
  }

  const bike_id = body?.bike_id;
  const photo_url = body?.photo_url;

  if (!bike_id) return json(400, { error: "bike_id is required" });
  if (!photo_url) return json(400, { error: "photo_url is required" });

  // 3) Validate URL format (must match our bucket/path pattern)
  const v = isValidBikePhotoUrl(String(photo_url), String(bike_id));
  if (!v.ok) return json(400, { error: "Invalid photo_url", reason: v.reason });

  // 4) Load bike and verify ownership (RLS should already enforce, but we also check explicitly)
  const { data: bike, error: bikeErr } = await supabase
    .from("bikes")
    .select("id, owner_id, photos")
    .eq("id", bike_id)
    .single();

  if (bikeErr || !bike) return json(404, { error: "Bike not found" });

  if (bike.owner_id !== userId) {
    return json(403, { error: "Forbidden: only the owner can add photos" });
  }

  // 5) Append URL to photos array (dedupe)
  const existing: string[] = Array.isArray(bike.photos) ? bike.photos : [];
  const url = String(photo_url);

  const next = existing.includes(url) ? existing : [...existing, url];

  const { error: updErr } = await supabase
    .from("bikes")
    .update({ photos: next })
    .eq("id", bike_id);

  if (updErr) return json(500, { error: "Failed to update bike photos", details: updErr });

  return json(200, {
    bike_id,
    added: !existing.includes(url),
    photos_count: next.length,
    photos: next,
    message: existing.includes(url) ? "Photo already existed ✅" : "Photo added ✅",
  });
});

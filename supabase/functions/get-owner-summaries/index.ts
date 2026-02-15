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

serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { status: 204, headers: corsHeaders });
  if (req.method !== "POST") return json(405, { error: "Method not allowed" });

  const supabaseUrl = Deno.env.get("SUPABASE_URL");
  const serviceRoleKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");

  if (!supabaseUrl || !serviceRoleKey) {
    return json(500, {
      error: "Missing Supabase env vars in function runtime",
      details: {
        has_SUPABASE_URL: !!supabaseUrl,
        has_SUPABASE_SERVICE_ROLE_KEY: !!serviceRoleKey,
      },
    });
  }

  const service = createClient(supabaseUrl, serviceRoleKey);

  let body: any;
  try {
    body = await req.json();
  } catch {
    return json(400, { error: "Invalid JSON body" });
  }

  const ownerIds: string[] = Array.isArray(body?.owner_ids) ? body.owner_ids : [];
  if (!ownerIds.length) return json(400, { error: "owner_ids must be a non-empty array" });

  const { data, error } = await service
    .from("users")
    .select("id, first_name, years_riding, travel_quadrants")
    .in("id", ownerIds);

  if (error) return json(500, { error: "Failed to load owner summaries", details: error.message });

  return json(200, { ok: true, owners: data ?? [] });
});

import { serve } from "https://deno.land/std@0.177.0/http/server.ts";
import { createClient } from "https://cdn.jsdelivr.net/npm/@supabase/supabase-js/+esm";

const supabaseUrl = Deno.env.get("MY_SUPABASE_URL")!;
const supabaseKey = Deno.env.get("MY_SUPABASE_SERVICE_ROLE_KEY")!;
const supabase = createClient(supabaseUrl, supabaseKey);

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type, Authorization",
};

const METRO_GROUPS: string[][] = [
  ["calgary", "airdrie", "chestermere", "cochrane", "okotoks", "de winton"],
  ["edmonton", "sherwood park", "st. albert", "spruce grove", "stony plain", "leduc", "beaumont", "fort saskatchewan"],
  ["red deer", "blackfalds", "lacombe", "penhold", "sylvan lake"],
  ["lethbridge", "coaldale", "coalhurst", "picture butte", "taber"],
  ["medicine hat", "redcliff"],
  ["grande prairie", "clairmont", "sexsmith"],
  ["fort mcmurray"],
  ["vancouver", "burnaby", "new westminster", "surrey", "coquitlam", "port coquitlam", "port moody", "richmond", "delta", "langley", "abbotsford"],
];

function normalize(value: string | null | undefined) {
  return String(value || "").trim().toLowerCase();
}

function getMetroCities(city: string) {
  const normalized = normalize(city);
  for (const group of METRO_GROUPS) {
    if (group.includes(normalized)) return group;
  }
  return normalized ? [normalized] : [];
}

serve(async (req: Request) => {
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }

  if (req.method !== "GET") {
    return new Response(JSON.stringify({ error: "Method not allowed" }), {
      status: 405,
      headers: {
        ...corsHeaders,
        "Content-Type": "application/json",
      },
    });
  }

  try {
    const url = new URL(req.url);
    const city = url.searchParams.get("city");
    const province = (url.searchParams.get("province") || "AB").toUpperCase();

    let query = supabase
      .from("registries")
      .select("*")
      .eq("is_active", true)
      .eq("province", province)
      .order("city", { ascending: true })
      .order("name", { ascending: true });

    const { data, error } = await query;

    if (error) {
      console.error("Error fetching registries:", error);
      return new Response(JSON.stringify({ error: "Failed to fetch registries" }), {
        status: 500,
        headers: {
          ...corsHeaders,
          "Content-Type": "application/json",
        },
      });
    }

    let registries = data ?? [];

    if (city) {
      const metroSet = new Set(getMetroCities(city));
      const normalizedCity = normalize(city);

      registries = registries
        .filter((r: any) => metroSet.has(normalize(r.city)))
        .sort((a: any, b: any) => {
          const aExact = normalize(a.city) === normalizedCity ? 0 : 1;
          const bExact = normalize(b.city) === normalizedCity ? 0 : 1;
          if (aExact !== bExact) return aExact - bExact;

          const byCity = normalize(a.city).localeCompare(normalize(b.city));
          if (byCity !== 0) return byCity;

          return String(a.name || "").localeCompare(String(b.name || ""));
        });
    }

    return new Response(JSON.stringify({ registries }), {
      status: 200,
      headers: {
        ...corsHeaders,
        "Content-Type": "application/json",
      },
    });
  } catch (err) {
    console.error("Unexpected error in list-registries:", err);
    return new Response(JSON.stringify({ error: "Unexpected error" }), {
      status: 500,
      headers: {
        ...corsHeaders,
        "Content-Type": "application/json",
      },
    });
  }
});
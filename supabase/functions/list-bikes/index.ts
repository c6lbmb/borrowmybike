import { serve } from "https://deno.land/std@0.177.0/http/server.ts";
import { createClient } from "https://cdn.jsdelivr.net/npm/@supabase/supabase-js/+esm";

const supabaseUrl = Deno.env.get("MY_SUPABASE_URL")!;
const supabaseKey = Deno.env.get("MY_SUPABASE_SERVICE_ROLE_KEY")!;
const supabase = createClient(supabaseUrl, supabaseKey);

const corsHeaders = {
  "Access-Control-Allow-Origin": "*", // later: lock to your real domain
  "Access-Control-Allow-Methods": "GET, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type, Authorization",
};

serve(async (req) => {
  // CORS preflight
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }

  if (req.method !== "GET") {
    return new Response(JSON.stringify({ error: "Method not allowed" }), {
      status: 405,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }

  try {
    const url = new URL(req.url);
    const city = url.searchParams.get("city"); // optional
    const onlyReady = url.searchParams.get("only_ready"); // "true" or null

    // 1) Fetch bikes, with basic filters
    let query = supabase
      .from("bikes")
      .select("*")
      .eq("is_active", true);

    if (city && city.trim() !== "") {
      // later you can normalize city names; for now use exact match
      query = query.eq("city", city);
    }

    if (onlyReady === "true") {
      query = query.eq("is_road_test_ready", true);
    }

    const { data: bikes, error: bikesError } = await query;

    if (bikesError) {
      console.error("Error fetching bikes:", bikesError);
      return new Response(
        JSON.stringify({ error: "Failed to fetch bikes" }),
        {
          status: 500,
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        },
      );
    }

    if (!bikes || bikes.length === 0) {
      return new Response(JSON.stringify({ bikes: [] }), {
        status: 200,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // 2) Fetch reviews just for these bike IDs
    const bikeIds = bikes.map((b: any) => b.id);

    const { data: reviews, error: reviewsError } = await supabase
      .from("reviews")
      .select("bike_id, owner_rating, bike_rating")
      .in("bike_id", bikeIds);

    if (reviewsError) {
      console.error("Error fetching reviews:", reviewsError);
      // still return bikes, just without ratings
      return new Response(
        JSON.stringify({ bikes, warnings: ["failed_to_fetch_ratings"] }),
        {
          status: 200,
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        },
      );
    }

    // 3) Aggregate ratings per bike
    const ratingsByBike: Record<
      string,
      {
        ownerSum: number;
        ownerCount: number;
        bikeSum: number;
        bikeCount: number;
      }
    > = {};

    for (const r of reviews ?? []) {
      const bikeId = r.bike_id as string;
      if (!ratingsByBike[bikeId]) {
        ratingsByBike[bikeId] = {
          ownerSum: 0,
          ownerCount: 0,
          bikeSum: 0,
          bikeCount: 0,
        };
      }

      if (typeof r.owner_rating === "number" && r.owner_rating >= 1 && r.owner_rating <= 5) {
        ratingsByBike[bikeId].ownerSum += r.owner_rating;
        ratingsByBike[bikeId].ownerCount += 1;
      }

      if (typeof r.bike_rating === "number" && r.bike_rating >= 1 && r.bike_rating <= 5) {
        ratingsByBike[bikeId].bikeSum += r.bike_rating;
        ratingsByBike[bikeId].bikeCount += 1;
      }
    }

    const bikesWithRatings = bikes.map((b: any) => {
      const r = ratingsByBike[b.id];

      let ownerRatingAvg: number | null = null;
      let bikeRatingAvg: number | null = null;
      let ratingCount = 0;

      if (r) {
        if (r.ownerCount > 0) {
          ownerRatingAvg = r.ownerSum / r.ownerCount;
        }
        if (r.bikeCount > 0) {
          bikeRatingAvg = r.bikeSum / r.bikeCount;
        }
        ratingCount = Math.max(r.ownerCount, r.bikeCount);
      }

      return {
        ...b,
        owner_rating_avg: ownerRatingAvg,
        bike_rating_avg: bikeRatingAvg,
        rating_count: ratingCount,
      };
    });

    return new Response(JSON.stringify({ bikes: bikesWithRatings }), {
      status: 200,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (err) {
    console.error("Unexpected error in list-bikes:", err);
    return new Response(JSON.stringify({ error: "Unexpected error" }), {
      status: 500,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});

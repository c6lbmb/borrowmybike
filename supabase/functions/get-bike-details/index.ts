import { serve } from "https://deno.land/std@0.177.0/http/server.ts";
import { createClient } from "https://cdn.jsdelivr.net/npm/@supabase/supabase-js/+esm";

const supabaseUrl = Deno.env.get("MY_SUPABASE_URL")!;
const supabaseKey = Deno.env.get("MY_SUPABASE_SERVICE_ROLE_KEY")!;
const supabase = createClient(supabaseUrl, supabaseKey);

const corsHeaders = {
  "Access-Control-Allow-Origin": "*", // later we’ll lock this to your real domain
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
      headers: {
        ...corsHeaders,
        "Content-Type": "application/json",
      },
    });
  }

  try {
    const url = new URL(req.url);
    const bikeId = url.searchParams.get("bike_id");

    if (!bikeId) {
      return new Response(
        JSON.stringify({ error: "bike_id query parameter is required" }),
        {
          status: 400,
          headers: {
            ...corsHeaders,
            "Content-Type": "application/json",
          },
        }
      );
    }

    // 1) Fetch the bike
    const { data: bike, error: bikeError } = await supabase
      .from("bikes")
      .select("*")
      .eq("id", bikeId)
      .single();

    if (bikeError) {
      console.error("Error fetching bike:", bikeError);
      return new Response(JSON.stringify({ error: "Failed to fetch bike" }), {
        status: 500,
        headers: {
          ...corsHeaders,
          "Content-Type": "application/json",
        },
      });
    }

    if (!bike) {
      return new Response(JSON.stringify({ error: "Bike not found" }), {
        status: 404,
        headers: {
          ...corsHeaders,
          "Content-Type": "application/json",
        },
      });
    }

    // 2) Fetch minimal owner info (safe to show to borrowers)
    let ownerSummary: any = null;

    if (bike.owner_id) {
      const { data: owner, error: ownerError } = await supabase
        .from("users")
        .select("id, name, city, role")
        .eq("id", bike.owner_id)
        .maybeSingle(); // ok if null

      if (ownerError) {
        console.error("Error fetching owner:", ownerError);
      } else if (owner) {
        ownerSummary = {
          id: owner.id,
          name: owner.name,
          city: owner.city ?? null,
          role: owner.role ?? null,
        };
      }
    }

    // 3) Fetch all reviews for this bike
    const { data: reviews, error: reviewsError } = await supabase
      .from("reviews")
      .select("id, owner_rating, bike_rating, comment, created_at, borrower_id")
      .eq("bike_id", bikeId)
      .order("created_at", { ascending: false });

    if (reviewsError) {
      console.error("Error fetching reviews:", reviewsError);
    }

    // 4) Compute averages and pick latest 3 reviews
    let ownerRatingAvg: number | null = null;
    let bikeRatingAvg: number | null = null;
    let ratingCount = 0;

    if (reviews && reviews.length > 0) {
      let ownerSum = 0;
      let ownerCount = 0;
      let bikeSum = 0;
      let bikeCount = 0;

      for (const r of reviews) {
        if (
          typeof r.owner_rating === "number" &&
          r.owner_rating >= 1 &&
          r.owner_rating <= 5
        ) {
          ownerSum += r.owner_rating;
          ownerCount += 1;
        }
        if (
          typeof r.bike_rating === "number" &&
          r.bike_rating >= 1 &&
          r.bike_rating <= 5
        ) {
          bikeSum += r.bike_rating;
          bikeCount += 1;
        }
      }

      if (ownerCount > 0) {
        ownerRatingAvg = ownerSum / ownerCount;
      }
      if (bikeCount > 0) {
        bikeRatingAvg = bikeSum / bikeCount;
      }
      ratingCount = Math.max(ownerCount, bikeCount);
    }

    const recentReviews = (reviews ?? []).slice(0, 3);

    const result = {
      bike,
      owner: ownerSummary,
      ratings: {
        owner_rating_avg: ownerRatingAvg,
        bike_rating_avg: bikeRatingAvg,
        rating_count: ratingCount,
      },
      recent_reviews: recentReviews,
    };

    return new Response(JSON.stringify(result), {
      status: 200,
      headers: {
        ...corsHeaders,
        "Content-Type": "application/json",
      },
    });
  } catch (err) {
    console.error("Unexpected error in get-bike-details:", err);
    return new Response(JSON.stringify({ error: "Unexpected error" }), {
      status: 500,
      headers: {
        ...corsHeaders,
        "Content-Type": "application/json",
      },
    });
  }
});

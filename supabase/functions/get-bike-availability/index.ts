import { serve } from "https://deno.land/std@0.177.0/http/server.ts";
import { createClient } from "https://cdn.jsdelivr.net/npm/@supabase/supabase-js/+esm";

const supabaseUrl = Deno.env.get("MY_SUPABASE_URL")!;
const supabaseKey = Deno.env.get("MY_SUPABASE_SERVICE_ROLE_KEY")!;
const supabase = createClient(supabaseUrl, supabaseKey);

const corsHeaders = {
  "Access-Control-Allow-Origin": "*", // later: lock this to your real domain
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
    const dateParam = url.searchParams.get("date"); // optional: YYYY-MM-DD

    if (!bikeId) {
      return new Response(
        JSON.stringify({ error: "bike_id is required" }),
        {
          status: 400,
          headers: {
            ...corsHeaders,
            "Content-Type": "application/json",
          },
        }
      );
    }

    // Base query: all *future* bookings for this bike that are not cancelled
    let query = supabase
      .from("bookings")
      .select(
        "id, booking_date, duration_minutes, cancelled, cancelled_by, treat_as_owner_no_show, borrower_paid, owner_deposit_paid, completed"
      )
      .eq("bike_id", bikeId)
      .eq("cancelled", false)
      .eq("treat_as_owner_no_show", false);

    // Only future bookings
    const nowIso = new Date().toISOString();
    query = query.gte("booking_date", nowIso);

    // If a specific date is provided, limit to that day
    let startOfDayIso: string | null = null;
    let endOfDayIso: string | null = null;

    if (dateParam) {
      // Expecting YYYY-MM-DD
      const dateString = dateParam.trim();
      if (!/^\d{4}-\d{2}-\d{2}$/.test(dateString)) {
        return new Response(
          JSON.stringify({
            error: "date must be in format YYYY-MM-DD if provided",
          }),
          {
            status: 400,
            headers: {
              ...corsHeaders,
              "Content-Type": "application/json",
            },
          }
        );
      }

      // Interpret date in UTC for simplicity
      startOfDayIso = new Date(dateString + "T00:00:00Z").toISOString();
      endOfDayIso = new Date(dateString + "T23:59:59Z").toISOString();

      query = query
        .gte("booking_date", startOfDayIso)
        .lte("booking_date", endOfDayIso);
    }

    const { data: bookings, error } = await query;

    if (error) {
      console.error("Error fetching availability bookings:", error);
      return new Response(
        JSON.stringify({ error: "Failed to fetch availability" }),
        {
          status: 500,
          headers: {
            ...corsHeaders,
            "Content-Type": "application/json",
          },
        }
      );
    }

    // If date was provided, say whether the bike is free that day
    let isAvailableOnDate: boolean | null = null;
    if (dateParam) {
      isAvailableOnDate = (bookings?.length ?? 0) === 0;
    }

    return new Response(
      JSON.stringify({
        bike_id: bikeId,
        date: dateParam ?? null,
        is_available_on_date: isAvailableOnDate,
        bookings: bookings ?? [],
      }),
      {
        status: 200,
        headers: {
          ...corsHeaders,
          "Content-Type": "application/json",
        },
      }
    );
  } catch (err) {
    console.error("Unexpected error in get-bike-availability:", err);
    return new Response(JSON.stringify({ error: "Unexpected error" }), {
      status: 500,
      headers: {
        ...corsHeaders,
        "Content-Type": "application/json",
      },
    });
  }
});

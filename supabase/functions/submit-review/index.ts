import { serve } from "https://deno.land/std@0.177.0/http/server.ts";
import { createClient } from "https://cdn.jsdelivr.net/npm/@supabase/supabase-js/+esm";

const supabaseUrl = Deno.env.get("MY_SUPABASE_URL")!;
const supabaseKey = Deno.env.get("MY_SUPABASE_SERVICE_ROLE_KEY")!;
const supabase = createClient(supabaseUrl, supabaseKey);

serve(async (req) => {
  if (req.method !== "POST") {
    return new Response(
      JSON.stringify({ error: "Only POST is allowed" }),
      { status: 405, headers: { "Content-Type": "application/json" } },
    );
  }

  let body: any;
  try {
    body = await req.json();
  } catch (_err) {
    return new Response(
      JSON.stringify({ error: "Invalid JSON body" }),
      { status: 400, headers: { "Content-Type": "application/json" } },
    );
  }

  const {
    booking_id,
    borrower_id,
    rating_owner,
    rating_bike,
    comment,
  } = body ?? {};

  // Basic validation
  if (!booking_id || !borrower_id) {
    return new Response(
      JSON.stringify({ error: "booking_id and borrower_id are required" }),
      { status: 400, headers: { "Content-Type": "application/json" } },
    );
  }

  if (
    typeof rating_owner !== "number" ||
    rating_owner < 1 ||
    rating_owner > 5
  ) {
    return new Response(
      JSON.stringify({
        error: "rating_owner must be a number between 1 and 5",
      }),
      { status: 400, headers: { "Content-Type": "application/json" } },
    );
  }

  if (
    typeof rating_bike !== "number" ||
    rating_bike < 1 ||
    rating_bike > 5
  ) {
    return new Response(
      JSON.stringify({
        error: "rating_bike must be a number between 1 and 5",
      }),
      { status: 400, headers: { "Content-Type": "application/json" } },
    );
  }

  // 1) Fetch the booking
  const { data: booking, error: bookingError } = await supabase
    .from("bookings")
    .select("*")
    .eq("id", booking_id)
    .single();

  if (bookingError || !booking) {
    console.error("Booking fetch error:", bookingError);
    return new Response(
      JSON.stringify({ error: "Booking not found" }),
      { status: 404, headers: { "Content-Type": "application/json" } },
    );
  }

  // Must be completed
  if (!booking.completed) {
    return new Response(
      JSON.stringify({ error: "Booking is not completed yet" }),
      { status: 400, headers: { "Content-Type": "application/json" } },
    );
  }

  // Borrower must match
  if (booking.borrower_id !== borrower_id) {
    return new Response(
      JSON.stringify({ error: "Borrower does not match this booking" }),
      { status: 403, headers: { "Content-Type": "application/json" } },
    );
  }

  // Optional: check if a review already exists
  const { data: existingReview, error: existingError } = await supabase
    .from("reviews")
    .select("id")
    .eq("booking_id", booking_id)
    .maybeSingle();

  if (existingError) {
    console.error("Error checking existing review:", existingError);
  }

  if (existingReview) {
    return new Response(
      JSON.stringify({
        error: "Review already submitted for this booking",
      }),
      { status: 400, headers: { "Content-Type": "application/json" } },
    );
  }

  // 2) Insert review
  // IMPORTANT: these property names match your DB columns: owner_rating, bike_rating
  const { data: inserted, error: insertError } = await supabase
    .from("reviews")
    .insert([
      {
        booking_id,
        borrower_id,
        owner_id: booking.owner_id,
        bike_id: booking.bike_id,
        owner_rating: rating_owner,
        bike_rating: rating_bike,
        comment: comment ?? null,
      },
    ])
    .select()
    .single();

  if (insertError) {
    console.error("Review insert error:", insertError);
    return new Response(
      JSON.stringify({
        error: "Failed to create review",
        details: insertError,
      }),
      { status: 500, headers: { "Content-Type": "application/json" } },
    );
  }

  return new Response(
    JSON.stringify({
      message: "Review submitted successfully",
      review: inserted,
    }),
    { status: 201, headers: { "Content-Type": "application/json" } },
  );
});

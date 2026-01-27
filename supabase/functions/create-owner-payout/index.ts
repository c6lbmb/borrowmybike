import { serve } from "https://deno.land/std@0.177.0/http/server.ts";
import { createClient } from "https://cdn.jsdelivr.net/npm/@supabase/supabase-js/+esm";

const supabaseUrl = Deno.env.get("MY_SUPABASE_URL")!;
const supabaseKey = Deno.env.get("MY_SUPABASE_SERVICE_ROLE_KEY")!;
const supabase = createClient(supabaseUrl, supabaseKey);

// For now, flat $100 owner payout per completed booking
const OWNER_PAYOUT_AMOUNT = 100; // dollars
const CURRENCY = "CAD";

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

  const { booking_id } = body ?? {};

  if (!booking_id) {
    return new Response(
      JSON.stringify({ error: "booking_id is required" }),
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

  // Make sure it's completed and not cancelled
  if (!booking.completed) {
    return new Response(
      JSON.stringify({ error: "Booking is not completed yet" }),
      { status: 400, headers: { "Content-Type": "application/json" } },
    );
  }

  if (booking.cancelled) {
    return new Response(
      JSON.stringify({ error: "Cannot pay out on a cancelled booking" }),
      { status: 400, headers: { "Content-Type": "application/json" } },
    );
  }

  // Make sure borrower + owner actually paid
  if (!booking.borrower_paid || !booking.owner_deposit_paid) {
    return new Response(
      JSON.stringify({
        error: "Borrower and owner payments must be completed before payout",
      }),
      { status: 400, headers: { "Content-Type": "application/json" } },
    );
  }

  // Don't double-pay
  if (booking.owner_payout_done) {
    return new Response(
      JSON.stringify({
        error: "Owner payout already recorded for this booking",
      }),
      { status: 400, headers: { "Content-Type": "application/json" } },
    );
  }

  if (!booking.owner_id) {
    return new Response(
      JSON.stringify({
        error: "Booking is missing owner_id",
      }),
      { status: 400, headers: { "Content-Type": "application/json" } },
    );
  }

  // 2) Insert a payout record into payments (internal tracking)
  const { data: payment, error: paymentError } = await supabase
    .from("payments")
    .insert([
      {
        booking_id,
        owner_id: booking.owner_id,
        borrower_id: booking.borrower_id,
        amount: OWNER_PAYOUT_AMOUNT,
        currency: CURRENCY,
        status: "pending",          // when you actually pay, you can flip this to "paid"
        payment_type: "owner_payout",
        stripe_id: null,            // later, when you use Stripe Connect, store transfer ID here
      },
    ])
    .select()
    .single();

  if (paymentError) {
    console.error("Owner payout insert error:", paymentError);
    return new Response(
      JSON.stringify({
        error: "Failed to create owner payout record",
        details: paymentError,
      }),
      { status: 500, headers: { "Content-Type": "application/json" } },
    );
  }

  // 3) Update booking to mark payout as created
  const { error: updateError } = await supabase
    .from("bookings")
    .update({
      owner_payout_amount: OWNER_PAYOUT_AMOUNT,
      owner_payout_done: true,
      owner_payout_at: new Date().toISOString(),
    })
    .eq("id", booking_id);

  if (updateError) {
    console.error("Booking update error (owner payout):", updateError);
    // Note: payment row exists, but booking failed to update – you can fix that manually later
    return new Response(
      JSON.stringify({
        error: "Owner payout created but failed to update booking",
        payout: payment,
        details: updateError,
      }),
      { status: 500, headers: { "Content-Type": "application/json" } },
    );
  }

  return new Response(
    JSON.stringify({
      message: "Owner payout recorded",
      booking_id,
      payout_amount: OWNER_PAYOUT_AMOUNT,
      currency: CURRENCY,
      payment,
    }),
    { status: 201, headers: { "Content-Type": "application/json" } },
  );
});

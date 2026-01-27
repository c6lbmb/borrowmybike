import { serve } from "https://deno.land/std@0.177.0/http/server.ts";
import { createClient } from "https://cdn.jsdelivr.net/npm/@supabase/supabase-js/+esm";

const supabaseUrl = Deno.env.get("MY_SUPABASE_URL")!;
const supabaseKey = Deno.env.get("MY_SUPABASE_SERVICE_ROLE_KEY")!;
const supabase = createClient(supabaseUrl, supabaseKey);

serve(async (req) => {
  const body = await req.text();

  console.log("🔥 Full Stripe event payload:", body);

  let event: any;
  try {
    event = JSON.parse(body);
  } catch (err) {
    console.error("❌ Failed to parse body:", err);
    return new Response("Invalid JSON", { status: 400 });
  }

  if (!event?.type) {
    console.error("❌ Missing event type");
    return new Response("Bad Event", { status: 400 });
  }

  console.log("➡️ Received Stripe event type:", event.type);

  if (event.type === "payment_intent.succeeded") {
    const paymentIntent = event.data?.object;
    if (!paymentIntent) {
      console.error("❌ Missing paymentIntent object");
      return new Response("Missing paymentIntent", { status: 400 });
    }

    const {
      id,
      amount_received,
      currency,
      metadata,
    } = paymentIntent;

    const paymentType = metadata?.payment_type ?? null;
    const bookingId = metadata?.booking_id ?? null;

    console.log("💰 PaymentIntent succeeded:", {
      id,
      amount_received,
      paymentType,
      bookingId,
    });

    /* ------------------------------------------------------------------
       1) INSERT PAYMENT RECORD
    ------------------------------------------------------------------ */
    const { data: paymentData, error: paymentError } = await supabase
      .from("payments")
      .insert([
        {
          stripe_id: id,
          stripe_payment_intent_id: id,
          amount: amount_received / 100,
          currency: currency?.toUpperCase() ?? "CAD",
          status: "succeeded",
          booking_id: bookingId,
          borrower_id: metadata?.borrower_id ?? null,
          owner_id: metadata?.owner_id ?? null,
          payment_type: paymentType,
        },
      ])
      .select();

    if (paymentError) {
      console.error("❌ Supabase insert error (payments):", paymentError);
    } else {
      console.log("✅ Payment recorded:", paymentData);
    }

    /* ------------------------------------------------------------------
       2) UPDATE BOOKING STATE
       - pending_payment → confirmed
       - clear payment_expires_at
       - set payment flags
    ------------------------------------------------------------------ */
    if (bookingId && paymentType) {
      let updateFields: Record<string, any> = {
        stripe_payment_intent_id: id,
        status: "confirmed",
        payment_expires_at: null,
      };

      if (paymentType === "borrower_booking") {
        updateFields.borrower_paid = true;
      } else if (paymentType === "owner_deposit") {
        updateFields.owner_deposit_paid = true;
      }

      const { data: bookingData, error: bookingError } = await supabase
        .from("bookings")
        .update(updateFields)
        .eq("id", bookingId)
        .select();

      if (bookingError) {
        console.error("❌ Supabase update error (bookings):", bookingError);
      } else {
        console.log("✅ Booking updated:", bookingData);
      }
    } else {
      console.log("ℹ️ No booking_id or payment_type — skipping booking update");
    }
  }

  return new Response(
    JSON.stringify({ received: true }),
    { headers: { "Content-Type": "application/json" } },
  );
});

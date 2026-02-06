// supabase/functions/stripe-webhook/index.ts
import { serve } from "https://deno.land/std@0.177.0/http/server.ts";
import { createClient } from "https://cdn.jsdelivr.net/npm/@supabase/supabase-js/+esm";

const supabaseUrl = Deno.env.get("MY_SUPABASE_URL")!;
const supabaseKey = Deno.env.get("MY_SUPABASE_SERVICE_ROLE_KEY")!;
const supabase = createClient(supabaseUrl, supabaseKey);

const STRIPE_WEBHOOK_SECRET = Deno.env.get("STRIPE_WEBHOOK_SECRET")!;

// Stripe recommends a tolerance window (seconds)
const DEFAULT_TOLERANCE_SEC = 5 * 60;

function toUint8(s: string) {
  return new TextEncoder().encode(s);
}

function hexToBytes(hex: string) {
  const clean = hex.trim().toLowerCase();
  if (clean.length % 2 !== 0) throw new Error("Invalid hex length");
  const out = new Uint8Array(clean.length / 2);
  for (let i = 0; i < out.length; i++) out[i] = parseInt(clean.slice(i * 2, i * 2 + 2), 16);
  return out;
}

// Constant-time compare
function timingSafeEqual(a: Uint8Array, b: Uint8Array) {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a[i] ^ b[i];
  return diff === 0;
}

async function hmacSha256Hex(secret: string, payload: string) {
  const key = await crypto.subtle.importKey(
    "raw",
    toUint8(secret),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"],
  );
  const sig = await crypto.subtle.sign("HMAC", key, toUint8(payload));
  const bytes = new Uint8Array(sig);
  return Array.from(bytes).map((b) => b.toString(16).padStart(2, "0")).join("");
}

function parseStripeSigHeader(header: string) {
  // Example: "t=1700000000,v1=abcdef...,v0=..."
  const parts = header.split(",").map((p) => p.trim());
  const out: Record<string, string[]> = {};
  for (const p of parts) {
    const [k, v] = p.split("=");
    if (!k || !v) continue;
    out[k] = out[k] || [];
    out[k].push(v);
  }
  const t = out["t"]?.[0];
  const v1 = out["v1"] || [];
  return { t, v1 };
}

async function verifyStripeSignatureOrThrow(args: {
  rawBody: string;
  sigHeader: string | null;
  toleranceSec?: number;
}) {
  const { rawBody, sigHeader, toleranceSec = DEFAULT_TOLERANCE_SEC } = args;

  if (!STRIPE_WEBHOOK_SECRET) throw new Error("Missing STRIPE_WEBHOOK_SECRET env var");
  if (!sigHeader) throw new Error("Missing Stripe-Signature header");

  const { t, v1 } = parseStripeSigHeader(sigHeader);
  if (!t) throw new Error("Stripe-Signature missing timestamp");
  if (!v1.length) throw new Error("Stripe-Signature missing v1 signature");

  const ts = Number(t);
  if (!Number.isFinite(ts)) throw new Error("Invalid Stripe timestamp");

  const nowSec = Math.floor(Date.now() / 1000);
  const age = Math.abs(nowSec - ts);
  if (age > toleranceSec) {
    throw new Error(`Stripe signature timestamp outside tolerance (${age}s > ${toleranceSec}s)`);
  }

  const signedPayload = `${t}.${rawBody}`;
  const expectedHex = await hmacSha256Hex(STRIPE_WEBHOOK_SECRET, signedPayload);
  const expectedBytes = hexToBytes(expectedHex);

  // Stripe may include multiple v1 signatures; accept if any match.
  for (const candidateHex of v1) {
    try {
      const candidateBytes = hexToBytes(candidateHex);
      if (timingSafeEqual(expectedBytes, candidateBytes)) return true;
    } catch {
      // ignore malformed signature
    }
  }

  throw new Error("Stripe signature verification failed");
}

serve(async (req) => {
  if (req.method !== "POST") return new Response("Only POST", { status: 405 });

  const rawBody = await req.text();
  const sigHeader = req.headers.get("stripe-signature");

  // 0) Verify Stripe signature (this is the actual security gate)
  try {
    await verifyStripeSignatureOrThrow({ rawBody, sigHeader });
  } catch (e: any) {
    console.error("❌ Stripe signature verify failed:", e?.message || e);
    return new Response("Invalid signature", { status: 400 });
  }

  let event: any;
  try {
    event = JSON.parse(rawBody);
  } catch (e) {
    console.error("❌ Invalid JSON:", e);
    return new Response("Invalid JSON", { status: 400 });
  }

  if (!event?.type) return new Response("Missing event type", { status: 400 });

  // Handle payment success
  if (event.type === "payment_intent.succeeded") {
    const paymentIntent = event.data?.object;
    if (!paymentIntent) return new Response("Missing paymentIntent", { status: 400 });

    const { id, amount_received, currency, metadata } = paymentIntent;

    const paymentType = metadata?.payment_type ?? null;
    const bookingId = metadata?.booking_id ?? null;

    console.log("✅ payment_intent.succeeded", { id, amount_received, paymentType, bookingId });

    // 1) Record payment (idempotency: avoid duplicates by stripe_payment_intent_id)
    const { error: paymentError } = await supabase
      .from("payments")
      .insert([{
        stripe_id: id,
        stripe_payment_intent_id: id,
        amount: (amount_received ?? 0) / 100,
        currency: (currency?.toUpperCase?.() ?? "CAD"),
        status: "succeeded",
        booking_id: bookingId,
        borrower_id: metadata?.borrower_id ?? null,
        owner_id: metadata?.owner_id ?? null,
        payment_type: paymentType,
      }]);

    // If this fails due to unique constraint, it’s usually fine (webhook retry)
    if (paymentError) console.error("payments insert error:", paymentError);

    // 2) Update booking flags
    if (bookingId && paymentType) {
      const updateFields: Record<string, any> = {
        stripe_payment_intent_id: id,
        status: "confirmed",
        payment_expires_at: null,
      };

      if (paymentType === "borrower_booking") updateFields.borrower_paid = true;
      if (paymentType === "owner_deposit") updateFields.owner_deposit_paid = true;

      const { error: bookingError } = await supabase
        .from("bookings")
        .update(updateFields)
        .eq("id", bookingId);

      if (bookingError) console.error("bookings update error:", bookingError);
    }
  }

  return new Response(JSON.stringify({ received: true }), {
    headers: { "Content-Type": "application/json" },
    status: 200,
  });
});

// supabase/functions/stripe-webhook/index.ts
import { serve } from "https://deno.land/std@0.177.0/http/server.ts";
import { createClient } from "https://cdn.jsdelivr.net/npm/@supabase/supabase-js/+esm";
import { sendEmail } from "../_shared/sendEmail.ts";
import { hasNotificationBeenSent, logNotificationSent } from "../_shared/notificationLog.ts";

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
function scheduledIsoFor(booking: { booking_date?: string | null }) {
  return booking.booking_date ?? null;
}

function acceptanceHoursForBooking(booking: { booking_date?: string | null; created_at?: string | null }) {
  const createdIso = booking?.created_at ?? null;
  const scheduledIso = scheduledIsoFor(booking);
  if (!createdIso || !scheduledIso) return 8;

  const created = new Date(createdIso);
  const scheduled = new Date(scheduledIso);
  if (isNaN(created.getTime()) || isNaN(scheduled.getTime())) return 8;

  const hoursBetween = (scheduled.getTime() - created.getTime()) / (1000 * 60 * 60);

  if (hoursBetween < 24) return 2;
  if (hoursBetween <= 72) return 4;
  return 8;
}

async function sendOwnerRequestEmailIfNeeded(bookingId: string) {
  const { data: booking, error: bookingError } = await supabase
    .from("bookings")
    .select("id, owner_id, borrower_id, booking_date, created_at")
    .eq("id", bookingId)
    .maybeSingle();

  if (bookingError) {
    console.error("❌ booking lookup failed:", bookingError);
    throw bookingError;
  }

  if (!booking?.owner_id) {
    console.warn("⚠️ booking missing owner_id, skipping email", { bookingId });
    return;
  }

  const { data: owner, error: ownerError } = await supabase
    .from("users")
    .select("id, first_name, full_name, email")
    .eq("id", booking.owner_id)
    .maybeSingle();

  if (ownerError) {
    console.error("❌ owner lookup failed:", ownerError);
    throw ownerError;
  }

  if (!owner?.email) {
    console.warn("⚠️ owner missing email, skipping email", { bookingId, ownerId: booking.owner_id });
    return;
  }

  const alreadySent = await hasNotificationBeenSent({
    supabase,
    bookingId: booking.id,
    userId: owner.id,
    notificationType: "request_created_owner",
  });

  if (alreadySent) {
    console.log("ℹ️ owner request email already sent, skipping", { bookingId, ownerId: owner.id });
    return;
  }

  const ownerName =
    owner.first_name?.trim() ||
    owner.full_name?.trim() ||
    "there";

  const bookingDateText = booking.booking_date
    ? new Date(booking.booking_date).toLocaleString("en-CA", {
        dateStyle: "medium",
        timeStyle: "short",
      })
    : "your upcoming road test";

  const acceptanceHours = acceptanceHoursForBooking(booking);

  const registryText = "the selected registry";

  await sendEmail({
    to: owner.email,
    subject: "New BorrowMyBike request",
    html: `
      <div style="font-family:Arial,Helvetica,sans-serif;line-height:1.5;color:#0f172a">
        <p>Hi ${ownerName},</p>

        <p>You have a new BorrowMyBike road-test request.</p>

        <p>
          <strong>Registry:</strong> ${registryText}<br />
          <strong>Test time:</strong> ${bookingDateText}
        </p>

        <p>Please log in to review the request and decide whether to accept.</p>

        <p>
           <strong>Acceptance window:</strong> You now have ${acceptanceHours} hours to accept or decline this request before it expires automatically.
        </p>
        <p>
          <a href="https://borrowmybike.ca/owner-dashboard" style="display:inline-block;padding:10px 14px;background:#0b1f3b;color:#ffffff;text-decoration:none;border-radius:8px;font-weight:700;">
            Review request
          </a>
        </p>

        <p>If you didn’t expect this email, contact support@borrowmybike.ca.</p>
      </div>
    `,
  });

  await logNotificationSent({
    supabase,
    bookingId: booking.id,
    userId: owner.id,
    emailTo: owner.email,
    notificationType: "request_created_owner",
    meta: {
      source: "stripe-webhook",
      booking_date: booking.booking_date ?? null,
      acceptance_hours: acceptanceHours,
    },
  });
}
async function sendBorrowerAcceptedEmailIfNeeded(bookingId: string) {
  const { data: booking, error: bookingError } = await supabase
    .from("bookings")
    .select("id, owner_id, borrower_id, booking_date")
    .eq("id", bookingId)
    .maybeSingle();

  if (bookingError) {
    console.error("❌ accepted-email booking lookup failed:", bookingError);
    throw bookingError;
  }

  if (!booking?.borrower_id) {
    console.warn("⚠️ booking missing borrower_id, skipping accepted email", { bookingId });
    return;
  }

  const { data: borrower, error: borrowerError } = await supabase
    .from("users")
    .select("id, first_name, full_name, email")
    .eq("id", booking.borrower_id)
    .maybeSingle();

  if (borrowerError) {
    console.error("❌ borrower lookup failed:", borrowerError);
    throw borrowerError;
  }

  if (!borrower?.email) {
    console.warn("⚠️ borrower missing email, skipping accepted email", {
      bookingId,
      borrowerId: booking.borrower_id,
    });
    return;
  }

  const alreadySent = await hasNotificationBeenSent({
    supabase,
    bookingId: booking.id,
    userId: borrower.id,
    notificationType: "accepted_borrower",
  });

  if (alreadySent) {
    console.log("ℹ️ borrower accepted email already sent, skipping", {
      bookingId,
      borrowerId: borrower.id,
    });
    return;
  }

  const borrowerName =
    borrower.first_name?.trim() ||
    borrower.full_name?.trim() ||
    "there";

  const bookingDateText = booking.booking_date
    ? new Date(booking.booking_date).toLocaleString("en-CA", {
        dateStyle: "medium",
        timeStyle: "short",
      })
    : "your upcoming road test";

  await sendEmail({
    to: borrower.email,
    subject: "Your BorrowMyBike request was accepted",
    html: `
      <div style="font-family:Arial,Helvetica,sans-serif;line-height:1.5;color:#0f172a">
        <p>Hi ${borrowerName},</p>

        <p>Your BorrowMyBike request was accepted by the mentor.</p>

        <p>
          <strong>Test time:</strong> ${bookingDateText}
        </p>

        <p>Please review your booking details and prepare for your road test.</p>

        <p>
          <a href="https://borrowmybike.ca/borrower-dashboard" style="display:inline-block;padding:10px 14px;background:#0b1f3b;color:#ffffff;text-decoration:none;border-radius:8px;font-weight:700;">
            View booking
          </a>
        </p>

        <p>If you didn’t expect this email, contact support@borrowmybike.ca.</p>
      </div>
    `,
  });

  await logNotificationSent({
    supabase,
    bookingId: booking.id,
    userId: borrower.id,
    emailTo: borrower.email,
    notificationType: "accepted_borrower",
    meta: {
      source: "stripe-webhook",
      booking_date: booking.booking_date ?? null,
    },
  });
}

serve(async (req: Request) => {
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
    if (bookingId && paymentType === "borrower_booking") {
  try {
    await sendOwnerRequestEmailIfNeeded(bookingId);
  } catch (emailError) {
    console.error("❌ owner request email failed:", emailError);
  }
}
     if (bookingId && paymentType === "owner_deposit") {
       try {
         await sendBorrowerAcceptedEmailIfNeeded(bookingId);
       } catch (emailError) {
         console.error("❌ borrower accepted email failed:", emailError);
       }
     }
  }

  return new Response(JSON.stringify({ received: true }), {
    headers: { "Content-Type": "application/json" },
    status: 200,
  });
});

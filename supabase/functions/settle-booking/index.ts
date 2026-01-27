import { serve } from "https://deno.land/std@0.192.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

type Json = Record<string, unknown>;

const corsHeaders: Record<string, string> = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

function mustEnv(k: string) {
  const v = Deno.env.get(k);
  if (!v) throw new Error(`Missing env: ${k}`);
  return v;
}

function jsonResponse(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}

function supabaseAdmin() {
  const url = mustEnv("SUPABASE_URL");
  const key = mustEnv("SUPABASE_SERVICE_ROLE_KEY");
  return createClient(url, key, { auth: { persistSession: false } });
}

async function getAuthedUserId(req: Request) {
  const supaUrl = mustEnv("SUPABASE_URL");
  const anon = mustEnv("SUPABASE_ANON_KEY");

  const authHeader = req.headers.get("Authorization") ?? "";
  const jwt = authHeader.replace("Bearer ", "").trim();
  if (!jwt) return null;

  const supa = createClient(supaUrl, anon, { auth: { persistSession: false } });
  const { data, error } = await supa.auth.getUser(jwt);
  if (error || !data?.user?.id) return null;
  return data.user.id as string;
}

/**
 * Timing helper:
 * - claim window anchored ONLY to scheduled start time (your request)
 */
function minutesSince(dateIso: string) {
  const t = new Date(dateIso).getTime();
  const now = Date.now();
  return Math.floor((now - t) / 60000);
}

async function ensurePayoutDue(params: {
  admin: ReturnType<typeof supabaseAdmin>;
  booking_id: string;
  payout_type: "owner_payout" | "borrower_compensation";
  borrower_id: string | null;
  owner_id: string | null;
  amount: number;
  currency: string;
}) {
  const {
    admin,
    booking_id,
    payout_type,
    borrower_id,
    owner_id,
    amount,
    currency,
  } = params;

  // If it exists already, do nothing (idempotent)
  const { data: existing, error: exErr } = await admin
    .from("payments")
    .select("id, status, payment_type, amount, created_at")
    .eq("booking_id", booking_id)
    .eq("payment_type", payout_type)
    .in("status", ["payout_due", "paid"])
    .limit(1);

  if (!exErr && existing && existing.length > 0) {
    return { created: false, payment: existing[0] };
  }

  // Insert payout_due row
  const { data: ins, error: insErr } = await admin
    .from("payments")
    .insert({
      booking_id,
      payment_type: payout_type,
      status: "payout_due",
      amount,
      currency,
      borrower_id,
      owner_id,
      stripe_payment_intent_id: null,
      stripe_id: null,
      refund_id: null,
      refunded_amount_cents: null,
      refund_status: null,
      payout_paid_at: null,
      payout_method: null,
      payout_reference: null,
      user_id: null,
    })
    .select("id, status, payment_type, amount, created_at")
    .single();

  if (insErr) {
    return { created: false, error: insErr.message };
  }

  return { created: true, payment: ins };
}

async function loadBookingForClaims(admin: ReturnType<typeof supabaseAdmin>, booking_id: string) {
  const { data, error } = await admin
    .from("bookings")
    .select(
      [
        "id",
        "status",
        "borrower_id",
        "owner_id",
        "scheduled_start_at",
        "cancelled",
        "completed",
        "settled",
        "borrower_checked_in",
        "owner_checked_in",
        "no_show_claimed_by",
        "no_show_claimed_at",
        "review_reason",
        "needs_review",
        "treat_as_borrower_no_show",
        "treat_as_owner_no_show",
      ].join(","),
    )
    .eq("id", booking_id)
    .single();

  return { booking: data, error };
}

serve(async (req) => {
  try {
    if (req.method === "OPTIONS") return jsonResponse({ ok: true }, 200);
    if (req.method !== "POST") {
      return jsonResponse({ error: "Method not allowed" }, 405);
    }

    const body = (await req.json().catch(() => ({}))) as Json;
    const booking_id = String(body.booking_id ?? "");
    const action = String(body.action ?? "settle");

    // Allow CLI testing without JWT
    const body_user_id =
      typeof (body as any).user_id === "string" ? String((body as any).user_id) : "";
    const actor =
      typeof (body as any).actor === "string" ? String((body as any).actor) : "";

    if (!booking_id) return jsonResponse({ error: "Missing booking_id" }, 400);

    const userId = await getAuthedUserId(req);
    const admin = supabaseAdmin();

    // Load booking
    const { booking, error: bookingErr } = await loadBookingForClaims(admin, booking_id);
    if (bookingErr || !booking) {
      return jsonResponse(
        { error: "Booking not found", details: bookingErr?.message },
        404,
      );
    }

    const {
      borrower_id,
      owner_id,
      scheduled_start_at,
      cancelled,
      completed,
      settled,
      borrower_checked_in,
      owner_checked_in,
      no_show_claimed_by,
      review_reason,
      needs_review,
    } = booking;

    if (cancelled) return jsonResponse({ error: "Booking cancelled; cannot proceed" }, 400);

    // Effective user for permission checks when no JWT is present
    const effectiveUserId = (userId ||
      (body_user_id ? body_user_id : null) ||
      (actor === "owner" ? owner_id : actor === "borrower" ? borrower_id : null)) as
        | string
        | null;

    const isBorrower = () =>
      !!effectiveUserId && !!borrower_id && effectiveUserId === borrower_id;
    const isOwner = () => !!effectiveUserId && !!owner_id && effectiveUserId === owner_id;

    // -------------------------
    // ACTION: settle (normal completion)
    // -------------------------
    if (action === "settle") {
      if (settled) return jsonResponse({ error: "Booking already settled" }, 400);
      if (!completed) return jsonResponse({ error: "Booking not completed yet" }, 400);

      const { data: upd, error: updErr } = await admin
        .from("bookings")
        .update({
          settled: true,
          settled_at: new Date().toISOString(),
          settlement_outcome: "normal_completed",
        })
        .eq("id", booking_id)
        .eq("settled", false)
        .select("*")
        .single();

      if (updErr) {
        return jsonResponse({ error: "Failed to settle booking", details: updErr.message }, 500);
      }

      const payout = await ensurePayoutDue({
        admin,
        booking_id,
        payout_type: "owner_payout",
        borrower_id: borrower_id ?? null,
        owner_id: owner_id ?? null,
        amount: 100,
        currency: "CAD",
      });

      return jsonResponse({
        ok: true,
        booking_id,
        message: "Settled ✅ payout_due recorded.",
        settlement_outcome: "normal_completed",
        payout,
      });
    }

    // -------------------------
    // ACTION: report_borrower_no_show (claimed by OWNER)
    // -------------------------
    if (action === "report_borrower_no_show") {
      if (!isOwner()) {
        return jsonResponse(
          {
            error: "Cannot report borrower no-show",
            reason: "Only owner can claim borrower no-show",
            debug: { userId, body_user_id, actor, effectiveUserId, owner_id },
          },
          400,
        );
      }
      if (!owner_checked_in) {
        return jsonResponse(
          { error: "Cannot report borrower no-show", reason: "Owner must check in first" },
          400,
        );
      }
      if (borrower_checked_in) {
        return jsonResponse(
          { error: "Cannot report borrower no-show", reason: "Borrower already checked in" },
          400,
        );
      }
      if (!scheduled_start_at) {
        return jsonResponse({ error: "Missing scheduled_start_at" }, 400);
      }

      const mins = minutesSince(scheduled_start_at);
      if (mins < 45) {
        return jsonResponse(
          {
            error: "Cannot report borrower no-show",
            reason: "Claim window not open yet",
            minutes_since_start: mins,
            required_minutes: 45,
          },
          400,
        );
      }

      // If already claimed, return idempotent response WITHOUT rewriting booking
      if (no_show_claimed_by) {
        if (no_show_claimed_by !== "owner") {
          return jsonResponse(
            {
              error: "Cannot report borrower no-show",
              reason: `Already claimed by ${no_show_claimed_by}`,
            },
            400,
          );
        }

        const payout = await ensurePayoutDue({
          admin,
          booking_id,
          payout_type: "owner_payout",
          borrower_id: borrower_id ?? null,
          owner_id: owner_id ?? null,
          amount: 100,
          currency: "CAD",
        });

        return jsonResponse({
          ok: true,
          message: "Borrower no-show already claimed ✅",
          booking_id,
          needs_review: needs_review ?? true,
          review_reason: review_reason ?? "borrower_no_show_claimed",
          payout,
        });
      }

      // Atomic claim: only if not already claimed
      const { data: upd, error: updErr } = await admin
        .from("bookings")
        .update({
          // ✅ important: move booking into a review status
          status: "in_review",
          needs_review: true,
          review_reason: "borrower_no_show_claimed",
          treat_as_borrower_no_show: true,
          treat_as_owner_no_show: false,
          no_show_claimed_by: "owner",
          no_show_claimed_at: new Date().toISOString(),
        })
        .eq("id", booking_id)
        .is("no_show_claimed_by", null)
        .select("*")
        .single();

      // If update failed or returned no row, treat as "someone else already claimed" and respond idempotently.
      if (updErr || !upd) {
        const { booking: b2 } = await loadBookingForClaims(admin, booking_id);

        if (b2?.no_show_claimed_by === "owner") {
          const payout = await ensurePayoutDue({
            admin,
            booking_id,
            payout_type: "owner_payout",
            borrower_id: borrower_id ?? null,
            owner_id: owner_id ?? null,
            amount: 100,
            currency: "CAD",
          });

          return jsonResponse({
            ok: true,
            message: "Borrower no-show already claimed ✅",
            booking_id,
            needs_review: b2.needs_review ?? true,
            review_reason: b2.review_reason ?? "borrower_no_show_claimed",
            payout,
          });
        }

        return jsonResponse(
          {
            error: "Unable to claim borrower no-show",
            booking_id,
            current_claimed_by: b2?.no_show_claimed_by ?? null,
          },
          409,
        );
      }

      // Option 2 ledger: create payout_due row immediately
      const payout = await ensurePayoutDue({
        admin,
        booking_id,
        payout_type: "owner_payout",
        borrower_id: borrower_id ?? null,
        owner_id: owner_id ?? null,
        amount: 100,
        currency: "CAD",
      });

      return jsonResponse({
        ok: true,
        message: "Borrower no-show claimed. Flagged for review ✅",
        booking_id,
        needs_review: upd.needs_review,
        review_reason: upd.review_reason,
        payout,
      });
    }

    // -------------------------
    // ACTION: report_owner_no_show (claimed by BORROWER)
    // -------------------------
    if (action === "report_owner_no_show") {
      if (!isBorrower()) {
        return jsonResponse(
          { error: "Cannot report owner no-show", reason: "Only borrower can claim owner no-show" },
          400,
        );
      }
      if (!borrower_checked_in) {
        return jsonResponse(
          { error: "Cannot report owner no-show", reason: "Borrower must check in first" },
          400,
        );
      }
      if (owner_checked_in) {
        return jsonResponse(
          { error: "Cannot report owner no-show", reason: "Owner already checked in" },
          400,
        );
      }
      if (!scheduled_start_at) {
        return jsonResponse({ error: "Missing scheduled_start_at" }, 400);
      }

      const mins = minutesSince(scheduled_start_at);
      if (mins < 45) {
        return jsonResponse(
          {
            error: "Cannot report owner no-show",
            reason: "Claim window not open yet",
            minutes_since_start: mins,
            required_minutes: 45,
          },
          400,
        );
      }

      // If already claimed, return idempotent response WITHOUT rewriting booking
      if (no_show_claimed_by) {
        if (no_show_claimed_by !== "borrower") {
          return jsonResponse(
            {
              error: "Cannot report owner no-show",
              reason: `Already claimed by ${no_show_claimed_by}`,
            },
            400,
          );
        }

        const payout = await ensurePayoutDue({
          admin,
          booking_id,
          payout_type: "borrower_compensation",
          borrower_id: borrower_id ?? null,
          owner_id: owner_id ?? null,
          amount: 100,
          currency: "CAD",
        });

        return jsonResponse({
          ok: true,
          message: "Owner no-show already claimed ✅",
          booking_id,
          needs_review: needs_review ?? true,
          review_reason: review_reason ?? "owner_no_show_claimed",
          payout,
        });
      }

      const { data: upd, error: updErr } = await admin
        .from("bookings")
        .update({
          // ✅ important: move booking into a review status
          status: "in_review",
          needs_review: true,
          review_reason: "owner_no_show_claimed",
          treat_as_owner_no_show: true,
          treat_as_borrower_no_show: false,
          no_show_claimed_by: "borrower",
          no_show_claimed_at: new Date().toISOString(),
        })
        .eq("id", booking_id)
        .is("no_show_claimed_by", null)
        .select("*")
        .single();

      if (updErr || !upd) {
        const { booking: b2 } = await loadBookingForClaims(admin, booking_id);

        if (b2?.no_show_claimed_by === "borrower") {
          const payout = await ensurePayoutDue({
            admin,
            booking_id,
            payout_type: "borrower_compensation",
            borrower_id: borrower_id ?? null,
            owner_id: owner_id ?? null,
            amount: 100,
            currency: "CAD",
          });

          return jsonResponse({
            ok: true,
            message: "Owner no-show already claimed ✅",
            booking_id,
            needs_review: b2.needs_review ?? true,
            review_reason: b2.review_reason ?? "owner_no_show_claimed",
            payout,
          });
        }

        return jsonResponse(
          {
            error: "Unable to claim owner no-show",
            booking_id,
            current_claimed_by: b2?.no_show_claimed_by ?? null,
          },
          409,
        );
      }

      const payout = await ensurePayoutDue({
        admin,
        booking_id,
        payout_type: "borrower_compensation",
        borrower_id: borrower_id ?? null,
        owner_id: owner_id ?? null,
        amount: 100,
        currency: "CAD",
      });

      return jsonResponse({
        ok: true,
        message: "Owner no-show claimed. Flagged for review ✅",
        booking_id,
        needs_review: upd.needs_review,
        review_reason: upd.review_reason,
        payout,
      });
    }

    return jsonResponse(
      {
        error: "Invalid action",
        allowed: ["settle", "report_borrower_no_show", "report_owner_no_show"],
      },
      400,
    );
  } catch (e) {
    return jsonResponse({ error: "Unhandled error", message: String(e) }, 500);
  }
});

import { serve } from "https://deno.land/std@0.192.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2?target=deno";
import { sendEmail } from "../_shared/sendEmail.ts";
import { hasNotificationBeenSent, logNotificationSent } from "../_shared/notificationLog.ts";
import { formatBookingTime } from "../_shared/formatBookingTime.ts";

const SUPABASE_URL = Deno.env.get("MY_SUPABASE_URL")!;
const SERVICE_ROLE_KEY = Deno.env.get("MY_SUPABASE_SERVICE_ROLE_KEY")!;
const BOOKING_REMINDER_SECRET = Deno.env.get("BOOKING_REMINDER_SECRET")!;

const supabase = createClient(SUPABASE_URL, SERVICE_ROLE_KEY, {
  auth: { persistSession: false },
});

function json(status: number, body: unknown) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

async function sendReminderIfNeeded(opts: {
  bookingId: string;
  userId: string | null;
  userRole: "owner" | "borrower";
  userEmail: string | null;
  firstName?: string | null;
  fullName?: string | null;
  scheduledIso?: string | null;
  hoursBefore: 24 | 4;
}) {
  const {
    bookingId,
    userId,
    userRole,
    userEmail,
    firstName,
    fullName,
    scheduledIso,
    hoursBefore,
  } = opts;

  if (!userId || !userEmail) return { skipped: true, reason: "missing-user-or-email" };

  const notificationType =
    hoursBefore === 24
      ? userRole === "owner"
        ? "booking_reminder_24h_sent_to_owner"
        : "booking_reminder_24h_sent_to_borrower"
      : userRole === "owner"
        ? "booking_reminder_4h_sent_to_owner"
        : "booking_reminder_4h_sent_to_borrower";

  const alreadySent = await hasNotificationBeenSent({
    supabase,
    bookingId,
    userId,
    notificationType,
  });

  if (alreadySent) {
    return { skipped: true, reason: "already-sent" };
  }

  const name =
    firstName?.trim() ||
    fullName?.trim() ||
    "there";

  const bookingDateText = formatBookingTime(scheduledIso, "AB");

  const roleText = userRole === "owner" ? "mentor" : "road test";
  const subject =
    hoursBefore === 24
      ? `Reminder: your BorrowMyBike ${roleText} booking is tomorrow`
      : `Reminder: your BorrowMyBike ${roleText} booking is in 4 hours`;

  const ctaHref =
    userRole === "owner"
      ? "https://borrowmybike.ca/dashboard"
      : "https://borrowmybike.ca/dashboard";

  const ctaLabel =
    userRole === "owner"
      ? "View dashboard"
      : "View dashboard";

  await sendEmail({
    to: userEmail,
    subject,
    html: `
      <div style="font-family:Arial,Helvetica,sans-serif;line-height:1.5;color:#0f172a">
        <p>Hi ${name},</p>

        <p>This is a reminder about your upcoming BorrowMyBike booking.</p>

        <p>
          <strong>Scheduled time:</strong> ${bookingDateText}
        </p>

        <p>Please review the booking details and make sure you are ready.</p>

        <p>
          <a href="${ctaHref}" style="display:inline-block;padding:10px 14px;background:#0b1f3b;color:#ffffff;text-decoration:none;border-radius:8px;font-weight:700;">
            ${ctaLabel}
          </a>
        </p>

        <p>If you didn’t expect this email, contact support@borrowmybike.ca.</p>
      </div>
    `,
  });

  await logNotificationSent({
    supabase,
    bookingId,
    userId,
    emailTo: userEmail,
    notificationType,
    meta: {
      source: "send-booking-reminders",
      hours_before: hoursBefore,
      booking_date: scheduledIso ?? null,
    },
  });

  return { skipped: false };
}

serve(async (req: Request) => {
  try {
    if (req.method !== "POST") {
      return json(405, { error: "Method not allowed" });
    }

    const authHeader = req.headers.get("x-booking-reminder-secret");
    if (!authHeader || authHeader !== BOOKING_REMINDER_SECRET) {
      return json(401, { error: "Unauthorized" });
    }

    const now = Date.now();
    const windowMs = 15 * 60 * 1000;

    const lower24 = new Date(now + 24 * 60 * 60 * 1000 - windowMs).toISOString();
    const upper24 = new Date(now + 24 * 60 * 60 * 1000 + windowMs).toISOString();

    const lower4 = new Date(now + 4 * 60 * 60 * 1000 - windowMs).toISOString();
    const upper4 = new Date(now + 4 * 60 * 60 * 1000 + windowMs).toISOString();

    const { data: bookings24, error: err24 } = await supabase
      .from("bookings")
      .select(`
        id,
        owner_id,
        borrower_id,
        booking_date,
        cancelled,
        completed,
        borrower_paid,
        owner_deposit_paid
      `)
      .eq("cancelled", false)
      .eq("completed", false)
      .eq("borrower_paid", true)
      .eq("owner_deposit_paid", true)
      .gte("booking_date", lower24)
      .lte("booking_date", upper24);

    if (err24) {
      console.error("❌ 24h booking query failed:", err24);
      return json(500, { error: "24h booking query failed", details: err24 });
    }

    const { data: bookings4, error: err4 } = await supabase
      .from("bookings")
      .select(`
        id,
        owner_id,
        borrower_id,
        booking_date,
        cancelled,
        completed,
        borrower_paid,
        owner_deposit_paid
      `)
      .eq("cancelled", false)
      .eq("completed", false)
      .eq("borrower_paid", true)
      .eq("owner_deposit_paid", true)
      .gte("booking_date", lower4)
      .lte("booking_date", upper4);

    if (err4) {
      console.error("❌ 4h booking query failed:", err4);
      return json(500, { error: "4h booking query failed", details: err4 });
    }

    const allUserIds = Array.from(
      new Set(
        [...(bookings24 ?? []), ...(bookings4 ?? [])]
          .flatMap((b) => [b.owner_id, b.borrower_id])
          .filter(Boolean)
      )
    );

    let usersById = new Map<
  string,
  { id: string; first_name: string | null; full_name: string | null; email: string | null }
>();

if (allUserIds.length > 0) {
  const { data: users, error: usersError } = await supabase
    .from("users")
    .select("id, first_name, full_name, email")
    .in("id", allUserIds);

  if (usersError) {
    console.error("❌ users lookup failed:", usersError);
    return json(500, { error: "users lookup failed", details: usersError });
  }

  usersById = new Map(
    (users ?? []).map(
      (u: { id: string; first_name: string | null; full_name: string | null; email: string | null }) => [u.id, u]
    )
  );
}
    

    const results: Array<Record<string, unknown>> = [];

    for (const b of bookings24 ?? []) {
      const owner = b.owner_id ? usersById.get(b.owner_id) : undefined;
      const borrower = b.borrower_id ? usersById.get(b.borrower_id) : undefined;

      const ownerResult = await sendReminderIfNeeded({
        bookingId: b.id,
        userId: owner?.id ?? null,
        userRole: "owner",
        userEmail: owner?.email ?? null,
        firstName: owner?.first_name ?? null,
        fullName: owner?.full_name ?? null,
        scheduledIso: b.booking_date,
        hoursBefore: 24,
      });

      const borrowerResult = await sendReminderIfNeeded({
        bookingId: b.id,
        userId: borrower?.id ?? null,
        userRole: "borrower",
        userEmail: borrower?.email ?? null,
        firstName: borrower?.first_name ?? null,
        fullName: borrower?.full_name ?? null,
        scheduledIso: b.booking_date,
        hoursBefore: 24,
      });

      results.push({
        booking_id: b.id,
        reminder: "24h",
        owner: ownerResult,
        borrower: borrowerResult,
      });
    }

    for (const b of bookings4 ?? []) {
      const owner = b.owner_id ? usersById.get(b.owner_id) : undefined;
      const borrower = b.borrower_id ? usersById.get(b.borrower_id) : undefined;

      const ownerResult = await sendReminderIfNeeded({
        bookingId: b.id,
        userId: owner?.id ?? null,
        userRole: "owner",
        userEmail: owner?.email ?? null,
        firstName: owner?.first_name ?? null,
        fullName: owner?.full_name ?? null,
        scheduledIso: b.booking_date,
        hoursBefore: 4,
      });

      const borrowerResult = await sendReminderIfNeeded({
        bookingId: b.id,
        userId: borrower?.id ?? null,
        userRole: "borrower",
        userEmail: borrower?.email ?? null,
        firstName: borrower?.first_name ?? null,
        fullName: borrower?.full_name ?? null,
        scheduledIso: b.booking_date,
        hoursBefore: 4,
      });

      results.push({
        booking_id: b.id,
        reminder: "4h",
        owner: ownerResult,
        borrower: borrowerResult,
      });
    }

    return json(200, {
      ok: true,
      bookings24: (bookings24 ?? []).length,
      bookings4: (bookings4 ?? []).length,
      results,
    });
  } catch (err) {
    console.error("❌ send-booking-reminders failed:", err);
    return json(500, { error: "Internal server error", details: String(err) });
  }
});
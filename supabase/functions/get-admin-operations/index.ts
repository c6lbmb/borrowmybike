import { serve } from "https://deno.land/std@0.177.0/http/server.ts";
import { createClient } from "https://cdn.jsdelivr.net/npm/@supabase/supabase-js/+esm";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "GET, OPTIONS",
};

const supabaseUrl = Deno.env.get("MY_SUPABASE_URL")!;
const serviceRoleKey = Deno.env.get(
  "MY_SUPABASE_SERVICE_ROLE_KEY",
)!;
const adminUserId = Deno.env.get("ADMIN_USER_ID")!;

const db = createClient(supabaseUrl, serviceRoleKey);

type UserRow = {
  id: string;
  full_name: string | null;
  email: string | null;
  phone: string | null;
  city: string | null;
  created_at: string | null;
};

type BikeRow = {
  id: string;
  owner_id: string;
  make: string | null;
  model: string | null;
  year: number | null;
  city: string | null;
  province: string | null;
  is_active: boolean | null;
};

type BookingRow = {
  id: string;
  bike_id: string | null;
  borrower_id: string | null;
  owner_id: string | null;
  registry_id: string | null;
  booking_date: string | null;
  scheduled_start_at: string | null;
  status: string | null;
  borrower_paid: boolean | null;
  owner_deposit_paid: boolean | null;
  completed: boolean | null;
  settled: boolean | null;
  cancelled: boolean | null;
  cancelled_by: string | null;
  needs_review: boolean | null;
  review_reason: string | null;
  settlement_outcome: string | null;
  created_at: string | null;
  updated_at: string | null;
};

function json(status: number, body: unknown) {
  return new Response(JSON.stringify(body), {
    status,
    headers: {
      ...corsHeaders,
      "Content-Type": "application/json",
    },
  });
}

function getBearerToken(req: Request): string | null {
  const header =
    req.headers.get("Authorization") ||
    req.headers.get("authorization");

  if (!header) return null;

  const match = header.match(/^Bearer\s+(.+)$/i);
  return match ? match[1] : null;
}

async function requireAdmin(
  req: Request,
): Promise<
  | { ok: true; adminUserId: string }
  | { ok: false; status: number; error: string }
> {
  const token = getBearerToken(req);

  if (!token) {
    return {
      ok: false,
      status: 401,
      error: "Missing Bearer token",
    };
  }

  const { data, error } = await db.auth.getUser(token);

  if (error || !data?.user) {
    return {
      ok: false,
      status: 401,
      error: "Invalid token",
    };
  }

  if (!adminUserId) {
    return {
      ok: false,
      status: 500,
      error: "ADMIN_USER_ID missing in secrets",
    };
  }

  if (data.user.id !== adminUserId) {
    return {
      ok: false,
      status: 403,
      error: "Not authorized (admin only)",
    };
  }

  return {
    ok: true,
    adminUserId: data.user.id,
  };
}

function startOfLocalDay(date: Date): Date {
  const result = new Date(date);
  result.setHours(0, 0, 0, 0);
  return result;
}

function addDays(date: Date, days: number): Date {
  const result = new Date(date);
  result.setDate(result.getDate() + days);
  return result;
}

function validDate(value?: string | null): Date | null {
  if (!value) return null;

  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? null : date;
}

function normalizeCity(city?: string | null): string {
  const value = (city || "").trim();

  if (!value) return "Not provided";

  return value
    .toLowerCase()
    .split(/\s+/)
    .map((part) =>
      part.length > 0
        ? part.charAt(0).toUpperCase() + part.slice(1)
        : part
    )
    .join(" ");
}

function bikeName(bike?: BikeRow | null): string | null {
  if (!bike) return null;

  const value = [
    bike.year ? String(bike.year) : "",
    bike.make || "",
    bike.model || "",
  ]
    .filter(Boolean)
    .join(" ")
    .trim();

  return value || "Bike listed";
}

function scheduledIsoFor(booking: BookingRow): string | null {
  return booking.scheduled_start_at || booking.booking_date || null;
}

function classifyUser(
  userId: string,
  bikesByOwner: Map<string, BikeRow[]>,
  borrowerBookingsByUser: Map<string, BookingRow[]>,
) {
  const bikes = bikesByOwner.get(userId) || [];
  const borrowerBookings = borrowerBookingsByUser.get(userId) || [];

  if (bikes.length > 0) {
    return {
      classification: "mentor",
      classificationLabel: "Mentor",
    };
  }

  if (borrowerBookings.length > 0) {
    return {
      classification: "test_taker",
      classificationLabel: "Test-taker",
    };
  }

  return {
    classification: "no_bike_listed",
    classificationLabel: "No bike listed",
  };
}

function bookingState(booking: BookingRow): string {
  if (booking.cancelled) {
    return booking.cancelled_by === "system_expired"
      ? "Expired"
      : "Cancelled";
  }

  if (booking.needs_review) return "Needs review";

  if (booking.settled) {
    return booking.settlement_outcome || "Settled";
  }

  if (booking.completed) return "Completed, not settled";

  if (
    booking.borrower_paid &&
    booking.owner_deposit_paid
  ) {
    return "Confirmed";
  }

  if (
    booking.borrower_paid &&
    !booking.owner_deposit_paid
  ) {
    return "Pending mentor acceptance";
  }

  if (booking.status === "pending_payment") {
    return "Pending payment";
  }

  return booking.status || "Unknown";
}

serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }

  if (req.method !== "GET") {
    return json(405, { error: "Only GET is allowed" });
  }

  const adminCheck = await requireAdmin(req);

  if (!adminCheck.ok) {
    return json(adminCheck.status, {
      error: adminCheck.error,
    });
  }

  try {
    const now = new Date();
    const todayStart = startOfLocalDay(now);
    const tomorrowStart = addDays(todayStart, 1);
    const sevenDaysAgoStart = addDays(todayStart, -7);
    const fourteenDaysAgoStart = addDays(todayStart, -14);
    const nextSevenDaysEnd = addDays(todayStart, 8);

    const [
  authUsersResult,
  profilesResult,
  bikesResult,
  bookingsResult,
] = await Promise.all([
  db.auth.admin.listUsers({
    page: 1,
    perPage: 1000,
  }),

  db
    .from("users")
    .select("id,full_name,email,phone,city"),

  db
   
  .from("bikes")
  .select(
    "id,owner_id,make,model,year,city,province,is_active",
  ),

  db
    .from("bookings")
    .select(
      "id,bike_id,borrower_id,owner_id,registry_id,booking_date,scheduled_start_at,status,borrower_paid,owner_deposit_paid,completed,settled,cancelled,cancelled_by,needs_review,review_reason,settlement_outcome,created_at,updated_at",
    )
    .gte(
      "created_at",
      fourteenDaysAgoStart.toISOString(),
    )
    .order("created_at", { ascending: false }),
]);

   if (authUsersResult.error) {
  return json(500, {
    error: "Failed to fetch Auth users",
    details: authUsersResult.error.message,
  });
}

if (profilesResult.error) {
  return json(500, {
    error: "Failed to fetch user profiles",
    details: profilesResult.error.message,
  });
}

    if (bikesResult.error) {
      return json(500, {
        error: "Failed to fetch bikes",
        details: bikesResult.error.message,
      });
    }

    if (bookingsResult.error) {
      return json(500, {
        error: "Failed to fetch bookings",
        details: bookingsResult.error.message,
      });
    }

    const profiles = (profilesResult.data || []) as Array<{
  id: string;
  full_name: string | null;
  email: string | null;
  phone: string | null;
  city: string | null;
}>;

const profilesById = new Map(
  profiles.map((profile) => [profile.id, profile]),
);

const users = (authUsersResult.data?.users || [])
  .filter((authUser) => {
    const createdAt = validDate(authUser.created_at);

    return (
      createdAt &&
      createdAt >= fourteenDaysAgoStart
    );
  })
  .map((authUser) => {
    const profile = profilesById.get(authUser.id);

    return {
      id: authUser.id,
      full_name: profile?.full_name || null,
      email: profile?.email || authUser.email || null,
      phone: profile?.phone || authUser.phone || null,
      city: profile?.city || null,
      created_at: authUser.created_at || null,
    } satisfies UserRow;
  })
  .sort((a, b) => {
    const aTime = validDate(a.created_at)?.getTime() || 0;
    const bTime = validDate(b.created_at)?.getTime() || 0;

    return bTime - aTime;
  });
    const bikes =
      (bikesResult.data || []) as BikeRow[];
    const bookings =
      (bookingsResult.data || []) as BookingRow[];

    const bikesByOwner = new Map<string, BikeRow[]>();
    const bikesById = new Map<string, BikeRow>();
    const borrowerBookingsByUser = new Map<
      string,
      BookingRow[]
    >();

    for (const bike of bikes) {
      bikesById.set(bike.id, bike);

      const ownerBikes =
        bikesByOwner.get(bike.owner_id) || [];

      ownerBikes.push(bike);
      bikesByOwner.set(bike.owner_id, ownerBikes);
    }

    for (const booking of bookings) {
      if (!booking.borrower_id) continue;

      const userBookings =
        borrowerBookingsByUser.get(
          booking.borrower_id,
        ) || [];

      userBookings.push(booking);

      borrowerBookingsByUser.set(
        booking.borrower_id,
        userBookings,
      );
    }

    const formattedUsers = users.map((user) => {
      const userBikes =
        bikesByOwner.get(user.id) || [];

      const borrowerBookings =
        borrowerBookingsByUser.get(user.id) || [];

      const classification = classifyUser(
        user.id,
        bikesByOwner,
        borrowerBookingsByUser,
      );

      return {
        id: user.id,
        full_name: user.full_name,
        email: user.email,
        phone: user.phone,
        city: normalizeCity(user.city),
        joined_at: user.created_at,
        classification:
          classification.classification,
        classification_label:
          classification.classificationLabel,
        has_bike: userBikes.length > 0,
        bikes: userBikes.map((bike) => ({
          id: bike.id,
          name: bikeName(bike),
          city: normalizeCity(bike.city),
          province: bike.province,
          is_active: bike.is_active,
        })),
        borrower_booking_count:
          borrowerBookings.length,
      };
    });

    function inRange(
      joinedAt: string | null,
      start: Date,
      end: Date,
    ) {
      const date = validDate(joinedAt);
      if (!date) return false;

      return date >= start && date < end;
    }

    const usersToday = formattedUsers.filter(
      (user) =>
        inRange(
          user.joined_at,
          todayStart,
          tomorrowStart,
        ),
    );

    const usersYesterdayTo7Days = formattedUsers.filter(
      (user) =>
        inRange(
          user.joined_at,
          sevenDaysAgoStart,
          todayStart,
        ),
    );

    const users8To14Days = formattedUsers.filter(
      (user) =>
        inRange(
          user.joined_at,
          fourteenDaysAgoStart,
          sevenDaysAgoStart,
        ),
    );

    const cityMap = new Map<
      string,
      {
        city: string;
        users: number;
        mentors: number;
        test_takers: number;
        no_bike_listed: number;
      }
    >();

    for (const user of formattedUsers) {
      const city = user.city;

      const existing = cityMap.get(city) || {
        city,
        users: 0,
        mentors: 0,
        test_takers: 0,
        no_bike_listed: 0,
      };

      existing.users += 1;

      if (user.classification === "mentor") {
        existing.mentors += 1;
      } else if (
        user.classification === "test_taker"
      ) {
        existing.test_takers += 1;
      } else {
        existing.no_bike_listed += 1;
      }

      cityMap.set(city, existing);
    }

    const cityBreakdown = Array.from(
      cityMap.values(),
    ).sort((a, b) => {
      if (b.users !== a.users) {
        return b.users - a.users;
      }

      return a.city.localeCompare(b.city);
    });

    const formattedBookings = bookings.map(
      (booking) => {
        const scheduledAt =
          scheduledIsoFor(booking);

        const bike = booking.bike_id
          ? bikesById.get(booking.bike_id)
          : null;

        return {
          ...booking,
          scheduled_at: scheduledAt,
          state: bookingState(booking),
          bike: bike
            ? {
                id: bike.id,
                name: bikeName(bike),
                city: normalizeCity(bike.city),
                province: bike.province,
              }
            : null,
        };
      },
    );

    const pendingPayment =
      formattedBookings.filter((booking) => {
        return (
          !booking.cancelled &&
          !booking.settled &&
          !booking.completed &&
          !booking.borrower_paid &&
          booking.status === "pending_payment"
        );
      });

    const pendingMentorAcceptance =
      formattedBookings.filter((booking) => {
        return (
          !booking.cancelled &&
          !booking.settled &&
          !booking.completed &&
          booking.borrower_paid &&
          !booking.owner_deposit_paid
        );
      });

    const needsReview =
      formattedBookings.filter((booking) => {
        return (
          booking.needs_review &&
          !booking.cancelled &&
          !booking.settled
        );
      });

    const completedUnsettled =
      formattedBookings.filter((booking) => {
        return (
          booking.completed &&
          !booking.settled &&
          !booking.cancelled
        );
      });

    const pastConfirmedUnfinished =
      formattedBookings.filter((booking) => {
        if (
          booking.cancelled ||
          booking.settled ||
          booking.completed
        ) {
          return false;
        }

        if (
          !booking.borrower_paid ||
          !booking.owner_deposit_paid
        ) {
          return false;
        }

        const scheduledDate = validDate(
          booking.scheduled_at,
        );

        if (!scheduledDate) return false;

        return scheduledDate < now;
      });

    const upcoming = formattedBookings
      .filter((booking) => {
        if (
          booking.cancelled ||
          booking.settled
        ) {
          return false;
        }

        const scheduledDate = validDate(
          booking.scheduled_at,
        );

        if (!scheduledDate) return false;

        return (
          scheduledDate >= todayStart &&
          scheduledDate < nextSevenDaysEnd
        );
      })
      .sort((a, b) => {
        const aDate =
          validDate(a.scheduled_at)?.getTime() || 0;
        const bDate =
          validDate(b.scheduled_at)?.getTime() || 0;

        return aDate - bDate;
      });

    const recentlyCompleted =
      formattedBookings.filter((booking) => {
        return (
          booking.completed ||
          booking.settled ||
          booking.cancelled
        );
      });

    const newMentors = formattedUsers.filter(
      (user) => user.classification === "mentor",
    );

    const newBikes: BikeRow[] = [];

    return json(200, {
      generated_at: now.toISOString(),

      users: {
        today: usersToday,
        yesterday_to_7_days:
          usersYesterdayTo7Days,
        days_8_to_14: users8To14Days,
        all_last_14_days: formattedUsers,
      },

      user_counts: {
        today: {
          total: usersToday.length,
          mentors: usersToday.filter(
            (u) => u.classification === "mentor",
          ).length,
          test_takers: usersToday.filter(
            (u) =>
              u.classification === "test_taker",
          ).length,
          no_bike_listed: usersToday.filter(
            (u) =>
              u.classification ===
              "no_bike_listed",
          ).length,
        },

        yesterday_to_7_days: {
          total: usersYesterdayTo7Days.length,
          mentors:
            usersYesterdayTo7Days.filter(
              (u) =>
                u.classification === "mentor",
            ).length,
          test_takers:
            usersYesterdayTo7Days.filter(
              (u) =>
                u.classification ===
                "test_taker",
            ).length,
          no_bike_listed:
            usersYesterdayTo7Days.filter(
              (u) =>
                u.classification ===
                "no_bike_listed",
            ).length,
        },

        days_8_to_14: {
          total: users8To14Days.length,
          mentors: users8To14Days.filter(
            (u) => u.classification === "mentor",
          ).length,
          test_takers:
            users8To14Days.filter(
              (u) =>
                u.classification ===
                "test_taker",
            ).length,
          no_bike_listed:
            users8To14Days.filter(
              (u) =>
                u.classification ===
                "no_bike_listed",
            ).length,
        },
      },

      cities: cityBreakdown,

      mentors: {
        new_last_14_days: newMentors,
        new_bikes_last_14_days: newBikes.map(
          (bike) => ({
            id: bike.id,
            owner_id: bike.owner_id,
            name: bikeName(bike),
            city: normalizeCity(bike.city),
            province: bike.province,
            is_active: bike.is_active,
            created_at: null,
          }),
        ),
        total_bikes: bikes.length,
        active_bikes: bikes.filter(
          (bike) => bike.is_active,
        ).length,
      },

      bookings: {
        pending_payment: pendingPayment,
        pending_mentor_acceptance:
          pendingMentorAcceptance,
        needs_review: needsReview,
        completed_unsettled:
          completedUnsettled,
        past_confirmed_unfinished:
          pastConfirmedUnfinished,
        upcoming_next_7_days: upcoming,
        recent_history: recentlyCompleted,
      },

      stats: {
        users_last_14_days:
          formattedUsers.length,
        new_mentors_last_14_days:
          newMentors.length,
        new_bikes_last_14_days:
          newBikes.length,
        pending_payment:
          pendingPayment.length,
        pending_mentor_acceptance:
          pendingMentorAcceptance.length,
        needs_review: needsReview.length,
        completed_unsettled:
          completedUnsettled.length,
        past_confirmed_unfinished:
          pastConfirmedUnfinished.length,
        upcoming_next_7_days:
          upcoming.length,
        total_bikes: bikes.length,
        active_bikes: bikes.filter(
          (bike) => bike.is_active,
        ).length,
      },
    });
  } catch (error) {
    console.error(
      "get-admin-operations failed",
      error,
    );

    return json(500, {
      error:
        error instanceof Error
          ? error.message
          : "Unexpected server error",
    });
  }
});
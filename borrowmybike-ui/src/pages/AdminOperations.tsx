// src/pages/AdminOperations.tsx
import { useEffect, useMemo, useState } from "react";
import { Link } from "react-router-dom";
import { useAuth } from "../auth/useAuth";
import { sb } from "../lib/supabase";

type UserItem = {
  id: string;
  full_name: string | null;
  email: string | null;
  phone: string | null;
  city: string;
  joined_at: string | null;
  classification: string;
  classification_label: string;
  has_bike: boolean;
  borrower_booking_count: number;
  bikes: Array<{
    id: string;
    name: string | null;
    city: string;
    province: string | null;
    is_active: boolean | null;
    created_at: string | null;
  }>;
};

type UserCount = {
  total: number;
  mentors: number;
  test_takers: number;
  no_bike_listed: number;
};

type CityItem = {
  city: string;
  users: number;
  mentors: number;
  test_takers: number;
  no_bike_listed: number;
};

type BikeItem = {
  id: string;
  owner_id: string;
  name: string | null;
  city: string;
  province: string | null;
  is_active: boolean | null;
  created_at: string | null;
};

type BookingItem = {
  id: string;
  bike_id: string | null;
  borrower_id: string | null;
  owner_id: string | null;
  registry_id: string | null;
  booking_date: string | null;
  scheduled_start_at: string | null;
  scheduled_at: string | null;
  status: string | null;
  state: string;
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
  bike: {
    id: string;
    name: string | null;
    city: string;
    province: string | null;
  } | null;
};

type OperationsResponse = {
  generated_at: string;

  users: {
    today: UserItem[];
    yesterday_to_7_days: UserItem[];
    days_8_to_14: UserItem[];
    all_last_14_days: UserItem[];
  };

  user_counts: {
    today: UserCount;
    yesterday_to_7_days: UserCount;
    days_8_to_14: UserCount;
  };

  cities: CityItem[];

  mentors: {
    new_last_14_days: UserItem[];
    new_bikes_last_14_days: BikeItem[];
    total_bikes: number;
    active_bikes: number;
  };

  bookings: {
    pending_payment: BookingItem[];
    pending_mentor_acceptance: BookingItem[];
    needs_review: BookingItem[];
    completed_unsettled: BookingItem[];
    past_confirmed_unfinished: BookingItem[];
    upcoming_next_7_days: BookingItem[];
    recent_history: BookingItem[];
  };

  stats: {
    users_last_14_days: number;
    new_mentors_last_14_days: number;
    new_bikes_last_14_days: number;
    pending_payment: number;
    pending_mentor_acceptance: number;
    needs_review: number;
    completed_unsettled: number;
    past_confirmed_unfinished: number;
    upcoming_next_7_days: number;
    total_bikes: number;
    active_bikes: number;
  };
};

function fmtDateTime(value?: string | null) {
  if (!value) return "—";

  const date = new Date(value);

  if (Number.isNaN(date.getTime())) return "—";

  return date.toLocaleString([], {
    year: "numeric",
    month: "short",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
  });
}

function shortId(value?: string | null) {
  return value ? `${value.slice(0, 8)}…` : "—";
}

function userBikeName(user: UserItem) {
  if (!user.bikes?.length) return "—";

  return user.bikes
    .map((bike) => bike.name || "Bike listed")
    .join(", ");
}

function bookingDate(booking: BookingItem) {
  return (
    booking.scheduled_at ||
    booking.scheduled_start_at ||
    booking.booking_date ||
    null
  );
}

export default function AdminOperations() {
  const { user } = useAuth();

  const [data, setData] = useState<OperationsResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  async function load() {
    setLoading(true);
    setError(null);

    try {
      const sessionResult = await sb.auth.getSession();
      const token = sessionResult.data.session?.access_token || "";

      if (!token) {
        throw new Error(
          "You must be signed in with the authorized admin account.",
        );
      }

      const supabaseUrl = (import.meta as any).env?.VITE_SUPABASE_URL;
      const anonKey = (import.meta as any).env?.VITE_SUPABASE_ANON_KEY;
      const configuredBase = (import.meta as any).env?.VITE_FUNCTIONS_BASE;

      const base =
        configuredBase ||
        (supabaseUrl ? `${supabaseUrl}/functions/v1` : "");

      if (!base) {
        throw new Error("Functions URL is not configured.");
      }

      const response = await fetch(`${base}/get-admin-operations`, {
        method: "GET",
        headers: {
          Authorization: `Bearer ${token}`,
          ...(anonKey ? { apikey: anonKey } : {}),
        },
      });

      const text = await response.text();

      let payload: any = {};

      try {
        payload = text ? JSON.parse(text) : {};
      } catch {
        throw new Error(
          `The admin function returned an invalid response (${response.status}).`,
        );
      }

      if (!response.ok) {
        throw new Error(
          payload?.details ||
            payload?.error ||
            payload?.message ||
            `Request failed (${response.status})`,
        );
      }

      setData(payload as OperationsResponse);
    } catch (err: any) {
      setData(null);
      setError(err?.message || "Failed to load admin operations.");
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    void load();

    const timer = window.setInterval(() => {
      void load();
    }, 60000);

    return () => window.clearInterval(timer);
  }, []);

  const attentionCount = useMemo(() => {
    if (!data) return 0;

    return (
      data.stats.pending_payment +
      data.stats.pending_mentor_acceptance +
      data.stats.needs_review +
      data.stats.completed_unsettled +
      data.stats.past_confirmed_unfinished
    );
  }, [data]);

  const page: React.CSSProperties = {
    padding: "2rem 0",
    display: "grid",
    gap: 16,
  };

  const card: React.CSSProperties = {
    background: "white",
    border: "1px solid #e2e8f0",
    borderRadius: 18,
    padding: 16,
  };

  const statGrid: React.CSSProperties = {
    display: "grid",
    gridTemplateColumns: "repeat(auto-fit, minmax(170px, 1fr))",
    gap: 12,
  };

  const statCard: React.CSSProperties = {
    background: "white",
    border: "1px solid #e2e8f0",
    borderRadius: 16,
    padding: 14,
  };

  const tableWrap: React.CSSProperties = {
    marginTop: 12,
    overflowX: "auto",
  };

  const table: React.CSSProperties = {
    width: "100%",
    borderCollapse: "collapse",
    minWidth: 760,
  };

  const th: React.CSSProperties = {
    textAlign: "left",
    padding: "10px 8px",
    borderBottom: "1px solid #cbd5e1",
    color: "#334155",
    fontSize: 13,
    whiteSpace: "nowrap",
  };

  const td: React.CSSProperties = {
    padding: "10px 8px",
    borderBottom: "1px solid #e2e8f0",
    color: "#334155",
    fontWeight: 600,
    verticalAlign: "top",
  };

  const muted: React.CSSProperties = {
    color: "#64748b",
    fontWeight: 600,
  };

  function UserPeriod({
    title,
    subtitle,
    count,
    users,
  }: {
    title: string;
    subtitle: string;
    count: UserCount;
    users: UserItem[];
  }) {
    return (
      <div style={card}>
        <div
          style={{
            display: "flex",
            justifyContent: "space-between",
            alignItems: "flex-start",
            gap: 12,
            flexWrap: "wrap",
          }}
        >
          <div>
            <div style={{ fontSize: 22, fontWeight: 800 }}>{title}</div>
            <div style={{ ...muted, marginTop: 4 }}>{subtitle}</div>
          </div>

          <div style={{ fontSize: 30, fontWeight: 900 }}>{count.total}</div>
        </div>

        <div
          style={{
            marginTop: 12,
            display: "flex",
            gap: 8,
            flexWrap: "wrap",
          }}
        >
          <span style={badgeStyle}>
            Mentors: {count.mentors}
          </span>

          <span style={badgeStyle}>
            Test-takers: {count.test_takers}
          </span>

          <span style={badgeStyle}>
            Unclassified: {count.no_bike_listed}
          </span>
        </div>

        {users.length === 0 ? (
          <div style={{ ...muted, marginTop: 14 }}>
            No new users in this period.
          </div>
        ) : (
          <div style={tableWrap}>
            <table style={table}>
              <thead>
                <tr>
                  <th style={th}>Joined</th>
                  <th style={th}>Name</th>
                  <th style={th}>Email</th>
                  <th style={th}>City</th>
                  <th style={th}>Classification</th>
                  <th style={th}>Bike</th>
                  <th style={th}>Booking requests</th>
                </tr>
              </thead>

              <tbody>
                {users.map((item) => (
                  <tr key={item.id}>
                    <td style={td}>{fmtDateTime(item.joined_at)}</td>
                    <td style={td}>{item.full_name || "Name not provided"}</td>
                    <td style={td}>{item.email || "—"}</td>
                    <td style={td}>{item.city || "Not provided"}</td>
                    <td style={td}>{item.classification_label}</td>
                    <td style={td}>{userBikeName(item)}</td>
                    <td style={td}>{item.borrower_booking_count || 0}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
    );
  }

  function BookingTable({
    bookings,
    emptyText,
  }: {
    bookings: BookingItem[];
    emptyText: string;
  }) {
    if (!bookings.length) {
      return <div style={{ ...muted, marginTop: 12 }}>{emptyText}</div>;
    }

    return (
      <div style={tableWrap}>
        <table style={table}>
          <thead>
            <tr>
              <th style={th}>Booking</th>
              <th style={th}>Created</th>
              <th style={th}>Scheduled</th>
              <th style={th}>State</th>
              <th style={th}>Bike</th>
              <th style={th}>Borrower</th>
              <th style={th}>Mentor</th>
            </tr>
          </thead>

          <tbody>
            {bookings.map((booking) => (
              <tr key={booking.id}>
                <td style={td}>{shortId(booking.id)}</td>
                <td style={td}>{fmtDateTime(booking.created_at)}</td>
                <td style={td}>{fmtDateTime(bookingDate(booking))}</td>
                <td style={td}>{booking.state || booking.status || "—"}</td>
                <td style={td}>
                  {booking.bike?.name || shortId(booking.bike_id)}
                </td>
                <td style={td}>{shortId(booking.borrower_id)}</td>
                <td style={td}>{shortId(booking.owner_id)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    );
  }

  const badgeStyle: React.CSSProperties = {
    display: "inline-flex",
    border: "1px solid #cbd5e1",
    borderRadius: 999,
    padding: "5px 10px",
    background: "#f8fafc",
    fontSize: 13,
    fontWeight: 700,
    color: "#334155",
  };

  if (!user) {
    return (
      <div style={page}>
        <div style={card}>
          You must be signed in to view this page.
        </div>
      </div>
    );
  }

  return (
    <div style={page}>
      <div style={card}>
        <div
          style={{
            display: "flex",
            justifyContent: "space-between",
            alignItems: "center",
            gap: 12,
            flexWrap: "wrap",
          }}
        >
          <div>
            <h1 style={{ margin: 0, fontSize: 32 }}>
              BMB Operations
            </h1>

            <div style={{ ...muted, marginTop: 8 }}>
              Read-only operating dashboard for users, mentors,
              bikes and bookings.
            </div>

            <div style={{ ...muted, marginTop: 4, fontSize: 13 }}>
              Signed in as {user.email || "admin"}
            </div>
          </div>

          <div style={{ display: "flex", gap: 10, flexWrap: "wrap" }}>
            <Link
              to="/admin/reviews"
              style={{
                padding: "10px 14px",
                borderRadius: 14,
                border: "1px solid #cbd5e1",
                background: "white",
                color: "#0f172a",
                fontWeight: 700,
                textDecoration: "none",
              }}
            >
              Review Queue
            </Link>

            <button
              onClick={() => void load()}
              disabled={loading}
              style={{
                padding: "10px 14px",
                borderRadius: 14,
                border: "1px solid #0f172a",
                background: "#0f172a",
                color: "white",
                fontWeight: 700,
                cursor: "pointer",
                opacity: loading ? 0.65 : 1,
              }}
            >
              {loading ? "Loading…" : "Refresh"}
            </button>
          </div>
        </div>

        {data?.generated_at ? (
          <div style={{ ...muted, marginTop: 10, fontSize: 12 }}>
            Last generated: {fmtDateTime(data.generated_at)}
          </div>
        ) : null}
      </div>

      {error ? (
        <div
          style={{
            ...card,
            borderColor: "#fecaca",
            background: "#fff1f2",
            color: "#9f1239",
            fontWeight: 700,
          }}
        >
          <div style={{ fontSize: 18, fontWeight: 900 }}>
            Could not load operations
          </div>
          <div style={{ marginTop: 8 }}>{error}</div>
        </div>
      ) : null}

      {loading && !data ? (
        <div style={card}>Loading BMB operations…</div>
      ) : null}

      {data ? (
        <>
          <div style={statGrid}>
            <div style={statCard}>
              <div style={muted}>New users — 14 days</div>
              <div style={{ marginTop: 8, fontSize: 32, fontWeight: 900 }}>
                {data.stats.users_last_14_days}
              </div>
            </div>

            <div style={statCard}>
              <div style={muted}>New mentors — 14 days</div>
              <div style={{ marginTop: 8, fontSize: 32, fontWeight: 900 }}>
                {data.stats.new_mentors_last_14_days}
              </div>
            </div>

            <div style={statCard}>
              <div style={muted}>Active bikes</div>
              <div style={{ marginTop: 8, fontSize: 32, fontWeight: 900 }}>
                {data.stats.active_bikes}
              </div>
              <div style={{ ...muted, marginTop: 4, fontSize: 12 }}>
                {data.stats.total_bikes} total
              </div>
            </div>

            <div style={statCard}>
              <div style={muted}>Upcoming — 7 days</div>
              <div style={{ marginTop: 8, fontSize: 32, fontWeight: 900 }}>
                {data.stats.upcoming_next_7_days}
              </div>
            </div>

            <div
              style={{
                ...statCard,
                borderColor: attentionCount ? "#fca5a5" : "#e2e8f0",
                background: attentionCount ? "#fff7ed" : "white",
              }}
            >
              <div style={muted}>Needs attention</div>
              <div style={{ marginTop: 8, fontSize: 32, fontWeight: 900 }}>
                {attentionCount}
              </div>
            </div>
          </div>

          <UserPeriod
            title="New users today"
            subtitle="Accounts created since midnight."
            count={data.user_counts.today}
            users={data.users.today}
          />

          <UserPeriod
            title="New users: yesterday through 7 days ago"
            subtitle="Recent users who may need follow-up."
            count={data.user_counts.yesterday_to_7_days}
            users={data.users.yesterday_to_7_days}
          />

          <UserPeriod
            title="New users: 8–14 days ago"
            subtitle="Older recent users who may still need contact."
            count={data.user_counts.days_8_to_14}
            users={data.users.days_8_to_14}
          />

          <div style={card}>
            <div style={{ fontSize: 24, fontWeight: 850 }}>
              City breakdown
            </div>

            <div style={{ ...muted, marginTop: 6 }}>
              New-user activity from the past 14 days.
            </div>

            {data.cities.length === 0 ? (
              <div style={{ ...muted, marginTop: 12 }}>
                No city data available.
              </div>
            ) : (
              <div style={tableWrap}>
                <table style={table}>
                  <thead>
                    <tr>
                      <th style={th}>City</th>
                      <th style={th}>Users</th>
                      <th style={th}>Mentors</th>
                      <th style={th}>Test-takers</th>
                      <th style={th}>Unclassified</th>
                    </tr>
                  </thead>

                  <tbody>
                    {data.cities.map((city) => (
                      <tr key={city.city}>
                        <td style={td}>{city.city}</td>
                        <td style={td}>{city.users}</td>
                        <td style={td}>{city.mentors}</td>
                        <td style={td}>{city.test_takers}</td>
                        <td style={td}>{city.no_bike_listed}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </div>

          <div style={card}>
            <div style={{ fontSize: 24, fontWeight: 850 }}>
              New bikes — last 14 days
            </div>

            {data.mentors.new_bikes_last_14_days.length === 0 ? (
              <div style={{ ...muted, marginTop: 12 }}>
                No new bikes in the last 14 days.
              </div>
            ) : (
              <div style={tableWrap}>
                <table style={table}>
                  <thead>
                    <tr>
                      <th style={th}>Added</th>
                      <th style={th}>Bike</th>
                      <th style={th}>City</th>
                      <th style={th}>Status</th>
                      <th style={th}>Owner</th>
                    </tr>
                  </thead>

                  <tbody>
                    {data.mentors.new_bikes_last_14_days.map((bike) => (
                      <tr key={bike.id}>
                        <td style={td}>{fmtDateTime(bike.created_at)}</td>
                        <td style={td}>{bike.name || "Bike listed"}</td>
                        <td style={td}>
                          {bike.city}
                          {bike.province ? `, ${bike.province}` : ""}
                        </td>
                        <td style={td}>
                          {bike.is_active ? "Active" : "Inactive"}
                        </td>
                        <td style={td}>{shortId(bike.owner_id)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </div>

          <div style={card}>
            <div style={{ fontSize: 24, fontWeight: 850 }}>
              Needs attention
            </div>

            <div style={{ ...muted, marginTop: 6 }}>
              Read-only alerts. No action is performed from this page.
            </div>

            <div style={{ marginTop: 16 }}>
              <div style={{ fontSize: 19, fontWeight: 800 }}>
                Pending payment ({data.stats.pending_payment})
              </div>

              <BookingTable
                bookings={data.bookings.pending_payment}
                emptyText="No pending-payment bookings."
              />
            </div>

            <div style={{ marginTop: 22 }}>
              <div style={{ fontSize: 19, fontWeight: 800 }}>
                Waiting for mentor acceptance (
                {data.stats.pending_mentor_acceptance})
              </div>

              <BookingTable
                bookings={data.bookings.pending_mentor_acceptance}
                emptyText="No requests waiting for mentor acceptance."
              />
            </div>

            <div style={{ marginTop: 22 }}>
              <div style={{ fontSize: 19, fontWeight: 800 }}>
                Past confirmed but unfinished (
                {data.stats.past_confirmed_unfinished})
              </div>

              <BookingTable
                bookings={data.bookings.past_confirmed_unfinished}
                emptyText="No past confirmed bookings are unfinished."
              />
            </div>

            <div style={{ marginTop: 22 }}>
              <div style={{ fontSize: 19, fontWeight: 800 }}>
                Completed but unsettled (
                {data.stats.completed_unsettled})
              </div>

              <BookingTable
                bookings={data.bookings.completed_unsettled}
                emptyText="No completed bookings are waiting for settlement."
              />
            </div>

            <div style={{ marginTop: 22 }}>
              <div style={{ fontSize: 19, fontWeight: 800 }}>
                Needs review ({data.stats.needs_review})
              </div>

              <BookingTable
                bookings={data.bookings.needs_review}
                emptyText="No bookings need manual review."
              />
            </div>
          </div>

          <div style={card}>
            <div style={{ fontSize: 24, fontWeight: 850 }}>
              Upcoming tests — next 7 days
            </div>

            <BookingTable
              bookings={data.bookings.upcoming_next_7_days}
              emptyText="No upcoming tests in the next seven days."
            />
          </div>

          <div style={card}>
            <div style={{ fontSize: 24, fontWeight: 850 }}>
              Recent booking history
            </div>

            <BookingTable
              bookings={data.bookings.recent_history.slice(0, 25)}
              emptyText="No recent booking history."
            />
          </div>
        </>
      ) : null}
    </div>
  );
}
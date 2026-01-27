// src/pages/OwnerDashboard.tsx
import { useEffect, useMemo, useState } from "react";
import { Link } from "react-router-dom";
import { sb } from "../lib/supabase";
import { useAuth } from "../auth/useAuth";
import BoostModal from "../components/BoostModal";

type BikeRow = {
  id: string;
  owner_id: string | null;
  make?: string | null;
  model?: string | null;
  year?: number | null;
  city?: string | null;
  is_active?: boolean | null;
  photos?: string | null;
};

type BookingRow = Record<string, any> & {
  id: string;
  bike_id?: string | null;
  owner_id?: string | null;
  borrower_id?: string | null;

  booking_date?: string | null;
  scheduled_start_at?: string | null;

  duration_minutes?: number | null;
  status?: string | null;

  borrower_paid?: boolean | null;
  owner_deposit_paid?: boolean | null;

  cancelled?: boolean | null;
  cancelled_by?: string | null;

  completed?: boolean | null;
  settled?: boolean | null;

  created_at?: string | null;
  updated_at?: string | null;

  borrower_checked_in?: boolean | null;
  owner_checked_in?: boolean | null;

  borrower_confirmed_complete?: boolean | null;
  owner_confirmed_complete?: boolean | null;

  settled_at?: string | null;
  settlement_outcome?: string | null;
};

type CreditRow = {
  id: string;
  created_at: string | null;
  user_id: string;
  booking_id: string | null;
  amount: number;
  status: string | null;
  expires_at: string | null;
  used_at: string | null;
};

const BUCKET = "bike-photos";
const MS_DAY = 24 * 60 * 60 * 1000;

// Backend windows
const CHECKIN_OPEN_MIN = 15;
const CHECKIN_CLOSE_MIN = 60;
const MIN_COMPLETE_MIN = 20;

function coverVersionKey(bikeId: string) {
  return `bike_cover_v_${bikeId}`;
}
function getCoverVersion(bikeId: string) {
  try {
    return sessionStorage.getItem(coverVersionKey(bikeId)) || "";
  } catch {
    return "";
  }
}
function coverUrl(ownerId: string, bikeId: string) {
  const path = `${ownerId}/${bikeId}/cover.webp`;
  const { data } = sb.storage.from(BUCKET).getPublicUrl(path);
  const v = getCoverVersion(bikeId);
  return v ? `${data.publicUrl}?v=${v}` : data.publicUrl;
}

function shortId(id?: string | null) {
  if (!id) return "—";
  return id.slice(0, 8) + "…";
}

function fmtDateTime(iso: string | null | undefined) {
  if (!iso) return "—";
  const d = new Date(iso);
  if (isNaN(d.getTime())) return "—";
  return d.toLocaleString(undefined, {
    year: "numeric",
    month: "short",
    day: "2-digit",
    hour: "numeric",
    minute: "2-digit",
  });
}

function scheduledIsoFor(b: BookingRow) {
  return (b.scheduled_start_at ?? b.booking_date ?? null) as string | null;
}

function scheduledMsFor(b: BookingRow) {
  const iso = scheduledIsoFor(b);
  if (!iso) return NaN;
  const t = new Date(iso).getTime();
  return Number.isFinite(t) ? t : NaN;
}

function isPastScheduled(b: BookingRow) {
  const t = scheduledMsFor(b);
  if (!Number.isFinite(t)) return false;
  return t < Date.now();
}

// Late cancel includes DAY 5 (≤ 5 days)
function isLateCancelForfeit(b: BookingRow) {
  if (!b.borrower_paid || !b.owner_deposit_paid) return false;
  const t = scheduledMsFor(b);
  if (!Number.isFinite(t)) return false;
  const daysUntil = (t - Date.now()) / MS_DAY;
  return daysUntil <= 5;
}

function cancelKeywordFor(b: BookingRow) {
  return isLateCancelForfeit(b) ? "FORFEIT" : "CANCEL";
}

function cancelButtonLabelFor(b: BookingRow) {
  return isLateCancelForfeit(b) ? "FORFEIT" : "Cancel (early)";
}

function cancelTitleFor(b: BookingRow) {
  return isLateCancelForfeit(b)
    ? 'Late cancellation (≤ 5 days, including day 5). Cancelling party forfeits. Type "FORFEIT" to proceed.'
    : 'Early cancellation (more than 5 days). 25% admin fee applies. Type "CANCEL" to proceed.';
}

function checkInWindowFor(b: BookingRow) {
  const startMs = scheduledMsFor(b);
  if (!Number.isFinite(startMs)) return null;
  const openMs = startMs - CHECKIN_OPEN_MIN * 60 * 1000;
  const closeMs = startMs + CHECKIN_CLOSE_MIN * 60 * 1000;
  return { startMs, openMs, closeMs };
}

function completionAllowedAtFor(b: BookingRow) {
  const startMs = scheduledMsFor(b);
  if (!Number.isFinite(startMs)) return null;
  const allowedAtMs = startMs + MIN_COMPLETE_MIN * 60 * 1000;
  return { startMs, allowedAtMs };
}

function isWithin(ms: number, a: number, b: number) {
  return ms >= a && ms <= b;
}

export default function OwnerDashboard() {
  const { user } = useAuth();
  const me = user?.id ?? null;

  const [bike, setBike] = useState<BikeRow | null>(null);
  const [bookings, setBookings] = useState<BookingRow[]>([]);
  const [credits, setCredits] = useState<CreditRow[]>([]);

  const [loading, setLoading] = useState(false);
  const [loadErr, setLoadErr] = useState<string | null>(null);

  const [busyId, setBusyId] = useState<string | null>(null);
  const [rowErr, setRowErr] = useState<Record<string, string>>({});
  const [rowOk, setRowOk] = useState<Record<string, string>>({});

  const [boostOpen, setBoostOpen] = useState(false);

  function setBookingErr(bookingId: string, msg: string) {
    setRowErr((prev) => ({ ...prev, [bookingId]: msg }));
  }
  function clearBookingErr(bookingId: string) {
    setRowErr((prev) => {
      const next = { ...prev };
      delete next[bookingId];
      return next;
    });
  }
  function setBookingOk(bookingId: string, msg: string) {
    setRowOk((prev) => ({ ...prev, [bookingId]: msg }));
  }
  function clearBookingOk(bookingId: string) {
    setRowOk((prev) => {
      const next = { ...prev };
      delete next[bookingId];
      return next;
    });
  }

  async function loadMyBike() {
    if (!me) return;
    const res = await sb
      .from("bikes")
      .select("id,owner_id,make,model,year,city,is_active,photos")
      .eq("owner_id", me)
      .limit(1)
      .maybeSingle();

    if (res.error) throw res.error;
    setBike((res.data as any) ?? null);
  }

  async function loadOwnerBookings() {
    if (!me) return;

    const q = sb.from("bookings").select("*").eq("owner_id", me).limit(200);

    let res = await q.order("scheduled_start_at", { ascending: false });
    if (res.error && res.error.message?.toLowerCase().includes("does not exist")) {
      res = await q.order("booking_date", { ascending: false });
    }

    if (res.error) throw res.error;
    setBookings((res.data as any[]) ?? []);
  }

  async function loadMyCredits() {
    if (!me) return;

    const res = await sb
      .from("credits")
      .select("id,created_at,user_id,booking_id,amount,status,expires_at,used_at")
      .eq("user_id", me)
      .order("created_at", { ascending: false })
      .limit(50);

    if (res.error) throw res.error;

    const raw = (((res.data as any) || []) as CreditRow[]).filter((c) => {
      if (c.used_at) return false;
      if (c.status && c.status !== "available") return false;
      if (c.expires_at) {
        const t = new Date(c.expires_at).getTime();
        if (!Number.isNaN(t) && t < Date.now()) return false;
      }
      return true;
    });

    setCredits(raw);
  }

  async function refresh() {
    if (!me) return;
    setLoadErr(null);
    setLoading(true);
    try {
      await Promise.all([loadMyBike(), loadOwnerBookings(), loadMyCredits()]);
    } catch (e: any) {
      setLoadErr(e?.message ?? "Failed to load owner dashboard.");
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    refresh();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [me]);

  const { requests, upcoming, history } = useMemo(() => {
    const req: BookingRow[] = [];
    const up: BookingRow[] = [];
    const hist: BookingRow[] = [];

    for (const b of bookings) {
      const cancelled = !!b.cancelled;
      const completed = !!b.completed;
      const settled = !!b.settled;

      const borrowerPaid = !!b.borrower_paid;
      const ownerPaid = !!b.owner_deposit_paid;

      const past = isPastScheduled(b);

      if (cancelled || completed || settled || past) {
        hist.push(b);
        continue;
      }

      if (borrowerPaid && !ownerPaid) {
        req.push(b);
        continue;
      }

      if (borrowerPaid && ownerPaid) {
        up.push(b);
        continue;
      }

      hist.push(b);
    }

    const sortDesc = (a: BookingRow, b: BookingRow) => {
      const ta = new Date((scheduledIsoFor(a) || a.created_at || "") as string).getTime();
      const tb = new Date((scheduledIsoFor(b) || b.created_at || "") as string).getTime();
      return (Number.isNaN(tb) ? 0 : tb) - (Number.isNaN(ta) ? 0 : ta);
    };

    req.sort(sortDesc);
    up.sort(sortDesc);
    hist.sort(sortDesc);

    return { requests: req, upcoming: up, history: hist };
  }, [bookings]);

  async function acceptBooking(b: BookingRow) {
    if (!me) return;

    const bookingId = b.id;
    const bikeId = b.bike_id ?? null;

    clearBookingErr(bookingId);
    clearBookingOk(bookingId);

    if (isPastScheduled(b)) {
      setBookingErr(bookingId, "This request is expired (scheduled time already passed).");
      return;
    }

    if (b.owner_deposit_paid) {
      setBookingErr(bookingId, "Already accepted (deposit paid). Hit Refresh.");
      return;
    }

    if (!bookingId || !bikeId) {
      setBookingErr(bookingId, "Missing booking_id or bike_id on this booking row.");
      return;
    }

    setBusyId(bookingId);

    const { data, error } = await sb.functions.invoke("create-owner-deposit-payment", {
      body: { booking_id: bookingId, owner_id: me, bike_id: bikeId },
    });

    setBusyId(null);

    if (error) {
      const msg = error.message || "Failed to accept booking.";
      if (msg.toLowerCase().includes("non-2xx")) {
        setBookingErr(
          bookingId,
          "Accept failed (Edge Function non-2xx). If you already paid the deposit, hit Refresh — it should move to Upcoming."
        );
      } else {
        setBookingErr(bookingId, msg);
      }
      return;
    }

    const url = (data as any)?.checkout_url ?? null;
    if (url) {
      window.location.assign(url);
      return;
    }

    await refresh();
  }

  async function cancelBookingAsOwner(b: BookingRow) {
    if (!me) return;

    const bookingId = b.id;
    clearBookingErr(bookingId);
    clearBookingOk(bookingId);

    if (b.cancelled) {
      setBookingErr(bookingId, "Already cancelled. Hit Refresh.");
      return;
    }

    const keyword = cancelKeywordFor(b);
    const typed = prompt(`Type "${keyword}" to cancel this booking:`);

    if (!typed) return;
    if (typed.trim().toUpperCase() !== keyword) {
      alert(`Cancel aborted. You must type ${keyword} exactly.`);
      return;
    }

    setBusyId(bookingId);

    const { error } = await sb.functions.invoke("cancel-booking", {
      body: { booking_id: b.id, cancelled_by: "owner" },
    });

    setBusyId(null);

    if (error) {
      const msg = error.message || "Failed to cancel booking.";
      setBookingErr(bookingId, msg);
      return;
    }

    setBookingOk(bookingId, "Cancelled ✅");
    await refresh();
  }

  async function checkInAsOwner(b: BookingRow) {
    if (!me) return;
    const bookingId = b.id;

    clearBookingErr(bookingId);
    clearBookingOk(bookingId);

    const w = checkInWindowFor(b);
    if (!w) {
      setBookingErr(bookingId, "Missing scheduled time; cannot check in.");
      return;
    }

    const now = Date.now();
    if (!isWithin(now, w.openMs, w.closeMs)) {
      setBookingErr(
        bookingId,
        `Check-in is only available from ${fmtDateTime(new Date(w.openMs).toISOString())} to ${fmtDateTime(
          new Date(w.closeMs).toISOString()
        )}.`
      );
      return;
    }

    setBusyId(bookingId);

    const { error } = await sb.functions.invoke("check-in", {
      body: { booking_id: bookingId, actor: "owner" },
    });

    setBusyId(null);

    if (error) {
      setBookingErr(bookingId, error.message || "Check-in failed.");
      return;
    }

    setBookingOk(bookingId, "Checked in ✅");
    await refresh();
  }

  async function confirmBikeReturnedAsOwner(b: BookingRow) {
    if (!me) return;
    const bookingId = b.id;

    clearBookingErr(bookingId);
    clearBookingOk(bookingId);

    const typed = prompt('Type "RETURNED" to confirm YOUR bike is returned:');
    if (!typed) return;
    if (typed.trim().toUpperCase() !== "RETURNED") {
      alert("Aborted. You must type RETURNED exactly.");
      return;
    }

    const comp = completionAllowedAtFor(b);
    if (!comp) {
      setBookingErr(bookingId, "Missing scheduled time; cannot confirm return.");
      return;
    }

    const now = Date.now();
    if (now < comp.allowedAtMs) {
      setBookingErr(bookingId, `Too early to confirm return. Available at ${fmtDateTime(new Date(comp.allowedAtMs).toISOString())}.`);
      return;
    }

    if (!b.owner_checked_in || !b.borrower_checked_in) {
      setBookingErr(bookingId, "Both parties must check in before confirming return.");
      return;
    }

    setBusyId(bookingId);

    const { data, error } = await sb.functions.invoke("complete-booking", {
      body: { booking_id: bookingId, actor: "owner" },
    });

    setBusyId(null);

    if (error) {
      setBookingErr(bookingId, error.message || "Failed to confirm return.");
      return;
    }

    const message = (data as any)?.message ?? "Saved ✅";
    setBookingOk(bookingId, message);
    await refresh();
  }

  const bikeTitle = useMemo(() => {
    if (!bike) return "—";
    const label = [bike.year, bike.make, bike.model].filter(Boolean).join(" ");
    return label || "Your bike";
  }, [bike]);

  const bikeCover = useMemo(() => {
    if (!bike?.id || !me) return null;
    return coverUrl(me, bike.id);
  }, [bike?.id, me]);

  const creditCard = (
    <div
      style={{
        marginTop: 16,
        border: "1px solid #e2e8f0",
        borderRadius: 18,
        padding: 16,
        background: "white",
      }}
    >
      <div style={{ fontWeight: 1000, fontSize: 18 }}>Credits </div>
      <div style={{ marginTop: 6, color: "#475569", fontWeight: 700 }}>
        Credits automatically apply at checkout before Stripe. Unused credit may be returned at end of season (per policy).
        {" "}
        <Link to="/legal" style={{ fontWeight: 950 }}>Rules &amp; Process →</Link>
      </div>

      {credits.length === 0 ? (
        <div style={{ marginTop: 12, color: "#64748b", fontWeight: 800 }}>No credits available.</div>
      ) : (
        <div style={{ marginTop: 12, overflowX: "auto" }}>
          <table style={{ width: "100%", borderCollapse: "collapse", minWidth: 760 }}>
            <thead>
              <tr style={{ textAlign: "left", color: "#0f172a" }}>
                <th style={{ paddingBottom: 10 }}>Amount</th>
                <th style={{ paddingBottom: 10 }}>From booking</th>
                <th style={{ paddingBottom: 10 }}>Created</th>
                <th style={{ paddingBottom: 10 }}>Expires</th>
                <th style={{ paddingBottom: 10 }}>Status</th>
              </tr>
            </thead>
            <tbody>
              {credits.map((c) => (
                <tr key={c.id} style={{ borderTop: "1px solid #e2e8f0" }}>
                  <td style={{ padding: "10px 0", fontWeight: 1000 }}>${Number(c.amount).toFixed(2)}</td>
                  <td style={{ padding: "10px 0", fontWeight: 900 }}>{shortId(c.booking_id)}</td>
                  <td style={{ padding: "10px 0", fontWeight: 800, color: "#334155" }}>{fmtDateTime(c.created_at)}</td>
                  <td style={{ padding: "10px 0", fontWeight: 800, color: "#334155" }}>{fmtDateTime(c.expires_at)}</td>
                  <td style={{ padding: "10px 0", fontWeight: 900, color: "#166534" }}>{c.status || "available"}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );

  return (
    <div style={{ maxWidth: 1050, margin: "0 auto", padding: 18 }}>
      <div style={{ display: "flex", justifyContent: "space-between", gap: 12, alignItems: "baseline", flexWrap: "wrap" }}>
        <div>
          <h1 style={{ margin: 0 }}>Owner Dashboard</h1>
          <div style={{ marginTop: 6, color: "#475569", fontWeight: 700 }}>
            Your bike + booking requests. Owner acceptance window is enforced.
          </div>
          <div style={{ marginTop: 6, color: "#64748b", fontWeight: 800, fontSize: 13 }}>
            Want the full “no surprises” breakdown? <Link to="/legal" style={{ fontWeight: 950 }}>Rules &amp; Process →</Link>
          </div>
        </div>

        <div style={{ display: "flex", gap: 10, flexWrap: "wrap", alignItems: "center" }}>
          <Link to="/browse" style={{ fontWeight: 900 }}>
            Browse →
          </Link>
          <button
            onClick={refresh}
            disabled={loading}
            style={{
              padding: "10px 14px",
              borderRadius: 14,
              border: "1px solid #0f172a",
              background: "#0f172a",
              color: "white",
              fontWeight: 950,
              cursor: "pointer",
              opacity: loading ? 0.7 : 1,
            }}
          >
            {loading ? "Loading…" : "Refresh"}
          </button>
        </div>
      </div>

      {loadErr ? (
        <div
          style={{
            marginTop: 14,
            padding: 12,
            borderRadius: 12,
            border: "1px solid #fecaca",
            background: "#fef2f2",
            color: "#991b1b",
            fontWeight: 900,
          }}
        >
          Error: {loadErr}
        </div>
      ) : null}

      {creditCard}

      {/* My Bike */}
      <div
        style={{
          marginTop: 16,
          border: "1px solid #e2e8f0",
          borderRadius: 18,
          padding: 16,
          background: "white",
        }}
      >
        <div style={{ fontWeight: 1000, fontSize: 18 }}>My Bike</div>
        <div style={{ marginTop: 6, color: "#475569", fontWeight: 700 }}>
          One bike per owner (for now). You can edit details any time.
        </div>

        <div style={{ marginTop: 12, display: "flex", gap: 10, flexWrap: "wrap" }}>
          <button
            onClick={refresh}
            disabled={loading}
            style={{
              padding: "10px 14px",
              borderRadius: 14,
              border: "1px solid #cbd5e1",
              background: "white",
              fontWeight: 900,
              cursor: "pointer",
              opacity: loading ? 0.7 : 1,
            }}
          >
            Reload bike
          </button>

          <Link
            to="/owners/start"
            style={{
              padding: "10px 14px",
              borderRadius: 14,
              border: "1px solid #0f172a",
              background: "#0f172a",
              color: "white",
              fontWeight: 950,
              textDecoration: "none",
            }}
          >
            Edit bike
          </Link>

          <button
            onClick={() => setBoostOpen(true)}
            style={{
              padding: "10px 14px",
              borderRadius: 14,
              border: "1px solid #cbd5e1",
              background: "white",
              fontWeight: 900,
              cursor: "pointer",
              opacity: 0.6,
            }}
            disabled
            title="Boost coming soon"
          >
            Boost (soon)
          </button>

          <Link
            to="/legal#cancellations"
            style={{
              padding: "10px 14px",
              borderRadius: 14,
              border: "1px solid #cbd5e1",
              background: "white",
              fontWeight: 900,
              textDecoration: "none",
              color: "#0f172a",
            }}
          >
            Cancellation policy
          </Link>

          <Link
            to="/legal"
            style={{
              padding: "10px 14px",
              borderRadius: 14,
              border: "1px solid #cbd5e1",
              background: "white",
              fontWeight: 900,
              textDecoration: "none",
              color: "#0f172a",
            }}
          >
            Rules &amp; Process
          </Link>
        </div>

        <div style={{ marginTop: 14, display: "flex", gap: 14, alignItems: "center", flexWrap: "wrap" }}>
          <div
            style={{
              width: 150,
              height: 95,
              borderRadius: 14,
              overflow: "hidden",
              border: "1px solid #e2e8f0",
              background: "#f1f5f9",
            }}
          >
            {bikeCover ? (
              <img src={bikeCover} alt="Bike" style={{ width: "100%", height: "100%", objectFit: "cover", display: "block" }} />
            ) : (
              <div style={{ width: "100%", height: "100%", display: "grid", placeItems: "center", color: "#64748b", fontWeight: 900 }}>
                No photo
              </div>
            )}
          </div>

          <div style={{ flex: 1, minWidth: 240 }}>
            <div style={{ fontWeight: 1000, fontSize: 18 }}>{bikeTitle}</div>
            <div style={{ marginTop: 4, color: "#64748b", fontWeight: 800 }}>
              city: {bike?.city || "—"} • id: {bike?.id ? shortId(bike.id) : "—"} • active: {bike?.is_active ? "Yes" : "No"}
            </div>
            <div style={{ marginTop: 4, color: "#64748b", fontWeight: 750 }}>
              Photo updates after clicking Save bike on the edit page.
            </div>
          </div>

          <div style={{ minWidth: 140, textAlign: "left" }}>
            <div style={{ fontWeight: 900 }}>Boost status</div>
            <div style={{ marginTop: 6, color: "#64748b", fontWeight: 800 }}>—</div>
          </div>
        </div>
      </div>

      {/* Booking Requests */}
      <div
        style={{
          marginTop: 16,
          border: "1px solid #e2e8f0",
          borderRadius: 18,
          padding: 16,
          background: "white",
        }}
      >
        <div style={{ fontWeight: 1000, fontSize: 18 }}>Booking Requests</div>
        <div style={{ marginTop: 6, color: "#475569", fontWeight: 700 }}>
          “Accept” opens checkout for your $150 deposit (unless credit covers it). Expired requests automatically move to History.
        </div>

        {requests.length === 0 ? (
          <div style={{ marginTop: 12, color: "#64748b", fontWeight: 800 }}>No pending requests.</div>
        ) : (
          <div style={{ marginTop: 12, display: "grid", gap: 10 }}>
            {requests.map((b) => {
              const whenIso = scheduledIsoFor(b);
              const when = (whenIso || "") as string;
              const isBusy = busyId === b.id;
              const disabled = isBusy || loading;

              return (
                <div
                  key={b.id}
                  style={{
                    border: "1px solid #e2e8f0",
                    borderRadius: 14,
                    padding: 12,
                    display: "flex",
                    justifyContent: "space-between",
                    gap: 12,
                    flexWrap: "wrap",
                    alignItems: "center",
                  }}
                >
                  <div>
                    <div style={{ fontWeight: 1000 }}>Booking {shortId(b.id)}</div>
                    <div style={{ marginTop: 4, color: "#64748b", fontWeight: 800 }}>
                      scheduled: {fmtDateTime(when)} • bike: {b.bike_id ? shortId(String(b.bike_id)) : "—"}
                    </div>

                    {rowErr[b.id] ? <div style={{ marginTop: 8, color: "#991b1b", fontWeight: 900 }}>{rowErr[b.id]}</div> : null}
                    {rowOk[b.id] ? <div style={{ marginTop: 8, color: "#166534", fontWeight: 900 }}>{rowOk[b.id]}</div> : null}

                    <div style={{ marginTop: 8, color: "#64748b", fontWeight: 800, fontSize: 12 }}>
                      By accepting, you agree you’ve read the Rules &amp; Process. <Link to="/legal" style={{ fontWeight: 950 }}>View →</Link>
                    </div>
                  </div>

                  <div style={{ display: "flex", gap: 10, alignItems: "center" }}>
                    <button
                      onClick={() => acceptBooking(b)}
                      disabled={disabled}
                      style={{
                        padding: "10px 14px",
                        borderRadius: 14,
                        border: "1px solid #0f172a",
                        background: "#0f172a",
                        color: "white",
                        fontWeight: 950,
                        cursor: "pointer",
                        opacity: disabled ? 0.7 : 1,
                      }}
                    >
                      {isBusy ? "…" : "Accept"}
                    </button>

                    <button
                      onClick={() => cancelBookingAsOwner(b)}
                      disabled={disabled}
                      title={cancelTitleFor(b)}
                      style={{
                        padding: "10px 14px",
                        borderRadius: 14,
                        border: "1px solid #cbd5e1",
                        background: "white",
                        fontWeight: 950,
                        cursor: "pointer",
                        opacity: disabled ? 0.7 : 1,
                      }}
                    >
                      {isBusy ? "…" : cancelButtonLabelFor(b)}
                    </button>
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </div>

      {/* Upcoming / Confirmed */}
      <div
        style={{
          marginTop: 16,
          border: "1px solid #e2e8f0",
          borderRadius: 18,
          padding: 16,
          background: "white",
        }}
      >
        <div style={{ fontWeight: 1000, fontSize: 18 }}>Upcoming / Confirmed</div>
        <div style={{ marginTop: 6, color: "#475569", fontWeight: 700 }}>
          These are accepted bookings (owner deposit paid).
          <div style={{ marginTop: 6, color: "#64748b", fontWeight: 800 }}>
            You receive $100 once the test is completed and you confirm <b>YOUR</b> bike is returned.
          </div>
        </div>

        {upcoming.length === 0 ? (
          <div style={{ marginTop: 12, color: "#64748b", fontWeight: 800 }}>No upcoming bookings yet.</div>
        ) : (
          <div style={{ marginTop: 12, display: "grid", gap: 10 }}>
            {upcoming.map((b) => {
              const whenIso = scheduledIsoFor(b);
              const when = (whenIso || "") as string;

              const isBusy = busyId === b.id;
              const disabled = isBusy || loading;

              const w = checkInWindowFor(b);
              const now = Date.now();
              const checkinOpen = w ? isWithin(now, w.openMs, w.closeMs) : false;

              const ownerChecked = !!b.owner_checked_in;
              const borrowerChecked = !!b.borrower_checked_in;

              const comp = completionAllowedAtFor(b);
              const canConfirmTime = comp ? now >= comp.allowedAtMs : false;

              const ownerConfirmed = !!b.owner_confirmed_complete;
              const borrowerConfirmed = !!b.borrower_confirmed_complete;

              const canConfirm =
                !disabled &&
                canConfirmTime &&
                ownerChecked &&
                borrowerChecked &&
                !ownerConfirmed &&
                !b.cancelled &&
                !b.completed;

              const checkinHelp = (() => {
                if (!w) return "Missing scheduled time.";
                if (ownerChecked) return "You are checked in ✅";
                if (checkinOpen) return "Check-in is open now.";
                if (now < w.openMs) return `Check-in opens at ${fmtDateTime(new Date(w.openMs).toISOString())}.`;
                return `Check-in closed at ${fmtDateTime(new Date(w.closeMs).toISOString())}.`;
              })();

              const confirmHelp = (() => {
                if (ownerConfirmed) return "You already confirmed possession ✅";
                if (!ownerChecked || !borrowerChecked) return "Both parties must check in first.";
                if (!comp) return "Missing scheduled time.";
                if (now < comp.allowedAtMs) return `Available at ${fmtDateTime(new Date(comp.allowedAtMs).toISOString())} (20 min after start).`;
                return "Ready.";
              })();

              return (
                <div
                  key={b.id}
                  style={{
                    border: "1px solid #e2e8f0",
                    borderRadius: 14,
                    padding: 12,
                    display: "flex",
                    justifyContent: "space-between",
                    gap: 12,
                    flexWrap: "wrap",
                    alignItems: "center",
                  }}
                >
                  <div style={{ minWidth: 280 }}>
                    <div style={{ fontWeight: 1000 }}>Booking {shortId(b.id)}</div>
                    <div style={{ marginTop: 4, color: "#64748b", fontWeight: 800 }}>
                      scheduled: {fmtDateTime(when)} • bike: {b.bike_id ? shortId(String(b.bike_id)) : "—"}
                    </div>

                    <div style={{ marginTop: 8, display: "flex", gap: 10, flexWrap: "wrap" }}>
                      <div style={{ fontWeight: 900, color: ownerChecked ? "#166534" : "#475569" }}>
                        Owner check-in: {ownerChecked ? "✅" : "—"}
                      </div>
                      <div style={{ fontWeight: 900, color: borrowerChecked ? "#166534" : "#475569" }}>
                        Test-taker check-in: {borrowerChecked ? "✅" : "—"}
                      </div>
                      <div style={{ fontWeight: 900, color: ownerConfirmed ? "#166534" : "#475569" }}>
                        Owner possession: {ownerConfirmed ? "✅" : "—"}
                      </div>
                      <div style={{ fontWeight: 900, color: borrowerConfirmed ? "#166534" : "#475569" }}>
                        Test-taker complete: {borrowerConfirmed ? "✅" : "—"}
                      </div>
                    </div>

                    {rowErr[b.id] ? <div style={{ marginTop: 8, color: "#991b1b", fontWeight: 900 }}>{rowErr[b.id]}</div> : null}
                    {rowOk[b.id] ? <div style={{ marginTop: 8, color: "#166534", fontWeight: 900 }}>{rowOk[b.id]}</div> : null}

                    <div style={{ marginTop: 8, color: "#64748b", fontWeight: 800, fontSize: 12 }}>
                      {ownerConfirmed && !borrowerConfirmed
                        ? "Waiting for test-taker to confirm completion in the app."
                        : b.completed
                        ? "Booking completed."
                        : "Tip: both parties must check in before you can confirm possession."}
                      {" "}
                      <Link to="/legal" style={{ fontWeight: 950 }}>Rules →</Link>
                    </div>
                  </div>

                  <div style={{ display: "flex", gap: 10, alignItems: "center", flexWrap: "wrap", justifyContent: "flex-end" }}>
                    <button
                      onClick={() => checkInAsOwner(b)}
                      disabled={disabled || ownerChecked || !checkinOpen}
                      title={checkinHelp}
                      style={{
                        padding: "10px 14px",
                        borderRadius: 14,
                        border: "1px solid #0f172a",
                        background: "white",
                        fontWeight: 950,
                        cursor: "pointer",
                        opacity: disabled || ownerChecked || !checkinOpen ? 0.6 : 1,
                      }}
                    >
                      {isBusy ? "…" : ownerChecked ? "Checked in" : "Check in"}
                    </button>

                    <button
                      onClick={() => confirmBikeReturnedAsOwner(b)}
                      disabled={!canConfirm}
                      title={confirmHelp}
                      style={{
                        padding: "10px 14px",
                        borderRadius: 14,
                        border: "1px solid #0f172a",
                        background: "#0f172a",
                        color: "white",
                        fontWeight: 950,
                        cursor: "pointer",
                        opacity: canConfirm ? 1 : 0.6,
                      }}
                    >
                      {isBusy ? "…" : ownerConfirmed ? "Possession confirmed" : "Confirm YOUR bike is returned"}
                    </button>

                    <button
                      onClick={() => cancelBookingAsOwner(b)}
                      disabled={disabled}
                      title={cancelTitleFor(b)}
                      style={{
                        padding: "10px 14px",
                        borderRadius: 14,
                        border: "1px solid #cbd5e1",
                        background: "white",
                        fontWeight: 950,
                        cursor: "pointer",
                        opacity: disabled ? 0.7 : 1,
                      }}
                    >
                      {isBusy ? "…" : cancelButtonLabelFor(b)}
                    </button>
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </div>

      {/* History */}
      <div
        style={{
          marginTop: 16,
          border: "1px solid #e2e8f0",
          borderRadius: 18,
          padding: 16,
          background: "white",
        }}
      >
        <div style={{ fontWeight: 1000, fontSize: 18 }}>History</div>
        <div style={{ marginTop: 6, color: "#475569", fontWeight: 700 }}>
          Past/expired/cancelled bookings live here so “Requests” stays clean.
        </div>

        {history.length === 0 ? (
          <div style={{ marginTop: 12, color: "#64748b", fontWeight: 800 }}>No history yet.</div>
        ) : (
          <div style={{ marginTop: 12, overflowX: "auto" }}>
            <table style={{ width: "100%", borderCollapse: "collapse", minWidth: 760 }}>
              <thead>
                <tr style={{ textAlign: "left", color: "#0f172a" }}>
                  <th style={{ paddingBottom: 10 }}>Booking</th>
                  <th style={{ paddingBottom: 10 }}>When</th>
                  <th style={{ paddingBottom: 10 }}>State</th>
                </tr>
              </thead>
              <tbody>
                {history.slice(0, 25).map((b) => {
                  const whenIso = scheduledIsoFor(b);
                  const when = (whenIso || "") as string;

                  const state = (() => {
                    if (b.cancelled) return `Cancelled (${b.cancelled_by || "—"})`;
                    if (b.settled) return "Settled";
                    if (b.completed && !b.settled) return "Completed (await settle)";
                    if (isPastScheduled(b) && b.borrower_paid && !b.owner_deposit_paid) return "Expired request";
                    if (isPastScheduled(b)) return "Past";
                    return b.status || "—";
                  })();

                  return (
                    <tr key={b.id} style={{ borderTop: "1px solid #e2e8f0" }}>
                      <td style={{ padding: "10px 0", fontWeight: 900 }}>{shortId(b.id)}</td>
                      <td style={{ padding: "10px 0", fontWeight: 800, color: "#334155" }}>{fmtDateTime(when)}</td>
                      <td style={{ padding: "10px 0", fontWeight: 900 }}>{state}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>

            {history.length > 25 ? (
              <div style={{ marginTop: 10, color: "#64748b", fontWeight: 800, fontSize: 12 }}>
                Showing latest 25. (We can add pagination later.)
              </div>
            ) : null}
          </div>
        )}
      </div>

      <BoostModal open={boostOpen} onClose={() => setBoostOpen(false)} />
    </div>
  );
}

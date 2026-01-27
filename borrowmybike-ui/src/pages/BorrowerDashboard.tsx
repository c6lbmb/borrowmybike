// src/pages/BorrowerDashboard.tsx
import { useEffect, useMemo, useState } from "react";
import { Link } from "react-router-dom";
import { useAuth } from "../auth/useAuth";
import { sb } from "../lib/supabase";
import { callFn } from "../lib/fn";
import ReviewModal from "../components/ReviewModal";
import { acceptanceDeadlineMs, msLeft, acceptanceHoursFor } from "../lib/acceptance";
import Countdown from "../components/Countdown";

type BookingRow = {
  id: string;
  bike_id: string;
  borrower_id: string;
  owner_id: string;

  booking_date: string | null;
  scheduled_start_at: string | null;

  cancelled: boolean;
  settled: boolean;
  completed: boolean;

  borrower_paid: boolean;
  owner_deposit_paid: boolean;

  needs_review: boolean;
  review_reason: string | null;

  created_at: string | null;

  // These are present in backend; read safely.
  borrower_checked_in?: boolean | null;
  owner_checked_in?: boolean | null;
  borrower_confirmed_complete?: boolean | null;
  owner_confirmed_complete?: boolean | null;

  cancelled_by?: string | null;
};

function fmtLocal(iso?: string | null) {
  if (!iso) return "-";
  const d = new Date(iso);
  if (isNaN(d.getTime())) return "-";
  return d.toLocaleString([], { year: "numeric", month: "short", day: "2-digit", hour: "2-digit", minute: "2-digit" });
}

function shortId(id?: string | null) {
  return id ? id.slice(0, 8) + "…" : "-";
}

function isPendingAcceptance(b: BookingRow) {
  return !!b.borrower_paid && !b.owner_deposit_paid && !b.cancelled && !b.settled;
}

const MS_DAY = 24 * 60 * 60 * 1000;

function scheduledIsoFor(b: BookingRow) {
  return b.scheduled_start_at ?? b.booking_date ?? null;
}

function isConfirmedPaid(b: BookingRow) {
  return !!b.borrower_paid && !!b.owner_deposit_paid && !b.cancelled && !b.settled && !b.completed;
}

// Only applies when BOTH parties have paid (accepted/confirmed booking).
function isLateCancelForfeit(b: BookingRow) {
  if (!b.borrower_paid || !b.owner_deposit_paid) return false;

  const iso = scheduledIsoFor(b);
  if (!iso) return false;

  const t = new Date(iso).getTime();
  if (Number.isNaN(t)) return false;

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
    ? 'Last-minute cancellation (≤ 5 days). You will forfeit your booking fee. Type "FORFEIT" to proceed.'
    : 'Deliberate action: type "CANCEL" to cancel this booking.';
}

/**
 * Check-in window:
 * - Opens 2 hours before scheduled time
 * - Closes 2 hours after scheduled time
 */
function checkInWindowFor(b: BookingRow) {
  const iso = scheduledIsoFor(b);
  if (!iso) return null;

  const t = new Date(iso).getTime();
  if (Number.isNaN(t)) return null;

  const openMs = t - 2 * 60 * 60 * 1000;
  const closeMs = t + 2 * 60 * 60 * 1000;
  return { openMs, closeMs };
}

function isWithin(now: number, openMs: number, closeMs: number) {
  return now >= openMs && now <= closeMs;
}

/**
 * Completion confirmation allowed:
 * - After scheduled time + 30 minutes (buffer)
 */
function completionAllowedAtFor(b: BookingRow) {
  const iso = scheduledIsoFor(b);
  if (!iso) return null;

  const t = new Date(iso).getTime();
  if (Number.isNaN(t)) return null;

  const allowedAtMs = t + 30 * 60 * 1000;
  return { allowedAtMs };
}

function money(n: number) {
  // n is dollars
  return n.toLocaleString(undefined, { style: "currency", currency: "CAD" });
}

export default function BorrowerDashboard() {
  const { user } = useAuth();
  const me = user?.id;

  const [rows, setRows] = useState<BookingRow[]>([]);
  const [loading, setLoading] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [busyId, setBusyId] = useState<string | null>(null);

  const [reviewOpen, setReviewOpen] = useState(false);
  const [reviewCtx, setReviewCtx] = useState<{ bookingId: string; bikeId: string; ownerId: string } | null>(null);

  // Credits pill (subtle UI cue)
  const [creditsDollars, setCreditsDollars] = useState<number | null>(null);
  const [creditsErr, setCreditsErr] = useState<string | null>(null);

  async function loadCredits() {
    if (!me) return;
    setCreditsErr(null);

    // We keep this defensive because schemas vary across builds:
    // - Some installs store "amount_cents"
    // - Others store "amount" (dollars)
    // - Some may use RLS that blocks this read (in which case we just show "—")
    try {
      // Try amount_cents first
      const r1 = await sb
        .from("credits")
        .select("amount_cents,status,user_id")
        .eq("user_id", me);

      if (!r1.error) {
        const rowsAny = (r1.data as any[]) || [];
        const available = rowsAny.filter((x) => (x?.status ?? "available") === "available");
        const cents = available.reduce((sum, x) => sum + (Number(x?.amount_cents) || 0), 0);
        setCreditsDollars(cents / 100);
        return;
      }

      // If that failed (missing column, etc.), try amount (dollars)
      const r2 = await sb
        .from("credits")
        .select("amount,status,user_id")
        .eq("user_id", me);

      if (r2.error) throw r2.error;

      const rowsAny = (r2.data as any[]) || [];
      const available = rowsAny.filter((x) => (x?.status ?? "available") === "available");
      const dollars = available.reduce((sum, x) => sum + (Number(x?.amount) || 0), 0);
      setCreditsDollars(dollars);
    } catch (e: any) {
      // Don’t break the dashboard for a non-critical badge.
      setCreditsDollars(null);
      setCreditsErr(e?.message || "Unable to load credits");
    }
  }

  async function load() {
    if (!me) return;
    setLoading(true);
    setErr(null);

    try {
      const res = await sb
        .from("bookings")
        .select(
          "id,bike_id,borrower_id,owner_id,booking_date,scheduled_start_at,cancelled,settled,completed,borrower_paid,owner_deposit_paid,needs_review,review_reason,created_at,borrower_checked_in,owner_checked_in,borrower_confirmed_complete,owner_confirmed_complete,cancelled_by"
        )
        .eq("borrower_id", me)
        .order("created_at", { ascending: false });

      if (res.error) throw res.error;
      setRows(((res.data as any) || []) as BookingRow[]);
    } catch (e: any) {
      setErr(e?.message || "Failed to load bookings");
      setRows([]);
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    load();
    loadCredits();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [me]);

  function openReview(b: BookingRow) {
    setReviewCtx({ bookingId: b.id, bikeId: b.bike_id, ownerId: b.owner_id });
    setReviewOpen(true);
  }

  async function cancelBookingAsBorrower(b: BookingRow) {
    const keyword = cancelKeywordFor(b);
    const typed = prompt(`Type "${keyword}" to cancel this booking:`);
    if ((typed || "").trim().toUpperCase() !== keyword) return;

    setBusyId(b.id);
    setErr(null);
    try {
      await callFn("cancel-booking", { booking_id: b.id, cancelled_by: "borrower" });
      alert("Cancelled.");
      await load();
      await loadCredits();
    } catch (e: any) {
      setErr(e?.message || "Cancel failed");
    } finally {
      setBusyId(null);
    }
  }

  async function checkInAsTestTaker(b: BookingRow) {
    setBusyId(b.id);
    setErr(null);
    try {
      await callFn("check-in", { booking_id: b.id, role: "borrower" });
      await load();
    } catch (e: any) {
      setErr(e?.message || "Check-in failed");
    } finally {
      setBusyId(null);
    }
  }

  async function confirmTestCompleted(b: BookingRow) {
    setBusyId(b.id);
    setErr(null);
    try {
      await callFn("confirm-completion", { booking_id: b.id, role: "borrower" });
      await load();
      await loadCredits();
    } catch (e: any) {
      setErr(e?.message || "Confirm completion failed");
    } finally {
      setBusyId(null);
    }
  }

  const page: React.CSSProperties = { padding: "2rem" };

  const card: React.CSSProperties = {
    marginTop: 14,
    padding: 14,
    border: "1px solid #e2e8f0",
    borderRadius: 14,
    background: "white",
  };

  const btn: React.CSSProperties = {
    padding: "10px 12px",
    borderRadius: 14,
    border: "1px solid #cbd5e1",
    fontWeight: 900,
    cursor: "pointer",
    background: "white",
  };

  const btnPrimary: React.CSSProperties = {
    padding: "10px 12px",
    borderRadius: 14,
    border: "1px solid #0f172a",
    fontWeight: 900,
    cursor: "pointer",
    background: "#0f172a",
    color: "white",
  };

  const tiny: React.CSSProperties = {
    padding: "8px 10px",
    borderRadius: 12,
    border: "1px solid #cbd5e1",
    fontWeight: 900,
    cursor: "pointer",
    background: "white",
    color: "#0f172a",
  };

  const tinyDanger: React.CSSProperties = {
    padding: "8px 10px",
    borderRadius: 12,
    border: "1px solid #b00020",
    fontWeight: 900,
    cursor: "pointer",
    background: "white",
    color: "#b00020",
  };

  // Credits pill styles (subtle)
  const creditsPill: React.CSSProperties = {
    display: "inline-flex",
    alignItems: "center",
    gap: 8,
    padding: "10px 12px",
    borderRadius: 14,
    border: "1px solid #e2e8f0",
    background: "white",
    fontWeight: 900,
    color: "#0f172a",
    whiteSpace: "nowrap",
  };

  const creditsSub: React.CSSProperties = {
    fontWeight: 800,
    color: "#64748b",
    fontSize: 12,
    marginTop: 4,
    textAlign: "right",
  };

  const sorted = useMemo(() => rows, [rows]);

  // Always visible “How it works” card (Option B-lite)
  const howItWorks = (
    <div style={card}>
      <div style={{ fontWeight: 1000, fontSize: 18 }}>How it works (for Test-Takers)</div>
      <div style={{ marginTop: 8, color: "#475569", fontWeight: 800, lineHeight: 1.55 }}>
        This platform is built for <b>registry road tests</b> — not recreational rentals. Deposits + rules reduce no-shows
        and last-minute surprises.
      </div>

      <div style={{ marginTop: 10, display: "grid", gap: 8 }}>
        <div style={{ color: "#0f172a", fontWeight: 900 }}>1) Browse and choose a bike</div>
        <div style={{ color: "#475569", fontWeight: 800, lineHeight: 1.55 }}>
          Pick a bike near your registry appointment. Owners can accept or decline requests.
        </div>

        <div style={{ color: "#0f172a", fontWeight: 900 }}>2) Confirm and prepare</div>
        <div style={{ color: "#475569", fontWeight: 800, lineHeight: 1.55 }}>
          Arrive ready: at minimum a <b>helmet,jacket</b> and a <b>hands-free device</b> for directions (AB for now, other
          provinces require a radio - provided by administrator).
        </div>

        <div style={{ color: "#0f172a", fontWeight: 900 }}>3) Meet at the registry</div>
        <div style={{ color: "#475569", fontWeight: 800, lineHeight: 1.55 }}>
          The owner meets you at the pre-arranged registry. We recommend the owner checks ID before the ride begins.
        </div>

        <div style={{ color: "#0f172a", fontWeight: 900 }}>4) After the test</div>
        <div style={{ color: "#475569", fontWeight: 800, lineHeight: 1.55 }}>
          You’ll confirm the test is completed. The owner confirms they have their bike back (possession), and you're free
          to go celebrate you passing... or plan another road test
        </div>
      </div>

      <div style={{ marginTop: 12, display: "flex", gap: 10, flexWrap: "wrap" }}>
        <Link to="/browse" style={btnPrimary as any}>
          Browse bikes →
        </Link>
        <Link to="/test-takers" style={btn as any}>
          Test-Taker info →
        </Link>
        <Link to="/legal" style={btn as any}>
          Rules &amp; policies →
        </Link>
      </div>

      <div style={{ marginTop: 12, color: "#64748b", fontWeight: 800, fontSize: 13 }}>
        Credits (if any) automatically apply at checkout before Stripe.
      </div>
    </div>
  );

  return (
    <div style={page}>
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 12, flexWrap: "wrap" }}>
        <div>
          <div style={{ fontSize: 22, fontWeight: 1000 }}>Test-Taker Dashboard</div>
          <div style={{ marginTop: 4, color: "#64748b", fontWeight: 800 }}>Your bookings + acceptance countdown.</div>
        </div>

        <div style={{ display: "flex", gap: 10, flexWrap: "wrap", alignItems: "center" }}>
          <Link to="/browse" style={{ fontWeight: 900 }}>
            Browse →
          </Link>

          {/* Credits indicator (subtle) */}
          <div>
            <div style={creditsPill} title={creditsErr ? `Credits: unavailable (${creditsErr})` : "Credits apply at checkout before Stripe."}>
              <span aria-hidden>🪙</span>
              <span>
                Credits:{" "}
                {typeof creditsDollars === "number" ? money(Math.max(0, creditsDollars)) : "—"}
              </span>
            </div>
            <div style={creditsSub}>applies before Stripe</div>
          </div>

          <button
            style={btn}
            onClick={async () => {
              await load();
              await loadCredits();
            }}
            disabled={loading}
          >
            {loading ? "Loading…" : "Refresh"}
          </button>
        </div>
      </div>

      {err && (
        <div style={{ marginTop: 12, padding: 12, borderRadius: 12, border: "1px solid #fecaca", background: "#fff1f2" }}>
          <div style={{ fontWeight: 900, color: "#b00020" }}>Error</div>
          <div style={{ marginTop: 6, color: "#7f1d1d", fontWeight: 800 }}>{err}</div>
        </div>
      )}

      {/* Always visible onboarding card */}
      {howItWorks}

      <div style={card}>
        <div style={{ fontWeight: 1000 }}>My Bookings</div>

        {loading ? (
          <div style={{ marginTop: 10, color: "#64748b", fontWeight: 800 }}>Loading…</div>
        ) : !sorted.length ? (
          <div style={{ marginTop: 12 }}>
            <div style={{ color: "#0f172a", fontWeight: 1000, fontSize: 16 }}>No bookings yet.</div>
            <div style={{ marginTop: 6, color: "#475569", fontWeight: 800, lineHeight: 1.55, maxWidth: 820 }}>
              That’s normal — many riders book registry tests weeks out. You can browse bikes now, and when you’re ready,
              request a booking for your appointment time.
            </div>

            <div style={{ marginTop: 12, display: "flex", gap: 10, flexWrap: "wrap" }}>
              <Link to="/browse" style={btnPrimary as any}>
                Browse bikes →
              </Link>
              <Link to="/test-takers" style={btn as any}>
                Learn how it works →
              </Link>
              <Link to="/legal" style={btn as any}>
                Policies →
              </Link>
            </div>

            <div style={{ marginTop: 12, color: "#64748b", fontWeight: 800, fontSize: 13 }}>
              Tip: When a booking is requested, the owner has a limited acceptance window. If they don’t accept in time,
              you can quickly choose another bike.
            </div>
          </div>
        ) : (
          <div style={{ marginTop: 12, overflowX: "auto" }}>
            <table style={{ width: "100%", borderCollapse: "collapse", minWidth: 860 }}>
              <thead>
                <tr style={{ textAlign: "left", color: "#0f172a" }}>
                  <th style={{ paddingBottom: 10 }}>Booking</th>
                  <th style={{ paddingBottom: 10 }}>When</th>
                  <th style={{ paddingBottom: 10 }}>Status</th>
                  <th style={{ paddingBottom: 10 }}>Actions</th>
                </tr>
              </thead>

              <tbody>
                {sorted.map((b) => {
                  const scheduledIso = scheduledIsoFor(b);
                  const pending = isPendingAcceptance(b);

                  const hours = acceptanceHoursFor(scheduledIso || undefined);
                  const deadline = acceptanceDeadlineMs(b.created_at || null, scheduledIso || null);
                  const left = msLeft(deadline);
                  const expired = typeof left === "number" && left <= 0;

                  const ownerChecked = !!b.owner_checked_in;
                  const borrowerChecked = !!b.borrower_checked_in;
                  const borrowerConfirmed = !!b.borrower_confirmed_complete;
                  const ownerPossession = !!b.owner_confirmed_complete;

                  const w = checkInWindowFor(b);
                  const now = Date.now();
                  const checkInOpen = w ? isWithin(now, w.openMs, w.closeMs) : false;

                  const comp = completionAllowedAtFor(b);
                  const canConfirmTime = comp ? now >= comp.allowedAtMs : false;

                  const canReview = b.completed && b.settled && !b.cancelled && !b.needs_review;

                  const status = (() => {
                    if (b.needs_review) return "⚠ Needs review";
                    if (b.cancelled) return `❌ Cancelled${b.cancelled_by ? ` (${b.cancelled_by})` : ""}`;
                    if (b.settled) return "💸 Settled";
                    if (b.completed && !b.settled) return "✅ Completed (await settle)";
                    if (borrowerConfirmed && !ownerPossession) return "✅ You confirmed completion — waiting on owner possession";
                    if (pending) return expired ? "⌛ Expired — choose another bike" : "⏳ Pending owner acceptance";
                    if (isConfirmedPaid(b)) return "📅 Confirmed — prepare for test day";
                    return "-";
                  })();

                  const actions = (() => {
                    if (canReview) {
                      return (
                        <button style={btnPrimary} onClick={() => openReview(b)}>
                          Rate owner/bike
                        </button>
                      );
                    }

                    // Confirmed booking (both paid)
                    if (isConfirmedPaid(b)) {
                      const isBusy = busyId === b.id;

                      const canComplete =
                        !borrowerConfirmed &&
                        canConfirmTime &&
                        borrowerChecked &&
                        ownerChecked &&
                        !b.cancelled &&
                        !b.completed;

                      return (
                        <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
                          <button
                            style={tiny}
                            onClick={() => checkInAsTestTaker(b)}
                            disabled={isBusy || borrowerChecked || !checkInOpen}
                            title={
                              borrowerChecked
                                ? "You are checked in ✅"
                                : checkInOpen
                                ? "Check-in is open now."
                                : w
                                ? now < w.openMs
                                  ? `Check-in opens at ${fmtLocal(new Date(w.openMs).toISOString())}`
                                  : `Check-in closed at ${fmtLocal(new Date(w.closeMs).toISOString())}`
                                : "Missing scheduled time"
                            }
                          >
                            {isBusy ? "…" : borrowerChecked ? "Checked in" : "Check in"}
                          </button>

                          <button
                            style={btnPrimary}
                            onClick={() => confirmTestCompleted(b)}
                            disabled={isBusy || !canComplete}
                            title={
                              borrowerConfirmed
                                ? "Already confirmed ✅"
                                : !borrowerChecked || !ownerChecked
                                ? "Both parties must check in first."
                                : !canConfirmTime && comp
                                ? `Available at ${fmtLocal(new Date(comp.allowedAtMs).toISOString())}`
                                : "Confirm your road test is completed."
                            }
                          >
                            {isBusy ? "…" : borrowerConfirmed ? "Completion confirmed" : "Confirm test completed"}
                          </button>

                          <button
                            style={tinyDanger}
                            onClick={() => cancelBookingAsBorrower(b)}
                            disabled={isBusy}
                            title={cancelTitleFor(b)}
                          >
                            {isBusy ? "…" : cancelButtonLabelFor(b)}
                          </button>
                        </div>
                      );
                    }

                    if (expired) {
                      return (
                        <Link to="/browse" style={{ fontWeight: 900 }}>
                          Find another bike →
                        </Link>
                      );
                    }

                    return <span style={{ color: "#64748b", fontWeight: 800 }}>—</span>;
                  })();

                  return (
                    <tr key={b.id} style={{ borderTop: "1px solid #e2e8f0" }}>
                      <td style={{ padding: "10px 0", fontWeight: 900 }}>
                        {shortId(b.id)}
                        <div style={{ color: "#64748b", fontWeight: 800, fontSize: 12 }}>
                          bike: {shortId(b.bike_id)} • owner: {shortId(b.owner_id)}
                        </div>
                      </td>

                      <td style={{ padding: "10px 0", fontWeight: 800 }}>{fmtLocal(scheduledIso)}</td>

                      <td style={{ padding: "10px 0", fontWeight: 900 }}>
                        {status}

                        {pending && deadline && !expired && (
                          <div style={{ marginTop: 6, color: "#64748b", fontWeight: 800, fontSize: 12 }}>
                            Accept window ({hours}h): <Countdown deadlineMs={deadline} />
                          </div>
                        )}

                        {isConfirmedPaid(b) && (
                          <div style={{ marginTop: 6, display: "flex", gap: 10, flexWrap: "wrap", fontSize: 12 }}>
                            <span style={{ fontWeight: 900, color: borrowerChecked ? "#166534" : "#475569" }}>
                              You: {borrowerChecked ? "Checked in" : "Not checked in"}
                            </span>
                            <span style={{ fontWeight: 900, color: ownerChecked ? "#166534" : "#475569" }}>
                              Owner: {ownerChecked ? "Checked in" : "Not checked in"}
                            </span>
                            <span style={{ fontWeight: 900, color: borrowerConfirmed ? "#166534" : "#475569" }}>
                              Completion: {borrowerConfirmed ? "Confirmed" : "Not confirmed"}
                            </span>
                          </div>
                        )}
                      </td>

                      <td style={{ padding: "10px 0", fontWeight: 900 }}>{actions}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {reviewCtx && (
        <ReviewModal
          open={reviewOpen}
          onClose={() => setReviewOpen(false)}
          bookingId={reviewCtx.bookingId}
          bikeId={reviewCtx.bikeId}
          ownerId={reviewCtx.ownerId}
          onSaved={() => load()}
        />
      )}
    </div>
  );
}

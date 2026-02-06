import { useEffect, useMemo, useState } from "react";
import { Link } from "react-router-dom";
import { useAuth } from "../auth/useAuth";
import { sb } from "../lib/supabase";
import ChecklistGateModal, { type ChecklistItem } from "../components/ChecklistGateModal";
import { acceptanceDeadlineMs, acceptanceHoursFor } from "../lib/acceptance";
import Countdown from "../components/Countdown";
import BookingMessages from "../components/BookingMessages";

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
  owner_deposit_choice?: "keep" | "refund" | null;

  needs_review: boolean;
  review_reason: string | null;

  created_at: string | null;

  borrower_checked_in?: boolean | null;
  owner_checked_in?: boolean | null;
  borrower_confirmed_complete?: boolean | null;
  owner_confirmed_complete?: boolean | null;

  cancelled_by?: string | null;
  status?: string | null;
};

type BikeRow = {
  id: string;
  owner_id: string;
  make: string | null;
  model: string | null;
  year: number | null;
  city: string | null;
  province: string | null;
  is_active: boolean;
};

const MS_DAY = 24 * 60 * 60 * 1000;

// check-in window: 15 min before → 60 min after (must match edge fn)
const CHECKIN_OPEN_MIN = 15;
const CHECKIN_CLOSE_MIN = 60;

// Supabase Storage (matches OwnerNew.tsx)
const BUCKET = "bike-photos";

function fmtDateTime(iso?: string | null) {
  if (!iso) return "—";
  const d = new Date(iso);
  if (isNaN(d.getTime())) return "—";
  return d.toLocaleString([], {
    year: "numeric",
    month: "short",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
  });
}

function shortId(id?: string | null) {
  return id ? id.slice(0, 8) + "…" : "—";
}

function scheduledIsoFor(b: BookingRow) {
  return b.scheduled_start_at ?? b.booking_date ?? null;
}

function checkInWindowFor(b: BookingRow) {
  const iso = scheduledIsoFor(b);
  if (!iso) return null;

  const t = new Date(iso).getTime();
  if (Number.isNaN(t)) return null;

  const openMs = t - CHECKIN_OPEN_MIN * 60 * 1000;
  const closeMs = t + CHECKIN_CLOSE_MIN * 60 * 1000;
  return { openMs, closeMs };
}

function isWithin(now: number, openMs: number, closeMs: number) {
  return now >= openMs && now <= closeMs;
}

// completion allowed: >= scheduled + 20 min (minimum only)
function completionAllowedAtFor(b: BookingRow) {
  const iso = scheduledIsoFor(b);
  if (!iso) return null;

  const t = new Date(iso).getTime();
  if (Number.isNaN(t)) return null;

  const allowedAtMs = t + 20 * 60 * 1000;
  return { allowedAtMs };
}

function isPendingAcceptance(b: BookingRow) {
  return !!b.borrower_paid && !b.owner_deposit_paid && !b.cancelled && !b.settled;
}

function isConfirmedPaid(b: BookingRow) {
  return !!b.borrower_paid && !!b.owner_deposit_paid && !b.cancelled && !b.settled && !b.completed;
}

// late cancel rule stays as-is (≤ 5 days -> FORFEIT)
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
    ? 'Last-minute cancellation (≤ 5 days). You will forfeit your deposit. Type "FORFEIT" to proceed.'
    : 'Deliberate action: type "CANCEL" to cancel this booking.';
}

function isPastScheduled(b: BookingRow) {
  const iso = scheduledIsoFor(b);
  if (!iso) return false;
  const t = new Date(iso).getTime();
  if (Number.isNaN(t)) return false;
  return t < Date.now() - 2 * 60 * 60 * 1000;
}

// Thumbnail url for owner’s bike cover (matches OwnerNew.tsx path)
function coverUrl(ownerId: string, bikeId: string) {
  const path = `${ownerId}/${bikeId}/cover.webp`;
  const { data } = sb.storage.from(BUCKET).getPublicUrl(path);
  return data.publicUrl;
}

export default function OwnerDashboard() {
  const { user } = useAuth();
  const me = user?.id;

  const [rows, setRows] = useState<BookingRow[]>([]);
  const [bike, setBike] = useState<BikeRow | null>(null);

  const [loading, setLoading] = useState(false);
  const [loadingBike, setLoadingBike] = useState(false);

  const [err, setErr] = useState<string | null>(null);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [openMsgId, setOpenMsgId] = useState<string | null>(null);

  // Mentor accept checklist gate
  const [gateOpen, setGateOpen] = useState(false);
  const [gateDepositChoice, setGateDepositChoice] = useState<"keep" | "refund" | null>(null);
  const [gateBooking, setGateBooking] = useState<BookingRow | null>(null);

  const ownerAcceptChecklist: ChecklistItem[] = useMemo(
    () => [
      { id: "ready", label: <>My bike is <b>road-test ready</b> (lights, signals, brakes, tires).</> },
      { id: "docs", label: <>I have <b>valid registration + insurance</b> available at the registry.</> },
      { id: "timing", label: <>I understand I must be on time and check-in is limited to the allowed window.</> },
      { id: "rules", label: <>I understand cancellation / fault consequences and that this is <b>road tests only</b> (not rentals).</> },
    ],
    [],
  );

  async function load() {
    if (!me) return;
    setLoading(true);
    setErr(null);

    try {
      const res = await sb
        .from("bookings")
        .select(
          "id,bike_id,borrower_id,owner_id,booking_date,scheduled_start_at,cancelled,settled,completed,borrower_paid,owner_deposit_paid,needs_review,review_reason,created_at,borrower_checked_in,owner_checked_in,borrower_confirmed_complete,owner_confirmed_complete,cancelled_by,status",
        )
        .eq("owner_id", me)
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

  async function loadMyBike() {
    if (!me) return;
    setLoadingBike(true);
    try {
      const res = await sb
        .from("bikes")
        .select("id, owner_id, make, model, year, city, province, is_active")
        .eq("owner_id", me)
        .limit(1)
        .maybeSingle();

      if (res.error) throw res.error;
      setBike((res.data as BikeRow | null) || null);
    } catch {
      setBike(null);
    } finally {
      setLoadingBike(false);
    }
  }

  useEffect(() => {
    load();
    loadMyBike();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [me]);

  async function checkInAsOwner(b: BookingRow) {
    const w = checkInWindowFor(b);
    const now = Date.now();
    const checkInOpen = w ? isWithin(now, w.openMs, w.closeMs) : false;

    if (!checkInOpen) {
      alert("Check-in is only available 15 minutes before until 60 minutes after the scheduled start time.");
      return;
    }

    setBusyId(b.id);
    setErr(null);
    try {
      const { error } = await sb.functions.invoke("check-in", {
        body: { booking_id: b.id, role: "owner" },
      });
      if (error) throw error;
      await load();
    } catch (e: any) {
      setErr(e?.message || "Check-in failed");
    } finally {
      setBusyId(null);
    }
  }

  async function confirmBikeReturnedAsOwner(b: BookingRow) {
    const borrowerChecked = !!b.borrower_checked_in;
    const ownerChecked = !!b.owner_checked_in;

    if (!borrowerChecked || !ownerChecked) {
      alert("Both parties must check in first.");
      return;
    }

    const comp = completionAllowedAtFor(b);
    const now = Date.now();
    if (comp && now < comp.allowedAtMs) {
      alert(`Too early. You can confirm possession after ${fmtDateTime(new Date(comp.allowedAtMs).toISOString())}.`);
      return;
    }

    setBusyId(b.id);
    setErr(null);
    try {
      const { error } = await sb.functions.invoke("complete-booking", {
        body: { booking_id: b.id, role: "owner" },
      });
      if (error) throw error;

      await load();
    } catch (e: any) {
      setErr(e?.message || "Confirm possession failed");
    } finally {
      setBusyId(null);
    }
  }

  async function cancelBookingAsOwner(b: BookingRow) {
    // Once both checked in, FORFEIT should be disabled (your rule)
    const borrowerChecked = !!b.borrower_checked_in;
    const ownerChecked = !!b.owner_checked_in;
    if (borrowerChecked && ownerChecked) {
      alert("FORFEIT is disabled once both parties have checked in.");
      return;
    }

    const keyword = cancelKeywordFor(b);
    const typed = prompt(`Type "${keyword}" to cancel this booking:`);
    if ((typed || "").trim().toUpperCase() !== keyword) return;

    setBusyId(b.id);
    setErr(null);
    try {
      const { error } = await sb.functions.invoke("cancel-booking", {
        body: { booking_id: b.id, cancelled_by: "owner" },
      });
      if (error) throw error;
      alert("Cancelled.");
      await load();
    } catch (e: any) {
      setErr(e?.message || "Cancel failed");
    } finally {
      setBusyId(null);
    }
  }

  async function persistOwnerDepositChoice(bookingId: string, choice: "keep" | "refund") {
    // Pre-step before deposit checkout so settle-booking can use the owner's preference.
    const { data, error } = await sb.functions.invoke("set-owner-deposit-choice", {
      body: { booking_id: bookingId, choice },
    });
    if (error) throw error;
    return data;
  }

  async function doAcceptWithDeposit(b: BookingRow) {
    setBusyId(b.id);
    setErr(null);
    try {
      const { data, error } = await sb.functions.invoke("create-owner-deposit-payment", {
        body: { booking_id: b.id },
      });
      if (error) throw error;

      const url = (data as any)?.checkout_url;
      if (url) window.location.href = url;

      await load();
    } catch (e: any) {
      setErr(e?.message || "Accept failed");
    } finally {
      setBusyId(null);
    }
  }

  const sorted = useMemo(() => rows, [rows]);

  const upcoming = sorted.filter((b) => isConfirmedPaid(b));
  const pending = sorted.filter((b) => isPendingAcceptance(b));
  const history = sorted.filter((b) => b.cancelled || b.settled || b.completed || isPastScheduled(b));

  const cardShell: React.CSSProperties = {
    border: "1px solid #e2e8f0",
    borderRadius: 18,
    padding: 16,
    background: "white",
  };

  const btnPrimary: React.CSSProperties = {
    padding: "10px 14px",
    borderRadius: 14,
    border: "1px solid #0f172a",
    background: "#0f172a",
    color: "white",
    fontWeight: 800,
    cursor: "pointer",
    textDecoration: "none",
    display: "inline-flex",
    alignItems: "center",
    gap: 8,
  };

  const btnSecondary: React.CSSProperties = {
    padding: "10px 14px",
    borderRadius: 14,
    border: "1px solid #cbd5e1",
    background: "white",
    fontWeight: 800,
    cursor: "pointer",
    textDecoration: "none",
    color: "#0f172a",
    display: "inline-flex",
    alignItems: "center",
    gap: 8,
  };

  const bikeTitle = bike ? `${bike.year || ""} ${bike.make || ""} ${bike.model || ""}`.trim() || "Your bike" : "My Bike";
  const bikeThumb = bike && me ? coverUrl(me, bike.id) : null;

  return (
    <div style={{ padding: "2rem" }}>
      <ChecklistGateModal
        open={gateOpen}
        title="Before you accept…"
        intro={
          <>
            You’re agreeing your bike is road-test ready and you understand the cancellation / fault rules.
            You’ll place the <b>$150 mentor deposit</b> next (credit may apply).

            <div style={{ marginTop: 14, padding: 12, border: "1px solid #e2e8f0", borderRadius: 14, background: "#f8fafc" }}>
              <div style={{ fontWeight: 800, marginBottom: 6 }}>Deposit preference</div>
              <div style={{ color: "#475569", fontWeight: 600, marginBottom: 10 }}>
                Default is <b>keep on platform</b>. You can change this later, but immediate Stripe refunds are only possible when the original payment is still recent.
              </div>

              <label style={{ display: "flex", gap: 10, alignItems: "flex-start", marginBottom: 10, cursor: "pointer" }}>
                <input
                  type="radio"
                  name="depositpref"
                  checked={gateDepositChoice === "keep"}
                  onChange={() => setGateDepositChoice("keep")}
                />
                <div>
                  <div style={{ fontWeight: 800 }}>Keep on platform</div>
                  <div style={{ color: "#475569", fontWeight: 600 }}>Becomes platform credit. You can request a withdrawal later.</div>
                </div>
              </label>

              <label style={{ display: "flex", gap: 10, alignItems: "flex-start", cursor: "pointer" }}>
                <input
                  type="radio"
                  name="depositpref"
                  checked={gateDepositChoice === "refund"}
                  onChange={() => setGateDepositChoice("refund")}
                />
                <div>
                  <div style={{ fontWeight: 800 }}>Refund to card</div>
                  <div style={{ color: "#475569", fontWeight: 600 }}>
                    We’ll attempt an automatic Stripe refund right after settlement when possible. If it’s requested much later, we’ll notify support for manual e‑transfer.
                  </div>
                </div>
              </label>
            </div>
          </>
        }
        requiredItems={ownerAcceptChecklist}
        footerNote={
          <>
            If you accept and don’t show up, or your bike isn’t road-worthy at the registry, your deposit may be used to compensate the test-taker.
          </>
        }
        confirmText="I agree — continue to deposit"
        cancelText="Not now"
        onCancel={() => {
          setGateOpen(false);
          setGateBooking(null);
        }}
        onConfirm={() => {
          const b = gateBooking;
          const choice = gateDepositChoice;
          setGateOpen(false);
          setGateBooking(null);
          if (!b) return;

          void (async () => {
            // Persist preference first (so settle-booking sees it), then proceed to deposit checkout.
            await persistOwnerDepositChoice(b.id, (choice ?? "keep"));
            await doAcceptWithDeposit(b);
          })();
        }}
      />

      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 12, flexWrap: "wrap" }}>
        <div>
          <div style={{ fontSize: 28, fontWeight: 800 }}>Mentor Dashboard</div>
          <div style={{ marginTop: 4, color: "#64748b", fontWeight: 600 }}>Your bookings + acceptance window.</div>
        </div>

        <div style={{ display: "flex", gap: 10, flexWrap: "wrap" }}>
          <Link to="/browse" style={{ fontWeight: 800 }}>
            Browse →
          </Link>
          <button
            style={{
              padding: "10px 12px",
              borderRadius: 14,
              border: "1px solid #cbd5e1",
              fontWeight: 800,
              cursor: "pointer",
              background: "white",
            }}
            onClick={() => {
              load();
              loadMyBike();
            }}
            disabled={loading}
          >
            {loading ? "Loading…" : "Refresh"}
          </button>
        </div>
      </div>

      {err && (
        <div style={{ marginTop: 12, padding: 12, borderRadius: 12, border: "1px solid #fecaca", background: "#fff1f2" }}>
          <div style={{ fontWeight: 800, color: "#b00020" }}>Error</div>
          <div style={{ marginTop: 6, color: "#7f1d1d", fontWeight: 600 }}>{err}</div>
        </div>
      )}

      {/* My Bike (fast access + thumbnail) */}
      <div style={{ marginTop: 16, ...cardShell }}>
        <div style={{ fontWeight: 800, fontSize: 18 }}>{bikeTitle}</div>
        <div style={{ marginTop: 6, color: "#475569", fontWeight: 600 }}>
          Quick access to your listing. Keep it up to date so test-takers can book confidently.
        </div>

        {loadingBike ? (
          <div style={{ marginTop: 12, color: "#64748b", fontWeight: 600 }}>Loading…</div>
        ) : bike ? (
          <div style={{ marginTop: 12, display: "grid", gridTemplateColumns: "120px 1fr", gap: 14, alignItems: "center" }}>
            <div
              style={{
                width: 120,
                height: 90,
                borderRadius: 14,
                overflow: "hidden",
                border: "1px solid #e2e8f0",
                background: "#f1f5f9",
              }}
            >
              {bikeThumb ? (
                <img
                  src={bikeThumb}
                  alt="Bike cover"
                  style={{ width: "100%", height: "100%", objectFit: "cover", display: "block" }}
                  onError={(e) => {
                    // If no public object exists, show empty state (avoid broken image icon)
                    (e.currentTarget as HTMLImageElement).style.display = "none";
                  }}
                />
              ) : null}
              {!bikeThumb ? (
                <div style={{ width: "100%", height: "100%", display: "grid", placeItems: "center", color: "#64748b", fontWeight: 800 }}>
                  No photo
                </div>
              ) : null}
            </div>

            <div>
              <div style={{ color: "#64748b", fontWeight: 600 }}>
                {bike.city || "—"}, {bike.province || "—"} • {bike.is_active ? "Active ✅" : "Inactive ❌"}
              </div>

              <div style={{ marginTop: 12, display: "flex", gap: 10, flexWrap: "wrap" }}>
                <Link to="/mentors/new" style={btnPrimary}>
                  Edit my bike →
                </Link>
                <Link to="/mentors" style={btnSecondary}>
                  Mentor info →
                </Link>
              </div>
            </div>
          </div>
        ) : (
          <div style={{ marginTop: 12 }}>
            <div style={{ color: "#64748b", fontWeight: 600 }}>No bike listed yet.</div>
            <div style={{ marginTop: 12 }}>
              <Link to="/mentors/new" style={btnPrimary}>
                Start / Add my bike →
              </Link>
            </div>
          </div>
        )}
      </div>

      {/* Requests */}
      <div style={{ marginTop: 16, ...cardShell }}>
        <div style={{ fontWeight: 800, fontSize: 18 }}>Requests</div>
        <div style={{ marginTop: 6, color: "#475569", fontWeight: 600 }}>Booking requests waiting for your acceptance (mentor deposit).</div>

        {pending.length === 0 ? (
          <div style={{ marginTop: 12, color: "#64748b", fontWeight: 600 }}>No pending requests.</div>
        ) : (
          <div style={{ marginTop: 12 }}>
            {pending.map((b) => (
              <div key={b.id} style={{ border: "1px solid #e2e8f0", borderRadius: 16, padding: 14, marginTop: 10 }}>
                <div style={{ fontWeight: 800 }}>Booking {shortId(b.id)}</div>
                <div style={{ marginTop: 6, color: "#64748b", fontWeight: 600 }}>scheduled: {fmtDateTime(scheduledIsoFor(b))}</div>

                <div style={{ marginTop: 10, color: "#475569", fontWeight: 600 }}>
                  “Accept” opens checkout for your $150 deposit (unless credit covers it).
                </div>

                {(() => {
                  const iso = scheduledIsoFor(b);
                  const scheduledMs = iso ? new Date(iso).getTime() : NaN;
                  const deadline = acceptanceDeadlineMs({
                    createdAtIso: b.created_at || null,
                    scheduledIso: iso || null,
                  });

                  const acceptanceExpired = deadline !== null && Date.now() > deadline;
                  // Hard stop close to test time: don't allow last‑second accepts.
                  const tooLate = Number.isFinite(scheduledMs) && Date.now() > scheduledMs - 15 * 60 * 1000;

                  return (
                    <div style={{ marginTop: 10 }}>
                      <div style={{ fontWeight: 800 }}>
                        Acceptance window: {deadline ? <Countdown deadlineMs={deadline} /> : "—"}
                      </div>
                      {(acceptanceExpired || tooLate) && (
                        <div style={{ marginTop: 6, color: "#b91c1c", fontWeight: 800 }}>
                          This request is expired.
                        </div>
                      )}
                    </div>
                  );
                })()}

                <div style={{ marginTop: 10, display: "flex", gap: 10, flexWrap: "wrap" }}>
                  <button
                    onClick={() => {
                      const iso = scheduledIsoFor(b);
                      const scheduledMs = iso ? new Date(iso).getTime() : NaN;
                      const deadline = acceptanceDeadlineMs({
                        createdAtIso: b.created_at || null,
                        scheduledIso: iso || null,
                      });

                      if (deadline !== null && Date.now() > deadline) {
                        setErr("Acceptance window expired.");
                        return;
                      }

                      if (Number.isFinite(scheduledMs) && Date.now() > scheduledMs - 15 * 60 * 1000) {
                        setErr("Too late to accept for this time. Ask the borrower to rebook.");
                        return;
                      }

                      setGateBooking(b);
                      setGateDepositChoice(b.owner_deposit_choice === "refund" ? "refund" : "keep");
                      setGateOpen(true);
                    }}

                    disabled={(() => {
                      if (busyId === b.id) return true;
                      const iso = scheduledIsoFor(b);
                      const scheduledMs = iso ? new Date(iso).getTime() : NaN;
                      const deadline = acceptanceDeadlineMs({
                        createdAtIso: b.created_at || null,
                        scheduledIso: iso || null,
                      });
                      const acceptanceExpired = deadline !== null && Date.now() > deadline;
                      const tooLate = Number.isFinite(scheduledMs) && Date.now() > scheduledMs - 15 * 60 * 1000;
                      return acceptanceExpired || tooLate;
                    })()}

                    style={{
                      padding: "10px 14px",
                      borderRadius: 14,
                      border: "1px solid #0f172a",
                      background: "#0f172a",
                      color: "white",
                      fontWeight: 800,
                      cursor: "pointer",
                      opacity: busyId === b.id ? 0.7 : 1,
                    }}
                  >
                    {busyId === b.id ? "…" : "Accept (pay deposit)"}
                  </button>

                  <button
                    onClick={() => cancelBookingAsOwner(b)}
                    disabled={busyId === b.id}
                    style={{
                      padding: "10px 14px",
                      borderRadius: 14,
                      border: "1px solid #cbd5e1",
                      background: "white",
                      fontWeight: 800,
                      cursor: "pointer",
                      opacity: busyId === b.id ? 0.7 : 1,
                    }}
                  >
                    {busyId === b.id ? "…" : cancelButtonLabelFor(b)}
                  </button>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>

      {/* Upcoming / Confirmed */}
      <div style={{ marginTop: 16, ...cardShell }}>
        <div style={{ fontWeight: 800, fontSize: 18 }}>Upcoming / Confirmed</div>
        <div style={{ marginTop: 6, color: "#475569", fontWeight: 600 }}>These are accepted bookings (mentor deposit paid).</div>
        <div style={{ marginTop: 6, color: "#475569", fontWeight: 600 }}>
          You receive <b>$100</b> once the test is completed and you confirm <b>YOUR</b> bike is returned.
        </div>

        {upcoming.length === 0 ? (
          <div style={{ marginTop: 12, color: "#64748b", fontWeight: 600 }}>No upcoming bookings.</div>
        ) : (
          <div style={{ marginTop: 12 }}>
            {upcoming.map((b) => {
              const isBusy = busyId === b.id;

              const borrowerChecked = !!b.borrower_checked_in;
              const ownerChecked = !!b.owner_checked_in;
              const ownerPossession = !!b.owner_confirmed_complete;
              const borrowerComplete = !!b.borrower_confirmed_complete;

              const w = checkInWindowFor(b);
              const now = Date.now();
              const checkInOpen = w ? isWithin(now, w.openMs, w.closeMs) : false;

              const comp = completionAllowedAtFor(b);
              const canConfirmTime = comp ? now >= comp.allowedAtMs : false;

              const canConfirmPossession = borrowerChecked && ownerChecked && canConfirmTime && !ownerPossession;
              const disableForfeit = borrowerChecked && ownerChecked;

              return (
                <div key={b.id} style={{ border: "1px solid #e2e8f0", borderRadius: 16, padding: 14, marginTop: 10 }}>
                  <div style={{ fontWeight: 800 }}>Booking {shortId(b.id)}</div>
                  <div style={{ marginTop: 6, color: "#64748b", fontWeight: 600 }}>
                    scheduled: {fmtDateTime(scheduledIsoFor(b))} • bike: {shortId(b.bike_id)}
             {(() => {
               const scheduledIso = scheduledIsoFor(b);
               const scheduledMs = scheduledIso ? new Date(scheduledIso).getTime() : NaN;
               const inPast = Number.isFinite(scheduledMs) && scheduledMs < Date.now();

               const hours = acceptanceHoursFor({ scheduledIso: scheduledIso || undefined });
               const deadline = acceptanceDeadlineMs({ createdAtIso: b.created_at ?? undefined, scheduledIso: scheduledIso || undefined });

               return (
                 <div style={{ marginTop: 8 }}>
                   {inPast && (
                     <div style={{ color: "#b00020", fontWeight: 800 }}>
                       This request is expired (scheduled time already passed).
                     </div>
                   )}

                   {deadline && !inPast && (
                     <div style={{ marginTop: 6, color: "#64748b", fontWeight: 600, fontSize: 12 }}>
                       Accept window ({hours}h): <Countdown deadlineMs={deadline} />
                     </div>
                   )}
                 </div>
               );
             })()}
    
                  </div>

                  <div style={{ marginTop: 10, fontWeight: 800, color: "#0f172a" }}>
                    Mentor check-in: {ownerChecked ? "✅" : "—"} <span style={{ marginLeft: 10 }} />
                    Test-taker check-in: {borrowerChecked ? "✅" : "—"} <span style={{ marginLeft: 10 }} />
                    Mentor possession: {ownerPossession ? "✅" : "—"} <span style={{ marginLeft: 10 }} />
                    Test-taker complete: {borrowerComplete ? "✅" : "—"}
                  </div>

                  <div style={{ marginTop: 10, color: "#475569", fontWeight: 600, fontSize: 13 }}>
                    Tip: both parties must check in before you can confirm possession.{" "}
                    {comp && !canConfirmTime ? <>Completion unlocks at <b>{fmtDateTime(new Date(comp.allowedAtMs).toISOString())}</b>.</> : null}
                  </div>

                  <div style={{ marginTop: 12, display: "flex", gap: 10, flexWrap: "wrap" }}>
                    <button
                      onClick={() => checkInAsOwner(b)}
                      disabled={isBusy || ownerChecked}
                      title={
                        ownerChecked
                          ? "You are checked in ✅"
                          : checkInOpen
                          ? "Check-in is open now."
                          : w
                          ? now < w.openMs
                            ? `Check-in opens at ${fmtDateTime(new Date(w.openMs).toISOString())}`
                            : `Check-in closed at ${fmtDateTime(new Date(w.closeMs).toISOString())}`
                          : "Missing scheduled time"
                      }
                      style={{
                        padding: "10px 14px",
                        borderRadius: 14,
                        border: "1px solid #cbd5e1",
                        background: "white",
                        fontWeight: 800,
                        cursor: "pointer",
                        opacity: isBusy || ownerChecked ? 0.6 : 1,
                      }}
                    >
                      {ownerChecked ? "Checked in" : "Checked in"}
                    </button>

                    <button
                      onClick={() => confirmBikeReturnedAsOwner(b)}
                      disabled={isBusy || !canConfirmPossession}
                      title={
                        ownerPossession
                          ? "Already confirmed ✅"
                          : !borrowerChecked || !ownerChecked
                          ? "Both parties must check in first."
                          : comp && !canConfirmTime
                          ? `Available at ${fmtDateTime(new Date(comp.allowedAtMs).toISOString())}`
                          : borrowerComplete
                          ? "Confirm you have your bike back."
                          : "You can confirm possession once check-in is done and the minimum time has passed."
                      }
                      style={{
                        padding: "10px 14px",
                        borderRadius: 14,
                        border: "1px solid #0f172a",
                        background: "#0f172a",
                        color: "white",
                        fontWeight: 800,
                        cursor: "pointer",
                        opacity: isBusy || !canConfirmPossession ? 0.6 : 1,
                      }}
                    >
                      {ownerPossession ? "Possession confirmed" : "Confirm YOUR bike is returned"}
                    </button>
                    <button
                      onClick={() => setOpenMsgId((cur) => (cur === b.id ? null : b.id))}
                      disabled={isBusy}
                      title="Message the test-taker about timing, meeting spot, etc."
                      style={{
                        padding: "10px 14px",
                        borderRadius: 14,
                        border: "1px solid #cbd5e1",
                        background: "white",
                        fontWeight: 800,
                        cursor: "pointer",
                        opacity: isBusy ? 0.6 : 1,
                      }}
                    >
                       {openMsgId === b.id ? "Hide messages" : "Messages"}
                     </button>

                    <button
                      onClick={() => cancelBookingAsOwner(b)}
                      disabled={isBusy || disableForfeit}
                      title={disableForfeit ? "FORFEIT is disabled once both parties have checked in." : cancelTitleFor(b)}
                      style={{
                        padding: "10px 14px",
                        borderRadius: 14,
                        border: "1px solid #cbd5e1",
                        background: "white",
                        fontWeight: 800,
                        cursor: "pointer",
                        opacity: isBusy || disableForfeit ? 0.6 : 1,
                      }}
                    >
                      {isBusy ? "…" : cancelButtonLabelFor(b)}
                    </button>
                  </div>

                  {openMsgId === b.id && (
                    <div
                      style={{
                        marginTop: 12,
                        border: "1px solid #e2e8f0",
                        borderRadius: 14,
                        padding: 12,
                        background: "#f8fafc",
                      }}
                    >
                      <BookingMessages
                        bookingId={b.id}
                        meId={b.owner_id}
                        otherUserId={b.borrower_id}
                        otherLabel="Test-taker"
/>
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        )}
      </div>

      {/* History */}
      <div style={{ marginTop: 16, ...cardShell }}>
        <div style={{ fontWeight: 800, fontSize: 18 }}>History</div>
        <div style={{ marginTop: 6, color: "#475569", fontWeight: 600 }}>
          Past/expired/cancelled bookings live here so “Requests” stays clean.
        </div>

        {history.length === 0 ? (
          <div style={{ marginTop: 12, color: "#64748b", fontWeight: 600 }}>No history yet.</div>
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
                      <td style={{ padding: "10px 0", fontWeight: 800 }}>{shortId(b.id)}</td>
                      <td style={{ padding: "10px 0", fontWeight: 600, color: "#334155" }}>{fmtDateTime(whenIso)}</td>
                      <td style={{ padding: "10px 0", fontWeight: 800 }}>{state}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>

            {history.length > 25 ? (
              <div style={{ marginTop: 10, color: "#64748b", fontWeight: 600, fontSize: 12 }}>
                Showing latest 25 history rows.
              </div>
            ) : null}
          </div>
        )}
      </div>
    </div>
  );
}

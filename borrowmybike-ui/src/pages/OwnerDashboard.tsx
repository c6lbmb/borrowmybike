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

  // Test-taker context (shown to mentor)
  test_taker_intro?: string | null;
  time_window?: string | null;
  registry_quadrant?: string | null;

  cancelled: boolean;
  settled: boolean;
  completed: boolean;

  borrower_paid: boolean;
  owner_deposit_paid: boolean;
  owner_deposit_choice?: "keep" | "refund" | null;

  needs_review: boolean;
  review_reason: string | null;
  tag_reason?: string | null;

  created_at: string | null;

  borrower_checked_in?: boolean | null;
  owner_checked_in?: boolean | null;

  borrower_checked_in_at?: string | null;
  owner_checked_in_at?: string | null;

  force_majeure_borrower_agreed_at?: string | null;
  force_majeure_owner_agreed_at?: string | null;
  settlement_outcome?: string | null;
  treat_as_borrower_no_show?: boolean;
  treat_as_owner_no_show?: boolean;
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
  const d = new Date(iso as string);
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

function bookingStateLabel(b: BookingRow): string {
  if (b.cancelled) return "Cancelled";
  if (b.needs_review) return "Needs review";
  if (b.settled) {
    const outcome = (b.settlement_outcome || "").toLowerCase();
    if (outcome === "force_majeure") return "Force majeure";
    if (outcome === "borrower_no_show") return "No-show (test-taker)";
    if (outcome === "owner_no_show") return "No-show (mentor)";
    if (outcome === "happy_path") return "Completed";
    if (outcome === "borrower_fault") return "Resolved (test-taker issue)";
    if (outcome === "owner_fault") return "Resolved (mentor issue)";
    if (b.treat_as_borrower_no_show) return "No-show (test-taker)";
    if (b.treat_as_owner_no_show) return "No-show (mentor)";
    return "Settled";
  }
  if (b.status === "pending_acceptance") return "Pending acceptance";
  if (b.status === "confirmed") return "Confirmed";
  return b.status || "—";
}


function scheduledIsoFor(b: BookingRow) {
  return b.scheduled_start_at ?? b.booking_date ?? null;
}


function hasBorrowerCheckedIn(b: BookingRow) {
  return !!b.borrower_checked_in || !!b.borrower_checked_in_at;
}

function hasOwnerCheckedIn(b: BookingRow) {
  return !!b.owner_checked_in || !!b.owner_checked_in_at;
}


function checkInWindowFor(b: BookingRow) {
  const iso = scheduledIsoFor(b);
  if (!iso) return null;

  const t = new Date(iso as string).getTime();
  if (Number.isNaN(t)) return null;

  const openMs = t - CHECKIN_OPEN_MIN * 60 * 1000;
  const closeMs = t + CHECKIN_CLOSE_MIN * 60 * 1000;
  return { openMs, closeMs };
}


function noShowClaimWindowFor(b: BookingRow) {
  const iso = scheduledIsoFor(b);
  if (!iso) return null;

  const t = new Date(iso as string).getTime();
  if (Number.isNaN(t)) return null;

  // No-show timeline:
  // - Show the button 5 minutes after scheduled start (only if exactly one party checked in).
  // - Enable (allow clicking) at 30 minutes after start (backend no-show rule).
  const showMs = t + 5 * 60 * 1000;
  const enableMs = t + 30 * 60 * 1000;
  return { showMs, enableMs };
}

function isWithin(now: number, openMs: number, closeMs: number): boolean {
  return now >= openMs && now <= closeMs;
}

// completion allowed: >= scheduled + 20 min (minimum only)
function completionAllowedAtFor(b: BookingRow) {
  const iso = scheduledIsoFor(b);
  if (!iso) return null;

  const t = new Date(iso as string).getTime();
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

  const t = new Date(iso as string).getTime();
  if (Number.isNaN(t)) return false;

  const daysUntil = (t - Date.now()) / MS_DAY;
  return daysUntil <= 5;
}

function borrowerCheckedIn(b: BookingRow) {
  return !!b.borrower_checked_in_at || !!b.borrower_checked_in;
}
function ownerCheckedIn(b: BookingRow) {
  return !!b.owner_checked_in_at || !!b.owner_checked_in;
}
function bothCheckedIn(b: BookingRow) {
  return borrowerCheckedIn(b) && ownerCheckedIn(b);
}

function anyCheckedIn(b: BookingRow) {
  return borrowerCheckedIn(b) || ownerCheckedIn(b);
}


function isConfirmedBothPaid(b: BookingRow) {
  // Prefer explicit status when present; fall back to paid flags only.
  const statusOk = b.status ? b.status === "confirmed" : true;
  return statusOk && !!b.borrower_paid && !!b.owner_deposit_paid && !b.cancelled && !b.settled && !b.completed;
}

function fmWindowOpen(b: BookingRow) {
  // Discreet FM: 24h prior to scheduled start, only before anyone checks in.
  if (!isConfirmedBothPaid(b)) return false;
  if (borrowerCheckedIn(b) || ownerCheckedIn(b)) return false;

  const iso = scheduledIsoFor(b);
  if (!iso) return false;

  const startMs = new Date(iso as string).getTime();
  if (Number.isNaN(startMs)) return false;

  const now = Date.now();
  const msUntil = startMs - now;
  return msUntil <= 24 * 60 * 60 * 1000 && msUntil >= 0;
}

function examinerRefusalWindowOpen(b: BookingRow) {
  // After both check-ins, until 10 minutes after scheduled start.
  if (!isConfirmedBothPaid(b)) return false;
  if (!bothCheckedIn(b)) return false;
  if (b.owner_confirmed_complete) return false;

  const iso = scheduledIsoFor(b);
  if (!iso) return true;

  const startMs = new Date(iso as string).getTime();
  if (Number.isNaN(startMs)) return true;

  return Date.now() <= startMs + 10 * 60 * 1000;
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
  const t = new Date(iso as string).getTime();
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

  const [fmBusyId, setFmBusyId] = useState<string | null>(null);
  const [fmPendingId, setFmPendingId] = useState<string | null>(null);

  const [refusalOpenId, setRefusalOpenId] = useState<string | null>(null);
  const [refusalReason, setRefusalReason] = useState<"motorcycle" | "test_taker" | "unavoidable" | "other" | "">("");
  const [refusalNote, setRefusalNote] = useState<string>("");
  const [refusalBusyId, setRefusalBusyId] = useState<string | null>(null);

  // Mentor accept checklist gate
  const [gateOpen, setGateOpen] = useState(false);
  // Deposit preference is captured right before settlement (after the bike is returned), not at accept.
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
          "id,bike_id,borrower_id,owner_id,booking_date,scheduled_start_at,cancelled,settled,completed,borrower_paid,owner_deposit_paid,needs_review,review_reason,created_at,borrower_checked_in,owner_checked_in,borrower_confirmed_complete,owner_confirmed_complete,cancelled_by,status,borrower_checked_in_at,owner_checked_in_at,settlement_outcome,treat_as_borrower_no_show,treat_as_owner_no_show,force_majeure_borrower_agreed_at,force_majeure_owner_agreed_at,test_taker_intro,time_window,registry_quadrant",
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
    if (!me) return;
    load();
    loadMyBike();

    const t = window.setInterval(() => {
      load();
    }, 15000);

    return () => window.clearInterval(t);
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

  
  async function claimNoShowAsOwner(b: BookingRow) {
    // Only allow claim when mentor checked in but test-taker has not, and only in the 5–10 min window after start.
    const borrowerChecked = hasBorrowerCheckedIn(b);
    const ownerChecked = hasOwnerCheckedIn(b);

    if (!ownerChecked || borrowerChecked) return;

    const w = noShowClaimWindowFor(b);
    const now = Date.now();
    const canClick = w ? now >= w.enableMs : false;

    if (!canClick) return;

    const ok = confirm(
      `Report no-show?

This is only for when YOU have checked in and the test-taker has not, at least 10 minutes after the scheduled start time.

Proceed?`
    );
    if (!ok) return;

    setBusyId(b.id);
    setErr(null);
    try {
      // settle-booking will determine the correct no-show outcome based on check-in timestamps and timing.
      const { error } = await sb.functions.invoke("settle-booking", {
        body: { booking_id: b.id, claim_no_show: true, claimant_role: "owner" },
      });
      if (error) throw error;

      await load();
    } catch (e: any) {
      setErr(e?.message || "No-show claim failed");
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

    // Deposit preference must be set BEFORE completion triggers settlement.
    if (!b.owner_deposit_choice) {
      const typed = prompt('Deposit preference: type "KEEP" (keep on platform) or "REFUND" (refund to card).', "KEEP");
      const upper = (typed || "").trim().toUpperCase();

      if (upper !== "KEEP" && upper !== "REFUND") {
        alert('Please type either "KEEP" or "REFUND".');
        return;
      }

      try {
        await persistOwnerDepositChoice(b.id, upper === "REFUND" ? "refund" : "keep");
      } catch (e: any) {
        setErr(e?.message || "Failed to save deposit preference");
        return;
      }

      // Refresh so settle-booking sees the saved choice right away
      await load();
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
    // Once either party has checked in, cancel/forfeit should be hidden (your rule)
    const borrowerChecked = borrowerCheckedIn(b);
    const ownerChecked = ownerCheckedIn(b);
    if (borrowerChecked || ownerChecked) {
      alert("Cancel/forfeit is not available once either party has checked in.");
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
        body: { booking_id: b.id, claim_no_show: true, claimant_role: "owner" },
      });
      if (error) throw error;

      const url = (data as any)?.checkout_url;
      if (url) {
        window.location.href = url;
        return;
      }

      // If fully covered by credit, backend may return ok + method="credit" (no checkout_url)
      const ok = (data as any)?.ok;
      const method = (data as any)?.method;
      if (ok && method === "credit") {
        await load();
        return;
      }

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
    fontWeight: 950,
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
    fontWeight: 950,
    cursor: "pointer",
    textDecoration: "none",
    color: "#0f172a",
    display: "inline-flex",
    alignItems: "center",
    gap: 8,
  };

  const bikeTitle = bike ? `${bike.year || ""} ${bike.make || ""} ${bike.model || ""}`.trim() || "Your bike" : "My Bike";
  const bikeThumb = bike && me ? coverUrl(me, bike.id) : null;

  
  async function agreeForceMajeureAsOwner(b: BookingRow) {
    if (!fmWindowOpen(b)) return;

    // Discreet: require deliberate confirmation.
    const ok = confirm(
      `Force Majeure (weather/registry reschedule):

Only use this if the registry has rescheduled the test due to weather or unavoidable conditions, BEFORE anyone checks in.

This will record your agreement and wait for the test-taker to agree.`
    );
    if (!ok) return;

    const shouldFinalize = !!(b as any).force_majeure_borrower_agreed_at;


    try {
      setFmBusyId(b.id);

      const nowIso = new Date().toISOString();
      // Write FM agreement via Edge Function to avoid RLS "permission denied" on bookings.
      const { data: fmData, error: fmErr } = await sb.functions.invoke("agree-force-majeure", {
        body: { booking_id: b.id, role: "owner" },
      });
      if (fmErr) throw fmErr;
      if ((fmData as any)?.error) throw new Error((fmData as any).error);
// Local UI update
      setRows((cur) =>
        cur.map((r) => (r.id === b.id ? ({ ...r, force_majeure_owner_agreed_at: nowIso } as any) : r)),
      );
      // If the test-taker already agreed, finalize immediately by settling as force majeure.
      if (shouldFinalize) {
        setFmPendingId(b.id);
        const { error: sErr, data } = await sb.functions.invoke("settle-booking", {
          body: { booking_id: b.id },
        });
        if (sErr) throw sErr;
        if ((data as any)?.error) throw new Error((data as any).error);
        await load();
      } else {
        setFmPendingId(b.id);
      }
    } catch (e: any) {
      alert(e?.message || "Failed to record force majeure agreement");
    } finally {
      setFmBusyId(null);
      setFmPendingId(null);
    }
  }

  async function submitExaminerRefusalAsOwner(b: BookingRow) {
    if (!examinerRefusalWindowOpen(b)) return;

    if (!refusalReason) {
      alert("Please select a reason.");
      return;
    }

    const label =
      refusalReason === "motorcycle"
        ? "Issue with motorcycle"
        : refusalReason === "test_taker"
        ? "Test-taker not ready today"
        : refusalReason === "unavoidable"
        ? "Unavoidable conditions (weather / closure / emergency)"
        : "Other";

    const note = (refusalNote || "").trim();

    const ok = confirm(
      `Examiner refused the test.

Reason: ${label}${note ? `\nNote: ${note}` : ""}

This will flag the booking for review and rebooking. Continue?`,
    );
    if (!ok) return;

    try {
      setRefusalBusyId(b.id);

      const { error } = await sb.functions.invoke("examiner-refusal", {
        body: {
          booking_id: b.id,
          reason_code:
            refusalReason === "unavoidable" ? "unavoidable" : (refusalReason as any),
          note: note || null,
        },
      });

      if (error) throw error;

      // optimistic UI update (true source of truth is load/polling)
      setRows((cur) =>
        cur.map((r) =>
          r.id === b.id
            ? ({
                ...r,
                needs_review: true,
                review_reason: "examiner_refusal",
                tag_reason: `Examiner refused: ${label}${note ? ` — ${note}` : ""}`,
                needs_rebooking: true,
              } as any)
            : r,
        ),
      );

      setRefusalOpenId(null);
      setRefusalReason("");
      setRefusalNote("");
    } catch (e: any) {
      alert(e?.message || "Failed to submit examiner refusal");
    } finally {
      setRefusalBusyId(null);
    }
  }

return (
    <div style={{ padding: "2rem" }}>
      <ChecklistGateModal
        open={gateOpen}
        title="Before you accept…"
        intro={
          <>
            You’re agreeing your bike is road-test ready and you understand the cancellation / fault rules.
            You’ll place the <b>$150 mentor deposit</b> next (credit may apply).
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
          setGateOpen(false);
          setGateBooking(null);
          if (!b) return;

          void doAcceptWithDeposit(b);
        }}
      />

      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 12, flexWrap: "wrap" }}>
        <div>
          <div style={{ fontSize: 28, fontWeight: 1000 }}>Mentor Dashboard</div>
          <div style={{ marginTop: 4, color: "#64748b", fontWeight: 800 }}>Your bookings + acceptance window.</div>
        </div>

        <div style={{ display: "flex", gap: 10, flexWrap: "wrap" }}>
          <Link to="/browse" style={{ fontWeight: 900 }}>
            Browse →
          </Link>
          <button
            style={{
              padding: "10px 12px",
              borderRadius: 14,
              border: "1px solid #cbd5e1",
              fontWeight: 900,
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
          <div style={{ fontWeight: 900, color: "#b00020" }}>Error</div>
          <div style={{ marginTop: 6, color: "#7f1d1d", fontWeight: 800 }}>{err}</div>
        </div>
      )}

      {/* My Bike (fast access + thumbnail) */}
      <div style={{ marginTop: 16, ...cardShell }}>
        <div style={{ fontWeight: 1000, fontSize: 18 }}>{bikeTitle}</div>
        <div style={{ marginTop: 6, color: "#475569", fontWeight: 700 }}>
          Quick access to your listing. Keep it up to date so test-takers can book confidently.
        </div>

        {loadingBike ? (
          <div style={{ marginTop: 12, color: "#64748b", fontWeight: 800 }}>Loading…</div>
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
                <div style={{ width: "100%", height: "100%", display: "grid", placeItems: "center", color: "#64748b", fontWeight: 900 }}>
                  No photo
                </div>
              ) : null}
            </div>

            <div>
              <div style={{ color: "#64748b", fontWeight: 800 }}>
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
            <div style={{ color: "#64748b", fontWeight: 800 }}>No bike listed yet.</div>
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
        <div style={{ fontWeight: 1000, fontSize: 18 }}>Requests</div>
        <div style={{ marginTop: 6, color: "#475569", fontWeight: 700 }}>Requests waiting for your decision.</div>

        {pending.length === 0 ? (
          <div style={{ marginTop: 12, color: "#64748b", fontWeight: 800 }}>No pending requests.</div>
        ) : (
          <div style={{ marginTop: 12 }}>
            {pending.map((b) => (
              <div key={b.id} style={{ border: "1px solid #e2e8f0", borderRadius: 16, padding: 14, marginTop: 10 }}>
                <div style={{ fontWeight: 1000 }}>Booking {shortId(b.id)}</div>
                <div style={{ marginTop: 6, color: "#64748b", fontWeight: 800 }}>scheduled: {fmtDateTime(scheduledIsoFor(b))}</div>

                {(() => {
                  const intro = (b.test_taker_intro || "").trim();
                  const tw = (b.time_window || "").trim();
                  const rq = (b.registry_quadrant || "").trim();
                  if (!intro && !tw && !rq) return null;

                  const twLabel =
                    tw === "morning" ? "Morning" :
                    tw === "early_afternoon" ? "Early afternoon" :
                    tw === "late_afternoon" ? "Late afternoon" : tw;

                  return (
                    <div
                      style={{
                        marginTop: 10,
                        background: "#f8fafc",
                        border: "1px solid #e2e8f0",
                        borderRadius: 14,
                        padding: 12,
                      }}
                    >
                      <div style={{ fontWeight: 950, color: "#0f172a" }}>Test-taker info</div>
                      <div style={{ marginTop: 6, color: "#334155", fontWeight: 800, lineHeight: 1.35 }}>
                        {intro ? <>“{intro}”</> : <span style={{ color: "#64748b" }}>No intro provided.</span>}
                      </div>
                      <div style={{ marginTop: 8, display: "flex", gap: 10, flexWrap: "wrap", color: "#475569", fontWeight: 850 }}>
                        {tw ? <span style={{ padding: "4px 10px", borderRadius: 999, border: "1px solid #cbd5e1", background: "white" }}>Time window: {twLabel}</span> : null}
                        {rq ? <span style={{ padding: "4px 10px", borderRadius: 999, border: "1px solid #cbd5e1", background: "white" }}>Registry area: {rq}</span> : null}
                      </div>
                    </div>
                  );
                })()}

                <div style={{ marginTop: 10, color: "#64748b", fontWeight: 750, fontSize: 13 }}>
                  Accept = pay deposit (unless credit covers it).
                </div>

                {(() => {
  const iso = scheduledIsoFor(b);
  const scheduledMs = typeof iso === "string" ? new Date(iso).getTime() : NaN;
  const inPast = Number.isFinite(scheduledMs) && scheduledMs < Date.now();

  const hours = acceptanceHoursFor({ createdAtIso: b.created_at ?? undefined, scheduledIso: iso || undefined });
  const deadline = acceptanceDeadlineMs({ createdAtIso: b.created_at ?? undefined, scheduledIso: iso || undefined });

  if (!deadline) return null;

  const acceptanceExpired = Date.now() > (deadline as number);
  const tooLate = Number.isFinite(scheduledMs) && Date.now() > scheduledMs - 15 * 60 * 1000;

  return (
    <div style={{ marginTop: 10 }}>
      {inPast || acceptanceExpired || tooLate ? (
        <div style={{ color: "#b00020", fontWeight: 900 }}>
          This request is expired{tooLate && !inPast ? " (too close to the scheduled time)." : "."}
        </div>
      ) : (
        <div style={{ color: "#64748b", fontWeight: 800, fontSize: 12 }}>
          Accept window ({hours}h): <Countdown deadlineMs={deadline as number} />
        </div>
      )}
    </div>
  );
})()}

                <div style={{ marginTop: 10, display: "flex", gap: 10, flexWrap: "wrap" }}>
                  <button
                    onClick={() => {
                      const iso = scheduledIsoFor(b);
                      const scheduledMs = iso ? new Date(iso as string).getTime() : NaN;
                      const deadline = acceptanceDeadlineMs({
                        createdAtIso: b.created_at || null,
                        scheduledIso: iso || null,
                      });

                      if (deadline != null && Date.now() > (deadline as number)) {
                        setErr("Acceptance window expired.");
                        return;
                      }

                      if (Number.isFinite(scheduledMs) && Date.now() > scheduledMs - 15 * 60 * 1000) {
                        setErr("Too late to accept for this time. Ask the borrower to rebook.");
                        return;
                      }

                      setGateBooking(b);
                      setGateOpen(true);
                    }}

                    disabled={(() => {
                      if (busyId === b.id) return true;
                      const iso = scheduledIsoFor(b);
                      const scheduledMs = iso ? new Date(iso as string).getTime() : NaN;
                      const deadline = acceptanceDeadlineMs({
                        createdAtIso: b.created_at || null,
                        scheduledIso: iso || null,
                      });
                      const acceptanceExpired = deadline != null ? Date.now() > (deadline as number) : false;
                      const tooLate = Number.isFinite(scheduledMs) && Date.now() > scheduledMs - 15 * 60 * 1000;
                      return acceptanceExpired || tooLate;
                    })()}

                    style={{
                      padding: "10px 14px",
                      borderRadius: 14,
                      border: "1px solid #0f172a",
                      background: "#0f172a",
                      color: "white",
                      fontWeight: 950,
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
                      fontWeight: 950,
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
        <div style={{ fontWeight: 1000, fontSize: 18 }}>Upcoming / Confirmed</div>
        <div style={{ marginTop: 6, color: "#475569", fontWeight: 700 }}>These are accepted bookings (mentor deposit paid).</div>
        <div style={{ marginTop: 6, color: "#475569", fontWeight: 700 }}>
          You receive <b>$100</b> once the test is completed and you confirm <b>YOUR</b> bike is returned.
        </div>

        {upcoming.length === 0 ? (
          <div style={{ marginTop: 12, color: "#64748b", fontWeight: 800 }}>No upcoming bookings.</div>
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
              const hideForfeit = anyCheckedIn(b);

              return (
                <div key={b.id} style={{ border: "1px solid #e2e8f0", borderRadius: 16, padding: 14, marginTop: 10 }}>
                  <div style={{ fontWeight: 1000 }}>Booking {shortId(b.id)}</div>
                  <div style={{ marginTop: 6, color: "#64748b", fontWeight: 800 }}>
                    scheduled: {fmtDateTime(scheduledIsoFor(b))} • bike: {shortId(b.bike_id)}
             {(() => {
               const scheduledIso = scheduledIsoFor(b);
               const scheduledMs = typeof scheduledIso === "string" ? new Date(scheduledIso).getTime() : NaN;
               const inPast = Number.isFinite(scheduledMs) && scheduledMs < Date.now();

               const showRequestMeta = (b.status ?? null) !== "confirmed" && !b.owner_deposit_paid;

               const hours = acceptanceHoursFor({ createdAtIso: b.created_at ?? undefined, scheduledIso: scheduledIso || undefined });
               const deadline = acceptanceDeadlineMs({ createdAtIso: b.created_at ?? undefined, scheduledIso: scheduledIso || undefined });

               return (
                 <div style={{ marginTop: 8 }}>
                   {showRequestMeta && inPast && (
                     <div style={{ color: "#b00020", fontWeight: 900 }}>
                       This request is expired (scheduled time already passed).
                     </div>
                   )}

                   {showRequestMeta && deadline && !inPast && (
                     <div style={{ marginTop: 6, color: "#64748b", fontWeight: 800, fontSize: 12 }}>
                       Accept window ({hours}h): <Countdown deadlineMs={deadline as number} />
                     </div>
                   )}
                 </div>
               );
             })()}
    
                  </div>

                  <div style={{ marginTop: 10, fontWeight: 900, color: "#0f172a" }}>
                    Mentor check-in: {ownerChecked ? "✅" : "—"} <span style={{ marginLeft: 10 }} />
                    Test-taker check-in: {borrowerChecked ? "✅" : "—"} <span style={{ marginLeft: 10 }} />
                    Mentor possession: {ownerPossession ? "✅" : "—"} <span style={{ marginLeft: 10 }} />
                    Test-taker complete: {borrowerComplete ? "✅" : "—"}
                  </div>

                  <div style={{ marginTop: 10, color: "#475569", fontWeight: 800, fontSize: 13 }}>
                    Tip: both parties must check in before you can confirm possession.{" "}
                    {comp && !canConfirmTime ? <>Completion unlocks at <b>{fmtDateTime(new Date(comp.allowedAtMs).toISOString())}</b>.</> : null}
                  </div>

                  <div style={{ marginTop: 12, display: "flex", gap: 10, flexWrap: "wrap" }}>
                    {(checkInOpen || ownerChecked) && (
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
                        fontWeight: 950,
                        cursor: "pointer",
                        opacity: isBusy || ownerChecked ? 0.6 : 1,
                      }}
                    >
                      {ownerChecked ? "Checked in" : "Check in"}
                    </button>
                    )}

                    {(() => {
                      const wNo = noShowClaimWindowFor(b);
                      const nowNo = Date.now();
                      const showNoShowWindowOpen = wNo ? nowNo >= wNo.showMs : false;
                      const canClickNoShow = wNo ? nowNo >= wNo.enableMs : false;

                      const borrowerChecked = hasBorrowerCheckedIn(b);
                      const ownerChecked = hasOwnerCheckedIn(b);
                      const exactlyOneCheckedIn = (borrowerChecked && !ownerChecked) || (!borrowerChecked && ownerChecked);

                      const bothPaidConfirmed = isConfirmedPaid(b);

                      const showNoShow =
                        bothPaidConfirmed &&
                        exactlyOneCheckedIn &&
                        ownerChecked &&
                        !borrowerChecked &&
                        showNoShowWindowOpen &&
                        !b.cancelled &&
                        !b.settled &&
                        !b.completed;

                      if (!showNoShow) return null;

                      return (
                        <button
                          onClick={() => claimNoShowAsOwner(b)}
                          disabled={isBusy || !canClickNoShow}
                          title="Report a no-show (shows 5 minutes after start; becomes clickable 30 minutes after start, only if you checked in and the test-taker did not)."
                          style={{
                            padding: "10px 14px",
                            borderRadius: 14,
                            border: "1px solid #cbd5e1",
                            background: "white",
                            fontWeight: 950,
                            cursor: "pointer",
                            opacity: isBusy ? 0.6 : 1,
                          }}
                        >
                          Report no-show
                        </button>
                      );
                    })()}




                    {(ownerPossession || canConfirmPossession) && (
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
                        fontWeight: 950,
                        cursor: "pointer",
                        opacity: isBusy || !canConfirmPossession ? 0.6 : 1,
                      }}
                    >
                      {ownerPossession ? "Possession confirmed" : "Confirm YOUR bike is returned"}
                    </button>
                    )}

                    
                    {fmWindowOpen(b) && (
                      <button
                        onClick={() => agreeForceMajeureAsOwner(b)}
                        disabled={isBusy || fmBusyId === b.id || fmPendingId === b.id || !!b.force_majeure_owner_agreed_at}
                        title="Force Majeure (weather/registry reschedule) — requires both parties to agree"
                        style={{
                          padding: "10px 14px",
                          borderRadius: 14,
                          border: "1px solid #cbd5e1",
                          background: "white",
                          fontWeight: 950,
                          cursor: "pointer",
                          opacity: isBusy || fmBusyId === b.id || !!b.force_majeure_owner_agreed_at ? 0.6 : 1,
                        }}
                      >
                        {b.force_majeure_owner_agreed_at || fmPendingId === b.id ? "FM requested" : fmBusyId === b.id ? "…" : "Weather / FM"}
                      </button>
                    )}

                    {b.force_majeure_owner_agreed_at && !b.force_majeure_borrower_agreed_at && !bothCheckedIn(b) && (
                      <div style={{ alignSelf: "center", fontWeight: 800, color: "#64748b" }}>
                        Waiting for test-taker to confirm FM.
                      </div>
                    )}

                    {examinerRefusalWindowOpen(b) && (
                      <button
                        onClick={() => {
                          setRefusalOpenId(b.id);
                          setRefusalReason("");
                          setRefusalNote("");
                        }}
                        disabled={isBusy}
                        title="Examiner refused the road test"
                        style={{
                          padding: "10px 14px",
                          borderRadius: 14,
                          border: "1px solid #cbd5e1",
                          background: "white",
                          fontWeight: 950,
                          cursor: "pointer",
                          opacity: isBusy ? 0.6 : 1,
                        }}
                      >
                        Examiner refused
                      </button>
                    )}

{isConfirmedBothPaid(b) && (
<button
                      onClick={() => setOpenMsgId((cur) => (cur === b.id ? null : b.id))}
                      disabled={isBusy}
                      title="Message the test-taker about timing, meeting spot, etc."
                      style={{
                        padding: "10px 14px",
                        borderRadius: 14,
                        border: "1px solid #cbd5e1",
                        background: "white",
                        fontWeight: 950,
                        cursor: "pointer",
                        opacity: isBusy ? 0.6 : 1,
                      }}
                    >
                       {openMsgId === b.id ? "Hide messages" : "Messages"}
                     </button>
                    )}


                    {!hideForfeit && (
<button
                      onClick={() => cancelBookingAsOwner(b)}
                      disabled={isBusy}
                      title={cancelTitleFor(b)}
                      style={{
                        padding: "10px 14px",
                        borderRadius: 14,
                        border: "1px solid #cbd5e1",
                        background: "white",
                        fontWeight: 950,
                        cursor: "pointer",
                        opacity: isBusy || hideForfeit ? 0.6 : 1,
                      }}
                    >
                      {isBusy ? "…" : cancelButtonLabelFor(b)}
                    </button>
                    )}

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

                  {refusalOpenId === b.id && (
                    <div
                      style={{
                        marginTop: 12,
                        border: "1px solid #e2e8f0",
                        borderRadius: 14,
                        padding: 12,
                        background: "#ffffff",
                      }}
                    >
                      <div style={{ fontWeight: 950 }}>Examiner refuses test</div>
                      <div style={{ marginTop: 6, color: "#475569", fontWeight: 750, fontSize: 13 }}>
                        Choose the closest reason. Language stays neutral.
                      </div>

                      <div style={{ marginTop: 10, display: "grid", gap: 8 }}>
                        <label style={{ display: "flex", gap: 10, alignItems: "center", fontWeight: 850 }}>
                          <input
                            type="radio"
                            name={`refusal-${b.id}`}
                            checked={refusalReason === "motorcycle"}
                            onChange={() => setRefusalReason("motorcycle")}
                          />
                          Issue with motorcycle
                        </label>
                        <label style={{ display: "flex", gap: 10, alignItems: "center", fontWeight: 850 }}>
                          <input
                            type="radio"
                            name={`refusal-${b.id}`}
                            checked={refusalReason === "test_taker"}
                            onChange={() => setRefusalReason("test_taker")}
                          />
                          Test-taker not ready today
                        </label>
                        <label style={{ display: "flex", gap: 10, alignItems: "center", fontWeight: 850 }}>
                          <input
                            type="radio"
                            name={`refusal-${b.id}`}
                            checked={refusalReason === "unavoidable"}
                            onChange={() => setRefusalReason("unavoidable")}
                          />
                          Unavoidable conditions (weather / closure / emergency)
                        </label>
                        <label style={{ display: "flex", gap: 10, alignItems: "center", fontWeight: 850 }}>
                          <input
                            type="radio"
                            name={`refusal-${b.id}`}
                            checked={refusalReason === "other"}
                            onChange={() => setRefusalReason("other")}
                          />
                          Other
                        </label>
                      </div>
                      <div style={{ marginTop: 12 }}>
                        <div style={{ fontWeight: 850, color: "#475569", fontSize: 13 }}>Optional note (short)</div>
                        <textarea
                          value={refusalNote}
                          onChange={(e) => setRefusalNote(e.target.value)}
                          placeholder="e.g., registry asked to reschedule due to weather"
                          rows={2}
                          style={{
                            marginTop: 6,
                            width: "100%",
                            borderRadius: 12,
                            border: "1px solid #e2e8f0",
                            padding: 10,
                            fontWeight: 700,
                          }}
                        />
                      </div>


                      <div style={{ marginTop: 12, display: "flex", gap: 10, flexWrap: "wrap" }}>
                        <button
                          onClick={() => submitExaminerRefusalAsOwner(b)}
                          disabled={isBusy || refusalBusyId === b.id || !refusalReason}
                          style={{
                            padding: "10px 14px",
                            borderRadius: 14,
                            border: "1px solid #0f172a",
                            background: "#0f172a",
                            color: "white",
                            fontWeight: 950,
                            cursor: "pointer",
                            opacity: isBusy || refusalBusyId === b.id || !refusalReason ? 0.6 : 1,
                          }}
                        >
                          {refusalBusyId === b.id ? "…" : "Submit"}
                        </button>

                        <button
                          onClick={() => {
                            setRefusalOpenId(null);
                            setRefusalReason("");
                            setRefusalNote("");
                          }}
                          disabled={isBusy}
                          style={{
                            padding: "10px 14px",
                            borderRadius: 14,
                            border: "1px solid #cbd5e1",
                            background: "white",
                            fontWeight: 950,
                            cursor: "pointer",
                            opacity: isBusy ? 0.6 : 1,
                          }}
                        >
                          Cancel
                        </button>
                      </div>
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

                  const state = bookingStateLabel(b);

                  return (
                    <tr key={b.id} style={{ borderTop: "1px solid #e2e8f0" }}>
                      <td style={{ padding: "10px 0", fontWeight: 900 }}>{shortId(b.id)}</td>
                      <td style={{ padding: "10px 0", fontWeight: 800, color: "#334155" }}>{fmtDateTime(whenIso)}</td>
                      <td style={{ padding: "10px 0", fontWeight: 900 }}>{state}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>

            {history.length > 25 ? (
              <div style={{ marginTop: 10, color: "#64748b", fontWeight: 800, fontSize: 12 }}>
                Showing latest 25 history rows.
              </div>
            ) : null}
          </div>
        )}
      </div>
    </div>
  );
}
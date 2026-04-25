// src/pages/BorrowerDashboard.tsx
import { useEffect, useMemo, useRef, useState } from "react";
import { Link } from "react-router-dom";
import { useAuth } from "../auth/useAuth";
import { sb } from "../lib/supabase";
import { callFn } from "../lib/fn";
import ReviewModal from "../components/ReviewModal";
import BookingMessages from "../components/BookingMessages";
import { acceptanceDeadlineMs, acceptanceHoursFor } from "../lib/acceptance";
import Countdown from "../components/Countdown";
import { useNavigate } from "react-router-dom";
import { trackEvent } from "../lib/analytics";

type LatestMessageMeta = {
  bookingId: string;
  senderUserId: string;
  createdAt: string;
};

type BookingRow = {
  id: string;
  bike_id: string;
  borrower_id: string;
  owner_id: string;

  // Booking status from DB (e.g., "pending", "confirmed"). Optional because some selects omit it.
  status?: string | null;

  booking_date: string | null;
  scheduled_start_at: string | null;

  cancelled: boolean;
  settled: boolean;
  completed: boolean;

  borrower_paid: boolean;
  owner_deposit_paid: boolean;

  needs_review: boolean;
  review_reason: string | null;
  tag_reason?: string | null;

  created_at: string | null;

  // These are present in backend; read safely.
  borrower_checked_in?: boolean | null;
  owner_checked_in?: boolean | null;
  borrower_confirmed_complete?: boolean | null;
  owner_confirmed_complete?: boolean | null;

  cancelled_by?: string | null;

  // Force majeure agreement timestamps (backend fields)
  force_majeure_borrower_agreed_at?: string | null;
  force_majeure_owner_agreed_at?: string | null;
  settlement_outcome?: string | null;
  treat_as_borrower_no_show?: boolean;
  treat_as_owner_no_show?: boolean;

  // Check-in timestamps (backend fields)
  borrower_checked_in_at?: string | null;
  owner_checked_in_at?: string | null;

  // New: context shown to mentor (kept here for completeness)
  test_taker_intro?: string | null;
  time_window?: "morning" | "early_afternoon" | "late_afternoon" | null;
  registry_quadrant?: "NE" | "NW" | "SE" | "SW" | null;
};

function fmtDateTime(iso?: string | null) {
  if (!iso) return "-";
  const d = new Date(iso);
  if (isNaN(d.getTime())) return "-";
  return d.toLocaleString([], { year: "numeric", month: "short", day: "2-digit", hour: "2-digit", minute: "2-digit" });
}

function shortId(id?: string | null) {
  return id ? id.slice(0, 8) + "…" : "-";
}

function bookingStateLabel(b: BookingRow): string {
 if (b.cancelled) {
  if (b.cancelled_by === "system_expired") return "Expired";
  return "Cancelled";
}
  if (b.needs_review) return b.review_reason === "examiner_refusal" ? "Examiner refusal under review" : "Needs review";
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
  return !!b.borrower_checked_in_at || !!b.borrower_checked_in;
}

function hasOwnerCheckedIn(b: BookingRow) {
  return !!b.owner_checked_in_at || !!b.owner_checked_in;
}

function isPendingAcceptance(b: BookingRow) {
  // Borrower has paid, mentor has not (still needs to accept / pay deposit)
  return !!b.borrower_paid && !b.owner_deposit_paid && !b.cancelled && !b.settled;
}

function isConfirmedPaid(b: BookingRow) {
  // Both paid, booking is confirmed and upcoming
  return !!b.borrower_paid && !!b.owner_deposit_paid && !b.cancelled && !b.settled && !b.completed;
}

function isPastScheduled(b: BookingRow) {
  const iso = scheduledIsoFor(b);
  if (!iso) return false;
  const ms = new Date(iso).getTime();
  if (Number.isNaN(ms)) return false;
  return ms < Date.now();
}

const MS_DAY = 24 * 60 * 60 * 1000;

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
 * Check-in window (MATCH MENTOR DASH):
 * - Opens 15 minutes before scheduled time
 * - Closes 60 minutes after scheduled time
 */
function checkInWindowFor(b: BookingRow) {
  const iso = scheduledIsoFor(b);
  if (!iso) return null;

  const t = new Date(iso).getTime();
  if (Number.isNaN(t)) return null;

  const openMs = t - 15 * 60 * 1000;
  const closeMs = t + 60 * 60 * 1000;
  return { openMs, closeMs };
}

function isWithin(now: number, openMs: number, closeMs: number) {
  return now >= openMs && now <= closeMs;
}

/**
 * Completion confirmation allowed (MATCH BACKEND):
 * - After scheduled time + 20 minutes
 */
function completionAllowedAtFor(b: BookingRow) {
  const iso = scheduledIsoFor(b);
  if (!iso) return null;

  const t = new Date(iso).getTime();
  if (Number.isNaN(t)) return null;

  const allowedAtMs = t + 20 * 60 * 1000;
  return { allowedAtMs };
}



export default function BorrowerDashboard() {
  const { user } = useAuth();
  const nav = useNavigate();
  const me = user?.id;

  useEffect(() => {
  if (!user) {
    nav("/auth", { replace: true });
  }
}, [user, nav]);

  const [rows, setRows] = useState<BookingRow[]>([]);
  const [loading, setLoading] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [busyId, setBusyId] = useState<string | null>(null);

  const [reviewOpen, setReviewOpen] = useState(false);
  const [reviewCtx, setReviewCtx] = useState<{ bookingId: string; bikeId: string; ownerId: string } | null>(null);

  const canShowReview = !!(reviewCtx && reviewCtx.bookingId && reviewCtx.bikeId && reviewCtx.ownerId);

    // Messages (only for confirmed bookings)
  const [openMsgId, setOpenMsgId] = useState<string | null>(null);
  const [latestMessageByBooking, setLatestMessageByBooking] = useState<Record<string, LatestMessageMeta>>({});
  const [seenMessageByBooking, setSeenMessageByBooking] = useState<Record<string, string>>({});

  // Prevent repeated system-expire attempts per booking (acceptance window timeout)
  const [systemExpireInFlight, setSystemExpireInFlight] = useState<Record<string, boolean>>({});
  const [fmInFlight, setFmInFlight] = useState<Record<string, boolean>>({});
  const [noShowInFlight, setNoShowInFlight] = useState<Record<string, boolean>>({});
  const [examinerRefusalInFlight, setExaminerRefusalInFlight] = useState<Record<string, boolean>>({});
  const [refusalOpenId, setRefusalOpenId] = useState<string | null>(null);
  const [refusalReason, setRefusalReason] = useState<"motorcycle_issue" | "not_ready" | "registry_reschedule" | "weather_conditions" | "other" | "">("");
  const [refusalNote, setRefusalNote] = useState<string>("");

  const trackedBorrowerCheckIns = useRef<Record<string, boolean>>({});
  const trackedBorrowerCompletions = useRef<Record<string, boolean>>({});


  async function requestForceMajeureAsBorrower(b: BookingRow) {
    if (!me) return;
    if (fmInFlight[b.id]) return;

    const ok = window.confirm(
      `Force Majeure (weather/registry reschedule)\n\n` +
        `Only use this if the registry has rescheduled the test due to weather or unavoidable conditions, BEFORE anyone checks in.\n\n` +
        `This will record your agreement and wait for the mentor to agree.`
    );
    if (!ok) return;

    const shouldFinalize = !!(b as any).force_majeure_owner_agreed_at;


    setFmInFlight((p: Record<string, boolean>) => ({ ...p, [b.id]: true }));
    try {
      // Write FM agreement via Edge Function to avoid RLS "permission denied" on bookings.
      const { data: fmData, error: fmErr } = await sb.functions.invoke("agree-force-majeure", {
        body: { booking_id: b.id, role: "borrower" },
      });
      if (fmErr) throw fmErr;
      if ((fmData as any)?.error) throw new Error((fmData as any).error);
// If the mentor already agreed, finalize immediately by settling as force majeure.
      if (shouldFinalize) {
        const { error: sErr, data } = await sb.functions.invoke("settle-booking", {
          body: { booking_id: b.id },
        });
        if (sErr) throw sErr;
        if ((data as any)?.error) throw new Error((data as any).error);
      }

      await load();
    } catch (e: any) {
      alert(e?.message || "Failed to request force majeure");
    } finally {
      setFmInFlight((p: Record<string, boolean>) => ({ ...p, [b.id]: false }));
    }
  }

  async function requestExaminerRefusalAsBorrower(b: BookingRow) {
    if (!me) return;
    if (examinerRefusalInFlight[b.id]) return;

    if (!refusalReason) {
      alert("Please select a reason.");
      return;
    }

    const label =
      refusalReason === "motorcycle_issue"
        ? "Issue with the motorcycle"
        : refusalReason === "not_ready"
        ? "Test-taker not ready today"
        : refusalReason === "registry_reschedule"
        ? "Registry rescheduled / examiner unavailable"
        : refusalReason === "weather_conditions"
        ? "Weather / road conditions"
        : "Other";

    const note = (refusalNote || "").trim();

    const ok = window.confirm(
      `Examiner refused the test.

Reason: ${label}${note ? `
Note: ${note}` : ""}

This will flag the booking for review. It will not auto-settle the booking. Continue?`,
    );
    if (!ok) return;

    setExaminerRefusalInFlight((p: Record<string, boolean>) => ({ ...p, [b.id]: true }));
    try {
      const { error } = await sb.functions.invoke("examiner-refusal", {
        body: { booking_id: b.id, reason_code: refusalReason, note: note || null },
      });
      if (error) throw error;
      trackEvent("examiner_refusal_reported", {
        booking_id: b.id,
        bike_id: b.bike_id,
        reported_by: "borrower",
        reason_code: refusalReason || "",
        scheduled_start_at: scheduledIsoFor(b) ?? "",
      });
      setRows((cur) =>
        cur.map((r) =>
          r.id === b.id
            ? ({
                ...r,
                needs_review: true,
                review_reason: "examiner_refusal",
                tag_reason: `${r.tag_reason ? `${r.tag_reason}
` : ""}Examiner refused: ${label}${note ? ` — ${note}` : ""} (submitted by borrower)`,
              } as any)
            : r,
        ),
      );
      setRefusalOpenId(null);
      setRefusalReason("");
      setRefusalNote("");
      alert("This booking has been flagged for review. We’ll review the information provided by both parties. If needed, email support with any extra details.");
      await load();
    } catch (e: any) {
      console.error(e);
      alert(e?.message || "Failed to submit examiner refusal");
    } finally {
      setExaminerRefusalInFlight((p: Record<string, boolean>) => ({ ...p, [b.id]: false }));
    }
  }


    function seenStorageKey(bookingId: string) {
    return `bmb:messages:lastSeen:${me}:${bookingId}`;
  }

  function readSeenIso(bookingId: string) {
    if (!me) return null;
    try {
      return window.localStorage.getItem(seenStorageKey(bookingId));
    } catch {
      return null;
    }
  }

  function markMessagesSeen(bookingId: string, latestIso: string | null) {
    if (!me || !latestIso) return;
    try {
      window.localStorage.setItem(seenStorageKey(bookingId), latestIso);
    } catch {}
    setSeenMessageByBooking((prev) => ({ ...prev, [bookingId]: latestIso }));
  }

  function hasUnreadMessages(bookingId: string) {
    const latest = latestMessageByBooking[bookingId];
    if (!latest) return false;
    if (latest.senderUserId === me) return false;

    const seenIso = seenMessageByBooking[bookingId] ?? readSeenIso(bookingId);
    if (!seenIso) return true;

    const latestMs = new Date(latest.createdAt).getTime();
    const seenMs = new Date(seenIso).getTime();
    if (Number.isNaN(latestMs) || Number.isNaN(seenMs)) return latest.createdAt !== seenIso;
    return latestMs > seenMs;
  }

  async function loadLatestMessageMeta(bookingIds: string[]) {
    if (!bookingIds.length) {
      setLatestMessageByBooking({});
      setSeenMessageByBooking({});
      return;
    }

    try {
      const res = await sb
        .from("booking_messages")
        .select("booking_id,sender_user_id,created_at")
        .in("booking_id", bookingIds)
        .order("created_at", { ascending: false })
        .limit(500);

      if (res.error) throw res.error;

      const latestMap: Record<string, LatestMessageMeta> = {};
      for (const row of ((res.data as any[]) || [])) {
        const bookingId = row.booking_id as string | undefined;
        if (!bookingId || latestMap[bookingId]) continue;
        latestMap[bookingId] = {
          bookingId,
          senderUserId: String(row.sender_user_id || ""),
          createdAt: String(row.created_at || ""),
        };
      }
      setLatestMessageByBooking(latestMap);

      if (me) {
        const seenMap: Record<string, string> = {};
        for (const bookingId of bookingIds) {
          const seenIso = readSeenIso(bookingId);
          if (seenIso) seenMap[bookingId] = seenIso;
        }
        setSeenMessageByBooking(seenMap);
      }
    } catch {
      setLatestMessageByBooking({});
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
          "id,bike_id,borrower_id,owner_id,booking_date,scheduled_start_at,cancelled,settled,completed,borrower_paid,owner_deposit_paid,needs_review,review_reason,tag_reason,created_at,borrower_checked_in,owner_checked_in,borrower_confirmed_complete,owner_confirmed_complete,cancelled_by,status,force_majeure_borrower_agreed_at,force_majeure_owner_agreed_at,borrower_checked_in_at,owner_checked_in_at,settlement_outcome,treat_as_borrower_no_show,treat_as_owner_no_show,test_taker_intro,time_window,registry_quadrant"
        )
        .eq("borrower_id", me)
        .order("created_at", { ascending: false });

      if (res.error) throw res.error;
      const nextRows = (((res.data as any) || []) as BookingRow[]);
      setRows(nextRows);
      await loadLatestMessageMeta(nextRows.map((row) => row.id));
    } catch (e: any) {
      setErr(e?.message || "Failed to load bookings");
      setRows([]);
    } finally {
      setLoading(false);
    }
  }

    useEffect(() => {
    if (!me) return;
    void load();

    const t = window.setInterval(() => {
      void load();
    }, 15000);

    return () => window.clearInterval(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [me]);

    useEffect(() => {
    if (!me) return;
    if (!rows.length) return;

    const bookingIds = new Set(rows.map((row) => row.id));

    const channel = sb
      .channel(`borrower-dashboard-messages:${me}`)
      .on(
        "postgres_changes",
        { event: "INSERT", schema: "public", table: "booking_messages" },
        (payload: any) => {
          const row = payload?.new as { booking_id?: string; sender_user_id?: string; created_at?: string } | undefined;
          const bookingId = row?.booking_id;
          if (!bookingId || !bookingIds.has(bookingId)) return;

          const nextCreatedAt = String(row?.created_at || "");
          const nextSenderUserId = String(row?.sender_user_id || "");

          setLatestMessageByBooking((prev) => {
            const current = prev[bookingId];
            if (current && new Date(current.createdAt).getTime() >= new Date(nextCreatedAt).getTime()) return prev;
            return {
              ...prev,
              [bookingId]: { bookingId, senderUserId: nextSenderUserId, createdAt: nextCreatedAt },
            };
          });

          if (openMsgId === bookingId && nextCreatedAt) {
            markMessagesSeen(bookingId, nextCreatedAt);
          }
        },
      )
      .subscribe();

    return () => {
      sb.removeChannel(channel);
    };
  }, [me, rows, openMsgId]);

  useEffect(() => {
    if (!me) return;

    for (const b of rows) {
      const borrowerChecked = hasBorrowerCheckedIn(b);
      if (borrowerChecked && !trackedBorrowerCheckIns.current[b.id]) {
        trackedBorrowerCheckIns.current[b.id] = true;
        trackEvent("borrower_checked_in", {
          booking_id: b.id,
          bike_id: b.bike_id,
          status: b.status ?? "",
          scheduled_start_at: scheduledIsoFor(b) ?? "",
        });
      }

      const borrowerCompleted = !!b.borrower_confirmed_complete;
      if (borrowerCompleted && !trackedBorrowerCompletions.current[b.id]) {
        trackedBorrowerCompletions.current[b.id] = true;
        trackEvent("booking_completed", {
          booking_id: b.id,
          bike_id: b.bike_id,
          role: "borrower",
          settlement_outcome: b.settlement_outcome ?? "",
          scheduled_start_at: scheduledIsoFor(b) ?? "",
        });
      }
    }
  }, [me, rows]);


  // Auto-expire bookings that missed the mentor acceptance window.
  // Backend truth: cancel-booking with cancelled_by="system_expired" will issue borrower credit when applicable.
  useEffect(() => {
    if (!me) return;
    if (!rows.length) return;

    const pending = rows.filter((b) => isPendingAcceptance(b) && !b.cancelled && !b.settled);
    for (const b of pending) {
      const scheduledIso = scheduledIsoFor(b);
      const deadline = acceptanceDeadlineMs({ createdAtIso: b.created_at ?? null, scheduledIso });
      if (deadline == null) continue;
      if (Date.now() <= deadline) continue;
      if (systemExpireInFlight[b.id]) continue;

      setSystemExpireInFlight((prev) => ({ ...prev, [b.id]: true }));

      void (async () => {
        try {
          await callFn("cancel-booking", { booking_id: b.id, cancelled_by: "system_expired" });
          await load();
        } catch {
          // Allow retry later (but avoid tight loops)
          setSystemExpireInFlight((prev) => {
            const next = { ...prev };
            delete next[b.id];
            return next;
          });
        }
      })();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [me, rows, systemExpireInFlight]);

  function openReview(b: BookingRow) {
    setReviewCtx({ bookingId: b.id, bikeId: b.bike_id, ownerId: b.owner_id });
    setReviewOpen(true);
  }

  async function cancelBookingAsBorrower(b: BookingRow) {
    // Cancel/forfeit is no longer available once either party has checked in.
    const borrowerChecked = hasBorrowerCheckedIn(b);
    const ownerChecked = hasOwnerCheckedIn(b);
    if (borrowerChecked || ownerChecked) {
      alert("Cancel/forfeit is disabled once either party has checked in.");
      return;
    }

    const keyword = cancelKeywordFor(b);
    const typed = prompt(`Type "${keyword}" to cancel this booking:`);
    if ((typed || "").trim().toUpperCase() !== keyword) return;

    setBusyId(b.id);
    setErr(null);
    try {
      await callFn("cancel-booking", { booking_id: b.id, cancelled_by: "borrower" });
      alert("Cancelled.");
      await load();
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
      trackEvent("borrower_check_in_clicked", { booking_id: b.id, bike_id: b.bike_id, scheduled_start_at: scheduledIsoFor(b) ?? "" });
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
      await callFn("complete-booking", { booking_id: b.id, role: "borrower" });
      trackEvent("booking_completed", { booking_id: b.id, bike_id: b.bike_id, role: "borrower", scheduled_start_at: scheduledIsoFor(b) ?? "" });
      trackedBorrowerCompletions.current[b.id] = true;
      await load();
    } catch (e: any) {
      setErr(e?.message || "Confirm completion failed");
    } finally {
      setBusyId(null);
    } 
  }

  async function claimNoShowAsTestTaker(b: BookingRow) {
    if (!me) return;
    if (noShowInFlight[b.id]) return;

    const ok = window.confirm(
    "Confirm mentor no-show?\n\nOnly use this if you checked in on time and the mentor did not arrive for the booking. If you continue, this booking will be settled under the owner no-show rules."
    );
    if (!ok) return;

    setNoShowInFlight((p: Record<string, boolean>) => ({ ...p, [b.id]: true }));
    try {
      await callFn("settle-booking", { booking_id: b.id, claim_no_show: true, claimant_role: "borrower" });
      trackEvent("no_show_claimed", { booking_id: b.id, bike_id: b.bike_id, claimant_role: "borrower", scheduled_start_at: scheduledIsoFor(b) ?? "" });
      await load();
    } catch (e: any) {
      alert(e?.message || "No-show claim failed");
    } finally {
      setNoShowInFlight((p: Record<string, boolean>) => ({ ...p, [b.id]: false }));
    }
  }


  const sorted = useMemo(() => rows, [rows]);
  const pending = sorted.filter((b) => isPendingAcceptance(b));
  const underReview = sorted.filter(
    (b) => b.needs_review && b.review_reason === "examiner_refusal" && !b.cancelled && !b.settled && !b.completed
  );
  const upcoming = sorted.filter(
    (b) => isConfirmedPaid(b) && !(b.needs_review && b.review_reason === "examiner_refusal")
  );
  const history = sorted.filter(
    (b) =>
      (b.cancelled || b.settled || b.completed || isPastScheduled(b)) &&
      !(b.needs_review && b.review_reason === "examiner_refusal")
  );

  const page: React.CSSProperties = { padding: "2rem" };

  const cardShell: React.CSSProperties = {
    border: "1px solid #e2e8f0",
    borderRadius: 18,
    padding: 16,
    background: "white",
    marginTop: 16,
  };

  const btnPrimary: React.CSSProperties = {
    padding: "10px 14px",
    borderRadius: 14,
    border: "1px solid #0f172a",
    background: "#0f172a",
    color: "white",
    fontWeight: 600,
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
    fontWeight: 600,
    cursor: "pointer",
    textDecoration: "none",
    color: "#0f172a",
    display: "inline-flex",
    alignItems: "center",
    gap: 8,
  };

    const newBadge: React.CSSProperties = {
    display: "inline-flex",
    alignItems: "center",
    marginLeft: 6,
    padding: "2px 8px",
    borderRadius: 999,
    border: "1px solid #fecaca",
    background: "#fff1f2",
    color: "#b00020",
    fontWeight: 800,
    fontSize: 12,
    lineHeight: 1.2,
  };

  // Lightweight onboarding card — push detailed education to Class6Loaner for SEO.
  const howItWorks = (
    <div style={{ ...cardShell, marginTop: 14 }}>
      <div style={{ fontWeight: 600, fontSize: 18 }}>New here?</div>
      <div style={{ marginTop: 8, color: "#475569", fontWeight: 600, lineHeight: 1.55, maxWidth: 920 }}>
        BorrowMyBike is built for registry road tests, not recreational rentals.
      </div>
      <div style={{ marginTop: 6, color: "#475569", fontWeight: 600, lineHeight: 1.55, maxWidth: 920 }}>
        For how it works, rules, and first-time test-taker guidance, see the Class6Loaner guide.
      </div>

      <div style={{ marginTop: 12, display: "flex", gap: 10, flexWrap: "wrap" }}>

       
        <a
          href="https://class6loaner.com/how-it-works"
          target="_blank"
          rel="noreferrer"
          style={btnSecondary}
        >
          How it works →
        </a>

      
      </div>
    </div>
  );

  const emptyState = (
    <div style={{ marginTop: 12 }}>
      <div style={{ color: "#0f172a", fontWeight: 600, fontSize: 16 }}>No bookings yet.</div>
      <div style={{ marginTop: 6, color: "#475569", fontWeight: 600, lineHeight: 1.55, maxWidth: 820 }}>
        That’s normal — many riders book registry tests weeks out. You can browse bikes now, and when you’re ready,
        request a booking for your appointment time.
      </div>

      <div style={{ marginTop: 12, display: "flex", gap: 10, flexWrap: "wrap" }}>
        <Link to="/browse" style={btnPrimary}>
          Browse bikes →
        </Link>
       
        <Link to="/legal" style={btnSecondary}>
          Policies →
        </Link>
      </div>

      <div style={{ marginTop: 12, color: "#64748b", fontWeight: 600, fontSize: 13 }}>
        Tip: When a booking is requested, the mentor has a limited acceptance window. If they don’t accept in time, you
        can quickly choose another bike.
      </div>
    </div>
  );

  // redirect guard — prevents dashboard render before redirect
if (!user) return null;

  return (
    <div style={page}>
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 12, flexWrap: "wrap" }}>
        <div>
          <div style={{ fontSize: 28, fontWeight: 600 }}>Test-Taker Dashboard</div>
          <div style={{ marginTop: 4, color: "#64748b", fontWeight: 600 }}>Your bookings + acceptance window.</div>
        </div>

        <div style={{ display: "flex", gap: 10, flexWrap: "wrap" }}>
          <Link to="/browse" style={{ fontWeight: 600 }}>
            Browse →
          </Link>
          <button
            style={{
              padding: "10px 12px",
              borderRadius: 14,
              border: "1px solid #cbd5e1",
              fontWeight: 600,
              cursor: "pointer",
              background: "white",
            }}
            onClick={load}
            disabled={loading}
          >
            {loading ? "Loading…" : "Refresh"}
          </button>
        </div>
      </div>

      {err && (
        <div style={{ marginTop: 12, padding: 12, borderRadius: 12, border: "1px solid #fecaca", background: "#fff1f2" }}>
          <div style={{ fontWeight: 600, color: "#b00020" }}>Error</div>
          <div style={{ marginTop: 6, color: "#7f1d1d", fontWeight: 600 }}>{err}</div>
        </div>
      )}

      {howItWorks}

      {/* Requests (pending mentor acceptance) */}
      <div style={cardShell}>
        <div style={{ fontWeight: 600, fontSize: 18 }}>Requests</div>
        <div style={{ marginTop: 6, color: "#475569", fontWeight: 600 }}>
          These are requests you’ve paid for that are waiting on mentor acceptance.
        </div>

        {loading ? (
          <div style={{ marginTop: 12, color: "#64748b", fontWeight: 600 }}>Loading…</div>
        ) : pending.length === 0 ? (
          <div style={{ marginTop: 12, color: "#64748b", fontWeight: 600 }}>No pending requests.</div>
        ) : (
          <div style={{ marginTop: 12 }}>
            {pending.map((b) => {
              const isBusy = busyId === b.id;
              const scheduledIso = scheduledIsoFor(b);
              const scheduledMs = scheduledIso ? new Date(scheduledIso).getTime() : NaN;
              const inPast = Number.isFinite(scheduledMs) && scheduledMs < Date.now();

              const hours = acceptanceHoursFor({ createdAtIso: b.created_at ?? null, scheduledIso });
              const deadline = acceptanceDeadlineMs({ createdAtIso: b.created_at ?? null, scheduledIso });

              return (
                <div key={b.id} style={{ border: "1px solid #e2e8f0", borderRadius: 16, padding: 14, marginTop: 10 }}>
                  <div style={{ fontWeight: 600 }}>Booking {shortId(b.id)}</div>
                  <div style={{ marginTop: 6, color: "#64748b", fontWeight: 600 }}>scheduled: {fmtDateTime(scheduledIso)}</div>

                  {inPast ? (
                    <div style={{ marginTop: 8, color: "#b00020", fontWeight: 600 }}>
                      This request is expired (scheduled time already passed).
                    </div>
                  ) : deadline ? (
                    <div style={{ marginTop: 8, color: "#64748b", fontWeight: 600, fontSize: 12 }}>
                      Accept window ({hours}h): <Countdown deadlineMs={deadline} />
                    </div>
                  ) : null}

                  <div style={{ marginTop: 10, color: "#475569", fontWeight: 600 }}>
                    If the mentor doesn’t accept in time, you can quickly choose another bike.
                  </div>


                  {/* Force Majeure (discreet) — 24h before start, only before anyone checks in */}
                  {(() => {
                    const iso = scheduledIsoFor(b);
                    const startMs = typeof iso === "string" ? new Date(iso).getTime() : NaN;
                    const nowMs = Date.now();
                    const within2h =
                      Number.isFinite(startMs) && nowMs >= startMs - 2 * 60 * 60 * 1000 && nowMs <= startMs;
                    const fmBorrower = (b as any).force_majeure_borrower_agreed_at as string | null | undefined;
                    const fmOwner = (b as any).force_majeure_owner_agreed_at as string | null | undefined;

                    const bothPaidConfirmed =
                      !!b.borrower_paid && !!b.owner_deposit_paid && b.status === "confirmed" && !b.cancelled;


                    const borrowerChecked = hasBorrowerCheckedIn(b);
                    const ownerChecked = hasOwnerCheckedIn(b);

                    const scheduledMs = typeof iso === "string" ? new Date(iso).getTime() : NaN;
                    const withinExaminerRefusalWindow =
                      Number.isFinite(scheduledMs) && isWithin(Date.now(), scheduledMs, scheduledMs + 10 * 60 * 1000);

                    const showFm =
                      bothPaidConfirmed && within2h && !borrowerChecked && !ownerChecked && !b.settled && !b.completed;

                    const showExaminerRefusal =
                      bothPaidConfirmed &&
                      borrowerChecked &&
                      ownerChecked &&
                      withinExaminerRefusalWindow &&
                      !b.settled &&
                      !b.completed &&
                      !b.cancelled;

                    if (!showFm && !(fmBorrower || fmOwner) && !showExaminerRefusal) return null;

                    return (
                      <div style={{ marginTop: 10 }}>
                        {showFm ? (
                          <button
                            onClick={() => requestForceMajeureAsBorrower(b)}
                            disabled={isBusy || !!fmInFlight[b.id] || !!fmBorrower}
                            style={{
                              padding: "8px 12px",
                              borderRadius: 12,
                              border: "1px solid #cbd5e1",
                              background: "white",
                              fontWeight: 700,
                              cursor: "pointer",
                              opacity: isBusy || !!fmInFlight[b.id] || !!fmBorrower ? 0.6 : 1,
                            }}
                            title="Weather/registry reschedule (no penalties). Requires both parties to agree."
                          >
                            {fmBorrower ? "FM requested" : fmInFlight[b.id] ? "…" : "Weather / FM"}
                          </button>
                        ) : null}

                        {showExaminerRefusal ? (
                          <button
                            onClick={() => { setRefusalOpenId(b.id); setRefusalReason(""); setRefusalNote(""); }}
                            disabled={examinerRefusalInFlight[b.id]}
                            title="Examiner refused the road test. Only use this when BOTH parties have checked in and the examiner/registry refuses the test at the scheduled start time."
                            style={{
                              padding: "10px 14px",
                              borderRadius: 14,
                              border: "1px solid #cbd5e1",
                              background: "white",
                              fontWeight: 800,
                              cursor: "pointer",
                              opacity: examinerRefusalInFlight[b.id] ? 0.6 : 1,
                            }}
                          >
                            {examinerRefusalInFlight[b.id] ? "Submitting…" : "Examiner refused"}
                          </button>
                        ) : null}

                        {refusalOpenId === b.id ? (
                          <div style={{ marginTop: 10, border: "1px solid #e2e8f0", borderRadius: 14, padding: 12, background: "#fff" }}>
                            <div style={{ fontWeight: 700, fontSize: 15 }}>Examiner refuses test</div>
                            <div style={{ marginTop: 6, color: "#475569", fontWeight: 600, fontSize: 13 }}>
                              This flags the booking for review. It does not auto-settle the booking.
                            </div>
                            <div style={{ marginTop: 10, display: "grid", gap: 8 }}>
                              <label style={{ display: "flex", gap: 8, alignItems: "center" }}>
                                <input type="radio" name={`borrower-refusal-${b.id}`} checked={refusalReason === "motorcycle_issue"} onChange={() => setRefusalReason("motorcycle_issue")} />
                                <span>Issue with the motorcycle</span>
                              </label>
                              <label style={{ display: "flex", gap: 8, alignItems: "center" }}>
                                <input type="radio" name={`borrower-refusal-${b.id}`} checked={refusalReason === "not_ready"} onChange={() => setRefusalReason("not_ready")} />
                                <span>Test-taker not ready today</span>
                              </label>
                              <label style={{ display: "flex", gap: 8, alignItems: "center" }}>
                                <input type="radio" name={`borrower-refusal-${b.id}`} checked={refusalReason === "registry_reschedule"} onChange={() => setRefusalReason("registry_reschedule")} />
                                <span>Registry rescheduled / examiner unavailable</span>
                              </label>
                              <label style={{ display: "flex", gap: 8, alignItems: "center" }}>
                                <input type="radio" name={`borrower-refusal-${b.id}`} checked={refusalReason === "weather_conditions"} onChange={() => setRefusalReason("weather_conditions")} />
                                <span>Weather / road conditions</span>
                              </label>
                              <label style={{ display: "flex", gap: 8, alignItems: "center" }}>
                                <input type="radio" name={`borrower-refusal-${b.id}`} checked={refusalReason === "other"} onChange={() => setRefusalReason("other")} />
                                <span>Other</span>
                              </label>
                            </div>
                            <textarea
                              value={refusalNote}
                              onChange={(e) => setRefusalNote(e.target.value)}
                              placeholder="Optional note for review"
                              rows={3}
                              style={{ marginTop: 10, width: "100%", border: "1px solid #cbd5e1", borderRadius: 12, padding: 10, font: "inherit" }}
                            />
                            <div style={{ marginTop: 10, display: "flex", gap: 8, flexWrap: "wrap" }}>
                              <button
                                onClick={() => requestExaminerRefusalAsBorrower(b)}
                                disabled={examinerRefusalInFlight[b.id] || !refusalReason}
                                style={{ padding: "10px 14px", borderRadius: 12, border: "1px solid #0f172a", background: "#0f172a", color: "white", fontWeight: 800, cursor: "pointer", opacity: examinerRefusalInFlight[b.id] || !refusalReason ? 0.6 : 1 }}
                              >
                                {examinerRefusalInFlight[b.id] ? "Submitting…" : "Submit for review"}
                              </button>
                              <button
                                onClick={() => { setRefusalOpenId(null); setRefusalReason(""); setRefusalNote(""); }}
                                style={{ padding: "10px 14px", borderRadius: 12, border: "1px solid #cbd5e1", background: "white", fontWeight: 700, cursor: "pointer" }}
                              >
                                Cancel
                              </button>
                            </div>
                          </div>
                        ) : null}


                        {(fmBorrower || fmOwner) ? (
                          <div style={{ marginTop: 6, color: "#64748b", fontWeight: 700, fontSize: 12 }}>
                            {fmBorrower && fmOwner
                              ? "Force majeure confirmed by both parties."
                              : fmBorrower
                              ? "FM requested — waiting for mentor to confirm."
                              : "Mentor requested FM — you can confirm in this booking."}
                          </div>
                        ) : null}
                      </div>
                    );
                  })()}

                  <div style={{ marginTop: 12, display: "flex", gap: 10, flexWrap: "wrap" }}>
                    <Link to="/browse" style={btnPrimary}>
                      Browse bikes →
                    </Link>


                    {!(hasBorrowerCheckedIn(b) || hasOwnerCheckedIn(b)) ? (
                    <button
                      onClick={() => cancelBookingAsBorrower(b)}
                      disabled={isBusy}
                      title={cancelTitleFor(b)}
                      style={{
                        padding: "10px 14px",
                        borderRadius: 14,
                        border: "1px solid #cbd5e1",
                        background: "white",
                        fontWeight: 600,
                        cursor: "pointer",
                        opacity: isBusy ? 0.7 : 1,
                      }}
                    >
                      {isBusy ? "…" : cancelButtonLabelFor(b)}
                    </button>
                    ) : null}
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </div>


      {/* Under Review */}
      <div style={cardShell}>
        <div style={{ fontWeight: 600, fontSize: 18 }}>Under Review</div>
        <div style={{ marginTop: 6, color: "#475569", fontWeight: 600 }}>
          Examiner-refusal bookings live here while support reviews the information provided by both parties.
        </div>

        {underReview.length === 0 ? (
          <div style={{ marginTop: 12, color: "#64748b", fontWeight: 600 }}>No bookings under review.</div>
        ) : (
          <div style={{ marginTop: 12 }}>
            {underReview.map((b) => {
              const borrowerChecked = hasBorrowerCheckedIn(b);
              const ownerChecked = hasOwnerCheckedIn(b);
              const borrowerConfirmed = !!b.borrower_confirmed_complete;
              const ownerPossession = !!b.owner_confirmed_complete;
              const messagesAllowed = !!b.borrower_paid && !!b.owner_deposit_paid && b.status === "confirmed" && !b.cancelled;

              return (
                <div key={b.id} style={{ border: "1px solid #e2e8f0", borderRadius: 16, padding: 14, marginTop: 10 }}>
                  <div style={{ fontWeight: 600 }}>Booking {shortId(b.id)}</div>
                  <div style={{ marginTop: 6, color: "#64748b", fontWeight: 600 }}>
                    scheduled: {fmtDateTime(scheduledIsoFor(b))} • bike: {shortId(b.bike_id)}
                  </div>

                  <div style={{ marginTop: 10, fontWeight: 600, color: "#0f172a" }}>
                    Your check-in: {borrowerChecked ? "✅" : "—"} <span style={{ marginLeft: 10 }} />
                    Mentor check-in: {ownerChecked ? "✅" : "—"} <span style={{ marginLeft: 10 }} />
                    Your completion: {borrowerConfirmed ? "✅" : "—"} <span style={{ marginLeft: 10 }} />
                    Mentor possession: {ownerPossession ? "✅" : "—"}
                  </div>

                  <div style={{ marginTop: 10, color: "#7c2d12", fontWeight: 700, fontSize: 13, lineHeight: 1.55, maxWidth: 760 }}>
                    This booking is under review after an examiner refusal. No further in-app actions are required while support reviews the information from both parties. If needed, email support with any extra details.
                  </div>

                  <div style={{ marginTop: 12, display: "flex", gap: 10, flexWrap: "wrap" }}>
                    {messagesAllowed ? (
                      <button
                        onClick={() => setOpenMsgId((cur) => (cur === b.id ? null : b.id))}
                        style={{
                          padding: "10px 14px",
                          borderRadius: 14,
                          border: "1px solid #cbd5e1",
                          background: "white",
                          fontWeight: 600,
                          cursor: "pointer",
                        }}
                      >
                        {openMsgId === b.id ? (
                          "Hide messages"
                        ) : hasUnreadMessages(b.id) ? (
                          <>
                            Messages <span style={newBadge}>New</span>
                          </>
                        ) : (
                          "Messages"
                        )}
                      </button>
                    ) : null}
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
                       meId={b.borrower_id}
                       otherUserId={b.owner_id}
                       otherLabel="Mentor"
                       onMarkSeen={(latestIso) => markMessagesSeen(b.id, latestIso)}
                     />
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        )}
      </div>

      {/* Upcoming / Confirmed */}
      <div style={cardShell}>
        <div style={{ fontWeight: 600, fontSize: 18 }}>Upcoming / Confirmed</div>
        <div style={{ marginTop: 6, color: "#475569", fontWeight: 600 }}>These are accepted bookings (both paid).</div>

        {upcoming.length === 0 ? (
          <div style={{ marginTop: 12, color: "#64748b", fontWeight: 600 }}>{sorted.length ? "No upcoming bookings." : emptyState}</div>
        ) : (
          <div style={{ marginTop: 12 }}>
            {upcoming.map((b) => {
              const isBusy = busyId === b.id;
                  const messagesAllowed = !!b.borrower_paid && !!b.owner_deposit_paid && b.status === "confirmed" && !b.cancelled;


              const ownerChecked = hasOwnerCheckedIn(b);
              const borrowerChecked = hasBorrowerCheckedIn(b);
              const borrowerConfirmed = !!b.borrower_confirmed_complete;
              const ownerPossession = !!b.owner_confirmed_complete;

              const w = checkInWindowFor(b);
              const now = Date.now();
              const checkInOpen = w ? isWithin(now, w.openMs, w.closeMs) : false;

              const comp = completionAllowedAtFor(b);
              const canConfirmTime = comp ? now >= comp.allowedAtMs : false;

              const canComplete =
                !borrowerConfirmed &&
                canConfirmTime &&
                borrowerChecked &&
                ownerChecked &&
                !b.cancelled &&
                !b.completed;

              const hideCancel = borrowerChecked || ownerChecked;

              const canReview = b.completed && b.settled && !b.cancelled && !b.needs_review;

              return (
                <div key={b.id} style={{ border: "1px solid #e2e8f0", borderRadius: 16, padding: 14, marginTop: 10 }}>
                  <div style={{ fontWeight: 600 }}>Booking {shortId(b.id)}</div>
                  <div style={{ marginTop: 6, color: "#64748b", fontWeight: 600 }}>
                    scheduled: {fmtDateTime(scheduledIsoFor(b))} • bike: {shortId(b.bike_id)}
                  </div>

                  <div style={{ marginTop: 10, fontWeight: 600, color: "#0f172a" }}>
                    Your check-in: {borrowerChecked ? "✅" : "—"} <span style={{ marginLeft: 10 }} />
                    Mentor check-in: {ownerChecked ? "✅" : "—"} <span style={{ marginLeft: 10 }} />
                    Your completion: {borrowerConfirmed ? "✅" : "—"} <span style={{ marginLeft: 10 }} />
                    Mentor possession: {ownerPossession ? "✅" : "—"}
                  </div>

                  {b.needs_review && b.review_reason === "examiner_refusal" ? (
                    <div style={{ marginTop: 10, color: "#7c2d12", fontWeight: 700, fontSize: 13 }}>
                      This booking has been flagged for review after an examiner refusal. If needed, email support with any extra details.
                    </div>
                  ) : null}

                  <div style={{ marginTop: 10, color: "#475569", fontWeight: 600, fontSize: 13 }}>
                    Tip: both parties must check in before you can confirm completion.{' '}
                    {comp && !canConfirmTime ? (
                      <>Completion unlocks at <b>{fmtDateTime(new Date(comp.allowedAtMs).toISOString())}</b>.</>
                    ) : null}
                  </div>


                  {/* Force Majeure (discreet) — 24h before start, only before anyone checks in */}
                  {(() => {
  const iso = scheduledIsoFor(b);
  const startMs = typeof iso === "string" ? new Date(iso).getTime() : NaN;
  const nowMs = Date.now();

  const fmBorrower = (b as any).force_majeure_borrower_agreed_at as string | null | undefined;
  const fmOwner = (b as any).force_majeure_owner_agreed_at as string | null | undefined;

  const bothPaidConfirmed =
    !!b.borrower_paid && !!b.owner_deposit_paid && b.status === "confirmed" && !b.cancelled;

  const withinFmWindow =
    Number.isFinite(startMs) &&
    nowMs >= startMs - 2 * 60 * 60 * 1000 &&
    nowMs <= startMs;

  const withinExaminerRefusalWindow =
    Number.isFinite(startMs) &&
    nowMs >= startMs &&
    nowMs <= startMs + 10 * 60 * 1000;

  const showFm =
    bothPaidConfirmed &&
    withinFmWindow &&
    !borrowerChecked &&
    !ownerChecked &&
    !b.settled &&
    !b.completed;

  const showExaminerRefusal =
    bothPaidConfirmed &&
    borrowerChecked &&
    ownerChecked &&
    withinExaminerRefusalWindow &&
    !b.settled &&
    !b.completed &&
    !b.cancelled;

  if (!showFm && !(fmBorrower || fmOwner) && !showExaminerRefusal) return null;

  return (
    <div style={{ marginTop: 10 }}>
      {showFm ? (
        <button
          onClick={() => requestForceMajeureAsBorrower(b)}
          disabled={isBusy || !!fmInFlight[b.id] || !!fmBorrower}
          style={{
            padding: "8px 12px",
            borderRadius: 12,
            border: "1px solid #cbd5e1",
            background: "white",
            fontWeight: 700,
            cursor: "pointer",
            opacity: isBusy || !!fmInFlight[b.id] || !!fmBorrower ? 0.6 : 1,
          }}
          title="Weather/registry reschedule (no penalties). Requires both parties to agree."
        >
          {fmBorrower ? "FM requested" : fmInFlight[b.id] ? "…" : "Weather / FM"}
        </button>
      ) : null}

      {showExaminerRefusal ? (
        <button
          onClick={() => { setRefusalOpenId(b.id); setRefusalReason(""); setRefusalNote(""); }}
          disabled={examinerRefusalInFlight[b.id]}
          title="Examiner refused the road test. Only use this when BOTH parties have checked in and the examiner/registry refuses the test at the scheduled start time."
          style={{
            padding: "10px 14px",
            borderRadius: 14,
            border: "1px solid #cbd5e1",
            background: "white",
            fontWeight: 800,
            cursor: "pointer",
            opacity: examinerRefusalInFlight[b.id] ? 0.6 : 1,
          }}
        >
          {examinerRefusalInFlight[b.id] ? "Submitting…" : "Examiner refused"}
        </button>
      ) : null}

                        {refusalOpenId === b.id ? (
                          <div style={{ marginTop: 10, border: "1px solid #e2e8f0", borderRadius: 14, padding: 12, background: "#fff" }}>
                            <div style={{ fontWeight: 700, fontSize: 15 }}>Examiner refuses test</div>
                            <div style={{ marginTop: 6, color: "#475569", fontWeight: 600, fontSize: 13 }}>
                              This flags the booking for review. It does not auto-settle the booking.
                            </div>
                            <div style={{ marginTop: 10, display: "grid", gap: 8 }}>
                              <label style={{ display: "flex", gap: 8, alignItems: "center" }}>
                                <input type="radio" name={`borrower-refusal-${b.id}`} checked={refusalReason === "motorcycle_issue"} onChange={() => setRefusalReason("motorcycle_issue")} />
                                <span>Issue with the motorcycle</span>
                              </label>
                              <label style={{ display: "flex", gap: 8, alignItems: "center" }}>
                                <input type="radio" name={`borrower-refusal-${b.id}`} checked={refusalReason === "not_ready"} onChange={() => setRefusalReason("not_ready")} />
                                <span>Test-taker not ready today</span>
                              </label>
                              <label style={{ display: "flex", gap: 8, alignItems: "center" }}>
                                <input type="radio" name={`borrower-refusal-${b.id}`} checked={refusalReason === "registry_reschedule"} onChange={() => setRefusalReason("registry_reschedule")} />
                                <span>Registry rescheduled / examiner unavailable</span>
                              </label>
                              <label style={{ display: "flex", gap: 8, alignItems: "center" }}>
                                <input type="radio" name={`borrower-refusal-${b.id}`} checked={refusalReason === "weather_conditions"} onChange={() => setRefusalReason("weather_conditions")} />
                                <span>Weather / road conditions</span>
                              </label>
                              <label style={{ display: "flex", gap: 8, alignItems: "center" }}>
                                <input type="radio" name={`borrower-refusal-${b.id}`} checked={refusalReason === "other"} onChange={() => setRefusalReason("other")} />
                                <span>Other</span>
                              </label>
                            </div>
                            <textarea
                              value={refusalNote}
                              onChange={(e) => setRefusalNote(e.target.value)}
                              placeholder="Optional note for review"
                              rows={3}
                              style={{ marginTop: 10, width: "100%", border: "1px solid #cbd5e1", borderRadius: 12, padding: 10, font: "inherit" }}
                            />
                            <div style={{ marginTop: 10, display: "flex", gap: 8, flexWrap: "wrap" }}>
                              <button
                                onClick={() => requestExaminerRefusalAsBorrower(b)}
                                disabled={examinerRefusalInFlight[b.id] || !refusalReason}
                                style={{ padding: "10px 14px", borderRadius: 12, border: "1px solid #0f172a", background: "#0f172a", color: "white", fontWeight: 800, cursor: "pointer", opacity: examinerRefusalInFlight[b.id] || !refusalReason ? 0.6 : 1 }}
                              >
                                {examinerRefusalInFlight[b.id] ? "Submitting…" : "Submit for review"}
                              </button>
                              <button
                                onClick={() => { setRefusalOpenId(null); setRefusalReason(""); setRefusalNote(""); }}
                                style={{ padding: "10px 14px", borderRadius: 12, border: "1px solid #cbd5e1", background: "white", fontWeight: 700, cursor: "pointer" }}
                              >
                                Cancel
                              </button>
                            </div>
                          </div>
                        ) : null}


      {(fmBorrower || fmOwner) ? (
        <div style={{ marginTop: 6, color: "#64748b", fontWeight: 700, fontSize: 12 }}>
          {fmBorrower && fmOwner
            ? "Force majeure confirmed by both parties."
            : fmBorrower
            ? "FM requested — waiting for mentor to confirm."
            : "Mentor requested FM — you can confirm in this booking."}
        </div>
      ) : null}
    </div>
  );
})()}

                  <div style={{ marginTop: 12, display: "flex", gap: 10, flexWrap: "wrap" }}>
                    {(borrowerChecked || checkInOpen) && (
                    <button
                      onClick={() => checkInAsTestTaker(b)}
                      disabled={isBusy || borrowerChecked || !checkInOpen}
                      title={
                        borrowerChecked
                          ? "You are checked in ✅"
                          : checkInOpen
                          ? "Check in when you arrive at the registry."
                          : "Check-in opens 15 minutes before start."
                      }
                      style={{
                        padding: "10px 14px",
                        borderRadius: 14,
                        border: "1px solid #cbd5e1",
                        background: borrowerChecked ? "#f8fafc" : "white",
                        fontWeight: 600,
                        cursor: "pointer",
                        opacity: isBusy || borrowerChecked || !checkInOpen ? 0.6 : 1,
                      }}
                    >
                      {borrowerChecked ? "Checked in" : "Check in"}
                    </button>
                  )}

                    {(borrowerConfirmed || canComplete) && (
                    <button
                      onClick={() => confirmTestCompleted(b)}
                      disabled={isBusy || !canComplete}
                      title={
                        borrowerConfirmed
                          ? "Already confirmed ✅"
                          : !borrowerChecked || !ownerChecked
                          ? "Both parties must check in first."
                          : comp && !canConfirmTime
                          ? `Available at ${fmtDateTime(new Date(comp.allowedAtMs).toISOString())}`
                          : "Confirm your road test is completed."
                      }
                      style={{
                        padding: "10px 14px",
                        borderRadius: 14,
                        border: "1px solid #0f172a",
                        background: "#0f172a",
                        color: "white",
                        fontWeight: 600,
                        cursor: "pointer",
                        opacity: isBusy || !canComplete ? 0.6 : 1,
                      }}
                    >
                      {borrowerConfirmed ? "Completion confirmed" : "Confirm test completed"}
                    </button>
                    )}


                    {messagesAllowed ? (
                    <button
                      onClick={() => setOpenMsgId((cur) => (cur === b.id ? null : b.id))}
                      disabled={isBusy}
                      title="Message the mentor about timing, meeting spot, safety questions, etc."
                      style={{
                        padding: "10px 14px",
                        borderRadius: 14,
                        border: "1px solid #cbd5e1",
                        background: "white",
                        fontWeight: 600,
                        cursor: "pointer",
                        opacity: isBusy ? 0.6 : 1,
                      }}
                    >
                       {openMsgId === b.id ? (
                         "Hide messages"
                       ) : hasUnreadMessages(b.id) ? (
                         <>
                           Messages <span style={newBadge}>New</span>
                         </>
                       ) : (
                           "Messages"
                        )}                    
                      </button>
                  ) : (
                    <div style={{ color: "#64748b", fontWeight: 700, fontSize: 12 }}>
                      Messages unlock once the booking is confirmed (both paid).
                    </div>
                  )}

                  {(() => {
                    const iso = scheduledIsoFor(b);
                    const startMs = typeof iso === "string" ? new Date(iso).getTime() : NaN;
                    const nowMs = Date.now();

                    const bothPaidConfirmed =
                      !!b.borrower_paid && !!b.owner_deposit_paid && b.status === "confirmed" && !b.cancelled;

                    // Shows 10 min after start; becomes clickable at 10 min (matches backend truth).
                    const showAtMs = Number.isFinite(startMs) ? startMs + 10 * 60 * 1000 : NaN;
                    const enableAtMs = Number.isFinite(startMs) ? startMs + 10 * 60 * 1000 : NaN;

                    const eligible =
                      bothPaidConfirmed &&
                      borrowerChecked &&
                      !ownerChecked &&
                      !b.settled &&
                      !b.completed &&
                      Number.isFinite(showAtMs) &&
                      nowMs >= showAtMs;

                    if (!eligible) return null;

                    const enabled = Number.isFinite(enableAtMs) && nowMs >= enableAtMs;

                    return (
                      <button
                        onClick={() => claimNoShowAsTestTaker(b)}
                        disabled={isBusy || !enabled || !!noShowInFlight[b.id]}
                        title={
                          enabled
                            ? "Claim no-show (mentor did not check in)."
                            : "Available 10 minutes after the scheduled start time."
                        }
                        style={{
                          padding: "10px 14px",
                          borderRadius: 14,
                          border: "1px solid #cbd5e1",
                          background: "white",
                          fontWeight: 600,
                          cursor: "pointer",
                          opacity: isBusy || !enabled || !!noShowInFlight[b.id] ? 0.6 : 1,
                        }}
                      >
                        {noShowInFlight[b.id] ? "…" : "Claim no-show"}
                      </button>
                    );
                  })()}


                    {!hideCancel ? (
                      <button
                        onClick={() => cancelBookingAsBorrower(b)}
                        disabled={isBusy}
                        title={cancelTitleFor(b)}
                        style={{
                          padding: "10px 14px",
                          borderRadius: 14,
                          border: "1px solid #cbd5e1",
                          background: "white",
                          fontWeight: 600,
                          cursor: "pointer",
                          opacity: isBusy ? 0.6 : 1,
                        }}
                      >
                        {isBusy ? "…" : cancelButtonLabelFor(b)}
                      </button>
                    ) : null}

                    {canReview ? (
                      <button
                        style={{
                          padding: "10px 14px",
                          borderRadius: 14,
                          border: "1px solid #0f172a",
                          background: "#0f172a",
                          color: "white",
                          fontWeight: 600,
                          cursor: "pointer",
                        }}
                        onClick={() => openReview(b)}
                      >
                        Rate mentor/bike
                      </button>
                    ) : null}
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
                      meId={b.borrower_id}
                      otherUserId={b.owner_id}
                      otherLabel="Mentor"
                      onMarkSeen={(latestIso) => markMessagesSeen(b.id, latestIso)}
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
      <div style={cardShell}>
        <div style={{ fontWeight: 600, fontSize: 18 }}>History</div>
        <div style={{ marginTop: 6, color: "#475569", fontWeight: 600 }}>
          Past/expired/cancelled bookings live here so "Requests" stays clean.
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

                  const state = bookingStateLabel(b);

                  return (
                    <tr key={b.id} style={{ borderTop: "1px solid #e2e8f0" }}>
                      <td style={{ padding: "10px 0", fontWeight: 600 }}>{shortId(b.id)}</td>
                      <td style={{ padding: "10px 0", fontWeight: 600 }}>{fmtDateTime(whenIso)}</td>
                      <td style={{ padding: "10px 0", fontWeight: 600 }}>{state}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {canShowReview && (
        <ReviewModal
          open={reviewOpen}
          onClose={() => setReviewOpen(false)}
          bookingId={reviewCtx!.bookingId}
          bikeId={reviewCtx!.bikeId}
          ownerId={reviewCtx!.ownerId}
          onSaved={async () => {
            setReviewOpen(false);
            await load();
          }}
        />
      )}
    </div>
  );
}
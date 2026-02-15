// src/pages/RequestBooking.tsx
import { useEffect, useMemo, useState } from "react";
import { Link, useNavigate, useParams } from "react-router-dom";
import { sb } from "../lib/supabase";
import { useAuth } from "../auth/useAuth";
import ChecklistGateModal from "../components/ChecklistGateModal";
import type { ChecklistItem } from "../components/ChecklistGateModal";
import { isProvinceEnabled, provinceName } from "../lib/provinces";

type BikeRow = {
  id: string;
  owner_id: string | null;
  make?: string | null;
  model?: string | null;
  year?: number | null;
  city?: string | null;
  province?: string | null;
};

function isoWithTzFromLocalDatetime(local: string) {
  const d = new Date(local);
  if (isNaN(d.getTime())) return null;
  return d.toISOString();
}

function Modal(props: { open: boolean; title: string; onClose: () => void; children: React.ReactNode }) {
  if (!props.open) return null;
  return (
    <div
      role="dialog"
      aria-modal="true"
      onClick={props.onClose}
      style={{
        position: "fixed",
        inset: 0,
        background: "rgba(15,23,42,0.55)",
        zIndex: 9999,
        display: "grid",
        placeItems: "center",
        padding: 14,
      }}
    >
      <div
        onClick={(e) => e.stopPropagation()}
        style={{
          width: "min(780px, 100%)",
          background: "white",
          borderRadius: 18,
          border: "1px solid rgba(0,0,0,0.10)",
          boxShadow: "0 24px 60px rgba(0,0,0,0.22)",
          padding: 16,
        }}
      >
        <div style={{ display: "flex", justifyContent: "space-between", gap: 12, alignItems: "center" }}>
          <div style={{ fontWeight: 1000, fontSize: 18, color: "#0f172a" }}>{props.title}</div>
          <button
            onClick={props.onClose}
            style={{
              border: "1px solid #e2e8f0",
              background: "white",
              borderRadius: 12,
              padding: "6px 10px",
              cursor: "pointer",
              fontWeight: 900,
              color: "#0f172a",
            }}
          >
            Close
          </button>
        </div>

        <div style={{ marginTop: 12, color: "#0f172a", fontWeight: 750, lineHeight: 1.45 }}>{props.children}</div>
      </div>
    </div>
  );
}

async function invokeBookingCreate(
  fnName: string,
  body: {
    borrower_id: string;
    owner_id: string;
    bike_id: string;
    booking_date: string;
    scheduled_start_at: string;
    duration_minutes: number;
    registry_id: string | null;
  }
) {
  const { data, error } = await sb.functions.invoke(fnName, { body });
  return { data: data as any, error };
}

function looksLikeMissingFunction(msg: string) {
  const m = (msg || "").toLowerCase();
  return (
    m.includes("not found") ||
    m.includes("no such function") ||
    (m.includes("function") && m.includes("missing")) ||
    m.includes("404") ||
    m.includes("unknown function") ||
    (m.includes("edge function") && m.includes("not"))
  );
}

export default function RequestBooking() {
  const { user } = useAuth();
  const me = user?.id ?? null;

  const nav = useNavigate();
  const { id } = useParams();
  const bikeId = id ?? "";

  const [bike, setBike] = useState<BikeRow | null>(null);
  const [loadingBike, setLoadingBike] = useState(false);

  const [whenLocal, setWhenLocal] = useState<string>(() => {
    const d = new Date(Date.now() + 24 * 60 * 60 * 1000);
    const pad = (n: number) => String(n).padStart(2, "0");
    const yyyy = d.getFullYear();
    const mm = pad(d.getMonth() + 1);
    const dd = pad(d.getDate());
    const hh = pad(d.getHours());
    const mi = pad(d.getMinutes());
    return `${yyyy}-${mm}-${dd}T${hh}:${mi}`;
  });

  const [timeWindow, setTimeWindow] = useState<"" | "morning" | "early_afternoon" | "late_afternoon">("");
  const [registryQuadrant, setRegistryQuadrant] = useState<"" | "NE" | "NW" | "SE" | "SW">("");
  const [testTakerIntro, setTestTakerIntro] = useState<string>("");

  const [submitting, setSubmitting] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [okMsg, setOkMsg] = useState<string | null>(null);

  const [checklistOpen, setChecklistOpen] = useState(false);
  const [policyOpen, setPolicyOpen] = useState(false);

  const title = useMemo(() => {
    if (!bike) return "Request booking";
    const label = [bike.year, bike.make, bike.model].filter(Boolean).join(" ");
    return label.length ? `Request booking: ${label}` : "Request booking";
  }, [bike]);

  const provinceBlocked = useMemo(() => {
    const p = bike?.province || null;
    return p ? !isProvinceEnabled(p) : false;
  }, [bike?.province]);

  const blockedProvinceName = useMemo(() => {
    const p = bike?.province || "";
    return p ? provinceName(p) : "this province";
  }, [bike?.province]);

  useEffect(() => {
    async function loadBike() {
      if (!bikeId) return;
      setErr(null);
      setLoadingBike(true);

      const res = await sb
        .from("bikes")
        .select("id,owner_id,make,model,year,city,province")
        .eq("id", bikeId)
        .maybeSingle();

      if (res.error) {
        setErr(res.error.message);
        setBike(null);
      } else {
        setBike((res.data as any) ?? null);
        if (!res.data) setErr("Bike not found.");
      }

      setLoadingBike(false);
    }
    loadBike();
  }, [bikeId]);

  const borrowerChecklist: ChecklistItem[] = useMemo(
    () => [
      {
        id: "not_rental",
        label: (
          <>
            I understand this is <strong>not a rental</strong>. This booking compensates a local mentor for time, fuel,
            and admin — <strong>strictly for registry road tests</strong>.
          </>
        ),
      },
      {
        id: "helmet",
        label: (
          <>
            I will arrive with, at minimum, a <strong>proper motorcycle helmet</strong>.
          </>
        ),
      },
      {
        id: "hands_free",
        label: (
          <>
            I will bring a <strong>cell phone</strong> and <strong>hands-free audio</strong> (Bluetooth or wired earbuds) for directions
            (AB rules for now).
          </>
        ),
      },
      { id: "arrive_early", label: <>I will arrive <strong>10–15 minutes early</strong> and be ready to start on time.</> },
      {
        id: "registry_docs",
        label: (
          <>
            I will bring required <strong>ID / licence documents</strong> for my registry (requirements vary by province/registry).
          </>
        ),
      },
      {
        id: "rules_ack",
        label: (
          <>
            I have read and understand the <strong>Rules &amp; Process</strong> (cancellations, forfeitures, fault scenarios, and force-majeure).
            I won’t say “I didn’t know.”
            {" "}
            <Link to="/legal" style={{ fontWeight: 950 }}>View rules →</Link>
          </>
        ),
      },
      {
        id: "cancel_policy_ack",
        label: (
          <>
            I understand cancellations after acceptance are strict:
            {" "}
            <strong>Early</strong> cancel is <strong>more than 5 days</strong> before the test (25% admin fee).
            {" "}
            <strong>Late</strong> cancel is <strong>5 days or less</strong> (including day 5) and can result in <strong>100% forfeiture</strong>.
          </>
        ),
      },
      {
        id: "borrower_fault_forfeit",
        label: (
          <>
            If the test cannot proceed due to <strong>test-taker fault</strong> (no helmet, no hands-free, late/no-show, unfit to ride),
            I <strong>forfeit</strong> the booking fee.
          </>
        ),
      },
    ],
    []
  );

  async function submitRequest() {
    setErr(null);
    setOkMsg(null);

    if (!me) return setErr("Please sign in first.");
    if (!bikeId) return setErr("Missing bike id in URL.");
    if (!bike?.owner_id) return setErr("This bike is missing an owner_id in the database.");
    if (provinceBlocked) return setErr(`Bookings are not available in ${blockedProvinceName} yet.`);


    if (!registryQuadrant) return setErr("Please select the registry area (NE / NW / SE / SW).");
    if (!testTakerIntro.trim()) return setErr("Please write a short intro (shown to the mentor).");

    const whenIso = isoWithTzFromLocalDatetime(whenLocal);
    if (!whenIso) return setErr("Invalid date/time.");

    const payload = {
      borrower_id: me,
      owner_id: bike.owner_id,
      bike_id: bikeId,
      booking_date: whenIso,
      scheduled_start_at: whenIso,
      duration_minutes: 30,
      registry_id: null as string | null,
      time_window: timeWindow || null,
      registry_quadrant: registryQuadrant || null,
      test_taker_intro: (testTakerIntro || "").trim() || null,
    };

    setSubmitting(true);

    const primary = await invokeBookingCreate("create-booking-and-payment", payload);
    let data = primary.data;
    let error = primary.error;

    if (error) {
      const msg = error.message || "Failed to create booking.";
      if (looksLikeMissingFunction(msg)) {
        const fallback = await invokeBookingCreate("request-booking", payload);
        data = fallback.data;
        error = fallback.error;
      }
    }

    if (error) {
      const msg = error.message || "Failed to create booking.";
      if (msg.toLowerCase().includes("slot not available") || msg.includes("409")) {
        setErr("That time slot is no longer available. Pick another time.");
      } else {
        setErr(msg);
      }
      setSubmitting(false);
      return;
    }

    const bookingId = data?.booking_id ?? null;
    const checkoutUrl = data?.checkout_url ?? null;
    const usedCredit = data?.used_credit ?? false;

    if (checkoutUrl) {
      setOkMsg("Redirecting to Stripe checkout…");
      window.location.assign(checkoutUrl);
      return;
    }

    setOkMsg(usedCredit ? "Booked using credit. Redirecting…" : "Booking created. Redirecting…");
    nav("/dashboard", { replace: true, state: { bookingId } });
    setSubmitting(false);
  }

  function onClickRequest() {
    setErr(null);
    setOkMsg(null);

    if (!me) return setErr("Please sign in first.");
    if (provinceBlocked) return setErr(`Bookings are not available in ${blockedProvinceName} yet.`);
    setChecklistOpen(true);
  }

  return (
    <div style={{ maxWidth: 980, margin: "0 auto", padding: 18 }}>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline", gap: 14, flexWrap: "wrap" }}>
        <div>
          <h1 style={{ margin: 0 }}>{title}</h1>
          <div style={{ marginTop: 6, color: "#475569", fontWeight: 600 }}>
            Request only — mentor must accept.
          </div>
        </div>
        <div style={{ display: "flex", gap: 12, flexWrap: "wrap" }}>
          <Link to={`/bikes/${bikeId}`} style={{ fontWeight: 800 }}>
            ← Back to bike
          </Link>
          <Link to="/browse" style={{ fontWeight: 800 }}>
            Browse
          </Link>
          <Link to="/legal" style={{ fontWeight: 800 }}>
            Rules &amp; Process
          </Link>
        </div>
      </div>

      {/* Province coming-soon wall */}
      {bike?.province && provinceBlocked ? (
        <div
          style={{
            marginTop: 14,
            padding: 16,
            borderRadius: 16,
            border: "1px solid #fed7aa",
            background: "#fff7ed",
            color: "#9a3412",
          }}
        >
          <div style={{ fontWeight: 1000, fontSize: 16, marginBottom: 6 }}>
            Booking isn’t available in {blockedProvinceName} yet.
          </div>

          <div style={{ fontWeight: 800, lineHeight: 1.45 }}>
            We’re launching province-by-province so expectations and rules stay consistent for both sides.
            Mentors can list bikes anywhere in Canada, and booking opens as supply grows.
          </div>

          <div style={{ display: "flex", gap: 10, flexWrap: "wrap", marginTop: 12 }}>
            <Link
              to="/browse"
              style={{
                display: "inline-flex",
                alignItems: "center",
                justifyContent: "center",
                padding: "10px 14px",
                borderRadius: 14,
                border: "1px solid #0f172a",
                background: "#0f172a",
                color: "white",
                fontWeight: 950,
                textDecoration: "none",
              }}
            >
              Browse bikes
            </Link>

            <Link
              to="/mentors/start"
              style={{
                display: "inline-flex",
                alignItems: "center",
                justifyContent: "center",
                padding: "10px 14px",
                borderRadius: 14,
                border: "1px solid #cbd5e1",
                background: "white",
                color: "#0f172a",
                fontWeight: 950,
                textDecoration: "none",
              }}
            >
              List your bike
            </Link>

            <button
              type="button"
              onClick={() => setPolicyOpen(true)}
              style={{
                padding: "10px 14px",
                borderRadius: 14,
                border: "1px solid #cbd5e1",
                fontWeight: 950,
                cursor: "pointer",
                background: "white",
                color: "#0f172a",
              }}
            >
              View rules
            </button>
          </div>
        </div>
      ) : null}

      {/* Booking form */}
      <div style={{ marginTop: 16, border: "1px solid #e2e8f0", borderRadius: 16, padding: 16, background: "white" }}>
        {!me ? (
          <div style={{ fontWeight: 800 }}>
            You must <Link to="/auth">sign in</Link> to request a booking.
          </div>
        ) : null}

        {bike?.province && provinceBlocked ? (
          <div style={{ marginTop: 10, color: "#64748b", fontWeight: 750 }}>
            This bike is listed in <strong>{blockedProvinceName}</strong>. Booking is disabled there for now.
          </div>
        ) : (
          <div style={{ display: "grid", gridTemplateColumns: "1fr", gap: 12, marginTop: 10 }}>
            <label style={{ display: "grid", gap: 6 }}>
              <div style={{ fontWeight: 900 }}>Desired test time</div>
              <input
                type="datetime-local"
                value={whenLocal}
                onChange={(e) => setWhenLocal(e.target.value)}
                style={{
                  padding: "10px 12px",
                  borderRadius: 12,
                  border: "1px solid #cbd5e1",
                  fontWeight: 700,
                  maxWidth: 320,
                }}
              />
              <div style={{ color: "#64748b", fontWeight: 600 }}>
                Match your registry time.
              </div>

              <div style={{ marginTop: 12, display: "grid", gap: 12, maxWidth: 560 }}>
                <div style={{ display: "grid", gap: 6 }}>
                  <div style={{ fontWeight: 900 }}>Time window <span style={{ color: "#64748b", fontWeight: 700 }}>(optional)</span></div>
                  <div style={{ display: "flex", gap: 10, flexWrap: "wrap" }}>
                    {[
                      { v: "morning", label: "Morning" },
                      { v: "early_afternoon", label: "Early afternoon" },
                      { v: "late_afternoon", label: "Late afternoon" },
                    ].map((opt) => (
                      <button
                        key={opt.v}
                        type="button"
                        onClick={() => setTimeWindow(opt.v as any)}
                        style={{
                          padding: "8px 12px",
                          borderRadius: 999,
                          border: "1px solid " + (timeWindow === opt.v ? "#0f172a" : "#cbd5e1"),
                          background: timeWindow === opt.v ? "#0f172a" : "white",
                          color: timeWindow === opt.v ? "white" : "#0f172a",
                          fontWeight: 850,
                          cursor: "pointer",
                        }}
                      >
                        {opt.label}
                      </button>
                    ))}
                  </div>
                  <div style={{ color: "#64748b", fontWeight: 600 }}>
                    Optional: helps mentors plan.
                  </div>
                </div>

                <div style={{ display: "grid", gap: 6 }}>
                  <div style={{ fontWeight: 900 }}>Registry area (quadrant)</div>
                  <div style={{ display: "flex", gap: 10, flexWrap: "wrap" }}>
                    {["NE", "NW", "SE", "SW"].map((q) => (
                      <button
                        key={q}
                        type="button"
                        onClick={() => setRegistryQuadrant(q as any)}
                        style={{
                          padding: "8px 12px",
                          borderRadius: 999,
                          border: "1px solid " + (registryQuadrant === q ? "#0f172a" : "#cbd5e1"),
                          background: registryQuadrant === q ? "#0f172a" : "white",
                          color: registryQuadrant === q ? "white" : "#0f172a",
                          fontWeight: 850,
                          cursor: "pointer",
                        }}
                      >
                        {q}
                      </button>
                    ))}
                  </div>
                  <div style={{ color: "#64748b", fontWeight: 600 }}>
                    Vague area only. Exact location shared after acceptance.
                  </div>
                </div>

                <label style={{ display: "grid", gap: 6 }}>
                  <div style={{ fontWeight: 900 }}>Short intro (shown to mentor)</div>
                  <textarea
                    value={testTakerIntro}
                    onChange={(e) => setTestTakerIntro(e.target.value)}
                    placeholder="Example: Hi! I’ve practiced a lot in parking lots and quiet roads. Comfortable with turns and stops. I’m calm and respectful — just need a road-test ready bike for my exam."
                    rows={4}
                    style={{
                      width: "100%",
                      padding: "10px 12px",
                      borderRadius: 12,
                      border: "1px solid #cbd5e1",
                      fontWeight: 700,
                      resize: "vertical",
                    }}
                  />
                  <div style={{ color: "#64748b", fontWeight: 600 }}>
                    Keep it short. This helps mentors accept the right requests.
                  </div>
                </label>
              </div>
            </label>

            <div style={{ display: "flex", gap: 12, alignItems: "center", flexWrap: "wrap" }}>
              <button
                onClick={onClickRequest}
                disabled={submitting || loadingBike || !me}
                style={{
                  padding: "10px 14px",
                  borderRadius: 14,
                  border: "1px solid #0f172a",
                  fontWeight: 900,
                  cursor: submitting ? "not-allowed" : "pointer",
                  background: "#0f172a",
                  color: "white",
                }}
              >
                {submitting ? "Submitting…" : "Request booking"}
              </button>

              <button
                type="button"
                onClick={() => setPolicyOpen(true)}
                style={{
                  padding: "10px 14px",
                  borderRadius: 14,
                  border: "1px solid #cbd5e1",
                  fontWeight: 900,
                  cursor: "pointer",
                  background: "white",
                }}
              >
                View rules
              </button>

              <Link to="/dashboard" style={{ fontWeight: 800 }}>
                Back to Dashboard
              </Link>
            </div>
          </div>
        )}

        {err ? (
          <div
            style={{
              marginTop: 10,
              padding: 12,
              borderRadius: 12,
              border: "1px solid #fecaca",
              background: "#fef2f2",
              color: "#991b1b",
              fontWeight: 800,
            }}
          >
            Error: {err}
          </div>
        ) : null}

        {okMsg ? (
          <div
            style={{
              marginTop: 10,
              padding: 12,
              borderRadius: 12,
              border: "1px solid #bbf7d0",
              background: "#f0fdf4",
              color: "#166534",
              fontWeight: 800,
            }}
          >
            {okMsg}
          </div>
        ) : null}

        {bike ? (
          <div style={{ marginTop: 12, color: "#475569", fontWeight: 700 }}>
            Bike:{" "}
            <span style={{ fontWeight: 900 }}>
              {[bike.year, bike.make, bike.model].filter(Boolean).join(" ") || bike.id.slice(0, 8)}
            </span>{" "}
            {bike.city ? <span>• {bike.city}</span> : null}
            {bike.province ? <span> • {bike.province}</span> : null}
          </div>
        ) : null}
      </div>

      <ChecklistGateModal
        open={checklistOpen}
        title="Before you continue"
        intro={<>We want zero surprises. Please confirm you’re prepared and you understand the rules.</>}
        requiredItems={borrowerChecklist}
        footerNote={
          <div style={{ display: "flex", gap: 10, alignItems: "center", flexWrap: "wrap" }}>
            <span>
              Early cancel: <strong>more than 5 days</strong> (25% admin fee). Late cancel: <strong>5 days or less</strong> (incl. day 5) may be forfeiture.
            </span>
            <button
              type="button"
              onClick={() => setPolicyOpen(true)}
              style={{
                border: "1px solid #cbd5e1",
                background: "white",
                borderRadius: 12,
                padding: "6px 10px",
                fontWeight: 900,
                cursor: "pointer",
              }}
            >
              View rules
            </button>
          </div>
        }
        confirmText="I understand — continue"
        cancelText="Not ready"
        onCancel={() => setChecklistOpen(false)}
        onConfirm={() => {
          setChecklistOpen(false);
          submitRequest();
        }}
      />

      <Modal open={policyOpen} title="Rules & Process (clear + enforceable)" onClose={() => setPolicyOpen(false)}>
        <div style={{ fontWeight: 900, marginBottom: 8 }}>
          This platform is for <b>registry road tests only</b>. It is <b>not</b> a rental company.
        </div>

        <div style={{ marginTop: 10 }}>
          <b>Early cancellation</b> = cancel <b>more than 5 days</b> before the scheduled test time.
          <br />
          <b>Late cancellation</b> = cancel <b>5 days or less</b> before the test (including day 5).
        </div>

        <div style={{ fontWeight: 950, marginTop: 12 }}>Cancellation outcomes (after the mentor accepts):</div>
        <ul style={{ margin: "8px 0 0 18px" }}>
          <li>
            <b>Early cancel</b>: canceller receives <b>platform credit</b> (minus <b>25%</b> admin fee). The non-cancelling party receives <b>$100 platform credit</b> to rebook / accept another request.
          </li>
          <li>
            <b>Late cancel</b> (≤ 5 days): cancelling party <b>forfeits</b>. The non-cancelling party receives <b>$100 platform credit</b>.
          </li>
        </ul>

        <div style={{ fontWeight: 950, marginTop: 12 }}>Fault examples (so nobody feels blindsided):</div>
        <ul style={{ margin: "8px 0 0 18px" }}>
          <li>
            <b>Test-taker fault</b>: no helmet, no hands-free, late/no-show, unfit to ride → test-taker forfeits.
          </li>
          <li>
            <b>Mentor fault</b>: invalid registration/insurance, unsafe bike, required lights not working → mentor may forfeit.
          </li>
          <li>
            In fault scenarios, the at-fault party loses their fee/deposit and the other party may receive <b>$100</b> credit. If a registry fee is higher than $100, we do not cover the difference.
          </li>
        </ul>

        <div style={{ fontWeight: 950, marginTop: 12 }}>Unavoidable events (weather / fire / emergencies):</div>
        <div style={{ marginTop: 6 }}>
          If the test cannot proceed due to events outside both users’ control, <b>no one loses</b>. Funds are issued as <b>full platform credit</b> to rebook.
        </div>

        <div style={{ marginTop: 12, color: "#475569", fontWeight: 800 }}>
          <b>Platform credit</b> can be used for another booking, and unused credit may be returned at the end of the season (per the Rules &amp; Process).
          {" "}
          <Link to="/legal" style={{ fontWeight: 950 }}>Read full policy →</Link>
        </div>
      </Modal>
    </div>
  );
}

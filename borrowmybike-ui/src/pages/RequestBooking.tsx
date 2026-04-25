// src/pages/RequestBooking.tsx
import { useEffect, useMemo, useRef, useState } from "react";
import { Link, useNavigate, useParams } from "react-router-dom";
import { sb } from "../lib/supabase";
import { useAuth } from "../auth/useAuth";

import type { ChecklistItem } from "../components/ChecklistGateModal";
import { isProvinceEnabled, provinceName } from "../lib/provinces";
import { getMetroCities } from "../utils/metroAreas";
import { trackEvent } from "../lib/analytics";

type BikeRow = {
  id: string;
  owner_id: string | null;
  make?: string | null;
  model?: string | null;
  year?: number | null;
  city?: string | null;
  province?: string | null; 
};

type RegistryRow = {
  id: string;
  name: string;
  city: string | null;
  address: string | null;
  province: string | null;
  postal_code?: string | null;
  latitude?: number | null;
  longitude?: number | null;
  is_active: boolean | null;
  notes?: string | null;
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
  const [registryId, setRegistryId] = useState<string>("");
  const [registries, setRegistries] = useState<RegistryRow[]>([]);
  const [loadingRegistries, setLoadingRegistries] = useState(false);
  const [testTakerIntro, setTestTakerIntro] = useState<string>("");

  const [submitting, setSubmitting] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [okMsg, setOkMsg] = useState<string | null>(null);

  const [checklistOpen, setChecklistOpen] = useState(false);
  const [checklistChecks, setChecklistChecks] = useState<Record<string, boolean>>({});
  const checklistRef = useRef<HTMLDivElement | null>(null);
  const [policyOpen, setPolicyOpen] = useState(false);
  const [didTrackRequestStart, setDidTrackRequestStart] = useState(false);

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

   useEffect(() => {
    async function loadRegistries() {
      if (!bike) return;

      const prov = (bike.province || "AB").toUpperCase();
      const city = (bike.city || "").trim();

      setLoadingRegistries(true);
      setRegistries([]);
      setRegistryId("");

      const metroCities = city
        ? getMetroCities(city).map((c) => c.trim().toLowerCase())
        : [];

      const { data, error } = await sb
        .from("registries")
        .select("id,name,city,address,province,is_active")
        .eq("is_active", true)
        .eq("province", prov)
        .order("city", { ascending: true })
        .order("name", { ascending: true });

      if (error) {
        console.warn("Failed to load registries:", error);
        setRegistries([]);
        setLoadingRegistries(false);
        return;
      }

      const all = ((data as any) ?? []) as RegistryRow[];

      const normalize = (value?: string | null) => String(value || "").trim().toLowerCase();

      let next = all;

      if (metroCities.length > 0) {
        const metroSet = new Set(metroCities);

        const clustered = all.filter((r) => metroSet.has(normalize(r.city)));

        if (clustered.length > 0) {
          next = clustered.sort((a, b) => {
            const aExact = normalize(a.city) === normalize(city) ? 0 : 1;
            const bExact = normalize(b.city) === normalize(city) ? 0 : 1;
            if (aExact !== bExact) return aExact - bExact;

            const byCity = normalize(a.city).localeCompare(normalize(b.city));
            if (byCity !== 0) return byCity;

            return (a.name || "").localeCompare(b.name || "");
          });
        }
      }

      setRegistries(next);
      setLoadingRegistries(false);
    }

    loadRegistries();
  }, [bike?.id, bike?.city, bike?.province]);

  useEffect(() => {
    if (loadingBike || didTrackRequestStart || !bikeId || !bike) return;

    trackEvent("booking_request_started", {
      bike_id: bikeId,
      bike_title: [bike.year, bike.make, bike.model].filter(Boolean).join(" ") || bikeId,
      province: bike.province || "",
      city: bike.city || "",
      source: "request_page",
    });
    setDidTrackRequestStart(true);
  }, [loadingBike, didTrackRequestStart, bikeId, bike]);

  const borrowerChecklist: ChecklistItem[] = useMemo(
  () => [
    {
      id: "gear",
      label: (
        <>
          I will arrive at the selected registry with <strong>proper safety gear</strong>, including a helmet, long pants,
          a long-sleeve jacket, and closed-toe shoes at minimum.
        </>
      ),
    },
    {
      id: "docs_and_arrival",
      label: (
        <>
          I will arrive <strong>at least 20 minutes before</strong> the scheduled road test with all required documentation,
          including my valid driver’s or learner’s licence and any documents required by the registry.
        </>
      ),
    },
    {
      id: "not_rental",
      label: (
        <>
          I understand this booking is <strong>strictly for the registry road test</strong> and not for practice riding,
          transportation, or recreational riding.
        </>
      ),
    },
    {
      id: "rules_ack",
      label: (
        <>
          I understand the platform’s <strong>cancellation, no-show, and fault rules</strong> apply once I submit this request.{" "}
          <Link to="/rules" style={{ fontWeight: 950 }}>Rules &amp; Process →</Link>
        </>
      ),
    },
    {
      id: "credit_ack",
      label: (
        <>
          I understand that in certain scenarios, refunds may be issued as <strong>platform credit</strong> according to the
          BorrowMyBike rules and policies.{" "}
          <Link to="/legal" style={{ fontWeight: 950 }}>Legal &amp; Policies →</Link>
        </>
      ),
    },
    {
      id: "damage_ack",
      label: (
        <>
          I understand I am responsible for any damage that occurs due to my <strong>negligent use</strong> of the motorcycle.
        </>
      ),
    },
    {
      id: "legal_permission",
      label: (
        <>
          I confirm I am <strong>legally permitted to operate a motorcycle</strong> for the purpose of the road test.
        </>
      ),
    },
  ],
  []
);

  useEffect(() => {
    if (!checklistOpen) return;

    const init: Record<string, boolean> = {};
    for (const item of borrowerChecklist) init[item.id] = false;
    setChecklistChecks(init);

    const timer = window.setTimeout(() => {
      checklistRef.current?.scrollIntoView({ behavior: "smooth", block: "start" });
    }, 60);

    return () => window.clearTimeout(timer);
  }, [checklistOpen, borrowerChecklist]);

  const allChecklistChecked = useMemo(() => {
    if (!borrowerChecklist.length) return true;
    return borrowerChecklist.every((item) => checklistChecks[item.id]);
  }, [borrowerChecklist, checklistChecks]);

  const checklistCheckedCount = useMemo(() => {
    return borrowerChecklist.filter((item) => checklistChecks[item.id]).length;
  }, [borrowerChecklist, checklistChecks]);

  function trackRequestFailed(reason: string, message: string) {
    trackEvent("booking_request_failed", {
      bike_id: bikeId,
      owner_id: bike?.owner_id || "",
      province: bike?.province || "",
      city: bike?.city || "",
      reason,
      message,
    });
  }

  async function submitRequest() {
    setErr(null);
    setOkMsg(null);

    if (!me) {
      trackRequestFailed("missing_auth", "Please sign in first.");
      return setErr("Please sign in first.");
    }
    if (!bikeId) {
      trackRequestFailed("missing_bike_id", "Missing bike id in URL.");
      return setErr("Missing bike id in URL.");
    }
    if (!bike?.owner_id) {
      trackRequestFailed("missing_owner_id", "This bike is missing an owner_id in the database.");
      return setErr("This bike is missing an owner_id in the database.");
    }
    if (provinceBlocked) {
      const message = `Bookings are not available in ${blockedProvinceName} yet.`;
      trackRequestFailed("province_blocked", message);
      return setErr(message);
    }


    if (!registryQuadrant) {
      trackRequestFailed("missing_registry_quadrant", "Please select the registry area (NE / NW / SE / SW).");
      return setErr("Please select the registry area (NE / NW / SE / SW).");
    }
    if (registries.length > 0 && !registryId) {
      trackRequestFailed("missing_registry_id", "Please select your registry location from the list.");
      return setErr("Please select your registry location from the list.");
    }
    if (!testTakerIntro.trim()) {
      trackRequestFailed("missing_intro", "Please write a short intro (shown to the mentor).");
      return setErr("Please write a short intro (shown to the mentor).");
    }

    const whenIso = isoWithTzFromLocalDatetime(whenLocal);
    if (!whenIso) {
      trackRequestFailed("invalid_datetime", "Invalid date/time.");
      return setErr("Invalid date/time.");
    }

    const payload = {
      borrower_id: me,
      owner_id: bike.owner_id,
      bike_id: bikeId,
      booking_date: whenIso,
      scheduled_start_at: whenIso,
      duration_minutes: 30,
      registry_id: registryId ? registryId : (null as string | null),
      time_window: timeWindow || null,
      registry_quadrant: registryQuadrant || null,
      test_taker_intro: (testTakerIntro || "").trim() || null,
    };

    trackEvent("booking_request_submitted", {
      bike_id: bikeId,
      owner_id: bike.owner_id,
      province: bike?.province || "",
      city: bike?.city || "",
      registry_id: registryId || "",
      registry_quadrant: registryQuadrant || "",
      time_window: timeWindow || "",
      used_intro: !!testTakerIntro.trim(),
    });

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
      const lower = msg.toLowerCase();
      const dataError = String(data?.error || "").toLowerCase();
      const dataDetails = String(data?.details || "").toLowerCase();

      if (
        lower.includes("slot not available") ||
        lower.includes("non-2xx") ||
        lower.includes("409") ||
        dataError.includes("slot not available") ||
        dataDetails.includes("slot not available")
      ) {
        setErr("This bike is already booked for that time or too close to another booking. Please choose a different time.");
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
      trackEvent("booking_request_succeeded", {
        bike_id: bikeId,
        booking_id: bookingId || "",
        province: bike?.province || "",
        city: bike?.city || "",
        checkout_flow: true,
        used_credit: usedCredit,
      });
      setOkMsg("Redirecting to Stripe checkout…");
      window.location.assign(checkoutUrl);
      return;
    }

    trackEvent("booking_request_succeeded", {
      bike_id: bikeId,
      booking_id: bookingId || "",
      province: bike?.province || "",
      city: bike?.city || "",
      checkout_flow: false,
      used_credit: usedCredit,
    });

    setOkMsg(usedCredit ? "Booked using credit. Redirecting…" : "Booking created. Redirecting…");
    nav("/dashboard", { replace: true, state: { bookingId } });
    setSubmitting(false);
  }

    function onClickRequest() {
    setErr(null);
    setOkMsg(null);

    if (!me) {
      trackRequestFailed("missing_auth", "Please sign in first.");
      return setErr("Please sign in first.");
    }
    if (provinceBlocked) {
      const message = `Bookings are not available in ${blockedProvinceName} yet.`;
      trackRequestFailed("province_blocked", message);
      return setErr(message);
    }

    if (checklistOpen) {
      if (!allChecklistChecked) {
        trackRequestFailed("borrower_checklist_incomplete", "Please complete the checklist below before continuing.");
        return setErr("Please complete the checklist below before continuing.");
      }
      submitRequest();
      return;
    }

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
                  <div style={{ fontWeight: 900 }}>
                    Registry location
                    {registries.length ? null : (
                      <span style={{ color: "#64748b", fontWeight: 700 }}> (optional until registries are loaded)</span>
                    )}
                  </div>
                  <select
                    value={registryId}
                    onChange={(e) => setRegistryId(e.target.value)}
                    style={{
                      padding: "10px 12px",
                      borderRadius: 12,
                      border: "1px solid #cbd5e1",
                      fontWeight: 750,
                      color: "#0f172a",
                      background: "white",
                    }}
                  >
                    <option value="">
                      {loadingRegistries
                        ? "Loading registries…"
                        : registries.length
                          ? "Select a registry…"
                          : "(Not loaded yet)"}
                    </option>
                    {registries.map((r) => {
                      const line = [r.name, r.address].filter(Boolean).join(" — ");
                      const sub = [r.city, r.province].filter(Boolean).join(", ");
                      const label = sub ? `${line} (${sub})` : line;
                      return (
                        <option key={r.id} value={r.id}>
                          {label}
                        </option>
                      );
                    })}
                  </select>
                  <div style={{ color: "#64748b", fontWeight: 600 }}>
                    Choose the registry you booked. Exact address is stored and shared after acceptance.
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
                {submitting ? "Submitting…" : checklistOpen ? "Complete checklist below to continue ↓" : "Request booking"}
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

            {checklistOpen ? (
              <div
                ref={checklistRef}
                style={{
                  marginTop: 14,
                  border: "1px solid #cbd5e1",
                  borderRadius: 16,
                  background: "#f8fafc",
                  padding: 14,
                  scrollMarginTop: 96,
                }}
              >
                <div style={{ fontWeight: 900, fontSize: 18, color: "#0f172a" }}>
                  Complete this checklist before continuing
                </div>

                <div style={{ marginTop: 6, color: "#475569", fontWeight: 600, lineHeight: 1.55 }}>
                  We want zero surprises. Please confirm you’re prepared and you understand the rules.
                </div>

                <div
                  style={{
                    marginTop: 12,
                    display: "flex",
                    justifyContent: "space-between",
                    alignItems: "center",
                    gap: 10,
                    flexWrap: "wrap",
                    padding: "10px 12px",
                    borderRadius: 12,
                    border: "1px solid #e2e8f0",
                    background: "white",
                  }}
                >
                  <div style={{ fontWeight: 900, color: "#334155" }}>Checklist progress</div>
                  <div style={{ fontWeight: 1000, color: "#0f172a" }}>
                    {checklistCheckedCount}/{borrowerChecklist.length}
                  </div>
                </div>

                <div style={{ marginTop: 12, display: "grid", gap: 10 }}>
                  {borrowerChecklist.map((item) => (
                    <label
                      key={item.id}
                      style={{
                        display: "flex",
                        gap: 10,
                        alignItems: "flex-start",
                        padding: 12,
                        borderRadius: 14,
                        border: "1px solid #e2e8f0",
                        background: "white",
                        cursor: "pointer",
                      }}
                    >
                      <input
                        type="checkbox"
                        checked={!!checklistChecks[item.id]}
                        onChange={(e) =>
                          setChecklistChecks((prev) => ({
                            ...prev,
                            [item.id]: e.target.checked,
                          }))
                        }
                        style={{ marginTop: 3 }}
                      />
                      <div style={{ color: "#0f172a", fontWeight: 600, lineHeight: 1.6 }}>
                        {item.label ?? item.text ?? ""}
                      </div>
                    </label>
                  ))}
                </div>

                <div
                  style={{
                    marginTop: 12,
                    border: "1px solid #fde68a",
                    background: "#fffbeb",
                    borderRadius: 14,
                    padding: 12,
                    color: "#713f12",
                    fontWeight: 600,
                    lineHeight: 1.6,
                  }}
                >
                  Early cancel: <strong>more than 5 days</strong> (25% admin fee). Late cancel: <strong>5 days or less</strong> (incl. day 5) may be forfeiture.
                </div>

                <div style={{ marginTop: 12, display: "flex", gap: 10, flexWrap: "wrap", alignItems: "center" }}>
                  <button
                    type="button"
                    onClick={onClickRequest}
                    disabled={submitting || !allChecklistChecked}
                    style={{
                      padding: "10px 14px",
                      borderRadius: 14,
                      border: "1px solid #0f172a",
                      fontWeight: 900,
                      cursor: submitting || !allChecklistChecked ? "not-allowed" : "pointer",
                      background: "#0f172a",
                      color: "white",
                      opacity: submitting || !allChecklistChecked ? 0.6 : 1,
                    }}
                  >
                    {submitting ? "Submitting…" : "I understand — continue"}
                  </button>

                  <button
                    type="button"
                    onClick={() => {
                      setChecklistOpen(false);
                      setChecklistChecks({});
                    }}
                    style={{
                      padding: "10px 14px",
                      borderRadius: 14,
                      border: "1px solid #cbd5e1",
                      fontWeight: 900,
                      cursor: "pointer",
                      background: "white",
                    }}
                  >
                    Not ready
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
                </div>
              </div>
            ) : null}
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

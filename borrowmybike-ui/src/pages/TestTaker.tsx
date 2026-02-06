// src/pages/TestTaker.tsx
import { useEffect, useMemo, useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import { sb } from "../lib/supabase";
import { useAuth } from "../auth/useAuth";

export default function TestTaker() {
  const { user } = useAuth();
  const nav = useNavigate();

  // If signed in, this page is pointless — send them to Dashboard.
  useEffect(() => {
    if (user) nav("/dashboard", { replace: true });
  }, [user, nav]);

  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [province, setProvince] = useState("AB");
  const [city, setCity] = useState("");
  const [expectedDate, setExpectedDate] = useState("");
  const [bikeType, setBikeType] = useState("");
  const [bikeSize, setBikeSize] = useState("");
  const [notes, setNotes] = useState("");

  const [submitting, setSubmitting] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);
  const [err, setErr] = useState<string | null>(null);

  const styles = useMemo(() => {
    const page: React.CSSProperties = {
      maxWidth: 980,
      margin: "0 auto",
      padding: 18,
      fontFamily:
        'Inter, ui-sans-serif, system-ui, -apple-system, Segoe UI, Roboto, Arial, "Apple Color Emoji","Segoe UI Emoji"',
    };

    const card: React.CSSProperties = {
      marginTop: 14,
      padding: 16,
      border: "1px solid #e2e8f0",
      borderRadius: 18,
      background: "white",
    };

    const h1: React.CSSProperties = { margin: 0, fontSize: 28, fontWeight: 900, letterSpacing: -0.2 };
    const sub: React.CSSProperties = { marginTop: 6, color: "#475569", fontWeight: 450, lineHeight: 1.55 };

    const row: React.CSSProperties = {
      marginTop: 12,
      display: "grid",
      gridTemplateColumns: "1fr 1fr",
      gap: 12,
    };

    const label: React.CSSProperties = { display: "grid", gap: 6 };
    const labelText: React.CSSProperties = { fontWeight: 750, color: "#0f172a" };

    const input: React.CSSProperties = {
      padding: "10px 12px",
      borderRadius: 12,
      border: "1px solid #cbd5e1",
      fontWeight: 500,
      outline: "none",
    };

    const textarea: React.CSSProperties = {
      ...input,
      minHeight: 110,
      resize: "vertical",
      fontWeight: 450,
      lineHeight: 1.55,
    };

    const helper: React.CSSProperties = { color: "#64748b", fontWeight: 450, fontSize: 13, lineHeight: 1.45 };

    const btnPrimary: React.CSSProperties = {
      padding: "12px 14px",
      borderRadius: 14,
      border: "1px solid #0f172a",
      background: "#0f172a",
      color: "white",
      fontWeight: 850,
      cursor: "pointer",
      textDecoration: "none",
      display: "inline-flex",
      alignItems: "center",
      justifyContent: "center",
    };

    const btnGhost: React.CSSProperties = {
      padding: "12px 14px",
      borderRadius: 14,
      border: "1px solid #cbd5e1",
      background: "white",
      color: "#0f172a",
      fontWeight: 800,
      textDecoration: "none",
      display: "inline-flex",
      alignItems: "center",
      gap: 8,
    };

    const callout: React.CSSProperties = {
      marginTop: 12,
      padding: 12,
      borderRadius: 14,
      border: "1px solid #e2e8f0",
      background: "#f8fafc",
      color: "#0f172a",
    };

    const calloutTitle: React.CSSProperties = { fontWeight: 850 };
    const calloutText: React.CSSProperties = { marginTop: 6, fontWeight: 450, color: "#334155", lineHeight: 1.55 };

    return {
      page,
      card,
      h1,
      sub,
      row,
      label,
      labelText,
      input,
      textarea,
      helper,
      btnPrimary,
      btnGhost,
      callout,
      calloutTitle,
      calloutText,
    };
  }, []);

  async function submit() {
    setErr(null);
    setMsg(null);

    if (!email.trim()) return setErr("Email is required.");
    if (!city.trim()) return setErr("City is required.");

    setSubmitting(true);

    const { error } = await sb.from("waitlist_signups").insert({
      role: "test_taker",
      name: name.trim() || null,
      email: email.trim(),
      province,
      city: city.trim(),
      expected_test_date: expectedDate || null,
      bike_type: bikeType || null,
      bike_size: bikeSize || null,
      notes: notes.trim() || null,
    });

    setSubmitting(false);

    if (error) {
      setErr(error.message);
      return;
    }

    setMsg("Saved. You’re in — we’ll notify you when bookings open in your area.");
  }

  // While redirecting (signed-in), render nothing to avoid flicker.
  if (user) return null;

  return (
    <div style={styles.page}>
      <div style={{ display: "flex", justifyContent: "space-between", gap: 12, alignItems: "baseline", flexWrap: "wrap" }}>
        <div>
          <h1 style={styles.h1}>Taking a road test?</h1>
          <div style={styles.sub}>
            Create your account now so you’re ready when supply opens in your city. This is for registry road tests only — not recreational rentals.
          </div>

          <div style={styles.callout}>
            <div style={styles.calloutTitle}>Read the rules before you book</div>
            <div style={styles.calloutText}>
              We publish everything up front (early vs late cancel, fault scenarios, weather/fire, credits, etc.) so no one can say “I didn’t know.”
              See{" "}
              <Link to="/rules" style={{ fontWeight: 800 }}>
                Rules &amp; Process
              </Link>{" "}
              and{" "}
              <Link to="/legal" style={{ fontWeight: 800 }}>
                Legal &amp; Policies
              </Link>
              .
            </div>
          </div>

          <div style={{ marginTop: 12, display: "flex", gap: 10, flexWrap: "wrap", alignItems: "center" }}>
            <Link to="/auth" state={{ from: "/test-takers" }} style={styles.btnPrimary}>
              Create account / Sign in →
            </Link>
            <div style={{ color: "#64748b", fontWeight: 450 }}>Or continue below without an account.</div>
          </div>
        </div>

        <div style={{ display: "flex", gap: 10, flexWrap: "wrap" }}>
          <Link to="/browse" style={styles.btnGhost}>Browse bikes →</Link>
          <Link to="/mentors/start" style={styles.btnGhost}>Earn $100 (mentors) →</Link>
        </div>
      </div>

      <div style={styles.card}>
        <div style={{ fontWeight: 850, fontSize: 18 }}>Get notified</div>
        <div style={{ marginTop: 6, color: "#475569", fontWeight: 450, lineHeight: 1.55 }}>
          Leave your info and we’ll email you when bookings open in your area.
        </div>

        {msg ? (
          <div
            style={{
              marginTop: 12,
              padding: 12,
              borderRadius: 12,
              border: "1px solid #bbf7d0",
              background: "#f0fdf4",
              color: "#166534",
              fontWeight: 600,
            }}
          >
            {msg}
          </div>
        ) : null}

        {err ? (
          <div
            style={{
              marginTop: 12,
              padding: 12,
              borderRadius: 12,
              border: "1px solid #fecaca",
              background: "#fef2f2",
              color: "#991b1b",
              fontWeight: 600,
            }}
          >
            Error: {err}
          </div>
        ) : null}

        <div style={styles.row}>
          <label style={styles.label}>
            <div style={styles.labelText}>Name</div>
            <input value={name} onChange={(e) => setName(e.target.value)} style={styles.input} placeholder="Your name" />
            <div style={styles.helper}>Optional — helps mentors feel more comfortable accepting.</div>
          </label>

          <label style={styles.label}>
            <div style={styles.labelText}>Email</div>
            <input value={email} onChange={(e) => setEmail(e.target.value)} style={styles.input} placeholder="you@example.com" />
            <div style={styles.helper}>We’ll email you when bookings open in your area.</div>
          </label>

          <label style={styles.label}>
            <div style={styles.labelText}>Province</div>
            <select value={province} onChange={(e) => setProvince(e.target.value)} style={styles.input}>
              <option value="AB">AB (launching first)</option>
              <option value="BC">BC</option>
              <option value="SK">SK</option>
              <option value="MB">MB</option>
              <option value="ON">ON</option>
              <option value="QC">QC</option>
              <option value="NS">NS</option>
              <option value="NB">NB</option>
              <option value="NL">NL</option>
              <option value="PE">PE</option>
              <option value="NT">NT</option>
              <option value="NU">NU</option>
              <option value="YT">YT</option>
            </select>
          </label>

          <label style={styles.label}>
            <div style={styles.labelText}>City</div>
            <input value={city} onChange={(e) => setCity(e.target.value)} style={styles.input} placeholder="Calgary" />
          </label>

          <label style={styles.label}>
            <div style={styles.labelText}>Expected test date (optional)</div>
            <input type="date" value={expectedDate} onChange={(e) => setExpectedDate(e.target.value)} style={styles.input} />
          </label>

          <label style={styles.label}>
            <div style={styles.labelText}>Bike type (optional)</div>
            <select value={bikeType} onChange={(e) => setBikeType(e.target.value)} style={styles.input}>
              <option value="">—</option>
              <option value="Scooter">Scooter</option>
              <option value="Standard">Standard</option>
              <option value="Cruiser">Cruiser</option>
              <option value="Dual-sport">Dual-sport</option>
            </select>
          </label>

          <label style={styles.label}>
            <div style={styles.labelText}>Bike size (optional)</div>
            <select value={bikeSize} onChange={(e) => setBikeSize(e.target.value)} style={styles.input}>
              <option value="">—</option>
              <option value="50cc">50cc</option>
              <option value="125cc">125cc</option>
              <option value="250cc">250cc</option>
              <option value="300cc-500cc">300–500cc</option>
            </select>
          </label>

          <label style={{ ...styles.label, gridColumn: "1 / -1" }}>
            <div style={styles.labelText}>Notes (optional)</div>
            <textarea
              value={notes}
              onChange={(e) => setNotes(e.target.value)}
              style={styles.textarea}
              placeholder="Anything we should know? (e.g., first road test, prefers automatic/scooter, nervous about traffic, etc.)"
            />
            <div style={styles.helper}>This helps with matching + smoother coordination.</div>
          </label>
        </div>

        <div style={{ marginTop: 14, display: "flex", gap: 12, flexWrap: "wrap", alignItems: "center" }}>
          <button onClick={submit} disabled={submitting} style={{ ...styles.btnPrimary, opacity: submitting ? 0.7 : 1 }}>
            {submitting ? "Saving…" : "Get notified"}
          </button>

          <div style={{ color: "#64748b", fontWeight: 450 }}>
            Tip: You can still browse bikes now, even if bookings aren’t open in your province yet.
          </div>
        </div>
      </div>
    </div>
  );
}

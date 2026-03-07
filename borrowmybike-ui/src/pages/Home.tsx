// src/pages/Home.tsx
import { useMemo, useState } from "react";
import { Link } from "react-router-dom";
import { PROVINCES, isProvinceEnabled, provinceLabel, type ProvinceCode } from "../lib/provinces";

type CityDef = { slug: string; name: string };

const CITY_OPTIONS: Record<ProvinceCode, CityDef[]> = {
  AB: [{ slug: "calgary", name: "Calgary" }],
  BC: [],
  SK: [],
  MB: [],
  ON: [],
  QC: [],
  NB: [],
  NS: [],
  PE: [],
  NL: [],
  YT: [],
  NT: [],
  NU: [],
};

export default function Home() {
  // Keep these as strings to match how bikes store city/province today
  const [prov, setProv] = useState<ProvinceCode | "">("AB");
  const [city, setCity] = useState<string>("calgary");

  const provinceEnabled = prov ? isProvinceEnabled(prov as ProvinceCode) : false;

  const cityOptions = useMemo(() => {
    if (!prov) return [];
    return CITY_OPTIONS[prov as ProvinceCode] ?? [];
  }, [prov]);

  const selectedCityName = useMemo(() => {
    const found = cityOptions.find((c) => c.slug === city);
    return found?.name ?? (city ? city : "");
  }, [city, cityOptions]);

  // Layout tokens (match the calm C6L vibe)
  const page: React.CSSProperties = {
    maxWidth: 1280,
    margin: "0 auto",
    padding: 16,
  };

  const card: React.CSSProperties = {
    border: "1px solid #e2e8f0",
    borderRadius: 18,
    background: "white",
    padding: 18,
    boxShadow: "0 1px 2px rgba(15,23,42,.04)",
  };

  const muted: React.CSSProperties = { color: "#475569" };

  const heroWrap: React.CSSProperties = {
    border: "1px solid #e2e8f0",
    borderRadius: 18,
    overflow: "hidden",
    background: "#0b1f3b",
    boxShadow: "0 1px 2px rgba(15,23,42,.04)",
  };

  const heroBg: React.CSSProperties = {
    position: "relative",
    minHeight: 360,
    backgroundImage: "url(/hero-bike.jpeg)",
    backgroundSize: "cover",
    backgroundPosition: "center",
  };

  const heroOverlay: React.CSSProperties = {
    position: "absolute",
    inset: 0,
    // similar to C6L: left-to-right gradient so text stays readable
    background:
      "linear-gradient(90deg, rgba(11,31,59,.60), rgba(11,31,59,.30), rgba(11,31,59,.08))",
  };

  const heroInner: React.CSSProperties = {
    position: "relative",
    padding: 18,
    maxWidth: 760,
  };

  const heroKicker: React.CSSProperties = {
    fontWeight: 1000,
    color: "rgba(255,255,255,.88)",
    fontSize: 14,
  };

  const h1: React.CSSProperties = {
    margin: "8px 0 0",
    fontSize: 36,
    lineHeight: 1.08,
    letterSpacing: "-0.02em",
    fontWeight: 1100 as any,
    color: "white",
  };

  const lead: React.CSSProperties = {
    marginTop: 10,
    color: "rgba(255,255,255,.92)",
    lineHeight: 1.65,
    fontWeight: 600,
    maxWidth: 80 * 12,
  };

  const ctaRow: React.CSSProperties = {
    display: "flex",
    flexWrap: "wrap",
    gap: 10,
    marginTop: 14,
  };

  const primaryBtn: React.CSSProperties = {
    display: "inline-flex",
    alignItems: "center",
    gap: 10,
    padding: "10px 14px",
    borderRadius: 999,
    border: "1px solid rgba(255,255,255,.25)",
    background: "rgba(255,255,255,.12)",
    color: "white",
    fontWeight: 1000,
    textDecoration: "none",
    whiteSpace: "nowrap",
  };

  const secondaryBtn: React.CSSProperties = {
    ...primaryBtn,
    background: "rgba(255,255,255,.08)",
    border: "1px solid rgba(255,255,255,.22)",
    fontWeight: 950,
  };

  const heroLinksWrap: React.CSSProperties = {
    display: "flex",
    gap: 14,
    flexWrap: "wrap",
    padding: "12px 18px 16px",
    background: "white",
    borderTop: "1px solid #e2e8f0",
  };

  const heroLink: React.CSSProperties = {
    color: "#0b1f3b",
    fontWeight: 950,
    textDecoration: "none",
  };

  const trustStrip: React.CSSProperties = {
    ...card,
    marginTop: 14,
    padding: 14,
    display: "flex",
    flexWrap: "wrap",
    gap: 10,
    alignItems: "center",
    justifyContent: "space-between",
  };

  const trustLeft: React.CSSProperties = { display: "flex", flexDirection: "column", gap: 4 };
  const trustTitle: React.CSSProperties = { fontWeight: 1100 as any, color: "#0f172a" };
  const trustSub: React.CSSProperties = { ...muted, fontWeight: 650 };

  const chipRow: React.CSSProperties = {
    display: "flex",
    flexWrap: "wrap",
    gap: 8,
    justifyContent: "flex-start",
  };

  const chip: React.CSSProperties = {
    display: "inline-flex",
    alignItems: "center",
    gap: 8,
    padding: "6px 10px",
    borderRadius: 999,
    border: "1px solid #e2e8f0",
    background: "rgba(248,250,252,.85)",
    color: "#334155",
    fontSize: 13,
    fontWeight: 900,
  };

  const sectionTitle: React.CSSProperties = {
    margin: 0,
    fontSize: 18,
    fontWeight: 1100 as any,
    color: "#0f172a",
  };

  const grid2: React.CSSProperties = {
    display: "grid",
    gap: 14,
    marginTop: 14,
  };

  const grid3: React.CSSProperties = {
    display: "grid",
    gap: 14,
    marginTop: 14,
  };

  const smallCardTitle: React.CSSProperties = { fontWeight: 1100 as any, color: "#0f172a" };
  const smallCardText: React.CSSProperties = { ...muted, marginTop: 6, lineHeight: 1.65, fontWeight: 600 };

  const selectWrap: React.CSSProperties = {
    display: "flex",
    gap: 10,
    flexWrap: "wrap",
    marginTop: 10,
  };

  const selectLabel: React.CSSProperties = {
    display: "flex",
    flexDirection: "column",
    gap: 6,
    fontWeight: 950,
    minWidth: 240,
  };

  const select: React.CSSProperties = {
    padding: "10px 12px",
    borderRadius: 12,
    border: "1px solid #e2e8f0",
    background: "white",
    fontWeight: 800,
    color: "#0f172a",
  };

  const browseBtn: React.CSSProperties = {
    display: "inline-flex",
    alignItems: "center",
    gap: 10,
    padding: "10px 14px",
    borderRadius: 999,
    border: "1px solid #e2e8f0",
    background: "#0b1f3b",
    color: "white",
    fontWeight: 1000,
    textDecoration: "none",
    whiteSpace: "nowrap",
  };

  const faqWrap: React.CSSProperties = { marginTop: 14 };

  return (
    <div style={page}>
      {/* HERO (C6L-style: image + gradient overlay, text on image) */}
      <section style={heroWrap}>
        <div style={heroBg}>
          <div style={heroOverlay} />
          <div style={heroInner}>
            <div style={heroKicker}>Canada-wide vision • Safety-first • Structured process</div>

            <h1 style={h1}>Pass your road test - even if you don't own a motorcycle.</h1>

            <div style={lead}>
              BorrowMyBike connects test-takers with independent mentors who can meet at a registry with a road-test-ready
              motorcycle. Short, controlled use for registry road tests only — built around accountability and clear rules.
            </div>

            <div style={ctaRow}>
              <Link to="/mentors/start" style={primaryBtn}>
                I'm taking my road test →
              </Link>
              <Link to="/test-takers" style={secondaryBtn}>
                Earn $100 (list your bike) →
              </Link>
              <Link to="/browse" style={secondaryBtn}>
                Browse bikes →
              </Link>
            </div>
          </div>
        </div>

        {/* Links moved UNDER the image for legibility */}
        <div style={heroLinksWrap}>
          <Link to="/legal#damage" style={heroLink}>
            Damage &amp; responsibility →
          </Link>
          <Link to="/legal" style={heroLink}>
            Rules &amp; process →
          </Link>
          <Link to="/browse" style={heroLink}>
            Browse bikes →
          </Link>
        </div>
      </section>

      {/* Stripe trust block (right after solution) */}
      <section style={trustStrip}>
        <div style={trustLeft}>
          <div style={trustTitle}>Secure payments, payouts, and refunds — powered by Stripe.</div>
          <div style={trustSub}>
            Booking payments and deposits are processed securely. The platform enforces the written rules and records outcomes.
          </div>
        </div>

        <div style={chipRow}>
          <span style={chip}>Secure payments</span>
          <span style={chip}>Automatic payouts</span>
          <span style={chip}>Refund rules enforced</span>
        </div>
      </section>

      {/* Location selector (province + city only; registry happens at checkout) */}
      <section style={{ ...card, marginTop: 14 }}>
        <div style={sectionTitle}>Find a bike in your area - choose your province and city</div>
        <div style={{ ...muted, marginTop: 6, fontWeight: 650, lineHeight: 1.65 }}>
          We’re launching city-by-city. Alberta is live first — more provinces and cities are opening soon.
        </div>

        <div style={selectWrap}>
          <label style={selectLabel}>
            <span style={{ ...muted, fontSize: 13 }}>Province</span>
            <select
              value={prov}
              onChange={(e) => {
                const next = e.target.value as ProvinceCode | "";
                setProv(next);
                // reset city on province change
                const nextCities = next ? CITY_OPTIONS[next as ProvinceCode] : [];
                setCity(nextCities[0]?.slug ?? "");
              }}
              style={select}
            >
              <option value="">Select a province…</option>
              {PROVINCES.map((p) => (
                <option key={p.code} value={p.code} disabled={!isProvinceEnabled(p.code)}>
                  {provinceLabel(p.code)} {!isProvinceEnabled(p.code) ? " (soon)" : ""}
                </option>
              ))}
            </select>
          </label>

          <label style={selectLabel}>
            <span style={{ ...muted, fontSize: 13 }}>City</span>
            <select
              value={city}
              onChange={(e) => setCity(e.target.value)}
              style={select}
              disabled={!prov || !provinceEnabled || cityOptions.length === 0}
            >
              <option value="">{!prov ? "Select a province first…" : "Select a city…"}</option>
              {cityOptions.map((c) => (
                <option key={c.slug} value={c.slug}>
                  {c.name}
                </option>
              ))}
            </select>
          </label>

          <div style={{ display: "flex", alignItems: "flex-end" }}>
            <Link
              to={`/browse?province=${encodeURIComponent(prov || "")}&city=${encodeURIComponent(selectedCityName || "")}`}
              style={browseBtn}
            >
              Browse in {selectedCityName || "your city"} →
            </Link>
          </div>
        </div>

        <div style={{ ...muted, marginTop: 10, fontSize: 13, fontWeight: 650 }}>
          Note: registry selection happens at test taker booking - Registry quadrant shows on mentor dashboard, address visible after acceptance
        </div>
      </section>

      {/* How it works + mentor/test-taker value props */}
      <section style={grid2}>
        <div style={card}>
          <div style={sectionTitle}>How it works</div>
          <ol style={{ margin: "10px 0 0", paddingLeft: 22, ...muted, lineHeight: 1.7, fontWeight: 650 }}>
            <li>
              <b>Request a booking.</b> Choose a bike and select your registry at checkout.
            </li>
            <li>
              <b>Mentor accepts or declines.</b> Mentors stay in control and can decline any request.
            </li>
            <li>
              <b>Meet at the registry.</b> Complete the road test and return the bike immediately afterward.
            </li>
          </ol>

          <div style={{ ...muted, marginTop: 10, fontWeight: 700 }}>
            Payments, payouts, and refunds are handled securely through <b>Stripe</b>.
          </div>
        </div>

        <div style={card}>
          <div style={sectionTitle}>Mentor opportunity</div>
          <div style={{ ...muted, marginTop: 8, lineHeight: 1.7, fontWeight: 650 }}>
            Mentors earn <b>$100</b> for a completed booking. Bring your road-test-ready bike to the registry, wait nearby, and
            confirm you have your bike back when the test is done.
          </div>

          <div style={{ ...muted, marginTop: 10, lineHeight: 1.7, fontWeight: 650 }}>
            Deposits are for accountability (not “damage coverage”), and the platform applies the written rules consistently.
          </div>

          <div style={{ marginTop: 12 }}>
            <Link to="/mentors/start" style={browseBtn}>
              Start mentor onboarding →
            </Link>
          </div>
        </div>
      </section>

      <section style={grid3}>
        <div style={card}>
          <div style={smallCardTitle}>For test-takers</div>
          <div style={smallCardText}>
            Predictable steps, practical expectations, and less anxiety. Get matched with a road-test-ready bike and a mentor who
            can coordinate calmly before test day.
          </div>
        </div>

        <div style={card}>
          <div style={smallCardTitle}>For mentors</div>
          <div style={smallCardText}>
            Controlled scenario: registry road test only (short, monitored, and goal-oriented). Accept/decline any request. Earn
            $100 when complete.
          </div>
        </div>

        <div style={card}>
          <div style={smallCardTitle}>Trust &amp; enforcement</div>
          <div style={smallCardText}>
            Clear policies and documented outcomes. Secure payments, payouts, and refunds through Stripe.
          </div>
        </div>
      </section>

      {/* FAQ (accordion) */}
      <section style={{ ...card, ...faqWrap }}>
        <h2 style={{ margin: 0, fontWeight: 1100 as any, color: "#0f172a" }}>Common Questions</h2>
        <p style={{ ...muted, margin: "10px 0 0", maxWidth: 90 * 12, fontWeight: 650 }}>
          Expand only what you care about.
        </p>

        <div style={{ marginTop: 12 }}>
          <details className="bmb-acc">
            <summary>
              <span>Is this a rental business?</span>
              <span className="bmb-accHint"> no rentals</span>
            </summary>
            <div className="bmb-accBody">
              This is for <b>registry road tests only</b>. No recreational rentals and no joyrides. The purpose is a structured,
              safety-first process for completing a scheduled road test.
            </div>
          </details>

          <details className="bmb-acc">
            <summary>
              <span>How do payments work?</span>
              <span className="bmb-accHint"> Stripe</span>
            </summary>
            <div className="bmb-accBody">
              Payments, refunds, and payouts are processed securely through <b>Stripe</b>. The platform enforces the written
              rules and records outcomes to keep the process consistent.
            </div>
          </details>

          <details className="bmb-acc">
            <summary>
               <span>What do mentors earn?</span>
               <span className="bmb-accHint"> $100</span>
            </summary>
            <div className="bmb-accBody">
               Mentors earn <strong>$100</strong> for a completed booking after confirming the bike is returned.
            </div>
          </details>

          <details className="bmb-acc">
            <summary>
              <span>What about damage?</span>
              <span className="bmb-accHint"> responsibility</span>
            </summary>
            <div className="bmb-accBody">
              Road tests are short and controlled, but if something happens, responsibility follows the rules you accept at
              checkout and the standard insurance process. See{" "}
              <Link to="/legal#damage" style={{ fontWeight: 950 }}>
                Damage &amp; responsibility →
              </Link>
            </div>
          </details>

          <details className="bmb-acc">
           <summary>
             <span>What about deposits and no-shows?</span>
             <span className="bmb-accHint"> accountability</span>
           </summary>
           <div className="bmb-accBody">
             Deposits discourage no-shows and last-minute issues. If a road test cannot proceed due to one party's fault,
             the platform rules determine forfeiture and compensation.
           </div>
          </details>

          <details className="bmb-acc">
            <summary>
              <span>Can mentors decline requests?</span>
              <span className="bmb-accHint"> yes</span>
            </summary>
            <div className="bmb-accBody">
              Yes. Mentors stay in control and can decline any request (distance, schedule, comfort level, or any reason).
            </div>
          </details>

          <details className="bmb-acc">
            <summary>
              <span>Do mentors teach people how to ride?</span>
              <span className="bmb-accHint"> no lessons</span>
            </summary>
            <div className="bmb-accBody">
              No. This is not instruction. In-app messaging is for coordination and sharing experience-based safety tips — not
              lessons or last-minute coaching.
            </div>
          </details>

          <details className="bmb-acc">
           <summary>
             <span>How do cancellations work?</span>
             <span className="bmb-accHint"> rules</span>
           </summary>
           <div className="bmb-accBody">
             Once a booking is accepted it becomes confirmed. Cancellation outcomes depend on timing and fault scenarios
             as defined in the platform policies.
           </div>
         </details>
        </div>
      </section>
    </div>
  );
}

// src/pages/Home.tsx
import { useMemo, useState } from "react";
import { Link } from "react-router-dom";
import { PROVINCES, isProvinceEnabled, provinceLabel, type ProvinceCode } from "../lib/provinces";

type CityDef = { slug: string; name: string };

const CITY_OPTIONS: Record<ProvinceCode, CityDef[]> = {
  AB: [
    { slug: "calgary", name: "Calgary" },
    { slug: "edmonton", name: "Edmonton" },
    { slug: "red-deer", name: "Red Deer" },
    { slug: "lethbridge", name: "Lethbridge" },
    { slug: "medicine-hat", name: "Medicine Hat" },
    { slug: "grande-prairie", name: "Grande Prairie" },
    { slug: "fort-mcmurray", name: "Fort McMurray" },
  ],
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
    minHeight: 430,
    backgroundImage: "url(/hero-bike.jpeg)",
    backgroundSize: "cover",
    backgroundPosition: "center 62%",
  };

  const heroOverlay: React.CSSProperties = {
    position: "absolute",
    inset: 0,
    background:
      "linear-gradient(90deg, rgba(11,31,59,.72), rgba(11,31,59,.42), rgba(11,31,59,.14))",
  };

  const heroInner: React.CSSProperties = {
    position: "relative",
    padding: 18,
    maxWidth: 780,
  };

  const heroKicker: React.CSSProperties = {
    fontWeight: 700,
    color: "rgba(255,255,255,.88)",
    fontSize: 14,
    letterSpacing: ".01em",
  };

  const h1: React.CSSProperties = {
    margin: "10px 0 0",
    fontSize: 36,
    lineHeight: 1.08,
    letterSpacing: "-0.02em",
    fontWeight: 800,
    color: "white",
  };

  const lead: React.CSSProperties = {
    marginTop: 12,
    color: "rgba(255,255,255,.94)",
    lineHeight: 1.7,
    fontWeight: 500,
    maxWidth: 820,
  };

  const ctaRow: React.CSSProperties = {
  display: "flex",
  flexDirection: "column",
  gap: 12,
  marginTop: 16,
  alignItems: "flex-start",
};

  const primaryBtn: React.CSSProperties = {
    display: "inline-flex",
    alignItems: "center",
    gap: 10,
    padding: "10px 14px",
    borderRadius: 999,
    border: "1px solid rgba(255,255,255,.25)",
    background: "rgba(255,255,255,.16)",
    color: "white",
    fontWeight: 700,
    textDecoration: "none",
    whiteSpace: "nowrap",
  };

  const secondaryBtn: React.CSSProperties = {
    ...primaryBtn,
    background: "rgba(255,255,255,.08)",
    border: "1px solid rgba(255,255,255,.18)",
    fontWeight: 600,
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
    fontWeight: 600,
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
  const trustTitle: React.CSSProperties = { fontWeight: 700, color: "#0f172a" };
  const trustSub: React.CSSProperties = { ...muted, fontWeight: 400 };

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
    fontWeight: 600,
  };

  const sectionTitle: React.CSSProperties = {
    margin: 0,
    fontSize: 18,
    fontWeight: 700,
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

  const smallCardTitle: React.CSSProperties = { fontWeight: 700, color: "#0f172a" };
  const smallCardText: React.CSSProperties = { ...muted, marginTop: 6, lineHeight: 1.7, fontWeight: 400 };

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
    fontWeight: 600,
    minWidth: 240,
  };

  const select: React.CSSProperties = {
    padding: "10px 12px",
    borderRadius: 12,
    border: "1px solid #e2e8f0",
    background: "white",
    fontWeight: 600,
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
    fontWeight: 700,
    textDecoration: "none",
    whiteSpace: "nowrap",
  };

  const railCard: React.CSSProperties = {
    ...card,
    background: "linear-gradient(180deg, #ffffff, #f8fafc)",
  };

  const faqWrap: React.CSSProperties = { marginTop: 14 };

  return (
    <div style={page}>
      <section style={heroWrap}>
        <div style={heroBg}>
          <div style={heroOverlay} />
          <div style={heroInner}>
            <div style={heroKicker}>Registry road tests only • Safety-first • Structured process</div>

            <h1 style={h1}>Pass your road test even if you do not own a motorcycle.</h1>

            <div style={lead}>
              BorrowMyBike helps connect test-takers with independent mentors who can meet at a registry with a road-test-ready
              motorcycle. This is for short, controlled registry road tests only.
            </div>

            <div style={ctaRow}>
              <Link to="/test-takers" style={primaryBtn}>
                I&apos;m taking my road test →
              </Link>
              <Link to="/mentors/start" style={secondaryBtn}>
                List your bike • Earn $100 per road-test →
              </Link>
              <Link to="/browse" style={secondaryBtn}>
                Browse bikes →
              </Link>
            </div>
          </div>
        </div>

        <div style={{
  marginTop: 0,
  display: "flex",
  justifyContent: "center",   // centers horizontally
  alignItems: "center",
  flexWrap: "wrap",
  gap: 14,
  fontSize: 12,
  color: "#ffffff",
  opacity: 0.85,
  letterSpacing: 0.2,
  textAlign: "center"
}}>
             <span>Registry road tests only</span>
             <span>-  Secure payments via Stripe  -</span>
             <span>Mentors control bookings</span>
         </div>

        <div style={heroLinksWrap}>
          <Link to="/legal#damage" style={heroLink}>
            Damage &amp; responsibility →
          </Link>
          <Link to="/rules" style={heroLink}>
            Rules &amp; process →
          </Link>
          <Link to="/browse" style={heroLink}>
            Browse bikes →
          </Link>
        </div>
      </section>

      <section style={trustStrip}>
        <div style={trustLeft}>
          <div style={trustTitle}>Secure payments, payouts, and refunds — powered by Stripe.</div>
          <div style={trustSub}>
            Booking payments and deposits are processed securely, and the platform applies the written rules consistently.
          </div>
        </div>

        <div style={chipRow}>
          <span style={chip}>Secure payments</span>
          <span style={chip}>Automatic payouts</span>
          <span style={chip}>Refund rules enforced</span>
        </div>
      </section>

      <section style={{ ...card, marginTop: 14 }}>
        <div style={sectionTitle}>Find a bike in your area</div>
        <div style={{ ...muted, marginTop: 6, lineHeight: 1.65 }}>
          We&apos;re launching city by city. Alberta is live first, with more locations opening over time.
        </div>

        <div style={selectWrap}>
          <label style={selectLabel}>
            <span style={{ ...muted, fontSize: 13 }}>Province</span>
            <select
              value={prov}
              onChange={(e) => {
                const next = e.target.value as ProvinceCode | "";
                setProv(next);
                const nextCities = next ? CITY_OPTIONS[next as ProvinceCode] : [];
                setCity(nextCities[0]?.slug ?? "");
              }}
              style={select}
            >
              <option value="">Select a province…</option>
              {PROVINCES.map((p) => (
                <option key={p.code} value={p.code} disabled={!isProvinceEnabled(p.code)}>
                  {provinceLabel(p.code)} {!isProvinceEnabled(p.code) ? "(soon)" : ""}
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

        <div style={{ ...muted, marginTop: 10, fontSize: 13 }}>
          You&apos;ll choose the registry location during booking.
        </div>
      </section>

      <section style={grid2}>
        <div style={card}>
          <div style={sectionTitle}>How it works</div>
          <ol style={{ margin: "10px 0 0", paddingLeft: 22, ...muted, lineHeight: 1.7 }}>
            <li>
              <b>Request a booking.</b> Choose a bike and pick your registry during checkout.
            </li>
            <li>
              <b>The mentor reviews it.</b> Mentors can accept or decline any request.
            </li>
            <li>
              <b>Meet at the registry.</b> Complete the road test and return the bike right after.
            </li>
          </ol>

          <div style={{ ...muted, marginTop: 10 }}>
            Payments, payouts, and refunds are handled securely through <b>Stripe</b>.
          </div>
        </div>

        <div style={railCard}>
  <div style={sectionTitle}>Road test tips, guides, and checklists</div>

  <div style={{ ...muted, marginTop: 8, lineHeight: 1.7 }}>
    Detailed road test guides live on{" "}
    <a
      href="https://class6loaner.com/road-test-guide/"
      target="_blank"
      rel="noreferrer"
      style={{ fontWeight: 700, color: "#0f172a", textDecoration: "underline" }}
    >
      Class6Loaner.com
    </a>.
  </div>

  <div style={{ ...muted, marginTop: 10, fontSize: 14, lineHeight: 1.7 }}>
    Use Class6Loaner for road test prep, checklists, and test-day tips.
  </div>

  <div style={{ marginTop: 12, display: "flex", flexWrap: "wrap", gap: 12 }}>
    <a
      href="https://class6loaner.com/road-test-guide/"
      target="_blank"
      rel="noreferrer"
      style={browseBtn}
    >
      View road test guide →
    </a>

    <Link to="/browse" style={{ ...browseBtn, background: "white", color: "#0f172a" }}>
      Browse bikes →
    </Link>
  </div>
</div>
      </section>

      <section style={grid3}>
        <div style={card}>
          <div style={smallCardTitle}>For test-takers</div>
          <div style={smallCardText}>
            Clear steps, practical expectations, and less last-minute stress. Find a road-test-ready bike and coordinate with a
            mentor before test day.
          </div>
        </div>

        <div style={card}>
          <div style={smallCardTitle}>For mentors</div>
          <div style={smallCardText}>
            Controlled use at the registry, no recreational riding, and full control over whether to accept a request. Earn <strong>$100</strong>
            for a completed booking.
          </div>
        </div>

        <div style={card}>
          <div style={smallCardTitle}>Built around accountability</div>
          <div style={smallCardText}>
            Written rules, secure payments, documented outcomes, and a process designed for short registry road test bookings.
          </div>
        </div>
      </section>

      <section style={{ ...card, ...faqWrap }}>
        <h2 style={{ margin: 0, fontWeight: 700, color: "#0f172a" }}>Common questions</h2>
        <p style={{ ...muted, margin: "10px 0 0", maxWidth: 900 }}>
          Open the questions you want answered.
        </p>

        <div style={{ marginTop: 12 }}>
          <details className="bmb-acc">
            <summary>
              <span>Is this a rental business?</span>
            </summary>
            <div className="bmb-accBody">
              No. BorrowMyBike is for <b>registry road tests only</b>. No recreational rentals and no joyrides.
            </div>
          </details>

          <details className="bmb-acc">
            <summary>
              <span>How do payments work?</span>
            </summary>
            <div className="bmb-accBody">
              Payments, refunds, and payouts are processed securely through <b>Stripe</b>, and the platform applies the written
              rules consistently.
            </div>
          </details>

          <details className="bmb-acc">
            <summary>
              <span>What do mentors earn?</span>
            </summary>
            <div className="bmb-accBody">
              Mentors earn <strong>$100</strong> for a completed booking after confirming the bike is returned.
            </div>
          </details>

          <details className="bmb-acc">
            <summary>
              <span>What about damage?</span>
            </summary>
            <div className="bmb-accBody">
              If something goes wrong, responsibility follows the rules accepted during booking and the standard insurance process.
              See <Link to="/legal#damage"> Damage &amp; responsibility →</Link>
            </div>
          </details>

          <details className="bmb-acc">
            <summary>
              <span>What about deposits and no-shows?</span>
            </summary>
            <div className="bmb-accBody">
              Deposits discourage no-shows and last-minute problems. If a road test cannot proceed because of one party&apos;s fault,
              the platform rules decide forfeiture and compensation.
            </div>
          </details>

          <details className="bmb-acc">
            <summary>
              <span>Can mentors decline requests?</span>
            </summary>
            <div className="bmb-accBody">
              Yes. Mentors stay in control and can decline any request for scheduling, distance, comfort level, or any other
              reason.
            </div>
          </details>

          <details className="bmb-acc">
            <summary>
              <span>Do mentors teach people how to ride?</span>
            </summary>
            <div className="bmb-accBody">
              No. This platform is for coordination and road test access, not rider training or lessons.
            </div>
          </details>

          <details className="bmb-acc">
            <summary>
              <span>How do cancellations work?</span>
            </summary>
            <div className="bmb-accBody">
              Once a booking is accepted, cancellation outcomes depend on timing and fault scenarios as defined in the platform
              policies.
            </div>
          </details>
        </div>
      </section>
    </div>
  );
}

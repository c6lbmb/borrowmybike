// src/pages/Home.tsx
import { Link } from "react-router-dom";

export default function Home() {
  const page: React.CSSProperties = {
    maxWidth: 1280, // wider like deployed
    margin: "0 auto",
    padding: 16, // slightly tighter so the cards feel wider
  };

  const topCard: React.CSSProperties = {
    border: "1px solid #e2e8f0",
    borderRadius: 18,
    background: "white",
    padding: 18,
  };

  const topTitle: React.CSSProperties = {
    margin: 0,
    fontSize: 20,
    fontWeight: 900,
    color: "#0f172a",
    letterSpacing: -0.2,
  };

  const topSub: React.CSSProperties = {
    marginTop: 6,
    color: "#334155",
    fontWeight: 500,
    lineHeight: 1.6,
    fontSize: 16,
  };

  const chipRow: React.CSSProperties = {
    display: "flex",
    gap: 10,
    flexWrap: "wrap",
    alignItems: "center",
    marginTop: 12,
  };

  const chip: React.CSSProperties = {
    border: "1px solid #e2e8f0",
    background: "#f8fafc",
    borderRadius: 999,
    padding: "6px 10px",
    fontWeight: 700,
    color: "#334155",
    fontSize: 13,
  };

  const heroCard: React.CSSProperties = {
    marginTop: 14,
    border: "1px solid #e2e8f0",
    borderRadius: 18,
    background: "white",
    overflow: "hidden", // ensures image hits the edges cleanly
  };

  const heroInner: React.CSSProperties = {
    padding: 22,
    background: "white",
  };

  // Smaller like deployed (your localhost version was too huge)
  const h1: React.CSSProperties = {
    margin: 0,
    fontSize: 46,
    lineHeight: 1.05,
    letterSpacing: -0.8,
    fontWeight: 950,
    color: "#0f172a",
  };

  const lead: React.CSSProperties = {
    marginTop: 12,
    maxWidth: 980,
    color: "#334155",
    fontWeight: 500,
    fontSize: 17,
    lineHeight: 1.65,
  };

  const btnRow: React.CSSProperties = {
    display: "flex",
    gap: 10,
    flexWrap: "wrap",
    alignItems: "center",
    marginTop: 16,
  };

  const primaryBtn: React.CSSProperties = {
    display: "inline-flex",
    alignItems: "center",
    justifyContent: "center",
    padding: "10px 14px",
    borderRadius: 14,
    border: "1px solid #0f172a",
    background: "#0f172a",
    color: "white",
    fontWeight: 850,
    textDecoration: "none",
  };

  const secondaryBtn: React.CSSProperties = {
    display: "inline-flex",
    alignItems: "center",
    justifyContent: "center",
    padding: "10px 14px",
    borderRadius: 14,
    border: "1px solid #cbd5e1",
    background: "white",
    color: "#0f172a",
    fontWeight: 800,
    textDecoration: "none",
  };

  // Hero image: bigger, edge-to-edge, crisp corners
  const heroImg: React.CSSProperties = {
    width: "100%",
    height: 420, // bigger presence like deployed
    objectFit: "cover",
    display: "block",
    borderRadius: 0, // crisp
    background: "#f1f5f9",
  };

  const ownerFlow: React.CSSProperties = {
    padding: "14px 22px 18px 22px",
    color: "#334155",
    fontWeight: 500,
    lineHeight: 1.6,
    fontSize: 16,
    borderTop: "1px solid #f1f5f9",
    background: "white",
  };

  const ownerFlowStrong: React.CSSProperties = {
    fontWeight: 900,
    color: "#0f172a",
  };

  const grid3: React.CSSProperties = {
    marginTop: 14,
    display: "grid",
    gridTemplateColumns: "repeat(3, minmax(0, 1fr))",
    gap: 12,
  };

  const grid2: React.CSSProperties = {
    marginTop: 14,
    display: "grid",
    gridTemplateColumns: "repeat(2, minmax(0, 1fr))",
    gap: 12,
  };

  const card: React.CSSProperties = {
    border: "1px solid #e2e8f0",
    borderRadius: 18,
    background: "white",
    padding: 16,
  };

  const cardTitle: React.CSSProperties = {
    margin: 0,
    fontSize: 22,
    fontWeight: 950,
    letterSpacing: -0.25,
    color: "#0f172a",
  };

  const cardText: React.CSSProperties = {
    marginTop: 10,
    color: "#334155",
    fontWeight: 500,
    lineHeight: 1.65,
    fontSize: 16,
  };

  const smallLink: React.CSSProperties = {
    fontWeight: 800,
    color: "#4c1d95",
    textDecoration: "underline",
  };

  const bigCardTitle: React.CSSProperties = {
    margin: 0,
    fontSize: 28,
    fontWeight: 950,
    letterSpacing: -0.35,
    color: "#0f172a",
  };

  const bullets: React.CSSProperties = {
    margin: "12px 0 0 18px",
    color: "#334155",
    fontWeight: 500,
    lineHeight: 1.8,
    fontSize: 16,
  };

  const actionBtnRow: React.CSSProperties = {
    marginTop: 14,
    display: "flex",
    gap: 10,
    flexWrap: "wrap",
    alignItems: "center",
  };

  const faqWrap: React.CSSProperties = {
    marginTop: 14,
    border: "1px solid #e2e8f0",
    borderRadius: 18,
    background: "white",
    padding: 16,
  };

  const faqTitle: React.CSSProperties = {
    margin: 0,
    fontSize: 18,
    fontWeight: 950,
    color: "#0f172a",
  };

  const q: React.CSSProperties = {
    marginTop: 14,
    fontWeight: 900,
    color: "#0f172a",
  };

  const a: React.CSSProperties = {
    marginTop: 6,
    color: "#334155",
    fontWeight: 500,
    lineHeight: 1.65,
  };

  const HERO_SRC = "/hero-bike.jpeg";

  return (
    <div style={page}>
      {/* Top “deployed-style” info strip */}
      <div style={topCard}>
        <div style={topTitle}>Owners earn $100 for helping with a registry road test.</div>
        <div style={topSub}>
          Meet at the registry → wait nearby → confirm you have your bike back. Fees are compensation — not a rental.
        </div>
        <div style={chipRow}>
          <span style={chip}>Owner-controlled acceptance</span>
          <span style={chip}>Deposits for accountability</span>
          <span style={chip}>Canada-wide owner onboarding</span>
        </div>
      </div>

      {/* Main hero card */}
      <div style={heroCard}>
        <div style={heroInner}>
          <h1 style={h1}>Road-test matching — calm, structured, and built for accountability.</h1>

          <div style={lead}>
            We connect Test-Takers with independent Owners who are willing to meet at a registry for a scheduled road test.
            Fees are compensation for the owner’s time, fuel, and admin — not a recreational rental.
          </div>

          <div style={btnRow}>
            <Link to="/owners/start" style={primaryBtn}>Earn $100 (List your bike) →</Link>
            <Link to="/test-takers" style={secondaryBtn}>I’m taking my road test →</Link>
            <Link to="/browse" style={secondaryBtn}>Browse bikes →</Link>
          </div>
        </div>

        <img src={HERO_SRC} alt="Motorcycle on the road" style={heroImg} />

        <div style={ownerFlow}>
          <span style={ownerFlowStrong}>Owner flow:</span>{" "}
          meet at the registry → grab a coffee or run errands → after the test, confirm you have your bike back — and you’ve earned $100.
        </div>
      </div>

      {/* 3 small cards */}
      <div className="__grid3" style={grid3}>
        <div style={card}>
          <div style={cardTitle}>Clear purpose</div>
          <div style={cardText}>Road tests only. No joyrides, no recreational rentals.</div>
        </div>

        <div style={card}>
          <div style={cardTitle}>Transparent rules</div>
          <div style={cardText}>Published cancellation + deposit policies, enforced in-app.</div>
        </div>

        <div style={card}>
          <div style={cardTitle}>Insurance awareness</div>
          <div style={cardText}>
            Owners provide bikes under permissive use (not renting). See{" "}
            <Link to="/legal" style={smallLink}>Legal &amp; Policies</Link>.
          </div>
        </div>
      </div>

      {/* 2 big cards */}
      <div className="__grid2" style={grid2}>
        <div style={card}>
          <div style={bigCardTitle}>For owners</div>
          <ul style={bullets}>
            <li>Meet at the pre-arranged registry.</li>
            <li>Wait nearby (coffee, shopping, errands).</li>
            <li>After the test, confirm you have your bike back.</li>
            <li>That’s it — you earn $100.</li>
            <li>You choose which requests you accept.</li>
            <li>Deposits on both sides keep everyone accountable.</li>
          </ul>

          <div style={actionBtnRow}>
            <Link to="/owners/start" style={primaryBtn}>List your bike →</Link>
          </div>
        </div>

        <div style={card}>
          <div style={bigCardTitle}>For test-takers</div>
          <ul style={bullets}>
            <li>Choose a local bike for your registry road test.</li>
            <li>Arrive ready: helmet minimum + hands-free device for directions (AB for now).</li>
            <li>Rules + deposits reduce no-shows and last-minute issues.</li>
          </ul>

          <div style={actionBtnRow}>
            <Link to="/test-takers" style={primaryBtn}>How it works + get notified →</Link>
          </div>
        </div>
      </div>

      {/* FAQ */}
      <div style={faqWrap}>
        <div style={faqTitle}>FAQ</div>

        <div style={q}>Are you a rental company?</div>
        <div style={a}>
          No. BorrowMyBike is a matching platform for registry road tests only. Fees compensate the owner for time, fuel, and admin —
          it’s not a recreational rental.
        </div>

        <div style={q}>How does the Owner earn $100?</div>
        <div style={a}>
          Owners meet at the registry, wait nearby, and after the test they confirm they have their bike back. Once possession is confirmed,
          payout is released.
        </div>

        <div style={q}>Why does the Owner put up a $150 deposit?</div>
        <div style={a}>
          To keep the owner accountable. If the owner doesn’t show or the bike isn’t road-worthy at the registry appointment, the deposit can
          be used to compensate the test-taker to reduce rebooking risk.
        </div>

        <div style={q}>What about insurance?</div>
        <div style={a}>
          Bikes are provided under permissive use (not renting). Owners should confirm coverage with their insurer and ensure valid registration
          and insurance. Test-takers may be responsible for loss or damage during the test.
        </div>

        <div style={{ marginTop: 12, color: "#334155", fontWeight: 500 }}>
          More details are available in the{" "}
          <Link to="/legal" style={smallLink}>Legal &amp; Policies</Link>{" "}
          and{" "}
          <Link to="/rules" style={smallLink}>Rules &amp; Process</Link>{" "}
          pages.
        </div>
      </div>

      {/* Responsive */}
      <style>{`
        @media (max-width: 980px) {
          .__grid3 { grid-template-columns: 1fr !important; }
          .__grid2 { grid-template-columns: 1fr !important; }
        }
        @media (max-width: 640px) {
          h1 { font-size: 38px !important; }
        }
      `}</style>
    </div>
  );
}

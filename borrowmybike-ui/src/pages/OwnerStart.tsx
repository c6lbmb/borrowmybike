// src/pages/OwnerStart.tsx
import { Link } from "react-router-dom";

export default function OwnerStart() {
  const page: React.CSSProperties = { maxWidth: 900, margin: "0 auto", padding: "22px 18px 60px" };

  const card: React.CSSProperties = {
    marginTop: 14,
    padding: 16,
    border: "1px solid #e2e8f0",
    borderRadius: 18,
    background: "white",
  };

  const pillRow: React.CSSProperties = {
    display: "flex",
    gap: 10,
    flexWrap: "wrap",
    alignItems: "center",
    color: "#334155",
    fontWeight: 800,
    fontSize: 13,
  };

  const h1: React.CSSProperties = { margin: 0, fontSize: 34, fontWeight: 1000, letterSpacing: -0.3 };
  const sub: React.CSSProperties = { marginTop: 8, color: "#475569", fontWeight: 800, lineHeight: 1.5 };

  const btn: React.CSSProperties = {
    padding: "12px 14px",
    borderRadius: 14,
    border: "1px solid #0f172a",
    fontWeight: 950,
    cursor: "pointer",
    background: "white",
    color: "#0f172a",
    textDecoration: "none",
    display: "inline-flex",
    alignItems: "center",
    gap: 8,
  };

  const btnPrimary: React.CSSProperties = {
    ...btn,
    background: "#0f172a",
    color: "white",
  };

  const li: React.CSSProperties = { marginTop: 8, color: "#334155", fontWeight: 800, lineHeight: 1.55 };

  const mobileCss = `
    @media (max-width: 640px) {
      .btnRow { flex-direction: column; align-items: stretch !important; }
      .btnRow a { width: 100%; justify-content: center; }
      .grid2 { grid-template-columns: 1fr !important; }
    }
  `;

  return (
    <div style={page}>
      <style>{mobileCss}</style>

      <div style={pillRow}>
        <span>Road tests only</span>
        <span>•</span>
        <span>Not a rental company</span>
        <span>•</span>
        <span>Mentors can list Canada-wide</span>
      </div>

      <h1 style={h1}>Earn $100 helping a test-taker</h1>
      <div style={sub}>
        You meet at the pre-arranged registry, hand over the bike for the road test, then you’re free — coffee, errands,
        shopping. After the test, you confirm <b>you have your bike back</b> in the app and you earn <b>$100</b>.
      </div>

      <div className="btnRow" style={{ marginTop: 14, display: "flex", gap: 10, flexWrap: "wrap", alignItems: "center" }}>
        <Link to="/mentors/new" style={btnPrimary}>
          Start / Edit my bike →
        </Link>
        <Link to="/dashboard/mentor" style={btn}>
          Mentor dashboard
        </Link>
        <Link to="/browse" style={btn}>
          Browse
        </Link>
      </div>

      {/* How it works */}
      <div style={card}>
        <div style={{ fontWeight: 1000, fontSize: 18 }}>How it works (mentor)</div>

        <div style={{ marginTop: 10 }}>
          <div style={li}>1) List your bike (scooters + small bikes welcome).</div>
          <div style={li}>2) A test-taker requests your bike for their registry appointment.</div>
          <div style={li}>
            3) You accept by placing a <b>$150 mentor deposit</b>.
          </div>
          <div style={li}>
            4) Meet at the registry. During the test, you’re free — coffee or errands.
          </div>
          <div style={li}>
            5) After the test, confirm <b>you have your bike back</b>. You receive <b>$100</b>.
          </div>
        </div>

        <div style={{ marginTop: 12, color: "#64748b", fontWeight: 800 }}>
          You control who you help. You can decline any request.
        </div>
      </div>

      {/* Why deposit */}
      <div style={card}>
        <div style={{ fontWeight: 1000, fontSize: 18 }}>Why do mentors put up a $150 deposit?</div>
        <div style={{ marginTop: 8, color: "#334155", fontWeight: 800, lineHeight: 1.55 }}>
          It’s for accountability. If an mentor doesn’t show up, or the bike isn’t road-worthy at the registry, that
          deposit can be used to compensate the test-taker so they can rebook their registry test. This reduces the risk
          for serious test-takers and keeps the platform fair.
        </div>
      </div>

      {/* What owners do */}
      <div style={card}>
        <div style={{ fontWeight: 1000, fontSize: 18 }}>What do I do during the test?</div>
        <div style={{ marginTop: 8, color: "#334155", fontWeight: 800, lineHeight: 1.55 }}>
          You don’t participate in the test. You meet at the registry, hand over the bike, and wait nearby or leave for a
          bit — coffee, shopping, errands. After the test, you meet again, the bike is returned, and you confirm you have
          it back in the app.
        </div>

        <div style={{ marginTop: 10, color: "#0f172a", fontWeight: 950 }}>
          Simple: registry → coffee → confirm your bike is back → $100.
        </div>
      </div>

      {/* Safety + documents */}
      <div style={card}>
        <div style={{ fontWeight: 1000, fontSize: 18 }}>Safety &amp; common sense (recommended)</div>
        <div style={{ marginTop: 10 }}>
          <div style={li}>• Bring your keys and valid registration + insurance papers.</div>
          <div style={li}>• We recommend taking a photo of the test-taker’s ID before handing over the bike.</div>
          <div style={li}>• Meet in a visible spot at the registry and keep communication clear.</div>
          <div style={li}>• In-app messaging will be enabled so you can coordinate easily.</div>
        </div>

        <div style={{ marginTop: 12, color: "#64748b", fontWeight: 800 }}>
          Full terms and cancellation rules are listed in Legal.
        </div>

        <div className="btnRow" style={{ marginTop: 12, display: "flex", gap: 10, flexWrap: "wrap", alignItems: "center" }}>
          <Link to="/legal" style={btn}>
            Legal / Policies →
          </Link>
          <Link to="/legal#cancellations" style={btn}>
            Cancellation policy →
          </Link>
        </div>
      </div>

      {/* Insurance quick note */}
      <div style={card}>
        <div style={{ fontWeight: 1000, fontSize: 18 }}>Insurance (plain English)</div>
        <div style={{ marginTop: 8, color: "#334155", fontWeight: 800, lineHeight: 1.55 }}>
          Bikes are provided under <b>permissive use</b> (not renting). Mentors should confirm coverage with their insurer.
          Test-takers may be responsible for loss or damage during the test. BorrowMyBike is a matching platform — not an
          insurer.
        </div>
      </div>
    </div>
  );
}

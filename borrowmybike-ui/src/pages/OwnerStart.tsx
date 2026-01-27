// src/pages/OwnerStart.tsx
import { Link } from "react-router-dom";

export default function OwnerStart() {
  const card: React.CSSProperties = {
    marginTop: 14,
    padding: 14,
    border: "1px solid #e2e8f0",
    borderRadius: 18,
    background: "white",
  };

  const btn: React.CSSProperties = {
    padding: "10px 12px",
    borderRadius: 14,
    border: "1px solid #0f172a",
    fontWeight: 900,
    cursor: "pointer",
    background: "white",
    color: "#0f172a",
    textDecoration: "none",
    display: "inline-block",
  };

  const btnPrimary: React.CSSProperties = {
    ...btn,
    background: "#0f172a",
    color: "white",
  };

  const mobileCss = `
    @media (max-width: 640px) {
      .btnRow { flex-direction: column; align-items: stretch !important; }
      .btnRow a { width: 100%; text-align: center; }
    }
  `;

  return (
    <div style={{ padding: "2rem" }}>
      <style>{mobileCss}</style>

      <h1 style={{ margin: 0 }}>List your bike</h1>
      <div style={{ marginTop: 6, color: "#64748b", fontWeight: 700 }}>
        Owners help test-takers and earn money. Keep it simple and safe.
      </div>

      <div style={card}>
        <div style={{ fontWeight: 900, fontSize: 16 }}>How it works (owner)</div>
        <ul style={{ marginTop: 10, color: "#334155", fontWeight: 700, lineHeight: 1.6 }}>
          <li>You list 1 bike.</li>
          <li>Borrowers request bookings.</li>
          <li>You accept (later: acceptance window).</li>
          <li>After completion, you get paid (manual until Stripe Connect).</li>
          <li>You can boost your listing (revenue for the platform).</li>
        </ul>

        <div className="btnRow" style={{ marginTop: 14, display: "flex", gap: 10, flexWrap: "wrap", alignItems: "center" }}>
          <Link to="/owners/new" style={btnPrimary}>
            Start / Edit my bike →
          </Link>
          <Link to="/dashboard/owner" style={btn}>
            Owner dashboard
          </Link>
          <Link to="/browse" style={btn}>
            Browse
          </Link>
        </div>
      </div>

      <div style={card}>
        <div style={{ fontWeight: 900 }}>Next features we’ll add</div>
        <div style={{ marginTop: 8, color: "#64748b", fontWeight: 800 }}>
          Photos, availability/blackout times, and an “accept within X minutes” flow. Not touching backend today.
        </div>
      </div>
    </div>
  );
}

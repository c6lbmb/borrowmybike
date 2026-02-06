// src/pages/Dashboard.tsx
import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { useAuth } from "../auth/useAuth";
import { sb } from "../lib/supabase";

import OwnerDashboard from "./OwnerDashboard";
import BorrowerDashboard from "./BorrowerDashboard";

export default function Dashboard() {
  const { user } = useAuth();
  const me = user?.id;

  const [loading, setLoading] = useState(true);
  const [err, setErr] = useState<string | null>(null);
  const [hasBike, setHasBike] = useState<boolean>(false);

  useEffect(() => {
    let alive = true;

    async function run() {
      if (!me) {
        setLoading(false);
        return;
      }

      setLoading(true);
      setErr(null);

      const res = await sb.from("bikes").select("id").eq("owner_id", me).limit(1);

      if (!alive) return;

      if (res.error) {
        setErr(res.error.message);
        setLoading(false);
        return;
      }

      setHasBike(Array.isArray(res.data) && res.data.length > 0);
      setLoading(false);
    }

    run();
    return () => {
      alive = false;
    };
  }, [me]);

  const page: React.CSSProperties = { padding: "2rem" };
  const card: React.CSSProperties = { marginTop: 14, padding: 14, border: "1px solid #e2e8f0", borderRadius: 14, background: "white" };

  if (!me) {
    return (
      <div style={page}>
        <h1>Dashboard</h1>
        <div style={card}>
          <div style={{ fontWeight: 900 }}>You’re not signed in.</div>
          <div style={{ marginTop: 10 }}>
            Go to <Link to="/signin">Sign in</Link>.
          </div>
        </div>
      </div>
    );
  }

  if (loading) {
    return (
      <div style={page}>
        <h1>Dashboard</h1>
        <div style={{ color: "#475569", fontWeight: 650 }}>Loading your dashboard (Mentor vs Borrower)…</div>

        <div style={card}>
          <div style={{ fontWeight: 900 }}>Signed in as</div>
          <div style={{ marginTop: 6, color: "#334155", fontWeight: 800 }}>{user?.email || me}</div>

          {err ? (
            <div style={{ marginTop: 12, background: "#fff1f2", border: "1px solid #fecaca", color: "#9f1239", borderRadius: 14, padding: 12, fontWeight: 900 }}>
              Error: {err}
              <div style={{ marginTop: 10, color: "#334155", fontWeight: 800 }}>
                Temporary links: <Link to="/browse">Browse</Link> • <Link to="/testing">Friend Testing</Link>
              </div>
            </div>
          ) : (
            <div style={{ marginTop: 12, color: "#64748b", fontWeight: 800 }}>Checking your role…</div>
          )}
        </div>
      </div>
    );
  }

  // Default landing behavior:
  // - hasBike → owner dashboard
  // - no bike → borrower dashboard
  return hasBike ? <OwnerDashboard /> : <BorrowerDashboard />;
}

// src/pages/DashboardRouter.tsx
import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { sb } from "../lib/supabase";
import { useAuth } from "../auth/useAuth";

import OwnerDashboard from "./OwnerDashboard";
import BorrowerDashboard from "./BorrowerDashboard";

type Mode = "borrower" | "owner";

function storageKey(userId: string) {
  return `dashboard_mode_${userId}`;
}

function readSavedMode(userId: string): Mode | null {
  try {
    const v = sessionStorage.getItem(storageKey(userId));
    return v === "owner" || v === "borrower" ? v : null;
  } catch {
    return null;
  }
}

function saveMode(userId: string, mode: Mode) {
  try {
    sessionStorage.setItem(storageKey(userId), mode);
  } catch {
    // ignore
  }
}

export default function DashboardRouter() {
  const { user } = useAuth();
  const userId = user?.id || null;

  const [loading, setLoading] = useState(true);
  const [hasBike, setHasBike] = useState(false);

  // ✅ THIS fixes your “buttons don’t go anywhere” bug:
  const [mode, setMode] = useState<Mode | null>(null);

  useEffect(() => {
    let cancelled = false;

    async function run() {
      if (!userId) {
        setHasBike(false);
        setMode(null);
        setLoading(false);
        return;
      }

      setLoading(true);

      const { data, error } = await sb
        .from("bikes")
        .select("id")
        .eq("owner_id", userId)
        .limit(1);

      const _hasBike = !error && (data?.length ?? 0) > 0;

      if (cancelled) return;

      setHasBike(_hasBike);

      // Load saved choice (if any)
      const saved = readSavedMode(userId);

      // ✅ Default behavior: if you have a bike, assume Owner unless you explicitly choose Borrower.
      // This removes confusion for owners.
      const initial: Mode = saved ?? (_hasBike ? "owner" : "borrower");

      setMode(initial);
      setLoading(false);
    }

    run();
    return () => {
      cancelled = true;
    };
  }, [userId]);

  // Not signed in
  if (!userId) {
    return (
      <div style={{ padding: 16 }}>
        <h2 style={{ margin: 0 }}>Dashboard</h2>
        <p style={{ color: "#4b5563", fontWeight: 700 }}>You’re not signed in.</p>
        <Link to="/auth" style={{ fontWeight: 900 }}>
          Go to Account →
        </Link>
      </div>
    );
  }

  if (loading || !mode) {
    return (
      <div style={{ padding: 16 }}>
        <h2 style={{ margin: 0 }}>Dashboard</h2>
        <p style={{ color: "#4b5563", fontWeight: 700 }}>Loading…</p>
      </div>
    );
  }

  // If user has no bike, borrower only.
  if (!hasBike) return <BorrowerDashboard />;

  // If they have a bike, render selected mode dashboard, with a clean switcher at top.
  const Switcher = () => (
    <div
      style={{
        marginBottom: 14,
        background: "white",
        border: "1px solid #e2e8f0",
        borderRadius: 16,
        padding: 12,
        display: "flex",
        justifyContent: "space-between",
        alignItems: "center",
        gap: 12,
        flexWrap: "wrap",
      }}
    >
      <div style={{ fontWeight: 950 }}>
        Viewing:{" "}
        <span style={{ color: "#0f172a" }}>
          {mode === "owner" ? "Owner dashboard" : "Borrower dashboard"}
        </span>
      </div>

      <div style={{ display: "flex", gap: 10, flexWrap: "wrap" }}>
        <button
          onClick={() => {
            saveMode(userId, "borrower");
            setMode("borrower");
          }}
          style={{
            padding: "10px 14px",
            borderRadius: 14,
            border: "1px solid #cbd5e1",
            background: mode === "borrower" ? "#0f172a" : "white",
            color: mode === "borrower" ? "white" : "#0f172a",
            fontWeight: 950,
            cursor: "pointer",
          }}
        >
          Borrower
        </button>

        <button
          onClick={() => {
            saveMode(userId, "owner");
            setMode("owner");
          }}
          style={{
            padding: "10px 14px",
            borderRadius: 14,
            border: "1px solid #cbd5e1",
            background: mode === "owner" ? "#0f172a" : "white",
            color: mode === "owner" ? "white" : "#0f172a",
            fontWeight: 950,
            cursor: "pointer",
          }}
        >
          Owner
        </button>
      </div>
    </div>
  );

  return (
    <div style={{ padding: 0 }}>
      <Switcher />
      {mode === "owner" ? <OwnerDashboard /> : <BorrowerDashboard />}
    </div>
  );
}

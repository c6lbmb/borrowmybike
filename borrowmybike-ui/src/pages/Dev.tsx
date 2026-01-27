// src/pages/Dev.tsx
import { useEffect, useState } from "react";
import type { Session } from "@supabase/supabase-js";
import { sb, ENV } from "../lib/supabase";

const CF_TEST_UI = "https://c6l-test2.class6loaner.workers.dev/";

export default function Dev() {
  const [session, setSession] = useState<Session | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    sb.auth.getSession().then(({ data }) => setSession(data.session ?? null));
    const { data: sub } = sb.auth.onAuthStateChange((_evt, s) => setSession(s));
    return () => sub.subscription.unsubscribe();
  }, []);

  async function signOut() {
    setBusy(true);
    try {
      await sb.auth.signOut();
    } finally {
      setBusy(false);
    }
  }

  const card: React.CSSProperties = {
    background: "white",
    border: "1px solid #e2e8f0",
    borderRadius: 18,
    padding: 16,
    boxShadow: "0 2px 10px rgba(0,0,0,0.04)",
  };

  const btn: React.CSSProperties = {
    padding: "10px 12px",
    borderRadius: 14,
    border: "1px solid #0f172a",
    fontWeight: 900,
    cursor: "pointer",
    background: "white",
    color: "#0f172a",
  };

  const btnPrimary: React.CSSProperties = {
    ...btn,
    background: "#0f172a",
    color: "white",
  };

  return (
    <div style={{ padding: "2rem" }}>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "end", gap: 10, flexWrap: "wrap" }}>
        <div>
          <h1 style={{ margin: 0 }}>Dev Tools</h1>
          <div style={{ marginTop: 6, color: "#64748b", fontWeight: 700 }}>
            Local sanity checks + quick jump to Cloudflare Friend Testing UI.
          </div>
        </div>
        <a href={CF_TEST_UI} target="_blank" rel="noreferrer" style={{ fontWeight: 900 }}>
          Open Cloudflare Friend Testing →
        </a>
      </div>

      <div style={{ ...card, marginTop: 14 }}>
        <div style={{ fontWeight: 900, marginBottom: 8 }}>Environment</div>
        <div style={{ color: "#334155", fontWeight: 800 }}>
          Supabase URL: <span style={{ fontFamily: "monospace" }}>{ENV.SUPABASE_URL || "MISSING"}</span>
        </div>
        <div style={{ color: "#334155", fontWeight: 800, marginTop: 6 }}>
          Functions Base: <span style={{ fontFamily: "monospace" }}>{ENV.FUNCTIONS_BASE || "MISSING"}</span>
        </div>
      </div>

      <div style={{ ...card, marginTop: 14 }}>
        <div style={{ fontWeight: 900, marginBottom: 8 }}>Session</div>

        {session ? (
          <>
            <div style={{ color: "#334155", fontWeight: 800 }}>
              Signed in as: <b>{session.user.email}</b>
            </div>
            <div style={{ marginTop: 6, color: "#334155", fontWeight: 800 }}>
              user_id: <span style={{ fontFamily: "monospace" }}>{session.user.id}</span>
            </div>
            <div style={{ marginTop: 6, color: "#334155", fontWeight: 800 }}>
              access_token: <span style={{ fontFamily: "monospace" }}>{session.access_token.slice(0, 16)}…</span>
            </div>

            <div style={{ marginTop: 12, display: "flex", gap: 10, flexWrap: "wrap" }}>
              <button style={btnPrimary} onClick={() => (window.location.href = "/dashboard")}>
                Go to Dashboard
              </button>
              <button style={btn} onClick={signOut} disabled={busy}>
                Sign out
              </button>
            </div>
          </>
        ) : (
          <>
            <div style={{ color: "#64748b", fontWeight: 800 }}>Not signed in.</div>
            <div style={{ marginTop: 12 }}>
              <button style={btnPrimary} onClick={() => (window.location.href = "/auth")}>
                Go to Sign in
              </button>
            </div>
          </>
        )}
      </div>

      <div
        style={{
          ...card,
          marginTop: 14,
          background: "#fff7ed",
          border: "1px solid #fed7aa",
          color: "#7c2d12",
          fontWeight: 800,
        }}
      >
        Friends should test ONLY on the Cloudflare UI. This Vite app is for Launch UI building.
      </div>
    </div>
  );
}

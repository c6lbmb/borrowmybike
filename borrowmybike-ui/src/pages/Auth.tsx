// src/pages/Auth.tsx
import { useMemo, useState } from "react";
import { useNavigate, useSearchParams } from "react-router-dom";
import { useAuth } from "../auth/useAuth";

export default function AuthPage() {
  const { user, signIn, signUp, signOut } = useAuth();
  const [params] = useSearchParams();
  const navigate = useNavigate();

  const next = useMemo(() => params.get("next") || "/dashboard", [params]);

  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);

  function flash(ok: boolean, text: string) {
    setMsg({ ok, text });
    setTimeout(() => setMsg(null), 3500);
  }

  async function doSignIn() {
    setBusy(true);
    try {
      const r = await signIn(email, password);
      if (!r.ok) return flash(false, r.error || "Sign in failed");
      flash(true, "Signed in ✅");
      navigate(next);
    } finally {
      setBusy(false);
    }
  }

  async function doSignUp() {
    setBusy(true);
    try {
      const r = await signUp(email, password);
      if (!r.ok) return flash(false, r.error || "Sign up failed");
      flash(true, "Signed up ✅ (check email confirmation settings if required)");
    } finally {
      setBusy(false);
    }
  }

  async function doSignOut() {
    setBusy(true);
    try {
      await signOut();
      flash(true, "Signed out ✅");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div style={{ background: "white", border: "1px solid #e2e8f0", borderRadius: 18, padding: 18 }}>
      <h1 style={{ margin: 0, fontSize: 22 }}>Sign in</h1>
      <p style={{ marginTop: 8, color: "#475569", fontWeight: 650 }}>
        Dashboard is protected. Friend Testing stays public.
      </p>

      {msg && (
        <div
          style={{
            marginTop: 12,
            borderRadius: 14,
            padding: "10px 12px",
            border: `1px solid ${msg.ok ? "#bbf7d0" : "#fecaca"}`,
            background: msg.ok ? "#ecfdf5" : "#fff1f2",
            color: msg.ok ? "#065f46" : "#9f1239",
            fontWeight: 900,
          }}
        >
          {msg.text}
        </div>
      )}

      {user ? (
        <div style={{ marginTop: 14 }}>
          <div style={{ fontWeight: 900 }}>Signed in as:</div>
          <div style={{ marginTop: 6, color: "#334155", fontWeight: 800 }}>{user.email}</div>
          <button
            onClick={doSignOut}
            disabled={busy}
            style={{
              marginTop: 14,
              border: "1px solid #b00020",
              background: "#b00020",
              color: "white",
              padding: "10px 12px",
              borderRadius: 14,
              fontWeight: 900,
              cursor: "pointer",
            }}
          >
            Sign out
          </button>
        </div>
      ) : (
        <>
          <div style={{ marginTop: 14, display: "grid", gridTemplateColumns: "1fr 1fr", gap: 10 }}>
            <div>
              <div style={{ fontSize: 12, fontWeight: 900, color: "#334155" }}>Email</div>
              <input
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                placeholder="email"
                style={{ width: "100%", marginTop: 6, padding: 10, borderRadius: 14, border: "1px solid #e2e8f0" }}
              />
            </div>
            <div>
              <div style={{ fontSize: 12, fontWeight: 900, color: "#334155" }}>Password</div>
              <input
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                placeholder="password"
                type="password"
                style={{ width: "100%", marginTop: 6, padding: 10, borderRadius: 14, border: "1px solid #e2e8f0" }}
              />
            </div>
          </div>

          <div style={{ marginTop: 12, display: "flex", gap: 8, flexWrap: "wrap" }}>
            <button
              onClick={doSignIn}
              disabled={busy}
              style={{
                border: "1px solid #111827",
                background: "#111827",
                color: "white",
                padding: "10px 12px",
                borderRadius: 14,
                fontWeight: 900,
                cursor: "pointer",
              }}
            >
              Sign in
            </button>
            <button
              onClick={doSignUp}
              disabled={busy}
              style={{
                border: "1px solid #111827",
                background: "white",
                color: "#111827",
                padding: "10px 12px",
                borderRadius: 14,
                fontWeight: 900,
                cursor: "pointer",
              }}
            >
              Sign up
            </button>
          </div>
        </>
      )}
    </div>
  );
}

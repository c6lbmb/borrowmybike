// src/pages/Auth.tsx
import { useMemo, useState } from "react";
import { useNavigate, useSearchParams } from "react-router-dom";
import { useAuth } from "../auth/useAuth";

type AuthMode = "signin" | "signup";

export default function AuthPage() {
  const { user, signIn, signUp, signOut } = useAuth();
  const [params, setParams] = useSearchParams();
  const navigate = useNavigate();

  const next = useMemo(() => params.get("next") || "/dashboard", [params]);

  const rawMode = (params.get("mode") || "").toLowerCase();
  const mode: AuthMode = rawMode === "signup" ? "signup" : "signin";

  const [fullName, setFullName] = useState("");
  const [city, setCity] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);

  function flash(ok: boolean, text: string) {
    setMsg({ ok, text });
    setTimeout(() => setMsg(null), 3500);
  }

  function setMode(nextMode: AuthMode) {
    const nextParams = new URLSearchParams(params);
    nextParams.set("mode", nextMode);
    setParams(nextParams, { replace: true });
  }

  function getFirstNameFromFullName(value: string) {
    return value.trim().split(/\s+/)[0] || "";
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
    const cleanFullName = fullName.trim();
    const cleanCity = city.trim();

    if (!cleanFullName) {
      flash(false, "Please enter your full name.");
      return;
    }

    if (!cleanCity) {
      flash(false, "Please enter your city.");
      return;
    }

    setBusy(true);
    try {
      const r = await signUp(email, password, {
        fullName: cleanFullName,
        firstName: getFirstNameFromFullName(cleanFullName),
        city: cleanCity,
      });
      if (!r.ok) return flash(false, r.error || "Sign up failed");

      setMsg({
        ok: true,
        text: "Account created ✅ Go to your email now and click the confirmation link to activate your BorrowMyBike account. The email may take a minute and could land in spam.",
      });

      setFullName("");
      setCity("");
      setEmail("");
      setPassword("");
      setMode("signin");
      window.scrollTo({ top: 0, behavior: "smooth" });
      return;
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

  async function onPrimaryAction() {
    if (mode === "signup") {
      await doSignUp();
      return;
    }
    await doSignIn();
  }

  const cardStyle: React.CSSProperties = {
    background: "white",
    border: "1px solid #e2e8f0",
    borderRadius: 18,
    padding: 18,
  };

  const modeButton = (active: boolean): React.CSSProperties => ({
    flex: 1,
    padding: "10px 12px",
    borderRadius: 14,
    border: active ? "1px solid #111827" : "1px solid #cbd5e1",
    background: active ? "#111827" : "white",
    color: active ? "white" : "#111827",
    fontWeight: 900,
    cursor: "pointer",
  });

  const labelStyle: React.CSSProperties = {
    fontSize: 12,
    fontWeight: 900,
    color: "#334155",
  };

  const inputStyle: React.CSSProperties = {
    width: "100%",
    marginTop: 6,
    padding: 10,
    borderRadius: 14,
    border: "1px solid #e2e8f0",
  };

  return (
    <div style={cardStyle}>
      <div
        style={{
          display: "grid",
          gridTemplateColumns: "1fr 1fr",
          gap: 8,
          marginBottom: 14,
        }}
      >
        <button
          type="button"
          onClick={() => {
            setMsg(null);
            setMode("signin");
          }}
          style={modeButton(mode === "signin")}
        >
          Sign in
        </button>
        <button
          type="button"
          onClick={() => {
            setMsg(null);
            setMode("signup");
          }}
          style={modeButton(mode === "signup")}
        >
          Create account
        </button>
      </div>

      <h1 style={{ margin: 0, fontSize: 22 }}>
        {mode === "signup" ? "Create your account" : "Sign in"}
      </h1>

      <p style={{ marginTop: 8, color: "#475569", fontWeight: 650, lineHeight: 1.55 }}>
        {mode === "signup"
          ? "Create your account, then check your email for a confirmation link before signing in."
          : "Sign in to access your dashboard and manage bookings."}
      </p>

      {msg && (
        <div
          style={{
            marginTop: 12,
            borderRadius: 16,
            padding: "14px 16px",
            border: `2px solid ${msg.ok ? "#86efac" : "#fecaca"}`,
            background: msg.ok ? "#f0fdf4" : "#fff1f2",
            color: msg.ok ? "#166534" : "#9f1239",
            fontWeight: 900,
            fontSize: 16,
            lineHeight: 1.5,
            boxShadow: msg.ok ? "0 8px 24px rgba(22,101,52,0.08)" : "none",
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
          <div
            style={{
              marginTop: 14,
              display: "grid",
              gridTemplateColumns: "1fr 1fr",
              gap: 10,
            }}
          >
            {mode === "signup" && (
              <>
                <div>
                  <div style={labelStyle}>Full name</div>
                  <input
                    value={fullName}
                    onChange={(e) => setFullName(e.target.value)}
                    placeholder="Full name"
                    autoComplete="name"
                    style={inputStyle}
                  />
                </div>
                <div>
                  <div style={labelStyle}>City</div>
                  <input
                    value={city}
                    onChange={(e) => setCity(e.target.value)}
                    placeholder="City"
                    autoComplete="address-level2"
                    style={inputStyle}
                  />
                </div>
              </>
            )}

            <div>
              <div style={labelStyle}>Email</div>
              <input
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                placeholder="email"
                autoComplete="email"
                style={inputStyle}
              />
            </div>
            <div>
              <div style={labelStyle}>Password</div>
              <input
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                placeholder="password"
                type="password"
                autoComplete={mode === "signup" ? "new-password" : "current-password"}
                onKeyDown={(e) => {
                  if (e.key === "Enter" && !busy) {
                    void onPrimaryAction();
                  }
                }}
                style={inputStyle}
              />
            </div>
          </div>

          <div style={{ marginTop: 12, display: "flex", gap: 8, flexWrap: "wrap" }}>
            <button
              onClick={() => void onPrimaryAction()}
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
              {mode === "signup" ? "Create account" : "Sign in"}
            </button>
          </div>

          <div
            style={{
              marginTop: 12,
              borderRadius: 14,
              border: "1px solid #e2e8f0",
              background: "#f8fafc",
              padding: "10px 12px",
              color: "#475569",
              fontWeight: 650,
              lineHeight: 1.55,
            }}
          >
            {mode === "signup" ? (
              <>
                After creating your account, proceed to your email and confirm it to activate your account. Once confirmed, come back here and sign in.
              </>
            ) : (
              <>
                Don’t have an account yet? Select <strong>Create account</strong> above.
              </>
            )}
          </div>
        </>
      )}
    </div>
  );
}

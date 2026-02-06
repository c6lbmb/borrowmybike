// src/auth/ProtectedRoute.tsx
import { Navigate, useLocation } from "react-router-dom";
import { useAuth } from "./useAuth";

export function ProtectedRoute(props: { children: React.ReactNode }) {
  const { user, loading } = useAuth();
  const loc = useLocation();

  if (loading) {
    return (
      <div style={{ padding: "2rem" }}>
        <div style={{ fontWeight: 900 }}>Loading…</div>
        <div style={{ color: "#64748b", fontWeight: 700, marginTop: 6 }}>
          Checking session…
        </div>
      </div>
    );
  }

  if (!user) {
    return <Navigate to={`/auth?next=${encodeURIComponent(loc.pathname)}`} replace />;
  }

  return <>{props.children}</>;
}

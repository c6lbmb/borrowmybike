// src/auth/AuthProvider.tsx
import { createContext, useEffect, useMemo, useState } from "react";
import type { Session, User } from "@supabase/supabase-js";
import { sb } from "../lib/supabase";

export type SignUpProfile = {
  fullName: string;
  firstName?: string;
  city: string;
};

type AuthCtx = {
  session: Session | null;
  user: User | null;
  accessToken: string | null;
  loading: boolean;
  signUp(
    email: string,
    password: string,
    profile: SignUpProfile,
  ): Promise<{ ok: boolean; error?: string }>;
  signIn(email: string, password: string): Promise<{ ok: boolean; error?: string }>;
  signOut(): Promise<void>;
};

export const AuthContext = createContext<AuthCtx | null>(null);

function deriveFirstName(fullName: string, fallback?: string) {
  const cleanFallback = (fallback || "").trim();
  if (cleanFallback) return cleanFallback;

  const cleanFullName = fullName.trim();
  if (!cleanFullName) return "";

  return cleanFullName.split(/\s+/)[0] || "";
}

export function AuthProvider(props: { children: React.ReactNode }) {
  const [session, setSession] = useState<Session | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let mounted = true;

    sb.auth.getSession().then(({ data, error }) => {
      if (!mounted) return;
      if (error) console.warn("getSession error:", error.message);
      setSession(data.session ?? null);
      setLoading(false);
    });

    const { data: sub } = sb.auth.onAuthStateChange((_evt, s) => {
      setSession(s ?? null);
    });

    return () => {
      mounted = false;
      sub.subscription.unsubscribe();
    };
  }, []);

  const value = useMemo<AuthCtx>(
    () => ({
      session,
      user: session?.user ?? null,
      accessToken: session?.access_token ?? null,
      loading,
      async signUp(email: string, password: string, profile: SignUpProfile) {
        try {
          const fullName = profile.fullName.trim();
          const firstName = deriveFirstName(fullName, profile.firstName);
          const city = (profile.city || "").trim();

          if (!fullName) {
            return { ok: false, error: "Please enter your full name." };
          }

          const { error } = await sb.auth.signUp({
            email: email.trim(),
            password,
            options: {
              data: {
                full_name: fullName,
                first_name: firstName,
                city: city || null,
              },
            },
          });

          if (error) return { ok: false, error: error.message };
          return { ok: true };
        } catch (e: any) {
          return { ok: false, error: e?.message || "Sign up failed" };
        }
      },
      async signIn(email: string, password: string) {
        try {
          const { error } = await sb.auth.signInWithPassword({ email: email.trim(), password });
          if (error) return { ok: false, error: error.message };
          return { ok: true };
        } catch (e: any) {
          return { ok: false, error: e?.message || "Sign in failed" };
        }
      },
      async signOut() {
        await sb.auth.signOut();
      },
    }),
    [session, loading],
  );

  return <AuthContext.Provider value={value}>{props.children}</AuthContext.Provider>;
}

// ✅ Add default export so both import styles work:
// import AuthProvider from "../auth/AuthProvider"
// import { AuthProvider } from "../auth/AuthProvider"
export default AuthProvider;

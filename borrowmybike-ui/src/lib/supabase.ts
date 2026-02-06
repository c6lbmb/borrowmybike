// src/lib/supabase.ts
import { createClient } from "@supabase/supabase-js";

/**
 * ENV
 */
const SUPABASE_URL = import.meta.env.VITE_SUPABASE_URL as string;
const SUPABASE_ANON_KEY = import.meta.env.VITE_SUPABASE_ANON_KEY as string;

if (!SUPABASE_URL || !SUPABASE_ANON_KEY) {
  console.warn(
    "Missing env vars. Check .env.local for VITE_SUPABASE_URL / VITE_SUPABASE_ANON_KEY",
  );
}

// IMPORTANT:
// - storageKey keeps auth stable and avoids weird cross-build/session behavior
// - exposes window.sb in DEV so you can grab tokens quickly in console
export const sb = createClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
  auth: {
    persistSession: true,
    autoRefreshToken: true,
    detectSessionInUrl: true,
    storageKey: "bmb-auth",
  },
});

if (import.meta.env.DEV) {
  (window as any).sb = sb;
}

export const ENV = {
  SUPABASE_URL,
  SUPABASE_ANON_KEY_PRESENT: !!SUPABASE_ANON_KEY,
  FUNCTIONS_BASE: import.meta.env.VITE_FUNCTIONS_BASE as string,
};

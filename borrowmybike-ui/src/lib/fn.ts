// src/lib/fn.ts
import { sb } from "./supabase";

type CallFnOpts = {
  method?: "POST" | "GET";
  headers?: Record<string, string>;
  signal?: AbortSignal;
};

function getFunctionsBase(): string {
  const base = (import.meta as any).env?.VITE_FUNCTIONS_BASE as string | undefined;
  const url = (import.meta as any).env?.VITE_SUPABASE_URL as string | undefined;

  // Prefer explicit base, fallback to Supabase URL.
  return base || (url ? `${url}/functions/v1` : "");
}

function getAnonKey(): string {
  return ((import.meta as any).env?.VITE_SUPABASE_ANON_KEY as string | undefined) || "";
}

async function getAccessToken(): Promise<string> {
  try {
    const { data } = await sb.auth.getSession();
    return data.session?.access_token || "";
  } catch {
    return "";
  }
}

export async function callFn<T = any>(
  functionName: string,
  body?: any,
  opts: CallFnOpts = {},
): Promise<{ ok: boolean; data?: T; error?: string; status?: number }> {
  const base = getFunctionsBase();
  if (!base) {
    return { ok: false, error: "VITE_FUNCTIONS_BASE / VITE_SUPABASE_URL not set" };
  }

  const anonKey = getAnonKey();
  const accessToken = await getAccessToken();

  const headers: Record<string, string> = {
    "Content-Type": "application/json",
    // These two are CRITICAL for calling Supabase Edge Functions from the browser
    ...(anonKey ? { apikey: anonKey } : {}),
    ...(accessToken ? { Authorization: `Bearer ${accessToken}` } : {}),
    ...(opts.headers || {}),
  };

  const method = opts.method || "POST";

  try {
    const res = await fetch(`${base}/${functionName}`, {
      method,
      headers,
      body: method === "GET" ? undefined : JSON.stringify(body ?? {}),
      signal: opts.signal,
    });

    const status = res.status;

    // Try to parse JSON, but don’t explode if it’s empty.
    let payload: any = null;
    const text = await res.text();
    try {
      payload = text ? JSON.parse(text) : null;
    } catch {
      payload = text || null;
    }

    if (!res.ok) {
      const msg =
        (payload && (payload.error || payload.message)) ||
        (typeof payload === "string" ? payload : null) ||
        `Edge Function ${functionName} failed (${status})`;

      return { ok: false, status, error: msg };
    }

    return { ok: true, status, data: payload as T };
  } catch (e: any) {
    return { ok: false, error: e?.message || "Failed to send a request to the Edge Function" };
  }
}

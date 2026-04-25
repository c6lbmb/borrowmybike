import { useEffect, useMemo, useState } from 'react';
import { useAuth } from '../auth/useAuth';
import { sb } from '../lib/supabase';
import { callFn } from '../lib/fn';

type ReviewBooking = {
  id: string;
  bike_id: string | null;
  borrower_id: string | null;
  owner_id: string | null;
  booking_date: string | null;
  scheduled_start_at: string | null;
  status: string | null;
  cancelled: boolean;
  settled: boolean;
  completed: boolean;
  needs_review: boolean;
  review_reason: string | null;
  needs_rebooking?: boolean | null;
  registry_quadrant?: string | null;
  test_taker_intro?: string | null;
  tag_reason?: string | null;
  borrower_checked_in?: boolean | null;
  owner_checked_in?: boolean | null;
  borrower_checked_in_at?: string | null;
  owner_checked_in_at?: string | null;
  created_at?: string | null;
};

function shortId(id?: string | null) {
  return id ? `${id.slice(0, 8)}…` : '—';
}

function scheduledIsoFor(b: ReviewBooking) {
  return b.scheduled_start_at ?? b.booking_date ?? null;
}

function fmtLocal(iso?: string | null) {
  if (!iso) return '—';
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '—';
  return d.toLocaleString([], {
    year: 'numeric',
    month: 'short',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
  });
}

function fmtUtc(iso?: string | null) {
  if (!iso) return '—';
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '—';
  return d.toUTCString();
}

function splitReasons(tagReason?: string | null) {
  if (!tagReason) return [] as string[];
  return tagReason
    .split('\n')
    .map((s) => s.trim())
    .filter(Boolean);
}

export default function AdminReviews() {
  const { user } = useAuth();
  const [items, setItems] = useState<ReviewBooking[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [actionLoading, setActionLoading] = useState<string | null>(null);
  const [notes, setNotes] = useState<Record<string, string>>({});
  const [resultMsg, setResultMsg] = useState<Record<string, string>>({});

  const tz = useMemo(() => {
    try {
      return Intl.DateTimeFormat().resolvedOptions().timeZone || 'local device time';
    } catch {
      return 'local device time';
    }
  }, []);

  async function load() {
    setLoading(true);
    setError(null);
    const session = await sb.auth.getSession();
    const token = session.data.session?.access_token || '';
    const base = (import.meta as any).env?.VITE_FUNCTIONS_BASE || `${(import.meta as any).env?.VITE_SUPABASE_URL}/functions/v1`;
    try {
      const res = await fetch(`${base}/get-review-bookings`, {
        method: 'GET',
        headers: {
          ...(token ? { Authorization: `Bearer ${token}` } : {}),
          ...(((import.meta as any).env?.VITE_SUPABASE_ANON_KEY)
            ? { apikey: (import.meta as any).env?.VITE_SUPABASE_ANON_KEY }
            : {}),
        },
      });
      const text = await res.text();
      const payload = text ? JSON.parse(text) : {};
      if (!res.ok) throw new Error(payload?.error || payload?.message || `Failed (${res.status})`);
      setItems(Array.isArray(payload?.bookings) ? payload.bookings : []);
    } catch (e: any) {
      setError(e?.message || 'Failed to load review bookings');
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    void load();
  }, []);

  async function resolveBooking(bookingId: string, decision: 'owner_fault' | 'borrower_fault' | 'approve_settle' | 'reject_clear_flags') {
    setActionLoading(bookingId + decision);
    setResultMsg((m) => ({ ...m, [bookingId]: '' }));
    const note = notes[bookingId]?.trim() || null;
    const res = await callFn('admin-resolve-review', { booking_id: bookingId, decision, note });
    if (!res.ok) {
      setResultMsg((m) => ({ ...m, [bookingId]: `Error: ${res.error || 'Could not resolve booking'}` }));
      setActionLoading(null);
      return;
    }
    const message = (res.data as any)?.message || 'Decision submitted.';
    setResultMsg((m) => ({ ...m, [bookingId]: message }));
    await load();
    setActionLoading(null);
  }

  return (
    <div style={{ padding: 16, display: 'grid', gap: 14 }}>
      <div style={{ background: 'white', border: '1px solid #e2e8f0', borderRadius: 16, padding: 16 }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', gap: 12, flexWrap: 'wrap', alignItems: 'center' }}>
          <div>
            <h1 style={{ margin: 0, fontSize: 32, lineHeight: 1.05 }}>Admin Review Queue</h1>
            <div style={{ marginTop: 8, color: '#475569', fontWeight: 700 }}>
              Review bookings that need a manual outcome. Times below are shown in <strong>{tz}</strong> for easier decision-making.
            </div>
          </div>
          <button
            onClick={() => void load()}
            style={{ padding: '10px 14px', borderRadius: 14, border: '1px solid #cbd5e1', background: 'white', fontWeight: 900, cursor: 'pointer' }}
          >
            Refresh
          </button>
        </div>
        {user?.email && <div style={{ marginTop: 8, color: '#64748b', fontWeight: 700 }}>Signed in as {user.email}</div>}
      </div>

      {error && (
        <div style={{ background: '#fff1f2', border: '1px solid #fecaca', color: '#9f1239', borderRadius: 16, padding: 14, fontWeight: 900 }}>
          {error}
        </div>
      )}

      {loading ? (
        <div style={{ background: 'white', border: '1px solid #e2e8f0', borderRadius: 16, padding: 16, color: '#475569', fontWeight: 800 }}>
          Loading review queue…
        </div>
      ) : items.length === 0 ? (
        <div style={{ background: 'white', border: '1px solid #e2e8f0', borderRadius: 16, padding: 16 }}>
          <div style={{ fontWeight: 900, fontSize: 22 }}>No review bookings</div>
          <div style={{ marginTop: 8, color: '#475569', fontWeight: 700 }}>Nothing is currently waiting for manual review.</div>
        </div>
      ) : (
        items.map((b) => {
          const scheduledIso = scheduledIsoFor(b);
          const reasons = splitReasons(b.tag_reason);
          const busy = !!actionLoading && actionLoading.startsWith(b.id);
          return (
            <div key={b.id} style={{ background: 'white', border: '1px solid #e2e8f0', borderRadius: 18, padding: 16, display: 'grid', gap: 14 }}>
              <div>
                <div style={{ fontSize: 28, fontWeight: 950 }}>Booking {shortId(b.id)}</div>
                <div style={{ marginTop: 8, color: '#64748b', fontWeight: 800 }}>
                  scheduled (local): {fmtLocal(scheduledIso)}
                </div>
                <div style={{ marginTop: 4, color: '#94a3b8', fontWeight: 700, fontSize: 13 }}>
                  stored UTC: {fmtUtc(scheduledIso)}
                </div>
              </div>

              <div style={{ display: 'grid', gap: 10, gridTemplateColumns: 'repeat(auto-fit, minmax(220px, 1fr))' }}>
                <div style={{ border: '1px solid #e2e8f0', borderRadius: 14, padding: 12 }}>
                  <div style={{ color: '#64748b', fontWeight: 800, fontSize: 13 }}>Booking state</div>
                  <div style={{ marginTop: 8, fontWeight: 900 }}>status: {b.status || '—'}</div>
                  <div style={{ marginTop: 4, fontWeight: 800 }}>review: {b.review_reason || '—'}</div>
                  <div style={{ marginTop: 4, fontWeight: 800 }}>needs rebooking: {b.needs_rebooking ? 'yes' : 'no'}</div>
                </div>
                <div style={{ border: '1px solid #e2e8f0', borderRadius: 14, padding: 12 }}>
                  <div style={{ color: '#64748b', fontWeight: 800, fontSize: 13 }}>Check-ins</div>
                  <div style={{ marginTop: 8, fontWeight: 800 }}>Borrower: {b.borrower_checked_in || b.borrower_checked_in_at ? 'checked in' : 'not checked in'}</div>
                  <div style={{ marginTop: 4, fontWeight: 800 }}>Owner: {b.owner_checked_in || b.owner_checked_in_at ? 'checked in' : 'not checked in'}</div>
                  <div style={{ marginTop: 4, fontWeight: 800 }}>Registry area: {b.registry_quadrant || '—'}</div>
                </div>
                <div style={{ border: '1px solid #e2e8f0', borderRadius: 14, padding: 12 }}>
                  <div style={{ color: '#64748b', fontWeight: 800, fontSize: 13 }}>Context</div>
                  <div style={{ marginTop: 8, fontWeight: 800 }}>Bike: {shortId(b.bike_id)}</div>
                  <div style={{ marginTop: 4, fontWeight: 800 }}>Borrower: {shortId(b.borrower_id)}</div>
                  <div style={{ marginTop: 4, fontWeight: 800 }}>Owner: {shortId(b.owner_id)}</div>
                  {b.test_taker_intro && <div style={{ marginTop: 8, color: '#475569', fontWeight: 700 }}>Intro: “{b.test_taker_intro}”</div>}
                </div>
              </div>

              <div style={{ border: '1px solid #e2e8f0', borderRadius: 14, padding: 12 }}>
                <div style={{ fontWeight: 900, fontSize: 20 }}>Submitted reasons</div>
                {reasons.length === 0 ? (
                  <div style={{ marginTop: 8, color: '#64748b', fontWeight: 700 }}>No reason text recorded.</div>
                ) : (
                  <ul style={{ margin: '10px 0 0', paddingLeft: 22 }}>
                    {reasons.map((r, i) => (
                      <li key={i} style={{ margin: '8px 0', fontWeight: 700 }}>{r}</li>
                    ))}
                  </ul>
                )}
              </div>

              <div style={{ border: '1px solid #e2e8f0', borderRadius: 14, padding: 12, display: 'grid', gap: 12 }}>
                <div style={{ fontWeight: 900, fontSize: 20 }}>Admin note</div>
                <textarea
                  value={notes[b.id] || ''}
                  onChange={(e) => setNotes((m) => ({ ...m, [b.id]: e.target.value }))}
                  rows={3}
                  placeholder="Short note for your decision (saved to admin_resolve_review_log)"
                  style={{ width: '100%', borderRadius: 12, border: '1px solid #cbd5e1', padding: 12, fontWeight: 700, resize: 'vertical' }}
                />
                <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap' }}>
                  <button disabled={busy} onClick={() => void resolveBooking(b.id, 'owner_fault')} style={{ padding: '12px 14px', borderRadius: 14, border: '1px solid #0f172a', background: '#0f172a', color: 'white', fontWeight: 950, cursor: 'pointer', opacity: busy ? 0.6 : 1 }}>
                    Resolve as owner fault
                  </button>
                  <button disabled={busy} onClick={() => void resolveBooking(b.id, 'borrower_fault')} style={{ padding: '12px 14px', borderRadius: 14, border: '1px solid #0f172a', background: 'white', color: '#0f172a', fontWeight: 950, cursor: 'pointer', opacity: busy ? 0.6 : 1 }}>
                    Resolve as borrower fault
                  </button>
                  <button disabled={busy} onClick={() => void resolveBooking(b.id, 'reject_clear_flags')} style={{ padding: '12px 14px', borderRadius: 14, border: '1px solid #cbd5e1', background: 'white', color: '#0f172a', fontWeight: 950, cursor: 'pointer', opacity: busy ? 0.6 : 1 }}>
                    Clear flags only
                  </button>
                </div>
                <div style={{ color: '#64748b', fontWeight: 700 }}>
                  “Clear flags only” removes review flags and does not execute settlement. Use it only if the review was raised in error.
                </div>
                {resultMsg[b.id] && <div style={{ fontWeight: 900, color: resultMsg[b.id].startsWith('Error:') ? '#9f1239' : '#166534' }}>{resultMsg[b.id]}</div>}
              </div>
            </div>
          );
        })
      )}
    </div>
  );
}

// src/components/BookingMessages.tsx
import { useEffect, useMemo, useRef, useState } from "react";
import { sb } from "../lib/supabase";

type MsgRow = {
  id: string;
  booking_id: string;
  sender_user_id: string;
  message: string;
  created_at: string;
};

function fmtTime(iso: string) {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "";
  return d.toLocaleString([], { month: "short", day: "2-digit", hour: "2-digit", minute: "2-digit" });
}

export default function BookingMessages(props: {
  bookingId: string;
  meId: string;
  otherUserId: string;
  otherLabel: string; // "Mentor" or "Test-taker"
  onMarkSeen?: (latestIso: string | null) => void;
}) {
  const { bookingId, meId, otherUserId, otherLabel, onMarkSeen } = props;

  const [rows, setRows] = useState<MsgRow[]>([]);
  const [loading, setLoading] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  const [draft, setDraft] = useState("");
  const [sending, setSending] = useState(false);

  const bottomRef = useRef<HTMLDivElement | null>(null);

  const latestIso = useMemo(() => (rows.length ? rows[rows.length - 1].created_at : null), [rows]);

  function scrollToBottom() {
    requestAnimationFrame(() => bottomRef.current?.scrollIntoView({ behavior: "smooth" }));
  }

  async function load() {
    setLoading(true);
    setErr(null);
    try {
      const res = await sb
        .from("booking_messages")
        .select("id,booking_id,sender_user_id,message,created_at")
        .eq("booking_id", bookingId)
        .order("created_at", { ascending: true })
        .limit(200);

      if (res.error) throw res.error;
      setRows((res.data as any) || []);
      setTimeout(scrollToBottom, 60);
    } catch (e: any) {
      setErr(e?.message || "Failed to load messages");
    } finally {
      setLoading(false);
    }
  }

  async function send() {
    const text = draft.trim();
    if (!text) return;

    setSending(true);
    setErr(null);
    try {
      const res = await sb.from("booking_messages").insert({
        booking_id: bookingId,
        sender_user_id: meId,
        message: text,
      });

      if (res.error) throw res.error;
      setDraft("");
      // realtime should append, but re-load keeps it resilient if realtime isn’t enabled yet
      await load();
    } catch (e: any) {
      setErr(e?.message || "Failed to send");
    } finally {
      setSending(false);
    }
  }

  useEffect(() => {
    load();

    const channel = sb
      .channel(`booking_messages:${bookingId}`)
      .on(
        "postgres_changes",
        { event: "INSERT", schema: "public", table: "booking_messages", filter: `booking_id=eq.${bookingId}` },
        (payload: any) => {
          const row = payload?.new as MsgRow | undefined;
          if (!row?.id) return;

          setRows((prev) => {
            if (prev.some((p) => p.id === row.id)) return prev;
            return [...prev, row];
          });

          setTimeout(scrollToBottom, 40);
        },
      )
      .subscribe();

    return () => {
      sb.removeChannel(channel);
    };
  }, [bookingId]);

  useEffect(() => {
    if (onMarkSeen) onMarkSeen(latestIso);
  }, [latestIso, onMarkSeen]);

  // Use otherUserId so it’s not “unused” and to label unknown senders safely
  function senderLabel(senderId: string) {
    if (senderId === meId) return "You";
    if (senderId === otherUserId) return otherLabel;
    return "Participant";
  }

  const box: React.CSSProperties = {
    border: "1px solid #e2e8f0",
    borderRadius: 14,
    padding: 12,
    background: "#ffffff",
  };

  const list: React.CSSProperties = {
    maxHeight: 220,
    overflowY: "auto",
    paddingRight: 6,
  };

  const bubbleMine: React.CSSProperties = {
    marginLeft: "auto",
    background: "#0f172a",
    color: "white",
    padding: "8px 10px",
    borderRadius: 14,
    maxWidth: 520,
    fontWeight: 700,
    whiteSpace: "pre-wrap",
  };

  const bubbleOther: React.CSSProperties = {
    marginRight: "auto",
    background: "#f1f5f9",
    color: "#0f172a",
    padding: "8px 10px",
    borderRadius: 14,
    maxWidth: 520,
    fontWeight: 700,
    whiteSpace: "pre-wrap",
    border: "1px solid #e2e8f0",
  };

  const meta: React.CSSProperties = { fontSize: 12, color: "#64748b", fontWeight: 700, marginTop: 2 };

  return (
    <div style={box}>
      <div style={{ fontWeight: 1000, marginBottom: 8 }}>Messages</div>

      {err && (
        <div style={{ marginBottom: 10, padding: 10, borderRadius: 12, border: "1px solid #fecaca", background: "#fff1f2" }}>
          <div style={{ fontWeight: 900, color: "#b00020" }}>Error</div>
          <div style={{ marginTop: 6, color: "#7f1d1d", fontWeight: 800 }}>{err}</div>
        </div>
      )}

      {loading ? (
        <div style={{ color: "#64748b", fontWeight: 800 }}>Loading…</div>
      ) : (
        <div style={list}>
          {!rows.length ? (
            <div style={{ color: "#64748b", fontWeight: 800 }}>No messages yet.</div>
          ) : (
            rows.map((m) => {
              const mine = m.sender_user_id === meId;
              const who = senderLabel(m.sender_user_id);

              return (
                <div key={m.id} style={{ display: "flex", flexDirection: "column", marginBottom: 10 }}>
                  <div style={mine ? bubbleMine : bubbleOther}>{m.message}</div>
                  <div style={meta}>
                    {who} • {fmtTime(m.created_at)}
                  </div>
                </div>
              );
            })
          )}
          <div ref={bottomRef} />
        </div>
      )}


      <div
        style={{
          marginTop: 10,
          padding: 10,
          borderRadius: 12,
          border: "1px solid #e2e8f0",
          background: "#f8fafc",
          fontWeight: 700,
          fontSize: 13,
          lineHeight: 1.35,
        }}
      >
        <div style={{ fontWeight: 950, marginBottom: 4 }}>Mentor messaging</div>
        <div>
          <b>Mentors don’t teach riding.</b> Use chat to coordinate timing and meeting details and to get to know who’s
          riding your bike for the road test. Meet at the registry at the booked time. <b>We recommend not meeting beforehand.</b>
        </div>
      </div>

      <div style={{ marginTop: 10, display: "flex", gap: 10 }}>
        <input
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          placeholder="Type a message…"
          style={{
            flex: 1,
            padding: "10px 12px",
            borderRadius: 12,
            border: "1px solid #cbd5e1",
            fontWeight: 800,
          }}
          onKeyDown={(e) => {
            if (e.key === "Enter" && !e.shiftKey) {
              e.preventDefault();
              void send();
            }
          }}
          disabled={sending}
        />
        <button
          onClick={() => void send()}
          disabled={sending || !draft.trim()}
          style={{
            padding: "10px 14px",
            borderRadius: 12,
            border: "1px solid #0f172a",
            background: "#0f172a",
            color: "white",
            fontWeight: 950,
            cursor: "pointer",
            opacity: sending || !draft.trim() ? 0.6 : 1,
          }}
        >
          {sending ? "…" : "Send"}
        </button>
      </div>

      <div style={{ marginTop: 8, color: "#64748b", fontWeight: 800, fontSize: 12 }}>
        Keep it short and practical: meeting spot, timing, last-minute updates.
      </div>
    </div>
  );
}

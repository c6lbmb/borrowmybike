// src/components/ReviewModal.tsx
import { useMemo, useState } from "react";
import { sb } from "../lib/supabase";
import { useAuth } from "../auth/useAuth";

type Props = {
  open: boolean;
  onClose: () => void;
  bookingId: string;
  bikeId: string;
  ownerId: string;
  onSaved?: () => void;
};

export default function ReviewModal({ open, onClose, bookingId, bikeId, ownerId, onSaved }: Props) {
  const { user } = useAuth();
  const me = user?.id;

  const [ownerRating, setOwnerRating] = useState<number>(5);
  const [bikeRating, setBikeRating] = useState<number>(5);
  const [comment, setComment] = useState<string>("");

  const [saving, setSaving] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [okMsg, setOkMsg] = useState<string | null>(null);

  const canSubmit = useMemo(() => {
    return (
      !!me &&
      !!bookingId &&
      !!bikeId &&
      !!ownerId &&
      ownerRating >= 1 &&
      ownerRating <= 5 &&
      bikeRating >= 1 &&
      bikeRating <= 5 &&
      !saving
    );
  }, [me, bookingId, bikeId, ownerId, ownerRating, bikeRating, saving]);

  if (!open) return null;

  const overlay: React.CSSProperties = {
    position: "fixed",
    inset: 0,
    background: "rgba(15,23,42,0.55)",
    display: "grid",
    placeItems: "center",
    padding: 16,
    zIndex: 50,
  };

  const modal: React.CSSProperties = {
    width: "min(620px, 100%)",
    background: "white",
    borderRadius: 18,
    border: "1px solid #e2e8f0",
    boxShadow: "0 10px 30px rgba(0,0,0,0.25)",
    padding: 16,
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

  function StarRow({
    label,
    value,
    onChange,
  }: {
    label: string;
    value: number;
    onChange: (n: number) => void;
  }) {
    return (
      <div style={{ marginTop: 14 }}>
        <div style={{ fontWeight: 900, color: "#334155", fontSize: 12 }}>{label}</div>
        <div style={{ marginTop: 8, display: "flex", gap: 8, flexWrap: "wrap" }}>
          {[1, 2, 3, 4, 5].map((n) => (
            <button
              key={n}
              style={{
                ...btn,
                background: n === value ? "#0f172a" : "white",
                color: n === value ? "white" : "#0f172a",
                minWidth: 44,
              }}
              onClick={() => onChange(n)}
            >
              {n}★
            </button>
          ))}
        </div>
      </div>
    );
  }

  async function submit() {
    if (!canSubmit) return;

    setSaving(true);
    setErr(null);
    setOkMsg(null);

    const payload = {
      booking_id: bookingId,
      borrower_id: me,
      owner_id: ownerId,
      bike_id: bikeId,
      owner_rating: ownerRating,
      bike_rating: bikeRating,
      comment: comment.trim() || null,
    };

    const ins = await sb.from("reviews").insert(payload).select("id").maybeSingle();

    if (ins.error) {
      setErr(ins.error.message);
      setSaving(false);
      return;
    }

    setOkMsg("Saved ✅");
    setSaving(false);

    setTimeout(() => {
      onSaved?.();
      onClose();
    }, 350);
  }

  return (
    <div style={overlay} onMouseDown={onClose}>
      <div style={modal} onMouseDown={(e) => e.stopPropagation()}>
        <div style={{ display: "flex", justifyContent: "space-between", gap: 10, alignItems: "start" }}>
          <div>
            <div style={{ fontWeight: 1000, fontSize: 18 }}>Rate your experience</div>
            <div style={{ marginTop: 6, color: "#64748b", fontWeight: 750 }}>
              Separate scores for the mentor and the bike (better data, better trust).
            </div>
          </div>
          <button style={btn} onClick={onClose}>
            Close
          </button>
        </div>

        <StarRow label="Mentor rating" value={ownerRating} onChange={setOwnerRating} />
        <StarRow label="Bike rating" value={bikeRating} onChange={setBikeRating} />

        <div style={{ marginTop: 14 }}>
          <div style={{ fontWeight: 900, color: "#334155", fontSize: 12 }}>Comment (optional)</div>
          <textarea
            value={comment}
            onChange={(e) => setComment(e.target.value)}
            placeholder="Quick notes… (e.g., bike condition, mentor communication, helpful tips)"
            style={{
              width: "100%",
              marginTop: 8,
              minHeight: 110,
              padding: 12,
              borderRadius: 14,
              border: "1px solid #e2e8f0",
              resize: "vertical",
              fontFamily: "inherit",
            }}
          />
        </div>

        {err && (
          <div
            style={{
              marginTop: 12,
              background: "#fff1f2",
              border: "1px solid #fecaca",
              color: "#9f1239",
              borderRadius: 14,
              padding: 12,
              fontWeight: 900,
            }}
          >
            Error: {err}
          </div>
        )}

        {okMsg && (
          <div
            style={{
              marginTop: 12,
              background: "#ecfdf5",
              border: "1px solid #bbf7d0",
              color: "#065f46",
              borderRadius: 14,
              padding: 12,
              fontWeight: 900,
            }}
          >
            {okMsg}
          </div>
        )}

        <div style={{ marginTop: 14, display: "flex", justifyContent: "flex-end", gap: 10, flexWrap: "wrap" }}>
          <button style={btn} onClick={onClose} disabled={saving}>
            Cancel
          </button>
          <button style={btnPrimary} onClick={submit} disabled={!canSubmit}>
            {saving ? "Saving…" : "Submit review"}
          </button>
        </div>
      </div>
    </div>
  );
}

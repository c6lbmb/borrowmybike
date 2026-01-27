// src/components/BoostModal.tsx
import { useEffect, useMemo, useState } from "react";
import { sb } from "../lib/supabase";

type BikeLike = {
  id?: string;
  make?: string | null;
  model?: string | null;
  year?: number | null;
};

type Props = {
  open: boolean;
  onClose: () => void;

  // Newer/cleaner shape
  bikeId?: string;
  bikeLabel?: string;

  // Back-compat shape (older dashboards passed the whole bike)
  bike?: BikeLike | null;

  // Optional callback after saving
  onSaved?: () => void | Promise<void>;
};

function labelFromBike(b?: BikeLike | null) {
  if (!b) return "Bike";
  const parts = [b.year, b.make, b.model].filter(Boolean);
  return parts.length ? String(parts.join(" ")) : "Bike";
}

export default function BoostModal(props: Props) {
  const bikeId = useMemo(() => props.bikeId || props.bike?.id || "", [props.bikeId, props.bike]);
  const bikeLabel = useMemo(() => props.bikeLabel || labelFromBike(props.bike), [props.bikeLabel, props.bike]);

  const [days, setDays] = useState(7);
  const [saving, setSaving] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  useEffect(() => {
    if (props.open) {
      setErr(null);
      setDays(7);
    }
  }, [props.open]);

  if (!props.open) return null;

  const overlay: React.CSSProperties = {
    position: "fixed",
    inset: 0,
    background: "rgba(15,23,42,0.45)",
    display: "grid",
    placeItems: "center",
    padding: 16,
    zIndex: 50,
  };

  const card: React.CSSProperties = {
    width: "min(560px, 100%)",
    background: "white",
    borderRadius: 16,
    border: "1px solid #e2e8f0",
    padding: 16,
    boxShadow: "0 20px 40px rgba(0,0,0,0.18)",
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

  async function save() {
    if (!bikeId) {
      setErr("Missing bike id.");
      return;
    }
    setSaving(true);
    setErr(null);

    // Feature: boost until now + N days (simple)
    const until = new Date(Date.now() + days * 24 * 60 * 60 * 1000).toISOString();

    const res = await sb.from("bikes").update({ boosted_until: until }).eq("id", bikeId);

    if (res.error) {
      setErr(res.error.message);
      setSaving(false);
      return;
    }

    setSaving(false);
    await props.onSaved?.();
    props.onClose();
  }

  return (
    <div style={overlay} onMouseDown={props.onClose}>
      <div style={card} onMouseDown={(e) => e.stopPropagation()}>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: 10 }}>
          <div>
            <div style={{ fontWeight: 1000, fontSize: 18 }}>Boost listing</div>
            <div style={{ color: "#64748b", fontWeight: 700, marginTop: 4 }}>{bikeLabel}</div>
          </div>
          <button style={btn} onClick={props.onClose}>
            Close
          </button>
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

        <div style={{ marginTop: 14, display: "flex", gap: 12, alignItems: "center", flexWrap: "wrap" }}>
          <div style={{ fontWeight: 900 }}>Days:</div>
          <input
            type="number"
            min={1}
            max={30}
            value={days}
            onChange={(e) => setDays(Number(e.target.value || 7))}
            style={{ padding: "10px 12px", borderRadius: 12, border: "1px solid #cbd5e1", width: 100 }}
          />
          <button style={btnPrimary} onClick={save} disabled={saving}>
            {saving ? "Saving…" : "Save boost"}
          </button>
        </div>

        <div style={{ marginTop: 10, color: "#64748b", fontWeight: 700, fontSize: 12 }}>
          (This is UI-only “featured” for now; payments for boosting can be added later.)
        </div>
      </div>
    </div>
  );
}

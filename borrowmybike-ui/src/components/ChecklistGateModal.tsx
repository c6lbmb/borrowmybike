// src/components/ChecklistGateModal.tsx
import { useEffect, useMemo, useState } from "react";

export type ChecklistItem = {
  id: string;
  label: React.ReactNode;
};

export default function ChecklistGateModal(props: {
  open: boolean;
  title: string;
  intro?: React.ReactNode;
  requiredItems: ChecklistItem[];
  footerNote?: React.ReactNode;
  confirmText: string;
  cancelText?: string;
  onCancel: () => void;
  onConfirm: () => void;
}) {
  const {
    open,
    title,
    intro,
    requiredItems,
    footerNote,
    confirmText,
    cancelText = "Cancel",
    onCancel,
    onConfirm,
  } = props;

  const [checked, setChecked] = useState<Record<string, boolean>>({});

  useEffect(() => {
    if (!open) return;
    // reset on open
    const initial: Record<string, boolean> = {};
    for (const it of requiredItems) initial[it.id] = false;
    setChecked(initial);
  }, [open, requiredItems]);

  const allChecked = useMemo(() => {
    if (!requiredItems.length) return true;
    return requiredItems.every((it) => !!checked[it.id]);
  }, [checked, requiredItems]);

  if (!open) return null;

  function toggle(id: string) {
    setChecked((prev) => ({ ...prev, [id]: !prev[id] }));
  }

  return (
    <div style={overlay} role="dialog" aria-modal="true">
      <div style={modal}>
        <div style={{ display: "flex", alignItems: "flex-start", justifyContent: "space-between", gap: 12 }}>
          <div>
            <div style={{ fontWeight: 1000, fontSize: 18, color: "#0f172a" }}>{title}</div>
            {intro ? <div style={{ marginTop: 8, color: "#475569", fontWeight: 700, lineHeight: 1.45 }}>{intro}</div> : null}
          </div>

          <button onClick={onCancel} style={xBtn} aria-label="Close">
            ✕
          </button>
        </div>

        <div style={{ marginTop: 14 }}>
          {requiredItems.map((it) => (
            <label key={it.id} style={row}>
              <input
                type="checkbox"
                checked={!!checked[it.id]}
                onChange={() => toggle(it.id)}
                style={{ width: 18, height: 18 }}
              />
              <div style={{ fontWeight: 800, color: "#0f172a", lineHeight: 1.35 }}>{it.label}</div>
            </label>
          ))}
        </div>

        {footerNote ? (
          <div style={noteBox}>
            <div style={{ fontWeight: 950, color: "#7c2d12" }}>Important</div>
            <div style={{ marginTop: 6, fontWeight: 750, color: "#7c2d12", lineHeight: 1.4 }}>{footerNote}</div>
          </div>
        ) : null}

        <div style={{ marginTop: 16, display: "flex", justifyContent: "flex-end", gap: 10, flexWrap: "wrap" }}>
          <button onClick={onCancel} style={btnSecondary}>
            {cancelText}
          </button>
          <button onClick={onConfirm} style={{ ...btnPrimary, opacity: allChecked ? 1 : 0.45 }} disabled={!allChecked}>
            {confirmText}
          </button>
        </div>
      </div>
    </div>
  );
}

const overlay: React.CSSProperties = {
  position: "fixed",
  inset: 0,
  background: "rgba(15, 23, 42, 0.55)",
  display: "flex",
  alignItems: "center",
  justifyContent: "center",
  padding: 14,
  zIndex: 9999,
};

const modal: React.CSSProperties = {
  width: "min(720px, 100%)",
  background: "white",
  borderRadius: 18,
  border: "1px solid rgba(0,0,0,0.10)",
  boxShadow: "0 24px 60px rgba(0,0,0,0.22)",
  padding: 16,
};

const row: React.CSSProperties = {
  display: "grid",
  gridTemplateColumns: "18px 1fr",
  gap: 10,
  alignItems: "flex-start",
  padding: "10px 10px",
  borderRadius: 14,
  border: "1px solid #e2e8f0",
  marginTop: 10,
  background: "#fff",
};

const noteBox: React.CSSProperties = {
  marginTop: 14,
  borderRadius: 16,
  border: "1px solid #fed7aa",
  background: "#fff7ed",
  padding: 12,
};

const btnPrimary: React.CSSProperties = {
  padding: "10px 14px",
  borderRadius: 14,
  border: "1px solid #0f172a",
  fontWeight: 950,
  cursor: "pointer",
  background: "#0f172a",
  color: "white",
};

const btnSecondary: React.CSSProperties = {
  padding: "10px 14px",
  borderRadius: 14,
  border: "1px solid #cbd5e1",
  fontWeight: 900,
  cursor: "pointer",
  background: "white",
  color: "#0f172a",
};

const xBtn: React.CSSProperties = {
  border: "1px solid #e2e8f0",
  background: "white",
  borderRadius: 12,
  padding: "6px 10px",
  cursor: "pointer",
  fontWeight: 900,
  color: "#0f172a",
};

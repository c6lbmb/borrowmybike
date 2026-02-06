// src/components/RatingBadge.tsx
import { formatStars } from "../lib/reviewSummary";

export default function RatingBadge(props: { avg: number; count: number }) {
  const avg = Number.isFinite(props.avg) ? props.avg : 0;
  const count = Number.isFinite(props.count) ? props.count : 0;

  const wrap: React.CSSProperties = {
    display: "inline-flex",
    alignItems: "center",
    gap: 8,
    padding: "6px 10px",
    borderRadius: 999,
    border: "1px solid #e2e8f0",
    background: "white",
    fontWeight: 900,
    color: "#0f172a",
    fontSize: 12,
    whiteSpace: "nowrap",
  };

  if (!count) {
    return <span style={wrap}>No ratings yet</span>;
  }

  return (
    <span style={wrap} title={`${avg.toFixed(1)} / 5 from ${count} review(s)`}>
      <span style={{ fontFamily: "monospace" }}>{formatStars(avg)}</span>
      <span style={{ color: "#334155" }}>{avg.toFixed(1)}</span>
      <span style={{ color: "#64748b" }}>({count})</span>
    </span>
  );
}

import { useEffect, useMemo, useState } from "react";

/**
 * Acceptance window rules (must match backend):
 * - If scheduled is < 24h away: 2h to accept
 * - If scheduled is < 72h away: 4h to accept
 * - Otherwise: 8h to accept
 */
export function acceptanceHoursForBooking(scheduledIso: string | null | undefined) {
  if (!scheduledIso) return 8;

  const scheduled = new Date(scheduledIso);
  if (isNaN(scheduled.getTime())) return 8;

  const msUntil = scheduled.getTime() - Date.now();
  const hoursUntil = msUntil / (1000 * 60 * 60);

  if (hoursUntil < 24) return 2;
  if (hoursUntil < 72) return 4;
  return 8;
}

export function acceptanceDeadlineMs(createdAtIso: string, scheduledIso: string | null | undefined) {
  const created = new Date(createdAtIso);
  if (isNaN(created.getTime())) return null;

  const hours = acceptanceHoursForBooking(scheduledIso);
  return created.getTime() + hours * 60 * 60 * 1000;
}

function fmt(ms: number) {
  const totalSeconds = Math.max(0, Math.floor(ms / 1000));
  const h = Math.floor(totalSeconds / 3600);
  const m = Math.floor((totalSeconds % 3600) / 60);
  const s = totalSeconds % 60;
  if (h > 0) return `${h}h ${m}m ${s}s`;
  return `${m}m ${s}s`;
}

export default function Countdown(props: {
  deadlineMs: number | null;
  label?: string;
  onExpired?: () => void;
}) {
  const { deadlineMs, label = "Expires in", onExpired } = props;
  const [now, setNow] = useState(Date.now());

  useEffect(() => {
    const t = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(t);
  }, []);

  const remaining = useMemo(() => {
    if (!deadlineMs) return null;
    return deadlineMs - now;
  }, [deadlineMs, now]);

  useEffect(() => {
    if (remaining !== null && remaining <= 0) onExpired?.();
  }, [remaining, onExpired]);

  if (!deadlineMs) return null;

  if (remaining !== null && remaining <= 0) {
    return <span className="text-red-600 font-semibold">Expired</span>;
  }

  return (
    <span className="text-slate-600">
      {label}: <span className="font-semibold">{fmt(remaining ?? 0)}</span>
    </span>
  );
}

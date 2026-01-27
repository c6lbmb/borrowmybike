import { useEffect, useMemo, useState } from "react";
import { acceptanceDeadlineMs, formatMsLeft } from "../lib/acceptance";

type Props = {
  /**
   * If provided, Countdown will use this deadline directly.
   * deadlineMs is an absolute timestamp in ms (Date.now() style).
   */
  deadlineMs?: number | null;

  /**
   * Optional fallback mode (if you ever want to use Countdown without passing deadlineMs).
   * If deadlineMs is not provided, it will compute deadline from these.
   */
  createdAtIso?: string | null;
  scheduledIso?: string | null;

  className?: string;
};

export default function Countdown(props: Props) {
  const { deadlineMs, createdAtIso, scheduledIso, className } = props;

  const computedDeadline = useMemo(() => {
    if (deadlineMs != null) return deadlineMs;
    const d = acceptanceDeadlineMs({ createdAtIso, scheduledIso });
    return d ?? null;
  }, [deadlineMs, createdAtIso, scheduledIso]);

  const [now, setNow] = useState(() => Date.now());

  useEffect(() => {
    // Update once per second
    const t = window.setInterval(() => setNow(Date.now()), 1000);
    return () => window.clearInterval(t);
  }, []);

  if (computedDeadline == null) return <span className={className}>—</span>;

  const left = computedDeadline - now;

  if (left <= 0) return <span className={className}>Expired</span>;

  return <span className={className}>{formatMsLeft(left)}</span>;
}

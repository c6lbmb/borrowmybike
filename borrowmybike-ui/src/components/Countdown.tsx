import { useEffect, useMemo, useState } from "react";

type Props = {
  deadlineMs: number;
  /** Optional label text (ignored if not provided). */
  label?: string;
};

function fmt(ms: number) {
  const s = Math.max(0, Math.floor(ms / 1000));
  const mm = Math.floor(s / 60);
  const ss = s % 60;
  return `${mm}:${String(ss).padStart(2, "0")}`;
}

export default function Countdown({ deadlineMs, label }: Props) {
  const [now, setNow] = useState(() => Date.now());

  useEffect(() => {
    const t = setInterval(() => setNow(Date.now()), 500);
    return () => clearInterval(t);
  }, []);

  const remaining = useMemo(() => deadlineMs - now, [deadlineMs, now]);
  const text = fmt(remaining);

  return (
    <span className="inline-flex items-center gap-2 text-sm">
      {label ? <span className="text-slate-600">{label}</span> : null}
      <span className={remaining <= 0 ? "font-semibold text-red-600" : "font-semibold"}>
        {text}
      </span>
    </span>
  );
}

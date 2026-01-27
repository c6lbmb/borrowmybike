// src/lib/acceptance.ts
// Acceptance window logic (owner must accept within a time limit)
//
// We support BOTH calling styles to avoid breaking old UI code:
//   acceptanceDeadlineMs({ createdAtIso, scheduledIso })
//   acceptanceDeadlineMs(createdAtIso, scheduledIso)
//
// Same for msLeft / msLeftForAcceptance.

export function acceptanceHoursFor(scheduledIso?: string | null): number {
  if (!scheduledIso) return 12;

  const scheduled = new Date(scheduledIso);
  if (isNaN(scheduled.getTime())) return 12;

  const now = Date.now();
  const msUntil = scheduled.getTime() - now;
  const daysUntil = msUntil / (1000 * 60 * 60 * 24);

  if (daysUntil > 14) return 24;
  if (daysUntil >= 3) return 12;
  return 6;
}

type Args = {
  createdAtIso?: string | null;
  scheduledIso?: string | null;
};

function normalizeArgs(
  a?: Args | string | null,
  b?: string | null,
): Args {
  if (typeof a === "object" && a !== null) return a as Args;
  return { createdAtIso: a ?? null, scheduledIso: b ?? null };
}

export function acceptanceDeadlineMs(args?: Args): number | null;
export function acceptanceDeadlineMs(createdAtIso?: string | null, scheduledIso?: string | null): number | null;
export function acceptanceDeadlineMs(
  a?: Args | string | null,
  b?: string | null,
): number | null {
  const { createdAtIso, scheduledIso } = normalizeArgs(a, b);

  if (!createdAtIso) return null;
  const created = new Date(createdAtIso);
  if (isNaN(created.getTime())) return null;

  const hours = acceptanceHoursFor(scheduledIso);
  return created.getTime() + hours * 60 * 60 * 1000;
}

// msLeft(deadlineMs)  OR  msLeft({createdAtIso, scheduledIso})
export function msLeft(deadlineMs?: number | null): number | null;
export function msLeft(args?: Args): number | null;
export function msLeft(a?: number | null | Args): number | null {
  if (typeof a === "number") return a - Date.now();
  const deadline = acceptanceDeadlineMs(a as Args);
  if (deadline == null) return null;
  return deadline - Date.now();
}

// msLeftForAcceptance({createdAtIso, scheduledIso}) OR msLeftForAcceptance(createdAtIso, scheduledIso)
export function msLeftForAcceptance(args?: Args): number | null;
export function msLeftForAcceptance(createdAtIso?: string | null, scheduledIso?: string | null): number | null;
export function msLeftForAcceptance(
  a?: Args | string | null,
  b?: string | null,
): number | null {
  const deadline = acceptanceDeadlineMs(a as any, b as any);
  if (deadline == null) return null;
  return deadline - Date.now();
}

export function isAcceptanceExpired(args?: Args): boolean {
  const left = msLeftForAcceptance(args);
  if (left == null) return false;
  return left <= 0;
}

export function formatMsLeft(msLeftValue: number): string {
  const ms = Math.max(0, msLeftValue);

  const totalSeconds = Math.floor(ms / 1000);
  const seconds = totalSeconds % 60;

  const totalMinutes = Math.floor(totalSeconds / 60);
  const minutes = totalMinutes % 60;

  const totalHours = Math.floor(totalMinutes / 60);
  const hours = totalHours;

  const pad2 = (n: number) => String(n).padStart(2, "0");

  if (hours <= 0) return `${minutes}:${pad2(seconds)}`;
  return `${hours}:${pad2(minutes)}:${pad2(seconds)}`;
}

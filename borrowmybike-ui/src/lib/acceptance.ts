// Acceptance window logic
//
// Plain English (based on time between request creation and the scheduled test start):
// - If scheduled test time is > 72 hours AFTER the request was created: 8 hours to accept
// - If 24–72 hours after request creation: 4 hours to accept
// - If < 24 hours after request creation: 2 hours to accept
//
// IMPORTANT: This must be based on (scheduled_start_at - created_at), not "from now",
// otherwise old requests will show incorrect remaining time.

/** Returns the number of hours allowed to accept, given created_at and scheduled_start_at. */
export function acceptanceHoursFor(args: {
  createdAtIso?: string | null;
  scheduledIso?: string | null;
}): number {
  const { createdAtIso, scheduledIso } = args;

  // Default to 8 hours if we don't have the data.
  if (!createdAtIso || !scheduledIso) return 8;

  const createdAt = new Date(createdAtIso).getTime();
  const scheduled = new Date(scheduledIso).getTime();
  if (!Number.isFinite(createdAt) || !Number.isFinite(scheduled)) return 8;

  const hoursBetween = (scheduled - createdAt) / (1000 * 60 * 60);

  if (hoursBetween < 24) return 2;
  if (hoursBetween <= 72) return 4;
  return 8;
}

/** Returns the acceptance deadline in ms since epoch, or null if not computable. */
export function acceptanceDeadlineMs(args: {
  createdAtIso?: string | null;
  scheduledIso?: string | null;
}): number | null {
  const { createdAtIso, scheduledIso } = args;
  if (!createdAtIso) return null;

  const createdAt = new Date(createdAtIso).getTime();
  if (!Number.isFinite(createdAt)) return null;

  const hours = acceptanceHoursFor({ createdAtIso, scheduledIso });
  return createdAt + hours * 60 * 60 * 1000;
}

// Calendar-date helpers shared by the rules, the pages and the .ics feed. Dates are YYYY-MM-DD strings. Civ. Code
// 1950.5 counts calendar days, so every date is handled at noon UTC and never slips across a day boundary.

/** Today's date in California, where the tenancies are. */
export const pacificToday = () => new Date().toLocaleDateString("en-CA", { timeZone: "America/Los_Angeles" });

/** The Pacific calendar date of a timestamp. */
export const pacificDate = (ts: string) => new Date(ts).toLocaleDateString("en-CA", { timeZone: "America/Los_Angeles" });

export function addDays(iso: string, n: number): string {
  const d = new Date(`${iso}T12:00:00Z`);
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
}

/** Whole days from one date to another; negative when `to` is in the past. */
export const daysBetween = (from: string, to: string) =>
  Math.round((Date.parse(`${to.slice(0, 10)}T12:00:00Z`) - Date.parse(`${from.slice(0, 10)}T12:00:00Z`)) / 86_400_000);

export const longDate = (iso: string) =>
  new Date(`${iso.slice(0, 10)}T12:00:00Z`).toLocaleDateString("en-US", { month: "long", day: "numeric", year: "numeric", timeZone: "UTC" });

export const shortDate = (iso: string) =>
  new Date(`${iso.slice(0, 10)}T12:00:00Z`).toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric", timeZone: "UTC" });

/** A list's date column: "Oct 1" within today's year, "Oct 1, 2025" for any other year. */
export const dayLabel = (iso: string, today: string) => (iso.slice(0, 4) === today.slice(0, 4)
  ? new Date(`${iso.slice(0, 10)}T12:00:00Z`).toLocaleDateString("en-US", { month: "short", day: "numeric", timeZone: "UTC" })
  : shortDate(iso));

/** A real calendar date in YYYY-MM-DD: it has to survive a round trip through Date, so 2026-02-31 is refused. */
export function realDate(d: unknown): d is string {
  if (typeof d !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(d)) return false;
  const t = new Date(`${d}T12:00:00Z`);
  return !Number.isNaN(t.getTime()) && t.toISOString().slice(0, 10) === d;
}

/** For a deadline: "3 days left", "due today", "2 days late". For a date something happens: "in 3 days", "today", "2 days ago". */
export function whenText(daysLeft: number, deadline = true): string {
  const n = Math.abs(daysLeft), days = `${n} day${n === 1 ? "" : "s"}`;
  if (daysLeft === 0) return deadline ? "due today" : "today";
  if (deadline) return daysLeft < 0 ? `${days} late` : `${days} left`;
  return daysLeft < 0 ? `${days} ago` : `in ${days}`;
}

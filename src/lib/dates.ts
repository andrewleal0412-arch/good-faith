// Calendar-date helpers shared by the rules, the pages and the .ics feed. Dates are YYYY-MM-DD strings. Civ. Code
// 1950.5 counts calendar days, so every date is handled at noon UTC and never slips across a day boundary.
//
// The formatters are made once: toLocaleDateString with options builds a new Intl formatter on every call, which was
// the app's own biggest cost on the server (a page formats hundreds of dates). Same locale and options, same output.

const PACIFIC_DAY = new Intl.DateTimeFormat("en-CA", { timeZone: "America/Los_Angeles" });
const SHORT = new Intl.DateTimeFormat("en-US", { month: "short", day: "numeric", year: "numeric", timeZone: "UTC" });
const SHORT_NO_YEAR = new Intl.DateTimeFormat("en-US", { month: "short", day: "numeric", timeZone: "UTC" });
const LONG = new Intl.DateTimeFormat("en-US", { month: "long", day: "numeric", year: "numeric", timeZone: "UTC" });
const PACIFIC_TIME = new Intl.DateTimeFormat("en-US", { hour: "numeric", minute: "2-digit", timeZone: "America/Los_Angeles" });
const PACIFIC_PARTS = new Intl.DateTimeFormat("en-US", {
  timeZone: "America/Los_Angeles", hourCycle: "h23",
  year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", second: "2-digit",
});
const noonUtc = (iso: string) => new Date(`${iso.slice(0, 10)}T12:00:00Z`);

/** Today's date in California, where the tenancies are. */
export const pacificToday = () => PACIFIC_DAY.format(new Date());

/** The Pacific calendar date of a timestamp. */
export const pacificDate = (ts: string) => PACIFIC_DAY.format(new Date(ts));

export function addDays(iso: string, n: number): string {
  const d = new Date(`${iso}T12:00:00Z`);
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
}

/** Whole days from one date to another; negative when `to` is in the past. */
export const daysBetween = (from: string, to: string) =>
  Math.round((Date.parse(`${to.slice(0, 10)}T12:00:00Z`) - Date.parse(`${from.slice(0, 10)}T12:00:00Z`)) / 86_400_000);

export const longDate = (iso: string) => LONG.format(noonUtc(iso));

export const shortDate = (iso: string) => SHORT.format(noonUtc(iso));

/** A list's date column: "Oct 1" within today's year, "Oct 1, 2025" for any other year. */
export const dayLabel = (iso: string, today: string) => (iso.slice(0, 4) === today.slice(0, 4) ? SHORT_NO_YEAR.format(noonUtc(iso)) : shortDate(iso));

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

/** The Pacific clock time of a timestamp, e.g. "2:14 PM". */
export const pacificTime = (ts: string) => PACIFIC_TIME.format(new Date(ts));

/** A timestamp as one phrase, e.g. "Oct 1, 2026 at 2:14 PM" (Pacific). */
export const atText = (ts: string) => `${shortDate(pacificDate(ts))} at ${pacificTime(ts)}`;

/** A Pacific wall-clock time ("2026-10-01T19:01:50") as a real UTC timestamp. */
function pacificWallClock(wall: string): string | null {
  const asUtc = new Date(`${wall.slice(0, 19)}Z`);
  if (Number.isNaN(asUtc.getTime())) return null;
  const p = Object.fromEntries(PACIFIC_PARTS.formatToParts(asUtc).map((x) => [x.type, Number(x.value)]));
  const offset = asUtc.getTime() - Date.UTC(p.year, p.month - 1, p.day, p.hour, p.minute, p.second);
  return new Date(asUtc.getTime() + offset).toISOString();
}

/** When a PayPal invoice payment happened, as a real UTC timestamp. PayPal writes payment_date_time as the
 *  account's Pacific wall-clock time with a "Z" on it (a 1:46 PM payment comes back as "13:46:36Z"), so read
 *  literally it puts payments made between midnight and about 8 AM on the day before. payment_date is PayPal's own
 *  calendar date for the payment: when the wall clock agrees with it, the wall clock is Pacific; when it doesn't,
 *  the timestamp is a true UTC one and is used as is. With only payment_date, noon Pacific on that day. */
export function paypalPaidAt(txn: { payment_date_time?: string; payment_date?: string } | null | undefined): string | null {
  const ts = txn?.payment_date_time, day = txn?.payment_date;
  if (ts && day && ts.slice(0, 10) === day) return pacificWallClock(ts) ?? ts;
  if (ts) return ts;
  return day && realDate(day) ? pacificWallClock(`${day}T12:00:00`) : null;
}

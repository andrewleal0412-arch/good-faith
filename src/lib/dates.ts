// Calendar-date helpers shared by the rules, the pages and the .ics feed. Dates are YYYY-MM-DD strings. The statutes
// count calendar days, so every date is handled at noon UTC and never slips across a day boundary.
//
// Time zones (Andrew, 2026-10-05): a property's deadlines are counted in its own state's time zone, the one its pack
// names (src/lib/states/, `timeZone`): "today", the calendar day of a refund or a delivery, and so every "days left",
// forfeiture and lateness. todayIn and dateIn take that zone; the Pacific helpers below are the same functions for
// America/Los_Angeles, for what belongs to no property (the landlord's own feed, PayPal's account clock).
//
// The formatters are made once per zone: toLocaleDateString with options builds a new Intl formatter on every call,
// which was the app's own biggest cost on the server (a page formats hundreds of dates). Same locale and options, same
// output.

/** California's zone, and every pack's before the packs had one. */
export const PACIFIC = "America/Los_Angeles";

type ZoneFormats = { day: Intl.DateTimeFormat; time: Intl.DateTimeFormat; parts: Intl.DateTimeFormat };
const ZONES = new Map<string, ZoneFormats>();

function zoneFormats(zone: string): ZoneFormats {
  let f = ZONES.get(zone);
  if (!f) {
    f = {
      day: new Intl.DateTimeFormat("en-CA", { timeZone: zone }),
      // Pacific times read as they always did ("2:14 PM"); another zone's carry its short name ("2:14 PM EDT"), so a
      // time on a New York property is never mistaken for California's.
      time: new Intl.DateTimeFormat("en-US", { hour: "numeric", minute: "2-digit", timeZone: zone, ...(zone === PACIFIC ? {} : { timeZoneName: "short" }) }),
      parts: new Intl.DateTimeFormat("en-US", {
        timeZone: zone, hourCycle: "h23",
        year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", second: "2-digit",
      }),
    };
    ZONES.set(zone, f);
  }
  return f;
}

const SHORT = new Intl.DateTimeFormat("en-US", { month: "short", day: "numeric", year: "numeric", timeZone: "UTC" });
const SHORT_NO_YEAR = new Intl.DateTimeFormat("en-US", { month: "short", day: "numeric", timeZone: "UTC" });
const LONG = new Intl.DateTimeFormat("en-US", { month: "long", day: "numeric", year: "numeric", timeZone: "UTC" });
const noonUtc = (iso: string) => new Date(`${iso.slice(0, 10)}T12:00:00Z`);

/** Today's calendar date in a time zone: a property's, from its state pack (`pack.timeZone.id`). */
export const todayIn = (zone: string, now: Date = new Date()) => zoneFormats(zone).day.format(now);

/** The calendar date of a timestamp in a time zone: the day a refund went or a record was made, where the property is. */
export const dateIn = (ts: string | number | Date, zone: string) => zoneFormats(zone).day.format(new Date(ts));

/** The clock time of a timestamp in a time zone, e.g. "2:14 PM", or "11:30 PM EDT" outside Pacific time. */
export const timeIn = (ts: string | number | Date, zone: string) => zoneFormats(zone).time.format(new Date(ts));

/** A timestamp as one phrase in a time zone, e.g. "Oct 1, 2026 at 2:14 PM" (Pacific) or "Oct 1, 2026 at 11:30 PM EDT". */
export const atTextIn = (ts: string, zone: string) => `${shortDate(dateIn(ts, zone))} at ${timeIn(ts, zone)}`;

/** Today's date in California. For what belongs to no property; a property's own today is todayIn(its zone). */
export const pacificToday = () => todayIn(PACIFIC);

/** The Pacific calendar date of a timestamp. A property's own day is dateIn(ts, its zone). */
export const pacificDate = (ts: string) => dateIn(ts, PACIFIC);

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
export const pacificTime = (ts: string) => timeIn(ts, PACIFIC);

/** A timestamp as one phrase, e.g. "Oct 1, 2026 at 2:14 PM" (Pacific). */
export const atText = (ts: string) => atTextIn(ts, PACIFIC);

/** How far a zone's clock is from UTC at an instant, in milliseconds (negative west of Greenwich). */
function offsetAt(ms: number, zone: string): number {
  const p = Object.fromEntries(zoneFormats(zone).parts.formatToParts(new Date(ms)).map((x) => [x.type, Number(x.value)]));
  return Date.UTC(p.year, p.month - 1, p.day, p.hour, p.minute, p.second) - Math.floor(ms / 1000) * 1000;
}

/** A wall-clock time in a zone ("2026-10-01T19:01:50") as a real UTC timestamp. The zone's offset is read at a first
 *  guess and again where that guess lands, so a time just after a daylight-saving change gets the new offset: 3:00 AM
 *  on the day Pacific time falls back is PST, and 1:30 AM, which happens twice, is the first one (PDT). A time the
 *  spring-forward gap skips (2:30 AM) reads as the clock an hour later (3:30 AM daylight time). */
export function wallClockIn(wall: string, zone: string): string | null {
  const asUtc = Date.parse(`${wall.slice(0, 19)}Z`);
  if (Number.isNaN(asUtc)) return null;
  const first = offsetAt(asUtc, zone);
  const second = offsetAt(asUtc - first, zone);
  // The second guess is right when the zone shows that wall clock at it; otherwise the time is in the gap.
  const at = first === second || offsetAt(asUtc - second, zone) !== second ? asUtc - first : asUtc - second;
  return new Date(at).toISOString();
}

/** When a PayPal invoice payment happened, as a real UTC timestamp. PayPal writes payment_date_time as the
 *  account's Pacific wall-clock time with a "Z" on it (a 1:46 PM payment comes back as "13:46:36Z"), so read
 *  literally it puts payments made between midnight and about 8 AM on the day before. payment_date is PayPal's own
 *  calendar date for the payment: when the wall clock agrees with it, the wall clock is Pacific; when it doesn't,
 *  the timestamp is a true UTC one and is used as is. With only payment_date, noon Pacific on that day. The clock is
 *  the PayPal account's, not the property's, so it stays Pacific whatever the property's state. */
export function paypalPaidAt(txn: { payment_date_time?: string; payment_date?: string } | null | undefined): string | null {
  const ts = txn?.payment_date_time, day = txn?.payment_date;
  if (ts && day && ts.slice(0, 10) === day) return wallClockIn(ts, PACIFIC) ?? ts;
  if (ts) return ts;
  return day && realDate(day) ? wallClockIn(`${day}T12:00:00`, PACIFIC) : null;
}

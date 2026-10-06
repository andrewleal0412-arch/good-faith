import { addDays, PACIFIC } from "./dates";
import { inspectionWindowOpens } from "./notices";
import { CHECK_IN_DAYS_BEFORE_END, closedOut, dueOf, packOf, tenancyEnds, type TenancySummary } from "./next-step";

// The tenancy's dates as an iCalendar file (RFC 5545) the landlord adds to Apple, Google or Outlook once, so the
// reminders live where they already look. All-day events in the property's zone (its state pack's: America/Los_Angeles
// in California); no email service involved. The words and the citations are the tenancy's state pack's.

export type EventKind = "check_in" | "inspection_window" | "move_out" | "statement_due";

export type CalendarEvent = { kind: EventKind; uid: string; date: string; label: string; summary: string; description: string };

/** The dates that still matter, from what the tenancy knows so far. Nothing is guessed: a tenancy with no lease end,
 *  no notice and no move-out has no events yet. Nothing is stale either: a closed-out tenancy has none, the 60-day
 *  check-in goes once notice is given or the tenants are out, and the inspection window goes once they are out. */
export function tenancyEvents(t: TenancySummary): CalendarEvent[] {
  const out: CalendarEvent[] = [];
  if (closedOut(t)) return out;
  const pack = packOf(t);
  const cal = pack.calendar;
  const where = t.address;
  if (t.endDate && !t.noticeGivenOn && !t.moveOutDate) {
    out.push({
      kind: "check_in", uid: `${t.id}-check-in`, date: addDays(t.endDate, -CHECK_IN_DAYS_BEFORE_END),
      label: "Lease check-in, 60 days before the end", summary: `Lease check-in: ${where}`,
      description: cal.checkIn(where, t.endDate),
    });
  }
  const ends = tenancyEnds(t);
  if (ends) {
    const what = t.moveOutDate ? "Move-out" : t.plannedMoveOut ? "Planned move-out" : "Lease ends";
    const windowOpens = inspectionWindowOpens(ends, pack);
    if (!t.moveOutDate && windowOpens) {
      out.push({
        kind: "inspection_window", uid: `${t.id}-inspection-window`, date: windowOpens,
        label: "Inspection window opens, two weeks before the end", summary: `Inspection window opens: ${where}`,
        description: cal.window(ends),
      });
    }
    out.push({
      kind: "move_out", uid: `${t.id}-move-out`, date: ends,
      label: what, summary: `${what}: ${where}`,
      description: cal.moveOut(what === "Lease ends" ? `The lease at ${where} ends today.` : `${t.tenants.join(" and ")} ${what === "Move-out" ? "moved" : "plan to move"} out of ${where} today.`),
    });
    const due = dueOf(t, ends);
    if (due) {
      out.push({
        kind: "statement_due", uid: `${t.id}-statement-due`, date: due,
        label: cal.due.label, summary: cal.due.summary(where),
        description: cal.due.description(ends),
      });
    }
  }
  return out;
}

const escapeText = (s: string) => s.replace(/\\/g, "\\\\").replace(/;/g, "\\;").replace(/,/g, "\\,").replace(/\r?\n/g, "\\n");
const icsDate = (iso: string) => iso.replace(/-/g, "");
const icsStamp = (d: Date) => d.toISOString().replace(/[-:]/g, "").replace(/\.\d{3}/, "");

/** RFC 5545 3.1: lines longer than 75 octets are folded with CRLF followed by a space. Counted in UTF-8 bytes. */
function fold(line: string): string {
  const enc = new TextEncoder();
  const out: string[] = [];
  let cur = "", bytes = 0;
  for (const ch of line) {
    const b = enc.encode(ch).length;
    if (bytes + b > 75) { out.push(cur); cur = " "; bytes = 1; }
    cur += ch;
    bytes += b;
  }
  out.push(cur);
  return out.join("\r\n");
}

/** A VCALENDAR with one all-day VEVENT per date and a 9 a.m. reminder on each. */
export function buildIcs(events: CalendarEvent[], opts: { name: string; url?: string | null; stamp?: Date; zone?: string }): string {
  const stamp = icsStamp(opts.stamp ?? new Date());
  const lines: string[] = [
    "BEGIN:VCALENDAR",
    "VERSION:2.0",
    "PRODID:-//Good Faith//Security deposit dates//EN",
    "CALSCALE:GREGORIAN",
    "METHOD:PUBLISH",
    `X-WR-CALNAME:${escapeText(opts.name)}`,
    `X-WR-TIMEZONE:${opts.zone ?? PACIFIC}`,
  ];
  for (const e of events) {
    lines.push(
      "BEGIN:VEVENT",
      `UID:${e.uid}@goodfaith`,
      `DTSTAMP:${stamp}`,
      `DTSTART;VALUE=DATE:${icsDate(e.date)}`,
      `DTEND;VALUE=DATE:${icsDate(addDays(e.date, 1))}`,
      `SUMMARY:${escapeText(e.summary)}`,
      `DESCRIPTION:${escapeText(e.description)}`,
      "TRANSP:TRANSPARENT",
    );
    if (opts.url) lines.push(`URL:${opts.url}`);
    // An all-day event has no clock time; nine hours after its start is 9 a.m. local on the day.
    lines.push("BEGIN:VALARM", "ACTION:DISPLAY", `DESCRIPTION:${escapeText(e.summary)}`, "TRIGGER;RELATED=START:PT9H", "END:VALARM", "END:VEVENT");
  }
  lines.push("END:VCALENDAR");
  return lines.map(fold).join("\r\n") + "\r\n";
}

import { addDays, longDate } from "./dates";
import { statementDue } from "./deductions";
import { inspectionWindowOpens } from "./notices";
import { CHECK_IN_DAYS_BEFORE_END, closedOut, tenancyEnds, type TenancySummary } from "./next-step";

// The tenancy's dates as an iCalendar file (RFC 5545) the landlord adds to Apple, Google or Outlook once, so the
// reminders live where they already look. All-day events in America/Los_Angeles; no email service involved.

export type EventKind = "check_in" | "inspection_window" | "move_out" | "statement_due";

export type CalendarEvent = { kind: EventKind; uid: string; date: string; label: string; summary: string; description: string };

/** The dates that still matter, from what the tenancy knows so far. Nothing is guessed: a tenancy with no lease end,
 *  no notice and no move-out has no events yet. Nothing is stale either: a closed-out tenancy has none, the 60-day
 *  check-in goes once notice is given or the tenants are out, and the inspection window goes once they are out. */
export function tenancyEvents(t: TenancySummary): CalendarEvent[] {
  const out: CalendarEvent[] = [];
  if (closedOut(t)) return out;
  const where = t.address;
  if (t.endDate && !t.noticeGivenOn && !t.moveOutDate) {
    out.push({
      kind: "check_in", uid: `${t.id}-check-in`, date: addDays(t.endDate, -CHECK_IN_DAYS_BEFORE_END),
      label: "Lease check-in, 60 days before the end", summary: `Lease check-in: ${where}`,
      description: `The lease at ${where} ends ${longDate(t.endDate)}, 60 days from today. Ask the tenants whether they are staying. Once either side gives notice, the initial-inspection notice (Civ. Code 1950.5(f)(1)) and, if the deposit or rent was paid electronically, the electronic-refund notice ((h)(1)(A)(ii)(II)) follow.`,
    });
  }
  const ends = tenancyEnds(t);
  if (ends) {
    const what = t.moveOutDate ? "Move-out" : t.plannedMoveOut ? "Planned move-out" : "Lease ends";
    if (!t.moveOutDate) {
      out.push({
        kind: "inspection_window", uid: `${t.id}-inspection-window`, date: inspectionWindowOpens(ends),
        label: "Inspection window opens, two weeks before the end", summary: `Inspection window opens: ${where}`,
        description: `From today the tenants may have their initial inspection, if they requested one: no earlier than two weeks before the tenancy ends on ${longDate(ends)}, with at least 48 hours' written notice of the date and time (Civ. Code 1950.5(f)(1)).`,
      });
    }
    out.push({
      kind: "move_out", uid: `${t.id}-move-out`, date: ends,
      label: what, summary: `${what}: ${where}`,
      description: `${what === "Lease ends" ? `The lease at ${where} ends today.` : `${t.tenants.join(" and ")} ${what === "Move-out" ? "moved" : "plan to move"} out of ${where} today.`} Photograph the unit within a reasonable time after possession is returned, before any repair or cleaning (Civ. Code 1950.5(g)(2)). The 21-day clock for the itemized statement and the refund starts at move-out ((h)(1)).`,
    });
    out.push({
      kind: "statement_due", uid: `${t.id}-statement-due`, date: statementDue(ends),
      label: "Statement and refund due, 21 days after move-out", summary: `Deposit statement and refund due: ${where}`,
      description: `Last day to furnish the itemized statement and return the rest of the security deposit: 21 calendar days after the ${longDate(ends)} move-out (Civ. Code 1950.5(h)(1)).`,
    });
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
export function buildIcs(events: CalendarEvent[], opts: { name: string; url?: string | null; stamp?: Date }): string {
  const stamp = icsStamp(opts.stamp ?? new Date());
  const lines: string[] = [
    "BEGIN:VCALENDAR",
    "VERSION:2.0",
    "PRODID:-//Deposit Agent//Security deposit dates//EN",
    "CALSCALE:GREGORIAN",
    "METHOD:PUBLISH",
    `X-WR-CALNAME:${escapeText(opts.name)}`,
    "X-WR-TIMEZONE:America/Los_Angeles",
  ];
  for (const e of events) {
    lines.push(
      "BEGIN:VEVENT",
      `UID:${e.uid}@deposit-agent`,
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

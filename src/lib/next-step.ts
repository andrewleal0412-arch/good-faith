import { addDays, daysBetween, longDate, pacificDate } from "./dates";
import { settle, statementDue, usd } from "./deductions";
import { wasPaid } from "./invoice-status";
import { inspectionWindowOpens, type Notices, type RefundNoticeStatus } from "./notices";
import { MOVE_IN_PHOTOS_FROM } from "./rules";

// The next thing each tenancy needs, computed from its own dates and the rules in docs/LEGAL_RULES.md, so nothing
// depends on the landlord remembering. Pure: the units page, the tenancy page and the calendar feed all read it.

/** One tenancy as the home base sees it: what the database holds, no PayPal round trip. */
export type TenancySummary = {
  id: string;
  address: string;
  city: string | null;
  landlord: string | null;
  tenants: string[];
  monthlyRent: number | null;
  status: string;
  startDate: string | null;
  endDate: string | null; // end of a fixed-term lease; null means month to month or not recorded
  noticeGivenOn: string | null;
  plannedMoveOut: string | null;
  moveOutDate: string | null; // the actual move-out, which starts the 21-day clock
  moveOutInspectedAt: string | null;
  statementDeliveredAt: string | null;
  agreement: boolean; // the AB 414 refund-method agreement is on file
  deposit: { amount: number; status: string; paypalId: string | null } | null; // the deposit invoice as last stored
  depositElectronic: boolean; // the deposit reached the landlord electronically, which is what makes (h)(1)(A) apply
  moveInPhotos: number;
  moveOutPhotos: number;
  deductions: { category: string; amount: number }[]; // what comes off the deposit, the same rows the close-out settles
  returned: { amount: number; kind: string } | null;
  notices: Notices;
  refundNotice: RefundNoticeStatus;
};

export type Level = "overdue" | "urgent" | "soon" | "later" | "done";

export type NextStep = {
  label: string;
  detail: string;
  cite: string | null; // only citations from docs/LEGAL_RULES.md
  due: string | null; // the deadline, or the date the step turns on
  dueLabel: string | null; // what `due` is when it is neither, e.g. "Window opens"
  deadline: boolean; // true when `due` is a deadline, false when it is the day something happens
  daysLeft: number | null;
  level: Level;
  also: string[]; // earlier steps still open behind this one, e.g. an unpaid deposit invoice once notice is given
};

export const LEVEL_ORDER: Record<Level, number> = { overdue: 0, urgent: 1, soon: 2, later: 3, done: 4 };

/** Sixty days before the lease ends: the check-in reminder. (h)(1) also lets the statement go out no earlier than
 *  60 calendar days before a fixed-term lease expires, which is why the window starts there. */
export const CHECK_IN_DAYS_BEFORE_END = 60;

/** The date the tenancy ends, best known: the actual move-out, else the one planned at notice, else the lease end. */
export const tenancyEnds = (t: TenancySummary) => t.moveOutDate ?? t.plannedMoveOut ?? t.endDate;

const depositPaid = (t: TenancySummary) => !!t.deposit && wasPaid(t.deposit.status);

/** What is left to return once the deductions come off the paid deposit, by the same math the close-out uses
 *  (settle in deductions.ts); null until the deposit is paid. */
export const refundLeft = (t: TenancySummary): number | null => (t.deposit && depositPaid(t) ? settle(t.deposit.amount, t.deductions).refund : null);

/** Closed out (D15): the statement went out and the money is back, no deposit was ever paid, or the deductions used
 *  the whole deposit (the close-out's nothing_to_refund rail moves no money and writes no payment row). */
export const closedOut = (t: TenancySummary) => !!t.statementDeliveredAt && (!!t.returned || !depositPaid(t) || refundLeft(t) === 0);

/** A missed deadline is overdue. A date that is not a deadline (the day the window opens, the planned move-out) can
 *  pass without anything being late: the step just needs attention now. */
const levelFor = (daysLeft: number, deadline: boolean): Level =>
  daysLeft < 0 ? (deadline ? "overdue" : "urgent") : daysLeft <= 5 ? "urgent" : daysLeft <= 30 ? "soon" : "later";

export function nextStep(t: TenancySummary, today: string): NextStep {
  const paid = depositPaid(t);
  const started = !!t.startDate && t.startDate <= today;
  const dated = (label: string, detail: string, cite: string | null, due: string, deadline = true, dueLabel: string | null = null): NextStep => {
    const daysLeft = daysBetween(today, due);
    return { label, detail, cite, due, dueLabel, deadline, daysLeft, level: levelFor(daysLeft, deadline), also: [] };
  };
  const undated = (label: string, detail: string, cite: string | null, level: Level): NextStep =>
    ({ label, detail, cite, due: null, dueLabel: null, deadline: false, daysLeft: null, level, also: [] });

  // Move-in steps that stay open once the tenancy is ending; the card lists them under the step that is now due.
  const openMoveIn: string[] = [];
  if (!t.agreement) openMoveIn.push("no written refund agreement on file");
  if (!t.deposit) openMoveIn.push("no deposit invoice sent");
  else if (!paid) openMoveIn.push(`deposit invoice ${t.deposit.status.toLowerCase().replace(/_/g, " ")}, not paid`);
  if (!t.moveInPhotos && started && t.startDate && t.startDate >= MOVE_IN_PHOTOS_FROM) openMoveIn.push("no move-in photos");
  const withOpen = (s: NextStep): NextStep => ({ ...s, also: openMoveIn });

  // Closed out: the statement went out and nothing is left to return (D15).
  if (t.statementDeliveredAt) {
    const delivered = longDate(pacificDate(t.statementDeliveredAt));
    const left = refundLeft(t);
    if (closedOut(t)) {
      const how = t.returned ? `; ${usd(t.returned.amount)} returned by PayPal`
        : !paid ? "; no deposit was paid through PayPal, so there was nothing to return"
          : "; the deductions used the whole deposit, so nothing was left to return";
      return { label: "Done", detail: `Statement delivered ${delivered}${how}.`,
        cite: "Civ. Code 1950.5(h)(1)", due: null, dueLabel: null, deadline: false, daysLeft: null, level: "done", also: [] };
    }
    const detail = `The statement went out ${delivered}; ${left == null ? "the rest of the deposit" : usd(left)} is still to be returned.`;
    if (t.moveOutDate) return dated("Send the refund", detail, "Civ. Code 1950.5(h)(1)", statementDue(t.moveOutDate));
    return undated("Send the refund", detail, "Civ. Code 1950.5(h)(1)", "urgent");
  }

  // Moved out: the 21-day clock is running (D14, D15).
  if (t.moveOutDate) {
    const due = statementDue(t.moveOutDate);
    if (!t.moveOutPhotos) return withOpen(dated("Take move-out photos", "Before any repair or cleaning that will be deducted, and again after. They go with the statement.", "Civ. Code 1950.5(g)(2)", due));
    if (!t.moveOutInspectedAt) return withOpen(dated("Compare move-in and move-out photos", "Then decide the deductions and build the itemized statement.", "Civ. Code 1950.5(h)(1)", due));
    if (t.returned) return withOpen(dated("Record the statement delivery", `${usd(t.returned.amount)} went back by PayPal; the itemized statement still has to reach the tenants.`, "Civ. Code 1950.5(h)(1)(B)", due));
    return withOpen(dated("Send the itemized statement and refund", `Due 21 calendar days after the ${longDate(t.moveOutDate)} move-out.`, "Civ. Code 1950.5(h)(1)", due));
  }

  // Notice given: the two written notices, then the inspection window and the move-out (D11, D17). The statute asks
  // for each notice "within a reasonable time" after the notice to end the tenancy and sets no day it becomes late,
  // so the card shows the day the inspection window opens as the date that matters, not as a deadline.
  if (t.noticeGivenOn) {
    const ends = t.plannedMoveOut ?? t.endDate;
    const windowOpens = ends ? inspectionWindowOpens(ends) : null;
    if (!t.notices.inspection) {
      const detail = `In writing, within a reasonable time after the ${longDate(t.noticeGivenOn)} notice: the tenants' option to request an initial inspection and to be present${windowOpens ? `. The inspection may happen from ${longDate(windowOpens)}` : ""}.`;
      return withOpen(windowOpens ? dated("Send the initial-inspection notice", detail, "Civ. Code 1950.5(f)(1)", windowOpens, false, "Window opens")
        : undated("Send the initial-inspection notice", detail, "Civ. Code 1950.5(f)(1)", "urgent"));
    }
    if (t.refundNotice.needed !== false && !t.notices.electronic_refund) {
      const label = t.refundNotice.needed ? "Send the electronic-refund notice" : "Check whether the electronic-refund notice is owed";
      // The full reason is on the tenancy page; the card gets one line.
      const detail = t.refundNotice.needed
        ? "The deposit came in electronically and no written refund-method agreement is on file. In writing, within a reasonable time after the notice: the tenants' right to an electronic refund."
        : "No written refund-method agreement is on file. The notice is owed if the deposit or any rent was received electronically.";
      return withOpen(windowOpens ? dated(label, detail, "Civ. Code 1950.5(h)(1)(A)(ii)(II)", windowOpens, false, "Window opens")
        : undated(label, detail, "Civ. Code 1950.5(h)(1)(A)(ii)(II)", "soon"));
    }
    if (!ends || !windowOpens) return withOpen(undated("Set the planned move-out date", "It sets the inspection window and, once the keys are back, the 21-day clock.", null, "soon"));
    if (today < windowOpens) {
      return withOpen(dated("Inspection window opens", `If the tenants request an initial inspection, it may happen from ${longDate(windowOpens)}, with 48 hours' written notice of the date and time.`, "Civ. Code 1950.5(f)(1)", windowOpens, false));
    }
    return withOpen(dated("Move-out", `Planned for ${longDate(ends)}. Record the actual move-out date when possession is returned; the 21-day clock starts then.`, "Civ. Code 1950.5(h)(1)", ends, false));
  }

  // Move-in steps still open (D16, D3, D13).
  if (!t.agreement) {
    return undated("Record the tenants' refund agreement", "A deposit paid electronically comes back electronically, and by PayPal only with every adult tenant's written agreement.",
      "Civ. Code 1950.5(h)(1)(A), (h)(1)(C)", started ? "urgent" : "soon");
  }
  if (!t.deposit) return undated("Send the PayPal deposit invoice", "For the lawful amount: the agent caps it at the legal maximum.", "Civ. Code 1950.5(c)", started ? "urgent" : "soon");
  if (!paid) {
    return undated("Deposit invoice unpaid", `The PayPal invoice for ${usd(t.deposit.amount)} is ${t.deposit.status.toLowerCase().replace(/_/g, " ")}. Nothing to do until the tenants pay.`,
      "Civ. Code 1950.5(c)", "soon");
  }
  if (!t.moveInPhotos) {
    if (t.startDate && t.startDate >= MOVE_IN_PHOTOS_FROM) {
      const detail = "Required immediately before or at the start of a tenancy that began on or after July 1, 2025. Without them, deductions are hard to support at move-out.";
      return started ? undated("Take move-in photos", detail, "Civ. Code 1950.5(g)(1)", "overdue") : dated("Take move-in photos", detail, "Civ. Code 1950.5(g)(1)", t.startDate);
    }
    return undated("Add move-in condition evidence", "This tenancy began before July 1, 2025, so move-in photos were not required, but the landlord still carries the burden of proving the move-in condition at move-out. Photos, a checklist or the prior tenant's statement all help.",
      "Civ. Code 1950.5(m)", "later");
  }

  // Active with nothing owed: wait for the lease end or a notice.
  if (t.endDate) {
    const checkIn = addDays(t.endDate, -CHECK_IN_DAYS_BEFORE_END);
    if (daysBetween(today, t.endDate) < 0) {
      return undated("Lease ended; record what happened next", `The ${longDate(t.endDate)} lease end has passed. Record the tenants' notice if they are leaving, or the new lease end if they renewed; otherwise the tenancy runs month to month.`, null, "soon");
    }
    if (today >= checkIn) return dated("Lease ends", "Ask whether the tenants are staying. Once either side gives notice, the inspection and refund notices follow.", "Civ. Code 1950.5(f)(1)", t.endDate, false);
    return dated("Check in 60 days before the lease ends", `The lease ends ${longDate(t.endDate)}. Nothing is due before the check-in.`, null, checkIn, false);
  }
  return undated("Nothing due", "Month to month. When either side gives notice, record it on the tenancy and the notices and dates follow.", null, "later");
}

/** Most urgent first: overdue, then by days left, then the open steps with no date, then the finished ones. */
export function byUrgency(a: { next: NextStep }, b: { next: NextStep }): number {
  const l = LEVEL_ORDER[a.next.level] - LEVEL_ORDER[b.next.level];
  if (l) return l;
  const da = a.next.daysLeft ?? Number.POSITIVE_INFINITY, dbb = b.next.daysLeft ?? Number.POSITIVE_INFINITY;
  return da - dbb;
}

export const STATUS_LABEL: Record<string, string> = {
  move_in: "Move-in", active: "Active", moving_out: "Moving out", statement_sent: "Statement sent", closed: "Closed",
};

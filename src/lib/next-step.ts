import { addDays, daysBetween, longDate, pacificDate } from "./dates";
import { settle, usd } from "./deductions";
import { wasPaid } from "./invoice-status";
import { inspectionWindowOpens, noticeInfoFor, type Notices, type RefundNoticeStatus } from "./notices";
import { deadlineWords, packFor } from "./states/server";
import type { StateCode, StatePack, StepHelpers } from "./states/types";

// The next thing each tenancy needs, computed from its own dates and its state's rule pack (California's from
// docs/LEGAL_RULES.md, the others from docs/rules/), so nothing depends on the landlord remembering. Each state's own
// requirements (a Washington checklist before the deposit, a Texas forwarding address, a Florida claim notice) come in
// through the pack as steps of the same kind. Pure: the units page, the tenancy page and the calendar feed all read it.

/** A tenants' dispute the landlord sees that hasn't ended (settled, no agreement and withdrawn have). */
export type LiveDispute = "open" | "negotiating" | "agreed";
export const liveDispute = (status: string | null | undefined): LiveDispute | null =>
  status === "open" || status === "negotiating" || status === "agreed" ? status : null;

/** One tenancy as the home base sees it: what the database holds, no PayPal round trip. */
export type TenancySummary = {
  id: string;
  state: StateCode; // whose deposit law the tenancy follows
  address: string;
  city: string | null;
  landlord: string | null;
  tenants: string[];
  monthlyRent: number | null;
  status: string;
  startDate: string | null;
  endDate: string | null; // end of a fixed-term lease; null means month to month or not recorded
  noticeGivenOn: string | null;
  noticeGivenBy?: "tenant" | "landlord" | null; // who gave it, where the state asks (New York's 7-108(1-a)(d)); null if not recorded
  plannedMoveOut: string | null;
  moveOutDate: string | null; // the actual move-out, which starts the state's clock
  moveOutInspectedAt: string | null;
  statementDeliveredAt: string | null;
  agreement: boolean; // the tenants' written refund-method agreement is on file (California's AB 414)
  deposit: { amount: number; status: string; paypalId: string | null } | null; // the deposit invoice as last stored
  depositElectronic: boolean; // the deposit reached the landlord electronically, which is what makes California's (h)(1)(A) apply
  moveInPhotos: number;
  moveOutPhotos: number;
  deductions: { category: string; amount: number }[]; // what comes off the deposit, the same rows the close-out settles
  returned: { amount: number; kind: string } | null;
  notices: Notices;
  refundNotice: RefundNoticeStatus;
  tenantMoveOut: { name: string | null; plannedMoveOut: string; forwardingAddress: string; sentOn: string } | null; // what the tenants sent through their link
  dispute?: LiveDispute | null; // a dispute the tenants sent that hasn't ended; absent where the caller didn't load it
  landlordUnits?: number | null; // dwelling units the owner rents, from the lease (Florida's holding notice: five or more)
  buildingUnits?: number | null; // dwelling units in the building, from the lease (New York's interest rule: six or more)
};

export type Level = "overdue" | "urgent" | "soon" | "later" | "done";

/** The icons a step's link may carry (property-view.ts draws them). */
export type StepIcon = "image" | "camera" | "send" | "mail" | "doc" | "pen" | "calendar" | "file-check" | "receive" | "card" | "key";

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
  // Where a state pack's own step opens (a record page or a tab), with its verb; California's steps link by label.
  action?: { label: string; path: string; icon: StepIcon };
};

export const LEVEL_ORDER: Record<Level, number> = { overdue: 0, urgent: 1, soon: 2, later: 3, done: 4 };

/** Sixty days before the lease ends: the check-in reminder. (h)(1) also lets the statement go out no earlier than
 *  60 calendar days before a fixed-term lease expires, which is why the window starts there. */
export const CHECK_IN_DAYS_BEFORE_END = 60;

/** The date the tenancy ends, best known: the actual move-out, else the one planned at notice, else the lease end. */
export const tenancyEnds = (t: TenancySummary) => t.moveOutDate ?? t.plannedMoveOut ?? t.endDate;

const depositPaid = (t: TenancySummary) => !!t.deposit && wasPaid(t.deposit.status);

/** The tenancy's pack. */
export const packOf = (t: Pick<TenancySummary, "state">): StatePack => packFor(t.state);

/** The statement and refund deadline under the tenancy's pack, from everything the tenancy knows (Florida's turns on
 *  whether a claim is made and when its notice went out); null before the move-out. */
export const dueOf = (t: TenancySummary, moveOut = t.moveOutDate): string | null => packOf(t).deadline.due({
  moveOutDate: moveOut, endDate: t.endDate, plannedMoveOut: t.plannedMoveOut,
  claimed: t.deductions.length > 0, claimNoticeDate: t.notices.claim_notice?.date ?? null,
});

/** The deadline's label on the tenancy's track: "Statement and refund due", or Florida's "Claim notice due" and
 *  "Balance and statement due" once a claim is made. */
export const dueLabelOf = (t: TenancySummary): string => deadlineWords(packOf(t), {
  moveOutDate: t.moveOutDate, endDate: t.endDate, plannedMoveOut: t.plannedMoveOut,
  claimed: t.deductions.length > 0, claimNoticeDate: t.notices.claim_notice?.date ?? null,
}).due;

/** New York: the inspection-rights notice is excused only when the tenants ended the tenancy with less than the pack's
 *  notice (two weeks, 7-108(1-a)(d)). A landlord's notice, or one whose giver isn't recorded, never excuses it. */
export function inspectionExcused(t: Pick<TenancySummary, "state" | "noticeGivenOn" | "noticeGivenBy" | "plannedMoveOut" | "endDate">): boolean {
  const skip = packOf(t).notices.inspection?.skipIfShortNotice;
  const ends = t.plannedMoveOut ?? t.endDate;
  return !!skip && !!t.noticeGivenOn && t.noticeGivenBy === "tenant" && !!ends && daysBetween(t.noticeGivenOn, ends) < skip;
}

/** What is left to return once the deductions come off the paid deposit, by the same math the close-out uses
 *  (settle in deductions.ts); null until the deposit is paid. */
export const refundLeft = (t: TenancySummary): number | null => (t.deposit && depositPaid(t) ? settle(t.deposit.amount, t.deductions, packOf(t)).refund : null);

/** Closed out (D15): the statement went out and the money is back, no deposit was ever paid, or the deductions used
 *  the whole deposit (the close-out's nothing_to_refund rail moves no money and writes no payment row). */
export const closedOut = (t: TenancySummary) => !!t.statementDeliveredAt && (!!t.returned || !depositPaid(t) || refundLeft(t) === 0);

/** A missed deadline is overdue. A date that is not a deadline (the day the window opens, the planned move-out) can
 *  pass without anything being late: the step just needs attention now. */
const levelFor = (daysLeft: number, deadline: boolean): Level =>
  daysLeft < 0 ? (deadline ? "overdue" : "urgent") : daysLeft <= 5 ? "urgent" : daysLeft <= 30 ? "soon" : "later";

export function nextStep(t: TenancySummary, today: string): NextStep {
  const pack = packOf(t);
  const flow = pack.steps.flow;
  const photosFrom = pack.moveIn.photosFrom;
  const paid = depositPaid(t);
  const started = !!t.startDate && t.startDate <= today;
  const dated = (label: string, detail: string, cite: string | null, due: string, deadline = true, dueLabel: string | null = null): NextStep => {
    const daysLeft = daysBetween(today, due);
    return { label, detail, cite, due, dueLabel, deadline, daysLeft, level: levelFor(daysLeft, deadline), also: [] };
  };
  const undated = (label: string, detail: string, cite: string | null, level: Level): NextStep =>
    ({ label, detail, cite, due: null, dueLabel: null, deadline: false, daysLeft: null, level, also: [] });
  const h: StepHelpers = { dated, undated };

  // Move-in steps that stay open once the tenancy is ending; the card lists them under the step that is now due.
  const openMoveIn: string[] = [];
  if (!t.agreement && pack.refund.agreementRequired) openMoveIn.push("no written refund agreement on file");
  if (!t.deposit) openMoveIn.push("no deposit invoice sent");
  else if (!paid) openMoveIn.push(`deposit invoice ${t.deposit.status.toLowerCase().replace(/_/g, " ")}, not paid`);
  if (!t.moveInPhotos && started && photosFrom && t.startDate && t.startDate >= photosFrom) openMoveIn.push("no move-in photos");
  openMoveIn.push(...pack.steps.openMoveIn(t));
  const withOpen = (s: NextStep): NextStep => ({ ...s, also: openMoveIn });

  // Closed out: the statement went out and nothing is left to return.
  if (t.statementDeliveredAt) {
    const delivered = longDate(pacificDate(t.statementDeliveredAt));
    const left = refundLeft(t);
    if (closedOut(t)) {
      const how = t.returned ? `; ${usd(t.returned.amount)} returned by PayPal`
        : !paid ? "; no deposit was paid through PayPal, so there was nothing to return"
          : "; the deductions used the whole deposit, so nothing was left to return";
      return { label: "Done", detail: `Statement delivered ${delivered}${how}.`,
        cite: flow.doneCite, due: null, dueLabel: null, deadline: false, daysLeft: null, level: "done", also: [] };
    }
    const detail = `The statement went out ${delivered}; ${left == null ? "the rest of the deposit" : usd(left)} is still to be returned.`;
    const due = dueOf(t);
    if (t.moveOutDate && due) return dated("Send the refund", detail, flow.sendRefundCite, due);
    return undated("Send the refund", detail, flow.sendRefundCite, "urgent");
  }

  // Moved out: the state's clock is running (California D14, D15: 21 days).
  if (t.moveOutDate) {
    const due = dueOf(t) ?? t.moveOutDate;
    if (!t.moveOutPhotos) return withOpen(dated("Take move-out photos", flow.photosOut.detail, flow.photosOut.cite, due));
    if (!t.moveOutInspectedAt) return withOpen(dated("Compare move-in and move-out photos", "Then decide the deductions and build the itemized statement.", flow.compareCite, due));
    const extra = pack.steps.afterInspection(t, today, h);
    if (extra) return withOpen(extra);
    if (t.returned) return withOpen(dated("Record the statement delivery", `${usd(t.returned.amount)} went back by PayPal; the itemized statement still has to reach the tenants.`, flow.deliveryCite, due));
    return withOpen(dated("Send the itemized statement and refund", flow.statementDetail(t.moveOutDate), flow.statementCite, due));
  }

  // The tenants said through their link that they are leaving and no notice is recorded yet: the landlord records it
  // so the written notices and every later date follow. It needs attention now, however far off the date is.
  if (t.tenantMoveOut && !t.noticeGivenOn) {
    const m = t.tenantMoveOut;
    const hasNotices = noticeKindsOf(pack).length > 0;
    const detail = `${m.name ?? "The tenants"} wrote through the tenant link on ${longDate(m.sentOn)}: moving out ${longDate(m.plannedMoveOut)}, with a forwarding address for the statement. Record the notice so ${hasNotices ? (pack.notices.refundNotice ? "the inspection and refund notices follow" : "the notices and dates follow") : "the dates follow"}.`;
    return withOpen({ ...dated("Record the tenants' notice", detail, flow.tenantNoticeCite, m.plannedMoveOut, false, "Planned move-out"), level: "urgent" });
  }

  // Notice given: the state's written notices, then the inspection window and the move-out (California D11, D17). The
  // statutes ask for each notice "within a reasonable time" after the notice to end the tenancy and set no day it
  // becomes late, so the card shows the day the inspection window opens as the date that matters, not as a deadline.
  if (t.noticeGivenOn) {
    const ends = t.plannedMoveOut ?? t.endDate;
    const windowOpens = ends ? inspectionWindowOpens(ends, pack) : null;
    const info = noticeInfoFor(pack);
    const inspection = info.inspection;
    // New York: the rights notice is not owed only when the tenant ended the tenancy with less than two weeks' notice
    // (7-108(1-a)(d)); after the landlord's notice, or when who gave it isn't recorded, it is owed.
    if (inspection && !inspectionExcused(t) && !t.notices.inspection) {
      const label = `Send the ${inspection.short}`;
      const detail = flow.inspectionStep?.(t.noticeGivenOn, windowOpens) ?? "";
      const step = windowOpens ? dated(label, detail, inspection.cite, windowOpens, false, "Window opens")
        : undated(label, detail, inspection.cite, "urgent");
      return withOpen(flow.inspectionAction ? { ...step, action: { label: "Send notice", path: "notices/inspection", icon: "mail" } } : step);
    }
    if (pack.notices.refundNotice && t.refundNotice.needed !== false && !t.notices.electronic_refund) {
      const label = t.refundNotice.needed ? "Send the electronic-refund notice" : "Check whether the electronic-refund notice is owed";
      // The full reason is on the tenancy page; the card gets one line.
      const detail = t.refundNotice.needed
        ? "The deposit came in electronically and no written refund-method agreement is on file. In writing, within a reasonable time after the notice: the tenants' right to an electronic refund."
        : "No written refund-method agreement is on file. The notice is owed if the deposit or any rent was received electronically.";
      const cite = info.electronic_refund?.cite ?? null;
      return withOpen(windowOpens ? dated(label, detail, cite, windowOpens, false, "Window opens")
        : undated(label, detail, cite, "soon"));
    }
    if (!ends) return withOpen(undated("Set the planned move-out date", flow.noDateDetail, null, "soon"));
    // The state's own step while the move-out is ahead (Texas: the forwarding address in writing). From the move-out
    // day on, recording the move-out comes first: it starts the state's clock.
    const before = today < ends ? pack.steps.beforeMoveOut?.(t, today, h) : null;
    if (before) return withOpen(before);
    if (windowOpens && today < windowOpens) {
      return withOpen(dated("Inspection window opens", flow.windowStep(windowOpens), flow.windowCite, windowOpens, false));
    }
    return withOpen(dated("Move-out", flow.moveOutStep(ends), flow.moveOutCite, ends, false));
  }

  // Move-in steps still open (California D16, D3, D13), with the state's own (a Washington checklist before the
  // deposit, the account the deposit is held in, a New York move-in inspection offer) where the pack puts them.
  // Where the state needs no agreement, the step still comes first while there is no invoice: it names the PayPal
  // account the invoice goes to.
  if (!t.agreement && (pack.refund.agreementRequired || !t.deposit)) {
    return undated(pack.refund.agreementStep.label, pack.refund.agreementStep.detail, pack.refund.agreementStep.cite, started ? "urgent" : "soon");
  }
  const extra = pack.steps.moveIn(t, today, h);
  if (extra?.beforeInvoice) return extra.step;
  if (!t.deposit) return undated("Send the PayPal deposit invoice", flow.invoice.detail, flow.invoice.cite, started ? "urgent" : "soon");
  if (!paid) {
    return undated("Deposit invoice unpaid", `The PayPal invoice for ${usd(t.deposit.amount)} is ${t.deposit.status.toLowerCase().replace(/_/g, " ")}. Nothing to do until the tenants pay.`,
      flow.unpaidCite, "soon");
  }
  if (extra) return extra.step;
  if (!t.moveInPhotos) {
    if (photosFrom && t.startDate && t.startDate >= photosFrom) {
      const detail = flow.photosIn.detail;
      return started ? undated("Take move-in photos", detail, flow.photosIn.cite, "overdue") : dated("Take move-in photos", detail, flow.photosIn.cite, t.startDate);
    }
    return undated("Add move-in condition evidence", pack.moveIn.oldPhotosStep.detail, pack.moveIn.oldPhotosStep.cite, "later");
  }

  // Active with nothing owed: wait for the lease end or a notice.
  if (t.endDate) {
    const checkIn = addDays(t.endDate, -CHECK_IN_DAYS_BEFORE_END);
    if (daysBetween(today, t.endDate) < 0) {
      return undated("Lease ended; record what happened next", `The ${longDate(t.endDate)} lease end has passed. Record the tenants' notice if they are leaving, or the new lease end if they renewed; otherwise the tenancy runs month to month.`, null, "soon");
    }
    if (today >= checkIn) return dated("Lease ends", leaseEndsDetail(pack), flow.leaseEndsCite, t.endDate, false);
    return dated("Check in 60 days before the lease ends", `The lease ends ${longDate(t.endDate)}. Nothing is due before the check-in.`, null, checkIn, false);
  }
  return undated("Nothing due", "Month to month. When either side gives notice, record it on the tenancy and the notices and dates follow.", null, "later");
}

const noticeKindsOf = (pack: StatePack) => pack.records.filter((r) => r.phase === "notice");

/** The lease-end card's line: California's two notices, or the state's own. */
const leaseEndsDetail = (pack: StatePack) => (pack.notices.refundNotice
  ? "Ask whether the tenants are staying. Once either side gives notice, the inspection and refund notices follow."
  : noticeKindsOf(pack).length
    ? `Ask whether the tenants are staying. Once either side gives notice, the ${noticeKindsOf(pack).map((r) => r.short).join(" and ")} follows.`
    : "Ask whether the tenants are staying. Once either side gives notice, the move-out dates follow.");

/** Most urgent first: overdue, then by days left, then the open steps with no date, then the finished ones. */
export function byUrgency(a: { next: NextStep }, b: { next: NextStep }): number {
  const l = LEVEL_ORDER[a.next.level] - LEVEL_ORDER[b.next.level];
  if (l) return l;
  const da = a.next.daysLeft ?? Number.POSITIVE_INFINITY, dbb = b.next.daysLeft ?? Number.POSITIVE_INFINITY;
  return da - dbb;
}


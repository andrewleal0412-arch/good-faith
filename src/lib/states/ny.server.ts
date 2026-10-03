// New York: the half of the pack only the server reads (the statement checklist, the close-out agent's rules and
// prompt, the next-step hooks, the calendar, the tenant page). The rest is in ny.ts, which client components load.

import { wasPaid } from "../invoice-status";
import { addDays, daysBetween, longDate, usd } from "./common";
import {
  checklistTool, claim, closeOutSystem, delivered, disclaimer, estimates, evidence, factsTool, grade, inspectionGuide, lines,
  parties, refund, security, shortOf, type ItemSpec,
} from "./common.server";
import { nyLastDay } from "./ny";
import type { ServerPart, StandingInput } from "./types";

const G = (s: string) => `N.Y. GOL ${s}`;

/** Day 14 and, when General Construction Law 25-a moves it, the next business day after it. */
const day14 = (statementDue: string) => ({ due: statementDue, last: nyLastDay(statementDue) });
const runTo = (d: { due: string; last: string }) => (d.last !== d.due ? `, run to ${longDate(d.last)} by General Construction Law 25-a` : "");

/** N21: deductions the landlord keeps after day 14 under a recorded acknowledgment. */
function keptLate(c: StandingInput) {
  const ack = c.notices.late_acknowledgment;
  if (!ack || !c.claimed || !c.statementDue) return null;
  const d = day14(c.statementDue);
  if (c.today <= d.last) return null;
  return { d, ack };
}

const ITEMS: ItemSpec[] = [
  { n: 1, title: "Tenant names, unit address, vacate date, statement date and the day-14 date", short: "Parties, dates and day 14", cite: G("7-108(1-a)(e)"), grade: (s) => parties(s) },
  {
    n: 2, title: "Deposit received: amount, date, how paid, where it was held and the bank notice", short: "Deposit and where it was held", cite: G("7-103(1)-(2)"),
    grade: (s, ctx) => {
      const [st, why] = security(s);
      if (st !== "done") return [st, why];
      const acct = ctx.notices.deposit_account;
      return acct ? ["done", `${why} Held at ${acct.detail ?? "the account on record"}; the tenants were told on ${longDate(acct.date)}.`] : ["missing", `${why} Where it was held, and the bank notice, are not on record.`];
    },
  },
  { n: 3, title: "Interest: rate, period, interest earned, the 1 percent fee, interest returned now", short: "Interest", cite: G("7-103(2)-(2-b)"), grade: (s) => (s.interest.known ? ["missing", s.interest.checkReason] : ["not_applicable", s.interest.checkReason]) },
  { n: 4, title: "One line per deduction in the four categories: rent, damage beyond wear and tear, utilities under the lease, moving and storage", short: "One line per deduction", cite: G("7-108(1-a)(b)"), grade: (s) => lines(s) },
  {
    n: 5, title: "Nothing that appears on the move-in condition agreement", short: "Nothing from the move-in agreement", cite: G("7-108(1-a)(c)"),
    grade: (s, ctx) => (ctx.notices.move_in_inspection ? ["done", `The move-in inspection was offered on ${longDate(ctx.notices.move_in_inspection.date)}; no line may repeat a defect noted on a signed condition agreement.`] : ["not_applicable", "No move-in inspection offer is on record."]),
  },
  {
    n: 6, title: "The pre-move-out inspection: the items listed and the items cured", short: "Pre-move-out inspection", cite: G("7-108(1-a)(d)"),
    grade: (s, ctx) => {
      if (ctx.notices.inspection) return ["done", `The inspection-rights notice was given on ${longDate(ctx.notices.inspection.date)}.`];
      const e = ctx.ending;
      if (!e?.givenOn) return ["not_applicable", "No notice to end the tenancy is on record, so no inspection-rights notice was due."];
      if (e.givenBy === "tenant" && e.ends && daysBetween(e.givenOn, e.ends) < 14) {
        return ["not_applicable", `Not owed: the tenants ended the tenancy with less than two weeks' notice (given ${longDate(e.givenOn)}, for ${longDate(e.ends)}).`];
      }
      return ["missing", "No inspection-rights notice is on record, though one was owed within a reasonable time after the notice to end the tenancy. Record it if it went out."];
    },
  },
  { n: 7, title: "Evidence for each deduction, marked Unsupported where missing", short: "Evidence for each line", cite: G("7-108(1-a)(f)"), grade: (s) => evidence(false)(s) },
  { n: 8, title: "Estimates marked as estimates", short: "Estimates marked", cite: G("7-108(1-a)(b)"), grade: (s) => estimates(s) },
  { n: 9, title: "Refund: amount, method, destination, date sent, PayPal id", short: "Refund", cite: G("7-108(1-a)(e)"), grade: (s) => refund(s) },
  { n: 10, title: "If deductions exceed the deposit, the balance stated as a claim", short: "Balance stated as a claim", cite: G("7-108(1-a)(b)"), grade: (s) => claim(s) },
  { n: 11, title: "Delivery record: method, address or email, date", short: "Delivery record", cite: G("7-108(1-a)(e)"), grade: (s) => delivered(s) },
  { n: 12, title: "Rent stabilized units: the 7-107 citations and the interest election", short: "Rent stabilized units", cite: G("7-107"), grade: () => ["not_applicable", "The app applies 7-108; for a rent stabilized unit, 7-107 says the same for leases from November 15, 2025."] },
  { n: 13, title: "The disclaimer line", short: "Not legal advice", cite: "N.Y. Jud. Law 495", grade: () => disclaimer() },
];

export const NY_SERVER: ServerPart = {
  close: {
    rules: {
      deadline: "N.Y. GOL 7-108(1-a)(e): within fourteen days after the tenant has vacated, an itemized statement of the basis for any amount retained, and the rest of the deposit.",
      forfeiture: "N.Y. GOL 7-108(1-a)(e): a landlord who misses the 14 days forfeits any right to retain any portion of the deposit.",
      categories: "N.Y. GOL 7-108(1-a)(b): deductions only for non-payment of rent, damage beyond normal wear and tear, utilities payable to the landlord under the lease, and moving and storage of the tenant's belongings.",
      burden: "N.Y. GOL 7-108(1-a)(f): the landlord bears the burden of proof as to the reasonableness of the amount retained.",
      trust: "N.Y. GOL 7-103(1): the deposit is held in trust and not mingled with the landlord's own money.",
      interest: "N.Y. GOL 7-103(2)-(2-b): interest earned in an interest-bearing account, less 1 percent a year for administration, belongs to the tenant.",
      electronicRefund: "N.Y. GOL 7-108(1-a)(e): the statute names no refund method; the rest of the deposit is returned to the tenant, and a Payout to another account needs the tenant's written designation (product policy).",
      roommates: "Practice, not New York law: one refund to the original payment unless every adult tenant signed an allocation.",
      documents: "N.Y. GOL 7-108(1-a)(f): no receipts are required, but the landlord carries the burden of proof, so each deduction should carry photos and an invoice or labor record.",
      damages: "N.Y. GOL 7-108(1-a)(g): actual damages for any violation, and punitive damages up to twice the deposit for a willful one.",
      usefulLife: "Useful-life proration and the paint schedule are common practice, not New York law.",
      refundWindow: "PayPal policy, not law: a payment can be refunded against itself for 180 days; after that the money goes out as a Payout.",
    },
    // N20, N21: blocked only after the day General Construction Law 25-a allows, and then only until the landlord either
    // removes the deductions or records why they stay (the spec's W with a recorded acknowledgment).
    extraBlockers: (f, ctx) => {
      if (!f.deductions.length || f.alreadyReturned || !f.tenancy.statementDue) return [];
      const d = day14(f.tenancy.statementDue);
      if (ctx.today <= d.last || ctx.notices.late_acknowledgment) return [];
      return [`Day 14 after the move-out (${longDate(d.due)}${runTo(d)}) has passed, so the landlord forfeits any right to keep any part of the deposit (N.Y. GOL 7-108(1-a)(e)). Remove the deductions to refund it in full, or record why they stay on the late-deduction acknowledgment; a claim beyond the deposit is a separate matter.`];
    },
    extraWarnings: (f, ctx) => {
      const late = keptLate({ today: ctx.today, notices: ctx.notices, claimed: f.totals.deductions, statementDue: f.tenancy.statementDue });
      return [
        ...(late ? [`Day 14 (${longDate(late.d.due)}${runTo(late.d)}) has passed, and on ${longDate(late.ack.date)} the landlord recorded why the deductions stay: "${late.ack.detail ?? ""}". New York forfeits any right to keep any part of the deposit after day 14 (N.Y. GOL 7-108(1-a)(e)); the tenants may recover it, and a willful violation can cost up to twice the deposit (7-108(1-a)(g)).`] : []),
        ...(!ctx.notices.deposit_account && f.deposit
          ? ["No record of where the deposit is held: it is held in trust and not mingled with the landlord's own money (N.Y. GOL 7-103(1)); in a building of six or more units, in a New York interest-bearing account whose interest, less 1 percent a year, is the tenant's (7-103(2-a))."]
          : []),
      ];
    },
    standing: (c) => {
      const late = keptLate(c);
      return late ? {
        label: "Kept after day 14",
        note: `The statement and the rest of the deposit were due by ${longDate(late.d.last)}. After that the landlord forfeits any right to retain any portion of the deposit (N.Y. GOL 7-108(1-a)(e)); on ${longDate(late.ack.date)} the landlord recorded that these deductions stay${late.ack.detail ? `: ${late.ack.detail}` : ""}. The tenants may recover them, and a willful violation can cost up to twice the deposit (7-108(1-a)(g)).`,
      } : null;
    },
  },

  steps: {
    flow: {
      doneCite: G("7-108(1-a)(e)"),
      sendRefundCite: G("7-108(1-a)(e)"),
      photosOut: { detail: "Before any repair or cleaning that will be deducted, and again after: the landlord bears the burden of proof.", cite: G("7-108(1-a)(f)") },
      compareCite: G("7-108(1-a)(e)"),
      deliveryCite: G("7-108(1-a)(e)"),
      statementDetail: (m) => `Due 14 days after the ${longDate(m)} move-out; after that every deduction is forfeited.`,
      statementCite: G("7-108(1-a)(e)"),
      tenantNoticeCite: G("7-108(1-a)(d)"),
      noDateDetail: "It sets the inspection window and, once the tenants vacate, the 14-day clock.",
      windowStep: (w) => `If the tenants request an inspection, it happens from ${longDate(w)} and no later than one week before the move-out, with 48 hours' written notice of the date and time.`,
      windowCite: G("7-108(1-a)(d)"),
      inspectionStep: (n, w) => `In writing, within a reasonable time after the ${longDate(n)} notice: the tenants' right to request an inspection before they vacate, and to be present.${w ? ` The inspection may happen from ${longDate(w)}.` : ""}`,
      inspectionAction: true,
      moveOutStep: (ends) => `Planned for ${longDate(ends)}. Record the actual move-out date when the tenants vacate; the 14-day clock starts then.`,
      moveOutCite: G("7-108(1-a)(e)"),
      invoice: { detail: "For the lawful amount: the agent caps it at one month's rent.", cite: G("7-108(1-a)(a)") },
      unpaidCite: G("7-108(1-a)(a)"),
      photosIn: { detail: "", cite: "" },
      leaseEndsCite: G("7-108(1-a)(d)"),
    },
    moveIn: (t, today, h) => {
      if (!t.notices.move_in_inspection) {
        const step = t.startDate
          ? h.dated("Offer the move-in inspection", "Before the tenants move in: the offer of an inspection, and if they ask, a signed agreement on the unit's condition before occupancy.", G("7-108(1-a)(c)"), t.startDate)
          : h.undated("Offer the move-in inspection", "Before the tenants move in: the offer of an inspection, and if they ask, a signed agreement on the unit's condition before occupancy.", G("7-108(1-a)(c)"), "soon");
        return { step: { ...step, action: { label: "Offer inspection", path: "notices/move-in-inspection", icon: "mail" } }, beforeInvoice: false };
      }
      if (t.deposit && wasPaid(t.deposit.status) && !t.notices.deposit_account) {
        const step = h.undated("Record where the deposit is held", "In trust, not in the PayPal balance next to rent; for six or more units an interest-bearing New York bank account. Then give the tenants the bank's name and address in writing.", G("7-103(1)-(2-a)"), today >= (t.startDate ?? today) ? "urgent" : "soon");
        return { step: { ...step, action: { label: "Record account", path: "notices/deposit-account", icon: "file-check" } }, beforeInvoice: false };
      }
      return null;
    },
    // N21: after the day 25-a allows, the deductions wait for the landlord's choice: remove them, or record why they stay.
    afterInspection: (t, today, h) => {
      if (!t.moveOutDate || !t.deductions.length || t.returned || t.notices.late_acknowledgment) return null;
      const d = day14(addDays(t.moveOutDate, 14));
      if (today <= d.last) return null;
      return {
        ...h.undated("Day 14 has passed: refund in full", "New York forfeits any right to keep any part of the deposit after day 14. Remove the deductions and refund all of it, or record why they stay.", G("7-108(1-a)(e)"), "overdue"),
        action: { label: "Review", path: "notices/late-acknowledgment", icon: "pen" },
      };
    },
    openMoveIn: (t) => [
      ...(!t.notices.move_in_inspection ? ["no move-in inspection offer on record"] : []),
      ...(t.deposit && !t.notices.deposit_account ? ["where the deposit is held not recorded"] : []),
    ],
  },

  calendar: {
    checkIn: (where, ends) => `The lease at ${where} ends ${longDate(ends)}, 60 days from today. Ask the tenants whether they are staying. Once either side gives notice, the notice of the right to an inspection before moving out (N.Y. GOL 7-108(1-a)(d)) follows.`,
    window: (ends) => `From today the tenants may have their inspection, if they requested one: no earlier than two weeks and no later than one week before the tenancy ends on ${longDate(ends)}, with at least 48 hours' written notice of the date and time (N.Y. GOL 7-108(1-a)(d)).`,
    moveOut: (lead) => `${lead} Photograph the unit before any repair or cleaning: the landlord bears the burden of proof (N.Y. GOL 7-108(1-a)(f)). The 14-day clock for the itemized statement and the refund starts when the tenants vacate (7-108(1-a)(e)).`,
    due: {
      label: "Statement and refund due, 14 days after move-out",
      summary: (where) => `Deposit statement and refund due: ${where}`,
      description: (ends) => `Last day to give the itemized statement and return the rest of the security deposit: 14 days after the ${longDate(ends)} move-out. After it the landlord forfeits any right to keep any part (N.Y. GOL 7-108(1-a)(e)).`,
    },
  },

  statement: {
    checklist: grade(ITEMS),
    short: shortOf(ITEMS),
    checklistTip: "The 13 items a New York itemized statement needs under the rules spec: General Obligations Law 7-103 and 7-108. Each item's tip says why it is done, missing or not needed here.",
    interest: (city, o) => {
      if ((o.buildingUnits ?? 0) >= 6) {
        const note = "Interest is owed: in a building of six or more units the deposit sits in an interest-bearing New York bank account. The interest earned, less the 1 percent a year the landlord may keep, is returned with the deposit (N.Y. GOL 7-103(2), (2-b)). The rate and the period come from the bank and are not computed here.";
        return { city: null, known: true, note, checkReason: note }; // owed by the building's size, not by the city
      }
      const note = `No interest is included: a building of ${o.buildingUnits ?? "fewer than six"} units needs no interest-bearing account, unless the deposit was in fact placed in one (N.Y. GOL 7-103(2)).`;
      return { city, known: false, note, checkReason: note };
    },
    interestTitle: "Deposit interest",
    wearAtZero: false,
    basisNote: (t, amount, l) => {
      if (!l || l.cap == null || l.charged <= l.cap) return null;
      return `The lease asked for ${usd(l.charged)}. No deposit or advance may exceed one month's rent, so ${usd(amount)} was collected (N.Y. GOL 7-108(1-a)(a)).`;
    },
    documentsNote: (_r, total, any) => (!any ? "No repair or cleaning was deducted, so no invoices or labor records apply."
      : `Repair and cleaning deductions total ${usd(total)}. New York requires an itemized statement of the basis for the amount kept, not receipts (GOL 7-108(1-a)(e)); the landlord bears the burden of proof (7-108(1-a)(f)), so the photos, invoices and labor records go with this statement as evidence.`),
    documentsLine: (_r, total) => `Evidence, not required by statute: repair and cleaning total ${usd(total)}`,
    documentsCite: () => G("7-108(1-a)(e)-(f)"),
    refundNote: (r) => [
      r.tenants.length > 1 ? `One refund to the original payment for all adult tenants named on the lease (${r.tenants.join(" and ")}); the statute is silent on several tenants, so this is practice.` : null,
      r.paid ? "New York names no refund method: the rest of the deposit goes back to the tenant, by PayPal against the original payment (N.Y. GOL 7-108(1-a)(e))." : null,
    ].filter(Boolean).join(" "),
    refundDueMethod: (r) => (r.paypalEmail ? `PayPal refund of the deposit payment, or a Payout to ${r.paypalEmail} if that payment can't take it, to be sent` : "To be refunded against the deposit payment"),
    sections: {
      security: { title: "Deposit received", cite: G("7-103(1)-(2), 7-108(1-a)(a)"), text: "The deposit received, when and how, and where it was held in trust." },
      deductions: { title: "Deductions", cite: G("7-108(1-a)(b), (e)"), text: "One line per deduction in the four categories the statute allows, each with the basis for the amount kept." },
      refund: G("7-108(1-a)(e)"),
      delivery: { title: "Delivery", cite: G("7-108(1-a)(e)"), text: "In writing, with a dated record: first-class mail to the forwarding address and email when the tenant gave one; with neither, the vacated unit." },
    },
    documentRow: { title: "The itemized statement", cite: G("7-108(1-a)(e)"), text: "Due with the rest of the deposit within 14 days after move-out, or every deduction is forfeited." },
    headerTip: { title: "The itemized statement", cite: "New York General Obligations Law 7-108(1-a)(e)", text: "Within 14 days after the tenants vacate: an itemized statement of the basis for any amount kept, and the rest of the deposit." },
    estimateNote: "Estimate: the work is not finished or the invoice is not in hand yet; the invoice follows when received (New York sets no estimate rule).",
    estimateLine: "Estimate: the invoice follows when received",
    dueTipText: "The statement and the rest of the deposit are due within 14 days after the tenants vacate.",
    guidanceSource: "as common practice, not New York law",
    estimateCite: G("7-108(1-a)(b)"),
    pdf: { deadlineLine: "14 days after move-out, N.Y. GOL 7-108(1-a)(e)", dueSuffix: "14 days after move-out" },
  },

  tenant: {
    detailsTip: { title: "Your deposit", cite: G("7-103(1), 7-108(1-a)(a)"), text: "Your deposit is held in trust for you, at most one month's rent. It comes back, less any lawful deductions, with an itemized statement within 14 days after you move out." },
    dueTip: { title: "14 days after you move out", cite: G("7-108(1-a)(e)"), text: "Within 14 days after you vacate, the landlord gives you an itemized statement of any amount kept and returns the rest of the deposit." },
    paidLine: "It comes back, less any lawful deductions, within 14 days after you move out.",
    documentsTip: () => ({ title: "The itemized statement", cite: G("7-108(1-a)(e)-(f)"), text: "New York requires an itemized statement of the basis for any amount kept. The landlord adds photos and invoices as evidence, since the landlord bears the burden of proof; the PDF lists exactly what it holds." }),
    mailTip: (movedOut) => ({ title: "Where the statement goes", cite: G("7-108(1-a)(e)"), text: `Give your landlord a forwarding address and an email: the statement goes to them in writing. If you give none, it goes to the unit you ${movedOut ? "left" : "are leaving"}.` }),
    deliveryCite: G("7-108(1-a)(e)"),
    prorationNote: "Proration by useful life and paint schedules is common practice, not New York law.",
    agreementTip: ({ agreed }) => ({ title: agreed ? "Your PayPal account" : "How the refund comes back", cite: G("7-108(1-a)(e)"), text: agreed ? null : "New York names no refund method. The rest of the deposit goes back to the PayPal account it came from." }),
    rights: (v) => {
      const st = v.statement;
      return [
        { title: "Statement and refund within 14 days", cite: G("7-108(1-a)(e)"), text: `Within 14 days after you vacate, the landlord gives you an itemized statement of any amount kept and returns the rest. If the landlord misses it, the landlord forfeits any right to keep any part of the deposit.${v.moveOutDate && v.statementDue ? ` You moved out on ${longDate(v.moveOutDate)}, so the deadline ${st ? "was" : "is"} ${longDate(v.statementDue)}.` : ""}` },
        { title: "What can be deducted", cite: G("7-108(1-a)(b)"), text: "Only unpaid rent, damage you caused beyond normal wear and tear, utilities payable to the landlord under the lease, and moving and storing belongings you left. Never wear and tear, a prior tenant's damage, late fees or penalties." },
        { title: "At most one month's rent", cite: G("7-108(1-a)(a)"), text: "The deposit and any advance together may not exceed one month's rent, and no other move-in fee may be charged." },
        { title: "An inspection before you move out", cite: G("7-108(1-a)(d)"), text: "After either side gives notice, you may ask for an inspection before you vacate and be there for it, no earlier than two weeks and no later than one week before the end, with 48 hours' written notice. You then get a list of proposed deductions and may fix them first." },
        { title: "A move-in inspection", cite: G("7-108(1-a)(c)"), text: "Before you moved in, you could ask to inspect the unit and sign an agreement on its condition. Nothing noted on it can be deducted." },
        { title: "Your deposit is held in trust", cite: G("7-103"), text: "The deposit stays your money, held in trust and not mingled with the landlord's. In a building of six or more units it earns interest for you, less 1 percent a year." },
        { title: "The landlord proves it", cite: G("7-108(1-a)(f)-(g)"), text: "In any dispute the landlord bears the burden of proving the amount kept was reasonable. A willful violation can cost up to twice the deposit." },
        ...(v.tenants.length > 1 ? [{ title: "More than one adult on the lease", cite: G("7-108(1-a)(e)"), text: "The statute doesn't say how a refund is split; by default it goes back to the original payment, and every adult gets the statement." }] : []),
      ];
    },
  },

  ai: {
    reasonExample: "Small nail holes are ordinary wear and tear under N.Y. GOL 7-108(1-a)(b)",
    inspectorRole: "You inspect rental units at move-out for a New York landlord's security deposit tool.",
    inspectionGuide: inspectionGuide("New York General Obligations Law 7-108(1-a)(b), as applied here (a deposit covers damage caused by the tenant beyond normal wear and tear, never ordinary wear and tear of occupancy or damage caused by a prior tenant; New York publishes no wear-and-tear guide, so the examples below are common practice):"),
    closeOutSystem: closeOutSystem({
      name: "New York", items: 13,
      note: "The itemized statement and the rest of the deposit are due within 14 days after the tenant vacates; after that the landlord forfeits any right to keep any part. Deductions are limited to rent, damage beyond normal wear and tear, utilities under the lease, and moving and storage.",
    }),
    factsToolDescription: factsTool("14-day"),
    checklistToolDescription: checklistTool(13, "New York General Obligations Law 7-103 and 7-108"),
  },
};

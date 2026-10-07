// New York: the half of the pack only the server reads (the statement checklist, the close-out agent's rules and
// prompt, the next-step hooks, the calendar, the tenant page). The rest is in ny.ts, which client components load.

import { dateIn } from "../dates";
import { wasPaid } from "../invoice-status";
import { addDays, daysBetween, longDate, usd } from "./common";
import {
  checklistTool, claim, closeOutSystem, delivered, disclaimer, estimates, evidence, factsTool, grade, inspectionGuide, lines,
  parties, refund, security, shortOf, type ItemSpec,
} from "./common.server";
import { NY, nyLate } from "./ny";
import type { ServerPart } from "./types";

const G = (s: string) => `N.Y. GOL ${s}`;

const runTo = (d: { due: string; last: string }) => (d.last !== d.due ? `, run to ${longDate(d.last)} by General Construction Law 25-a` : "");
/** What missed day 14, in words. */
const missedWords = (d: { missed: "statement" | "refund" | null }) =>
  d.missed === "refund" ? "the rest of the deposit went back" : "the itemized statement went out";
const FORFEIT = G("7-108(1-a)(e)");

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
    // N19 to N21, a hard block (Andrew, 2026-10-04): once day 14 has passed, as General Construction Law 25-a runs it,
    // without both the statement and the rest of the deposit, nothing may be kept, and nothing the landlord records
    // changes that. With no dispute open, the close-out refunds nothing until every deduction is removed. While a dispute
    // the tenants sent is open its deductions can't be removed, so the close-out returns the whole deposit instead, with
    // the deductions still on file (closeout.ts, wholeDeposit), and the dispute's settlement has no more money to send.
    // Either way the close-out never sends less than the whole deposit after day 14. A statement that went out on time
    // and left nothing to refund is not late.
    extraBlockers: (f, ctx) => {
      if (!f.deductions.length || f.alreadyReturned || ctx.disputeLive) return [];
      // No refund from the close-out: the day refunds made in PayPal and recorded here returned what is owed, if they did.
      const d = nyLate({ due: f.tenancy.statementDue, today: ctx.today, deliveredOn: ctx.deliveredOn ?? null, returnedOn: ctx.returnedOn ?? null, refundOwed: f.totals.refund > 0 });
      if (!d?.late) return [];
      return [`Day 14 after the move-out (${longDate(d.due)}${runTo(d)}) passed before ${missedWords(d)}, so the landlord forfeits any right to keep any part of the deposit (${FORFEIT}). Nothing can be kept from it now: remove the deductions, and the whole deposit goes back.`];
    },
    extraWarnings: (f, ctx) => {
      const d = f.deductions.length && !f.alreadyReturned && ctx.disputeLive
        ? nyLate({ due: f.tenancy.statementDue, today: ctx.today, deliveredOn: ctx.deliveredOn ?? null, returnedOn: ctx.returnedOn ?? null, refundOwed: f.totals.refund > 0 })
        : null;
      return [
        ...(d?.late ? [`Day 14 after the move-out (${longDate(d.due)}${runTo(d)}) passed before ${missedWords(d)}, so the landlord forfeits any right to keep any part of the deposit (${FORFEIT}). The tenants disputed the statement, so its deductions stay on it while the dispute is open, but none of them may be kept: this refund returns the whole deposit, and the dispute's settlement then has no more money to send.`] : []),
        ...(!ctx.notices.deposit_account && f.deposit
          ? ["No record of where the deposit is held: it is held in trust and not mingled with the landlord's own money (N.Y. GOL 7-103(1)); in a building of six or more units, in a New York interest-bearing account whose interest, less 1 percent a year, is the tenant's (7-103(2-a))."]
          : []),
      ];
    },
    standing: (c) => {
      if (!c.claimed) return null;
      const d = nyLate({ due: c.statementDue, today: c.today, deliveredOn: c.deliveredOn ?? null, returnedOn: c.returnedOn ?? null, refundOwed: !!c.refundOwed });
      if (!d?.late) return null;
      const on = d.missed === "refund" ? c.returnedOn : c.deliveredOn;
      const what = d.missed === "refund"
        ? (on ? `the rest of the deposit went back on ${longDate(on)}` : "the rest of the deposit has not gone back")
        : (on ? `the statement went out on ${longDate(on)}` : "the statement has not gone out");
      return {
        label: "Forfeited after day 14",
        note: `The statement and the rest of the deposit were due by ${longDate(d.last)}${runTo(d)}, and ${what}. A landlord who misses it forfeits any right to retain any portion of the deposit (${FORFEIT}), so none of these deductions may be kept: the whole deposit is owed back to the tenants.`,
        forfeits: true,
      };
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
    afterInspection: () => null,
    // N21, the hard block: from the comparison on, once day 14 passed before the statement and the rest of the deposit
    // went out, the step is the full refund, before the statement is delivered or after. While a dispute the tenants
    // sent is open its deductions can't be removed, so the step goes straight to the refund of the whole deposit.
    forfeit: (t, today, h) => {
      if (!t.moveOutDate || !t.deductions.length) return null;
      const deposit = t.deposit && wasPaid(t.deposit.status) ? t.deposit.amount : 0;
      if (!deposit) return null; // nothing came in through PayPal, so there is nothing to refund
      // The refund of the deposit less the deductions went on time, and the statement went out after day 14: the
      // deductions are forfeited all the same (the summary's `forfeited`, read with the refund's own day), so the rest
      // of the deposit is owed too. The close-out sends one refund, so the step says what is owed and where it stands;
      // a dispute's settlement that sent it closes the unit (forfeitShort, next-step.ts). Before the statement's
      // delivery is recorded the step stays "Record the statement delivery": a statement that went out by day 14 and is
      // recorded with its own date forfeits nothing.
      if (t.returned) {
        if (!t.forfeited || !t.statementDeliveredAt || t.deposit?.reversed) return null;
        const back = t.returned.amount + (t.viaDispute ?? 0) + (t.outside ?? 0) + (t.settledBack ?? 0);
        const short = Math.round((deposit - back) * 100) / 100;
        if (short <= 0.005) return null;
        return {
          ...h.undated(`Day 14 has passed: ${usd(short)} more owed`, `New York forfeits any right to keep any part of the deposit once day 14 passes before both the itemized statement and the rest of the deposit went out. ${usd(back)} of the ${usd(deposit)} deposit went back, so ${usd(short)} more is owed. The close-out sends one refund per tenancy, so this one goes from the PayPal account, outside Good Faith.`, FORFEIT, "overdue"),
          action: { label: "View statement", path: "statement", icon: "doc" },
        };
      }
      const kept = t.deductions.reduce((s, x) => s + x.amount, 0);
      const delivered = t.statementDeliveredAt ? t.statementDeliveredOn ?? dateIn(t.statementDeliveredAt, NY.timeZone.id) : null;
      // No refund from the close-out yet; refunds made in PayPal and recorded here may have returned what the
      // deductions leave owed, and the day they did is the day the rest of the deposit went (the summary's).
      const d = nyLate({ due: addDays(t.moveOutDate, 14), today, deliveredOn: delivered, returnedOn: t.outsideReturnedOn ?? null, refundOwed: deposit - kept > 0.005 });
      if (!d?.late) return null;
      const lead = `New York forfeits any right to keep any part of the deposit once day 14 passes before ${missedWords(d)}.`;
      const before = Math.round(((t.outside ?? 0) + (t.viaDispute ?? 0)) * 100) / 100;
      const rest = Math.max(0, Math.round((deposit - before) * 100) / 100);
      // The whole deposit is back already (a refund made in PayPal, the dispute's money): nothing more to send.
      if (rest <= 0.005) return null;
      return t.dispute ? {
        ...h.undated("Day 14 has passed: refund in full", `${lead} The tenants' dispute holds the deductions, so the refund returns the whole deposit, ${usd(deposit)}${before > 0 ? `, ${usd(rest)} of it still to send` : ""}, with them still on file.`, FORFEIT, "overdue"),
        action: { label: "Send refund", path: "refund", icon: "send" },
      } : {
        ...h.undated("Day 14 has passed: refund in full", `${lead} Nothing can be kept: remove the deductions and refund ${before > 0 ? `the rest, ${usd(rest)}` : "all of it"}.`, FORFEIT, "overdue"),
        action: { label: "Remove deductions", path: "?tab=move-out", icon: "pen" },
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
      name: "New York", items: 13, zone: NY.timeZone.name,
      note: "The itemized statement and the rest of the deposit are due within 14 days after the tenant vacates; after that the landlord forfeits any right to keep any part. Deductions are limited to rent, damage beyond normal wear and tear, utilities under the lease, and moving and storage.",
    }),
    factsToolDescription: factsTool("14-day"),
    checklistToolDescription: checklistTool(13, "New York General Obligations Law 7-103 and 7-108"),
  },

  // NY spec N19, N21, N22 and section F: the statement and the rest of the deposit both by day 14 (as General
  // Construction Law 25-a runs it), or the landlord forfeits the right to keep any of it. The close-out's rule (nyLate):
  // a refund still owed and not sent once the last day is behind counts as late too.
  dispute: {
    late: {
      effect: "forfeit",
      text: "Day 14 passed before both the statement and the rest of the deposit went out, so the landlord forfeits any right to keep any part of the deposit.",
      cite: FORFEIT,
      noDefense: true, // 7-108(1-a)(e) names none, so the landlord's side concedes in code (negotiator.ts, forfeitTurn)
    },
    isLate: (c) => {
      const d = nyLate({ due: c.moveOutDate ? addDays(c.moveOutDate, 14) : null, today: c.today, deliveredOn: c.deliveredOn, returnedOn: c.refundedOn, refundOwed: c.refundOwed });
      return { late: d ? d.late : null };
    },
    evidence: { text: "The landlord bears the burden of proof as to the reasonableness of the amount kept.", cite: G("7-108(1-a)(f)") },
    forum: {
      name: "Small claims court", limit: 10000,
      text: "A deposit dispute can go to small claims court: up to $10,000 in New York City Civil Court, $5,000 in city courts outside the city and $3,000 in town and village courts. A complaint to the Attorney General is another route.",
      cite: "N.Y.C. Civ. Ct. Act 1801",
    },
    lineBar: null,
    cleaningRule: null,
    documentsCure: null,
    sendNote: null,
  },
};

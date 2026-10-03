// Washington: the half of the pack only the server reads (the statement checklist, the close-out agent's rules and
// prompt, the next-step hooks, the calendar, the tenant page). The rest is in wa.ts, which client components load.

import { wasPaid } from "../invoice-status";
import { addDays, longDate, usd } from "./common";
import {
  checklistTool, claim, closeOutSystem, delivered, documents, factsTool, grade, inspectionGuide, lines, parties, refund,
  security, shortOf, wear, type ItemSpec,
} from "./common.server";
import type { ServerPart } from "./types";

const R = (s: string) => `RCW ${s}`;

const ITEMS: ItemSpec[] = [
  { n: 1, title: "Tenant names, unit address, termination and vacate dates, statement date and the 30-day deadline", short: "Parties, dates and deadline", cite: R("59.18.280(1)(a)"), grade: (s) => parties(s) },
  {
    n: 2, title: "The deposit received: amount, date, the receipt, and the trust account's institution and location", short: "Deposit and trust account", cite: R("59.18.270"),
    grade: (s, ctx) => {
      const [st, why] = security(s);
      if (st !== "done") return [st, why];
      const acct = ctx.notices.deposit_account;
      return acct ? ["done", `${why} Held at ${acct.detail ?? "the trust account on record"}; receipt and notice given ${longDate(acct.date)}.`] : ["missing", `${why} The trust account and the receipt are not on record.`];
    },
  },
  { n: 3, title: "Fees the lease labeled nonrefundable, with the clause, kept apart from the deposit", short: "Nonrefundable fees apart", cite: R("59.18.285"), grade: (s) => (s.security?.basisNote ? ["done", s.security.basisNote] : ["not_applicable", "The lease labels no fee nonrefundable."]) },
  { n: 4, title: "One line per deduction with its lease term and category", short: "One line per deduction", cite: R("59.18.260(1); 59.18.280(4)"), grade: (s) => lines(s) },
  {
    n: 5, title: "For each damage item, the checklist line that documented its condition at move-in", short: "Checklist line for each item", cite: R("59.18.280(1)(c)(iii)"),
    grade: (s, ctx) => (!s.deductions.some((d) => d.category !== "rent") ? ["not_applicable", "No damage or cleaning is deducted."]
      : ctx.notices.move_in_checklist ? ["done", `The signed move-in checklist (${longDate(ctx.notices.move_in_checklist.date)}) documents each item's condition at move-in.`]
        : ["missing", "No signed move-in checklist is on record, so no damage, cleaning or carpet item may be charged."]),
  },
  { n: 6, title: "For each damage or cleaning item, the estimate or invoice, or the time and hourly rate", short: "Invoices, estimates, labor", cite: R("59.18.280(1)(b)"), grade: (s) => documents(s) },
  { n: 7, title: "Carpet cleaning: the documented wear beyond ordinary use", short: "Carpet cleaning", cite: R("59.18.280(1)(c)(ii)"), grade: (s) => (s.deductions.some((d) => /carpet/i.test(d.item) && d.work === "clean") ? ["done", "The carpet line carries its move-out photo of wear beyond ordinary use."] : ["not_applicable", "No carpet cleaning is charged."]) },
  { n: 8, title: "Partial damage priced as the damaged portion", short: "Damaged portion only", cite: R("59.18.280(1)(c)(iv)"), grade: (s) => (s.deductions.some((d) => d.work === "replace") ? ["done", "Each replacement line explains its cost; a whole-item replacement for partial damage needs a note."] : ["not_applicable", "No replacement is charged."]) },
  { n: 9, title: "Wear items, and normal cleaning after a nonrefundable cleaning fee, never charged", short: "Wear and tear not charged", cite: R("59.18.260(4); 59.18.280(1)(c)(i); 59.18.130(10)"), grade: (s) => wear(s) },
  { n: 10, title: "The refund: amount, method, and PayPal's refund id under the written agreement", short: "Refund and method", cite: R("59.18.280(1)(a)"), grade: (s) => refund(s) },
  { n: 11, title: "If deductions exceed the deposit, the balance stated as a claim", short: "Balance stated as a claim", cite: R("59.18.280(3)"), grade: (s) => claim(s) },
  { n: 12, title: "Delivery record: personal delivery or first-class mail to the last known address, with the mailing date", short: "Delivery record", cite: R("59.18.280(1)(a)"), grade: (s) => delivered(s) },
  { n: 13, title: "Local additions where a city rule applies", short: "Local rules", cite: "Section L", grade: (s) => ["not_applicable", `No city rule is applied by this tool${s.property.city ? ` for ${s.property.city}` : ""}; check the city's rental housing program.`] },
];

export const WA_SERVER: ServerPart = {
  close: {
    rules: {
      deadline: "RCW 59.18.280(1)(a): within 30 days after the termination of the rental agreement and vacation of the premises, a full and specific statement of the basis for retaining any of the deposit, with the payment of any refund due.",
      delivery: "RCW 59.18.280(1)(a): compliance is the statement and refund delivered personally or mailed first class to the tenant's last known address within the 30 days.",
      documents: "RCW 59.18.280(1)(b): copies of estimates received or invoices paid for each damage charge, or for the landlord's own work the materials receipt and the time spent and hourly rate.",
      checklist: "RCW 59.18.260(2) and 59.18.280(1)(c)(iii): no deposit without the signed move-in checklist, and no charge for an item whose condition it did not reasonably document.",
      wearAndTear: "RCW 59.18.280(1)(c)(i): nothing withheld for wear resulting from ordinary use of the premises.",
      penalty: "RCW 59.18.280(2): missing the 30 days makes the landlord liable for the full deposit; an intentional refusal may add up to twice the deposit.",
      electronicRefund: "RCW 59.18.280(1)(a): a PayPal refund is outside the mail safe harbor, so it goes only with every adult tenant's written agreement (product policy), and the paper statement still goes out.",
      roommates: "Practice, not Washington law: one refund to the paying account unless every adult tenant signs an allocation.",
      usefulLife: "Useful-life proration and the paint schedule are common practice, not Washington law; the statute limits partial damage to the damaged portion (RCW 59.18.280(1)(c)(iv)).",
      refundWindow: "PayPal policy, not law: a payment can be refunded against itself for 180 days; after that the money goes out as a Payout.",
    },
    extraBlockers: (f, ctx) => (!ctx.notices.move_in_checklist && f.deductions.some((d) => d.category !== "rent") && !f.alreadyReturned
      ? ["No signed move-in checklist on record: damage, cleaning and carpet deductions are barred (RCW 59.18.260(2), 59.18.280(1)(c)(iii)); rent and other charges may stay (59.18.280(4)). Remove those deductions, or record the checklist if one was signed at the start."]
      : []),
    extraWarnings: (f, ctx) => {
      const ends = ctx.plannedMoveOut ?? ctx.endDate;
      return [
        ...(f.tenancy.moveOutDate && ends && ends > f.tenancy.moveOutDate ? [`The tenants left before the tenancy's end on ${longDate(ends)}. The 30 days run from termination and vacation; the app counts from the move-out, the shorter reading (RCW 59.18.280(1)(a)).`] : []),
        ...(!ctx.notices.deposit_account && f.deposit ? ["No record of the trust account the deposit went into, or of the receipt and depository notice (RCW 59.18.270)."] : []),
      ];
    },
  },

  steps: {
    flow: {
      doneCite: R("59.18.280(1)(a)"),
      sendRefundCite: R("59.18.280(1)(a)"),
      photosOut: { detail: "Before any repair or cleaning that will be deducted: support for each checklist line and the damaged-portion pricing.", cite: R("59.18.280(1)(c)") },
      compareCite: R("59.18.280(1)"),
      deliveryCite: R("59.18.280(1)(a)"),
      statementDetail: (m) => `Due 30 days after the ${longDate(m)} move-out, with the estimates or invoices, handed over or mailed first class.`,
      statementCite: R("59.18.280(1)"),
      tenantNoticeCite: R("59.18.280(1)(a)"),
      noDateDetail: "Once the tenants vacate, the move-out starts the 30-day clock.",
      windowStep: () => "",
      windowCite: "",
      moveOutStep: (ends) => `Planned for ${longDate(ends)}. Record the actual move-out date when the tenants vacate; the 30-day clock starts then.`,
      moveOutCite: R("59.18.280(1)(a)"),
      invoice: { detail: "For the deposit the lease asks for, after the signed checklist; no statewide cap.", cite: R("59.18.260(2)") },
      unpaidCite: R("59.18.260"),
      photosIn: { detail: "", cite: "" },
      leaseEndsCite: R("59.18.280"),
    },
    moveIn: (t, today, h) => {
      if (!t.notices.move_in_checklist) {
        const step = h.undated("Record the signed move-in checklist", "No deposit may be collected without a written checklist of the unit's condition, signed and dated by both, with a copy to the tenants.", R("59.18.260(2)-(3)"), t.startDate && t.startDate <= today ? "urgent" : "soon");
        return { step: { ...step, action: { label: "Record checklist", path: "notices/move-in-checklist", icon: "file-check" } }, beforeInvoice: true };
      }
      if (t.deposit && wasPaid(t.deposit.status) && !t.notices.deposit_account) {
        const step = h.undated("Record the trust account and send the receipt", "Promptly into a trust account at a Washington financial institution or licensed escrow agent, not the PayPal balance; the tenants get a written receipt and the depository's name, address and location.", R("59.18.270"), "urgent");
        return { step: { ...step, action: { label: "Record account", path: "notices/deposit-account", icon: "file-check" } }, beforeInvoice: false };
      }
      return null;
    },
    afterInspection: () => null,
    openMoveIn: (t) => [
      ...(!t.notices.move_in_checklist ? ["no signed move-in checklist"] : []),
      ...(t.deposit && wasPaid(t.deposit.status) && !t.notices.deposit_account ? ["trust account not recorded"] : []),
    ],
  },

  calendar: {
    checkIn: (where, ends) => `The lease at ${where} ends ${longDate(ends)}, 60 days from today. Ask the tenants whether they are staying, and for the address the statement should go to.`,
    window: () => "",
    moveOut: (lead) => `${lead} Photograph the unit before any repair or cleaning, to support each line of the move-in checklist. The 30-day clock for the statement, its invoices and the refund starts when the tenancy ends and the tenants vacate (RCW 59.18.280(1)(a)).`,
    due: {
      label: "Statement and refund due, 30 days after move-out",
      summary: (where) => `Deposit statement and refund due: ${where}`,
      description: (ends) => `Last day to hand over or mail the full and specific statement, with the estimates or invoices, and the refund: 30 days after the ${longDate(ends)} move-out (RCW 59.18.280(1)(a)).`,
    },
  },

  statement: {
    checklist: grade(ITEMS),
    short: shortOf(ITEMS),
    checklistTip: "The 13 items a Washington statement needs under the rules spec: RCW 59.18.260 to 59.18.285. Each item's tip says why it is done, missing or not needed here.",
    interest: (city) => {
      const note = "No interest is owed: the trust account's interest belongs to the landlord unless agreed otherwise in writing (RCW 59.18.270).";
      return { city, known: false, note, checkReason: note };
    },
    interestTitle: "Deposit interest",
    wearAtZero: true,
    basisNote: (t) => {
      const fees = t.otherMoveInCharges.filter((c) => c.refundable === false);
      return fees.length ? `The lease also lists ${fees.map((c) => `${c.label.toLowerCase()} ${usd(c.amount)}`).join(", ")}, labeled nonrefundable and kept apart from the deposit (RCW 59.18.285).${fees.some((c) => /clean/i.test(c.label)) ? " With a nonrefundable cleaning fee paid, normal cleaning is not charged again (RCW 59.18.130(10))." : ""}` : null;
    },
    documentsNote: (_r, total, any) => (!any ? "No repair or cleaning was deducted, so no estimates or invoices apply."
      : `Repair and cleaning deductions total ${usd(total)}. Washington requires, with the statement, copies of the estimates received or invoices paid for each damage charge, or for the landlord's own work the materials receipt and the time spent and hourly rate, whatever the amount (RCW 59.18.280(1)(b)).`),
    documentsLine: (_r, total) => `Required for every damage charge: repair and cleaning total ${usd(total)}`,
    documentsCite: () => R("59.18.280(1)(b)"),
    refundNote: (r) => [
      r.tenants.length > 1 ? `One refund to the paying account for all adult tenants named on the lease (${r.tenants.join(" and ")}); the statute names only "the tenant", so this is practice.` : null,
      r.paid ? (r.signed ? `The refund goes by PayPal under ${r.signed}, and this statement still goes by hand or first-class mail with PayPal's refund id (RCW 59.18.280(1)(a)).` : "The refund goes with this statement, by hand or first-class mail; a PayPal refund needs the tenants' written agreement (RCW 59.18.280(1)(a); product policy).") : null,
    ].filter(Boolean).join(" "),
    refundDueMethod: (r) => (r.paypalEmail ? `Refund by PayPal to ${r.paypalEmail} under the tenants' written agreement, to be sent` : "To be sent with the statement, by hand or first-class mail"),
    sections: {
      security: { title: "Deposit received", cite: R("59.18.270, 59.18.285"), text: "The deposit received, the receipt and the trust account it was held in; fees the lease labels nonrefundable are kept apart." },
      deductions: { title: "Deductions", cite: R("59.18.280(1)(a)-(c), (4)"), text: "A full and specific statement of the basis for keeping any of the deposit: one line per deduction, with its lease term, its checklist line and its estimate or invoice." },
      refund: R("59.18.280(1)(a)"),
      delivery: { title: "Delivery", cite: R("59.18.280(1)(a)"), text: "Handed to the tenant, or mailed first class, postage prepaid, to the last known address within the 30 days; email is a courtesy copy only." },
    },
    documentRow: { title: "The itemized statement", cite: R("59.18.280(1)"), text: "Due with the refund within 30 days after the tenancy ends and the tenants vacate, with the estimates or invoices for each damage charge." },
    headerTip: { title: "The statement", cite: "RCW 59.18.280(1)", text: "Within 30 days after the tenancy ends and the tenants vacate: a full and specific statement of the basis for keeping any of the deposit, with its documents, and the refund." },
    estimateNote: "Estimate: a copy of the estimate received substantiates the charge until the invoice is paid (RCW 59.18.280(1)(b)).",
    estimateLine: "Estimate: the copy of the estimate substantiates the charge",
    dueTipText: "The statement, its documents and the refund are due within 30 days after the tenancy ends and the tenants vacate.",
    guidanceSource: "as common practice, not Washington law",
    estimateCite: R("59.18.280(1)(b)"),
    pdf: { deadlineLine: "30 days after move-out, RCW 59.18.280(1)(a)", dueSuffix: "30 days after move-out" },
  },

  tenant: {
    detailsTip: { title: "Your deposit", cite: R("59.18.270, 59.18.280(1)"), text: "Your deposit is held in a trust account. It comes back, less any lawful deductions, with a full and specific statement and its invoices, within 30 days after the tenancy ends and you move out." },
    dueTip: { title: "30 days after you move out", cite: R("59.18.280(1)(a)"), text: "Within 30 days after the tenancy ends and you move out, the landlord gives you a full and specific statement of anything kept, with the invoices, and the rest of the deposit." },
    paidLine: "It comes back, less any lawful deductions, within 30 days after you move out.",
    documentsTip: () => ({ title: "Invoices come with the statement", cite: R("59.18.280(1)(b)"), text: "Every damage charge comes with a copy of the estimate or invoice, or the time spent and hourly rate for the landlord's own work. The PDF lists exactly what it holds." }),
    mailTip: (movedOut) => ({ title: "Where the statement goes", cite: R("59.18.280(1)(a)"), text: `The statement is handed to you or mailed to your last known address: give your landlord a forwarding address. If you give none, it goes to the unit you ${movedOut ? "left" : "are leaving"}.` }),
    deliveryCite: R("59.18.280(1)(a)"),
    prorationNote: "Proration by useful life and paint schedules is common practice, not Washington law.",
    agreementTip: ({ agreed }) => ({ title: agreed ? "Your refund agreement" : "How the refund comes back", cite: R("59.18.280(1)(a)"), text: agreed ? null : "The refund comes with the statement, by hand or first-class mail, unless you agree in writing to a PayPal refund." }),
    rights: (v) => {
      const st = v.statement;
      return [
        { title: "Statement and refund within 30 days", cite: R("59.18.280(1)(a)"), text: `Within 30 days after the tenancy ends and you move out, the landlord gives you a full and specific statement of anything kept, with the invoices, and the rest of the deposit. Miss it and the landlord owes you the full deposit.${v.moveOutDate && v.statementDue ? ` You moved out on ${longDate(v.moveOutDate)}, so the deadline ${st ? "was" : "is"} ${longDate(v.statementDue)}.` : ""}` },
        { title: "The move-in checklist", cite: R("59.18.260(2)-(5)"), text: "No deposit may be collected without a written checklist of the unit's condition, signed by you and the landlord, with a copy for you. Without it the landlord owes the deposit back, and nothing can be charged for an item the checklist didn't document." },
        { title: "No charge for ordinary wear", cite: R("59.18.030, 59.18.280(1)(c)(i)"), text: "Nothing can be kept for wear resulting from ordinary use, including breakage or malfunction from age; carpet cleaning only with documented wear beyond ordinary use." },
        { title: "Invoices with every damage charge", cite: R("59.18.280(1)(b)"), text: "Each damage charge comes with a copy of the estimate or invoice, or the landlord's time and hourly rate. Partial damage is charged only for the damaged portion." },
        { title: "Your deposit is held in trust", cite: R("59.18.270"), text: "The deposit goes into a trust account at a Washington financial institution, and you get a receipt and the depository's name and address." },
        { title: "Cleaning fee", cite: R("59.18.130(10)"), text: "If you paid a nonrefundable cleaning fee, you can't be charged again for normal cleaning." },
        ...(v.tenants.length > 1 ? [{ title: "More than one tenant on the lease", cite: R("59.18.280(1)(a)"), text: "The statute names only \"the tenant\"; by default the refund goes back to the account the deposit came from, and each adult gets the statement." }] : []),
      ];
    },
  },

  ai: {
    reasonExample: "Small nail holes are wear resulting from ordinary use under RCW 59.18.030",
    inspectorRole: "You inspect rental units at move-out for a Washington landlord's security deposit tool.",
    inspectionGuide: inspectionGuide("RCW 59.18.030 and 59.18.280(1)(c), as applied here (wear resulting from ordinary use is deterioration from the intended use of a dwelling unit, including breakage or malfunction due to age or deteriorated condition, not deterioration from negligence, carelessness, accident or abuse by the tenant, family, occupant or guest; carpet cleaning only with documented wear beyond ordinary use):"),
    closeOutSystem: closeOutSystem({
      name: "Washington", items: 13,
      note: "The full and specific statement, with the estimates or invoices for each damage charge, and the refund are due within 30 days after the tenancy ends and the tenant vacates, handed over or mailed first class; a PayPal refund goes only under the tenants' written agreement, and the paper statement still goes out. Damage deductions need the signed move-in checklist.",
    }),
    factsToolDescription: factsTool("30-day"),
    checklistToolDescription: checklistTool(13, "RCW 59.18.260 to 59.18.285"),
  },

  // WA spec W2, W25: a late statement or refund makes the landlord liable for the full deposit; no checklist bars
  // damage charges. The spec names no small claims limit, so none is stated.
  dispute: {
    late: {
      effect: "forfeit",
      text: "The statement or the refund went out after the 30 days, so the landlord is liable for the full deposit and may not keep any of it, unless the tenants abandoned the unit or circumstances were beyond the landlord's control.",
      cite: R("59.18.280(2)"),
    },
    // W17 and open question 1: the 30 days run from "the termination of the rental agreement and vacation of the
    // premises", the later of the two. When the tenants left before the tenancy ended, the deadline counts from the
    // move-out (the safe reading for the landlord's warning), but a forfeiture is applied only when the statement is
    // late counted from the later date too; otherwise the lateness is a point for the tenants, not a forfeiture.
    isLate: (c) => {
      if (!c.moveOutDate || !c.sentOn) return { late: null };
      if (c.sentOn <= addDays(c.moveOutDate, 30)) return { late: false };
      const later = [c.plannedMoveOut, c.endDate].reduce<string>((a, d) => (d && d > a ? d : a), c.moveOutDate);
      if (c.sentOn > addDays(later, 30)) return { late: true };
      return {
        late: true,
        doubt: {
          text: `Counted from the move-out, the statement or the refund went out after the 30 days; counted from the end of the tenancy on ${longDate(later)}, it did not. The 30 days run from the end of the tenancy and the move-out together, and which date counts when tenants leave first is unsettled, so the forfeiture is arguable.`,
          cite: R("59.18.280(1)(a), (2)"),
        },
      };
    },
    evidence: { text: "Each damage charge needs copies of the estimates or invoices, or for the landlord's own work the materials receipt, the time spent and the hourly rate.", cite: R("59.18.280(1)(b)") },
    forum: {
      name: "Court", limit: null,
      text: "The tenants can sue to recover the deposit, and the side that wins recovers its costs and reasonable attorneys' fees. WashingtonLawHelp explains the courts.",
      cite: R("59.18.280(2)"),
    },
    lineBar: (d, notices) => (d.category !== "rent" && !notices.move_in_checklist
      ? { text: "No signed move-in checklist is on record, so damage and cleaning charges are barred.", cite: R("59.18.260(2), 59.18.280(1)(c)(iii)") }
      : null),
    // W21: no carpet cleaning charge without documented wear beyond ordinary use.
    cleaningRule: (d) => (d.category === "cleaning" && /\b(carpet|rug)/i.test(d.item)
      ? { text: "A carpet cleaning charge is allowed only when the landlord documents wear to the carpet beyond ordinary use.", cite: R("59.18.280(1)(c)(ii)") }
      : null),
    // W19, W25, W27: a charge without its documents may not be charged, so a gap bars it rather than weakening it.
    documentsCure: null,
    sendNote: null,
  },
};

// Florida: the half of the pack only the server reads (the statement checklist, the close-out agent's rules and
// prompt, the next-step hooks, the calendar, the tenant page). The rest is in fl.ts, which client components load.

import { wasPaid } from "../invoice-status";
import { addDays, longDate, usd } from "./common";
import {
  checklistTool, claim, closeOutSystem, disclaimer, evidence, factsTool, grade, inspectionGuide, lines, parties, refund,
  security, shortOf, wear, type ItemSpec,
} from "./common.server";
import { flClockStart, objectionOf, receivedOn } from "./fl";
import type { ServerPart, StandingInput } from "./types";

const F = (s: string) => `Fla. Stat. ${s}`;

/** F12: a claim the tenants objected to in time is disputed, not deducted (product policy on the spec's E): the
 *  undisputed balance goes back on schedule and the claimed amount stays in the separate account. */
function disputed(c: StandingInput) {
  const o = objectionOf(c.notices);
  return o?.timely && c.claimed > 0 ? o : null;
}

const ITEMS: ItemSpec[] = [
  { n: 1, title: "Tenant names, last known mailing address, unit, move-out and termination dates, the tenant's 7-day notice", short: "Parties and dates", cite: F("83.49(3)(a), (5)"), grade: (s) => parties(s) },
  {
    n: 2, title: "The statutory statement in substance, with the amount, the reason and the landlord's notice address", short: "The claim notice", cite: F("83.49(3)(a); 83.50"),
    grade: (s, ctx) => (!s.deductions.length ? ["not_applicable", "No claim: the deposit goes back in full within 15 days."]
      : ctx.notices.claim_notice ? ["done", `Claim notice sent on ${longDate(ctx.notices.claim_notice.date)}, in the statute's words, from the draft.`]
        : ["missing", "Send the notice of intention to impose a claim within 30 days after the tenancy ends, or the claim is forfeited."]),
  },
  {
    n: 3, title: "The notice date and method: certified mail with the tracking number, or s. 83.505 email", short: "How the notice went", cite: F("83.49(3)(a); 83.505(4)-(5)"),
    grade: (s, ctx) => {
      const n = ctx.notices.claim_notice;
      if (!s.deductions.length) return ["not_applicable", "No claim notice is needed with no deductions."];
      return n ? ["done", `${n.method === "email" ? "Emailed under s. 83.505" : "Certified mail"} on ${longDate(n.date)}${n.detail ? `, ${n.detail}` : ""}.`] : ["missing", "No claim notice on record yet."];
    },
  },
  {
    n: 4, title: "The tenant's 15 days after receipt to object, and the day the balance is due", short: "Objection window and balance", cite: F("83.49(3)(b)"),
    grade: (s, ctx) => {
      const n = ctx.notices.claim_notice;
      if (!s.deductions.length) return ["not_applicable", "No claim, so no objection window."];
      if (!n) return ["missing", "Starts with the claim notice."];
      const got = receivedOn(n);
      if (!got) return ["missing", "Record the day the tenant received the notice: the 15 days run from receipt."];
      const dates = `Objections by ${longDate(addDays(got, 15))}; the balance is due by ${longDate(addDays(n.date, 30))}.`;
      const o = objectionOf(ctx.notices);
      return ["done", !o ? dates : o.timely
        ? `${dates} The tenants objected in time, on ${longDate(o.date)}: the claim is disputed and nothing claimed is deducted.`
        : `${dates} The tenants' objection arrived on ${longDate(o.date)}, after the 15 days.`];
    },
  },
  {
    n: 5, title: "Deposit received: amount, date, how paid, how it was held, any interest owed", short: "Deposit and how it was held", cite: F("83.43; 83.49(1), (9)"),
    grade: (s, ctx) => {
      const [st, why] = security(s);
      if (st !== "done") return [st, why];
      const acct = ctx.notices.deposit_account;
      return acct ? ["done", `${why} Held in ${acct.method === "bond" ? "a surety bond" : acct.method === "interest" ? "an interest-bearing account" : "a separate account"}: ${acct.detail ?? "on record"}.`] : ["missing", `${why} Where it was held is not on record.`];
    },
  },
  { n: 6, title: "One line per item with its basis: unpaid rent with due dates, damage, cleaning, a lease charge", short: "One line per item", cite: F("83.43(14); 83.52"), grade: (s) => lines(s) },
  { n: 7, title: "Wear-and-tear findings listed at $0", short: "Wear and tear at $0", cite: F("83.52"), grade: (s) => wear(s) },
  { n: 8, title: "Evidence attached and labeled as evidence", short: "Evidence for each line", cite: "Durene v. Alcime; Fla. Stat. 83.49(3)(c)", grade: (s) => evidence(false)(s) },
  { n: 9, title: "Balance to be refunded, method, payees and the interest line", short: "Refund, method and payees", cite: F("83.49(3)(b), (9)"), grade: (s) => refund(s) },
  { n: 10, title: "If deductions exceed the deposit, the balance claimed, stated as a claim", short: "Balance stated as a claim", cite: F("83.43(14)"), grade: (s) => claim(s) },
  { n: 11, title: "Either party may sue; the prevailing party recovers costs and fees", short: "Fees sentence", cite: F("83.49(3)(c)"), grade: (s) => (s.refund.note ? ["done", "The refund section states it."] : ["missing", "The fees sentence is missing."]) },
  { n: 12, title: "The disclaimer line", short: "Not legal advice", cite: "Rules Regulating The Florida Bar 10-2.1(a)", grade: () => disclaimer() },
];

export const FL_SERVER: ServerPart = {
  close: {
    rules: {
      deadline: "Fla. Stat. 83.49(3)(a): with no claim, the deposit, with any interest owed, is returned within 15 days after the termination of the rental agreement.",
      claimNotice: "Fla. Stat. 83.49(3)(a): to impose a claim, written notice by certified mail to the tenant's last known mailing address, or by email under s. 83.505, within 30 days after the termination, in the statute's words.",
      forfeiture: "Fla. Stat. 83.49(3)(a): a landlord who fails to give the notice within the 30 days forfeits the right to impose a claim upon the deposit and may not seek a setoff against it.",
      objection: "Fla. Stat. 83.49(3)(b): unless the tenant objects within 15 days after receiving the notice, the landlord may deduct the claim and remits the balance within 30 days after the date of the notice.",
      fees: "Fla. Stat. 83.49(3)(c): in an action over the deposit, the prevailing party recovers court costs and a reasonable attorney fee.",
      holding: "Fla. Stat. 83.49(1): the deposit is held in a separate Florida account or under a surety bond, never mingled with the landlord's funds.",
      electronicRefund: "Fla. Stat. 83.49(3): Florida names no refund method; a Payout to another account needs the tenant's written designation (product policy).",
      roommates: "Practice, not Florida law: one refund to the original payment unless every adult tenant signs an allocation.",
      documents: "Fla. Stat. 83.49(3)(a): the notice states the amount and the reason; no receipts are required, so the photos, invoices and labor records go with it as evidence.",
      usefulLife: "Useful-life proration and the paint schedule are common practice, not Florida law.",
      refundWindow: "PayPal policy, not law: a payment can be refunded against itself for 180 days; after that the money goes out as a Payout.",
    },
    extraBlockers: (f, ctx) => {
      if (!f.tenancy.moveOutDate || f.alreadyReturned || !f.deductions.length) return [];
      const start = flClockStart({ moveOutDate: f.tenancy.moveOutDate, endDate: ctx.endDate, plannedMoveOut: ctx.plannedMoveOut })!;
      const last = addDays(start, 30);
      const n = ctx.notices.claim_notice;
      const forfeit = `The 30 days for the claim notice ran out on ${longDate(last)}, so the claim and any setoff against the deposit are forfeited (Fla. Stat. 83.49(3)(a)). Remove the deductions to return the whole deposit; a claim for damages can be brought separately after it is returned.`;
      if (!n) {
        return [ctx.today > last ? forfeit : `Send the claim notice first: by certified mail (or email under a signed s. 83.505 addendum) by ${longDate(last)}, 30 days after the tenancy ended. Nothing may be deducted until 15 days after the tenants receive it (Fla. Stat. 83.49(3)(a)-(b)).`];
      }
      if (n.date > last) return [forfeit];
      const got = receivedOn(n);
      if (!got) return ["Record the day the tenants received the claim notice (the USPS delivery date): their 15 days to object run from receipt (Fla. Stat. 83.49(3)(b))."];
      // An objection already in hand ends the wait: the undisputed balance may go back now (F12, section G).
      if (ctx.today <= addDays(got, 15) && !ctx.notices.claim_objection) return [`The tenants may object until ${longDate(addDays(got, 15))}, 15 days after receiving the claim notice; nothing is deducted before then (Fla. Stat. 83.49(3)(b)).`];
      return [];
    },
    extraWarnings: (f, ctx) => {
      const o = objectionOf(ctx.notices);
      return [
        ...(o?.timely ? [`The tenants objected in writing on ${longDate(o.date)}, within the 15 days after receiving the claim notice (to ${longDate(o.last!)}). Florida authorizes the deduction only without a timely objection (Fla. Stat. 83.49(3)(b)): the refund here is the undisputed balance, and the ${usd(f.totals.deductions)} claimed stays in the separate account as disputed, not deducted, until the parties agree or a court decides. In the note to the tenants, call the refund the undisputed balance, with the claimed amount held pending the dispute. Either party may sue; the prevailing party recovers costs and a reasonable attorney fee (Fla. Stat. 83.49(3)(c)).`] : []),
        ...(o && o.timely === false ? [`The tenants' written objection arrived on ${longDate(o.date)}, after the 15 days that ended ${longDate(o.last!)}. Unless they sent it within those 15 days, it is late and the landlord may deduct the claim; the tenants keep the right to sue (Fla. Stat. 83.49(3)(b)).`] : []),
        ...(!ctx.notices.deposit_account && f.deposit ? ["No record that the deposit moved out of the PayPal balance into a separate Florida account or under a bond (Fla. Stat. 83.49(1))."] : []),
      ];
    },
    standing: (c) => {
      const o = disputed(c);
      return o ? {
        label: "Claimed, disputed",
        note: `The tenants objected in writing on ${longDate(o.date)}, within 15 days after receiving the notice of intention to impose a claim. Florida lets a landlord deduct a claim only when the tenant does not object in time (s. 83.49(3)(b)), so the ${usd(c.claimed)} claimed is held in the separate deposit account as disputed, not deducted, and the refund is the undisputed balance. Either party may bring an action over the deposit; the prevailing party recovers court costs and a reasonable attorney fee (s. 83.49(3)(c)).`,
      } : null;
    },
  },

  steps: {
    flow: {
      doneCite: F("83.49(3)"),
      sendRefundCite: F("83.49(3)(a)-(b)"),
      photosOut: { detail: "Before any repair or cleaning that will be claimed, and again after: evidence for a claim the landlord may have to prove.", cite: F("83.49(3)(c)") },
      compareCite: F("83.49(3)(a)"),
      deliveryCite: F("83.49(3)(a)"),
      statementDetail: () => "With no claim, the deposit goes back within 15 days after the tenancy ends; after a claim notice, the balance goes back within 30 days of the notice.",
      statementCite: F("83.49(3)(a)-(b)"),
      tenantNoticeCite: F("83.49(5)"),
      noDateDetail: "Once the tenants vacate, the end of the tenancy starts the 15 and 30-day clock.",
      windowStep: () => "",
      windowCite: "",
      moveOutStep: (ends) => `Planned for ${longDate(ends)}. Record the actual move-out date when the tenants vacate; the 15 and 30-day clock starts then.`,
      moveOutCite: F("83.49(3)(a)"),
      invoice: { detail: "For the deposit the lease asks for; Florida sets no cap.", cite: F("83.49") },
      unpaidCite: F("83.49(1)"),
      photosIn: { detail: "", cite: "" },
      leaseEndsCite: F("83.49(5)"),
    },
    moveIn: (t, _today, h) => {
      if (!t.deposit || !wasPaid(t.deposit.status)) return null;
      if (!t.notices.deposit_account) {
        const step = h.undated("Move the deposit into a separate Florida account", "Out of the PayPal balance: a separate account at a Florida financial institution, or a surety bond. Record where it is held.", F("83.49(1)"), "urgent");
        return { step: { ...step, action: { label: "Record account", path: "notices/deposit-account", icon: "file-check" } }, beforeInvoice: false };
      }
      if ((t.landlordUnits ?? 0) >= 5 && !t.notices.holding_notice) {
        const step = h.undated("Send the holding notice", "Where the deposit is held, whether the tenants get interest, and the disclosure of s. 83.49(2)(d), within 30 days of receiving it (five or more units).", F("83.49(2)"), "soon");
        return { step: { ...step, action: { label: "Send notice", path: "notices/holding-notice", icon: "mail" } }, beforeInvoice: false };
      }
      return null;
    },
    afterInspection: (t, today, h) => {
      if (!t.moveOutDate || !t.deductions.length || t.returned) return null;
      const start = flClockStart({ moveOutDate: t.moveOutDate, endDate: t.endDate, plannedMoveOut: t.plannedMoveOut })!;
      const n = t.notices.claim_notice;
      if (!n) {
        return { ...h.dated("Send the claim notice by certified mail", "Within 30 days after the tenancy ends, in the statute's words, or the claim and any setoff are forfeited. Nothing is deducted until 15 days after the tenants receive it.", F("83.49(3)(a)"), addDays(start, 30)),
          action: { label: "Send claim notice", path: "notices/claim-notice", icon: "mail" } };
      }
      const got = receivedOn(n);
      if (!got) {
        return { ...h.undated("Record when the tenants received the claim notice", "Their 15 days to object run from receipt: the USPS delivery date.", F("83.49(3)(b)"), "urgent"),
          action: { label: "Record receipt", path: "notices/claim-notice", icon: "pen" } };
      }
      const o = objectionOf(t.notices);
      if (o?.timely) {
        return { ...h.dated("Refund the undisputed balance", "The tenants objected in time: the claimed amount stays in the separate account as disputed, and the rest of the deposit goes back by the balance date.", F("83.49(3)(b)-(c)"), addDays(n.date, 30)),
          action: { label: "View objection", path: "notices/claim-objection", icon: "doc" } };
      }
      if (today <= addDays(got, 15) && !o) {
        return { ...h.dated("Objection window ends", "The tenants have 15 days after receiving the claim notice to object in writing; the deduction waits until then.", F("83.49(3)(b)"), addDays(got, 15), false),
          action: { label: "View notice", path: "notices/claim-notice", icon: "doc" } };
      }
      return null;
    },
    openMoveIn: (t) => (t.deposit && wasPaid(t.deposit.status) && !t.notices.deposit_account ? ["deposit not yet recorded in a separate Florida account"] : []),
  },

  calendar: {
    checkIn: (where, ends) => `The lease at ${where} ends ${longDate(ends)}, 60 days from today. Ask the tenants whether they are staying; tenants who leave give 7 days' written notice with an address (Fla. Stat. 83.49(5)).`,
    window: () => "",
    moveOut: (lead) => `${lead} Photograph the unit before any repair or cleaning: a landlord claiming damages carries the burden of proof. The 15-day refund or the 30-day claim notice runs from the end of the tenancy (Fla. Stat. 83.49(3)(a)).`,
    due: {
      label: "Deposit refund due, or the claim notice",
      summary: (where) => `Deposit refund or claim notice due: ${where}`,
      description: (ends) => `From the ${longDate(ends)} end of the tenancy: the deposit goes back within 15 days if nothing is claimed; to claim any part, the notice goes by certified mail within 30 days, and the balance within 30 days of the notice (Fla. Stat. 83.49(3)(a)-(b)).`,
    },
  },

  statement: {
    checklist: grade(ITEMS),
    short: shortOf(ITEMS),
    checklistTip: "The 12 items a Florida claim notice and itemized statement need under the rules spec: Florida Statutes 83.49. Each item's tip says why it is done, missing or not needed here.",
    interest: (city, o) => {
      const acct = o.notices.deposit_account;
      if (acct && (acct.method === "interest" || acct.method === "bond")) {
        const note = `Interest is owed: the deposit is held ${acct.method === "bond" ? "under a surety bond, at 5 percent a year simple interest" : "in an interest-bearing account, at 75 percent of the account's annualized average rate or 5 percent a year simple interest, as elected"}, paid or credited at least once a year; the interest accrued since then goes back with the deposit (Fla. Stat. 83.49(1)(b)-(c), (9)). It is not computed here, and none is owed to a tenant who wrongfully ended the tenancy early.`;
        return { city: null, known: true, note, checkReason: note }; // owed by how it is held, not by the city
      }
      const note = acct ? "No interest is owed: the deposit is held in a separate non-interest-bearing account (Fla. Stat. 83.49(1)(a))." : "No interest is included. Interest is owed only when the deposit is held in an interest-bearing account or under a bond (Fla. Stat. 83.49(1)); how it is held is not on record.";
      return { city, known: false, note, checkReason: note };
    },
    interestTitle: "Deposit interest",
    wearAtZero: true,
    basisNote: (t) => {
      const fees = t.otherMoveInCharges.filter((c) => c.refundable === false);
      return fees.length ? `The lease also lists ${fees.map((c) => `${c.label.toLowerCase()} ${usd(c.amount)}`).join(", ")}, labeled nonrefundable and not part of the deposit held here. Deposit money includes any deposit, however labeled (Fla. Stat. 83.43(4)).` : null;
    },
    documentsNote: (_r, total, any) => (!any ? "No repair or cleaning was claimed, so no invoices or labor records apply."
      : `Repair and cleaning claims total ${usd(total)}. Florida requires the claim notice to state the amount and the reason (s. 83.49(3)(a)), not receipts; the photos, invoices and labor records go with it as evidence, since the loser of a deposit suit pays the other side's fees (s. 83.49(3)(c)).`),
    documentsLine: (_r, total) => `Evidence, not required by Florida law: repair and cleaning total ${usd(total)}`,
    documentsCite: () => F("83.49(3)(a), (c)"),
    refundNote: (r) => [
      r.tenants.length > 1 ? `One refund to the original payment for all adult tenants named on the lease (${r.tenants.join(" and ")}); the statute names no payee among several, so this is practice.` : null,
      r.paid ? "Florida names no refund method; the refund goes back against the deposit payment, and PayPal's refund id and timestamp record the date (Fla. Stat. 83.49(3))." : null,
      "Either party may bring an action over the deposit; the prevailing party recovers court costs and a reasonable attorney fee, and the court advances the case (Fla. Stat. 83.49(3)(c)). You should attempt to informally resolve any dispute before filing a lawsuit.",
    ].filter(Boolean).join(" "),
    refundDueMethod: (r) => (r.paypalEmail ? `PayPal refund of the deposit payment, or a Payout to ${r.paypalEmail} if that payment can't take it, to be sent` : "To be refunded against the deposit payment"),
    sections: {
      security: { title: "Deposit received", cite: F("83.43; 83.49(1)"), text: "The deposit received, when and how, and how it was held: a separate account or a surety bond." },
      deductions: { title: "Claims", cite: F("83.49(3)(a); 83.43(14); 83.52"), text: "One line per item claimed, each with its reason: unpaid rent, damage beyond normal wear and tear, or cleaning to the clean and sanitary standard." },
      refund: F("83.49(3)(b)-(c), (9)"),
      delivery: { title: "Delivery", cite: F("83.49(3)(a); 83.505"), text: "With the claim notice: certified mail to the last known mailing address, or email under a signed s. 83.505 addendum." },
    },
    documentRow: { title: "The itemized statement", cite: F("83.49(3)(a)-(b)"), text: "With no claim, a receipt for the refund within 15 days; with one, it goes with the certified-mail claim notice within 30 days." },
    headerTip: { title: "The itemized statement", cite: "Florida Statutes section 83.49(3)", text: "With a claim, it goes with the notice of intention to impose a claim, within 30 days after the tenancy ends; with none, the whole deposit goes back within 15 days." },
    estimateNote: "Estimate: the work is not finished or the invoice is not in hand yet; the invoice follows when received (practice).",
    estimateLine: "Estimate: the invoice follows when received",
    dueTipText: "With no claim, within 15 days after the tenancy ends; after a claim notice, the balance within 30 days of the notice.",
    guidanceSource: "as common practice, not Florida law",
    estimateCite: F("83.49(3)(a)"),
    pdf: { deadlineLine: "15 days, or 30 after a claim notice, Fla. Stat. 83.49(3)", dueSuffix: "15 days, or 30 after a claim notice" },
  },

  tenant: {
    detailsTip: { title: "Your deposit", cite: F("83.49(1), (3)"), text: "Your deposit is held in a separate Florida account or under a bond. It comes back within 15 days after the tenancy ends, or, if the landlord claims part of it, after a certified-mail notice you may object to." },
    dueTip: { title: "15 days, or 30 with a claim", cite: F("83.49(3)(a)-(b)"), text: "With no claim, the deposit comes back within 15 days after the tenancy ends. If the landlord claims part, a notice comes by certified mail within 30 days; you have 15 days after receiving it to object in writing." },
    paidLine: "It comes back within 15 days after the tenancy ends, or after a claim notice you may object to.",
    documentsTip: () => ({ title: "The claim and its evidence", cite: F("83.49(3)(a)"), text: "Florida requires a notice stating the amount and the reason for any claim. The landlord adds photos and invoices as evidence; the PDF lists exactly what it holds." }),
    mailTip: (movedOut) => ({ title: "Your address for notices", cite: F("83.49(5), (3)(a)"), text: `Give your landlord at least 7 days' written notice, by certified mail or in person, with an address where you can be reached: any claim notice goes there. The form here gives your landlord the address, but it is not that notice. If you give none, a claim notice goes to the unit you ${movedOut ? "left" : "are leaving"}.` }),
    deliveryCite: F("83.49(3)(a); 83.505"),
    prorationNote: "Proration by useful life and paint schedules is common practice, not Florida law.",
    agreementTip: ({ agreed }) => ({ title: agreed ? "Your PayPal account" : "How the refund comes back", cite: F("83.49(3)"), text: agreed ? null : "Florida names no refund method. The refund goes back to the PayPal account the deposit came from." }),
    rights: (v) => {
      const st = v.statement;
      return [
        { title: "Refund within 15 days, or a claim within 30", cite: F("83.49(3)(a)"), text: `With no claim, the landlord returns your deposit within 15 days after the tenancy ends. To keep any part, the landlord sends a notice by certified mail within 30 days, or the claim is forfeited.${v.moveOutDate && v.statementDue ? ` For your ${longDate(v.moveOutDate)} move-out, the date ${st ? "was" : "is"} ${longDate(v.statementDue)}.` : ""}` },
        { title: "15 days to object", cite: F("83.49(3)(b)"), text: "You have 15 days after receiving a claim notice to object in writing to the address it gives. If you don't, the landlord may deduct the claim, but you can still sue." },
        { title: "No charge for normal wear and tear", cite: F("83.43(14), 83.52"), text: "The deposit secures damage you caused and unpaid obligations, not ordinary deterioration from living in the home." },
        { title: "Where your deposit is held", cite: F("83.49(1)-(2)"), text: "The deposit sits in a separate Florida account or under a bond, never mixed with the landlord's money. With an interest-bearing account or a bond, you get interest at least once a year." },
        { title: "Give 7 days' notice with an address", cite: F("83.49(5)"), text: "Before you leave, give at least 7 days' written notice by certified mail or in person, with an address where you can be reached. Skipping it never costs you the deposit." },
        { title: "If it goes to court", cite: F("83.49(3)(c)"), text: "Either side may sue over the deposit; the winner recovers court costs and a reasonable attorney fee. Try to resolve a dispute informally first." },
        ...(v.tenants.length > 1 ? [{ title: "More than one tenant on the lease", cite: F("83.49(1)"), text: "The statute doesn't say how a refund is split; by default it goes back to the original payment." }] : []),
      ];
    },
  },

  ai: {
    reasonExample: "Small nail holes are normal wear and tear, not damage the deposit secures",
    inspectorRole: "You inspect rental units at move-out for a Florida landlord's security deposit tool.",
    inspectionGuide: inspectionGuide("Florida Statutes 83.43(14) and 83.52, as applied here (the deposit secures damage caused by the tenant and unpaid obligations; the tenant keeps the unit clean and sanitary and does not damage it; ordinary deterioration from normal use is not a breach; Florida publishes no wear-and-tear guide, so the examples below are common practice):"),
    closeOutSystem: closeOutSystem({
      name: "Florida", items: 12,
      note: "With no deductions, the whole deposit goes back within 15 days after the tenancy ends. With deductions, a notice of intention to impose a claim must have gone by certified mail within 30 days; nothing is deducted until 15 days after the tenant receives it, and the balance goes back within 30 days of the notice. The facts' blockers say where the claim stands.",
    }),
    factsToolDescription: factsTool("15 or 30-day"),
    checklistToolDescription: checklistTool(12, "Florida Statutes 83.49"),
  },
};

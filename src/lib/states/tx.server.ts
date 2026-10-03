// Texas: the half of the pack only the server reads (the statement checklist, the close-out agent's rules and
// prompt, the next-step hooks, the calendar, the tenant page). The rest is in tx.ts, which client components load.

import { addDays, longDate, usd } from "./common";
import {
  checklistTool, claim, closeOutSystem, delivered, disclaimer, evidence, factsTool, grade, inspectionGuide, lines, parties,
  refund, security, shortOf, wear, type ItemSpec,
} from "./common.server";
import { forwardingOf } from "./tx";
import type { ServerPart } from "./types";

const C = (s: string) => `Tex. Prop. Code ${s}`;

const ITEMS: ItemSpec[] = [
  {
    n: 1, title: "Tenant names, unit address, surrender date, the day the written forwarding address arrived, statement date and the 30-day due date",
    short: "Parties, dates and the address", cite: C("92.103(a), 92.107"),
    grade: (s, ctx) => {
      const [st, why] = parties(s);
      const fwd = forwardingOf({ link: s.tenantForwarding?.address, record: ctx.notices.forwarding_address });
      if (st === "missing") return [st, why];
      return fwd ? ["done", `${why} Forwarding address on file: ${fwd}.`] : ["missing", `${why} No written forwarding address yet: the refund and the list are owed once the tenant gives one.`];
    },
  },
  { n: 2, title: "Deposit received: amount, date and how it was paid", short: "Deposit received", cite: C("92.102"), grade: (s) => security(s) },
  { n: 3, title: "One line per deduction: description, amount and basis", short: "One line per deduction", cite: C("92.104(a), (c)"), grade: (s) => lines(s) },
  { n: 4, title: "Wear-and-tear findings listed at $0", short: "Wear and tear at $0", cite: C("92.104(b)"), grade: (s) => wear(s) },
  { n: 5, title: "Evidence attached and labeled as evidence: photos, invoices, labor description", short: "Evidence for each line", cite: C("92.109(c)"), grade: (s) => evidence(true)(s) },
  { n: 6, title: "Balance refunded, method and payees", short: "Refund, method and payees", cite: C("92.104(c)"), grade: (s) => refund(s) },
  { n: 7, title: "If deductions exceed the deposit, the balance stated as a claim, not a demand", short: "Balance stated as a claim", cite: C("92.104(a)"), grade: (s) => claim(s) },
  { n: 8, title: "Delivery record: hand delivery, mail with the postmark date, or email under 92.113", short: "Delivery record", cite: C("92.1041, 92.113"), grade: (s) => delivered(s) },
  { n: 9, title: "The landlord's or agent's name and contact", short: "Who sends it", cite: C("92.112"), grade: (s) => ["done", `${s.landlord} sends the statement.`] },
  {
    n: 10, title: "Rent owed at surrender and undisputed: said so, and the statement sent anyway", short: "Rent owed at surrender", cite: C("92.104(c)(1)-(2)"),
    grade: (s) => (s.deductions.some((d) => d.category === "rent") ? ["done", "Unpaid rent is itemized with the rest; the statement goes out anyway."] : ["not_applicable", "No rent is deducted."]),
  },
  { n: 11, title: "The disclaimer line: templates and records, not legal advice", short: "Not legal advice", cite: "Tex. Gov't Code 81.101(c)", grade: () => disclaimer() },
];

export const TX_SERVER: ServerPart = {
  close: {
    rules: {
      deadline: "Tex. Prop. Code 92.103(a): the deposit is refunded on or before the 30th day after the tenant surrenders the premises.",
      forwarding: "Tex. Prop. Code 92.107(a): the landlord is not obligated to refund or to describe deductions until the tenant gives a written statement of a forwarding address.",
      itemization: "Tex. Prop. Code 92.104(c): when any part is kept, the balance goes with a written description and itemized list of all deductions.",
      wearAndTear: "Tex. Prop. Code 92.104(b): no deduction for normal wear and tear.",
      electronicRefund: "Tex. Prop. Code 92.103(a): Texas names no refund method; a refund that reaches the tenant by the due date satisfies it, and a Payout to another account needs the tenant's written designation (product policy).",
      roommates: "Practice, not Texas law: one refund to the paying account unless every adult tenant signs an allocation.",
      documents: "Tex. Prop. Code 92.109(c): the landlord has the burden of proving the retention reasonable, so each deduction carries photos, an invoice or the labor record.",
      badFaith: "Tex. Prop. Code 92.109(a)-(b), (d): bad-faith retention costs $100 plus three times the amount wrongfully withheld plus fees; missing the 30th day is presumed bad faith; a bad-faith failure to itemize forfeits the right to keep any of it.",
      mail: "Tex. Prop. Code 92.1041: a refund or accounting mailed and postmarked on or before the due date is presumed timely.",
      usefulLife: "Useful-life proration and the paint schedule are common practice, not Texas law.",
      refundWindow: "PayPal policy, not law: a payment can be refunded against itself for 180 days; after that the money goes out as a Payout.",
    },
    extraBlockers: (f, ctx) => {
      if (!f.tenancy.moveOutDate || f.alreadyReturned) return [];
      const fwd = forwardingOf({ link: ctx.forwarding?.address, record: ctx.notices.forwarding_address });
      return fwd ? [] : ["No written forwarding address yet: the refund and the itemized list are not owed until the tenant gives one in writing (Tex. Prop. Code 92.107(a)). Ask through the tenant link, or record one that came by letter, email or text."];
    },
    extraWarnings: () => [],
  },

  steps: {
    flow: {
      doneCite: C("92.103(a), 92.104(c)"),
      sendRefundCite: C("92.103(a)"),
      photosOut: { detail: "Before any repair or cleaning that will be deducted, and again after: the evidence that each deduction is reasonable.", cite: C("92.109(c)") },
      compareCite: C("92.104"),
      deliveryCite: C("92.104(c)"),
      statementDetail: (m) => `Due on or before the 30th day after the ${longDate(m)} surrender, with the written itemized list.`,
      statementCite: C("92.103(a), 92.104(c)"),
      tenantNoticeCite: C("92.107"),
      noDateDetail: "Once the keys are back, the move-out starts the 30-day clock.",
      windowStep: () => "",
      windowCite: "",
      moveOutStep: (ends) => `Planned for ${longDate(ends)}. Record the actual move-out date when possession is surrendered; the 30-day clock starts then.`,
      moveOutCite: C("92.103(a)"),
      invoice: { detail: "For the deposit the lease asks for; Texas sets no cap.", cite: C("92.102") },
      unpaidCite: C("92.102"),
      photosIn: { detail: "", cite: "" },
      leaseEndsCite: C("92.103"),
    },
    moveIn: () => null,
    afterInspection: (t, _today, h) => {
      if (forwardingOf({ link: t.tenantMoveOut?.forwardingAddress, record: t.notices.forwarding_address }) || !t.moveOutDate) return null;
      return {
        ...h.dated("Get the forwarding address in writing", "The refund and the written itemized list are owed once the tenants give a forwarding address in writing. Ask through the tenant link, or record one that came by letter, email or text.",
          C("92.107"), addDays(t.moveOutDate, 30), false, "30th day"),
        action: { label: "Record address", path: "notices/forwarding-address", icon: "pen" },
      };
    },
    openMoveIn: () => [],
  },

  calendar: {
    checkIn: (where, ends) => `The lease at ${where} ends ${longDate(ends)}, 60 days from today. Ask the tenants whether they are staying, and for a forwarding address in writing: the refund waits for it (Tex. Prop. Code 92.107).`,
    window: () => "",
    moveOut: (lead) => `${lead} Photograph the unit before any repair or cleaning: the landlord must prove every deduction reasonable (Tex. Prop. Code 92.109(c)). The 30-day clock for the refund and the itemized list starts at surrender (92.103(a)).`,
    due: {
      label: "Refund and itemized list due, 30 days after move-out",
      summary: (where) => `Deposit refund and itemized list due: ${where}`,
      description: (ends) => `Last day to refund the deposit with a written description and itemized list of deductions: the 30th day after the ${longDate(ends)} surrender, once the tenant has given a written forwarding address (Tex. Prop. Code 92.103(a), 92.107).`,
    },
  },

  statement: {
    checklist: grade(ITEMS),
    short: shortOf(ITEMS),
    checklistTip: "The 11 items a Texas itemized statement needs under the rules spec: Property Code 92.103 to 92.113. Each item's tip says why it is done, missing or not needed here.",
    interest: (city) => {
      const note = "No deposit interest is included: Texas has no deposit interest statute.";
      return { city, known: false, note, checkReason: note };
    },
    interestTitle: "Deposit interest",
    wearAtZero: true,
    basisNote: (t) => {
      const fees = t.otherMoveInCharges.filter((c) => c.refundable === false);
      if (!fees.length) return null;
      return `The lease also lists ${fees.map((c) => `${c.label.toLowerCase()} ${usd(c.amount)}`).join(", ")}, labeled nonrefundable and not part of the deposit held here. A fee that in fact secures performance under the lease is a deposit, however it is labeled (Tex. Prop. Code 92.102).`;
    },
    documentsNote: (_r, total, any) => (!any ? "No repair or cleaning was deducted, so no invoices or labor records apply."
      : `Repair and cleaning deductions total ${usd(total)}. Texas requires a written description and itemized list of the deductions (Prop. Code 92.104(c)), not receipts; the landlord must prove each deduction reasonable (92.109(c)), so the photos, invoices and labor records go with this statement as evidence.`),
    documentsLine: (_r, total) => `Evidence, not required by Texas law: repair and cleaning total ${usd(total)}`,
    documentsCite: () => C("92.104(c), 92.109(c)"),
    refundNote: (r) => [
      r.tenants.length > 1 ? `One refund to the account the deposit came from, for all adult tenants named on the lease (${r.tenants.join(" and ")}); Texas law is silent on several tenants, so this is practice, not statute.` : null,
      r.paid ? "Texas names no refund method. The refund goes back against the deposit payment, and PayPal's refund id and timestamp record the date, since only a mailed refund has a postmark (Tex. Prop. Code 92.103(a), 92.1041)." : null,
    ].filter(Boolean).join(" "),
    refundDueMethod: (r) => (r.paypalEmail ? `PayPal refund of the deposit payment, or a Payout to ${r.paypalEmail} if that payment can't take it, to be sent` : "To be refunded against the deposit payment"),
    sections: {
      security: { title: "Deposit received", cite: C("92.102"), text: "The deposit received: the date it was paid and how. A fee the lease labels nonrefundable is listed apart." },
      deductions: { title: "Deductions", cite: C("92.104(a)-(c)"), text: "A written description and itemized list of every deduction, each with its basis: unpaid rent, damage beyond normal wear and tear, or a charge the lease makes the tenant liable for." },
      refund: C("92.103(a), 92.1041"),
      delivery: { title: "Delivery", cite: C("92.104(c), 92.1041, 92.113"), text: "Hand delivery, or mail to the forwarding address the tenant gave in writing with the postmark recorded; email only on a lease from September 1, 2025 after a prior email exchange." },
    },
    documentRow: { title: "The itemized statement", cite: C("92.103(a), 92.104(c)"), text: "Due with the refund on or before the 30th day after surrender, once the tenant gives a written forwarding address." },
    headerTip: { title: "The itemized statement", cite: "Texas Property Code 92.104(c)", text: "On or before the 30th day after the tenants surrender the premises: the balance of the deposit with a written description and itemized list of all deductions." },
    estimateNote: "Estimate: the work is not finished or the invoice is not in hand yet; the invoice follows when received (practice; Texas sets no estimate rule).",
    estimateLine: "Estimate: the invoice follows when received",
    dueTipText: "The refund and the itemized list are due on or before the 30th day after the tenants surrender the premises.",
    guidanceSource: "as common practice, not Texas law",
    estimateCite: C("92.104(c)"),
    pdf: { deadlineLine: "30 days after surrender, Tex. Prop. Code 92.103(a)", dueSuffix: "30 days after surrender" },
  },

  tenant: {
    detailsTip: { title: "Your deposit", cite: C("92.102, 92.103(a)"), text: "Your deposit comes back, less any lawful deductions, with a written description and itemized list, on or before the 30th day after you move out, once you give your landlord a forwarding address in writing." },
    dueTip: { title: "30 days after you move out", cite: C("92.103(a), 92.107"), text: "On or before the 30th day after you surrender the unit, the landlord refunds the deposit with a written itemized list of any deductions, once you have given a forwarding address in writing." },
    paidLine: "It comes back, less any lawful deductions, within 30 days after you move out and give a forwarding address in writing.",
    documentsTip: () => ({ title: "The itemized list", cite: C("92.104(c)"), text: "Texas requires a written description and itemized list of the deductions. The landlord adds the photos, invoices and labor records as evidence; the PDF lists exactly what it holds." }),
    mailTip: () => ({ title: "Your forwarding address", cite: C("92.107"), text: "Give your landlord a forwarding address in writing: the refund and the itemized list are owed once you do. You never lose the deposit for not giving one." }),
    deliveryCite: C("92.104(c), 92.1041"),
    prorationNote: "Proration by useful life and paint schedules is common practice, not Texas law.",
    agreementTip: ({ agreed }) => ({ title: agreed ? "Your PayPal account" : "How the refund comes back", cite: C("92.103(a)"), text: agreed ? null : "Texas names no refund method. The refund goes back to the PayPal account the deposit came from." }),
    rights: (v) => {
      const st = v.statement;
      return [
        {
          title: "Refund within 30 days", cite: C("92.103(a), 92.104(c)"),
          text: `On or before the 30th day after you move out, the landlord refunds the deposit, less lawful deductions, with a written description and itemized list of them.${v.moveOutDate && v.statementDue ? ` You moved out on ${longDate(v.moveOutDate)}, so the deadline ${st ? "was" : "is"} ${longDate(v.statementDue)}, once you have given a forwarding address in writing.` : ""}`,
        },
        { title: "Give a forwarding address in writing", cite: C("92.107"), text: "The refund and the itemized list are owed once you give the landlord a forwarding address in writing. Not giving one never costs you the deposit." },
        { title: "What can be deducted", cite: C("92.104(a)"), text: "Only damages and charges you are legally liable for under the lease or for breaking it, such as unpaid rent or damage beyond normal wear and tear." },
        { title: "No charge for normal wear and tear", cite: C("92.104(b), 92.001(4)"), text: "Nothing can be deducted for deterioration that comes from normal use of the home, as opposed to negligence, carelessness, accident or abuse." },
        { title: "Bad faith", cite: C("92.109"), text: "A landlord who keeps a deposit in bad faith owes $100, three times the amount wrongfully withheld, and your attorney's fees. Missing the 30th day is presumed bad faith, and the landlord must prove every deduction reasonable." },
        { title: "Your last month's rent", cite: C("92.108"), text: "You may not withhold the last month's rent on the ground that the deposit covers it." },
        ...(v.tenants.length > 1 ? [{ title: "More than one tenant on the lease", cite: "Practice; Tex. Prop. Code 92.104(c)", text: "Texas law doesn't say how a refund is split among tenants; the lease controls. By default it goes back to the account the deposit came from." }] : []),
      ];
    },
  },

  ai: {
    reasonExample: "Small nail holes are normal wear and tear under Tex. Prop. Code 92.001(4)",
    inspectorRole: "You inspect rental units at move-out for a Texas landlord's security deposit tool.",
    inspectionGuide: inspectionGuide("Texas Property Code 92.104(b) and 92.001(4), as applied here (normal wear and tear is deterioration that results from the intended use of a dwelling, not from negligence, carelessness, accident or abuse by the tenant, household or guests; Texas publishes no wear-and-tear guide, so the examples below are common practice):"),
    closeOutSystem: closeOutSystem({
      name: "Texas", items: 11,
      note: "The refund and a written itemized list of deductions are due on or before the 30th day after the tenant surrenders the premises, and are not owed until the tenant gives a written forwarding address. Texas sets no cap and names no refund method.",
    }),
    factsToolDescription: factsTool("30-day"),
    checklistToolDescription: checklistTool(11, "Texas Property Code 92.103 to 92.113"),
  },
};

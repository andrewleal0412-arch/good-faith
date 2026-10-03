// California: the half of the pack only the server reads (the statement checklist, the close-out agent's rules and
// prompt, the next-step hooks, the calendar, the tenant page). The rest is in ca.ts, which client components load.

import { addDays, longDate, pacificDate } from "../dates";
import { describeDelivery } from "../delivery";
import { totalSecurity } from "../rules";
import type { ChecklistItem, ChecklistState, Statement } from "../statement";
import { RECEIPT_THRESHOLD } from "./ca";
import type { ServerPart, StatementContext } from "./types";

const usd = (n: number) => `$${n.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;

// D28: the only local deposit-interest rules on record here (LEGAL_RULES sources S10-S13). The statement says whether
// the city is one of these and nothing more; the rates change every year and are not computed.
const INTEREST_CITIES: { match: RegExp; note: string }[] = [
  { match: /^san\s+francisco$/i, note: "San Francisco requires interest on security deposits (S.F. Admin. Code ch. 49)." },
  { match: /^los\s+angeles$/i, note: "Los Angeles requires interest on security deposits for units under its Rent Stabilization Ordinance (LAMC 151.06.02)." },
  { match: /^berkeley$/i, note: "Berkeley requires interest on security deposits (BMC 13.76.070)." },
  { match: /^west\s+hollywood$/i, note: "West Hollywood requires interest on security deposits (WHMC 17.32.020)." },
];

const KNOWN_CITIES = "San Francisco, Los Angeles RSO units, Berkeley and West Hollywood";

function localInterest(city: string | null): Statement["interest"] {
  const hit = city ? INTEREST_CITIES.find((c) => c.match.test(city.trim())) : null;
  if (hit) {
    return {
      city, known: true,
      note: `${hit.note} Under that ordinance unpaid interest is due with the deposit at move-out. The rate and the period the deposit was held come from the city's rent program and are not included in this statement.`,
      checkReason: `${hit.note} This tool does not compute it; the rate and the period the deposit was held come from the city's rent program.`,
    };
  }
  const note = `No local deposit interest is included. California has no statewide requirement, and ${city ?? "the property's city"} is not among the cities with a security deposit interest ordinance on record here (${KNOWN_CITIES}).`;
  return { city, known: false, note, checkReason: note };
}

/** The 13 items of LEGAL_RULES section B, each done, missing or not applicable, with a one-line reason. */
function checklist(s: Statement, ctx: StatementContext): ChecklistItem[] {
  const moveInPhotosRequired = ctx.moveInPhotosRequired;
  const out: ChecklistItem[] = [];
  const item = (n: number, title: string, cite: string, state: ChecklistState, reason: string) => out.push({ n, title, cite, state, reason });
  const list = (xs: string[]) => xs.join(", ");
  const plural = (n: number, word: string) => `${n} ${word}${n === 1 ? "" : "s"}`;
  const docsNotRequired = `Not required: repair and cleaning deductions total ${usd(RECEIPT_THRESHOLD)} or less.`;
  const repairs = s.deductions.filter((d) => d.category !== "rent");

  // 1. Parties and dates.
  const missing1 = [!s.tenants.length ? "tenant names" : null, !s.property.address ? "unit address" : null, !s.moveOutDate ? "move-out date" : null].filter(Boolean) as string[];
  item(1, "Tenant names, unit address, move-out date, statement date and the 21-day deadline", "(h)(1)",
    missing1.length ? "missing" : "done",
    missing1.length ? `Still needed: ${list(missing1)}.` : `${list(s.tenants)}; moved out ${longDate(s.moveOutDate!)}; statement dated ${longDate(s.statementDate)}; due ${longDate(s.statementDue!)}.`);

  // 2. Security received.
  item(2, "Security received and its basis", "(h)(1), (b)",
    s.security?.paid ? "done" : "missing",
    s.security?.paid
      ? `${usd(s.security.amount)} paid ${s.security.paidAt ? longDate(pacificDate(s.security.paidAt)) : ""} through PayPal invoice ${s.security.invoiceId}${s.security.basisNote ? "; how the lease labeled the security is explained" : ""}.`
      : s.security ? `PayPal invoice ${s.security.invoiceId} is ${s.security.invoiceStatus.toLowerCase().replace(/_/g, " ")}, not paid.` : "No deposit was collected through PayPal for this tenancy.");

  // 3. One line per deduction, tagged.
  item(3, "One line per deduction, tagged (b)(1) rent, (b)(2) damage or (b)(3) cleaning", "(b), (h)(1)",
    s.deductions.length ? "done" : "not_applicable",
    s.deductions.length ? `${plural(s.deductions.length, "deduction")}, each tagged: ${list(s.deductions.map((d) => d.tag))}.`
      : s.totals.depositHeld === 0 ? "No deductions, and no security was collected through PayPal." : "No deductions; the whole security is refunded.");

  // 4. Own labor.
  const labor = s.deductions.filter((d) => d.labor);
  const laborShort = labor.filter((d) => !d.labor!.description || d.labor!.hours == null || d.labor!.hourlyRate == null);
  item(4, "Landlord or employee labor: description, time and hourly rate", "(h)(2)(A)",
    !labor.length ? "not_applicable" : !laborShort.length ? "done" : s.documents.required ? "missing" : "not_applicable",
    !labor.length ? "No deduction is for the landlord's own labor."
      : !laborShort.length ? `${plural(labor.length, "item")} with the work described, the hours and the rate.`
        : s.documents.required ? `Still needed for ${list(laborShort.map((d) => d.item))}: description, hours and rate.` : docsNotRequired);

  // 5. Vendors. An estimate ((h)(3)) stands in for the invoice until it arrives; the vendor's contact is required either way.
  const vendors = s.deductions.filter((d) => d.vendor);
  const vendorShort = vendors.filter((d) => (!d.vendor!.invoicePath && !d.isEstimate) || !d.vendor!.name || !d.vendor!.address || !d.vendor!.phone);
  const invoiced = vendors.filter((d) => d.vendor!.invoicePath).length;
  item(5, "Outside vendors: copy of the invoice, with the vendor's name, address and phone", "(h)(2)(B)",
    !vendors.length ? "not_applicable" : !vendorShort.length ? "done" : s.documents.required ? "missing" : "not_applicable",
    !vendors.length ? "No deduction is for a vendor's work."
      : !vendorShort.length
        ? `${plural(vendors.length, "vendor")}, each with name, address and phone (${list(vendors.map((d) => d.vendor!.name!))}); ${plural(invoiced, "invoice")} on file${vendors.length > invoiced ? `, ${plural(vendors.length - invoiced, "estimate")} with the invoice to follow` : ""}.`
        : s.documents.required ? `Still needed for ${list(vendorShort.map((d) => d.item))}: ${list([...new Set(vendorShort.flatMap((d) => d.missing))])}.` : docsNotRequired);

  // 6. Materials. The tool records vendor invoices and own labor; a separate materials receipt is not modeled.
  item(6, "Materials: receipt, or a vendor price list for stock items", "(h)(2)(C)", "not_applicable",
    vendors.length ? "No materials were bought separately; materials on a vendor's invoice are covered by item 5." : "No materials were bought separately.");

  // 7. Photos and the written cost explanation. An estimate's repair is not finished, so it has no after photo yet.
  const photoShort = repairs.map((d) => {
    const need: string[] = [];
    if (moveInPhotosRequired && !d.photos.some((p) => p.role === "move_in")) need.push("move-in photo");
    if (!d.photos.some((p) => p.role === "move_out_before")) need.push("before photo");
    if (!d.isEstimate && !d.photos.some((p) => p.role === "move_out_after")) need.push("after photo");
    if (!d.explanation) need.push("cost explanation");
    return [d, need] as const;
  }).filter(([, need]) => need.length);
  const estimates = repairs.filter((d) => d.isEstimate);
  item(7, `Every repair or cleaning deduction: before and after photos${moveInPhotosRequired ? ", the move-in photo" : ""} and a written cost explanation`, "(g), (h)(2)(D)",
    !repairs.length ? "not_applicable" : photoShort.length ? "missing" : "done",
    !repairs.length ? "No repair or cleaning was deducted."
      : photoShort.length ? photoShort.map(([d, need]) => `${d.item}: ${list(need)}`).join("; ") + "."
        : estimates.length
          ? `${plural(repairs.length, "item")}, each with ${moveInPhotosRequired ? "move-in and " : ""}before photos on file and the cost explained; after photos for the ${plural(repairs.length - estimates.length, "finished repair")}, none yet for the ${plural(estimates.length, "estimate")}.`
          : `${plural(repairs.length, "item")}, each with ${moveInPhotosRequired ? "move-in, " : ""}before and after photos on file and the cost explained.`);

  // 8. Estimates: a vendor's estimate needs the vendor's name, address and phone; the landlord's own unfinished repair has no vendor.
  const estShort = estimates.filter((d) => d.vendor && (!d.vendor.name || !d.vendor.address || !d.vendor.phone));
  item(8, "Good-faith estimates marked as such, with the vendor's contact and the 14-day follow-up", "(h)(3)",
    !estimates.length ? "not_applicable" : estShort.length ? "missing" : "done",
    !estimates.length ? "No deduction is an estimate; every cost is final."
      : estShort.length ? `Still needed for ${list(estShort.map((d) => d.item))}: the vendor's name, address and phone.`
        : `${plural(estimates.length, "estimate")} marked${estimates.some((d) => d.vendor) ? ", with the vendor's name, address and phone" : ""}; the final cost and documents follow within 14 days of completion or receipt.`);

  // 9. The $125 notice.
  item(9, "If documents are left out because deductions total $125 or less, say so and note the 14-day request right", "(h)(4)-(5)",
    !repairs.length ? "not_applicable" : s.documents.required ? "not_applicable" : "done",
    !repairs.length ? "No repair or cleaning was deducted."
      : s.documents.required ? `Repair and cleaning deductions total ${usd(s.totals.repairAndCleaning)}, over ${usd(RECEIPT_THRESHOLD)}, so the documents go with the statement instead.`
        : "The statement says the documents are not required and that the tenant may request them within 14 days.");

  // 10. Refund amount, method and payees.
  const needsAgreement = !!s.security?.electronic && !s.refund.agreement && s.refund.state !== "none";
  item(10, "Refund amount, method and payees", "(h)(1)(A), (h)(1)(C)",
    needsAgreement ? "missing" : "done",
    needsAgreement ? "The security was paid electronically, so the refund goes electronically, and by PayPal only with the tenants' written agreement, which is not on file."
      : s.refund.state === "sent" ? `${usd(s.refund.amount)} sent by ${s.refund.method} (${s.refund.paypalId}) on ${longDate(pacificDate(s.refund.sentAt!))}, payable to ${list(s.refund.payees)}.`
        : s.refund.state === "due" ? `${usd(s.refund.amount)} by ${s.refund.method}, payable to ${list(s.refund.payees)}.`
          : s.refund.method);

  // 11. Local interest.
  item(11, "Local deposit interest, with the rate and period, if the city requires it", "local ordinances (S10-S13)",
    s.interest.known ? "missing" : "not_applicable", s.interest.checkReason);

  // 12. Balance claimed.
  item(12, "If deductions exceed the deposit, the balance claimed, stated as a claim and not a demand", "(e)(1); DRE guide",
    s.balanceClaimed ? "done" : "not_applicable",
    s.balanceClaimed ? `${usd(s.balanceClaimed.amount)} is stated as a claim, not a demand for payment.` : "The deductions do not exceed the security held.");

  // 13. Delivery.
  item(13, "Delivery record: personal delivery, first-class mail to the forwarding address (else the unit), or email under a written agreement", "(h)(1)(B), (h)(6)",
    s.delivery ? "done" : "missing",
    s.delivery ? `Delivered by ${describeDelivery(s.delivery)}.` : "Record how and when the statement was delivered, once it goes out.");

  return out;
}

const GUIDE = `California Civil Code 1950.5 and the DRE's California Tenants guide (2026), as applied here:
- A deposit may cover damage beyond ordinary wear and tear, and cleaning only back to the cleanliness at move-in.
- Never chargeable (ordinary wear and tear): faded or lightly scuffed paint, paint worn behind furniture, a few small
  nail or pin holes, minor nicks, carpet worn or matted from normal traffic, moderate carpet spotting, drapes or blinds
  faded or loose from age, grime that predates this tenancy.
- Chargeable damage: a large number of holes or large holes/gouges in walls, carpet rips, burns, pet urine or other
  indelible stains, blinds snapped or torn, broken fixtures, chewed trim.
- Chargeable cleaning: a dirty oven or range, greasy surfaces, mildew, unwashed floors, decals, fleas, left-behind trash,
  but only beyond how clean it was at move-in.
- Professional carpet cleaning is chargeable only when needed to restore move-in condition, never as a routine charge.
Report only what the photos show. If lighting or angle makes it uncertain, say "unclear".`;

const SYSTEM = `You are the close-out agent in Good Faith, which helps small California landlords return security deposits correctly. You work for the landlord and you are fair to the tenant.

For this move-out:
1. Call get_close_out_facts. It comes from the rules engine and is authoritative for amounts, dates and the refund plan.
2. If it lists blockers, stop: in two or three sentences, tell the landlord what's blocking and what to do next. Don't call any PayPal tool. One exception: when the only blocker is that the deposit was already returned, the money is done, so skip to step 6.
3. Confirm the deposit with PayPal: call get_invoice for the deposit invoice and check that it is PAID and that its transaction id matches the facts.
4. Return the money on the plan's rail, for exactly the plan's amount:
   - refund_original_payment: call create_refund with capture_id set to the plan's captureId, amount {"currency_code": "USD", "value": the amount with two decimals}, invoice_id set to the deposit invoice id, and a note_to_payer under 200 characters saying this is the security deposit refund less itemized deductions and that the itemized statement follows.
   - payout: call send_payout to the plan's email.
   - nothing_to_refund: don't move any money.
   The landlord approves every money movement before it runs. Call a money tool once, and never retry it with a different amount.
5. After a refund goes through, call get_refund to confirm its status.
6. Call get_statement_checklist. It grades the itemized statement against the 13 items the rules spec asks for, says what is still missing, and whether its delivery was recorded.
7. Finish with a short summary for the landlord: what was returned and how, the deductions, the statement deadline, and what the statement still needs before it is delivered (the checklist's stillMissing, in plain words). If nothing is missing, say the statement is complete and ready to deliver by the deadline. The landlord opens the statement with the "Open the itemized statement" button on this page, so never quote a path or link. Give every date as a full date, such as October 1, 2026, never "today" or "yesterday".

Before each tool call, say in one short sentence what you're about to check or do. Your text is shown as plain text, so write plain sentences for a non-lawyer with no markdown at all: no asterisks, no headings, no numbered or bulleted lists, no emojis. Keep the final summary to one or two short paragraphs.

Cite only the citations in the facts' "rules", word for word, and only where they apply. Never cite a code section from memory. Don't give legal advice beyond those rules. If a tool returns an error or says "Blocked", explain it to the landlord and stop.`;

export const CA_SERVER: ServerPart = {
  close: {
    /** The only citations the agent may use. It cites from this list, never from memory (it mixed up (g) and (h)). */
    rules: {
      deadline: "Civ. Code 1950.5(h)(1): the itemized statement and the refund are due within 21 days after the tenant vacates.",
      electronicRefund: "Civ. Code 1950.5(h)(1)(A): when the landlord received the deposit or the rent electronically, the deposit is refunded electronically, and by PayPal only if the tenant agreed in writing.",
      roommates: "Civ. Code 1950.5(h)(1)(C): one refund for all adult tenants unless every adult signed an allocation agreement.",
      documents: "Civ. Code 1950.5(h)(2): the statement includes invoices or receipts, labor time and hourly rate, and the photos, unless repair and cleaning deductions total $125 or less ((h)(4)).",
      photos: "Civ. Code 1950.5(g)(2): photos of each item before and after the repair or cleaning that is deducted.",
      estimate: "Civ. Code 1950.5(h)(3): if a repair isn't finished or a document isn't in hand within the 21 days, the statement deducts a good-faith estimate with the vendor's contact details, and the final documents follow within 14 days of completion or receipt.",
      delivery: "Civ. Code 1950.5(h)(1)(B) and (h)(6): the statement goes by personal delivery or first-class mail to the address the tenant provided, or to the vacated unit if none; email only if the landlord and tenant agreed to it in writing.",
      wearAndTear: "Civ. Code 1950.5(b)(2) and (e)(1)-(2): ordinary wear and tear and conditions that predate the tenancy can't be deducted.",
      badFaith: "Civ. Code 1950.5(h)(7) and (m): bad-faith retention can cost up to twice the deposit in statutory damages.",
      usefulLife: "Useful-life proration and the paint schedule come from the DRE's California Tenants guide. They are guidance, not statute.",
      refundWindow: "PayPal policy, not law: a payment can be refunded against itself for 180 days; after that the money goes out as a Payout.",
    },
    extraBlockers: () => [],
    extraWarnings: () => [],
  },

  steps: {
    flow: {
      doneCite: "Civ. Code 1950.5(h)(1)",
      sendRefundCite: "Civ. Code 1950.5(h)(1)",
      photosOut: { detail: "Before any repair or cleaning that will be deducted, and again after. They go with the statement.", cite: "Civ. Code 1950.5(g)(2)" },
      compareCite: "Civ. Code 1950.5(h)(1)",
      deliveryCite: "Civ. Code 1950.5(h)(1)(B)",
      statementDetail: (moveOut) => `Due 21 calendar days after the ${longDate(moveOut)} move-out.`,
      statementCite: "Civ. Code 1950.5(h)(1)",
      tenantNoticeCite: "Civ. Code 1950.5(f)(1)",
      noDateDetail: "It sets the inspection window and, once the keys are back, the 21-day clock.",
      windowStep: (windowOpens) => `If the tenants request an initial inspection, it may happen from ${longDate(windowOpens)}, with 48 hours' written notice of the date and time.`,
      windowCite: "Civ. Code 1950.5(f)(1)",
      inspectionStep: (noticeGivenOn, windowOpens) => `In writing, within a reasonable time after the ${longDate(noticeGivenOn)} notice: the tenants' option to request an initial inspection and to be present${windowOpens ? `. The inspection may happen from ${longDate(windowOpens)}` : ""}.`,
      inspectionAction: false, // California's steps link by their label
      moveOutStep: (ends) => `Planned for ${longDate(ends)}. Record the actual move-out date when possession is returned; the 21-day clock starts then.`,
      moveOutCite: "Civ. Code 1950.5(h)(1)",
      invoice: { detail: "For the lawful amount: the agent caps it at the legal maximum.", cite: "Civ. Code 1950.5(c)" },
      unpaidCite: "Civ. Code 1950.5(c)",
      photosIn: { detail: "Required immediately before or at the start of a tenancy that began on or after July 1, 2025. Without them, deductions are hard to support at move-out.", cite: "Civ. Code 1950.5(g)(1)" },
      leaseEndsCite: "Civ. Code 1950.5(f)(1)",
    },
    moveIn: () => null,
    afterInspection: () => null,
    openMoveIn: () => [],
  },

  calendar: {
    checkIn: (where, ends) => `The lease at ${where} ends ${longDate(ends)}, 60 days from today. Ask the tenants whether they are staying. Once either side gives notice, the initial-inspection notice (Civ. Code 1950.5(f)(1)) and, if the deposit or rent was paid electronically, the electronic-refund notice ((h)(1)(A)(ii)(II)) follow.`,
    window: (ends) => `From today the tenants may have their initial inspection, if they requested one: no earlier than two weeks before the tenancy ends on ${longDate(ends)}, with at least 48 hours' written notice of the date and time (Civ. Code 1950.5(f)(1)).`,
    moveOut: (lead) => `${lead} Photograph the unit within a reasonable time after possession is returned, before any repair or cleaning (Civ. Code 1950.5(g)(2)). The 21-day clock for the itemized statement and the refund starts at move-out ((h)(1)).`,
    due: {
      label: "Statement and refund due, 21 days after move-out",
      summary: (where) => `Deposit statement and refund due: ${where}`,
      description: (ends) => `Last day to furnish the itemized statement and return the rest of the security deposit: 21 calendar days after the ${longDate(ends)} move-out (Civ. Code 1950.5(h)(1)).`,
    },
  },

  statement: {
    checklist,
    short: {
      1: "Parties, dates and deadline", 2: "Security received and its basis", 3: "One tagged line per deduction",
      4: "Labor: work, hours and rate", 5: "Vendor invoices and contacts", 6: "Materials receipts", 7: "Photos and cost explanation",
      8: "Estimates marked as such", 9: "Documents notice, $125 or less", 10: "Refund, method and payees",
      11: "Local deposit interest", 12: "Balance stated as a claim", 13: "Delivery record",
    },
    checklistTip: "The 13 items an itemized statement needs under the rules spec: Civ. Code 1950.5(h), local deposit-interest ordinances and DRE guidance. Each item's tip says why it is done, missing or not needed here.",
    interest: (city) => localInterest(city),
    interestTitle: "Local deposit interest",
    wearAtZero: false,
    basisNote: (t, amount, l) => {
      if (!(t.otherMoveInCharges.length || (t.securityDeposit != null && t.securityDeposit !== amount))) return null;
      const parts = [t.securityDeposit ? `deposit ${usd(t.securityDeposit)}` : null,
        ...t.otherMoveInCharges.map((c) => `${c.label.toLowerCase()} ${usd(c.amount)}`)].filter(Boolean).join(", ");
      let note = `The lease asked for ${usd(totalSecurity(t))} at the start of the tenancy (${parts}). Everything charged at the start of a tenancy except first month's rent counts as security, however it is labeled (Civ. Code 1950.5(b)).`;
      if (l && l.cap != null && l.charged > l.cap) {
        const twoMonths = t.monthlyRent != null && l.cap > t.monthlyRent;
        note += ` The cap for this tenancy is ${usd(l.cap)}, so ${usd(amount)} was collected (Civ. Code 1950.5(c)(1)${twoMonths ? ", (c)(5)" : ""}).`;
      }
      return note;
    },
    documentsNote: (required, total, anyRepairs) => (!anyRepairs
      ? "No repair or cleaning was deducted, so no invoices, receipts or labor records apply."
      : required
        ? `Repair and cleaning deductions total ${usd(total)}, more than ${usd(RECEIPT_THRESHOLD)}, so the law requires the invoices and receipts, the labor records and the photos with this statement (Civ. Code 1950.5(h)(2)).`
        : `Repair and cleaning deductions total ${usd(total)}, which is ${usd(RECEIPT_THRESHOLD)} or less, so the invoices, receipts and labor records are not required with this statement. The tenant may request them within 14 days of receiving this statement, and the landlord then has 14 days to provide them (Civ. Code 1950.5(h)(4)-(5)).`),
    documentsLine: (required, total) => (required
      ? `Required: repair and cleaning total ${usd(total)}, over ${usd(RECEIPT_THRESHOLD)}`
      : `Not required: repair and cleaning total ${usd(total)}, ${usd(RECEIPT_THRESHOLD)} or less`),
    documentsCite: (required) => (required ? "Civ. Code 1950.5(h)(2)" : "Civ. Code 1950.5(h)(4)-(5)"),
    refundNote: (r) => [
      r.tenants.length > 1 ? `One refund payable to all adult tenants named on the lease (${r.tenants.join(" and ")}); the statement may go to any one of them (Civ. Code 1950.5(h)(1)(C)).` : null,
      !r.paid ? null
        : r.electronic
          ? r.signed
            ? `The security was paid electronically, so it is refunded electronically: by PayPal under ${r.signed} (Civ. Code 1950.5(h)(1)(A)).`
            : "The security was paid electronically, so it is refunded electronically to an account the tenant designates; PayPal needs the tenant's written agreement (Civ. Code 1950.5(h)(1)(A))."
          : r.signed
            ? `The security was recorded as paid by ${r.paidBy}. The refund goes by PayPal under ${r.signed}, a method the parties agreed to in writing; an electronic refund is also required when rent was paid electronically (Civ. Code 1950.5(h)(1)(A)).`
            : `The security was recorded as paid by ${r.paidBy}. The refund goes by personal delivery or first-class mail check, electronically if rent was paid electronically, or by a method agreed to in writing; PayPal needs the tenant's written agreement (Civ. Code 1950.5(h)(1)(A)).`,
    ].filter(Boolean).join(" "),
    refundDueMethod: (r) => (r.paypalEmail ? `Electronic refund by PayPal to ${r.paypalEmail}, to be sent`
      : r.electronic ? "To be sent electronically; no refund method is on file"
        : "To be sent by personal delivery or first-class mail check, or by a method agreed to in writing"),
    sections: {
      security: { title: "Security received", cite: "Civ. Code 1950.5(h)(1), (b)", text: "The security received and its basis: the date it was paid and any part the lease labeled a fee or advance rent." },
      deductions: { title: "Deductions", cite: "Civ. Code 1950.5(b), (h)(2)", text: "One line per deduction, each tagged unpaid rent, damage beyond ordinary wear and tear, or cleaning to the move-in level, with the documents behind it." },
      refund: "Civ. Code 1950.5(h)(1)(A), (h)(1)(C)",
      delivery: { title: "Delivery", cite: "Civ. Code 1950.5(h)(1)(B), (h)(6)", text: "Personal delivery or first-class mail to the address the tenant gave, or to the vacated unit if none; email only if the landlord and tenant agreed to it in writing." },
    },
    documentRow: { title: "The itemized statement", cite: "Civ. Code 1950.5(h)(1)-(2)", text: "Due with the refund within 21 days after move-out, with the photos, invoices and receipts the deductions rely on." },
    headerTip: { title: "The itemized statement", cite: "California Civil Code 1950.5(h)", text: "Within 21 days after the tenants leave: the basis, amount and disposition of the security, and the refund of what remains." },
    estimateNote: "Good-faith estimate: the work is not finished or the invoice is not in hand yet. The final cost and documents follow within 14 days of completion or receipt (Civ. Code 1950.5(h)(3)).",
    estimateCite: "Civ. Code 1950.5(h)(3)",
    estimateLine: "Good-faith estimate: the final cost and documents follow within 14 days of completion or receipt",
    dueTipText: "The statement and the refund are due within 21 calendar days after the tenants leave.",
    guidanceSource: "from the DRE's California Tenants guide",
    pdf: { deadlineLine: "21 days after move-out, Civ. Code 1950.5(h)(1)", dueSuffix: "21 days after move-out" },
  },

  tenant: {
    detailsTip: { title: "Your deposit", cite: "Civ. Code 1950.5(c), (h)(1)", text: "Everything charged at the start of the tenancy except first month's rent is security. It comes back, less any lawful deductions, with an itemized statement." },
    dueTip: { title: "21 days after move-out", cite: "Civ. Code 1950.5(h)(1)", text: "Within 21 calendar days after you move out, the landlord gives you an itemized statement of any deductions and returns the rest of the deposit." },
    paidLine: "It comes back, less any lawful deductions, within 21 days after you move out.",
    documentsTip: (required) => (required
      ? { title: "Receipts come with the statement", cite: "Civ. Code 1950.5(h)(2)", text: "Repair and cleaning deductions total more than $125, so the invoices, receipts, labor records and photos come with the statement. The PDF lists exactly what it holds." }
      : { title: "Receipts on request", cite: "Civ. Code 1950.5(h)(4)-(5)", text: "Repair and cleaning deductions total $125 or less, so those documents are not required with the statement. You may request them within 14 days of receiving it, and the landlord then has 14 days to provide them." }),
    mailTip: (movedOut) => ({ title: "Where the statement goes", cite: "Civ. Code 1950.5(h)(6)", text: `The itemized statement is mailed to the address you give your landlord. If you give none, it goes to the unit you ${movedOut ? "left" : "are leaving"}.` }),
    deliveryCite: "Civ. Code 1950.5(h)(1)(B), (h)(6)",
    prorationNote: "Proration by useful life and paint schedules is published guidance, not statute.",
    agreementTip: ({ agreed, electronic }) => ({
      title: agreed ? "Your refund agreement" : "How the refund comes back",
      cite: "Civ. Code 1950.5(h)(1)(A)",
      text: agreed ? null : electronic
        ? "Because the deposit was paid electronically, it comes back electronically: to an account you designate in writing, or by another electronic method you agree to in writing."
        : "The refund comes by personal delivery or first-class mail check, electronically if you paid rent or the deposit electronically, or by a method you and the landlord agree to in writing.",
    }),
    rights: (v, moveInPhotosRequired) => {
      const a = v.agreement, st = v.statement;
      const signed = a ? `on ${longDate(pacificDate(a.signedAt))}` : "";
      return [
        {
          title: "Statement and refund within 21 days",
          text: `Within 21 calendar days after you move out, the landlord gives you an itemized statement of any deductions and returns the rest of the deposit.${v.moveOutDate && v.statementDue ? ` You moved out on ${longDate(v.moveOutDate)}, so the deadline ${st ? "was" : "is"} ${longDate(v.statementDue)}.` : ""}`,
          cite: "Civ. Code 1950.5(h)(1)",
        },
        {
          title: "What can be deducted",
          text: "Only unpaid rent, damage beyond ordinary wear and tear caused by you or your guests, cleaning that brings the unit back to how clean it was when you moved in, or, if your lease says so, restoring or replacing the landlord's furnishings.",
          cite: "Civ. Code 1950.5(b)(1)-(4)",
        },
        {
          title: "No charge for wear and tear",
          text: "Nothing can be deducted for ordinary wear and tear, for conditions that were already there when you moved in, or for wear that built up over earlier tenancies. Only what is reasonably necessary to restore the unit to its move-in condition may be charged.",
          cite: "Civ. Code 1950.5(e)(1), (e)(2)(A)-(B)",
        },
        {
          // (h)(2)(D) sends the photos only with a repair or cleaning deduction, and (h)(4)(A) lifts that at $125 or less.
          title: "Photos of the unit",
          text: `The landlord photographs the unit ${moveInPhotosRequired ? "at the start of the tenancy, and again " : ""}at move-out before and after any repair or cleaning that is deducted. If any repair or cleaning is deducted, those photos come with the statement, subject to the $125 rule.`,
          cite: moveInPhotosRequired ? "Civ. Code 1950.5(g)(1)-(2), (h)(2)(D)" : "Civ. Code 1950.5(g)(2), (h)(2)(D)",
        },
        {
          title: "Receipts for deductions over $125",
          text: "If repair and cleaning deductions total more than $125, the invoices, receipts, labor records and photos come with the statement. If they total $125 or less, you may ask for them within 14 days of receiving the statement, and the landlord then has 14 days to provide them.",
          cite: "Civ. Code 1950.5(h)(2), (h)(4)-(5)",
        },
        v.deposit?.electronic
          ? {
            title: "How the refund comes back",
            text: `Because the deposit was paid electronically, the rest of it comes back electronically${a ? `. You agreed in writing ${signed} that it comes back by PayPal to ${a.paypalEmail}.` : ", to an account you designate in writing, or by another electronic method you agree to in writing."}`,
            cite: "Civ. Code 1950.5(h)(1)(A)",
          }
          : {
            title: "How the refund comes back",
            text: `The refund comes by personal delivery or first-class mail check, electronically if you paid rent or the deposit electronically, or by a method you and the landlord agreed to in writing${a ? `: you agreed ${signed} that it comes back by PayPal to ${a.paypalEmail}` : ""}.`,
            cite: "Civ. Code 1950.5(h)(1)(A)",
          },
        {
          title: "An inspection before you move out",
          text: "Before you move out, you may ask for an initial inspection and be there for it. It can take place no earlier than two weeks before the tenancy ends, with at least 48 hours' written notice of the date and time. Afterwards the landlord gives you an itemized list of what would be deducted, so you can fix it before you leave.",
          cite: "Civ. Code 1950.5(f)(1), (f)(2)",
        },
        { title: "Where the statement is mailed", text: "The statement is mailed to the address you give the landlord. If you give none, it goes to the unit you left.", cite: "Civ. Code 1950.5(h)(6)" },
        // (h)(1)(C)(i) is the default; the (C)(ii) agreement may send the refund to one adult or divide it, and says how
        // each adult receives the statement. The agreement on file names the account, which is stated as a fact only.
        ...(v.tenants.length > 1 ? [{
          title: "More than one adult on the lease",
          text: `With more than one adult on the lease, the refund is a check payable to all of you and the statement goes to any one of you, unless every adult and the landlord signed a written agreement saying how it is returned, whether to one of you or divided among you, and how each of you receives the statement.${a ? ` The agreement signed by ${a.signedBy.join(" and ")} names the PayPal account the refund goes to.` : ""}`,
          cite: "Civ. Code 1950.5(h)(1)(C)",
        }] : []),
      ];
    },
  },

  ai: {
    reasonExample: null,
    inspectorRole: "You inspect rental units at move-out for a California landlord's security deposit tool.",
    inspectionGuide: GUIDE,
    closeOutSystem: SYSTEM,
    factsToolDescription: "The tenancy's close-out file from the rules engine: move-out date and 21-day deadline, the deposit as PayPal reports it, the tenants' written refund agreement, every deduction with its math and any missing documents, totals, blockers, warnings, and the refund plan the rules allow (rail, amount, and the capture id or email). Call this first.",
    checklistToolDescription: "The itemized statement's completeness: the 13 items of the rules spec's checklist (Civ. Code 1950.5(h), local deposit-interest ordinances and DRE guidance), each done, missing or not applicable with a one-line reason, what is still missing, and whether delivery was recorded. Read-only; call it after the refund, or when the deposit was already returned.",
  },

  // LEGAL_RULES D24 and section D (tenant dispute): lateness alone forfeits nothing; bad faith does. The 21 days cover
  // the statement and the refund ((g)(1)), so the later of the two counts.
  dispute: {
    late: {
      effect: "flag",
      text: "The statement or the refund went out after the 21 days. Late compliance in good faith keeps the right to deduct; bad-faith retention can cost up to twice the deposit.",
      cite: "Civ. Code 1950.5(h)(7), (m)",
    },
    isLate: (c) => ({ late: c.moveOutDate && c.sentOn ? c.sentOn > addDays(c.moveOutDate, 21) : null }),
    evidence: { text: "The landlord carries the burden of proving each deduction reasonable.", cite: "Civ. Code 1950.5(m)" },
    forum: {
      name: "Small claims court", limit: 12500,
      text: "Either side may take a deposit dispute to small claims court, for up to $12,500. The courts' guide explains how.",
      cite: "Civ. Code 1950.5(o); Code Civ. Proc. 116.221",
    },
    lineBar: null,
    // D10: professional cleaning only when reasonably necessary to reach move-in condition.
    cleaningRule: (d) => (d.category === "cleaning" && d.performer === "vendor"
      ? { text: "A professional cleaning charge is allowed only when it was reasonably necessary to return the unit to how clean it was at move-in, apart from ordinary wear and tear.", cite: "Civ. Code 1950.5(e)(2)(C)" }
      : null),
    // D22, D24, section D and uncertainty 4: a missing document weakens the claim; good-faith late compliance keeps it.
    documentsCure: {
      text: "Until the landlord supplies them, nothing on file supports the charge. Supplying them late in good faith keeps the right to deduct it.",
      cite: "Civ. Code 1950.5(h)(2); Granberry v. Islay Investments (1995) 9 Cal.4th 738",
    },
    sendNote: null,
  },
};

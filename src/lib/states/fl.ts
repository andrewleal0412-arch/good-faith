// Florida: Florida Statutes Chapter 83, Part II (the Florida Residential Landlord and Tenant Act), s. 83.49, as amended
// by ch. 2025-16 (effective 2025-07-01), with s. 83.43, 83.505, 83.491 and 83.425. Source of truth: docs/rules/FL.md
// (rule ids F1 to F30, verified on 2026-10-03). No cap; the deposit held in a separate Florida account or under a bond;
// a holding notice for landlords of five or more units; and two paths at move-out: the deposit back within 15 days, or
// a notice of intention to impose a claim by certified mail within 30 days in the statute's words, the tenant's 15
// days to object, and the balance within 30 days of the notice. A late notice forfeits the claim and any setoff; a
// timely objection leaves the claim disputed, not deducted (F12). Not yet in code: F1, F13, F21, F23 (docs/rules/README.md,
// Known gaps).

import { refundableSecurity, type Flag, type LeaseTerms } from "../rules";
import { addDays, longDate, MAIL_METHODS, plural, RECEIVED, usd } from "./common";
import type { Notices } from "../notices";
import type { ClientPack, ClockInput } from "./types";

const F = (s: string) => `Fla. Stat. ${s}`;

/** The disclosure s. 83.49(2)(d) puts in the holding notice, word for word, as the 2026 Florida Statutes print it
 *  (amended by ch. 2025-16), read from https://www.flsenate.gov/Laws/Statutes/2026/83.49 on 2026-10-03. */
export const FL_HOLDING_DISCLOSURE = [
  "YOUR RENTAL AGREEMENT REQUIRES PAYMENT OF CERTAIN DEPOSITS. THE LANDLORD MAY TRANSFER ADVANCE RENTS TO THE LANDLORD'S ACCOUNT AS THEY ARE DUE AND WITHOUT NOTICE. WHEN YOU MOVE OUT, YOU MUST GIVE THE LANDLORD YOUR NEW ADDRESS SO THAT THE LANDLORD CAN SEND YOU NOTICES REGARDING YOUR DEPOSIT. THE LANDLORD MUST PROVIDE YOU WRITTEN NOTICE IN PERSON, BY MAIL, OR BY E-MAIL IN ACCORDANCE WITH SECTION 83.505, FLORIDA STATUTES, WITHIN 30 DAYS AFTER YOU MOVE OUT, OF THE LANDLORD'S INTENT TO IMPOSE A CLAIM AGAINST THE DEPOSIT. IF YOU DO NOT REPLY TO THE LANDLORD STATING YOUR OBJECTION TO THE CLAIM WITHIN 15 DAYS AFTER RECEIPT OF THE LANDLORD'S WRITTEN NOTICE, THE LANDLORD WILL COLLECT THE CLAIM AND MUST MAIL YOU THE REMAINING DEPOSIT, IF ANY.",
  "IF THE LANDLORD FAILS TO TIMELY PROVIDE YOU NOTICE, THE LANDLORD MUST RETURN THE DEPOSIT BUT MAY LATER FILE A LAWSUIT AGAINST YOU FOR DAMAGES. IF YOU FAIL TO TIMELY OBJECT TO A CLAIM, THE LANDLORD MAY COLLECT FROM THE DEPOSIT, BUT YOU MAY LATER FILE A LAWSUIT CLAIMING A REFUND.",
  "YOU SHOULD ATTEMPT TO INFORMALLY RESOLVE ANY DISPUTE BEFORE FILING A LAWSUIT. GENERALLY, THE PARTY IN WHOSE FAVOR A JUDGMENT IS RENDERED WILL BE AWARDED COSTS AND ATTORNEY FEES PAYABLE BY THE LOSING PARTY.",
  "THIS DISCLOSURE IS BASIC. PLEASE REFER TO PART II OF CHAPTER 83, FLORIDA STATUTES, TO DETERMINE YOUR LEGAL RIGHTS AND OBLIGATIONS.",
];

/** The 15 and 30 days run "after the termination of the rental agreement" in a sentence that opens "upon the vacating
 *  of the premises": the app counts from the earlier of the move-out and the termination (open question 1). */
export const flClockStart = (c: ClockInput): string | null => {
  if (!c.moveOutDate) return null;
  const termination = c.plannedMoveOut ?? c.endDate ?? c.moveOutDate;
  return termination < c.moveOutDate ? termination : c.moveOutDate;
};

/** The day the tenant received the claim notice: the certified-mail delivery date, or, by s. 83.505 email, the day it
 *  was sent (83.505(4)). Null until the delivery date is recorded. */
export const receivedOn = (n: { method: string; date: string; received?: string | null }) => n.received ?? (n.method === "email" ? n.date : null);

/** F11, F12: the tenant's written objection, and whether it came within 15 days after the tenant received the claim
 *  notice. Null with no objection on record; `timely` is null until the day of receipt is recorded. The date on record
 *  is the day the objection arrived; the statute says "objects", so one sent in time and received late may still
 *  count, which the late wording says. */
export function objectionOf(n: Notices): { date: string; last: string | null; timely: boolean | null } | null {
  const o = n.claim_objection;
  if (!o) return null;
  const got = n.claim_notice ? receivedOn(n.claim_notice) : null;
  const last = got ? addDays(got, 15) : null;
  return { date: o.date, last, timely: last ? o.date <= last : null };
}

function evaluate(t: LeaseTerms): Flag[] {
  const flags: Flag[] = [];
  const rent = t.monthlyRent;
  const deposit = refundableSecurity(t);
  flags.push({
    id: "F3", severity: "info", note: true, title: "No deposit cap in Florida",
    detail: `Florida sets no limit on a deposit or advance rent. The lease's deposit, ${usd(deposit)}${rent ? `, is ${Math.round((deposit / rent) * 100) / 100} months' rent` : ""}; it is shown for information only.`,
    cite: F("83.49"), fact: `${usd(deposit)}${rent ? `, ${Math.round((deposit / rent) * 100) / 100} months' rent` : ""}`,
  });
  for (const q of t.nonrefundableLanguage) {
    flags.push({
      id: "F24", severity: "violation", title: "Clause waiving deposit rights is void",
      detail: "A lease provision is void to the extent it waives or precludes the rights, remedies or requirements of Part II. A clause calling the deposit nonrefundable or forfeited at signing, or shortening the 15 and 30 days, doesn't hold.",
      cite: F("83.47(1)"), quote: q, fact: "Labeled nonrefundable",
    });
  }
  for (const c of t.otherMoveInCharges.filter((x) => x.refundable === false)) {
    flags.push({
      id: "F2", severity: "warning", title: `"${c.label}" may be deposit money`,
      detail: "Deposit money includes damage, security, pet and advance rent deposits, however labeled. A fee labeled nonrefundable that in fact secures performance under the rental agreement may be a deposit; confirm what it is for. The deposit invoice leaves it out.",
      cite: F("83.43(4), (14)"), quote: c.quote, fact: `${c.label}, ${usd(c.amount)}`,
    });
  }
  if (t.lateFee) {
    flags.push({
      id: "J", severity: "warning", title: "Late fee: only as a lease charge",
      detail: "No Florida statute caps a residential late fee. One may come out of the deposit only as a charge the lease makes the tenant liable for, stated as a reason on the claim notice; whether a given fee is enforceable is common law.",
      cite: F("83.43(12), 83.49(3)(a)"), quote: t.lateFee.quote,
      fact: `${t.lateFee.percentOfRent != null ? `${t.lateFee.percentOfRent}% of rent` : t.lateFee.amount != null ? usd(t.lateFee.amount) : "A late fee"}${t.lateFee.deductibleFromDeposit ? ", taken from the deposit" : ""}`,
    });
  }
  flags.push({
    id: "F4", severity: "info", title: "Hold the deposit in a separate Florida account",
    detail: "The deposit goes into a separate account at a Florida financial institution (interest-bearing or not), or under a surety bond, and is never mingled with the landlord's own funds. A PayPal balance next to rent is not that account: move it there and record where.",
    cite: F("83.49(1)"), fact: "Move it out of the PayPal balance",
  });
  const units = t.ownerUnitCount;
  if (units == null) {
    flags.push({ id: "F6", severity: "warning", title: "How many units do you rent?", detail: "A landlord who rents five or more units gives written notice, in the lease or within 30 days of receiving the deposit, of where it is held and whether the tenant gets interest. The lease doesn't say; confirm it.", cite: F("83.49(2)"), fact: "Unit count not in the lease" });
  } else if (units >= 5) {
    flags.push({ id: "F6", severity: "info", title: "Holding notice within 30 days", detail: `You rent ${units} units, so the tenants get written notice, in the lease or within 30 days of the deposit, of where it is held, whether they get interest, and the disclosure of s. 83.49(2)(d).`, cite: F("83.49(2)"), fact: `${units} units rented` });
  }
  flags.push({
    id: "F9", severity: "info", title: "A claim needs a certified-mail notice",
    detail: "To keep any part of the deposit, send a notice of intention to impose a claim, in the statute's words, by certified mail (or email under a signed s. 83.505 addendum) within 30 days after the tenancy ends. Without it the claim and any setoff are forfeited.",
    cite: F("83.49(3)(a)"), fact: "Within 30 days of the end",
  });
  flags.push({
    id: "F13", severity: "info", title: "The tenants' 7-day notice with an address",
    detail: "Tenants who leave give at least 7 days' written notice by certified mail or personal delivery, with an address where they can be reached. The tenant link's moving-out form gives you that address.",
    cite: F("83.49(5)"), fact: "Ask for it before the move-out",
  });
  if (t.tenants.length > 1) {
    flags.push({ id: "G", severity: "info", note: true, title: `${t.tenants.length} adult tenants on the lease`, detail: "The statute holds the deposit for the tenants and names no payee among several. By default the refund goes back to the original payment; a split needs an allocation every adult signs (practice).", cite: F("83.49(1)"), fact: t.tenants.join(", ") });
  }
  const order = { violation: 0, warning: 1, info: 2 } as const;
  return flags.sort((a, b) => order[a.severity] - order[b.severity]);
}

export const FL: ClientPack = {
  code: "FL",
  name: "Florida",
  spec: "docs/rules/FL.md",
  statute: {
    short: "Fla. Stat. 83.49",
    full: "Florida Statutes section 83.49",
    inline: "Florida Statutes section 83.49",
    url: "https://www.flsenate.gov/Laws/Statutes/2026/83.49",
    tagCite: (tag) => tag,
  },
  chip: {
    title: "Florida Statutes section 83.49",
    text: "This property is in Florida, so its deposit follows section 83.49: no cap, the deposit held in a separate Florida account or under a bond, and two paths at move-out: the whole deposit back within 15 days, or a claim notice by certified mail within 30 days, the tenants' 15 days to object, and the balance within 30 days of the notice. A late notice forfeits the claim.",
    cite: "Fla. Stat. 83.49",
  },
  courtsGuide: { label: "FDACS guide", url: "https://www.fdacs.gov/Consumer-Resources/Landlord-Tenant-Law-in-Florida" },

  copy: {
    disclaimers: [
      "This tool organizes your records and fills in templates based on Florida Statutes Chapter 83, Part II, including section 83.49. It does not give legal advice, does not evaluate your specific situation, and is not a substitute for the advice of a Florida attorney.",
      "Items marked Common practice (useful-life proration, paint schedules, joint refunds, the evidence packet) are not in the statute. A court may decide differently.",
      "You decide every deduction and approve every document before it is sent. The tool flags rules; it does not decide disputes.",
      "Florida preempts local rules on security deposits (s. 83.425); former county and city tenant ordinances no longer apply.",
    ],
    preparedUnder: "Prepared with Good Faith from the landlord's records, under Florida Statutes Chapter 83, Part II, section 83.49. It is not legal advice and is not a substitute for the advice of an attorney.",
    noticeFooter: "Prepared with Good Faith from the landlord's records as a template under Florida Statutes section 83.49, completed at the landlord's direction. Forms are not a substitute for the advice of an attorney. It is not legal advice.",
    tenantAbout: "The rules as Florida Statutes section 83.49 states them, with the facts your landlord keeps with Good Faith where they fit. It is not legal advice and does not evaluate your situation.",
    wearRefused: "Normal wear and tear isn't damage the deposit secures (Fla. Stat. 83.43(14), 83.52).",
    statementCite: "Florida Statutes section 83.49(3)",
    guidanceLabel: "Common practice",
    guidanceNote: "Useful-life proration and the paint schedule are common practice, not Florida law. A prorated charge is easier to defend in a suit where the loser pays fees. A court may decide differently.",
    guidanceCite: "Common practice, not statute; Fla. Stat. 83.49(3)(c)",
  },

  lease: {
    evaluate,
    lawful: (t) => {
      const charged = refundableSecurity(t);
      return { amount: charged, cap: null, charged };
    },
    securityTotal: refundableSecurity,
    securityCharge: (c) => c.refundable !== false, // a fee labeled nonrefundable is flagged (F2), not invoiced
    chargeWord: "charge",
    confirmState: true,
    capTip: { title: "No deposit cap", cite: F("83.43(4), 83.49"), text: "Florida sets no limit on a deposit or advance rent. Deposit money is any money held for the tenant, including damage, pet and advance rent deposits; a fee labeled nonrefundable may still be one." },
    capSub: () => "No statewide cap",
    lawfulSub: () => "As the lease asks; no cap",
    law: [
      { label: "Where it is held", line: "A separate Florida account", fact: "The deposit sits in a separate account at a Florida financial institution, or under a surety bond, never mingled with the landlord's funds; landlords of five or more units send a holding notice within 30 days.", cite: F("83.49(1)-(2)") },
      { label: "Claim notice", line: "Certified mail, within 30 days", fact: "To keep any part, a notice of intention to impose a claim in the statute's words goes by certified mail within 30 days after the tenancy ends. Without it the claim and any setoff are forfeited.", cite: F("83.49(3)(a)") },
      { label: "15 or 30 days", line: "Refund, or the balance after a claim", fact: "With no claim, the deposit goes back within 15 days. With one, the tenant has 15 days after receiving the notice to object, and the balance goes back within 30 days of the notice.", cite: F("83.49(3)(a)-(b)") },
    ],
    steps: [
      { title: "Check the lease", text: "Claude pulls out the deposit terms and the app flags what Part II asks: void waivers, fees that may be deposits, the holding rules and the claim notice to come.", cite: F("83.43, 83.47, 83.49(1)-(2)") },
      { title: "Collect the deposit", text: "The tenants name their PayPal account and pay a PayPal invoice for the deposit; it then moves into a separate Florida account. Florida sets no cap.", cite: F("83.49(1)") },
      { title: "Compare photos at move-out", text: "Claude compares move-in and move-out photos room by room and sorts normal wear and tear, which is never charged, from damage and cleaning. Code computes each deduction.", cite: F("83.43(14), 83.52") },
      { title: "Claim, then close out", text: "With deductions, the claim notice goes by certified mail within 30 days; after the tenants' 15 days to object, the agent proposes the balance refund. You approve; it refunds through PayPal.", cite: F("83.49(3)(a)-(b)") },
    ],
    invoiceNote: () => "Security deposit, held in a separate Florida account and returned under Florida Statutes section 83.49.",
    invoiceTerms: "Security deposit held and returned under Florida Statutes section 83.49.",
    capUnknown: "Enter the deposit amount from the lease first.",
  },

  deadline: {
    days: 15,
    clockStart: flClockStart,
    due: (c) => {
      const start = flClockStart(c);
      if (!start) return null;
      if (!c.claimed) return addDays(start, 15);
      return c.claimNoticeDate ? addDays(c.claimNoticeDate, 30) : addDays(start, 30);
    },
    tip: { title: "15 days, or 30 with a claim", cite: F("83.49(3)(a)-(b)"), text: "With no claim, the deposit goes back within 15 days after the tenancy ends. To keep any part, a claim notice goes by certified mail within 30 days; the tenants have 15 days after receiving it to object, and the balance goes back within 30 days of the notice." },
    summary: "15 days, or 30 after a claim notice",
    railText: "With no claim, the deposit goes back within 15 days; with deductions, the claim notice is due within 30 days and the balance within 30 days of it. A late notice forfeits the claim and any setoff (83.49(3)(a)); the loser of a deposit suit pays the other side's fees (83.49(3)(c)).",
    clockWord: "the 15 and 30-day clock",
    lateWarning: (n) => `The Florida deadline passed ${plural(n, "day")} ago. Return the deposit now; a claim notice not given within 30 days after the tenancy ends forfeits the claim and any setoff (Fla. Stat. 83.49(3)(a)).`,
    moveOutFirst: "Set the move-out date first: with the end of the tenancy it starts the 15 and 30-day clock.",
    // The date shown is the refund (15 days, no claim), the claim notice (30 days after the end), or the balance (30
    // days after the notice), and each is named for what it is.
    words: (c) => (!c.claimed ? { due: "Statement and refund due", within: "Within the 15 days", title: "15-day deadline" }
      : c.claimNoticeDate ? { due: "Balance and statement due", within: "Within 30 days of the claim notice", title: "30 days after the claim notice" }
        : { due: "Claim notice due", within: "Claim notice within 30 days", title: "30-day claim notice" }),
    ledgerAllowed: null,
  },

  moveOut: {
    photosTip: { title: "Before any cleaning or repair", cite: F("83.49(3)(c)"), text: "Not required by statute, but the landlord claiming damages carries the burden of proof and the loser pays fees: photograph each room after the tenants leave and before any work, then again after it." },
  },

  moveIn: {
    photosFrom: null,
    photosTip: { title: "Every room, before move-in", cite: F("83.49(3)(c)"), text: "Not required in Florida, but the landlord carries the burden of proof in a deposit suit. They are the evidence for anything claimed at move-out." },
    photosDocTip: { title: "Move-in photos", cite: F("83.49(3)(c)"), text: "Not required in Florida; evidence for a claim at move-out." },
    oldPhotosStep: { detail: "Florida doesn't require move-in photos, but a landlord claiming damages carries the burden of proof. Photos or a condition record help.", cite: F("83.49(3)(c)") },
    lawCheckTip: { title: "Checked against Fla. Stat. 83.49", text: "The flags stay on the lease check. Florida sets no cap, so the invoice is the deposit the lease asks for." },
    depositTip: { title: "The deposit", cite: F("83.49(1)"), text: "Florida sets no cap. Once paid, the deposit moves out of the PayPal balance into a separate account at a Florida financial institution, or under a surety bond." },
    capUnknownLine: "Enter the deposit amount to send the invoice",
  },

  refund: {
    agreementRequired: false,
    invoiceFirst: "Record the tenants' PayPal account first.",
    agreementTip: { title: "The tenants' PayPal account", cite: F("83.49(3)(a)"), text: "Florida names no refund method. The invoice goes to this account and the refund comes back against the payment, which needs no agreement; a Payout to another account needs the tenants' written designation (product policy, not statute)." },
    agreementText: "We designate the PayPal account at the email above for the security deposit invoice and its refund, less any lawful deductions (Fla. Stat. 83.49(3)).",
    agreementStep: { label: "Record the tenants' PayPal account", detail: "The deposit invoice goes to it and the refund comes back to it. Florida names no refund method; a Payout to another account needs the tenants' written designation.", cite: F("83.49(3)") },
    noAgreementBlocker: "",
    noDesignationBlocker: "The deposit payment can't be refunded against itself (no PayPal payment record, or past PayPal's 180-day window), and no account is designated in writing for a Payout. Record the tenants' PayPal account first (product policy).",
    documentsTip: { title: "Refund account", cite: F("83.49(3)"), text: "Florida names no refund method. The refund goes back against the deposit payment; another account needs the tenants' written designation (product policy)." },
  },

  documents: {
    threshold: null,
    afterPhotoRequired: false,
    vendorContactRequired: false,
    evidenceRequired: false,
    settlementTip: () => ({
      cite: F("83.49(3)(a); 83.43(14); 83.52"),
      text: "Unpaid rent, damage beyond normal wear and tear, and cleaning to the clean and sanitary standard, each stated as a reason in the claim notice. Replacements may be prorated by age, which is common practice, not Florida law.",
      docs: "Florida requires the claim notice in the statute's words, not receipts. The photos, invoices and labor records go with it as evidence; the loser of a deposit suit pays the other side's fees.",
    }),
    refundCheck: () => "Not required; evidence kept",
    afterPhotoTip: { title: "After the work", cite: F("83.49(3)(c)"), text: "Not required by statute; evidence for a claim the landlord may have to prove." },
    estimateTip: { title: "Estimate", cite: F("83.49(3)(a)"), text: "The claim notice may state an amount not yet invoiced. Mark it as an estimate; a sent notice is never raised without a new one inside the 30 days." },
    noteTip: { title: "On the statement", cite: F("83.49(3)(a)"), text: "Goes on the itemized statement with the cost, as part of the reason for the claim." },
  },

  tags: {
    rent: { tag: F("83.43(14)"), short: "rent", label: "Unpaid rent under the rental agreement" },
    damage: { tag: F("83.52(6)"), short: "damage", label: "Damage to the premises beyond normal wear and tear" },
    cleaning: { tag: F("83.52(2)"), short: "cleaning", label: "Cleaning to the clean and sanitary standard" },
  },

  ledger: {
    capTag: () => ({ tag: F("83.49(1)"), tagShort: "held separately", tagLabel: "Held in a separate Florida account or under a bond; Florida sets no cap" }),
    paymentTag: () => ({ tag: F("83.49(1)"), tagShort: "held separately", tagLabel: "Moves out of the PayPal balance into a separate account at a Florida financial institution" }),
    refundTag: { tag: F("83.49(3)(a)-(b)"), tagShort: "15 or 30 days", tagLabel: "Refund within 15 days with no claim; the balance within 30 days of a claim notice" },
    balanceTag: { tag: F("83.49(3)(a)"), tagShort: "balance claimed", tagLabel: "Damages beyond the deposit, stated as a claim", detail: "PayPal invoice for the balance the claim exceeds the deposit by; recorded as a claim, not a demand for payment" },
    typeTip: { title: "Each row's rule", cite: F("83.49"), text: "Hover a type for the part of Florida Statutes section 83.49 behind that row. The Payments export lists it for every row." },
  },

  findings: {
    damage: { rule: "Damage beyond normal wear and tear", note: "May be claimed: the reasonable repair cost, and a replacement prorated by age as common practice.", cite: F("83.52(6), 83.43(14)") },
    cleaning: { rule: "Cleaning to the clean and sanitary standard", note: "May be claimed, only back to how clean the unit was at move-in.", cite: F("83.52(2)") },
    wear_and_tear: { rule: "Normal wear and tear", note: "Not chargeable: ordinary deterioration from normal use is not a breach the deposit secures.", cite: F("83.43(14), 83.52") },
    unclear: { rule: "Can't tell from the photos", note: "Needs a better photo before anything is claimed. A landlord claiming damages carries the burden of proof.", cite: F("83.49(3)(c)") },
  },

  records: [
    {
      kind: "deposit_account", slug: "deposit-account", phase: "move_in",
      title: "Where the deposit is held", short: "deposit holding record", cite: F("83.49(1)"), rule: "F4",
      tip: "Move the deposit out of the PayPal balance into a separate account at a Florida financial institution, interest-bearing or not, or post a surety bond with the clerk of the circuit court. It may not be mingled, pledged or used until it is due. Interest is owed under an interest-bearing account or a bond.",
      when: "Promptly once the deposit is paid; the statute names no grace period.",
      draft: false, methods: [["separate", "Separate account"], ["interest", "Interest-bearing account"], ["bond", "Surety bond"]], toLabel: "", verb: "Recorded",
      detail: { label: "Depository name and address, or the bond's clerk and county", required: true, placeholder: "Bank, branch address" },
      form: { method: "How it is held", date: "Moved on", button: "Record it" },
    },
    {
      kind: "holding_notice", slug: "holding-notice", phase: "move_in",
      title: "Notice of where your deposit is held", short: "holding notice", cite: F("83.49(2)"), rule: "F6",
      tip: "A landlord who rents five or more units gives written notice, in the lease or within 30 days of receiving the deposit, in person, by mail or by s. 83.505 email: the depository's name and address (or that a bond is posted), whether the tenant gets interest, and the capitalized disclosure of s. 83.49(2)(d).",
      when: "Within 30 days of receiving the deposit, for a landlord of five or more units.",
      draft: true, menu: "Holding notice draft", methods: MAIL_METHODS, toLabel: "Given to", verb: "Given",
      heading: "Florida Statutes section 83.49(2)",
      draftBody: (c) => [
        { p: `Your security deposit${c.deposit ? ` of ${usd(c.deposit.amount)}` : ""} for ${c.address} is held as follows: [[blank:w-64]] (a separate non-interest-bearing account, a separate interest-bearing account, or a surety bond) at [[blank:w-72]] (name and address of the Florida financial institution, or the clerk of the circuit court where the bond is filed).` },
        { p: "You [[blank:w-24]] (are or are not) entitled to interest on the deposit. If you are, it is paid or credited against rent at least once a year, at [[blank:w-40]] (75 percent of the account's annualized average rate, or 5 percent a year simple interest)." },
        { quote: FL_HOLDING_DISCLOSURE.join("\n\n"), caption: "The disclosure s. 83.49(2)(d), Florida Statutes, requires, word for word" },
      ],
    },
    {
      kind: "claim_notice", slug: "claim-notice", phase: "move_out",
      title: "Notice of intention to impose claim on security deposit", short: "claim notice", cite: F("83.49(3)(a)"), rule: "F9",
      tip: "Within 30 days after the tenancy ends, by certified mail to the tenant's last known mailing address (or by email under a signed s. 83.505 addendum), in the statute's words, with the amount and the reason. Without it the claim and any setoff are forfeited; nothing is deducted until 15 days after the tenant receives it.",
      when: "Within 30 days after the end of the tenancy.", draft: true, menu: "Claim notice draft",
      methods: [["certified", "Certified mail"], ["email", "Email under s. 83.505"]], toLabel: "Sent to", verb: "Sent",
      detail: { label: "Certified mail tracking number, or the email address", required: true, placeholder: "9407 1000 0000 0000 0000 00" },
      received: true, form: { method: "How it was sent", date: "Date sent", button: "Mark as sent" },
      heading: "Florida Statutes section 83.49(3)(a)",
      draftBody: (c) => [
        { quote: `This is a notice of my intention to impose a claim for damages in the amount of ${c.claim ? usd(c.claim.total) : "[[blank:w-32]]"} upon your security deposit, due to ${c.claim ? c.claim.items.join("; ") : "[[blank:w-72]]"}. It is sent to you as required by s. 83.49(3), Florida Statutes. You are hereby notified that you must object in writing to this deduction from your security deposit within 15 days after the time you receive this notice or I will be authorized to deduct my claim from your security deposit. Your objection must be sent to [[blank:w-72]].`, caption: "In the form s. 83.49(3)(a), Florida Statutes, requires; the last blank is the landlord's address for notices (s. 83.50)" },
        { p: "The itemized statement of these deductions, with the photos and invoices behind them, is enclosed." },
        { p: `${c.due ? `If you do not object, the balance of the deposit will be returned within 30 days after the date of this notice.` : "If you do not object, the balance of the deposit will be returned within 30 days after the date of this notice."} Either party may bring an action over the deposit; the prevailing party recovers court costs and a reasonable attorney fee (s. 83.49(3)(c)).` },
      ],
    },
    {
      kind: "claim_objection", slug: "claim-objection", phase: "move_out", after: "claim_notice",
      title: "The tenant's written objection to the claim", short: "tenant's objection", cite: F("83.49(3)(b)-(c)"), rule: "F12",
      tip: "If the tenant objects in writing within 15 days of receiving the claim notice, the agent deducts nothing disputed: the balance beyond the claim still goes back on time and the claimed amount stays in the separate account. Either party may sue; the prevailing party recovers costs and attorney fees.",
      when: "Record it the day it arrives.", draft: false, methods: RECEIVED, toLabel: "From", verb: "Received",
      form: { method: "How it came", date: "Date received", button: "Record the objection" },
      status: (n) => {
        const o = objectionOf(n);
        if (!o) return null;
        if (o.timely == null) return { text: "Record the day the tenants received the claim notice: whether this objection came in time depends on it.", tone: "amber" };
        return o.timely
          ? { text: `In time: received ${longDate(o.date)}, within the 15 days that ran to ${longDate(o.last!)}. The claim is disputed, so nothing claimed is deducted; the undisputed balance still goes back on time (s. 83.49(3)(b)).`, tone: "amber" }
          : { text: `Received ${longDate(o.date)}, after the 15 days ended ${longDate(o.last!)}. Unless the tenants sent it within those 15 days, it is late and the landlord may deduct the claim; the tenants keep the right to sue (s. 83.49(3)(b)).`, tone: "green" };
      },
    },
  ],

  notices: {
    refundNotice: false,
    inspection: null,
    sectionTip: { title: "The dates the move-out hangs on", cite: F("83.49(3), (5)"), text: "Set the lease end once and record the day either side gives notice. Tenants give 7 days' written notice with an address; the 15 and 30-day clock follows the end of the tenancy." },
    inspectionNote: "",
    followTip: (_w, due, passed) => (passed ? "The planned move-out has passed. Record the actual move-out date once the tenants vacate; the 15 and 30-day clock runs from the earlier of that day and the end of the tenancy."
      : due ? `If they leave as planned and nothing is claimed, the deposit goes back by ${longDate(due)}, 15 days later; to claim any part, the notice goes by certified mail within 30 days.` : ""),
    followCite: F("83.49(3)(a)"),
    datesTip: "The 60-day check-in, the move-out, and the deposit deadline, as an .ics file for Apple, Google or Outlook.",
  },

  delivery: {
    tip: { title: "How the statement goes out", cite: F("83.49(3)(a); 83.505"), text: "With a claim, the itemized statement goes with the claim notice: certified mail to the tenant's last known mailing address, or email under a signed s. 83.505 addendum. With no claim, it is the receipt for the full refund." },
    emailRule: "agreement",
    emailLabel: "and I signed an addendum under s. 83.505 electing email notices, and it has not been revoked.",
    emailWord: "email under s. 83.505, Florida Statutes",
    emailShort: "Email under s. 83.505",
    multipleTo: "The statute names no payee among several tenants; send each adult a copy and record the one it is addressed to (practice).",
    emailRefused: "Email is the delivery of record in Florida only under a signed s. 83.505 addendum the tenant has not revoked (Fla. Stat. 83.49(3)(a), 83.505). Confirm it, or mail it.",
    unitFallback: true,
    noForwarding: "",
    mailHint: (unit, f) => (f
      ? `${f.name ?? "The tenants"} gave this address through the tenant link on ${longDate(f.date)}. Leave it blank to use the last known address, the vacated unit at ${unit}.`
      : `The tenant's last known mailing address. Leave it blank to use the vacated unit, ${unit}.`),
    addressedCite: F("83.49(3)(a)"),
    toCite: F("83.49(1)"),
  },

  localOverlays: [
    { city: "Miami-Dade", match: /^(miami|miami beach|hialeah|homestead|doral|north miami|coral gables)$/i, line: "Miami-Dade's Tenant's Bill of Rights (Ord. 22-47), Miami's 2022 bill and Miami Beach's 2021 rent-increase notice are preempted since 2023-07-01 (s. 83.425) and no longer apply." },
    { city: "Broward County", match: /^(fort lauderdale|hollywood|pembroke pines|miramar|coral springs|pompano beach|davie|plantation|sunrise)$/i, line: "Broward's 2022 Tenant's Bill of Rights (late-fee notice, 60-day rent-increase notice) is preempted since 2023-07-01 (s. 83.425) and no longer applies." },
    { city: "Orange County", match: /^(orlando|winter park|apopka|ocoee|winter garden)$/i, line: "Orange County's Fair Notice Ordinance and 2022 Tenant's Bill of Rights are preempted since 2023-07-01 (s. 83.425); the 2022 rent stabilization ordinance is not in effect." },
    { city: "Tampa", match: /^tampa$/i, line: "Hillsborough County's 2021 and Tampa's 2022 Tenant Bills of Rights are preempted since 2023-07-01 (s. 83.425) and no longer apply." },
    { city: "St. Petersburg", match: /^(st\.?\s+petersburg|saint petersburg)$/i, line: "St. Petersburg repealed its 2022 Tenants Bill of Rights in 2023, citing the state preemption (s. 83.425)." },
  ],
};

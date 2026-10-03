// Texas: Property Code Title 8, Chapter 92, Subchapter C (92.101 to 92.113), current through the 89th Legislature,
// 2nd Called Session, 2025. Source of truth: docs/rules/TX.md (rule ids T1 to T30, verified twice on 2026-10-03).
// No cap, no interest, no move-in checklist and no pre-move-out inspection; a refund and a written itemized list on or
// before the 30th day after the tenant surrenders the premises, owed once the tenant gives a written forwarding
// address; bad-faith retention costs $100, three times the portion wrongfully withheld, and attorney's fees.
// Not yet in code: T4, T7, T23, T30 (docs/rules/README.md, Known gaps).

import { refundableSecurity, type Flag, type LeaseTerms } from "../rules";
import { addDays, longDate, monthsOfRent, plural, RECEIVED, usd } from "./common";
import type { ClientPack } from "./types";

const C = (s: string) => `Tex. Prop. Code ${s}`;

/** The written forwarding address on file: the one the tenants gave through their link, or one recorded by hand. */
export const forwardingOf = (o: { link: string | null | undefined; record: { detail?: string | null } | undefined }) => o.link ?? o.record?.detail ?? null;

function evaluate(t: LeaseTerms): Flag[] {
  const flags: Flag[] = [];
  const rent = t.monthlyRent;
  const deposit = refundableSecurity(t);

  // T3: no cap, shown for information.
  flags.push({
    id: "T3", severity: "info", note: true, title: "No deposit cap in Texas",
    detail: `Texas sets no limit on the amount of a security deposit and requires no interest on it. The lease's deposit, ${usd(deposit)}${rent ? `, is ${monthsOfRent(deposit, rent)}` : ""}; it is shown for information only.`,
    cite: C("92.102, 92.103"), fact: `${usd(deposit)}${rent ? `, ${monthsOfRent(deposit, rent)}` : ""}`,
  });

  // T2: a "nonrefundable" fee that secures performance is a deposit, however it is labeled.
  const labeled = t.otherMoveInCharges.filter((c) => c.refundable === false);
  for (const c of labeled) {
    flags.push({
      id: "T2", severity: "warning", title: `"${c.label}" may be a deposit`,
      detail: "A security deposit is any advance of money, other than a rental application deposit or advance rent, intended primarily to secure performance under the lease. A fee labeled nonrefundable that in fact secures performance is a deposit, however the lease names it. Confirm what it is for; the deposit invoice leaves it out.",
      cite: C("92.102"), quote: c.quote, fact: `${c.label}, ${usd(c.amount)}`,
    });
  }
  for (const q of t.nonrefundableLanguage) {
    if (labeled.some((c) => q.includes(c.quote) || c.quote.includes(q))) continue;
    flags.push({
      id: "T1", severity: "warning", title: "Deposit duties can't be waived",
      detail: "A landlord's duties and a tenant's remedies about security deposits may not be waived. A clause calling money that secures the lease nonrefundable does not make it so.",
      cite: C("92.006(a), 92.102"), quote: q, fact: "Labeled nonrefundable",
    });
  }

  if (t.mandatoryCleaningClause) {
    flags.push({
      id: "T9", severity: "warning", title: "Flat cleaning charge",
      detail: "Cleaning to the move-in level is deductible as a charge the lease makes the tenant liable for. A flat cleaning fee regardless of condition may be a deposit, and normal wear and tear is never chargeable.",
      cite: C("92.102, 92.104(a)-(b)"), quote: t.mandatoryCleaningClause, fact: "Required at every move-out",
    });
  }

  // T25: late fees.
  if (t.lateFee) {
    const units = t.buildingUnitCount;
    const harbor = units == null ? null : units <= 4 ? 12 : 10;
    const pct = t.lateFee.percentOfRent ?? (t.lateFee.amount && rent ? Math.round((t.lateFee.amount / rent) * 1000) / 10 : null);
    flags.push({
      id: "T25", severity: "warning", title: "Late fee must be lawful to come out of the deposit",
      detail: `A late fee is lawful only with notice in a written lease, a reasonable amount, and rent unpaid two full days after it was due. The safe harbor is 12 percent of the month's rent in a building of four or fewer units, 10 percent above four${harbor != null && pct != null ? `; this lease's fee is about ${pct}% against ${harbor}%` : ""}. An unlawful fee costs $100 plus three times the fee plus attorney's fees.`,
      cite: C("92.019"), quote: t.lateFee.quote,
      fact: `${pct != null ? `About ${pct}% of rent` : t.lateFee.amount != null ? usd(t.lateFee.amount) : "A late fee"}${t.lateFee.deductibleFromDeposit ? ", taken from the deposit" : ""}`,
    });
  }

  // T6: the refund waits for a written forwarding address.
  flags.push({
    id: "T6", severity: "info", title: "Refund waits for a written forwarding address",
    detail: "The refund and the written itemized list of deductions are owed on or before the 30th day after the tenant surrenders the premises, once the tenant has given a written forwarding address. The tenant never forfeits the deposit for not giving one. The tenant link's moving-out form collects it.",
    cite: C("92.103(a), 92.107"), fact: "Collect it before the move-out",
  });

  // T14: email notices on a lease from September 1, 2025.
  if (t.tenancyStartDate && t.tenancyStartDate >= "2025-09-01") {
    flags.push({
      id: "T14", severity: "info", note: true, title: "Notices by email after a first email exchange",
      detail: "For a lease entered into or renewed on or after September 1, 2025, notices under the deposit subchapter may go by email if the tenant and the landlord have communicated by email before. Keep that first exchange.",
      cite: C("92.113"), fact: `Lease starts ${longDate(t.tenancyStartDate)}`,
    });
  }

  // T21: photos are evidence, not a duty.
  flags.push({
    id: "T21", severity: "info", note: true, title: "Move-in photos: evidence, not a duty",
    detail: "Texas requires no move-in photos or checklist, but the landlord must prove every deduction reasonable. Photograph each room at move-in.",
    cite: C("92.109(c)"), fact: "Recommended",
  });

  if (t.tenants.length > 1) {
    flags.push({
      id: "G", severity: "info", note: true, title: `${t.tenants.length} adult tenants on the lease`,
      detail: "Texas law doesn't say how a refund is split among tenants; the lease controls. By default the refund goes back to the account the deposit came from, and splits only under an allocation every adult signs (practice, not statute).",
      cite: "Practice; Tex. Prop. Code 92.104(c)", fact: t.tenants.join(", "),
    });
  }

  const order = { violation: 0, warning: 1, info: 2 } as const;
  return flags.sort((a, b) => order[a.severity] - order[b.severity]);
}

export const TX: ClientPack = {
  code: "TX",
  name: "Texas",
  spec: "docs/rules/TX.md",
  statute: {
    short: "Tex. Prop. Code ch. 92",
    full: "Texas Property Code, Chapter 92, Subchapter C",
    inline: "Texas Property Code Chapter 92",
    url: "https://statutes.capitol.texas.gov/Docs/PR/htm/PR.92.htm",
    tagCite: (tag) => tag,
  },
  chip: {
    title: "Texas Property Code, Chapter 92, Subchapter C",
    text: "This property is in Texas, so its deposit follows Property Code 92.101 to 92.113: no cap, and the refund with a written itemized list on or before the 30th day after the tenants surrender the unit, owed once they give a forwarding address in writing. Keeping it in bad faith costs $100, three times the portion wrongfully withheld, and the tenants' attorney's fees.",
    cite: "Tex. Prop. Code 92.101 to 92.113",
  },
  courtsGuide: { label: "TexasLawHelp guide", url: "https://texaslawhelp.org/article/security-deposits" },

  copy: {
    disclaimers: [
      "This tool organizes your records and fills in templates based on Texas Property Code Chapter 92, Subchapter C. It does not give legal advice, does not evaluate your specific situation, and is not a substitute for the advice of a Texas attorney.",
      "Items marked Common practice (useful-life proration, paint schedules, joint refunds) are not in the statute. A court may decide differently.",
      "You decide every deduction and approve every document before it is sent. The tool flags rules; it does not decide disputes.",
      "Texas cities may not regulate security deposits (Prop. Code 1.004); some add eviction-notice or registration rules. Check your city.",
    ],
    preparedUnder: "Prepared with Good Faith from the landlord's records, under Texas Property Code Chapter 92, Subchapter C. It is not legal advice and is not a substitute for the advice of an attorney.",
    noticeFooter: "Prepared with Good Faith from the landlord's records as a template under Texas Property Code Chapter 92, completed at the landlord's direction. It is not legal advice and is not a substitute for the advice of an attorney.",
    tenantAbout: "The rules as Texas Property Code Chapter 92, Subchapter C states them, with the facts your landlord keeps with Good Faith where they fit. It is not legal advice, does not evaluate your situation, and is not a substitute for the advice of an attorney.",
    wearRefused: "Normal wear and tear can't be deducted (Tex. Prop. Code 92.104(b)).",
    statementCite: "Texas Property Code 92.104(c)",
    guidanceLabel: "Common practice",
    guidanceNote: "Useful-life proration and the paint schedule are common practice, not Texas law. The landlord must prove every deduction reasonable, and a prorated charge is easier to defend. A court may decide differently.",
    guidanceCite: "Common practice, not statute; Tex. Prop. Code 92.109(c)",
  },

  lease: {
    evaluate,
    lawful: (t) => {
      const charged = refundableSecurity(t);
      return { amount: charged, cap: null, charged };
    },
    securityTotal: refundableSecurity,
    securityCharge: (c) => c.refundable !== false, // a charge the lease labels nonrefundable is flagged, not invoiced
    chargeWord: "charge",
    confirmState: true,
    capTip: {
      title: "No deposit cap", cite: C("92.102"),
      text: "Texas sets no limit on a security deposit. A deposit is any advance of money, other than an application deposit or advance rent, intended primarily to secure performance under the lease; a fee labeled nonrefundable may still be one.",
    },
    capSub: () => "No statewide cap",
    lawfulSub: () => "As the lease asks; no cap",
    law: [
      { label: "Forwarding address", line: "The refund waits for it, in writing", fact: "The refund and the written itemized list are owed once the tenant gives a forwarding address in writing. The tenant never forfeits the deposit for not giving one.", cite: C("92.107") },
      { label: "30-day deadline", line: "After the tenants surrender", fact: "The refund, with a written description and itemized list of deductions, is due on or before the 30th day after the tenants surrender the premises. Missing it is presumed bad faith.", cite: C("92.103(a), 92.104(c), 92.109(d)") },
      { label: "Bad-faith penalty", line: "$100 plus three times", fact: "Bad-faith retention costs $100, three times the amount wrongfully withheld and the tenant's attorney's fees. A bad-faith failure to itemize forfeits the right to keep any of it.", cite: C("92.109(a)-(b)") },
    ],
    steps: [
      { title: "Check the lease", text: "Claude pulls out the deposit terms and the app flags what Chapter 92 asks: nonrefundable fees that may be deposits, late fees, and the forwarding address the refund waits for.", cite: C("92.102, 92.019, 92.107") },
      { title: "Collect the deposit", text: "The tenants name their PayPal account, then pay a PayPal invoice for the deposit. Texas sets no cap.", cite: C("92.102, 92.103(a)") },
      { title: "Compare photos at move-out", text: "Claude compares move-in and move-out photos room by room and sorts normal wear and tear, which is never charged, from damage and cleaning. Code computes each deduction.", cite: C("92.001(4), 92.104(a)-(b)") },
      { title: "Close out with your approval", text: "Once the tenants give a written forwarding address, the agent confirms the deposit with PayPal, proposes the refund and checks the itemized list. You approve; it refunds through PayPal.", cite: C("92.103(a), 92.104(c), 92.107") },
    ],
    invoiceNote: () => "Security deposit, held and returned under Texas Property Code Chapter 92, Subchapter C.",
    invoiceTerms: "Security deposit held and returned under Texas Property Code Chapter 92, Subchapter C.",
    capUnknown: "Enter the deposit amount from the lease first.",
  },

  deadline: {
    days: 30,
    clockStart: (c) => c.moveOutDate,
    due: (c) => (c.moveOutDate ? addDays(c.moveOutDate, 30) : null),
    tip: { title: "30 days after surrender", cite: C("92.103(a), 92.107(a)"), text: "The refund and the written itemized list of deductions are due on or before the 30th day after the tenants surrender the premises, once they have given a written forwarding address." },
    summary: "30 days after surrender",
    // In the statute's words (92.103(a), 92.104(c)): the refund, with a written itemized list of the deductions.
    words: () => ({ due: "Refund and itemized list due", within: "Within the 30 days", title: "30-day deadline" }),
    railText: "The refund and the written itemized list are due on or before the 30th day after the tenants surrender the premises, once they give a written forwarding address. Missing the 30th day is presumed bad faith, which can cost $100, three times the portion wrongfully withheld, and the tenant's reasonable attorney's fees (92.109(a), (d)).",
    clockWord: "the 30-day clock",
    lateWarning: (n) => `The 30th day after surrender passed ${plural(n, "day")} ago. Refund now: missing it is presumed bad faith (Tex. Prop. Code 92.109(d)), a presumption the landlord can still rebut.`,
    moveOutFirst: "Set the move-out date first: the day the tenants surrender the premises starts the 30-day clock.",
    ledgerAllowed: 30,
  },

  moveOut: {
    photosTip: { title: "Before any cleaning or repair", cite: C("92.109(c)"), text: "Not required by statute, but the landlord must prove every deduction reasonable: photograph each room after the tenants leave and before any work that will be deducted, then again after it." },
  },

  moveIn: {
    photosFrom: null,
    photosTip: { title: "Every room, before move-in", cite: C("92.109(c)"), text: "Not required in Texas, but the landlord carries the burden of proving every deduction reasonable. They are the evidence for anything charged at move-out." },
    photosDocTip: { title: "Move-in photos", cite: C("92.109(c)"), text: "Not required in Texas; evidence for the landlord's burden of proof at move-out." },
    oldPhotosStep: { detail: "Texas doesn't require move-in photos, but the landlord must prove every deduction reasonable at move-out. Photos or a condition form help.", cite: C("92.109(c)") },
    lawCheckTip: { title: "Checked against Tex. Prop. Code ch. 92", text: "The flags stay on the lease check. Texas sets no cap, so the invoice is the deposit the lease asks for." },
    depositTip: { title: "The deposit", cite: C("92.102"), text: "Texas sets no cap. The invoice is the deposit the lease asks for; a fee the lease labels nonrefundable stays out of it." },
    capUnknownLine: "Enter the deposit amount to send the invoice",
  },

  refund: {
    agreementRequired: false,
    invoiceFirst: "Record the tenants' PayPal account first.",
    agreementTip: { title: "The tenants' PayPal account", cite: C("92.103(a)"), text: "Texas names no refund method. The invoice goes to this account and the refund comes back against the payment, which needs no agreement; a Payout to any other account needs the tenants' written designation (product policy, not statute)." },
    agreementText: "We designate the PayPal account at the email above for the security deposit invoice and its refund, less any lawful deductions. Texas law names no refund method (Tex. Prop. Code 92.103(a)).",
    agreementStep: { label: "Record the tenants' PayPal account", detail: "The deposit invoice goes to it and the refund comes back to it. Texas names no refund method; a Payout to another account needs the tenants' written designation.", cite: C("92.103(a)") },
    noAgreementBlocker: "",
    noDesignationBlocker: "The deposit payment can't be refunded against itself (no PayPal payment record, or past PayPal's 180-day window), and no account is designated in writing for a Payout. Record the tenants' PayPal account first (Tex. Prop. Code 92.103(a); product policy).",
    documentsTip: { title: "Refund account", cite: C("92.103(a)"), text: "Texas names no refund method. The refund goes back against the deposit payment; another account needs the tenants' written designation (product policy)." },
  },

  documents: {
    threshold: null,
    afterPhotoRequired: false,
    vendorContactRequired: false,
    evidenceRequired: true,
    settlementTip: () => ({
      cite: C("92.104(a)-(c), 92.109(c)"),
      text: "Damages and charges the tenant is legally liable for under the lease or for breaching it: unpaid rent, damage beyond normal wear and tear, cleaning the lease makes the tenant responsible for. Never normal wear and tear. Replacements may be prorated by age, which is common practice, not Texas law.",
      docs: "Texas requires a written description and itemized list, not receipts. The landlord must still prove every deduction reasonable, so each line carries photos, an invoice or the labor record (product policy).",
    }),
    refundCheck: () => "Evidence on every line",
    afterPhotoTip: { title: "After the work", cite: C("92.109(c)"), text: "Not required by statute; evidence the landlord may need to prove the deduction reasonable." },
    estimateTip: { title: "Estimate", cite: C("92.104(c)"), text: "Texas sets no estimate rule. Mark it as an estimate and add the invoice once the work is done (practice)." },
    noteTip: { title: "On the statement", cite: C("92.104(c)"), text: "Goes on the written description and itemized list with the cost." },
  },

  tags: {
    rent: { tag: C("92.104(a)"), short: "rent", label: "Unpaid rent owed under the lease" },
    damage: { tag: C("92.104(a)-(b)"), short: "damage", label: "Damage beyond normal wear and tear" },
    cleaning: { tag: C("92.104(a)"), short: "cleaning", label: "Cleaning the lease makes the tenant responsible for" },
  },

  ledger: {
    capTag: () => ({ tag: C("92.102"), tagShort: "deposit", tagLabel: "A security deposit is any advance of money that secures performance under the lease; Texas sets no cap" }),
    paymentTag: () => ({ tag: C("92.103(a)"), tagShort: "refund method", tagLabel: "Texas names no refund method: the refund goes back against this payment" }),
    refundTag: { tag: C("92.103(a), 92.107"), tagShort: "30 days", tagLabel: "Refund within 30 days after surrender, once a written forwarding address is given" },
    balanceTag: { tag: C("92.104(a)"), tagShort: "balance claimed", tagLabel: "Damages and charges beyond the deposit, stated as a claim", detail: "PayPal invoice for the balance the deductions exceed the deposit by; recorded as a claim, not a demand for payment" },
    typeTip: { title: "Each row's rule", cite: "Tex. Prop. Code ch. 92", text: "Hover a type for the part of Texas Property Code Chapter 92 behind that row. The Payments export lists it for every row." },
  },

  findings: {
    damage: { rule: "Damage beyond normal wear and tear", note: "May be deducted: the reasonable repair cost, and a replacement prorated by age as common practice.", cite: C("92.104(a)-(b), 92.001(4)") },
    cleaning: { rule: "Cleaning the lease makes the tenant responsible for", note: "May be deducted as a lease charge, back to how clean the unit was at move-in.", cite: C("92.104(a)") },
    wear_and_tear: { rule: "Normal wear and tear", note: "Not chargeable under Texas law.", cite: C("92.104(b), 92.001(4)") },
    unclear: { rule: "Can't tell from the photos", note: "Needs a better photo before anything is charged. The landlord must prove every deduction reasonable.", cite: C("92.109(c)") },
  },

  records: [
    {
      kind: "forwarding_address", slug: "forwarding-address", phase: "move_out",
      title: "The tenant's forwarding address, in writing", short: "forwarding address", cite: C("92.107"), rule: "T6",
      tip: "The refund and the written itemized list are not owed until the tenant gives a written statement of a forwarding address for the refund. A letter, an email, a text or the tenant link's moving-out form all count; record the day it arrived. The tenant never forfeits the deposit for not giving one.",
      when: "Ask for it before the move-out; the tenant link's moving-out form collects it and needs no record here.",
      draft: false, methods: RECEIVED, toLabel: "From", verb: "Received",
      detail: { label: "Forwarding address", required: true, placeholder: "Street, city, state and ZIP" },
      form: { method: "How it came", date: "Date received", button: "Record the address" },
    },
  ],

  notices: {
    refundNotice: false,
    inspection: null,
    sectionTip: { title: "The dates the move-out hangs on", cite: C("92.103(a), 92.107"), text: "Set the lease end once and record the day either side gives notice. Texas asks no notice back from the landlord: ask the tenants for a forwarding address in writing, and the 30-day clock starts at surrender." },
    inspectionNote: "",
    followTip: (_w, due, passed) => (passed ? "The planned move-out has passed. Record the actual move-out date once possession is surrendered; the 30-day clock runs from that day."
      : due ? `If they leave as planned, the refund and the itemized list are due ${longDate(due)}, 30 days later, once they give a forwarding address in writing.` : ""),
    followCite: C("92.103(a), 92.107"),
    datesTip: "The 60-day check-in, the move-out, and the 30-day refund deadline, as an .ics file for Apple, Google or Outlook.",
  },

  delivery: {
    tip: { title: "How the statement goes out", cite: C("92.104(c), 92.1041, 92.113"), text: "Hand it over, or mail it to the forwarding address the tenant gave in writing; a postmark by the 30th day is presumed on time. Email is the record only on a lease from September 1, 2025 when you and the tenant have emailed before." },
    emailRule: "agreement",
    emailLabel: "and I have communicated by email before, on a lease entered into or renewed on or after September 1, 2025.",
    emailWord: "email under Tex. Prop. Code 92.113",
    emailShort: "Email under 92.113",
    multipleTo: "Texas law is silent on several tenants; send each adult a copy and record the one it is addressed to (practice).",
    emailRefused: "Email is the delivery of record in Texas only on a lease entered into or renewed on or after September 1, 2025, when the tenant and the landlord have communicated by email before (Tex. Prop. Code 92.113). Confirm it, or mail it with the postmark recorded.",
    unitFallback: false,
    noForwarding: "Mail it to the forwarding address the tenant gave in writing. With none on file nothing is owed yet, and the vacated unit is not a substitute (Tex. Prop. Code 92.107).",
    mailHint: (_unit, f) => (f ? `${f.name ?? "The tenants"} gave this forwarding address through the tenant link on ${longDate(f.date)}. Record the postmark date when it goes out.` : "The forwarding address the tenant gave in writing. Texas doesn't allow the vacated unit in its place."),
    addressedCite: C("92.107(a), 92.1041"),
    toCite: C("92.104(c)"),
  },

  localOverlays: [
    { city: "Austin", match: /^austin$/i, line: "City Code Chapter 4-14, Article 2: a landlord of five or more dwellings gives a written notice of proposed eviction, with a bilingual notice of tenants' rights and a cure period of at least seven days, before any notice to vacate. Eviction-side, likely preempted (Prop. Code 1.004, 24.0043); current enforcement not confirmed." },
    { city: "Dallas", match: /^dallas$/i, line: "City Code Chapter 27: single-family, duplex and condominium rentals are registered with the city each year and meet minimum property standards. Registration, not deposits." },
    { city: "San Antonio", match: /^san\s+antonio$/i, line: "City Code 16-6: the city's Notice of Tenant Rights form within one business day after a notice to vacate for non-payment of rent; a fine of up to $500 after a warning. Eviction-side." },
  ],
};

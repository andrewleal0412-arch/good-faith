// California: Civil Code 1950.5 as amended through AB 414 (Stats. 2025, ch. 340), effective 2026-01-01.
// Source of truth: docs/LEGAL_RULES.md (rule ids D1 to D30 and the statement checklist in section B). Every sentence
// here is the one the app used before the state packs existed: California behaves exactly as it did, and
// scripts/ca-snapshot.mjs proves it. The statement checklist, the agent's rules and prompt, the next steps, the
// calendar and the tenant page are in ca.server.ts.

import { addDays, longDate } from "../dates";
import { smallLandlordExempt, totalSecurity, type Flag, type LeaseTerms } from "../rules";
import type { ClientPack, LawfulDeposit } from "./types";

const usd = (n: number) => `$${n.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
const days = (n: number) => `${n} day${n === 1 ? "" : "s"}`;

/** D13, (g)(1): move-in photos are required for tenancies that began on or after this date. */
const MOVE_IN_PHOTOS_FROM = "2025-07-01";

/** (h)(4): receipts and invoices aren't required when repair and cleaning deductions total $125 or less. */
export const RECEIPT_THRESHOLD = 125;

function evaluate(t: LeaseTerms): Flag[] {
  const flags: Flag[] = [];
  const rent = t.monthlyRent;
  const security = totalSecurity(t);

  // D1 + D3/D4/D5: the cap.
  if (rent) {
    const exempt = smallLandlordExempt(t);
    const capMonths = exempt ? 2 : 1;
    const cap = rent * capMonths;
    const parts = [t.securityDeposit ? `deposit ${usd(t.securityDeposit)}` : null,
      ...t.otherMoveInCharges.map((c) => `${c.label.toLowerCase()} ${usd(c.amount)}`)].filter(Boolean).join(" + ");
    if (exempt === null) {
      flags.push({ id: "D4", severity: "warning", title: "Can't tell which deposit cap applies",
        detail: `The cap is one month's rent (${usd(rent)}) unless the owner is a natural person or an LLC of natural persons with at most 2 rental properties and 4 units, who may charge two months. Confirm the owner type and portfolio size.`,
        cite: "Civ. Code 1950.5(c)(1), (c)(5)" });
    }
    if (security > cap && exempt !== null) {
      flags.push({ id: "D3", severity: "violation", title: `Security over the ${capMonths === 1 ? "one-month" : "two-month"} cap`,
        detail: `Total security collected at move-in is ${usd(security)} (${parts}). Everything charged at the start of the tenancy counts as security except first month's rent. The cap here is ${usd(cap)}${exempt ? "" : t.tenantIsServiceMember ? " (service member: always one month)" : ` because the owner ${t.ownerType.startsWith("llc") || t.ownerType === "corporation" ? "is an entity or holds" : "holds"} more than 2 properties or 4 units`}. Excess: ${usd(security - cap)}.`,
        cite: "Civ. Code 1950.5(b), (c)(1), (c)(5)" });
    }
  }

  // D8: nothing may be "nonrefundable".
  for (const q of t.nonrefundableLanguage) {
    flags.push({ id: "D8", severity: "violation", title: "\"Nonrefundable\" security",
      detail: "California bars any lease term that makes a security deposit or move-in fee nonrefundable. It counts as security and must be accounted for at move-out.",
      cite: "Civ. Code 1950.5(n), (b)", quote: q });
  }

  // D10: no professional cleaning charge unless needed to restore move-in condition.
  if (t.mandatoryCleaningClause) {
    flags.push({ id: "D10", severity: "violation", title: "Mandatory professional cleaning",
      detail: "Since 2025 a landlord can't charge for professional carpet or other professional cleaning unless it's reasonably necessary to return the unit to its move-in condition, excluding ordinary wear and tear. A blanket \"regardless of condition\" charge isn't allowed.",
      cite: "Civ. Code 1950.5(e)(2)(C) (AB 2801)", quote: t.mandatoryCleaningClause });
  }

  // D26: late fees are liquidated damages and only deductible if lawfully owed.
  if (t.lateFee) {
    const pct = t.lateFee.percentOfRent ?? (t.lateFee.amount && rent ? Math.round((t.lateFee.amount / rent) * 1000) / 10 : null);
    flags.push({ id: "D26", severity: "warning", title: "Late fee needs to be a reasonable estimate",
      detail: `The lease sets a late fee${pct ? ` of about ${pct}% of rent` : ""}${t.lateFee.deductibleFromDeposit ? " and lets it come out of the deposit" : ""}. Residential late fees are enforceable only as a reasonable estimate of the landlord's actual loss; courts have voided flat fees that weren't (Orozco v. Casimiro). Only a fee that is lawfully owed can be deducted.`,
      cite: "Civ. Code 1671(c)-(d); Civ. Code 1950.5(b)(1)", quote: t.lateFee.quote });
  }

  // D13: move-in photos for tenancies beginning on or after 2025-07-01.
  if (t.tenancyStartDate && t.tenancyStartDate >= MOVE_IN_PHOTOS_FROM) {
    flags.push({ id: "D13", severity: "info", title: "Move-in photos are required",
      detail: "This tenancy began on or after July 1, 2025, so the landlord must photograph the unit immediately before or at the start of the tenancy. Without them, deductions are hard to support at move-out.",
      cite: "Civ. Code 1950.5(g)(1) (AB 2801)" });
  }

  // D16/D17: electronic payments mean an electronic refund; PayPal needs the tenant's written agreement.
  if (t.electronicPaymentMethods.length) {
    flags.push({ id: "D16", severity: "info", title: "Refund must go back electronically",
      detail: `The tenant can pay electronically (${t.electronicPaymentMethods.join(", ")}). Since January 2026, a landlord who received rent or the deposit electronically must refund electronically to an account the tenant designates, and may use PayPal only if the tenant agrees in writing. Collect that agreement now.`,
      cite: "Civ. Code 1950.5(h)(1)(A) (AB 414)" });
  }

  // D19: roommates.
  if (t.tenants.length > 1) {
    flags.push({ id: "D19", severity: "info", title: `${t.tenants.length} adult tenants on the lease`,
      detail: "By default the refund is one payment to all adult tenants together, with the statement to any one of them. To split it, every adult must sign a written allocation agreement.",
      cite: "Civ. Code 1950.5(h)(1)(C)" });
  }

  const order = { violation: 0, warning: 1, info: 2 } as const;
  return flags.sort((a, b) => order[a.severity] - order[b.severity]);
}

/** D3/D4: everything the lease charges as security, capped at the legal maximum. Null when the cap can't be told. */
function lawful(t: LeaseTerms): LawfulDeposit | null {
  if (!t.monthlyRent) return null;
  const exempt = smallLandlordExempt(t);
  if (exempt === null) return null;
  const cap = t.monthlyRent * (exempt ? 2 : 1);
  const charged = totalSecurity(t);
  return { amount: Math.min(charged, cap), cap, charged };
}

export const CA: ClientPack = {
  code: "CA",
  name: "California",
  spec: "docs/LEGAL_RULES.md",
  statute: {
    short: "Civ. Code 1950.5",
    full: "California Civil Code 1950.5",
    inline: "Civil Code 1950.5",
    url: "https://leginfo.legislature.ca.gov/faces/codes_displaySection.xhtml?lawCode=CIV&sectionNum=1950.5",
    tagCite: (tag) => (tag.startsWith("(") ? `Civ. Code 1950.5${tag}` : tag),
  },
  chip: {
    title: "California Civil Code 1950.5",
    text: "This property is in California, so its deposit follows Civil Code 1950.5 as amended by AB 414 (2025), effective January 1, 2026: the cap, the move-in and move-out photos, the electronic refund, and the itemized statement and refund within 21 days.",
    cite: "Civ. Code 1950.5",
  },
  courtsGuide: { label: "Courts' guide", url: "https://selfhelp.courts.ca.gov/guide-security-deposits-california" },

  copy: {
    disclaimers: [
      "This tool organizes your records and fills in templates based on California Civil Code 1950.5 and published state guidance. It does not give legal advice, does not evaluate your specific situation, and is not a substitute for a California attorney.",
      "Items marked Guidance or Common practice (useful-life proration, paint schedules) are not in the statute. A court may decide differently.",
      "You decide every deduction and approve every document before it is sent. The tool flags rules; it does not decide disputes.",
      "Local ordinances may add interest or other duties. Check your city's rent program.",
    ],
    preparedUnder: "Prepared with Good Faith from the landlord's records, under California Civil Code 1950.5 and published state guidance. It is not legal advice.",
    noticeFooter: "Prepared with Good Faith from the landlord's records as a template under California Civil Code 1950.5, completed at the landlord's direction. It is not legal advice.",
    tenantAbout: "The rules as California Civil Code 1950.5 states them, with the facts your landlord keeps with Good Faith where they fit. It is not legal advice and does not evaluate your situation.",
    wearRefused: "Ordinary wear and tear can't be deducted (Civ. Code 1950.5(b)(2), (e)(1)-(2)).",
    statementCite: "California Civil Code 1950.5(h)",
    guidanceLabel: "DRE guidance",
    guidanceNote: "Useful-life proration and the paint schedule come from the DRE's California Tenants guide. A court may decide differently.",
    guidanceCite: "DRE guide p. 84 (guidance, not statute)",
  },

  lease: {
    evaluate,
    lawful,
    securityTotal: totalSecurity,
    securityCharge: () => true, // D1: every move-in charge but first month's rent is security
    chargeWord: "fee",
    capTip: {
      title: "The deposit cap", cite: "Civ. Code 1950.5(c)(1), (c)(5)",
      text: "One month's rent, or two for an owner who is a natural person (or an LLC of natural persons) with at most 2 rental properties and 4 units. A service member always pays at most one month. Everything charged at move-in except first month's rent counts.",
    },
    capSub: (t) => {
      const exempt = smallLandlordExempt(t);
      return exempt == null ? "Owner type unknown" : exempt ? "Two months' rent" : "One month's rent";
    },
    lawfulSub: (l, over) => (!l ? "Confirm the owner first" : over ? `Lease asks ${usd(over)} more` : "Within the cap"),
    law: [
      {
        label: "Move-in photos",
        line: "Required since Jul 1, 2025",
        fact: "Required for tenancies that began on or after July 1, 2025, and before and after every repair or cleaning that is deducted.",
        cite: "Civ. Code 1950.5(g)(1)-(2), AB 2801",
      },
      {
        label: "Electronic refunds",
        line: "Since 2026; PayPal with written consent",
        fact: "Since January 1, 2026, a landlord who received the deposit or the rent electronically must refund the deposit electronically. PayPal counts only if the tenant agreed to it in writing.",
        cite: "Civ. Code 1950.5(h)(1)(A), AB 414",
      },
      {
        label: "21-day deadline",
        line: "Statement and refund due",
        fact: "The itemized statement and the refund are due within 21 days after the tenant leaves. Bad-faith retention can cost up to twice the deposit.",
        cite: "Civ. Code 1950.5(h)(1), (m)",
      },
    ],
    steps: [
      {
        title: "Check the lease",
        text: "Claude pulls out the deposit terms and the app flags what breaks the statute, with the statute's own words beside each flag.",
        cite: "Civ. Code 1950.5(b), (c), (n)",
      },
      {
        title: "Collect the lawful deposit",
        text: "The tenants agree in writing to a PayPal refund, then pay a PayPal invoice for the lawful amount, never more than the cap.",
        cite: "Civ. Code 1950.5(c)(1), (c)(5), (h)(1)(A)",
      },
      {
        title: "Compare photos at move-out",
        text: "Claude compares move-in and move-out photos room by room and sorts wear and tear, which is never charged, from damage and cleaning. Code computes each deduction.",
        cite: "Civ. Code 1950.5(b)(2)-(3), (e)(2)(A), (g)",
      },
      {
        title: "Close out with your approval",
        text: "The agent confirms the deposit with PayPal, proposes the refund the rules allow and checks the itemized statement. You approve; it refunds through PayPal.",
        cite: "Civ. Code 1950.5(h)(1)-(2)",
      },
    ],
    invoiceNote: (l) => (l.amount < l.charged
      ? `Security deposit capped at the California limit (Civ. Code 1950.5(c)). The lease lists $${l.charged.toFixed(2)} in move-in charges; $${l.amount.toFixed(2)} is the lawful maximum.`
      : "Security deposit, held and returned under California Civil Code 1950.5."),
    invoiceTerms: "Security deposit held and returned under California Civil Code 1950.5.",
    capUnknown: "Can't tell the legal cap yet; confirm the owner type and portfolio.",
  },

  deadline: {
    days: 21,
    clockStart: (c) => c.moveOutDate,
    due: (c) => (c.moveOutDate ? addDays(c.moveOutDate, 21) : null),
    tip: { title: "21 days after move-out", cite: "Civ. Code 1950.5(h)(1)", text: "The itemized statement and the refund are due within 21 calendar days after the tenants leave." },
    summary: "21 days",
    railText: "The itemized statement and the refund are due within 21 calendar days after the tenants leave. Bad-faith retention can cost up to twice the deposit (1950.5(m)).",
    clockWord: "the 21-day clock",
    lateWarning: (n) => `The 21-day deadline passed ${days(n)} ago. Refund now; a late statement risks the whole deposit if a court finds bad faith (1950.5(h)(7), (m)).`,
    moveOutFirst: "Set the move-out date first: it starts the 21-day clock.",
    ledgerAllowed: 21,
  },

  moveOut: {
    photosTip: { title: "Before any cleaning or repair", cite: "Civ. Code 1950.5(g)(2)", text: "Photograph each room after the tenants leave and before any work that will be deducted, then again after it." },
  },

  moveIn: {
    photosFrom: MOVE_IN_PHOTOS_FROM,
    photosTip: { title: "Every room, before move-in", cite: "Civ. Code 1950.5(g)(1), AB 2801", text: "Required for tenancies that began on or after July 1, 2025. They are the evidence for anything charged at move-out." },
    photosDocTip: { title: "Move-in photos", cite: "Civ. Code 1950.5(g)(1), AB 2801", text: "Required for tenancies that began on or after July 1, 2025." },
    oldPhotosStep: {
      detail: "This tenancy began before July 1, 2025, so move-in photos were not required, but the landlord still carries the burden of proving the move-in condition at move-out. Photos, a checklist or the prior tenant's statement all help.",
      cite: "Civ. Code 1950.5(m)",
    },
    lawCheckTip: { title: "Checked against Civ. Code 1950.5", text: "The agent never collects more than the law allows. The flags stay on the lease check." },
    depositTip: { title: "The lawful deposit", cite: "Civ. Code 1950.5(c)", text: "Security is capped at one month's rent, or two for a small landlord. The invoice is never more than the cap." },
    capUnknownLine: "Confirm the owner type and portfolio size to set the cap",
  },

  refund: {
    agreementRequired: true,
    invoiceFirst: "Record the tenant's refund agreement first.",
    agreementTip: {
      title: "Refund by PayPal, in writing", cite: "Civ. Code 1950.5(h)(1)(A), (h)(1)(C)",
      text: "When the deposit or the rent is paid electronically, the deposit comes back electronically, and by PayPal only with the written agreement of every adult tenant.",
    },
    agreementText: "I agree that my security deposit, less any lawful deductions, may be returned to me electronically by PayPal at the email above (Cal. Civ. Code 1950.5(h)(1)(A)).",
    agreementStep: {
      label: "Record the tenants' refund agreement",
      detail: "When the deposit or the rent was paid electronically, the deposit comes back electronically, and by PayPal only with every adult tenant's written agreement.",
      cite: "Civ. Code 1950.5(h)(1)(A), (h)(1)(C)",
    },
    noAgreementBlocker: "No written refund-method agreement: PayPal can't be used without it (1950.5(h)(1)(A)).",
    noDesignationBlocker: "No written refund-method agreement: PayPal can't be used without it (1950.5(h)(1)(A)).",
    documentsTip: {
      title: "Refund by PayPal", cite: "Civ. Code 1950.5(h)(1)(A), (h)(1)(C)",
      text: "Since January 1, 2026, a deposit received electronically comes back electronically, and by PayPal only with every adult tenant's written agreement.",
    },
  },

  documents: {
    threshold: RECEIPT_THRESHOLD,
    afterPhotoRequired: true,
    vendorContactRequired: true,
    evidenceRequired: false,
    settlementTip: (required) => ({
      cite: `Civ. Code 1950.5(b)(1)-(3), (h)(2)-(3); ${required ? "(g)(2), (h)(2)" : "(g)(2), (h)(4)-(5)"}`,
      text: "Unpaid rent, repair of damage beyond ordinary wear and tear, and cleaning back to move-in condition. Replacements are prorated by the item's age; that proration and the paint schedule are DRE guidance, not statute. An estimate is a good-faith figure whose invoice follows within 14 days of the work.",
      docs: required
        ? `Repair and cleaning total more than ${usd(RECEIPT_THRESHOLD)}, so invoices, receipts and labor details go with the statement, with the before and after photos.`
        : `Repair and cleaning total ${usd(RECEIPT_THRESHOLD)} or less, so receipts aren't required, though the tenant can ask for them within 14 days. The before and after photos still go with it.`,
    }),
    refundCheck: (required) => (required ? "Invoices, labor and photos" : `${usd(125)} or less, not required`),
    afterPhotoTip: { title: "Before and after", cite: "Civ. Code 1950.5(g)(2)", text: "Required for every repair or cleaning deduction." },
    estimateTip: { title: "Good-faith estimate", cite: "Civ. Code 1950.5(h)(3)", text: "Deduct a good-faith estimate now, then send the invoice within 14 days of finishing." },
    noteTip: { title: "On the statement", cite: "Civ. Code 1950.5(h)(2)(D)", text: "Goes on the statement with the cost, as part of the written explanation." },
  },

  tags: {
    rent: { tag: "(b)(1)", short: "rent", label: "Unpaid rent" },
    damage: { tag: "(b)(2)", short: "damage", label: "Damage beyond ordinary wear and tear" },
    cleaning: { tag: "(b)(3)", short: "cleaning", label: "Cleaning to the move-in level" },
  },

  ledger: {
    // The cap the invoice was held to: two months only for the small natural-person owner (D3, D4).
    capTag: (l, rent) => (l && l.cap != null && rent != null && l.cap > rent
      ? { tag: "(c)(5)(A)", tagShort: "two-month cap", tagLabel: "Two months' rent allowed: an owner of no more than two properties and four units" }
      : l ? { tag: "(c)(1)", tagShort: "one-month cap", tagLabel: "Security capped at one month's rent" }
        : { tag: "(b)", tagShort: "security", tagLabel: "Every move-in charge but first month's rent is security" }),
    // The rule, not a conclusion: (h)(1)(A)(ii)(I) turns on the security or the rent arriving electronically, and a cash
    // deposit with rent paid by card still gets an electronic refund (D16).
    paymentTag: (electronic) => (electronic
      ? { tag: "(h)(1)(A)", tagShort: "electronic refund", tagLabel: "Received electronically, so the refund goes electronically" }
      : { tag: "(h)(1)(A)", tagShort: "refund method", tagLabel: "Not recorded as an electronic payment. An electronic refund is still required if the security or the rent was received electronically; otherwise personal delivery, a mailed check, or a method agreed to in writing" }),
    refundTag: { tag: "(h)(1)", tagShort: "21 days", tagLabel: "Statement and refund within 21 days of move-out" },
    // The claim-not-demand wording is the DRE guide's (LEGAL_RULES B.12), not the subsection's, so it stays in the detail.
    balanceTag: { tag: "(e)(1)", tagShort: "balance claimed", tagLabel: "Only amounts reasonably necessary for the (b) purposes may be claimed of the security",
      detail: "PayPal invoice for the balance the deductions exceed the deposit by; recorded as a claim, not a demand for payment (DRE guide)" },
    typeTip: { title: "Each row's rule", cite: "Civ. Code 1950.5", text: "Hover a type for the part of Civil Code 1950.5 behind that row. The Payments export lists it for every row." },
  },

  findings: {
    damage: { rule: "Damage beyond ordinary wear and tear", note: "May be deducted: the reasonable repair cost, and a replacement prorated by age.", cite: "Civ. Code 1950.5(b)(2)" },
    cleaning: { rule: "Cleaning back to move-in condition", note: "May be deducted, only back to how clean the unit was at move-in.", cite: "Civ. Code 1950.5(b)(3), (e)(2)(C)" },
    wear_and_tear: { rule: "Ordinary wear and tear", note: "Not chargeable under California law.", cite: "Civ. Code 1950.5(b)(2), (e)(2)(A); DRE guide pp. 83-85" },
    unclear: { rule: "Can't tell from the photos", note: "Needs a better photo before anything is charged. The landlord carries the burden of showing a deduction is reasonable.", cite: "Civ. Code 1950.5(g)(2), (m)" },
  },

  records: [
    {
      kind: "inspection", slug: "inspection", phase: "notice",
      title: "Your option to request an initial inspection before you move out",
      short: "initial-inspection notice", cite: "Civ. Code 1950.5(f)(1)", rule: "D11",
      tip: "Within a reasonable time after either party gives notice to end the tenancy, or before the end of the lease term.",
      draft: true, menu: "Inspection notice draft", methods: [["personal", "Personal delivery"], ["mail", "First-class mail"], ["email", "Email"]], toLabel: "Given to", verb: "Given",
    },
    {
      kind: "electronic_refund", slug: "electronic-refund", phase: "notice",
      title: "Your right to receive your security deposit refund electronically",
      short: "electronic-refund notice", cite: "Civ. Code 1950.5(h)(1)(A)(ii)(II)", rule: "D17",
      tip: "Within a reasonable time after notice to terminate, unless a prior written agreement on the method of return exists.",
      draft: true, menu: "Refund notice draft", methods: [["personal", "Personal delivery"], ["mail", "First-class mail"], ["email", "Email"]], toLabel: "Given to", verb: "Given",
    },
  ],

  notices: {
    refundNotice: true,
    inspection: { windowDays: 14, noticeHours: 48, lateLimitDays: null, skipIfShortNotice: null },
    sectionTip: {
      title: "The dates the move-out hangs on", cite: "Civ. Code 1950.5(f)(1), (h)(1)(A)(ii)(II)",
      text: "Set the lease end once and record the day either side gives notice. The two written notices the law asks for, and every date after them, follow from that.",
    },
    inspectionNote: "In writing, within a reasonable time after the notice: the tenants' option to request an initial inspection and to be present. The draft carries the paragraph the statute requires.",
    followTip: (windowOpens, due, passed) =>
      `${windowOpens ? `The inspection window opens ${longDate(windowOpens)}, two weeks before the move-out. ` : ""}${due && !passed ? `If they leave as planned, the statement and refund are due ${longDate(due)}, 21 days later.` : ""}${passed ? "The planned move-out has passed. Record the actual move-out date once possession is returned; the 21-day clock runs from that day." : ""}`,
    followCite: "Civ. Code 1950.5(f)(1), (h)(1)",
    datesTip: "The 60-day check-in, the day the inspection window opens, the move-out, and the 21-day statement and refund deadline, as an .ics file for Apple, Google or Outlook.",
  },

  delivery: {
    tip: {
      title: "How the statement goes out", cite: "Civ. Code 1950.5(h)(1)(B), (h)(6)",
      text: "Personal delivery or first-class mail to the address the tenant gave, or the vacated unit if none. Email only if you and the tenant agreed to it in writing.",
    },
    emailRule: "agreement",
    emailLabel: "and I agreed in writing that the itemized statement may be sent by email.",
    emailWord: "email, by written agreement",
    emailShort: "Email, by agreement",
    multipleTo: "With more than one adult tenant, the statement may go to any one of them.",
    emailRefused: "Email is allowed only when the tenant agreed to it in writing (Civ. Code 1950.5(h)(1)(B)). Confirm the agreement, or use first-class mail or personal delivery.",
    unitFallback: true,
    noForwarding: "",
    mailHint: (unit, f) => (f
      ? `${f.name ?? "The tenants"} gave this forwarding address through the tenant link on ${longDate(f.date)}. Leave it blank to use the vacated unit, ${unit}.`
      : `The forwarding address the tenant gave. Leave it blank to use the vacated unit, ${unit}.`),
    addressedCite: "Civ. Code 1950.5(h)(6)",
    toCite: "Civ. Code 1950.5(h)(1)(C)",
  },

  localOverlays: [],
};

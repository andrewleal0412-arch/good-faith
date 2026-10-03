// Washington: the Residential Landlord-Tenant Act, chapter 59.18 RCW; the deposit sections RCW 59.18.260 to 59.18.285 as
// amended by SHB 1074 (2023 c 331, effective 2023-07-23), with 59.18.030, 59.18.130(10), 59.18.253, 59.18.610 and
// 59.18.700. Source of truth: docs/rules/WA.md (rule ids W1 to W31, verified four times on 2026-10-03). No statewide
// cap; no deposit without a written move-in checklist signed by both; the deposit in a trust account; a full and
// specific statement with the invoices or estimates and the refund within 30 days after termination and vacation,
// handed over or mailed first class, or the landlord owes the full deposit. Not yet in code: W10's installment offer,
// W12, W19's materials receipt (docs/rules/README.md, Known gaps).

import { refundableSecurity, type Flag, type LeaseTerms } from "../rules";
import { addDays, longDate, MAIL_METHODS, monthsOfRent, plural, SIGNED, usd } from "./common";
import type { ClientPack } from "./types";

const R = (s: string) => `RCW ${s}`;

function evaluate(t: LeaseTerms): Flag[] {
  const flags: Flag[] = [];
  const rent = t.monthlyRent;
  const deposit = refundableSecurity(t);
  flags.push({
    id: "W2", severity: "info", title: "Signed move-in checklist before any deposit",
    detail: "No deposit may be collected unless, at the start of the tenancy, the landlord gives a written checklist describing the condition and cleanliness of, or damage to, the unit, including walls, carpets and flooring, furniture and appliances, signed and dated by landlord and tenant, with a copy to the tenant. Without it the landlord owes the deposit back.",
    cite: R("59.18.260(2)-(3), (5)"), fact: "The invoice waits for it",
  });
  flags.push({
    id: "W1", severity: "info", title: "Withholding terms in the written lease",
    detail: "A deposit needs a written lease stating the terms on which any of it may be withheld; every deduction maps to one of those terms, and damage only if the lease names it.",
    cite: R("59.18.260(1)"), fact: "Check the deposit clause",
  });
  flags.push({
    id: "W15", severity: "info", note: true, title: "No statewide deposit cap",
    detail: `Washington sets no statewide cap for these tenancies. The lease's deposit, ${usd(deposit)}${rent ? `, is ${monthsOfRent(deposit, rent)}` : ""}. Seattle, Tacoma, Bellingham and Olympia cap deposits and fees locally.`,
    cite: R("59.18.260 to 59.18.285"), fact: `${usd(deposit)}${rent ? `, ${monthsOfRent(deposit, rent)}` : ""}`,
  });
  for (const c of t.otherMoveInCharges.filter((x) => x.refundable === false)) {
    flags.push({
      id: "W5", severity: "info", title: `${c.label}: nonrefundable, kept apart`,
      detail: `A nonrefundable fee needs a written lease that clearly says so, and may never be called a deposit. ${/clean/i.test(c.label) ? "With a nonrefundable cleaning fee paid, normal cleaning may not be charged again at move-out (RCW 59.18.130(10))." : "A fee the lease doesn't label nonrefundable is a refundable deposit."}`,
      cite: R(`59.18.285${/clean/i.test(c.label) ? ", 59.18.130(10)" : ""}`), quote: c.quote, fact: `${c.label}, ${usd(c.amount)}`,
    });
  }
  for (const q of t.nonrefundableLanguage) {
    flags.push({ id: "W5", severity: "warning", title: "Nonrefundable money can't be part of the deposit", detail: "Nonrefundable money may never be called a deposit or part of one, and a fee the lease doesn't clearly label nonrefundable is refundable.", cite: R("59.18.285"), quote: q, fact: "Labeled nonrefundable" });
  }
  if (t.mandatoryCleaningClause) {
    flags.push({ id: "W21", severity: "warning", title: "No routine carpet or cleaning charge", detail: "Carpet cleaning may be charged only with documented wear beyond ordinary use, and nothing for wear resulting from ordinary use. A cleaning charge regardless of condition is not one the statement can support.", cite: R("59.18.280(1)(c)(i)-(ii)"), quote: t.mandatoryCleaningClause, fact: "Required at every move-out" });
  }
  if (t.lateFee) {
    flags.push({ id: "W29", severity: "warning", title: "No late fee within five days", detail: "No late fee for rent paid within five days of the due date, and a lease clause saying otherwise is unenforceable. A late fee comes out of the deposit only if the lease authorizes it and it was lawfully owed.", cite: R("59.18.170(2); 59.18.230(2)(i)"), quote: t.lateFee.quote, fact: `${t.lateFee.percentOfRent != null ? `${t.lateFee.percentOfRent}% of rent` : t.lateFee.amount != null ? usd(t.lateFee.amount) : "A late fee"}` });
  }
  if (t.electronicPaymentMethods.length) {
    flags.push({ id: "W16", severity: "warning", title: "Electronic payment can't be the only way", detail: "No lease clause may make electronic payment the only way to pay rent; the landlord accepts a check or money order and payment by mail. The PayPal invoice is one way to pay the deposit.", cite: R("59.18.230(2)(j); 59.18.063(1)"), fact: `Tenants can pay by ${t.electronicPaymentMethods.join(", ")}` });
  }
  if (rent && deposit + t.otherMoveInCharges.filter((c) => c.refundable === false).reduce((s, c) => s + c.amount, 0) > rent * 0.25) {
    flags.push({ id: "W10", severity: "info", note: true, title: "The tenants may pay in installments", detail: "On the tenant's written request, deposits and nonrefundable fees over 25 percent of the first full month's rent are payable in installments (three for a term of three months or more, two otherwise), with no fee or interest. Refusing costs one month's rent plus fees.", cite: R("59.18.610"), fact: "Over 25% of a month's rent" });
  }
  flags.push({ id: "W18", severity: "info", title: "A PayPal refund needs the tenants' written agreement", detail: "Washington's safe harbor is the refund handed over or mailed with the statement. A PayPal refund is outside it, so the app takes every adult tenant's written agreement and still mails the paper statement (product policy, not statute).", cite: R("59.18.280(1)(a)"), fact: "Collect it at move-in" });
  if (t.tenants.length > 1) {
    flags.push({ id: "G", severity: "info", note: true, title: `${t.tenants.length} adult tenants on the lease`, detail: "The statute names only \"the tenant\". The statement goes to every adult at each address given; the refund goes back to the paying account unless every adult signs an allocation (practice).", cite: R("59.18.280(1)(a)"), fact: t.tenants.join(", ") });
  }
  const order = { violation: 0, warning: 1, info: 2 } as const;
  return flags.sort((a, b) => order[a.severity] - order[b.severity]);
}

export const WA: ClientPack = {
  code: "WA",
  name: "Washington",
  spec: "docs/rules/WA.md",
  statute: {
    short: "RCW 59.18.280",
    full: "Washington Residential Landlord-Tenant Act, RCW 59.18.260 to 59.18.285",
    inline: "RCW 59.18.260 to 59.18.285",
    url: "https://app.leg.wa.gov/RCW/default.aspx?cite=59.18.280",
    tagCite: (tag) => tag,
  },
  chip: {
    title: "RCW 59.18.260 to 59.18.285",
    text: "This property is in Washington, so its deposit follows RCW 59.18.260 to 59.18.285: no deposit without a signed move-in checklist, the deposit in a trust account, and a full statement with the invoices and the refund within 30 days after the tenancy ends and the tenants vacate, handed over or mailed first class.",
    cite: "RCW 59.18.260 to 59.18.285",
  },
  courtsGuide: { label: "WashingtonLawHelp guide", url: "https://www.washingtonlawhelp.org/en/deposits-and-damages" },

  copy: {
    disclaimers: [
      "This tool organizes your records and fills in templates based on Washington's Residential Landlord-Tenant Act (chapter 59.18 RCW) and published guidance. It does not give legal advice, does not evaluate your specific situation, and is not a substitute for a Washington attorney.",
      "Items marked Common practice (useful-life proration, paint schedules) are not in the Washington statute. A court may decide differently.",
      "You decide every deduction and approve every document before it is sent. The tool flags rules; it does not decide disputes.",
      "Seattle, Tacoma, Bellingham, Olympia and other cities add caps, installment rules and fee limits. Check your city's rental housing program.",
    ],
    preparedUnder: "Prepared with Good Faith from the landlord's records, under Washington's Residential Landlord-Tenant Act, RCW 59.18.260 to 59.18.285. It is not legal advice.",
    noticeFooter: "Prepared with Good Faith from the landlord's records as a template under chapter 59.18 RCW, completed at the landlord's direction. It is not legal advice.",
    tenantAbout: "The rules as Washington's Residential Landlord-Tenant Act (RCW 59.18.260 to 59.18.285) states them, with the facts your landlord keeps with Good Faith where they fit. It is not legal advice and does not evaluate your situation.",
    wearRefused: "Wear resulting from ordinary use can't be deducted (RCW 59.18.280(1)(c)(i)).",
    statementCite: "RCW 59.18.280(1)",
    guidanceLabel: "Common practice",
    guidanceNote: "Useful-life proration and the paint schedule are common practice, not Washington law; the statute's only pricing limit is the damaged portion of an item. A court may decide differently.",
    guidanceCite: "Common practice, not statute; RCW 59.18.280(1)(c)(iv)",
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
    capTip: { title: "No statewide cap", cite: R("59.18.260 to 59.18.285"), text: "Washington sets no statewide cap on a deposit for these tenancies. A fee the lease doesn't clearly label nonrefundable is a refundable deposit. Seattle, Tacoma, Bellingham and Olympia cap deposits locally." },
    capSub: () => "No statewide cap",
    lawfulSub: () => "As the lease asks; no statewide cap",
    law: [
      { label: "Move-in checklist", line: "Signed by both, before any deposit", fact: "No deposit may be collected without a written checklist of the unit's condition and cleanliness, signed and dated by landlord and tenant. Without it, the landlord owes the deposit back.", cite: R("59.18.260(2)-(5)") },
      { label: "Trust account", line: "Not the PayPal balance", fact: "The deposit goes promptly into a trust account at a Washington financial institution or licensed escrow agent, and the tenant gets a receipt and the depository's name and address.", cite: R("59.18.270") },
      { label: "30-day deadline", line: "Statement, invoices and refund", fact: "Within 30 days after the tenancy ends and the tenants vacate: a full and specific statement with the estimates or invoices, and the refund, handed over or mailed. Miss it and the landlord owes the full deposit.", cite: R("59.18.280(1)-(2)") },
    ],
    steps: [
      { title: "Check the lease", text: "Claude pulls out the deposit terms and the app flags what Washington asks: withholding terms in writing, labeled nonrefundable fees, late fees and the installment right.", cite: R("59.18.260(1), 59.18.285, 59.18.610") },
      { title: "Checklist, then the deposit", text: "Both sides sign the move-in checklist, the tenants agree to a PayPal refund in writing, and then pay a PayPal invoice for the deposit; it goes into a trust account.", cite: R("59.18.260(2)-(3), 59.18.270") },
      { title: "Compare photos at move-out", text: "Claude compares move-in and move-out photos room by room and sorts wear from ordinary use, which is never charged, from damage and cleaning. Code computes each deduction.", cite: R("59.18.030, 59.18.280(1)(c)") },
      { title: "Close out with your approval", text: "Within 30 days the agent confirms the deposit with PayPal, proposes the refund and checks the statement and its invoices. You approve; it refunds through PayPal, and the paper statement goes by mail.", cite: R("59.18.280(1)") },
    ],
    invoiceNote: () => "Security deposit, held in a trust account and returned under RCW 59.18.260 to 59.18.285.",
    invoiceTerms: "Security deposit held in trust and returned under RCW 59.18.260 to 59.18.285.",
    capUnknown: "Enter the deposit amount from the lease first.",
  },

  deadline: {
    days: 30,
    clockStart: (c) => c.moveOutDate,
    due: (c) => (c.moveOutDate ? addDays(c.moveOutDate, 30) : null),
    tip: { title: "30 days after move-out", cite: R("59.18.280(1)(a)"), text: "Within 30 days after the tenancy ends and the tenants vacate: a full and specific statement of the basis for keeping any of the deposit, with the invoices or estimates, and the refund, handed over or mailed first class." },
    summary: "30 days",
    railText: "Within 30 days after the tenancy ends and the tenants vacate, the statement with its invoices and the refund. Miss it and the landlord owes the full deposit and may keep none of it; an intentional refusal can cost up to twice the deposit (RCW 59.18.280(2)).",
    clockWord: "the 30-day clock",
    lateWarning: (n) => `The 30th day passed ${plural(n, "day")} ago. Washington makes the landlord liable for the full deposit and bars any claim to keep part of it, unless circumstances were beyond the landlord's control (RCW 59.18.280(2)). Refund it in full now.`,
    moveOutFirst: "Set the move-out date first: the day the tenants vacate starts the 30-day clock.",
    ledgerAllowed: 30,
  },

  moveOut: {
    photosTip: { title: "Before any cleaning or repair", cite: R("59.18.280(1)(b)-(c)"), text: "Not required by statute; the checklist is the record that counts. Photograph each room after the tenants leave to support each checklist line and the damaged-portion pricing." },
  },

  moveIn: {
    photosFrom: null,
    photosTip: { title: "Every room, before move-in", cite: R("59.18.260(2)"), text: "Photos support the written checklist line by line; they do not replace it. The checklist, signed by both, is what Washington requires." },
    photosDocTip: { title: "Move-in photos", cite: R("59.18.260(2)"), text: "Support for the signed checklist, which is what the statute requires." },
    oldPhotosStep: { detail: "Washington requires the signed checklist, not photos; photos support each line of it. Add them to the move-in record.", cite: R("59.18.260(2)") },
    lawCheckTip: { title: "Checked against RCW 59.18", text: "The flags stay on the lease check. No statewide cap: the invoice is the deposit the lease asks for, after the checklist." },
    depositTip: { title: "The deposit", cite: R("59.18.260(2), 59.18.270"), text: "No statewide cap. No deposit may be collected before the signed checklist; once paid it goes into a trust account, not the PayPal balance." },
    capUnknownLine: "Enter the deposit amount to send the invoice",
  },

  refund: {
    agreementRequired: true,
    invoiceFirst: "Record the tenants' refund agreement first.",
    agreementTip: { title: "Refund by PayPal, in writing", cite: R("59.18.280(1)(a)"), text: "Washington's safe harbor is the refund with the statement, handed over or mailed. A PayPal refund is outside it, so the app takes every adult tenant's written agreement to it (product policy, not statute) and still mails the paper statement with the PayPal refund id." },
    agreementText: "We agree that our security deposit, less any lawful deductions, may be refunded electronically by PayPal at the email above. The itemized statement still comes to us in person or by first-class mail (RCW 59.18.280(1)(a)).",
    agreementStep: { label: "Record the tenants' refund agreement", detail: "A PayPal refund is outside Washington's mail safe harbor, so the app takes every adult tenant's written agreement first (product policy).", cite: R("59.18.280(1)(a)") },
    noAgreementBlocker: "No written agreement to a PayPal refund: Washington's safe harbor is the refund mailed or handed over with the statement, so the app needs the tenants' written agreement first (RCW 59.18.280(1)(a); product policy).",
    noDesignationBlocker: "No written agreement to a PayPal refund (RCW 59.18.280(1)(a); product policy).",
    documentsTip: { title: "Refund by PayPal", cite: R("59.18.280(1)(a)"), text: "A PayPal refund is outside the mail safe harbor, so it needs every adult tenant's written agreement (product policy); the paper statement still goes by hand or mail." },
  },

  documents: {
    threshold: 0,
    afterPhotoRequired: false,
    vendorContactRequired: false,
    evidenceRequired: false,
    settlementTip: () => ({
      cite: R("59.18.280(1)(b)-(c), (4); 59.18.130(10)"),
      text: "Rent and other charges owing, and repair or cleaning of damage beyond wear from ordinary use, each tied to a withholding term of the lease and, for damage, to its line on the move-in checklist. Partial damage is priced as the damaged portion; proration by age is common practice only.",
      docs: "Every damage charge goes with its estimate or invoice, or the time spent and hourly rate for your own work; no dollar threshold excuses them. Rent and other charges need none.",
    }),
    refundCheck: () => "Estimates, invoices and labor",
    afterPhotoTip: { title: "After the work", cite: R("59.18.280(1)(b)"), text: "Not required by statute; the estimate or invoice is." },
    estimateTip: { title: "Estimate", cite: R("59.18.280(1)(b)"), text: "Washington accepts copies of estimates received, as well as invoices paid, to substantiate a damage charge." },
    noteTip: { title: "On the statement", cite: R("59.18.280(1)(a)"), text: "Goes on the full and specific statement of the basis for keeping the deposit." },
  },

  tags: {
    rent: { tag: R("59.18.280(4)"), short: "rent", label: "Rent or other charges owing" },
    damage: { tag: R("59.18.280(1)(b)-(c)"), short: "damage", label: "Damage beyond wear from ordinary use, documented on the checklist" },
    cleaning: { tag: R("59.18.280(1)(b)-(c)"), short: "cleaning", label: "Cleaning beyond normal, with its documents" },
  },

  ledger: {
    capTag: () => ({ tag: R("59.18.270"), tagShort: "trust account", tagLabel: "Held in a trust account at a Washington financial institution; no statewide cap" }),
    paymentTag: () => ({ tag: R("59.18.270"), tagShort: "trust account", tagLabel: "Received: goes promptly into a trust account, with a receipt and the depository notice" }),
    refundTag: { tag: R("59.18.280(1)(a)"), tagShort: "30 days", tagLabel: "Statement, documents and refund within 30 days after termination and vacation" },
    balanceTag: { tag: R("59.18.280(3)"), tagShort: "balance claimed", tagLabel: "Damage beyond the deposit, stated as a claim", detail: "PayPal invoice for the balance the deductions exceed the deposit by; recorded as a claim, not a demand for payment" },
    typeTip: { title: "Each row's rule", cite: R("59.18.260 to 59.18.285"), text: "Hover a type for the part of chapter 59.18 RCW behind that row. The Payments export lists it for every row." },
  },

  findings: {
    damage: { rule: "Damage beyond wear from ordinary use", note: "May be deducted with its estimate or invoice, if the item's condition was on the move-in checklist; partial damage at the damaged portion's cost.", cite: R("59.18.280(1)(b)-(c)") },
    cleaning: { rule: "Cleaning beyond normal", note: "May be deducted with its documents; not normal cleaning after a nonrefundable cleaning fee.", cite: R("59.18.280(1)(b); 59.18.130(10)") },
    wear_and_tear: { rule: "Wear resulting from ordinary use", note: "Not chargeable under Washington law, nor breakage or malfunction from age.", cite: R("59.18.030, 59.18.280(1)(c)(i)") },
    unclear: { rule: "Can't tell from the photos", note: "Needs a better photo, and the checklist line, before anything is charged.", cite: R("59.18.280(1)(c)(iii)") },
  },

  records: [
    {
      kind: "move_in_checklist", slug: "move-in-checklist", phase: "move_in", beforeInvoice: true,
      title: "Move-in condition checklist", short: "move-in checklist", cite: R("59.18.260(2)-(3)"), rule: "W2",
      tip: "No deposit may be collected unless, at the start of the tenancy, the landlord gives a written checklist describing the condition and cleanliness of, or damage to, the unit, including walls, carpets and flooring, furniture and appliances, signed and dated by landlord and tenant, with a copy to the tenant.",
      when: "Signed by both at the start of the tenancy, before the deposit is collected.", draft: true, menu: "Move-in checklist",
      methods: SIGNED, toLabel: "Signed with", verb: "Signed",
      form: { method: "How it was signed", date: "Date signed", button: "Record the signed checklist" },
      heading: "RCW 59.18.260(2)-(3)",
      draftBody: (c) => [
        { p: `Condition and cleanliness of ${c.address} at the start of the tenancy, room by room. Note any existing damage; a charge at move-out needs its line here.` },
        { list: ["Walls (paint and wallpaper): [[blank:w-72]]", "Carpets and other flooring: [[blank:w-72]]", "Furniture: [[blank:w-72]]", "Appliances: [[blank:w-72]]", "Fixtures, equipment and other furnishings: [[blank:w-72]]", "Cleanliness: [[blank:w-72]]"] },
        { p: "Signed and dated by the landlord and the tenant. The tenant keeps a copy and may ask for one free replacement copy." },
      ],
      response: ["I received a copy of this checklist."],
    },
    {
      kind: "deposit_account", slug: "deposit-account", phase: "move_in",
      title: "Deposit receipt and trust account notice", short: "trust account notice", cite: R("59.18.270"), rule: "W6-W7",
      tip: "Put the deposit promptly into a trust account at a Washington financial institution or licensed escrow agent (a PayPal balance is not one), and give the tenant a written receipt and the name, address and location of the depository, and notice of any later change.",
      when: "Promptly once the deposit is paid.", draft: true, menu: "Deposit receipt",
      methods: MAIL_METHODS, toLabel: "Given to", verb: "Given",
      detail: { label: "Trust account: institution, address and location", required: true, placeholder: "Bank, branch address" },
      heading: "RCW 59.18.270",
      draftBody: (c) => [
        { p: `Received from ${c.tenants}: a security deposit${c.deposit ? ` of ${usd(c.deposit.amount)}` : " of [[blank:w-32]]"} for ${c.address}${c.deposit?.paypalId ? `, paid through PayPal invoice ${c.deposit.paypalId}` : ""}.` },
        { p: "The deposit is held in a trust account at: [[blank:w-72]] (name), [[blank:w-72]] (address and location). You will be told in writing of any change of depository." },
        { p: "Interest on the trust account belongs to the landlord unless we agree otherwise in writing." },
      ],
    },
  ],

  notices: {
    refundNotice: false,
    inspection: null,
    sectionTip: { title: "The dates the move-out hangs on", cite: R("59.18.280(1)(a)"), text: "Set the lease end once and record the day either side gives notice. Washington asks no notice back about the deposit; the 30-day clock starts when the tenancy ends and the tenants vacate." },
    inspectionNote: "",
    followTip: (_w, due, passed) => (passed ? "The planned move-out has passed. Record the actual move-out date once the tenants vacate; the 30-day clock runs from that day."
      : due ? `If they leave as planned, the statement, its invoices and the refund are due ${longDate(due)}, 30 days later.` : ""),
    followCite: R("59.18.280(1)(a)"),
    datesTip: "The 60-day check-in, the move-out, and the 30-day statement and refund deadline, as an .ics file for Apple, Google or Outlook.",
  },

  delivery: {
    tip: { title: "How the statement goes out", cite: R("59.18.280(1)(a)"), text: "Hand it to the tenant, or mail it first class, postage prepaid, to the tenant's last known address within the 30 days, with the refund. Email is a courtesy copy only." },
    emailRule: "courtesy",
    emailLabel: "",
    emailWord: "email, as a courtesy copy",
    emailShort: "Email, courtesy copy",
    multipleTo: "The statute names only \"the tenant\"; send the statement to every adult at each address given and record the one it is addressed to (practice).",
    emailRefused: "In Washington the statement is delivered by hand or first-class mail to the last known address; email is a courtesy copy only (RCW 59.18.280(1)(a)).",
    unitFallback: true,
    noForwarding: "",
    mailHint: (unit, f) => (f
      ? `${f.name ?? "The tenants"} gave this forwarding address through the tenant link on ${longDate(f.date)}: the last known address. Leave it blank to use the vacated unit, ${unit}.`
      : `The tenant's last known address. Leave it blank to use the vacated unit, ${unit}.`),
    addressedCite: R("59.18.280(1)(a)"),
    toCite: R("59.18.280(1)(a)"),
  },

  localOverlays: [
    { city: "Seattle", match: /^seattle$/i, line: "SMC 7.24: deposit plus nonrefundable move-in fees at most the first full month's rent; nonrefundable fees only for screening and move-out cleaning, at most 10 percent; installments on request; pet damage deposit at most 25 percent; double damages for a deposit unlawfully withheld. CB 121254 adds fee rules from 2027-07-01." },
    { city: "Tacoma", match: /^tacoma$/i, line: "TMC 1.95 and 1.100: move-in fees in total at most the first month's rent; pet damage deposit at most 25 percent; installments on request; late fees at most 1.5 percent of unpaid monthly rent." },
    { city: "Bellingham", match: /^bellingham$/i, line: "BMC 6.16 (from 2025-08-01): refundable deposit at most one month's rent; pet damage deposit at most 30 percent; only the listed fees may be charged." },
    { city: "Olympia", match: /^olympia$/i, line: "OMC 5.82: refundable deposit or last month's rent at most one month's rent; pet damage deposit at most 25 percent, returned or itemized within 30 days; late fees at most $10 a month." },
    { city: "Auburn, Aberdeen, Burien, SeaTac", match: /^(auburn|aberdeen|burien|seatac)$/i, line: "Named by WashingtonLawHelp as cities with rental fee limits; not verified here." },
  ],
};

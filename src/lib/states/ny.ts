// New York: General Obligations Law article 7, title 1 (7-103, 7-105, 7-107, 7-108, 7-109), with Real Property Law
// 235-g and 238-a and General Construction Law 20 and 25-a. Source of truth: docs/rules/NY.md (rule ids N1 to N32,
// verified twice on 2026-10-03). A one-month cap on the deposit and advance together, the deposit held in trust (in an
// interest-bearing New York bank account for six or more units), a move-in inspection offer, a pre-move-out inspection
// on request, and the itemized statement and the rest of the deposit within 14 days, or every deduction is forfeited.
// A 14th day on a Saturday, Sunday or public holiday runs to the next business day (GCL 25-a, N20); after it, nothing
// may be kept (N21): a hard block since Andrew's decision of 2026-10-04, with no override, so the close-out refunds
// only the whole deposit. This pack applies 7-108; a rent stabilized unit follows 7-107, which says the same for leases
// from 2025-11-15. Not yet in code: N14 as a block before occupancy, N24, the interest line's fields
// (docs/rules/README.md, Known gaps).

import type { Flag, LeaseTerms } from "../rules";
import { addDays, daysBetween, longDate, MAIL_METHODS, plural, usd } from "./common";
import type { ClientPack } from "./types";

const G = (s: string) => `N.Y. GOL ${s}`;

/** New York's public holidays in a year, as General Construction Law 24 lists them (read on nysenate.gov 2026-10-03):
 *  New Year's Day, Martin Luther King Jr. Day (third Monday of January), Lincoln's Birthday (February 12), Washington's
 *  Birthday (third Monday of February), Memorial Day (last Monday of May), Juneteenth, Independence Day, Labor Day (first
 *  Monday of September), Columbus Day (second Monday of October), Veterans' Day (November 11), Thanksgiving (fourth
 *  Thursday of November), Christmas, the Monday after any of the fixed days that falls on a Sunday, and general election
 *  day (the Tuesday after the first Monday of November). Flag Day is always a Sunday, which 25-a already skips. */
export function nyHolidays(year: number): Set<string> {
  const day = (m: number, d: number) => `${year}-${String(m).padStart(2, "0")}-${String(d).padStart(2, "0")}`;
  const weekday = (iso: string) => new Date(`${iso}T12:00:00Z`).getUTCDay();
  const nth = (m: number, wd: number, n: number) => { let d = day(m, 1); while (weekday(d) !== wd) d = addDays(d, 1); return addDays(d, 7 * (n - 1)); };
  const lastOf = (m: number, wd: number) => { let d = addDays(day(m + 1, 1), -1); while (weekday(d) !== wd) d = addDays(d, -1); return d; };
  const fixed = [day(1, 1), day(2, 12), day(6, 19), day(7, 4), day(11, 11), day(12, 25)];
  const out = new Set([...fixed, nth(1, 1, 3), nth(2, 1, 3), lastOf(5, 1), nth(9, 1, 1), nth(10, 1, 2), nth(11, 4, 4), addDays(nth(11, 1, 1), 1)]);
  for (const f of fixed) if (weekday(f) === 0) out.add(addDays(f, 1));
  return out;
}

/** N20: General Construction Law 25-a. When the 14th day falls on a Saturday, Sunday or public holiday, the statement and
 *  refund may go out on the next business day. The app still targets day 14 and shows this as information. */
export function nyLastDay(due: string): string {
  let d = due;
  const off = (iso: string) => { const wd = new Date(`${iso}T12:00:00Z`).getUTCDay(); return wd === 0 || wd === 6 || nyHolidays(Number(iso.slice(0, 4))).has(iso); };
  while (off(d)) d = addDays(d, 1);
  return d;
}

/** N19 to N21: whether day 14 (as General Construction Law 25-a runs it) passed before both the itemized statement and
 *  the rest of the deposit went out, which forfeits any right to retain any portion of the deposit (GOL 7-108(1-a)(e)).
 *  Late when the statement wasn't delivered by the last day, or when part of the deposit was owed back and didn't go
 *  by then; a step still undone counts as late once the last day is behind `today`. Null before the move-out. The
 *  close-out, the statement, the next step, the tenant page and the dispute all read this one rule. */
export function nyLate(c: { due: string | null; today: string; deliveredOn: string | null; returnedOn: string | null; refundOwed: boolean }):
  { due: string; last: string; late: boolean; missed: "statement" | "refund" | null } | null {
  if (!c.due) return null;
  const last = nyLastDay(c.due);
  const missed = (on: string | null) => (on ? on > last : c.today > last);
  const what = missed(c.deliveredOn) ? "statement" : c.refundOwed && missed(c.returnedOn) ? "refund" : null;
  return { due: c.due, last, late: !!what, missed: what };
}

/** A move-in charge that is a fee rather than a deposit or prepaid rent: barred by RPL 238-a(1). */
const isFee = (c: LeaseTerms["otherMoveInCharges"][number]) => c.refundable === false || (!/deposit|rent/i.test(c.label) && /fee|charge/i.test(c.label));

/** N7: the deposit and any prepaid rent together, the first month's rent at signing not counted. */
const securityOf = (t: LeaseTerms) => (t.securityDeposit ?? 0) + t.otherMoveInCharges.filter((c) => !isFee(c)).reduce((s, c) => s + c.amount, 0);

function evaluate(t: LeaseTerms): Flag[] {
  const flags: Flag[] = [];
  const rent = t.monthlyRent;
  const security = securityOf(t);

  // N7: one month's rent.
  if (!rent) {
    flags.push({ id: "N7", severity: "warning", title: "Can't tell the cap", detail: "The deposit and any advance together may not exceed one month's rent. The lease's rent wasn't found; confirm it.", cite: G("7-108(1-a)(a)"), fact: "Monthly rent not found" });
  } else if (security > rent) {
    flags.push({
      id: "N7", severity: "violation", title: "Deposit and advance over one month's rent",
      detail: `No deposit or advance may exceed one month's rent; the deposit and any prepaid rent count together, and the first month's rent at signing does not. The lease asks ${usd(security)}; the cap is ${usd(rent)}. Excess: ${usd(security - rent)}. A registered seasonal unit and an owner-occupied co-op are the only exceptions.`,
      cite: G("7-108(1-a)(a)"), fact: `Lease asks ${usd(security)}, cap ${usd(rent)}`,
    });
  }

  // N10: no fee before or at the start of the tenancy, except a background check of at most $20.
  for (const c of t.otherMoveInCharges.filter(isFee)) {
    flags.push({
      id: "N10", severity: "violation", title: `${c.label}: fee not allowed`,
      detail: "No payment, fee or charge may be collected before or at the start of a tenancy except the deposit, the rent and a background and credit check fee of the actual cost or $20, whichever is less, with a copy of the report and the invoice. Pet, key, move-in and nonrefundable cleaning fees are barred.",
      cite: "N.Y. RPL 238-a(1)", quote: c.quote, fact: `${c.label}, ${usd(c.amount)}`,
    });
  }

  // N11: waivers are void.
  for (const q of t.nonrefundableLanguage) {
    flags.push({ id: "N11", severity: "violation", title: "\"Nonrefundable\" deposit", detail: "A lease clause by which the tenant waives the deposit rules, such as a nonrefundable deposit or a waiver of the 14 days, is absolutely void.", cite: G("7-108(3)"), quote: q, fact: "Labeled nonrefundable" });
  }

  // N13: late fees are not deductible, and are capped.
  if (t.lateFee) {
    const cap = rent ? Math.min(50, rent * 0.05) : 50;
    const amount = t.lateFee.amount ?? (t.lateFee.percentOfRent != null && rent ? (rent * t.lateFee.percentOfRent) / 100 : null);
    flags.push({
      id: "N13", severity: t.lateFee.deductibleFromDeposit ? "violation" : "warning",
      title: t.lateFee.deductibleFromDeposit ? "Late fee can't come out of the deposit" : "Late fee limits",
      detail: `Late fees are not one of the four things a deposit may cover, so they can't be deducted. Separately, a late fee is lawful only when rent is unpaid five days after it was due, and may not exceed $50 or 5 percent of the monthly rent, whichever is less${amount != null ? `; this lease's is ${usd(amount)} against ${usd(cap)}` : ""}.`,
      cite: `${G("7-108(1-a)(b)")}; N.Y. RPL 238-a(2)`, quote: t.lateFee.quote,
      fact: `${amount != null ? usd(amount) : "A late fee"}${t.lateFee.deductibleFromDeposit ? ", taken from the deposit" : ""}`,
    });
  }

  if (t.mandatoryCleaningClause) {
    flags.push({ id: "N12", severity: "warning", title: "Cleaning only beyond wear and tear", detail: "A deposit may cover cleaning only when it restores a condition beyond normal wear and tear, as damage caused by the tenant. A cleaning charge regardless of condition is not one of the four allowed deductions.", cite: G("7-108(1-a)(b)"), quote: t.mandatoryCleaningClause, fact: "Required at every move-out" });
  }

  // N2 to N4: trust, bank notice, interest for six or more units.
  const units = t.buildingUnitCount;
  if (units == null) {
    flags.push({ id: "N4", severity: "warning", title: "How many units does the building have?", detail: "In a building of six or more units, the deposit must go into an interest-bearing account at a New York bank, and the tenant gets the interest less 1 percent a year. The lease doesn't say how many units there are; confirm it.", cite: G("7-103(2-a)"), fact: "Unit count not in the lease" });
  } else if (units >= 6) {
    flags.push({ id: "N4", severity: "info", title: "Interest-bearing account required", detail: `The building has ${units} units, so the deposit goes into an interest-bearing account at a New York bank, at the prevailing rate. The landlord may keep 1 percent a year; the rest of the interest is the tenant's.`, cite: G("7-103(2)-(2-a)"), fact: `${units} units in the building` });
  }
  flags.push({ id: "N2", severity: "info", title: "Hold the deposit in trust", detail: "The deposit stays the tenant's money, held in trust and not mingled with the landlord's own; a PayPal balance next to rent is mingled. When it goes into a bank, the tenant gets written notice of the bank's name and address and the amount.", cite: G("7-103(1)-(2)"), fact: "Move it out of the PayPal balance" });

  // N14: the move-in inspection offer.
  flags.push({ id: "N14", severity: "info", title: "Offer a move-in inspection", detail: "After the lease is signed and before the tenant moves in, offer the tenant an inspection; if asked, both sign a written agreement on the unit's condition before occupancy. Nothing noted on it can be deducted later.", cite: G("7-108(1-a)(c)"), fact: t.tenancyStartDate ? `Before ${longDate(t.tenancyStartDate)}` : "Before move-in" });

  // N32: never electronic-only, never a fee for paying another way.
  if (t.electronicPaymentMethods.length) {
    flags.push({ id: "N32", severity: "warning", title: "Offer a way to pay that isn't electronic", detail: `The lease names ${t.electronicPaymentMethods.join(", ")}. An electronic system may not be the only way to pay rent, and a tenant who declines it may not be charged for that; the app treats the PayPal invoice as one way to pay the deposit, never the only one.`, cite: "N.Y. RPL 235-g", fact: `Tenants can pay by ${t.electronicPaymentMethods.join(", ")}` });
  }

  flags.push({ id: "N21", severity: "info", note: true, title: "14 days, or every deduction is forfeited", detail: "Within 14 days after the tenant vacates: an itemized statement of the basis for any amount kept, and the rest of the deposit. Missing it forfeits any right to keep any part.", cite: G("7-108(1-a)(e)"), fact: "Statement and refund by day 14" });
  flags.push({ id: "N1", severity: "info", note: true, title: "Rent stabilized? 7-107 instead", detail: "This tool applies 7-108. A rent stabilized unit follows 7-107 for leases and renewals from November 15, 2025, with the same cap, inspections and 14 days, plus the Rent Stabilization Code's deposit rules. Rent controlled units are outside both.", cite: G("7-107, 7-108(1)"), fact: "Check the unit's status" });

  if (t.tenants.length > 1) {
    flags.push({ id: "N29", severity: "info", note: true, title: `${t.tenants.length} adult tenants on the lease`, detail: "The statute is silent on several tenants. By default the refund goes back to the original payment and the statement to every adult; a split needs an allocation every adult signs (practice).", cite: G("7-108(1-a)(e)"), fact: t.tenants.join(", ") });
  }
  const order = { violation: 0, warning: 1, info: 2 } as const;
  return flags.sort((a, b) => order[a.severity] - order[b.severity]);
}

export const NY: ClientPack = {
  code: "NY",
  name: "New York",
  spec: "docs/rules/NY.md",
  statute: {
    short: "N.Y. GOL 7-108",
    full: "New York General Obligations Law 7-103 to 7-109",
    inline: "New York General Obligations Law 7-103 to 7-109",
    url: "https://www.nysenate.gov/legislation/laws/GOB/7-108",
    tagCite: (tag) => tag,
  },
  chip: {
    title: "New York General Obligations Law 7-103 to 7-109",
    text: "This property is in New York, so its deposit follows General Obligations Law 7-103 and 7-108 (7-107 for rent stabilized units): a one-month cap, the deposit held in trust, a move-in inspection offer, an inspection before move-out on request, and the itemized statement and refund within 14 days, or every deduction is forfeited.",
    cite: "N.Y. GOL 7-103, 7-107, 7-108",
  },
  courtsGuide: { label: "Attorney General's guide", url: "https://ag.ny.gov/publications/residential-tenants-rights-guide" },

  copy: {
    disclaimers: [
      "This tool organizes your records and fills in templates based on New York General Obligations Law sections 7-103 to 7-109 and published state guidance. It does not give legal advice, does not evaluate your specific situation, and is not a substitute for a New York attorney.",
      "Items marked Common practice (the wear-and-tear table, useful-life proration) are not in the New York statute. A court may decide differently.",
      "You decide every deduction and approve every document before it is sent. The tool flags rules; it does not decide disputes.",
      "Local rules may add duties: rent stabilization in New York City and ETPA municipalities, and New York City's fee disclosure law. Check your city.",
    ],
    preparedUnder: "Prepared with Good Faith from the landlord's records, under New York General Obligations Law 7-103 to 7-109 and published state guidance. It is not legal advice.",
    noticeFooter: "Prepared with Good Faith from the landlord's records as a template under New York General Obligations Law 7-108, completed at the landlord's direction. It is not legal advice.",
    tenantAbout: "The rules as New York General Obligations Law 7-103 and 7-108 state them, with the facts your landlord keeps with Good Faith where they fit. It is not legal advice and does not evaluate your situation.",
    wearRefused: "Ordinary wear and tear can't be deducted (N.Y. GOL 7-108(1-a)(b)).",
    statementCite: "New York General Obligations Law 7-108(1-a)(e)",
    guidanceLabel: "Common practice",
    guidanceNote: "Useful-life proration and the paint schedule are common practice, not New York law. The landlord carries the burden of proof, and a prorated charge is easier to defend. A court may decide differently.",
    guidanceCite: "Common practice, not statute; N.Y. GOL 7-108(1-a)(f)",
  },

  lease: {
    evaluate,
    lawful: (t) => {
      if (!t.monthlyRent) return null;
      const charged = securityOf(t);
      return { amount: Math.min(charged, t.monthlyRent), cap: t.monthlyRent, charged };
    },
    securityTotal: securityOf,
    securityCharge: (c) => !isFee(c), // N7: deposits and prepaid rent count; fees are barred, not invoiced
    chargeWord: "charge",
    capTip: { title: "The deposit cap", cite: G("7-108(1-a)(a)"), text: "One month's rent for the deposit and any prepaid rent together; the first month's rent at signing doesn't count. Move-in, pet and key fees are barred altogether (RPL 238-a)." },
    capSub: () => "One month's rent",
    lawfulSub: (l, over) => (!l ? "Confirm the rent first" : over ? `Lease asks ${usd(over)} more` : "Within the cap"),
    law: [
      { label: "One-month cap", line: "Deposit and advance together", fact: "No deposit or advance may exceed one month's rent, and no other fee may be charged at the start of a tenancy except a background check of at most $20.", cite: `${G("7-108(1-a)(a)")}; N.Y. RPL 238-a` },
      { label: "Inspections", line: "At move-in, and before move-out", fact: "Offer an inspection before the tenant moves in, and tell the tenant in writing of the right to one before moving out, with the chance to fix what it finds.", cite: G("7-108(1-a)(c)-(d)") },
      { label: "14-day deadline", line: "Or every deduction is forfeited", fact: "The itemized statement and the rest of the deposit are due within 14 days after the tenant vacates; miss it and the landlord forfeits any right to keep any part.", cite: G("7-108(1-a)(e)") },
    ],
    steps: [
      { title: "Check the lease", text: "Claude pulls out the deposit terms and the app flags what New York bars: a deposit and advance over one month's rent, move-in fees, nonrefundable clauses and late fees taken from the deposit.", cite: `${G("7-108(1-a)(a)-(b), (3)")}; N.Y. RPL 238-a` },
      { title: "Collect the lawful deposit", text: "The tenants name their PayPal account and pay a PayPal invoice for at most one month's rent; the money then goes into a trust account, not the PayPal balance.", cite: G("7-103(1), 7-108(1-a)(a)") },
      { title: "Compare photos at move-out", text: "Claude compares move-in and move-out photos room by room and sorts wear and tear, which is never charged, from damage. Code computes each deduction.", cite: G("7-108(1-a)(b)") },
      { title: "Close out with your approval", text: "Within 14 days of the move-out the agent confirms the deposit with PayPal, proposes the refund and checks the itemized statement. You approve; it refunds through PayPal.", cite: G("7-108(1-a)(e)") },
    ],
    invoiceNote: (l) => (l.cap != null && l.amount < l.charged
      ? `Security deposit capped at one month's rent (N.Y. GOL 7-108(1-a)(a)). The lease lists $${l.charged.toFixed(2)}; $${l.amount.toFixed(2)} is the lawful maximum. Other ways to pay are available on request; no fee for using them (RPL 235-g).`
      : "Security deposit, held in trust and returned under New York General Obligations Law 7-103 and 7-108. Other ways to pay are available on request; no fee for using them (RPL 235-g)."),
    invoiceTerms: "Security deposit held in trust and returned under New York General Obligations Law 7-103 and 7-108.",
    capUnknown: "Can't tell the cap yet; confirm the monthly rent.",
  },

  deadline: {
    days: 14,
    clockStart: (c) => c.moveOutDate,
    due: (c) => (c.moveOutDate ? addDays(c.moveOutDate, 14) : null),
    tip: { title: "14 days after move-out", cite: `${G("7-108(1-a)(e)")}; N.Y. Gen. Constr. Law 25-a`, text: "The itemized statement and the rest of the deposit are due within 14 days after the tenants vacate. A 14th day that falls on a Saturday, Sunday or public holiday runs to the next business day. Missing it forfeits any right to keep any part of the deposit, so after it Good Faith keeps no deduction: the whole deposit goes back." },
    summary: "14 days",
    railText: "The itemized statement and the rest of the deposit are due within 14 days after the tenants vacate; a 14th day on a weekend or public holiday runs to the next business day (GCL 25-a). Miss it and the landlord forfeits every deduction (7-108(1-a)(e)); a willful violation can cost up to twice the deposit (7-108(1-a)(g)).",
    clockWord: "the 14-day clock",
    lateWarning: (n, due) => {
      const last = nyLastDay(due);
      return n <= daysBetween(due, last)
        ? `Day 14 after the move-out, ${longDate(due)}, fell on a weekend or public holiday, so General Construction Law 25-a runs it to ${longDate(last)}: the statement and the rest of the deposit are still on time if they go out by then (N.Y. GOL 7-108(1-a)(e)).`
        : `The 14th day after the move-out passed ${plural(n, "day")} ago${last !== due ? ` (General Construction Law 25-a ran it to ${longDate(last)})` : ""}. Unless the statement and the rest of the deposit went out by then, New York forfeits any right to keep any part of the deposit (N.Y. GOL 7-108(1-a)(e)).`;
    },
    lastDay: nyLastDay,
    moveOutFirst: "Set the move-out date first: the day the tenants vacate starts the 14-day clock.",
    ledgerAllowed: 14,
  },

  moveOut: {
    photosTip: { title: "Before any cleaning or repair", cite: G("7-108(1-a)(f)"), text: "Not required by statute, but the landlord bears the burden of proof: photograph each room after the tenants leave and before any work that will be deducted, then again after it." },
  },

  moveIn: {
    photosFrom: null,
    photosTip: { title: "Every room, before move-in", cite: G("7-108(1-a)(c), (f)"), text: "Not required by statute, but the landlord bears the burden of proof, and the condition agreement covers only what the tenant asks to note. They are the evidence for anything charged at move-out." },
    photosDocTip: { title: "Move-in photos", cite: G("7-108(1-a)(f)"), text: "Not required in New York; evidence for the landlord's burden of proof at move-out." },
    oldPhotosStep: { detail: "New York doesn't require move-in photos, but the landlord bears the burden of proof at move-out. Photos and the move-in condition agreement help.", cite: G("7-108(1-a)(f)") },
    lawCheckTip: { title: "Checked against N.Y. GOL 7-108", text: "The agent never collects more than one month's rent. The flags stay on the lease check." },
    depositTip: { title: "The lawful deposit", cite: G("7-108(1-a)(a)"), text: "The deposit and any advance together are capped at one month's rent. The invoice is never more than the cap." },
    capUnknownLine: "Confirm the monthly rent to set the cap",
  },

  refund: {
    agreementRequired: false,
    invoiceFirst: "Record the tenants' PayPal account first.",
    agreementTip: { title: "The tenants' PayPal account", cite: G("7-108(1-a)(e)"), text: "New York names no refund method: the rest of the deposit goes back to the tenant. The invoice goes to this account and the refund comes back against the payment, which needs no agreement; a Payout to another account needs the tenants' written designation." },
    agreementText: "We designate the PayPal account at the email above for the security deposit invoice and its refund, less any lawful deductions (N.Y. GOL 7-108(1-a)(e)).",
    agreementStep: { label: "Record the tenants' PayPal account", detail: "The deposit invoice goes to it and the refund comes back to it. New York names no refund method; a Payout to another account needs the tenants' written designation.", cite: G("7-108(1-a)(e)") },
    noAgreementBlocker: "",
    noDesignationBlocker: "The deposit payment can't be refunded against itself (no PayPal payment record, or past PayPal's 180-day window), and no account is designated in writing for a Payout. Record the tenants' PayPal account first (N.Y. GOL 7-108(1-a)(e); product policy).",
    documentsTip: { title: "Refund account", cite: G("7-108(1-a)(e)"), text: "New York names no refund method. The refund goes back against the deposit payment; another account needs the tenants' written designation (product policy)." },
  },

  documents: {
    threshold: null,
    afterPhotoRequired: false,
    vendorContactRequired: false,
    evidenceRequired: false,
    settlementTip: () => ({
      cite: G("7-108(1-a)(b), (f)"),
      text: "Unpaid rent, damage beyond normal wear and tear, utilities payable to the landlord under the lease, and moving and storage of belongings; never wear and tear, a prior tenant's damage, late fees or penalties. Replacements may be prorated by age, which is common practice, not New York law.",
      docs: "New York requires no receipts with the statement, but the landlord bears the burden of proof: a line without photos and an invoice or labor record is marked Unsupported.",
    }),
    refundCheck: () => "Not required; evidence kept",
    afterPhotoTip: { title: "After the work", cite: G("7-108(1-a)(f)"), text: "Not required by statute; evidence for the landlord's burden of proof." },
    estimateTip: { title: "Estimate", cite: G("7-108(1-a)(b)"), text: "New York sets no estimate rule: an estimate is still a reasonable and itemized cost the landlord must prove. Add the invoice when it arrives." },
    noteTip: { title: "On the statement", cite: G("7-108(1-a)(e)"), text: "Goes on the itemized statement with the cost, as part of the basis for the amount kept." },
  },

  tags: {
    rent: { tag: G("7-108(1-a)(b)"), short: "rent", label: "Non-payment of rent" },
    damage: { tag: G("7-108(1-a)(b)"), short: "damage", label: "Damage caused by the tenant beyond normal wear and tear" },
    cleaning: { tag: G("7-108(1-a)(b)"), short: "cleaning", label: "Cleaning that restores a condition beyond normal wear and tear" },
  },

  ledger: {
    capTag: (l) => (l ? { tag: G("7-108(1-a)(a)"), tagShort: "one-month cap", tagLabel: "No deposit or advance may exceed one month's rent" }
      : { tag: G("7-108(1-a)(a)"), tagShort: "deposit", tagLabel: "The deposit and any advance together, at most one month's rent" }),
    paymentTag: () => ({ tag: G("7-103(1)"), tagShort: "held in trust", tagLabel: "The deposit stays the tenant's money, held in trust and not mingled with the landlord's own" }),
    refundTag: { tag: G("7-108(1-a)(e)"), tagShort: "14 days", tagLabel: "Statement and refund within 14 days after the tenant vacates, or every deduction is forfeited" },
    balanceTag: { tag: G("7-108(1-a)(b)"), tagShort: "balance claimed", tagLabel: "Costs beyond the deposit, stated as a claim", detail: "PayPal invoice for the balance the deductions exceed the deposit by; recorded as a claim, not a demand for payment" },
    typeTip: { title: "Each row's rule", cite: "N.Y. GOL 7-103, 7-108", text: "Hover a type for the part of New York's General Obligations Law behind that row. The Payments export lists it for every row." },
  },

  findings: {
    damage: { rule: "Damage beyond normal wear and tear", note: "May be deducted: the reasonable and itemized cost, and a replacement prorated by age as common practice.", cite: G("7-108(1-a)(b)") },
    cleaning: { rule: "Cleaning beyond normal wear and tear", note: "May be deducted only when it restores a condition beyond wear and tear.", cite: G("7-108(1-a)(b), (d)") },
    wear_and_tear: { rule: "Ordinary wear and tear", note: "Not chargeable under New York law, nor is damage caused by a prior tenant.", cite: G("7-108(1-a)(b)") },
    unclear: { rule: "Can't tell from the photos", note: "Needs a better photo before anything is charged. The landlord bears the burden of proof.", cite: G("7-108(1-a)(f)") },
  },

  records: [
    {
      kind: "move_in_inspection", slug: "move-in-inspection", phase: "move_in",
      title: "Your opportunity to inspect the unit before you move in", short: "move-in inspection offer", cite: G("7-108(1-a)(c)"), rule: "N14",
      tip: "After the lease is signed and before the tenant moves in, offer the tenant an inspection with you or your agent. If the tenant asks, both sign a written agreement on the unit's condition, noting existing defects, before occupancy; nothing noted can be deducted later.",
      when: "Before the tenants begin occupancy.", draft: true, menu: "Move-in inspection offer",
      methods: MAIL_METHODS, toLabel: "Offered to", verb: "Offered",
      form: { method: "How it was offered", date: "Date offered", button: "Mark as offered" },
      heading: "New York General Obligations Law section 7-108(1-a)(c)",
      draftBody: (c) => [
        { p: `Your lease for ${c.address} has been signed. Before you begin occupancy, you have the opportunity to inspect the unit with ${c.landlord} or an agent.` },
        { p: "If you ask for the inspection, we will both sign, before you move in, a written agreement describing the condition of the unit and specifically noting any existing defects or damage. The landlord may not keep any part of your security deposit for a condition, defect or damage noted in that agreement." },
        { p: `To ask for the inspection, tell ${c.landlord} in writing or by phone at [[blank:w-56]], before your move-in date.` },
      ],
      response: ["I want to inspect the unit before I move in. Dates and times that work for me: [[blank:w-64]]", "I do not want an inspection before I move in."],
    },
    {
      kind: "deposit_account", slug: "deposit-account", phase: "move_in",
      title: "Where your security deposit is held", short: "deposit account notice", cite: G("7-103(1)-(2-a)"), rule: "N2-N4",
      tip: "The deposit is held in trust and not mingled with your own money; a PayPal balance next to rent is mingled. When it goes into a bank, tell the tenant in writing the bank's name and address and the amount; in a building of six or more units it must be an interest-bearing account at a New York bank.",
      when: "As soon as the deposit is placed in the bank.", draft: true, menu: "Deposit account notice",
      methods: MAIL_METHODS, toLabel: "Given to", verb: "Given",
      detail: { label: "Bank name and address", required: true, placeholder: "Bank, branch address" },
      heading: "New York General Obligations Law section 7-103",
      draftBody: (c) => [
        { p: `Your security deposit${c.deposit ? ` of ${usd(c.deposit.amount)}` : ""} for ${c.address} is held in trust for you and is not mingled with the landlord's own money.` },
        { p: "It has been deposited with: [[blank:w-72]] (bank name), [[blank:w-72]] (address of a place of business in New York), in the amount of [[blank:w-32]]." },
        { p: "If the building has six or more units, the account earns interest at the prevailing rate. The landlord may keep 1 percent a year for administration; the rest of the interest is yours, held in trust until it is paid to you, applied to rent, or paid each year, as you choose: [[blank:w-56]]." },
      ],
    },
    {
      kind: "inspection", slug: "inspection", phase: "notice",
      title: "Your right to an inspection before you move out", short: "inspection-rights notice", cite: G("7-108(1-a)(d)"), rule: "N16",
      tip: "Within a reasonable time after either party gives notice of intention to end the tenancy. Not owed only when the tenant ends the tenancy with less than two weeks' notice; after the landlord's notice it is always owed.",
      draft: true, menu: "Inspection notice draft", methods: MAIL_METHODS, toLabel: "Given to", verb: "Given",
      heading: "New York General Obligations Law section 7-108(1-a)(d)",
      draftBody: (c) => [
        { p: c.noticeGivenOn ? `Notice to end your tenancy at ${c.address} was given on ${longDate(c.noticeGivenOn)}${c.ends ? `, and the tenancy ends on ${longDate(c.ends)}` : ""}.` : `Your tenancy at ${c.address} is ending on ${c.ends ? longDate(c.ends) : "[[blank]]"}.` },
        { p: "You have the right to request an inspection of the unit before you vacate it, and the right to be present at it." },
        { p: `If you request it, the inspection will be held no earlier than two weeks and no later than one week before the end of the tenancy${c.windowOpens && c.windowCloses ? `: between ${longDate(c.windowOpens)} and ${longDate(c.windowCloses)}` : ""}, with at least 48 hours' written notice of the date and time. To request it, tell ${c.landlord} in writing or by phone at [[blank:w-56]].` },
        { p: "After the inspection you will receive an itemized statement of the repairs or cleaning proposed as deductions from your security deposit, and you may fix them before the tenancy ends." },
        { p: `Within 14 days after you vacate, you will receive an itemized statement of any amount kept and the rest of your deposit${c.due ? `; for the ${c.ends ? longDate(c.ends) : ""} move-out, by ${longDate(c.due)}` : ""}.` },
      ],
      response: ["I request an inspection before I move out. Dates and times that work for me: [[blank:w-64]]", "I do not request an inspection."],
    },
  ],

  notices: {
    refundNotice: false,
    inspection: { windowDays: 14, noticeHours: 48, lateLimitDays: 7, skipIfShortNotice: 14 },
    sectionTip: { title: "The dates the move-out hangs on", cite: G("7-108(1-a)(d)-(e)"), text: "Set the lease end once and record the day either side gives notice. The notice of the tenant's right to an inspection, and every date after it, follow from that." },
    inspectionNote: "In writing, within a reasonable time after either side's notice: the tenants' right to request an inspection before they vacate, and to be present. Not owed only when the tenants themselves end the tenancy with less than two weeks' notice.",
    followTip: (w, due, passed) => `${w ? `The inspection window runs from ${longDate(w)}, two weeks before the move-out, to one week before it. ` : ""}${due && !passed ? `If they leave as planned, the statement and the rest of the deposit are due ${longDate(due)}, 14 days later.` : ""}${passed ? "The planned move-out has passed. Record the actual move-out date once the tenants vacate; the 14-day clock runs from that day." : ""}`,
    followCite: G("7-108(1-a)(d)-(e)"),
    datesTip: "The 60-day check-in, the day the inspection window opens, the move-out, and the 14-day statement and refund deadline, as an .ics file for Apple, Google or Outlook.",
  },

  delivery: {
    tip: { title: "How the statement goes out", cite: G("7-108(1-a)(e)"), text: "The statute names no method. Send it in writing with a dated record: first-class mail to the forwarding address the tenant gave, and email when the tenant gave one; with neither, mail to the vacated unit." },
    emailRule: "open",
    emailLabel: "",
    emailWord: "email",
    emailShort: "Email",
    multipleTo: "The statute is silent on several tenants; send each adult a copy and record the one it is addressed to (practice).",
    emailRefused: "",
    unitFallback: true,
    noForwarding: "",
    mailHint: (unit, f) => (f
      ? `${f.name ?? "The tenants"} gave this forwarding address through the tenant link on ${longDate(f.date)}. Leave it blank to use the vacated unit, ${unit}; that copy may not reach them.`
      : `The forwarding address the tenant gave. Leave it blank to use the vacated unit, ${unit}; that copy may not reach them.`),
    addressedCite: G("7-108(1-a)(e)"),
    toCite: G("7-108(1-a)(e)"),
  },

  localOverlays: [
    { city: "New York City", match: /^(new york|new york city|nyc|manhattan|brooklyn|bronx|the bronx|queens|staten island)$/i, line: "Rent stabilized units: the Rent Stabilization Code (9 NYCRR 2525.4) caps the deposit at one month, requires an interest-bearing account and the tenant's interest election; GOL 7-107 applies from 2025-11-15. Rent controlled units are outside 7-108(1-a). The FARE Act (Admin. Code 20-699.20 to 20-699.25) bars landlord-agent broker fees and requires an itemized fee disclosure before signing." },
    { city: "Kingston", match: /^kingston$/i, line: "Opted in to the Emergency Tenant Protection Act effective 2022-08-01 (upheld 2025-06-18): covered units are rent stabilized under 7-107 and 9 NYCRR 2505.4." },
  ],
};

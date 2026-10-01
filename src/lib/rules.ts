// California security deposit rules, enforced in plain code so every flag is explainable and cites the statute.
// Source of truth: docs/LEGAL_RULES.md (Civil Code 1950.5 as amended through AB 414, effective 2026-01-01).
// The AI reads the lease; these functions decide what is lawful. Rule ids (D3, D8, ...) match that doc.

export type OwnerType = "natural_person" | "llc_natural_persons" | "llc_other" | "corporation" | "unknown";

export type LeaseTerms = {
  propertyAddress: string | null;
  city: string | null;
  landlordName: string | null;
  ownerType: OwnerType;
  ownerPropertyCount: number | null; // residential rental properties the owner holds
  ownerUnitCount: number | null; // units across those properties
  tenants: string[]; // adults named on the lease
  tenancyStartDate: string | null; // YYYY-MM-DD
  monthlyRent: number | null;
  securityDeposit: number | null;
  otherMoveInCharges: { label: string; amount: number; refundable: boolean | null; quote: string }[];
  nonrefundableLanguage: string[]; // quotes that call any part of the security nonrefundable
  lateFee: { amount: number | null; percentOfRent: number | null; deductibleFromDeposit: boolean; quote: string } | null;
  mandatoryCleaningClause: string | null; // quote requiring professional (e.g. carpet) cleaning regardless of condition
  electronicPaymentMethods: string[]; // e.g. PayPal, Zelle, ACH, card
  tenantIsServiceMember: boolean | null;
};

export type Flag = {
  id: string;
  severity: "violation" | "warning" | "info";
  title: string;
  detail: string;
  cite: string;
  quote?: string;
};

const usd = (n: number) => `$${n.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;

/** D4: the two-month allowance applies only to a natural person (or an LLC of natural persons) with at most
 *  two residential rental properties and four units, and never to a service member (D5). */
export function smallLandlordExempt(t: LeaseTerms): boolean | null {
  if (t.tenantIsServiceMember) return false;
  if (t.ownerType === "unknown" || t.ownerPropertyCount == null || t.ownerUnitCount == null) return null;
  const naturalPerson = t.ownerType === "natural_person" || t.ownerType === "llc_natural_persons";
  return naturalPerson && t.ownerPropertyCount <= 2 && t.ownerUnitCount <= 4;
}

/** D1: "security" is everything charged at the start of the tenancy except first month's rent, however labeled. */
export function totalSecurity(t: LeaseTerms): number {
  return (t.securityDeposit ?? 0) + t.otherMoveInCharges.reduce((s, c) => s + c.amount, 0);
}

export function evaluateLease(t: LeaseTerms): Flag[] {
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
  if (t.tenancyStartDate && t.tenancyStartDate >= "2025-07-01") {
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

/** What the agent will actually invoice at move-in: everything the lease charges as security, capped at the legal
 *  maximum (D3/D4). Null when the cap can't be determined yet. */
export function lawfulDeposit(t: LeaseTerms): { amount: number; cap: number; charged: number } | null {
  if (!t.monthlyRent) return null;
  const exempt = smallLandlordExempt(t);
  if (exempt === null) return null;
  const cap = t.monthlyRent * (exempt ? 2 : 1);
  const charged = totalSecurity(t);
  return { amount: Math.min(charged, cap), cap, charged };
}

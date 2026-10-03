// The lease rules, enforced in plain code so every flag is explainable and cites the statute. The rules themselves live
// in the state rule packs (src/lib/states/): California's in ca.ts from docs/LEGAL_RULES.md, the others from
// docs/rules/<state>.md. The AI reads the lease; the tenancy's pack decides what is lawful. Rule ids (D3, N7, T2, ...)
// match those specs.

import type { LawfulDeposit, ClientPack } from "./states/types";

export type OwnerType = "natural_person" | "llc_natural_persons" | "llc_other" | "corporation" | "unknown";

export type LeaseTerms = {
  propertyAddress: string | null;
  city: string | null;
  state?: string | null; // USPS code of the property's state, as the lease gives it (absent on records from before the packs)
  landlordName: string | null;
  ownerType: OwnerType;
  ownerPropertyCount: number | null; // residential rental properties the owner holds
  ownerUnitCount: number | null; // units across those properties
  buildingUnitCount?: number | null; // dwelling units in the property's building, when the lease says (New York's interest rule)
  tenants: string[]; // adults named on the lease
  tenancyStartDate: string | null; // YYYY-MM-DD
  leaseEndDate?: string | null; // YYYY-MM-DD end of a fixed term; null when month to month or not stated (absent on older records)
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
  fact?: string; // one short fact for the lease check's row (packs other than California set it)
  note?: boolean; // an "info" flag that is a fact to know rather than a step to take (packs other than California)
};

/** California D4: the two-month allowance applies only to a natural person (or an LLC of natural persons) with at most
 *  two residential rental properties and four units, and never to a service member (D5). */
export function smallLandlordExempt(t: LeaseTerms): boolean | null {
  if (t.tenantIsServiceMember) return false;
  if (t.ownerType === "unknown" || t.ownerPropertyCount == null || t.ownerUnitCount == null) return null;
  const naturalPerson = t.ownerType === "natural_person" || t.ownerType === "llc_natural_persons";
  return naturalPerson && t.ownerPropertyCount <= 2 && t.ownerUnitCount <= 4;
}

/** California D1: "security" is everything charged at the start of the tenancy except first month's rent, however
 *  labeled. */
export function totalSecurity(t: LeaseTerms): number {
  return (t.securityDeposit ?? 0) + t.otherMoveInCharges.reduce((s, c) => s + c.amount, 0);
}

/** The deposit and every move-in charge the lease does not label nonrefundable: what the other packs hold and return
 *  as the deposit (a fee the lease labels nonrefundable is the state's own question, flagged by its pack). */
export function refundableSecurity(t: LeaseTerms): number {
  return (t.securityDeposit ?? 0) + t.otherMoveInCharges.filter((c) => c.refundable !== false).reduce((s, c) => s + c.amount, 0);
}

/** The lease's flags under the tenancy's state pack, violations first. */
export function evaluateLease(t: LeaseTerms, pack: ClientPack): Flag[] {
  return pack.lease.evaluate(t);
}

/** What the agent will actually invoice at move-in under the tenancy's pack: the security, held to the state's cap.
 *  Null when the cap can't be determined yet. */
export function lawfulDeposit(t: LeaseTerms, pack: ClientPack): LawfulDeposit | null {
  return pack.lease.lawful(t);
}

export type { LawfulDeposit };

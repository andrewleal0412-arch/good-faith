import type { LeaseTerms } from "./rules";

// The sample lease, demo/lease-single-owner.pdf: the one the demo's move-out unit was started from, by one person
// who owns one rental (docs/HOW_IT_WORKS.md, "The demo lease"). The lease page checks it in one click from the
// terms below, the facts Claude read from it when the demo was built (the unit's stored lease_terms, with the two
// fields added since), so a judge with no PDF at hand sees the check at once and the hosted demo spends no Claude
// call on it; the e2e stub answers a live read of the same file with the same facts (src/lib/e2e-stubs.ts).

export const DEMO_LEASE_FILE = "lease-single-owner.pdf";

export const DEMO_LEASE_TERMS: LeaseTerms = {
  propertyAddress: "1140 E. Juniper Hollow Ln, Orange, CA 92867",
  city: "Orange",
  state: "CA",
  landlordName: "Teddy Buettner",
  ownerType: "natural_person",
  ownerPropertyCount: 1,
  ownerUnitCount: 1,
  buildingUnitCount: null,
  tenants: ["Luke Jones", "Lane Forti"],
  tenancyStartDate: "2025-10-01",
  leaseEndDate: "2026-09-30",
  monthlyRent: 2400,
  securityDeposit: 4800,
  otherMoveInCharges: [{
    label: "Cleaning fee", amount: 300, refundable: false,
    quote: "Tenant shall also pay a nonrefundable cleaning fee of $300.00, which covers professional cleaning at the end of the tenancy and will not be returned.",
  }],
  nonrefundableLanguage: ["Tenant shall also pay a nonrefundable cleaning fee of $300.00, which covers professional cleaning at the end of the tenancy and will not be returned."],
  lateFee: {
    amount: 120, percentOfRent: 5, deductibleFromDeposit: true,
    quote: "If rent is not received by the 5th day of the month, Tenant shall pay a late charge of $120.00 (5% of the monthly rent), which Landlord may deduct from the security deposit.",
  },
  mandatoryCleaningClause: "Tenant shall also pay a nonrefundable cleaning fee of $300.00, which covers professional cleaning at the end of the tenancy and will not be returned.",
  electronicPaymentMethods: ["PayPal", "Zelle"],
  tenantIsServiceMember: null,
};

import { addDays, longDate, pacificDate } from "./dates";

// The two written notices a landlord owes once either side gives notice to end the tenancy, drafted from the
// tenancy's own dates: the initial-inspection notice (docs/LEGAL_RULES.md D11, Civ. Code 1950.5(f)(1)) and the
// electronic-refund notice (D17, (h)(1)(A)(ii)(II)). Pure: the pages render the drafts, the API routes record them.

export type NoticeKind = "inspection" | "electronic_refund";
export type NoticeMethod = "personal" | "mail" | "email";

/** How and when a notice was given, as the landlord recorded it. Stored in tenancies.notices keyed by kind. */
export type NoticeGiven = { date: string; method: NoticeMethod; to: string | null; recorded_at: string };
export type Notices = Partial<Record<NoticeKind, NoticeGiven>>;

export const NOTICE_KINDS: NoticeKind[] = ["inspection", "electronic_refund"];

/** URL slugs of the printable drafts: /tenancy/[id]/notices/[slug]. */
export const NOTICE_SLUG: Record<NoticeKind, string> = { inspection: "inspection", electronic_refund: "electronic-refund" };
export const kindFromSlug = (slug: string): NoticeKind | null => NOTICE_KINDS.find((k) => NOTICE_SLUG[k] === slug) ?? null;

export const NOTICE_INFO: Record<NoticeKind, { title: string; short: string; cite: string; rule: string }> = {
  inspection: {
    title: "Your option to request an initial inspection before you move out",
    short: "initial-inspection notice", cite: "Civ. Code 1950.5(f)(1)", rule: "D11",
  },
  electronic_refund: {
    title: "Your right to receive your security deposit refund electronically",
    short: "electronic-refund notice", cite: "Civ. Code 1950.5(h)(1)(A)(ii)(II)", rule: "D17",
  },
};

export const NOTICE_METHODS: [NoticeMethod, string][] = [["personal", "Personal delivery"], ["mail", "First-class mail"], ["email", "Email"]];
export const NOTICE_METHOD_LABEL: Record<NoticeMethod, string> = { personal: "personal delivery", mail: "first-class mail", email: "email" };

/** The paragraph (f)(1) says the written notice "shall contain, in substantially the same form". Quoted verbatim from
 *  Civ. Code 1950.5 on leginfo.legislature.ca.gov as amended by Stats. 2025, ch. 340 (AB 414), read 2026-10-01. */
export const ABANDONED_PROPERTY_TEXT =
  "State law permits former tenants to reclaim abandoned personal property left at the former address of the tenant, " +
  "subject to certain conditions. You may or may not be able to reclaim property without incurring additional costs, " +
  "depending on the cost of storing the property and the length of time before it is reclaimed. In general, these costs " +
  "will be lower the sooner you contact your former landlord after being notified that property belonging to you was " +
  "left behind after you moved out.";

/** (f)(1): the initial inspection happens "no earlier than two weeks before the termination or the end of lease date". */
export const INSPECTION_WINDOW_DAYS = 14;
export const inspectionWindowOpens = (tenancyEnds: string) => addDays(tenancyEnds, -INSPECTION_WINDOW_DAYS);

/** (f)(1): "at least 48 hours' prior written notice of the date and time of the inspection", waivable in a signed writing. */
export const INSPECTION_NOTICE_HOURS = 48;

/** One line for a recorded notice, e.g. "first-class mail to Maya Torres on October 3, 2026". */
export function describeNoticeGiven(n: NoticeGiven): string {
  return `${NOTICE_METHOD_LABEL[n.method]}${n.to ? ` to ${n.to}` : ""} on ${longDate(n.date)}`;
}

/** What shows the landlord received the security or rent electronically, which is what makes (h)(1)(A) apply. */
export type ElectronicEvidence = { kind: "paid"; text: string } | { kind: "lease"; text: string } | null;

export type RefundAgreementSummary = { paypalEmail: string; signedBy: string[]; signedAt: string };

/** Whether the (h)(1)(A)(ii)(II) notice is owed, with the reason in the statute's own terms. `needed` is false when a
 *  prior written agreement on the method already covers it, true when the deposit came in electronically with no such
 *  agreement, and null when this tool can't tell (no electronic payment on record here). */
export type RefundNoticeStatus = { needed: boolean | null; reason: string };

export function refundNoticeStatus(agreement: RefundAgreementSummary | null, evidence: ElectronicEvidence): RefundNoticeStatus {
  if (agreement) {
    return {
      needed: false,
      reason: `A written agreement on the refund method is already on file: ${agreement.signedBy.join(" and ")} agreed on ${longDate(pacificDate(agreement.signedAt))} that the deposit comes back by PayPal to ${agreement.paypalEmail}. Civ. Code 1950.5(h)(1)(A)(ii)(II) does not require this notice when the landlord and tenant have previously entered into a written agreement designating the method of return under subclause (I).`,
    };
  }
  if (evidence?.kind === "paid") {
    return {
      needed: true,
      reason: `${evidence.text}, and no written agreement on the refund method is on file. A landlord who received the security or rent electronically must notify the tenant in writing, within a reasonable time after notice to end the tenancy or before the lease ends, of the tenant's right to an electronic refund (Civ. Code 1950.5(h)(1)(A)(ii)(II)).`,
    };
  }
  if (evidence?.kind === "lease") {
    return {
      needed: null,
      reason: `${evidence.text}, and no written agreement on the refund method is on file. If any rent or the deposit was in fact received electronically, the landlord must notify the tenant in writing of the right to an electronic refund (Civ. Code 1950.5(h)(1)(A)(ii)(II)).`,
    };
  }
  return {
    needed: null,
    reason: "No electronic payment of the security or rent is on record here and no written agreement on the refund method is on file. The notice is required when the landlord received the security or rent electronically (Civ. Code 1950.5(h)(1)(A)(ii)(II)); if rent came in by Zelle, card or a portal outside this tool, it applies.",
  };
}

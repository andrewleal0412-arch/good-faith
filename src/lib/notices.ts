import { addDays, longDate, pacificDate } from "./dates";
import type { ClientPack, RecordDef, RecordKind } from "./states/types";

// The written notices and records a landlord keeps along the tenancy, drafted from the tenancy's own dates. Which ones a
// tenancy has comes from its state pack (src/lib/states/): California's initial-inspection notice (docs/LEGAL_RULES.md
// D11, Civ. Code 1950.5(f)(1)) and electronic-refund notice (D17, (h)(1)(A)(ii)(II)); New York's inspection-rights
// notice and move-in inspection offer; the account the deposit is held in (New York, Florida, Washington); Florida's
// holding and claim notices; Washington's signed move-in checklist; a Texas tenant's written forwarding address; New
// York's acknowledgment for deductions kept after day 14.
// Pure: the pages render the drafts, the API routes record them.

export type NoticeKind = RecordKind;
export type NoticeMethod = "personal" | "mail" | "email" | "certified" | "text" | "signed" | "separate" | "interest" | "bond";

/** How and when a notice was given (or a record made), as the landlord recorded it. Stored in tenancies.notices keyed
 *  by kind. `detail` holds what the record names (a tracking number, the account, the address); `received` the day the
 *  tenant received it, where the clock runs from receipt (Florida's claim notice). */
export type NoticeGiven = { date: string; method: NoticeMethod; to: string | null; recorded_at: string; detail?: string | null; received?: string | null };
export type Notices = Partial<Record<NoticeKind, NoticeGiven>>;

/** California's two notice kinds, in the order the pages list them. */
export const NOTICE_KINDS: NoticeKind[] = ["inspection", "electronic_refund"];

/** The pack's records in one phase, in the order the pages list them. */
export const recordsFor = (pack: ClientPack, phase?: RecordDef["phase"]) => pack.records.filter((r) => !phase || r.phase === phase);

/** The pack's records a tenancy's pages list: one that follows another (Florida's objection, after the claim notice)
 *  waits for it, and one made only on request (New York's late acknowledgment) is listed once it exists. */
export const listedRecords = (pack: ClientPack, phase: RecordDef["phase"] | undefined, notices: Notices) =>
  recordsFor(pack, phase).filter((r) => (!r.after || !!notices[r.after]) && (!r.hiddenUntilRecorded || !!notices[r.kind]));

/** The kinds of the pack's notices given once either side gives notice to end the tenancy. */
export const noticeKindsFor = (pack: ClientPack): NoticeKind[] => recordsFor(pack, "notice").map((r) => r.kind);

/** Those notices' titles and citations, as the pages show them. */
export const noticeInfoFor = (pack: ClientPack): Partial<Record<NoticeKind, { title: string; short: string; cite: string; rule: string }>> =>
  Object.fromEntries(recordsFor(pack, "notice").map((r) => [r.kind, { title: r.title, short: r.short, cite: r.cite, rule: r.rule }]));

/** One of the pack's records by kind. */
export const recordFor = (pack: ClientPack, kind: NoticeKind) => pack.records.find((r) => r.kind === kind) ?? null;

/** URL slugs of the record pages: /tenancy/[id]/notices/[slug]. Kinds keep one slug in every state. */
export const NOTICE_SLUG: Record<NoticeKind, string> = {
  inspection: "inspection", electronic_refund: "electronic-refund", move_in_inspection: "move-in-inspection", deposit_account: "deposit-account",
  holding_notice: "holding-notice", move_in_checklist: "move-in-checklist", forwarding_address: "forwarding-address",
  claim_notice: "claim-notice", claim_objection: "claim-objection", late_acknowledgment: "late-acknowledgment",
};

/** The kind behind a slug, among the pack's own records only: a Texas tenancy has no inspection notice page. */
export const kindFromSlug = (slug: string, pack: ClientPack): NoticeKind | null =>
  pack.records.find((r) => NOTICE_SLUG[r.kind] === slug)?.kind ?? null;

/** Each kind's name in a few words, for the activity log, which has no tenancy's pack at hand. A record's audit entry
 *  carries its pack's own name (`short`), which wins; these are for entries made before that. */
export const RECORD_SHORT: Record<NoticeKind, string> = {
  inspection: "initial-inspection notice", electronic_refund: "electronic-refund notice", move_in_inspection: "move-in inspection offer",
  deposit_account: "deposit account notice", holding_notice: "deposit holding notice", move_in_checklist: "move-in checklist",
  forwarding_address: "forwarding address", claim_notice: "claim notice", claim_objection: "tenant's objection",
  late_acknowledgment: "late-deduction acknowledgment",
};

/** The kinds set_notice records (California's two); every other kind goes through set_state_notice. */
export const CA_NOTICE_KINDS: NoticeKind[] = ["inspection", "electronic_refund"];

export const NOTICE_METHODS: [NoticeMethod, string][] = [["personal", "Personal delivery"], ["mail", "First-class mail"], ["email", "Email"]];
export const NOTICE_METHOD_LABEL: Record<NoticeMethod, string> = {
  personal: "personal delivery", mail: "first-class mail", email: "email", certified: "certified mail", text: "text message", signed: "signature",
  separate: "a separate account", interest: "a separate interest-bearing account", bond: "a surety bond",
};

/** The paragraph (f)(1) says the written notice "shall contain, in substantially the same form". Quoted verbatim from
 *  Civ. Code 1950.5 on leginfo.legislature.ca.gov as amended by Stats. 2025, ch. 340 (AB 414), read 2026-10-01. */
export const ABANDONED_PROPERTY_TEXT =
  "State law permits former tenants to reclaim abandoned personal property left at the former address of the tenant, " +
  "subject to certain conditions. You may or may not be able to reclaim property without incurring additional costs, " +
  "depending on the cost of storing the property and the length of time before it is reclaimed. In general, these costs " +
  "will be lower the sooner you contact your former landlord after being notified that property belonging to you was " +
  "left behind after you moved out.";

/** The day the pre-move-out inspection window opens: California (f)(1) "no earlier than two weeks before the termination
 *  or the end of lease date"; New York 7-108(1-a)(d) the same two weeks. Null in a state without the inspection. */
export const inspectionWindowOpens = (tenancyEnds: string, pack: ClientPack): string | null =>
  pack.notices.inspection ? addDays(tenancyEnds, -pack.notices.inspection.windowDays) : null;

/** New York: "no later than one week before the end of the tenancy". Null where the statute sets no such day. */
export const inspectionWindowCloses = (tenancyEnds: string, pack: ClientPack): string | null =>
  pack.notices.inspection?.lateLimitDays ? addDays(tenancyEnds, -pack.notices.inspection.lateLimitDays) : null;

/** One line for a recorded notice, e.g. "first-class mail to Maya Torres on October 3, 2026". */
export function describeNoticeGiven(n: NoticeGiven): string {
  return `${NOTICE_METHOD_LABEL[n.method]}${n.to ? ` to ${n.to}` : ""} on ${longDate(n.date)}`;
}

/** What shows the landlord received the security or rent electronically, which is what makes (h)(1)(A) apply. */
export type ElectronicEvidence = { kind: "paid"; text: string } | { kind: "lease"; text: string } | null;

export type RefundAgreementSummary = { paypalEmail: string; signedBy: string[]; signedAt: string };

/** Whether the (h)(1)(A)(ii)(II) notice is owed, with the reason in the statute's own terms. `needed` is false when a
 *  prior written agreement on the method already covers it, true when the deposit came in electronically with no such
 *  agreement, and null when this tool can't tell (no electronic payment on record here). California only: a state
 *  without the notice gets needed false and no reason. */
export type RefundNoticeStatus = { needed: boolean | null; reason: string };

export function refundNoticeStatus(agreement: RefundAgreementSummary | null, evidence: ElectronicEvidence, pack: ClientPack): RefundNoticeStatus {
  if (!pack.notices.refundNotice) return { needed: false, reason: "" };
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

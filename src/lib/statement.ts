import "server-only";
import { closeOutFacts, type CloseOutFacts } from "./closeout";
import { CATEGORY_ORDER, isDemoExample } from "./copy";
import { db } from "./db";
import { describeDelivery, type DeliveryRecord } from "./delivery";
import { missingDocs, usd, type Proration, type StoredDeduction, type Work } from "./deductions";
import { findingTitle, type StoredFinding } from "./findings";
import { paidElectronically, wasPaid } from "./invoice-status";
import type { Notices } from "./notices";
import { lawfulDeposit, type LeaseTerms } from "./rules";
import { settledExtra } from "./refund-rail";
import { packFor } from "./states/server";
import type { Standing, StateCode } from "./states/types";
import { tenantMoveOutUpdatedOn, type TenantMoveOut } from "./tenant";

// The itemized security deposit statement: everything the document needs, from the database and PayPal's live state,
// in the order of the tenancy's state checklist (California: Civ. Code 1950.5(h), docs/LEGAL_RULES.md section B). The
// rules themselves live in the state pack, closeout.ts and deductions.ts; this file arranges their answers and has the
// pack grade its checklist so the page can show completeness.

export type Category = "rent" | "damage" | "cleaning";

// The deduction tags are the state pack's (California's (b) tags live in states/ca.ts and copy.ts).

export type ChecklistState = "done" | "missing" | "not_applicable";
export type ChecklistItem = { n: number; title: string; cite: string; state: ChecklistState; reason: string };

export type StatementPhoto = { role: "move_in" | "move_out_before" | "move_out_after"; label: string; path: string };

export type StatementDeduction = {
  id: string;
  n: number;
  category: Category;
  tag: string;
  tagLabel: string;
  room: string | null;
  item: string;
  work: Work;
  amount: number;
  explanation: string; // the stored math: the written explanation of the cost, (h)(2)(D)
  note: string | null; // why the work was done, in the landlord's words: the rest of that explanation
  proration: Proration;
  guidance: boolean; // prorated by useful life or the paint schedule, which is DRE guidance and not statute
  isEstimate: boolean;
  labor: { description: string | null; hours: number | null; hourlyRate: number | null } | null;
  vendor: { name: string | null; address: string | null; phone: string | null; invoicePath: string | null } | null;
  photos: StatementPhoto[];
  missing: string[];
};

export type { DeliveryRecord } from "./delivery";
export { DELIVERY_LABEL, deliveryLine, describeDelivery } from "./delivery";

export type Statement = {
  tenancyId: string;
  state: StateCode; // the state whose law the statement follows
  today: string; // the live Pacific date, for the delivery form
  statementDate: string; // the date on the document: the delivery date once recorded, else today
  landlord: string;
  property: { address: string; city: string | null };
  tenants: string[];
  tenantContacts: { name: string; email: string | null }[];
  moveOutDate: string | null;
  statementDue: string | null;
  daysLeft: number | null; // the live countdown while the statement is a draft; null once delivered
  security: {
    amount: number; paid: boolean; electronic: boolean; live: boolean; paidAt: string | null; method: string | null;
    invoiceId: string; invoiceStatus: string; leaseAsked: number | null; cap: number | null; basisNote: string | null;
  } | null;
  deductions: StatementDeduction[];
  totals: CloseOutFacts["totals"] & { repairAndCleaning: number };
  documents: { required: boolean; note: string }; // the rule that applies; what is attached is stated by each rendering
  refund: {
    amount: number;
    state: "sent" | "due" | "none";
    method: string;
    paypalId: string | null;
    sentAt: string | null;
    paypalEmail: string | null;
    payees: string[];
    agreement: { signedBy: string[]; signedAt: string } | null;
    note: string;
  };
  balanceClaimed: { amount: number; text: string } | null;
  interest: { city: string | null; known: boolean; note: string; checkReason: string };
  delivery: DeliveryRecord | null;
  deliveredAt: string | null;
  tenantForwarding: { address: string; name: string | null; date: string } | null; // given by the tenants through their link, for (h)(6)
  checklist: ChecklistItem[];
  // How the claimed amounts stand when they are not plain deductions (Florida: disputed; New York: forfeited after day
  // 14). Absent otherwise, and always in California.
  standing?: Standing;
  // The wear-and-tear findings, listed at $0 where the state's spec asks for them (Texas, Florida, Washington).
  wear?: { item: string; room: string }[];
  // The settlement of the tenants' dispute, once paid: the amended statement. Absent otherwise.
  settlement?: StatementSettlement;
  // Money PayPal returned to the tenants through their PayPal dispute of the deposit payment, before or beside the
  // statement's refund (which is then what is left); notKept: the deductions it covered past the refund owed. Absent
  // when there is none.
  viaDispute?: { amount: number; disputeId: string | null; at: string | null; notKept: number };
};

/** A settled dispute as the amended statement records it: who accepted and approved it and when, each charge the
 *  settlement changed, the new totals and the PayPal record of the extra amount sent back. */
export type StatementSettlement = {
  amount: number; // back to the tenants on top of the statement's refund
  acceptedBy: string | null;
  acceptedAt: string | null;
  approvedAt: string | null;
  sentAt: string | null;
  rail: "refund_original_payment" | "payout" | null;
  paypalId: string | null;
  paypalStatus: string | null;
  lines: { n: number; item: string; amount: number; keep: number; adjustment: number }[]; // the charges it changed
  adjustment: number; // what it took off the deductions in all (a negative amount)
  keptAfter: number; // the deductions as settled
  refundSent: boolean; // whether the statement's own refund was sent (settlement.ts sends a settlement only after it)
  returnedInAll: number; // what PayPal sent: the statement's refund, once sent, plus the settlement
  balanceAfter: number; // what is still claimed over the deposit, if anything
  example: boolean; // the demo's recorded example (a copy's closed unit): no PayPal money moved for it
};

export const longDate = (iso: string) =>
  new Date(`${iso.slice(0, 10)}T12:00:00Z`).toLocaleDateString("en-US", { month: "long", day: "numeric", year: "numeric", timeZone: "UTC" });

/** The Pacific calendar date of a timestamp. */
export const pacificDate = (ts: string) => new Date(ts).toLocaleDateString("en-CA", { timeZone: "America/Los_Angeles" });

// The disclaimers live in copy.ts, which has no server imports, so the static home page can print one too.
export { DISCLAIMERS } from "./copy";

type Row = StoredDeduction & { hours: number | null; hourly_rate: number | null };

const ORDER: Record<Category, number> = CATEGORY_ORDER;

export async function buildStatement(tenancyId: string): Promise<Statement | null> {
  const [{ data: t }, { data: rows }] = await Promise.all([
    db.from("tenancies").select("*, properties(*)").eq("id", tenancyId).single(),
    db.from("deductions").select("*").eq("tenancy_id", tenancyId).order("created_at"),
  ]);
  if (!t) return null;
  const facts = await closeOutFacts(tenancyId);

  const prop = t.properties as { address: string; city: string | null; owner_name: string | null; state?: string | null };
  const pack = packFor(prop.state);
  const terms = (t.lease_terms ?? null) as LeaseTerms | null;
  const tenantContacts = (t.tenants as { name: string; email?: string | null }[]).map((x) => ({ name: x.name, email: x.email ?? null }));
  const tenants = tenantContacts.map((x) => x.name);
  const landlord = prop.owner_name ?? terms?.landlordName ?? "Landlord";
  const city = prop.city ?? terms?.city ?? null;
  const photosFrom = pack.moveIn.photosFrom;
  const moveInPhotosRequired = !!photosFrom && !!t.start_date && (t.start_date as string) >= photosFrom;

  // Once delivered, the document is frozen on the day it went out; until then it carries today's date and the clock.
  const delivery = (t.statement_delivery ?? null) as DeliveryRecord | null;
  const deliveredAt = (t.statement_delivered_at ?? null) as string | null;
  const statementDate = delivery?.date ?? facts.today;

  // 2. Security received and its basis. The amount is what PayPal collected; the pack's note explains how the lease
  // labeled it (California: every move-in charge but first month's rent is security, D1) and the cap when the lease
  // asked for more.
  const lawful = terms ? lawfulDeposit(terms, pack) : null;
  const dep = facts.deposit;
  const basisNote = terms && dep ? pack.statement.basisNote(terms, dep.amount, lawful) : null;
  const security: Statement["security"] = dep ? {
    amount: dep.amount, paid: wasPaid(dep.status),
    electronic: paidElectronically(dep.status, dep.method),
    live: dep.live, paidAt: dep.paidAt, method: dep.method, invoiceId: dep.invoiceId, invoiceStatus: dep.status,
    leaseAsked: lawful?.charged ?? null, cap: lawful?.cap ?? null, basisNote,
  } : null;

  // 3 to 8. One line per deduction with its tag, cost explanation, labor or vendor details and photo evidence.
  // Unpaid rent ((b)(1)) has no work behind it, so it carries neither labor nor vendor details.
  const stored = ((rows ?? []) as Row[]).map((d) => ({ ...d, amount: Number(d.amount) }))
    .sort((a, b) => ORDER[a.category] - ORDER[b.category]);
  const tags = pack.tags;
  const deductions: StatementDeduction[] = stored.map((d, i) => {
    const photos: StatementPhoto[] = [];
    const verb = d.work === "clean" ? "cleaning" : "repair";
    if (d.finding?.moveInPath) photos.push({ role: "move_in", label: "Move-in", path: d.finding.moveInPath });
    if (d.finding?.moveOutPath) photos.push({ role: "move_out_before", label: `Move-out, before ${verb}`, path: d.finding.moveOutPath });
    for (const p of d.after_photo_paths ?? []) photos.push({ role: "move_out_after", label: `After ${verb}`, path: p });
    const rent = d.category === "rent";
    return {
      id: d.id, n: i + 1, category: d.category, tag: tags[d.category].tag, tagLabel: tags[d.category].label,
      room: d.room, item: d.item, work: d.work, amount: d.amount, explanation: d.math, note: d.note ?? null, proration: d.proration,
      guidance: d.proration !== "none", isEstimate: d.is_estimate,
      labor: !rent && d.performer === "own_labor"
        ? { description: d.labor_description, hours: d.hours == null ? null : Number(d.hours), hourlyRate: d.hourly_rate == null ? null : Number(d.hourly_rate) }
        : null,
      vendor: !rent && d.performer === "vendor"
        ? { name: d.vendor?.name ?? null, address: d.vendor?.address ?? null, phone: d.vendor?.phone ?? null, invoicePath: d.receipt_path }
        : null,
      photos,
      missing: missingDocs(d, facts.totals.documentsRequired, pack),
    };
  });

  const repairAndCleaning = Math.round(deductions.filter((d) => d.category !== "rent").reduce((s, d) => s + d.amount, 0) * 100) / 100;
  const totals = { ...facts.totals, repairAndCleaning };

  // 9. The documents rule that applies (California: (h)(2), and the (h)(4)-(5) notice when they are not required).
  // Whether each document is in fact attached is stated by the page and the PDF from what they hold, never assumed here.
  const documents = {
    required: totals.documentsRequired,
    note: pack.statement.documentsNote(totals.documentsRequired, repairAndCleaning, deductions.some((d) => d.category !== "rent")),
  };

  // 10. The refund: what PayPal already sent, or what the plan calls for. Money PayPal returned through the tenants'
  // PayPal dispute is a prior return (s.viaDispute): the refund here is what went, or is still owed, on top of it.
  const ret = facts.alreadyReturned;
  const via = facts.viaDispute;
  const agreement = facts.refundAgreement;
  const paypalEmail = agreement?.paypalEmail ?? null;
  let refund: Statement["refund"];
  const base = { paypalEmail, payees: tenants, agreement: agreement ? { signedBy: agreement.signedBy, signedAt: agreement.signedAt } : null };
  const owedNow = Math.max(0, Math.round(((facts.standing?.forfeits ? totals.depositHeld : totals.refund) - (via?.amount ?? 0)) * 100) / 100);
  if (ret) {
    refund = {
      ...base, amount: ret.amount, state: "sent", paypalId: ret.paypalId, sentAt: ret.at,
      method: ret.kind === "payout" ? `PayPal Payout to ${paypalEmail ?? "the designated PayPal account"}` : "PayPal refund of the original deposit payment",
      note: "",
    };
  } else if (via && totals.depositHeld > 0 && owedNow <= 0) {
    refund = { ...base, amount: 0, state: "none", paypalId: null, sentAt: null,
      method: `Nothing more is owed: PayPal returned ${usd(via.amount)} to the tenants through their PayPal dispute${via.disputeId ? ` ${via.disputeId}` : ""}${via.at ? ` on ${longDate(pacificDate(via.at))}` : ""}.`, note: "" };
  } else if (totals.depositHeld === 0) {
    refund = { ...base, amount: 0, state: "none", paypalId: null, sentAt: null, method: "No security was received through PayPal, so there is nothing to refund.", note: "" };
  } else if (totals.refund <= 0 && !facts.standing?.forfeits) {
    refund = { ...base, amount: 0, state: "none", paypalId: null, sentAt: null, method: "No refund is due: the deductions use the whole security.", note: "" };
  } else {
    // Forfeited deductions (New York after day 14) leave the whole security owed back, whatever they come to.
    const plan = facts.plan;
    refund = {
      ...base, amount: owedNow, state: "due", paypalId: null, sentAt: null,
      method: plan.rail === "payout" ? `PayPal Payout to ${plan.email}, to be sent`
        : plan.rail === "refund_original_payment" ? "PayPal refund of the original deposit payment, to be sent"
          : pack.statement.refundDueMethod({ electronic: !!security?.electronic, paypalEmail }),
      note: "",
    };
  }
  const signed = agreement ? `the written agreement signed by ${agreement.signedBy.join(" and ")} on ${longDate(pacificDate(agreement.signedAt))}` : null;
  const paidBy = security?.method ? security.method.toLowerCase().replace(/_/g, " ") : "a method PayPal did not record";
  refund.note = pack.statement.refundNote({ tenants, paid: !!security?.paid, electronic: !!security?.electronic, signed, paidBy });

  // 12. A balance claimed is a claim, never a demand, and nothing collects it.
  const balanceClaimed = totals.balanceClaimed > 0
    ? { amount: totals.balanceClaimed, text: `The deductions exceed the security held by ${usd(totals.balanceClaimed)}. This statement records that amount as a claim. It is not a demand for immediate payment.` }
    : null;

  // 13. Where the statement is mailed: the forwarding address the tenants gave through their link, if they did ((h)(6)),
  // dated by its latest change, since the address as it stands is what matters here.
  const tm = (t.tenant_move_out ?? null) as TenantMoveOut | null;
  const s: Statement = {
    tenancyId, state: pack.code, today: facts.today, statementDate, landlord, property: { address: prop.address, city }, tenants, tenantContacts,
    moveOutDate: facts.tenancy.moveOutDate, statementDue: facts.tenancy.statementDue, daysLeft: delivery ? null : facts.tenancy.daysLeft,
    security, deductions, totals, documents, refund, balanceClaimed,
    interest: pack.statement.interest(city, { buildingUnits: terms?.buildingUnitCount ?? null, notices: (t.notices ?? {}) as Notices }), delivery, deliveredAt,
    tenantForwarding: tm ? { address: tm.forwarding_address, name: tm.name, date: tenantMoveOutUpdatedOn(tm) } : null,
    checklist: [],
  };
  if (facts.standing) s.standing = facts.standing;
  if (via) s.viaDispute = { amount: via.amount, disputeId: via.disputeId, at: via.at || null, notKept: via.notKept };
  // The amended statement: a settlement of the tenants' dispute that was paid (or needed no money). Only then; one
  // agreed and not yet approved changes nothing here.
  const { data: settled } = await db.from("settlements").select("amount, terms, tenant_name, tenant_accepted_at, landlord_approved_at, sent_at, rail, paypal_id, paypal_status, raw")
    .eq("tenancy_id", tenancyId).eq("status", "sent").order("sent_at", { ascending: false }).limit(1).maybeSingle();
  if (settled) {
    const terms = (settled.terms ?? []) as { deduction_id: string; keep: number | string }[];
    const keepOf = (id: string, amount: number) => { const t = terms.find((x) => x.deduction_id === id); return t ? Number(t.keep) : amount; };
    const lines = deductions.map((d) => ({ n: d.n, item: d.item, amount: d.amount, keep: keepOf(d.id, d.amount) }))
      .map((l) => ({ ...l, adjustment: Math.round((l.keep - l.amount) * 100) / 100 })).filter((l) => l.adjustment !== 0);
    const keptAfter = Math.round(deductions.reduce((t, d) => t + keepOf(d.id, d.amount), 0) * 100) / 100;
    // What it added to the money back: nothing when the statement's refund was already the whole deposit.
    const refunded = (refund.state === "sent" ? refund.amount : 0) + (via?.amount ?? 0);
    const amount = settledExtra({ agreed: Number(settled.amount), depositHeld: facts.deposit?.amount ?? Infinity, refunded });
    s.settlement = {
      amount, acceptedBy: (settled.tenant_name as string | null) ?? null, acceptedAt: (settled.tenant_accepted_at as string | null) ?? null,
      approvedAt: (settled.landlord_approved_at as string | null) ?? null, sentAt: (settled.sent_at as string | null) ?? null,
      rail: (settled.rail as StatementSettlement["rail"]) ?? null, paypalId: (settled.paypal_id as string | null) ?? null, paypalStatus: (settled.paypal_status as string | null) ?? null,
      lines, adjustment: Math.round(lines.reduce((t, l) => t + l.adjustment, 0) * 100) / 100, keptAfter,
      refundSent: refund.state === "sent",
      returnedInAll: Math.round((refunded + amount) * 100) / 100,
      balanceAfter: Math.max(0, Math.round((keptAfter - totals.depositHeld) * 100) / 100),
      example: isDemoExample(settled.raw),
    };
  }
  // Considered and not charged: every wear-and-tear finding the landlord did not dismiss, so the tenants see it was
  // looked at and excluded.
  if (pack.statement.wearAtZero) {
    s.wear = ((t.move_out_findings ?? []) as StoredFinding[])
      .filter((f) => f.classification === "wear_and_tear" && f.status !== "dismissed")
      .map((f) => ({ item: findingTitle(f), room: f.room }));
  }
  s.checklist = pack.statement.checklist(s, {
    moveInPhotosRequired, documentsRequired: totals.documentsRequired, notices: (t.notices ?? {}) as Notices,
    ending: { givenOn: (t.notice_given_on ?? null) as string | null, givenBy: (t.notice_given_by ?? null) as "tenant" | "landlord" | null, ends: (t.planned_move_out ?? t.end_date ?? null) as string | null },
  });
  return s;
}

/** What the close-out agent reads after the refund: the checklist and what is still missing. Read-only. The landlord
 *  opens the statement from the tenancy page, so no paths are handed to the model to quote. */
export async function statementChecklist(tenancyId: string) {
  const s = await buildStatement(tenancyId);
  if (!s) throw new Error("No such tenancy.");
  return {
    statementDate: s.statementDate,
    statementDue: s.statementDue,
    daysLeft: s.daysLeft,
    delivered: s.delivery ? describeDelivery(s.delivery) : null,
    checklist: s.checklist,
    stillMissing: s.checklist.filter((c) => c.state === "missing").map((c) => `${c.n}. ${c.title}: ${c.reason}`),
  };
}

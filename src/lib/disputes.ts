import "server-only";
import { createHash } from "node:crypto";
import sharp from "sharp";
import { tenantPhotoLabel, type AdvocateCase, type CaseFile, type CaseLine, type CasePhoto, type LoadPhoto } from "./advocate";
import { cleanBox, type Box } from "./boxes";
import { pacificDate, pacificToday } from "./dates";
import { db } from "./db";
import { basisWords, chargeTitle, settle } from "./deductions";
import type { DeliveryRecord } from "./delivery";
import { findingTitle, type StoredFinding } from "./findings";
import { returnFailed, wasPaid } from "./invoice-status";
import { checkProposal, lawfulRanges, statementOrder, type FindingSnapshot, type RangeDeduction, type Ranges, type Standing } from "./lawful-range";
import type { Notices } from "./notices";
import { packFor } from "./states/server";
import type { StateCode, StatePack } from "./states/types";
import { resolveTenantToken, tokenNotFound } from "./tenant-links";
import { isTemplate } from "./workspace";

// Disputes of the itemized statement: the facts a dispute is weighed on (the deductions, their lawful ranges, the
// photos behind them), the tenants' draft and its photos, the advocate's case file, and what each side's page shows.
// Every function takes a tenancy id its caller already resolved: the landlord's routes through the session's workspace
// (routeTenancy, pageTenancy), the tenants' through their link token (resolveTenantToken). Storage paths stay on the
// server; the tenants' page gets line numbers, deduction ids and photo ids only.

export type DisputeStatus = "draft" | "open" | "negotiating" | "agreed" | "settled" | "no_agreement" | "withdrawn";
export const LIVE_STATUSES: DisputeStatus[] = ["draft", "open", "negotiating", "agreed"];
/** Sent to the landlord and not yet closed: the statement's deductions stay as they are (deductionsFrozen). */
export const SENT_LIVE_STATUSES: DisputeStatus[] = ["open", "negotiating", "agreed"];
/** One dispute per statement: once closed (settled, no agreement or withdrawn), no new one opens from the tenant link. */
export const isClosed = (s: DisputeStatus) => !LIVE_STATUSES.includes(s);

/** A photo the tenants added to their dispute, in the photos bucket under the workspace's prefix. */
export type Evidence = { id: string; path: string; name: string; type: string; bytes: number; deduction_id: string | null; added_at: string };

export type StoredCase = AdvocateCase & { basis: string };

export type DisputeRow = {
  id: string; tenancy_id: string; workspace_id: string | null; link_id: string | null; status: DisputeStatus;
  opened_by: string | null; deduction_ids: string[]; reasons: Record<string, string>; message: string | null; evidence: Evidence[];
  statement_delivered_at: string | null; advocate: StoredCase | null; advocate_status: "running" | "done" | "failed" | null;
  advocate_started_at: string | null; advocate_error: string | null; asked_back: number | string | null;
  created_at: string; updated_at: string; sent_at: string | null; closed_at: string | null;
};

/** The most photos one dispute may carry, and the length of what the tenants write. */
export const MAX_EVIDENCE = 6;
export const REASON_MIN = 3;
export const REASON_MAX = 600;
export const MESSAGE_MAX = 1000;
/** A run that started this long ago and never finished may be started again. */
export const ADVOCATE_STALE_SECONDS = 300;

const num = (v: unknown): number | null => (v == null || v === "" || !Number.isFinite(Number(v)) ? null : Number(v));

/* ---------- The tenants' routes ---------- */

export const bad = (error: string, status = 400) => Response.json({ error }, { status });

/** The tenancy a tenant route's token opens for a change: 404 for a token it doesn't accept (as every tenant route
 *  answers), 409 for the demo's templates, which nothing changes. */
export async function tenantWrite(token: string): Promise<{ linkId: string; tenancyId: string } | Response> {
  const link = await resolveTenantToken(token, { touch: false });
  if (!link) return tokenNotFound();
  if (await isTemplate(link.tenancyId)) return bad("This is a demo page, so it can't be changed. Your landlord's copy of the demo can.", 409);
  return link;
}

/** Where a dispute's photos are stored: under the tenancy's workspace prefix, so a demo copy's sweep removes them. */
export const evidencePrefix = (workspaceId: string, tenancyId: string, disputeId: string) => `ws/${workspaceId}/${tenancyId}/dispute/${disputeId}/`;

/* ---------- The facts a dispute is weighed on ---------- */

export type DisputeFacts = {
  tenancyId: string;
  workspaceId: string | null;
  pack: StatePack;
  today: string;
  address: string;
  landlord: string | null;
  tenants: string[];
  moveOutDate: string | null;
  statementDue: string | null;
  delivery: DeliveryRecord | null;
  deliveredAt: string | null;
  depositHeld: number;
  refunded: { amount: number; kind: string; at: string } | null;
  deductions: RangeDeduction[]; // in the statement's order
  findings: StoredFinding[];
  ranges: Ranges;
  statementRefund: number;
};

export async function disputeFacts(tenancyId: string): Promise<DisputeFacts | null> {
  const [{ data: t }, { data: rows }, { data: payments }] = await Promise.all([
    db.from("tenancies").select("workspace_id, tenants, end_date, move_out_date, planned_move_out, notices, statement_delivered_at, statement_delivery, move_out_findings, properties(address, owner_name, state)")
      .eq("id", tenancyId).maybeSingle(),
    db.from("deductions").select("*").eq("tenancy_id", tenancyId).order("created_at"),
    db.from("payments").select("kind, amount, status, created_at").eq("tenancy_id", tenancyId).order("created_at"),
  ]);
  if (!t) return null;
  const prop = t.properties as unknown as { address: string; owner_name: string | null; state?: string | null } | null;
  const pack = packFor(prop?.state);
  const inv = (payments ?? []).find((p) => p.kind === "deposit_invoice");
  const depositHeld = inv && wasPaid(inv.status as string) ? Number(inv.amount) : 0;
  // The first money back that didn't fail: what PayPal already returned, and the day it went (the refund half of a
  // deadline that covers the statement and the refund).
  const ret = (payments ?? []).find((p) => (p.kind === "refund" || p.kind === "payout") && !returnFailed(p.status as string));
  const deductions = statementOrder(((rows ?? []) as Record<string, unknown>[]).map((d) => ({
    ...(d as unknown as RangeDeduction),
    amount: Number(d.amount), billed: num(d.billed), hours: num(d.hours), hourly_rate: num(d.hourly_rate),
    item_age_years: num(d.item_age_years), useful_life_years: num(d.useful_life_years),
    after_photo_paths: (d.after_photo_paths as string[] | null) ?? [], finding: (d.finding as FindingSnapshot | null) ?? null,
  })));
  const delivery = (t.statement_delivery ?? null) as DeliveryRecord | null;
  const notices = (t.notices ?? {}) as Notices;
  const clock = { moveOutDate: t.move_out_date as string | null, endDate: t.end_date as string | null, plannedMoveOut: t.planned_move_out as string | null };
  const today = pacificToday();
  const ranges = lawfulRanges({
    deductions, depositHeld, today, ...clock, notices, deliveredOn: delivery?.date ?? null,
    refundedOn: ret ? pacificDate(ret.created_at as string) : null,
  }, pack);
  return {
    tenancyId, workspaceId: (t.workspace_id as string | null) ?? null, pack, today,
    address: prop?.address ?? "Address not recorded", landlord: prop?.owner_name ?? null,
    tenants: ((t.tenants ?? []) as { name: string }[]).map((x) => x.name),
    moveOutDate: clock.moveOutDate,
    statementDue: pack.deadline.due({ ...clock, claimed: deductions.length > 0, claimNoticeDate: notices.claim_notice?.date ?? null }),
    delivery, deliveredAt: (t.statement_delivered_at as string | null) ?? null,
    depositHeld, refunded: ret ? { amount: Number(ret.amount), kind: ret.kind as string, at: ret.created_at as string } : null,
    deductions, findings: ((t.move_out_findings ?? []) as StoredFinding[]), ranges,
    statementRefund: settle(depositHeld, deductions, pack).refund,
  };
}

/* ---------- Rows ---------- */

export async function liveDispute(tenancyId: string): Promise<DisputeRow | null> {
  const { data } = await db.from("disputes").select("*").eq("tenancy_id", tenancyId).in("status", LIVE_STATUSES)
    .order("created_at", { ascending: false }).limit(1).maybeSingle();
  return (data as DisputeRow | null) ?? null;
}

/** The tenancy's latest dispute, live or closed: one live at a time, and a closed one stops a new one opening. */
export async function latestDispute(tenancyId: string): Promise<DisputeRow | null> {
  const { data } = await db.from("disputes").select("*").eq("tenancy_id", tenancyId).order("created_at", { ascending: false }).limit(1).maybeSingle();
  return (data as DisputeRow | null) ?? null;
}

/** For the landlord's deduction routes: a 409 while a dispute the tenants sent is open, so the statement being
 *  negotiated (and later settled) is the one they disputed; null when the deductions may change. */
export async function deductionsFrozen(tenancyId: string): Promise<Response | null> {
  const { data } = await db.from("disputes").select("id").eq("tenancy_id", tenancyId).in("status", SENT_LIVE_STATUSES).limit(1);
  return data?.length
    ? Response.json({ error: "The tenants disputed this statement, so its deductions stay as they are while the dispute is open." }, { status: 409 })
    : null;
}

/** The dispute the landlord sees: the latest one the tenants sent (never a draft). */
export async function sentDispute(tenancyId: string): Promise<DisputeRow | null> {
  const { data } = await db.from("disputes").select("*").eq("tenancy_id", tenancyId).neq("status", "draft")
    .order("created_at", { ascending: false }).limit(1).maybeSingle();
  return (data as DisputeRow | null) ?? null;
}

/** What the advocate's case was written from: the lines disputed, the reasons, the message, the photos and the amounts
 *  on the statement. A case whose basis no longer matches was written before the tenants (or the landlord) changed
 *  something, and the page says so. */
export function disputeBasis(d: Pick<DisputeRow, "deduction_ids" | "reasons" | "message" | "evidence">, facts: Pick<DisputeFacts, "deductions">): string {
  const body = JSON.stringify({
    ids: [...d.deduction_ids].sort(), reasons: Object.entries(d.reasons ?? {}).sort(), message: d.message ?? "",
    photos: (d.evidence ?? []).map((e) => e.id).sort(), lines: facts.deductions.map((x) => [x.id, x.amount]),
  });
  return createHash("sha256").update(body).digest("hex").slice(0, 16);
}

/* ---------- The advocate's case file ---------- */

/** The boxes a deduction's finding drew: the live finding's (inspections re-boxed since the deduction was made), else
 *  the deduction's own snapshot of it. */
function boxesFor(d: RangeDeduction, findings: StoredFinding[]): { box: Box | null; moveInBox: Box | null } {
  const live = d.finding?.id ? findings.find((f) => f.id === d.finding!.id) : undefined;
  return { box: cleanBox(live?.box ?? d.finding?.box), moveInBox: cleanBox(live?.moveInBox ?? d.finding?.moveInBox) };
}

export function caseFile(facts: DisputeFacts, d: DisputeRow): CaseFile {
  const disputed = new Set(d.deduction_ids);
  const lines: CaseLine[] = facts.deductions.map((x, i) => {
    const f = x.finding;
    const live = f?.id ? facts.findings.find((s) => s.id === f.id) : undefined;
    const { box, moveInBox } = boxesFor(x, facts.findings);
    const verb = x.work === "clean" ? "cleaning" : "repair";
    const title = x.category === "rent" ? x.item : chargeTitle(x.item, x.work).title;
    return {
      n: i + 1, id: x.id, title, room: x.room, category: x.category, item: x.item, work: x.work, performer: x.performer,
      amount: x.amount, math: x.math, note: x.note ?? null,
      basis: basisWords({ category: x.category, performer: x.performer, proration: x.proration, hours: x.hours, hourlyRate: x.hourly_rate, itemAgeYears: x.item_age_years, usefulLifeYears: x.useful_life_years }),
      inputs: { billed: x.billed, hours: x.hours, hourlyRate: x.hourly_rate, itemAgeYears: x.item_age_years, usefulLifeYears: x.useful_life_years, proration: x.proration },
      documents: {
        receipt: !!x.receipt_path, estimate: x.is_estimate, afterPhotos: x.after_photo_paths.length, laborDescription: x.labor_description,
        vendor: x.performer === "vendor" ? { name: !!x.vendor?.name, address: !!x.vendor?.address, phone: !!x.vendor?.phone } : null,
      },
      finding: f ? {
        classification: String(live?.classification ?? f.classification ?? "unknown"), label: (live?.label ?? f.label) ?? null,
        summary: (live?.summary ?? f.summary) ?? null, observation: (live?.observation ?? f.observation) ?? null, reason: (live?.reason ?? f.reason) ?? null,
        remedy: (live?.remedy ?? f.remedy) ?? null, severity: (live?.severity ?? f.severity) ?? null,
        confidence: num(live?.confidence ?? f.confidence), box, moveInBox,
      } : null,
      photos: {
        moveIn: f?.moveInPath ? { ref: f.moveInPath, label: `Move-in photo, ${x.room ?? "the room"}`, box: moveInBox } : null,
        moveOut: f?.moveOutPath ? { ref: f.moveOutPath, label: `Move-out photo before the ${verb}, ${x.room ?? "the room"}`, box } : null,
        after: x.after_photo_paths.map((p, k) => ({ ref: p, label: `After the ${verb}, photo ${k + 1}`, box: null })),
      },
      disputed: disputed.has(x.id),
      tenantReason: d.reasons?.[x.id] ?? null,
    };
  });
  const lineOf = (id: string | null) => (id ? lines.find((l) => l.id === id)?.n ?? null : null);
  return {
    state: facts.pack.code, today: facts.today, address: facts.address, landlord: facts.landlord, tenants: facts.tenants,
    moveOutDate: facts.moveOutDate, statementDue: facts.statementDue,
    delivery: facts.delivery ? { method: facts.delivery.method, date: facts.delivery.date } : null,
    depositHeld: facts.depositHeld, statementRefund: facts.statementRefund, refunded: facts.refunded?.amount ?? null,
    lines,
    wearNotCharged: facts.findings.filter((f) => f.classification === "wear_and_tear" && f.status !== "dismissed").map((f) => ({ item: findingTitle(f), room: f.room })),
    dispute: {
      message: d.message,
      // Numbered, never named: a file name is the tenants' text (tenantPhotoLabel).
      evidence: (d.evidence ?? []).map((e, k) => ({ ref: e.path, label: tenantPhotoLabel(k), box: null, line: lineOf(e.deduction_id) })),
    },
    ranges: facts.ranges,
  };
}

/** A photo for the advocate: read from the private bucket, turned upright, at most 1024 pixels on its long side, with
 *  the finding's box drawn in red where it has one. */
export const loadCasePhoto: LoadPhoto = async (p: CasePhoto) => {
  const { data, error } = await db.storage.from("photos").download(p.ref);
  if (error || !data) return null;
  const base = sharp(new Uint8Array(await data.arrayBuffer())).rotate().resize({ width: 1024, height: 1024, fit: "inside", withoutEnlargement: true });
  const { data: jpeg, info } = await base.jpeg({ quality: 80 }).toBuffer({ resolveWithObject: true });
  if (!p.box) return { data: new Uint8Array(jpeg), mediaType: "image/jpeg" };
  const w = info.width, h = info.height, stroke = Math.max(3, Math.round(Math.max(w, h) / 220));
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${w}" height="${h}"><rect x="${Math.round(p.box.x * w)}" y="${Math.round(p.box.y * h)}" width="${Math.max(4, Math.round(p.box.w * w))}" height="${Math.max(4, Math.round(p.box.h * h))}" fill="none" stroke="#D64540" stroke-width="${stroke}"/></svg>`;
  const boxed = await sharp(jpeg).composite([{ input: Buffer.from(svg), top: 0, left: 0 }]).jpeg({ quality: 80 }).toBuffer();
  return { data: new Uint8Array(boxed), mediaType: "image/jpeg" };
};

/* ---------- The tenants' case as the first turn ---------- */

/** Whether the draft's advocate case was written from the draft as it stands (its reasons, photos and the amounts on
 *  the statement). */
export const caseIsCurrent = (d: DisputeRow, facts: Pick<DisputeFacts, "deductions">) =>
  !!d.advocate && d.advocate_status === "done" && d.advocate.basis === disputeBasis(d, facts);

/** The tenants' case as turn 1 of the negotiation: the advocate's case when they send it and it is current, otherwise
 *  their own ask (every disputed line back in full, as far as each range allows). A case written before the last
 *  change is never sent (the send route refuses it). Either way the code re-checks every amount against the ranges as
 *  they stand now. */
export function firstTurn(d: DisputeRow, facts: DisputeFacts, withCase: boolean) {
  const c = withCase && caseIsCurrent(d, facts) ? d.advocate : null;
  const keeps: Record<string, number> = c
    ? Object.fromEntries(c.lines.map((l) => [l.id, l.keep]))
    : Object.fromEntries(facts.ranges.lines.filter((l) => d.deduction_ids.includes(l.id)).map((l) => [l.id, l.min]));
  const check = checkProposal(facts.ranges, keeps);
  const reasons = facts.ranges.lines.filter((l) => d.reasons?.[l.id]).map((l) => `Line ${l.n}, ${l.title}: ${d.reasons[l.id]}`);
  return {
    turn: {
      actor: c ? "agent" : "human",
      proposal: check.lines.map((l) => ({ deduction_id: l.id, n: l.n, amount: l.amount, keep: l.keep, min: l.min, max: l.max })),
      total_keep: check.totalKeep,
      amount_back: check.amountBack,
      message: [d.message, ...reasons].filter(Boolean).join("\n"),
      reasoning: c ? c.summary : null,
      citations: c ? [...new Set(c.lines.map((l) => l.citation).filter(Boolean))] : [],
      checks: { problems: check.problems, adjustments: c?.adjustments ?? [], advocate: c ? "current" : "none" },
    },
    asked: check.amountBack,
  };
}

/* ---------- What the tenants' page shows ---------- */

export type DisputeLineView = {
  id: string; n: number; title: string; room: string | null; basis: string; amount: number; category: "rent" | "damage" | "cleaning";
  max: number; standing: Standing; reasons: string[]; citations: string[];
};

export type TenantDisputeView = {
  state: StateCode;
  landlord: string | null;
  address: string;
  tenants: string[];
  sent: boolean; // the statement went out: disputes open after it
  lines: DisputeLineView[];
  totals: Ranges["totals"];
  late: Ranges["late"];
  forum: StatePack["dispute"]["forum"];
  sendNote: string | null; // the pack's line above Send (Florida: not the statutory objection)
  statementRefund: number; // what the statement itself returns
  refunded: number | null; // what PayPal already sent back
  dispute: {
    status: DisputeStatus; openedBy: string | null; items: { deductionId: string; reason: string }[]; message: string | null;
    evidence: { id: string; name: string; deductionId: string | null }[];
    advocate: AdvocateCase | null; advocateStatus: DisputeRow["advocate_status"]; advocateError: string | null;
    stale: boolean; // the case was written before the draft (or the statement's amounts) last changed
    sentWithCase: boolean; // the case went to the landlord as turn 1 (false for a draft, or reasons sent on their own)
    sentAt: string | null; askedBack: number | null; closedAt: string | null;
  } | null;
};

export function lineViews(facts: DisputeFacts): DisputeLineView[] {
  return facts.ranges.lines.map((r) => {
    const d = facts.deductions.find((x) => x.id === r.id)!;
    return {
      id: r.id, n: r.n, title: r.title, room: r.room, amount: r.amount, category: r.category, max: r.max, standing: r.standing,
      reasons: r.reasons, citations: r.citations,
      basis: basisWords({ category: d.category, performer: d.performer, proration: d.proration, hours: d.hours, hourlyRate: d.hourly_rate, itemAgeYears: d.item_age_years, usefulLifeYears: d.useful_life_years }),
    };
  });
}

export async function loadTenantDispute(tenancyId: string): Promise<TenantDisputeView | null> {
  const [facts, d] = await Promise.all([disputeFacts(tenancyId), latestDispute(tenancyId)]);
  if (!facts) return null;
  const { data: turn } = d && d.status !== "draft"
    ? await db.from("negotiation_turns").select("actor").eq("dispute_id", d.id).eq("n", 1).maybeSingle()
    : { data: null };
  const ids = new Set(facts.deductions.map((x) => x.id));
  return {
    state: facts.pack.code, landlord: facts.landlord, address: facts.address, tenants: facts.tenants,
    sent: !!facts.deliveredAt && !!facts.delivery,
    lines: lineViews(facts), totals: facts.ranges.totals, late: facts.ranges.late, forum: facts.pack.dispute.forum,
    sendNote: facts.pack.dispute.sendNote,
    statementRefund: facts.statementRefund, refunded: facts.refunded?.amount ?? null,
    dispute: d ? {
      status: d.status, openedBy: d.opened_by,
      items: d.deduction_ids.filter((id) => ids.has(id)).map((id) => ({ deductionId: id, reason: d.reasons?.[id] ?? "" })),
      message: d.message,
      evidence: (d.evidence ?? []).map((e) => ({ id: e.id, name: e.name, deductionId: e.deduction_id })),
      advocate: d.advocate ? stripBasis(d.advocate) : null, advocateStatus: d.advocate_status, advocateError: d.advocate_error,
      stale: !!d.advocate && d.advocate.basis !== disputeBasis(d, facts),
      sentWithCase: turn?.actor === "agent",
      sentAt: d.sent_at, askedBack: num(d.asked_back), closedAt: d.closed_at,
    } : null,
  };
}

/** The stored case without its basis hash, for a page. */
export function stripBasis(s: StoredCase): AdvocateCase {
  const c: Partial<StoredCase> = { ...s };
  delete c.basis;
  return c as AdvocateCase;
}

/** Where the tenants' latest dispute stands, for their main page: a few columns, no facts. */
export async function tenantDisputeStatus(tenancyId: string): Promise<{ status: DisputeStatus; sentAt: string | null; askedBack: number | null; lines: number } | null> {
  const { data } = await db.from("disputes").select("status, sent_at, asked_back, deduction_ids").eq("tenancy_id", tenancyId)
    .order("created_at", { ascending: false }).limit(1).maybeSingle();
  return data ? { status: data.status as DisputeStatus, sentAt: data.sent_at as string | null, askedBack: num(data.asked_back), lines: (data.deduction_ids as string[]).length } : null;
}

/* ---------- What the landlord's page shows ---------- */

export type LandlordDisputeView = {
  status: DisputeStatus;
  openedBy: string | null;
  sentAt: string | null;
  askedBack: number | null;
  message: string | null;
  lines: (DisputeLineView & { disputed: boolean; tenantReason: string | null; proposed: { keep: number; verdict: string | null; reason: string | null; citation: string | null } | null })[];
  advocate: AdvocateCase | null;
  firstTurn: { actor: string; amountBack: number | null; checks: unknown } | null;
  evidence: { id: string; name: string; deductionId: string | null; path: string }[];
  totals: Ranges["totals"];
  late: Ranges["late"];
};

export async function loadLandlordDispute(tenancyId: string): Promise<LandlordDisputeView | null> {
  const d = await sentDispute(tenancyId);
  if (!d) return null;
  const [facts, { data: turn }] = await Promise.all([
    disputeFacts(tenancyId),
    db.from("negotiation_turns").select("actor, proposal, amount_back, checks").eq("dispute_id", d.id).eq("n", 1).maybeSingle(),
  ]);
  if (!facts) return null;
  const proposal = ((turn?.proposal ?? []) as { deduction_id: string; keep: number }[]);
  // The advocate's case only when it is what the tenants sent (turn 1 by their agent); a draft case they didn't send
  // stays theirs.
  const c = d.advocate && turn?.actor === "agent" ? stripBasis(d.advocate) : null;
  return {
    status: d.status, openedBy: d.opened_by, sentAt: d.sent_at, askedBack: num(d.asked_back), message: d.message,
    lines: lineViews(facts).map((l) => {
      const p = proposal.find((x) => x.deduction_id === l.id);
      const a = c?.lines.find((x) => x.id === l.id);
      return {
        ...l, disputed: d.deduction_ids.includes(l.id), tenantReason: d.reasons?.[l.id] ?? null,
        proposed: p ? { keep: Number(p.keep), verdict: a?.verdict ?? null, reason: a?.reason ?? null, citation: a?.citation ?? null } : null,
      };
    }),
    advocate: c,
    firstTurn: turn ? { actor: turn.actor as string, amountBack: num(turn.amount_back), checks: turn.checks } : null,
    evidence: (d.evidence ?? []).map((e) => ({ id: e.id, name: e.name, deductionId: e.deduction_id, path: e.path })),
    totals: facts.ranges.totals, late: facts.ranges.late,
  };
}

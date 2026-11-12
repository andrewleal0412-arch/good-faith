import "server-only";
import { cache } from "react";
import type { LanguageModel } from "ai";
import type { CasePhoto, LoadPhoto } from "./advocate";
import {
  ACTION_LABEL, defenseOptions, defensePosition, endedWithoutMoveOut, evidenceInput, evidenceName, evidenceWithheld, failureWords, figuresIn, MAX_EVIDENCE_BYTES,
  MAX_EVIDENCE_FILE_BYTES, readDispute, outcomeWords, reasonWords, responseHash, statusWords, validateDefense,
  type ActionOption, type DefenseAction, type DefenseContext, type DefenseResponse, type DisputeRead, type EvidenceItem, type Position,
} from "./chargeback";
import type { DefenseFile, DefenseLine } from "./chargeback-agent";
import { dateIn, shortDate } from "./dates";
import { audit, db } from "./db";
import { depositBlock } from "./demo-pool";
import { usd } from "./deductions";
import { caseFile, disputeFacts, loadCasePhoto, sentDispute, type DisputeFacts, type DisputeRow } from "./disputes";
import { returnFailed } from "./invoice-status";
import { allowedCitations } from "./lawful-range";
import { claudeNeverAnswered, type Allowance } from "./limits";
import { dueOf, packOf } from "./next-step";
import { acceptDisputeClaim, getDisputeRest, isDisputeId, makeDisputeOffer, paypal, PayPalRefused, SANDBOX, sendDisputeEvidence, type EvidenceFile } from "./paypal";
import type { PayPalDisputeRow } from "./paypal-webhook";
import { disputeAftermath, webhookStore } from "./paypal-webhook-store";
import { buildStatement } from "./statement";
import { zoneOf } from "./states/server";
import type { TenantMoveOut } from "./tenant";
import { loadUnit } from "./units";
import { MAX_PIXELS } from "./uploads";
import type { Workspace } from "./workspace";

// The tenants' PayPal disputes and chargebacks of the deposit payment, with the database and PayPal: finding them
// (PayPal's webhook stores them; "Check PayPal" asks the Disputes API through PayPal's Agent Toolkit, list_disputes and
// get_dispute over MCP), preparing the landlord's response with the defense agent (chargeback-agent.ts, bounded by
// chargeback.ts), and sending it only once the landlord approves that exact response.
//
// The send is guarded like every other money path: the approval is claimed once in the database (a double click sends
// once, and only a response whose hash the page showed), then everything is checked again against the database and
// PayPal's live state right before PayPal is called: a sandbox build, a deposit this workspace owns (never a demo
// template's shared payment), the dispute still open and on this deposit's payment, the response still one the rules
// and PayPal allow at the same amount. Each PayPal write carries a PayPal-Request-Id from the response (gf-dispute-<id>-
// <step>). A step PayPal never answered leaves the response unconfirmed; "Check with PayPal" reads the dispute and
// sends only what didn't go, with the same keys, and a step still to go passes the rules-and-PayPal guard again first.
// Every step is in the audit log.

type Obj = Record<string, unknown>;
const cents = (n: number) => Math.round(n * 100) / 100;

/** A preparation that started this long ago and never finished may be started again. */
export const DEFENSE_STALE_SECONDS = 300;
/** A send still 'sending' after this long died before its end was recorded: it reads as unconfirmed, and Check with
 *  PayPal takes it (approve_dispute_response and claim_dispute_defense count the same ten minutes). */
export const SEND_STALE_SECONDS = 600;
/** Money back to the tenants that counts as returned, a refund made in PayPal and recorded as the deposit's refund
 *  among it (reconcile.ts). */
const BACK_KINDS = ["refund", "payout", "settlement_refund", "settlement_payout", "dispute_refund", "outside_refund"];

/** A response's status as the pages show it: a send stuck in 'sending' past SEND_STALE_SECONDS is unconfirmed. */
const shownStatus = (r: Pick<ResponseRow, "status" | "updated_at">): ResponseRow["status"] =>
  r.status === "sending" && Date.parse(r.updated_at) < Date.now() - SEND_STALE_SECONDS * 1000 ? "unknown" : r.status;

export type StoredDispute = PayPalDisputeRow & { checked_at: string | null; created_at: string; updated_at: string };

export type Progress = {
  evidence?: { at: string; route: string; files: string[]; skipped?: string[] };
  accept?: { at: string; amount: number; type: string };
  offer?: { at: string; amount: number };
};

export type ResponseRow = {
  id: string; dispute_id: string; tenancy_id: string; workspace_id: string | null;
  status: "preparing" | "ready" | "declined" | "superseded" | "sending" | "sent" | "refused" | "unknown" | "failed";
  action: DefenseAction | null; amount: number | string | null; response: DefenseResponse | null; response_hash: string | null;
  model: string | null; steps: number | null; progress: Progress | null; paypal_request_id: string | null; error: string | null;
  started_at: string; approved_at: string | null; sent_at: string | null; created_at: string; updated_at: string;
};

/* ---------- Reading PayPal ---------- */

/** What the store asks PayPal and the model through. A check stands them in to run every path without PayPal or
 *  Claude; the app's routes use the defaults. */
export type DefenseDeps = {
  listDisputes?: (capture: string) => Promise<Obj[]>;
  getDispute?: (id: string) => Promise<Obj>;
  evidence?: typeof sendDisputeEvidence;
  accept?: typeof acceptDisputeClaim;
  offer?: typeof makeDisputeOffer;
  files?: (keys: string[], c: CaseBits) => Promise<{ files: EvidenceFile[]; skipped: string[] }>;
  model?: LanguageModel;
  loadPhoto?: LoadPhoto;
};

/** One call to PayPal's Agent Toolkit over MCP (list_disputes or get_dispute), its JSON out of the tool's answer. */
async function toolkit(name: "list_disputes" | "get_dispute", input: Obj): Promise<Obj> {
  // The toolkit and its MCP server are loaded here, not when this file loads: a property page shows a dispute from the
  // database and must not pay for PayPal's Agent Toolkit to render (docs/PERFORMANCE.md).
  const { connectPayPal, mcpJson } = await import("./agent");
  const pp = await connectPayPal({ disputes: true });
  try {
    const t = (await pp.client.tools())[name];
    if (!t?.execute) throw new Error(`PayPal Agent Toolkit didn't expose ${name}`);
    const out = mcpJson(await t.execute(input, { toolCallId: `gf-${name}`, messages: [], context: {} }));
    if (!out || out.error || (out.ok === false)) throw new Error(`${name}: ${JSON.stringify(out ?? "no answer").slice(0, 200)}`);
    return out;
  } finally {
    await pp.close().catch(() => {});
  }
}

/** The disputes of one payment, through the toolkit (PayPal's REST as the fallback when the toolkit fails). */
async function listLive(capture: string): Promise<Obj[]> {
  try {
    return ((await toolkit("list_disputes", { disputed_transaction_id: capture, page_size: 10 })).items ?? []) as Obj[];
  } catch (e) {
    console.warn("Agent Toolkit list_disputes failed; reading PayPal's REST API", e instanceof Error ? e.message : e);
    return ((await paypal<Obj>("GET", `/v1/customer/disputes?disputed_transaction_id=${encodeURIComponent(capture)}&page_size=10`)).items ?? []) as Obj[];
  }
}

/** One dispute as PayPal has it now, through the toolkit's get_dispute (REST as the fallback). */
export async function readLive(id: string): Promise<Obj> {
  if (!isDisputeId(id)) throw new PayPalRefused(`Not a PayPal dispute id: ${String(id).slice(0, 40)}`);
  try {
    return await toolkit("get_dispute", { dispute_id: id });
  } catch (e) {
    console.warn("Agent Toolkit get_dispute failed; reading PayPal's REST API", e instanceof Error ? e.message : e);
    return getDisputeRest(id);
  }
}

/** The row the webhook would store for this dispute, from PayPal's own JSON. */
function rowOf(raw: Obj, tenancyId: string, workspaceId: string | null, source: string): PayPalDisputeRow {
  const d = readDispute(raw);
  return {
    id: d.id, tenancy_id: tenancyId, workspace_id: workspaceId, capture_id: d.sellerTransactionId, reason: d.reason, status: d.status, stage: d.stage,
    amount: d.amount, currency: d.currency, outcome: d.outcome?.code ?? null, paypal_created_at: d.createdAt, paypal_updated_at: d.updatedAt,
    last_event_id: source, raw,
  };
}

/** Store what PayPal says of a dispute now (newer only, this tenancy's only), and put a change on the activity and the
 *  bell the way the webhook does. True when it was new or its status changed. */
async function storeLive(raw: Obj, tenancyId: string, workspaceId: string | null): Promise<boolean> {
  const row = rowOf(raw, tenancyId, workspaceId, `check:${new Date().toISOString()}`);
  if (!row.id) return false;
  const up = await webhookStore.upsertDispute(row);
  await db.from("paypal_disputes").update({ checked_at: new Date().toISOString() }).eq("id", row.id).eq("tenancy_id", tenancyId);
  if (!up) return false;
  const { data: had } = await db.from("audit_log").select("id").eq("tenancy_id", tenancyId).eq("action", "paypal_dispute").eq("detail->>dispute_id", row.id).limit(1);
  const event = !had?.length ? "created" : row.status === "RESOLVED" ? "resolved" : "updated";
  const changed = !had?.length || up.previousStatus !== row.status;
  if (changed) {
    await audit(tenancyId, "system", "paypal_dispute", { source: "paypal", via: "check", event, dispute_id: row.id, reason: row.reason, status: row.status, amount: row.amount, outcome: row.outcome });
  }
  // The money PayPal returned through it, and once resolved, the responses nobody can send any more: the same as the
  // webhook does (paypal-webhook-store.ts).
  await disputeAftermath(tenancyId, raw);
  return changed;
}

/* ---------- Rows ---------- */

export async function tenancyDisputes(tenancyId: string): Promise<StoredDispute[]> {
  const { data } = await db.from("paypal_disputes").select("*").eq("tenancy_id", tenancyId).order("paypal_created_at", { ascending: false, nullsFirst: false });
  return (data ?? []) as StoredDispute[];
}

/** The dispute a tenancy's pages show: the newest open one, else the newest. */
export async function currentDispute(tenancyId: string): Promise<StoredDispute | null> {
  const all = await tenancyDisputes(tenancyId);
  return all.find((d) => readDispute(d.raw).open) ?? all[0] ?? null;
}

/** The dispute's latest response. With `retired`, one PayPal's resolution retired (superseded, with the reason) counts
 *  too, so the card can say why it never went; one a new preparation replaced never does. */
async function latestResponse(disputeId: string, tenancyId: string, o: { retired?: boolean } = {}): Promise<ResponseRow | null> {
  const q = db.from("paypal_dispute_responses").select("*").eq("dispute_id", disputeId).eq("tenancy_id", tenancyId);
  const { data } = await (o.retired ? q.or("status.neq.superseded,error.not.is.null") : q.neq("status", "superseded"))
    .order("created_at", { ascending: false }).limit(1).maybeSingle();
  return (data as ResponseRow | null) ?? null;
}

/* ---------- The case ---------- */

type PaymentRow = { kind: string; paypal_id: string | null; amount: number | string; status: string; created_at: string; raw: Obj | null };

/** What a response is weighed on and built from, read from the database (and, with `live`, PayPal's invoice). */
export type CaseBits = {
  tenancyId: string;
  facts: DisputeFacts;
  lines: DefenseLine[];
  deductions: DisputeFacts["deductions"];
  payments: PaymentRow[];
  invoice: PaymentRow | null;
  capture: string | null;
  returned: number;
  refunds: { what: string; amount: number; paypalId: string | null; on: string }[];
  agreedBack: number | null;
  history: string | null;
  catalog: EvidenceItem[];
  /** No move-out date on file, but the lease end or a planned move-out (the landlord's, or the tenants' through their
   *  link) has passed. */
  ended: boolean;
  leasePath: string | null; // the signed lease, in the leases bucket
};

const documentsWords = (d: DisputeFacts["deductions"][number]) => [
  d.receipt_path ? (d.performer === "vendor" ? "vendor invoice" : "receipt") : null,
  d.is_estimate ? "good-faith estimate" : null,
  d.after_photo_paths.length ? `${d.after_photo_paths.length} after photo${d.after_photo_paths.length === 1 ? "" : "s"}` : null,
  d.labor_description ? "labor description" : null,
  d.finding?.moveInPath && d.finding?.moveOutPath ? "move-in and move-out photos" : null,
].filter(Boolean).join(", ") || "none";

export async function caseBits(tenancyId: string): Promise<CaseBits | null> {
  const facts = await disputeFacts(tenancyId);
  if (!facts) return null;
  const [{ data: pays }, sent, { data: t }] = await Promise.all([
    db.from("payments").select("kind, paypal_id, amount, status, created_at, raw").eq("tenancy_id", tenancyId).order("created_at"),
    sentDispute(tenancyId),
    db.from("tenancies").select("end_date, planned_move_out, tenant_move_out, lease_pdf_path").eq("id", tenancyId).maybeSingle(),
  ]);
  const ended = endedWithoutMoveOut({
    today: facts.today, moveOutDate: facts.moveOutDate, endDate: (t?.end_date as string | null) ?? null, plannedMoveOut: (t?.planned_move_out as string | null) ?? null,
    tenantPlanned: ((t?.tenant_move_out ?? null) as TenantMoveOut | null)?.planned_move_out ?? null,
  });
  const leasePath = (t?.lease_pdf_path as string | null) ?? null;
  const payments = (pays ?? []) as PaymentRow[];
  const invoice = payments.find((p) => p.kind === "deposit_invoice") ?? null;
  const capture = ((invoice?.raw?.transactions as { payment_id?: string }[] | undefined)?.[0]?.payment_id) ?? null;
  // Money back that moved (a demo copy's recorded example moved none).
  const back = payments.filter((p) => BACK_KINDS.includes(p.kind) && !returnFailed(p.status) && !(p.raw && (p.raw as Obj).demo_example === true));
  const returned = cents(back.reduce((s, p) => s + Number(p.amount), 0));
  const WHAT: Record<string, string> = { refund: "Refund to the original payment", payout: "PayPal Payout", settlement_refund: "Settlement refund", settlement_payout: "Settlement Payout", dispute_refund: "Refund through the PayPal dispute", outside_refund: "Refund made in PayPal" };
  const refunds = back.map((p) => ({ what: WHAT[p.kind] ?? p.kind, amount: Number(p.amount), paypalId: p.paypal_id, on: dateIn(p.created_at, facts.pack.timeZone.id) }));
  // A settlement both sides agreed and that hasn't gone yet gives back its amount on top; the history says how the
  // tenants' dispute of the statement went.
  let agreedBack: number | null = null, history: string | null = null;
  if (sent) {
    const { data: s } = await db.from("settlements").select("amount, status").eq("dispute_id", sent.id).neq("status", "cancelled").maybeSingle();
    if (sent.status === "agreed" && s && s.status !== "sent") agreedBack = Number(s.amount);
    history = sent.status === "settled" ? `The tenants disputed the statement and it was settled: ${usd(Number(s?.amount ?? 0))} back on top of the statement's refund.`
      : sent.status === "agreed" ? `The tenants disputed the statement; both sides agreed ${usd(Number(s?.amount ?? 0))} back, not paid yet.`
        : sent.status === "no_agreement" ? "The tenants disputed the statement; the negotiation ended without agreement."
          : sent.status === "withdrawn" ? "The tenants disputed the statement and withdrew the dispute."
            : `The tenants dispute the statement (${sent.status}); it is not settled.`;
  }
  const file = caseFile(facts, { deduction_ids: [], reasons: {}, message: null, evidence: [] } as unknown as DisputeRow);
  const lines: DefenseLine[] = facts.ranges.lines.map((r) => {
    const l = file.lines.find((x) => x.id === r.id)!;
    const d = facts.deductions.find((x) => x.id === r.id)!;
    return {
      n: r.n, title: r.title, room: r.room, amount: r.amount, max: r.max, standing: r.standing, reasons: r.reasons, math: d.math,
      documents: documentsWords(d), photos: { moveIn: l.photos.moveIn, moveOut: l.photos.moveOut, after: l.photos.after[0] ?? null },
    };
  });
  const catalog: EvidenceItem[] = [];
  if (facts.moveOutDate && facts.deductions.length) {
    catalog.push({ key: "statement", label: facts.deliveredAt ? "The itemized statement as delivered, with its photo and invoice exhibits (PDF)" : "The itemized statement draft, with its photo and invoice exhibits (PDF)", kind: "statement", line: null, files: 1 });
  }
  // A dispute while the tenancy runs (a payment the tenants say they didn't authorize, or didn't get anything for):
  // the signed lease that names the deposit is the record that answers it.
  if (!facts.moveOutDate && leasePath) catalog.push({ key: "lease", label: "The signed lease, which sets the security deposit (PDF)", kind: "lease", line: null, files: 1 });
  for (const l of lines) {
    const d = facts.deductions.find((x) => facts.ranges.lines.find((r) => r.n === l.n)?.id === x.id)!;
    if (l.photos.moveIn && l.photos.moveOut) catalog.push({ key: `line-${l.n}-photos`, label: `Line ${l.n}, ${l.title}: the move-in and move-out photos, the change boxed`, kind: "photos", line: l.n, files: 2 });
    if (d.receipt_path) catalog.push({ key: `line-${l.n}-receipt`, label: `Line ${l.n}, ${l.title}: the ${d.performer === "vendor" ? "vendor invoice" : "receipt"}`, kind: "receipt", line: l.n, files: 1 });
    if (l.photos.after) catalog.push({ key: `line-${l.n}-after`, label: `Line ${l.n}, ${l.title}: the photo after the work`, kind: "after", line: l.n, files: 1 });
  }
  return { tenancyId, facts, lines, deductions: facts.deductions, payments, invoice, capture, returned, refunds, agreedBack, history, catalog, ended, leasePath };
}

/** Every amount a note may name: the deposit, what was returned, each charge and its ceiling, the totals, the
 *  position's figures. */
function figuresOf(c: CaseBits, p: Position): number[] {
  return [c.facts.depositHeld, c.returned, c.facts.statementRefund, c.facts.ranges.totals.deducted, c.facts.ranges.totals.maxKeep,
    ...c.refunds.map((r) => r.amount), ...c.lines.flatMap((l) => [l.amount, l.max]), p.held, p.lawfulKeep, p.owedBack, p.claimed, p.contested,
    ...(c.agreedBack ? [c.agreedBack] : []),
    // Each charge's own math and reasons (an invoice before proration, an hourly rate) are the record too.
    ...c.lines.flatMap((l) => figuresIn([l.math, ...l.reasons].join(" ")))];
}

/** The code's own note for PayPal: true whatever the agent wrote, for when its note can't be used. */
function fallbackNote(c: CaseBits, p: Position, d: DisputeRead) {
  return (a: DefenseAction, amount: number | null): string => {
    const f = c.facts;
    const inv = c.invoice?.paypal_id;
    const parts = [`The tenants paid a ${usd(f.depositHeld)} security deposit for ${f.address} through PayPal${inv ? ` (invoice ${inv})` : ""}.`];
    if (f.moveOutDate) parts.push(`They moved out on ${shortDate(f.moveOutDate)}.`);
    if (c.lines.length) {
      parts.push(`The itemized statement${f.delivery ? ` delivered on ${shortDate(f.delivery.date)}` : ""} under ${f.pack.statute.full} charges ${usd(f.ranges.totals.deducted)}: ${c.lines.map((l) => `${l.title} ${usd(l.amount)}`).join("; ")}.`);
    } else if (p.phase === "tenancy") {
      // Said only when no date on file says the tenancy ended (endedWithoutMoveOut).
      parts.push(`The tenancy is still running, and the deposit is held as security under the lease${c.catalog.some((x) => x.kind === "lease") ? ", which is attached" : ""}.`);
    }
    for (const r of c.refunds) parts.push(`${r.what}: ${usd(r.amount)} on ${shortDate(r.on)}${r.paypalId ? ` (${r.paypalId})` : ""}.`);
    switch (a) {
      case "provide_evidence": parts.push(p.phase === "tenancy" ? "Nothing is owed back while the tenancy runs." : "Nothing more is owed back under the statement. The statement and its records are attached."); break;
      case "accept_claim": parts.push(`We accept the claim of ${usd(amount ?? d.amount)}.`); break;
      case "make_offer": parts.push(`We offer ${usd(amount ?? p.owedBack)} back to settle this dispute.`); break;
    }
    return parts.join(" ");
  };
}

/** The dispute read live, the case, the position, the responses left and what the agent and the guard need. */
export type DefenseSetup = {
  raw: Obj; dispute: DisputeRead; bits: CaseBits; position: Position; options: ActionOption[]; none: string | null; block: string | null;
  ctx: DefenseContext;
};

async function setup(tenancyId: string, ws: Workspace, stored: StoredDispute, deps: DefenseDeps, o: { live: boolean }): Promise<DefenseSetup | { error: string; status: number }> {
  let raw: Obj = stored.raw;
  if (o.live) {
    try {
      raw = await (deps.getDispute ?? readLive)(stored.id);
    } catch (e) {
      console.error("PayPal dispute read failed", e);
      return { error: "PayPal couldn't be reached, so the dispute couldn't be read. Try again in a minute.", status: 502 };
    }
    if (!deps.getDispute) await storeLive(raw, tenancyId, ws.id).catch((e) => console.error("PayPal dispute not stored", e));
    else await webhookStore.upsertDispute(rowOf(raw, tenancyId, ws.id, `check:${new Date().toISOString()}`)).catch(() => null);
  }
  const dispute = readDispute(raw);
  const bits = await caseBits(tenancyId);
  if (!bits) return { error: "No such tenancy.", status: 404 };
  const position = defensePosition({
    depositHeld: bits.facts.depositHeld, returned: bits.returned, movedOut: !!bits.facts.moveOutDate, ended: bits.ended,
    maxKeep: bits.deductions.length ? bits.facts.ranges.totals.maxKeep : 0, agreedBack: bits.agreedBack,
    // What the tenants can get back through PayPal: the disputed amount, as far as PayPal says the payment can still
    // be refunded.
    claimed: dispute.refundAllowed != null ? Math.min(dispute.amount, dispute.refundAllowed) : dispute.amount,
  });
  // What can't be answered from here at all: a live PayPal build without a sign-in, a deposit this workspace doesn't
  // own (a demo template's payment every copy shows), a dispute about some other payment.
  let block: string | null = null;
  if (!SANDBOX) block = "This build has no landlord sign-in, so it won't answer a live PayPal dispute.";
  const inv = bits.invoice?.paypal_id ?? null;
  const demo = inv ? await depositBlock(ws.id, inv) : null;
  if (!block && demo) block = demo.replace("send its refund", "answer its PayPal dispute");
  if (!block && dispute.sellerTransactionId && bits.capture && dispute.sellerTransactionId !== bits.capture) block = "This dispute is about another PayPal payment than this tenancy's deposit.";
  const { options, none } = defenseOptions(position, dispute, { block });
  const ctx: DefenseContext = {
    dispute, position, options, catalog: bits.catalog, citations: allowedCitations(bits.facts.pack, bits.facts.ranges),
    figures: figuresOf(bits, position), fallbackNote: fallbackNote(bits, position, dispute),
  };
  return { raw, dispute, bits, position, options, none, block, ctx };
}

function defenseFile(s: DefenseSetup): DefenseFile {
  const f = s.bits.facts;
  const txn = ((s.bits.invoice?.raw?.transactions as { payment_date?: string; payment_date_time?: string }[] | undefined) ?? [])[0];
  return {
    ...s.ctx, pack: f.pack, today: f.today, address: f.address, landlord: f.landlord, tenants: f.tenants,
    depositHeld: f.depositHeld, depositPaidOn: txn?.payment_date ?? null, capture: s.bits.capture,
    moveOutDate: f.moveOutDate, statementDue: f.statementDue, delivery: f.delivery ? { method: f.delivery.method, date: f.delivery.date } : null,
    refunds: s.bits.refunds, lines: s.bits.lines, history: s.bits.history,
  };
}

/* ---------- Check PayPal ---------- */

const lastCheck = new Map<string, number>();

/** "Check PayPal": the disputes PayPal has on this deposit's payment, read through the Agent Toolkit and stored as the
 *  webhook would store them. Only for a deposit this workspace owns. */
export async function checkPayPalDisputes(tenancyId: string, ws: Workspace, deps: DefenseDeps = {}): Promise<{ ok: true; found: number; changed: number } | { ok: false; error: string; status: number }> {
  if (!SANDBOX) return { ok: false, error: "This build has no landlord sign-in, so it won't read live PayPal disputes.", status: 409 };
  const { data: inv } = await db.from("payments").select("paypal_id, raw").eq("tenancy_id", tenancyId).eq("kind", "deposit_invoice").maybeSingle();
  const capture = ((inv?.raw as { transactions?: { payment_id?: string }[] } | null)?.transactions?.[0]?.payment_id) ?? null;
  if (!inv?.paypal_id || !capture) return { ok: false, error: "No PayPal payment of the deposit is on file, so there's nothing to check.", status: 409 };
  const demo = await depositBlock(ws.id, inv.paypal_id);
  if (demo) return { ok: false, error: demo.replace("send its refund", "check PayPal for disputes of its deposit"), status: 409 };
  const now = Date.now();
  if (!deps.listDisputes && (lastCheck.get(tenancyId) ?? 0) > now - 15_000) return { ok: false, error: "Checked a moment ago. Try again in a few seconds.", status: 429 };
  lastCheck.set(tenancyId, now);
  if (lastCheck.size > 2000) lastCheck.clear();
  let items: Obj[];
  try {
    items = await (deps.listDisputes ?? listLive)(capture);
  } catch (e) {
    console.error("PayPal dispute check failed", e);
    return { ok: false, error: "PayPal couldn't be reached. Try again in a minute.", status: 502 };
  }
  let found = 0, changed = 0;
  for (const it of items.slice(0, 10)) {
    const id = typeof it.dispute_id === "string" ? it.dispute_id : null;
    if (!isDisputeId(id)) continue;
    const full = await (deps.getDispute ?? readLive)(id).catch(() => null);
    if (!full) continue;
    const d = readDispute(full);
    // Only a dispute of this very payment: an id the list returned for anything else changes nothing here.
    if (d.sellerTransactionId && d.sellerTransactionId !== capture) continue;
    found++;
    if (await storeLive(full, tenancyId, ws.id)) changed++;
  }
  return { ok: true, found, changed };
}

/* ---------- Prepare ---------- */

export type PrepareResult = { ok: true; responseId: string } | { ok: false; error: string; status: number; running?: boolean };

/** "Prepare a response": the defense agent reads the case and proposes one response, which code checks and stores as
 *  ready for the landlord. Claimed once per dispute, and counted against today's close-out allowance before Claude is
 *  called. */
export async function prepareDefense(tenancyId: string, ws: Workspace, take: () => Promise<Allowance>, deps: DefenseDeps = {}): Promise<PrepareResult> {
  const stored = await currentDispute(tenancyId);
  if (!stored || !readDispute(stored.raw).open) return { ok: false, error: "There's no open PayPal dispute on this deposit.", status: 404 };
  const s = await setup(tenancyId, ws, stored, deps, { live: true });
  if ("error" in s) return { ok: false, error: s.error, status: s.status };
  if (!s.options.length) return { ok: false, error: s.none ?? "No response is possible here.", status: 409 };

  const { data: id, error: ce } = await db.rpc("claim_dispute_defense", { p_dispute: stored.id, p_tenancy: tenancyId, p_stale_seconds: DEFENSE_STALE_SECONDS });
  if (ce) {
    console.error("defense claim failed", ce.message);
    return { ok: false, error: "Couldn't start preparing the response. Try again.", status: 500 };
  }
  if (!id) return { ok: false, error: "A response is being prepared or sent already. This page updates when it is ready.", status: 409, running: true };
  const responseId = id as string;
  const fail = async (error: string) => {
    await db.from("paypal_dispute_responses").update({ status: "failed", error: error.slice(0, 300), updated_at: new Date().toISOString() }).eq("id", responseId).eq("status", "preparing");
  };

  const allowance = await take();
  if (allowance.refused) {
    const msg = (await allowance.refused.clone().json().catch(() => ({})))?.error ?? "Today's limit for this is used up.";
    await fail(msg);
    return { ok: false, error: msg, status: allowance.refused.status };
  }
  await audit(tenancyId, "landlord", "dispute_defense_started", { dispute_id: stored.id, response_id: responseId, options: s.options.map((o) => o.action) });
  try {
    // The defense agent and its model SDK are loaded here, on the one path that runs them.
    const { forTheRecord, runDefenseAgent } = await import("./chargeback-agent");
    const run = await runDefenseAgent(defenseFile(s), {
      loadPhoto: deps.loadPhoto ?? loadCasePhoto,
      readDispute: async () => (deps.getDispute ?? readLive)(stored.id),
      model: deps.model,
    });
    const response = validateDefense(run.raw, s.ctx, { model: run.model, steps: run.steps });
    if (!response) throw new Error("No response is possible here.");
    const { error } = await db.from("paypal_dispute_responses").update({
      status: "ready", action: response.action, amount: response.amount, response, response_hash: responseHash(response),
      // The agent's words for the record; the photos it looked at are named, not kept (forTheRecord).
      messages: forTheRecord(run.messages), model: run.model, steps: run.steps, error: null, updated_at: new Date().toISOString(),
    }).eq("id", responseId).eq("status", "preparing");
    if (error) throw new Error(`the response couldn't be stored: ${error.message}`);
    await audit(tenancyId, "agent", "dispute_defense_prepared", {
      dispute_id: stored.id, response_id: responseId, action: response.action, amount: response.amount, adjustments: response.adjustments.length, evidence: response.evidence.length,
    });
    return { ok: true, responseId };
  } catch (e) {
    console.error("defense agent failed", e);
    const claude = claudeNeverAnswered(e);
    if (claude) await allowance.giveBack();
    // The page gets words a landlord can read (failureWords); the raw text stays in the audit row and the log above.
    const message = e instanceof Error ? e.message.slice(0, 300) : "failed";
    await fail(failureWords(e, "prepare", { claude }));
    await audit(tenancyId, "agent", "dispute_defense_failed", { dispute_id: stored.id, response_id: responseId, error: message });
    return { ok: false, error: "The defense agent couldn't prepare a response. Try again in a minute.", status: 500 };
  }
}

/* ---------- Approve and send ---------- */

export type SendResult = { ok: true; status: "sent" } | { ok: false; error: string; status: number };

async function responseOf(tenancyId: string, responseId: string): Promise<ResponseRow | null> {
  const { data } = await db.from("paypal_dispute_responses").select("*").eq("id", responseId).eq("tenancy_id", tenancyId).maybeSingle();
  return (data as ResponseRow | null) ?? null;
}

/** "Approve and send": the landlord's approval of the exact response the page showed (its hash), claimed once, then
 *  sent through the guard. */
export async function approveDefense(tenancyId: string, ws: Workspace, responseId: string, hash: string, deps: DefenseDeps = {}): Promise<SendResult> {
  const row = await responseOf(tenancyId, responseId);
  if (!row) return { ok: false, error: "No such response.", status: 404 };
  const { data: claimed, error } = await db.rpc("approve_dispute_response", { p_response: responseId, p_hash: hash, p_recheck: false });
  if (error) {
    console.error("dispute response approval failed", error.message);
    return { ok: false, error: "Couldn't record your approval. Try again.", status: 500 };
  }
  if (!claimed) return { ok: false, error: "This response isn't waiting on your approval any more: it was sent, changed or replaced. Reload the page.", status: 409 };
  const r = claimed as ResponseRow;
  await audit(tenancyId, "landlord", "dispute_response_approved", { dispute_id: r.dispute_id, response_id: r.id, action: r.action, amount: r.amount == null ? null : Number(r.amount) });
  return send(tenancyId, ws, r, deps, false);
}

/** "Check with PayPal" for a response PayPal never confirmed: what the dispute shows went is taken as gone, and only
 *  the rest is sent again, with the same keys. */
export async function recheckDefense(tenancyId: string, ws: Workspace, responseId: string, deps: DefenseDeps = {}): Promise<SendResult> {
  const row = await responseOf(tenancyId, responseId);
  if (!row) return { ok: false, error: "No such response.", status: 404 };
  const { data: claimed, error } = await db.rpc("approve_dispute_response", { p_response: responseId, p_hash: null, p_recheck: true });
  if (error) return { ok: false, error: "Couldn't start the check. Try again.", status: 500 };
  if (!claimed) return { ok: false, error: "This response isn't waiting on a check. Reload the page.", status: 409 };
  await audit(tenancyId, "landlord", "dispute_response_rechecked", { dispute_id: row.dispute_id, response_id: row.id });
  return send(tenancyId, ws, claimed as ResponseRow, deps, true);
}

/** The landlord says no: nothing goes to PayPal, and a new response can be prepared. */
export async function declineDefense(tenancyId: string, responseId: string): Promise<SendResult | { ok: true; status: "declined" }> {
  const { data } = await db.from("paypal_dispute_responses").update({ status: "declined", updated_at: new Date().toISOString() })
    .eq("id", responseId).eq("tenancy_id", tenancyId).eq("status", "ready").select("dispute_id");
  if (!data?.length) return { ok: false, error: "This response isn't waiting on your approval.", status: 409 };
  await audit(tenancyId, "landlord", "dispute_response_declined", { dispute_id: data[0].dispute_id, response_id: responseId });
  return { ok: true, status: "declined" };
}

/** How a send ended: 'blocked' puts it back for approval (the guard stopped it before PayPal); 'closed' retires it
 *  (PayPal resolved the dispute first, so nothing can be sent on it). */
async function finish(id: string, outcome: "sent" | "refused" | "unknown" | "blocked" | "closed", progress: Progress, error: string | null) {
  const { error: e } = await db.rpc("finish_dispute_response", { p_response: id, p_outcome: outcome, p_progress: progress, p_error: error?.slice(0, 300) ?? null });
  if (e) console.error("dispute response finish failed", e.message);
}

async function step(id: string, progress: Progress, payment: Obj | null) {
  const { data, error } = await db.rpc("record_dispute_step", { p_response: id, p_progress: progress, p_payment: payment });
  if (error || !data) throw new Error(`the PayPal step couldn't be recorded: ${error?.message ?? "the response moved on"}`);
}

/** Whether the live dispute already shows a step that went (the landlord's evidence after the approval, an offer, a
 *  resolution). */
function shows(d: DisputeRead, raw: Obj, since: string | null, what: "evidence" | "offer" | "accept"): boolean {
  if (what === "accept") return !d.open;
  if (what === "offer") return !!(raw.offer && (raw.offer as Obj).seller_offered_amount);
  const after = since ? Date.parse(since) : 0;
  return (Array.isArray(raw.evidences) ? raw.evidences : []).some((e) => {
    const x = (e ?? {}) as Obj;
    return x.source === "SUBMITTED_BY_SELLER" && Date.parse(String(x.date ?? "")) >= after - 60_000;
  }) || (Array.isArray(raw.supporting_info) ? raw.supporting_info : []).some((e) => {
    const x = (e ?? {}) as Obj;
    return x.source === "SUBMITTED_BY_SELLER" && Date.parse(String(x.provided_time ?? "")) >= after - 60_000;
  });
}

async function send(tenancyId: string, ws: Workspace, r: ResponseRow, deps: DefenseDeps, recheck: boolean): Promise<SendResult> {
  const resp = r.response;
  const stem = r.paypal_request_id ?? `gf-dispute-${r.id}`;
  const progress: Progress = { ...(r.progress ?? {}) };
  if (!resp || !r.action) {
    await finish(r.id, "blocked", progress, "This response has nothing to send.");
    return { ok: false, error: "This response has nothing to send.", status: 409 };
  }
  const blocked = async (why: string): Promise<SendResult> => {
    await finish(r.id, recheck ? "unknown" : "blocked", progress, why);
    await audit(tenancyId, "system", "dispute_response_blocked", { dispute_id: r.dispute_id, response_id: r.id, reason: why, rechecked: recheck || undefined });
    return { ok: false, error: why, status: 409 };
  };
  /** The rules' or PayPal's own guard stopped a step that hadn't gone: back for approval, on a check too. On a check
   *  the live read is taken as final (the dispute shows nothing of the step went, so it is treated as never sent, as
   *  the resend itself does); a response left unconfirmed instead would refuse every new preparation, and an
   *  approval after this runs the same guard and sends with the same PayPal-Request-Id. */
  const guardStop = async (why: string): Promise<SendResult> => {
    await finish(r.id, "blocked", progress, why);
    await audit(tenancyId, "system", "dispute_response_blocked", { dispute_id: r.dispute_id, response_id: r.id, reason: why, rechecked: recheck || undefined });
    return { ok: false, error: why, status: 409 };
  };

  // The guard: everything again, from the database and PayPal's live state, right before PayPal is called.
  const { data: storedRow } = await db.from("paypal_disputes").select("*").eq("id", r.dispute_id).eq("tenancy_id", tenancyId).maybeSingle();
  if (!storedRow) return blocked("The dispute isn't on record for this tenancy any more.");
  const s = await setup(tenancyId, ws, storedRow as StoredDispute, deps, { live: true });
  if ("error" in s) {
    await finish(r.id, recheck ? "unknown" : "blocked", progress, s.error);
    return { ok: false, error: s.error, status: s.status };
  }
  if (s.block) return blocked(s.block);
  // PayPal resolved the dispute before this response went, or before it confirmed it: nothing can be sent on it any
  // more, so it is retired rather than put back for approval (what PayPal returned through the dispute is recorded from
  // its own word by the read above). A step on record as gone makes it sent.
  if (!s.dispute.open) {
    const went = !!(progress.evidence || progress.accept || progress.offer);
    const why = went ? null : recheck ? "PayPal resolved the dispute before it confirmed this response. What PayPal returned through the dispute is on the Payments tab."
      : "PayPal resolved this dispute meanwhile, so nothing was sent.";
    await finish(r.id, went ? "sent" : "closed", progress, why);
    if (went) return { ok: true, status: "sent" };
    await audit(tenancyId, "system", "dispute_response_blocked", { dispute_id: r.dispute_id, response_id: r.id, reason: why });
    return { ok: false, error: why!, status: 409 };
  }
  const done = {
    evidence: !!progress.evidence || (recheck && shows(s.dispute, s.raw, r.approved_at, "evidence")),
    accept: !!progress.accept || (recheck && shows(s.dispute, s.raw, r.approved_at, "accept")),
    offer: !!progress.offer || (recheck && shows(s.dispute, s.raw, r.approved_at, "offer")),
  };
  const amount = r.amount == null ? null : Number(r.amount);
  // The response still one the rules and PayPal allow, at the same amount, whenever its step has yet to go: on the
  // approval, and on a check too, since the figures can change between an approval PayPal never confirmed and the
  // check that would send it (a refund reversed, a charge removed). A response the guard stops goes back for approval
  // on both paths, with nothing sent, so a new response can be prepared in its place; what the live dispute shows went
  // (done) is never sent again, so a step that went is never judged twice.
  const pending = r.action === "provide_evidence" ? !done.evidence : r.action === "accept_claim" ? !done.accept : r.action === "make_offer" ? !done.offer : false;
  if (pending) {
    const option = s.options.find((o) => o.action === r.action);
    if (!option) return guardStop(`${ACTION_LABEL[r.action]} is no longer a response the rules and PayPal allow here${s.none ? `: ${s.none}` : ""}. Nothing was sent; prepare a new response.`);
    if (option.min != null && amount != null && (amount < option.min - 0.005 || (option.max != null && amount > option.max + 0.005) || (option.fixed != null && Math.abs(amount - option.fixed) > 0.005))) {
      return guardStop(`The figures changed since this was prepared (${usd(s.position.owedBack)} is owed back now). Nothing was sent; prepare a new response.`);
    }
  }

  const evidenceStep = async (refundIds: string[]): Promise<{ error: string; raw: string; status: number } | null> => {
    if (done.evidence) return null;
    const route = s.dispute.can.evidence;
    if (!route) return { error: "PayPal isn't taking evidence on this dispute right now.", raw: "PayPal isn't taking evidence on this dispute right now.", status: 409 };
    const built = await (deps.files ?? evidenceFiles)(resp.evidence, s.bits);
    const input = evidenceInput(route, { note: resp.note, files: built.files.map((f) => f.name), refundIds });
    try {
      await (deps.evidence ?? sendDisputeEvidence)(r.dispute_id, { route, input, files: built.files, requestId: `${stem}-evidence` });
    } catch (e) {
      const message = e instanceof Error ? e.message.slice(0, 300) : "failed";
      return { error: failureWords(e, "evidence"), raw: message, status: e instanceof PayPalRefused ? 422 : 502 };
    }
    progress.evidence = { at: new Date().toISOString(), route, files: built.files.map((f) => f.name), skipped: built.skipped };
    await audit(tenancyId, "agent", "dispute_evidence_sent", { dispute_id: r.dispute_id, response_id: r.id, files: built.files.length, skipped: built.skipped.length, route });
    return null;
  };

  try {
    if (r.action === "provide_evidence") {
      // Proof of every refund of this payment on record: the close-out's, a settlement's, and one made in PayPal that
      // the landlord recorded as the deposit's refund.
      const refundIds = s.bits.payments.filter((p) => (p.kind === "refund" || p.kind === "settlement_refund" || p.kind === "outside_refund") && !returnFailed(p.status) && p.paypal_id).map((p) => p.paypal_id!);
      const ev = await evidenceStep(refundIds);
      if (ev) {
        const refused = ev.status === 422 && !recheck;
        await finish(r.id, refused ? "refused" : "unknown", progress, ev.error);
        await audit(tenancyId, "agent", refused ? "dispute_response_refused" : "dispute_response_unconfirmed", { dispute_id: r.dispute_id, response_id: r.id, step: "evidence", error: ev.raw });
        return { ok: false, error: refused ? `PayPal didn't take the evidence: ${ev.error}` : "PayPal didn't confirm the evidence. Check with PayPal.", status: ev.status };
      }
    } else if (r.action === "accept_claim" && !done.accept) {
      // In full unless PayPal takes part of a claim on this dispute and the amount is less than the whole claim.
      const type = !s.dispute.can.accept?.includes("PARTIAL_REFUND") || amount == null || Math.abs(amount - s.position.claimed) < 0.005 ? "REFUND" : "PARTIAL_REFUND";
      try {
        await (deps.accept ?? acceptDisputeClaim)(r.dispute_id, { note: resp.note, type, amount: amount ?? undefined, requestId: `${stem}-accept` });
      } catch (e) {
        const message = e instanceof Error ? e.message.slice(0, 300) : "failed";
        const words = failureWords(e, "accept");
        const refused = e instanceof PayPalRefused && !recheck;
        await finish(r.id, refused ? "refused" : "unknown", progress, words);
        await audit(tenancyId, "agent", refused ? "dispute_response_refused" : "dispute_response_unconfirmed", { dispute_id: r.dispute_id, response_id: r.id, step: "accept", error: message });
        return { ok: false, error: refused ? `PayPal didn't accept that: ${words} Nothing moved.` : "PayPal didn't answer. Check with PayPal.", status: 502 };
      }
      progress.accept = { at: new Date().toISOString(), amount: amount ?? s.position.claimed, type };
      await step(r.id, { accept: progress.accept }, { kind: "dispute_refund", paypal_id: r.dispute_id, amount: progress.accept.amount, status: "PENDING",
        raw: { dispute_id: r.dispute_id, response_id: r.id, accept_claim_type: type, request_id: `${stem}-accept` } });
    } else if (r.action === "make_offer" && !done.offer) {
      if (amount == null) return blocked("The offer has no amount.");
      try {
        await (deps.offer ?? makeDisputeOffer)(r.dispute_id, { note: resp.note, amount, requestId: `${stem}-offer` });
      } catch (e) {
        const message = e instanceof Error ? e.message.slice(0, 300) : "failed";
        const words = failureWords(e, "offer");
        const refused = e instanceof PayPalRefused && !recheck;
        await finish(r.id, refused ? "refused" : "unknown", progress, words);
        await audit(tenancyId, "agent", refused ? "dispute_response_refused" : "dispute_response_unconfirmed", { dispute_id: r.dispute_id, response_id: r.id, step: "offer", error: message });
        return { ok: false, error: refused ? `PayPal didn't take the offer: ${words}` : "PayPal didn't answer. Check with PayPal.", status: 502 };
      }
      progress.offer = { at: new Date().toISOString(), amount };
    }
  } catch (e) {
    // Something of ours failed partway (the evidence files' build before the call, a record that couldn't be written
    // after it): unconfirmed, never sent afresh. The page gets our sentence for it; the raw text is in the log.
    console.error("dispute response send failed", e);
    await finish(r.id, "unknown", progress, failureWords(e, "partway"));
    return { ok: false, error: "Something failed partway. Check with PayPal before anything else.", status: 500 };
  }
  await finish(r.id, "sent", progress, null);
  await audit(tenancyId, "agent", "dispute_response_sent", { dispute_id: r.dispute_id, response_id: r.id, action: r.action, amount, rechecked: recheck || undefined });
  // What PayPal shows now, for the page (best effort).
  if (!deps.getDispute) await readLive(r.dispute_id).then((raw) => storeLive(raw, tenancyId, ws.id)).catch(() => {});
  return { ok: true, status: "sent" };
}

/* ---------- Evidence files ---------- */

/** A photo for PayPal: upright, at most 1600 pixels on its long side, the box drawn in red where it has one. */
async function evidencePhoto(p: CasePhoto): Promise<Uint8Array | null> {
  const { data, error } = await db.storage.from("photos").download(p.ref);
  if (error || !data) return null;
  // sharp loads here, with the photo it resizes. The caller skips a photo it can't read, so a failure to load the
  // library is logged on its way out rather than read as a photo that isn't there.
  const { default: sharp } = await import("sharp").catch((e) => { console.error("sharp failed to load", e); throw e; });
  // Checked again before decoding, for a file stored before the upload check refused its shape (src/lib/images.ts).
  const { imageType } = await import("./images");
  const bytes = new Uint8Array(await data.arrayBuffer());
  if (!(await imageType(bytes))) return null;
  const base = sharp(bytes, { limitInputPixels: MAX_PIXELS }).rotate().resize({ width: 1600, height: 1600, fit: "inside", withoutEnlargement: true });
  const { data: jpeg, info } = await base.jpeg({ quality: 82 }).toBuffer({ resolveWithObject: true });
  if (!p.box) return new Uint8Array(jpeg);
  const w = info.width, h = info.height, stroke = Math.max(3, Math.round(Math.max(w, h) / 220));
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${w}" height="${h}"><rect x="${Math.round(p.box.x * w)}" y="${Math.round(p.box.y * h)}" width="${Math.max(4, Math.round(p.box.w * w))}" height="${Math.max(4, Math.round(p.box.h * h))}" fill="none" stroke="#D64540" stroke-width="${stroke}"/></svg>`;
  return new Uint8Array(await sharp(jpeg, { limitInputPixels: MAX_PIXELS }).composite([{ input: Buffer.from(svg), top: 0, left: 0 }]).jpeg({ quality: 82 }).toBuffer());
}

const sniff = (b: Uint8Array): "pdf" | "jpg" | "png" | null =>
  b[0] === 0x25 && b[1] === 0x50 && b[2] === 0x44 && b[3] === 0x46 ? "pdf" : b[0] === 0xff && b[1] === 0xd8 ? "jpg" : b[0] === 0x89 && b[1] === 0x50 ? "png" : null;
const TYPE = { pdf: "application/pdf", jpg: "image/jpeg", png: "image/png" } as const;

/** The files for the chosen evidence keys, in order, inside PayPal's limits (10 MB each, 50 MB in all): the
 *  statement's PDF packet, each line's photo pair with the box drawn, its receipt, its after photo. */
export async function evidenceFiles(keys: string[], c: CaseBits): Promise<{ files: EvidenceFile[]; skipped: string[] }> {
  const files: EvidenceFile[] = [];
  const skipped: string[] = [];
  let total = 0;
  const add = (f: EvidenceFile | null, key: string) => {
    if (!f || f.data.length > MAX_EVIDENCE_FILE_BYTES || total + f.data.length > MAX_EVIDENCE_BYTES) { skipped.push(key); return; }
    total += f.data.length;
    files.push(f);
  };
  for (const key of keys) {
    if (key === "statement") {
      const st = await buildStatement(c.tenancyId).catch(() => null);
      // pdf-lib loads here, with the packet it writes. A packet that can't be built is skipped below, so a failure
      // to load the writer is logged first rather than read as a statement that has no packet. It is built in the same
      // slot as the PDF routes' (two at a time), and skipped when that is full.
      const pdf = st ? await import("./statement-pdf")
        .catch((e) => { console.error("the PDF writer failed to load", e); throw e; })
        .then((m) => m.packetSlot(() => m.buildStatementPdf(st))).catch(() => null) : null;
      add(pdf ? { name: evidenceName("itemized-statement", "pdf"), type: TYPE.pdf, data: pdf.bytes } : null, key);
      continue;
    }
    if (key === "lease") {
      const { data } = c.leasePath ? await db.storage.from("leases").download(c.leasePath) : { data: null };
      const bytes = data ? new Uint8Array(await data.arrayBuffer()) : null;
      add(bytes && sniff(bytes) === "pdf" ? { name: evidenceName("signed-lease", "pdf"), type: TYPE.pdf, data: bytes } : null, key);
      continue;
    }
    const m = /^line-(\d+)-(photos|receipt|after)$/.exec(key);
    const line = m ? c.lines.find((l) => l.n === Number(m[1])) : null;
    if (!m || !line) { skipped.push(key); continue; }
    if (m[2] === "photos") {
      for (const [p, which] of [[line.photos.moveIn, "move-in"], [line.photos.moveOut, "move-out"]] as const) {
        const data = p ? await evidencePhoto(p).catch(() => null) : null;
        add(data ? { name: evidenceName(`line-${line.n}-${which}`, "jpg"), type: TYPE.jpg, data } : null, key);
      }
    } else if (m[2] === "after") {
      const data = line.photos.after ? await evidencePhoto(line.photos.after).catch(() => null) : null;
      add(data ? { name: evidenceName(`line-${line.n}-after`, "jpg"), type: TYPE.jpg, data } : null, key);
    } else {
      const d = c.deductions.find((x) => c.facts.ranges.lines.find((r) => r.n === line.n)?.id === x.id);
      const { data } = d?.receipt_path ? await db.storage.from("receipts").download(d.receipt_path) : { data: null };
      const bytes = data ? new Uint8Array(await data.arrayBuffer()) : null;
      const kind = bytes ? sniff(bytes) : null;
      add(bytes && kind ? { name: evidenceName(`line-${line.n}-receipt`, kind), type: TYPE[kind], data: bytes } : null, key);
    }
  }
  return { files, skipped };
}

/* ---------- What the pages show ---------- */

export type ResponseView = {
  id: string; status: ResponseRow["status"]; action: DefenseAction | null; actionLabel: string | null; amount: number | null;
  note: string | null; summary: string | null; evidence: { key: string; label: string }[]; citations: string[]; adjustments: string[];
  hash: string | null; error: string | null; preparedAt: string; approvedAt: string | null; sentAt: string | null;
  evidenceSent: boolean; position: Position | null;
  filesSent: number | null; // how many files went to PayPal with the evidence, once it went
  filesLeftOut: string[]; // evidence PayPal's limits (10 MB a file, 50 MB in all) or a missing file kept out, by label
};

/** The state's deadline for the statement and refund, which PayPal's hold doesn't pause. */
export type StateDeadline = { date: string; title: string; cite: string | null; text: string; delivered: boolean };

export type PayPalDisputeView = {
  id: string; reason: string; reasonCode: string | null; status: string; statusCode: string | null; open: boolean; stage: string | null;
  amount: number; dueDate: string | null; openedAt: string | null; buyerWords: string[]; outcome: string | null; refunded: number | null;
  reportedAt: string | null; // when PayPal's webhook or a check last told the app about it
  position: Position; options: { action: DefenseAction; label: string; amount: string | null }[]; none: string | null; block: string | null;
  evidenceWithheld: string | null; // why evidence alone isn't among the options, in the record's words
  stateDue: StateDeadline | null;
  response: ResponseView | null; running: boolean;
};

/** A tenancy's PayPal dispute as its Payments tab shows it: PayPal's word, the rules' position, the responses left and
 *  the prepared response. From the database alone (the options are the page's estimate; preparing and sending read
 *  PayPal live). */
export async function loadPayPalDispute(tenancyId: string, ws: Workspace): Promise<PayPalDisputeView | null> {
  const stored = await currentDispute(tenancyId);
  if (!stored) return null;
  const s = await setup(tenancyId, ws, stored, {}, { live: false });
  if ("error" in s) return null;
  const r = await latestResponse(stored.id, tenancyId, { retired: true });
  const d = s.dispute;
  const label = (key: string) => s.bits.catalog.find((c) => c.key === key)?.label ?? key;
  const running = r?.status === "preparing" && Date.parse(r.started_at) > Date.now() - DEFENSE_STALE_SECONDS * 1000;
  const resp = r?.response ?? null;
  // What PayPal returned through this dispute, as recorded (never a refund made before it opened).
  const recorded = cents(s.bits.payments.filter((p) => p.kind === "dispute_refund" && p.paypal_id === d.id && !returnFailed(p.status)).reduce((t, p) => t + Number(p.amount), 0));
  const f = s.bits.facts;
  const status = r ? (r.status === "preparing" && !running ? "failed" : shownStatus(r)) : null;
  const files = r?.progress?.evidence;
  return {
    id: d.id, reason: reasonWords(d.reason), reasonCode: d.reason, status: statusWords(d.status), statusCode: d.status, open: d.open, stage: d.stage,
    // PayPal's date for the response, as a day where the property is (its pack's zone), as every date here is.
    amount: d.amount, dueDate: d.dueDate ? dateIn(d.dueDate, f.pack.timeZone.id) : null, openedAt: d.createdAt, buyerWords: d.buyerWords,
    outcome: d.outcome?.code ? outcomeWords(d.outcome.code) : null, refunded: recorded > 0 ? recorded : d.outcome?.refunded ?? null,
    reportedAt: stored.checked_at && (!stored.updated_at || stored.checked_at > stored.updated_at) ? stored.checked_at : stored.updated_at,
    position: s.position,
    options: s.options.map((o) => ({ action: o.action, label: ACTION_LABEL[o.action], amount: o.fixed != null ? usd(o.fixed) : o.min != null ? `${usd(o.min)} to ${usd(o.max ?? o.min)}` : null })),
    none: s.none, block: s.block,
    evidenceWithheld: evidenceWithheld(s.position, d, s.options),
    stateDue: f.statementDue ? { date: f.statementDue, title: f.pack.deadline.tip.title, cite: f.pack.deadline.tip.cite ?? null, text: f.pack.deadline.tip.text, delivered: !!f.deliveredAt } : null,
    response: r && status ? {
      id: r.id, status, action: r.action, actionLabel: r.action ? ACTION_LABEL[r.action] ?? null : null,
      amount: r.amount == null ? null : Number(r.amount), note: resp?.note ?? null, summary: resp?.summary ?? null,
      evidence: (resp?.evidence ?? []).map((k) => ({ key: k, label: label(k) })), citations: resp?.citations ?? [], adjustments: resp?.adjustments ?? [],
      hash: r.response_hash,
      error: r.error ?? (r.status === "preparing" && !running ? "The run stopped before it finished." : status === "unknown" && r.status === "sending" ? "The send stopped before PayPal's answer was recorded." : null),
      preparedAt: r.created_at, approvedAt: r.approved_at, sentAt: r.sent_at,
      evidenceSent: !!files,
      position: resp?.position ?? null,
      filesSent: files ? files.files.length : null,
      filesLeftOut: [...new Set(files?.skipped ?? [])].map(label),
    } : null,
    running,
  };
}

export type PayPalDisputeAlert = { tenancyId: string; title: string; sub: string; due: string | null; href: string; tone: "red" | "amber" };

/** The bell's entries for open PayPal disputes in a workspace: one to answer, a response to approve, one to check. */
async function loadPaypalDisputeAlerts(workspaceId: string): Promise<PayPalDisputeAlert[]> {
  const { data } = await db.from("paypal_disputes").select("id, tenancy_id, status, seller_response_due:raw->>seller_response_due_date, tenancies!inner(workspace_id, properties(address, state))")
    .eq("tenancies.workspace_id", workspaceId).neq("status", "RESOLVED").limit(10);
  const rows = (data ?? []) as unknown as { id: string; tenancy_id: string; status: string | null; seller_response_due: string | null; tenancies: { properties: { address: string; state?: string | null } | null } | null }[];
  if (!rows.length) return [];
  const { data: rs } = await db.from("paypal_dispute_responses").select("dispute_id, status, created_at, updated_at").in("dispute_id", rows.map((r) => r.id)).neq("status", "superseded").order("created_at", { ascending: false });
  const out: PayPalDisputeAlert[] = [];
  for (const r of rows) {
    const found = ((rs ?? []) as { dispute_id: string; status: ResponseRow["status"]; updated_at: string }[]).find((x) => x.dispute_id === r.id);
    const latest = found ? shownStatus(found) : null;
    const sub = r.tenancies?.properties?.address ?? "A property";
    const href = `/tenancy/${r.tenancy_id}?tab=payments#paypal-dispute`;
    const due = r.seller_response_due ? dateIn(r.seller_response_due, zoneOf(r.tenancies?.properties?.state)) : null;
    if (latest === "ready") out.push({ tenancyId: r.tenancy_id, title: "Approve the PayPal dispute response", sub, due, href, tone: "red" });
    else if (latest === "unknown") out.push({ tenancyId: r.tenancy_id, title: "Check the PayPal dispute response", sub, due: null, href, tone: "amber" });
    else if (latest !== "sent" && latest !== "sending" && latest !== "preparing" && r.status !== "UNDER_REVIEW" && r.status !== "WAITING_FOR_BUYER_RESPONSE") {
      out.push({ tenancyId: r.tenancy_id, title: "Answer the PayPal dispute", sub, due, href, tone: "red" });
    }
  }
  return out;
}
/** paypalDisputeAlerts for the workspace, read once per request: the app shell's bell and the Properties page share it. */
export const paypalDisputeAlerts = cache(loadPaypalDisputeAlerts);

/** The banner every tab of a property shows while its PayPal dispute is open: the claim, PayPal's date and where the
 *  response stands. Two small reads. */
export async function disputeBanner(tenancyId: string): Promise<{ id: string; amount: number; dueDate: string | null; response: string | null } | null> {
  const { data } = await db.from("paypal_disputes").select("id, amount, status, raw, tenancies(properties(state))").eq("tenancy_id", tenancyId).neq("status", "RESOLVED")
    .order("paypal_created_at", { ascending: false, nullsFirst: false }).limit(1).maybeSingle();
  if (!data) return null;
  const zone = zoneOf((data.tenancies as { properties?: { state?: string | null } | null } | null)?.properties?.state);
  const d = readDispute(data.raw);
  if (!d.open) return null;
  const r = await latestResponse(d.id, tenancyId);
  const response = !r ? null : r.status === "preparing" && Date.parse(r.started_at) <= Date.now() - DEFENSE_STALE_SECONDS * 1000 ? "failed" : shownStatus(r);
  return { id: d.id, amount: d.amount || Number(data.amount ?? 0), dueDate: d.dueDate ? dateIn(d.dueDate, zone) : null, response };
}

/** The state's deadline for the statement and refund, in a sentence that says PayPal's hold doesn't pause it; null
 *  before the move-out (no clock runs yet). */
export async function deadlineLine(tenancyId: string): Promise<string | null> {
  const unit = await loadUnit(tenancyId);
  const due = unit ? dueOf(unit) : null;
  if (!unit || !due) return null;
  const cite = packOf(unit).deadline.tip.cite;
  return `The state's deadline for the statement and refund is ${shortDate(due)}${cite ? ` (${cite})` : ""}, and PayPal's hold doesn't pause it.`;
}

/** Why the close-out and its approval stop before any Claude call: the tenants' PayPal dispute of the deposit payment
 *  is open (closeOutState holds the refund too; this saves the agent's run). Null when none is open. */
export async function openDisputeBlock(tenancyId: string): Promise<string | null> {
  const { data } = await db.from("paypal_disputes").select("id, amount").eq("tenancy_id", tenancyId).neq("status", "RESOLVED").limit(1).maybeSingle();
  if (!data) return null;
  const deadline = await deadlineLine(tenancyId).catch(() => null);
  return `The tenants opened a PayPal dispute of the deposit payment (${data.id}, ${usd(Number(data.amount ?? 0))}). Answer it on the Payments tab first: money sent here meanwhile could go back twice.${deadline ? ` ${deadline}` : ""}`;
}

// PayPal disputes and chargebacks of the deposit payment: what PayPal's dispute says, what the landlord may still keep
// by the rules, which responses that leaves, and the checks a prepared response passes before the landlord sees it.
// Pure: the defense agent (chargeback-agent.ts) proposes, this decides what is possible, and the store
// (chargeback-store.ts) reads the database and PayPal and moves nothing until the landlord approves.
//
// The rule that bounds the agent: it may never argue for keeping anything outside the lawful range. Code computes what
// the landlord may keep of the deposit it still holds (lawfulKeep: the lawful ranges' ceilings once the tenants moved
// out, the whole deposit as security while the tenancy runs, less any settlement agreed) and so what is owed back now
// (owedBack). Then:
// - evidence alone (keep everything the tenants claim) only when nothing is owed back, as after the statement's
//   refund went out before the dispute;
// - otherwise the response gives back at least what is owed, through the dispute itself: accept the claim (in full, or
//   in part where PayPal allows that, never below what is owed), or offer a refund of at least that (where PayPal
//   allows offers). The owed part can't go back as a separate refund first: PayPal refuses a partial refund of a
//   payment while a case is open on it (tried in the sandbox on 2026-10-05: "Partial refunds cannot be offered at this
//   time because there is an open case on this transaction");
// - and only the responses PayPal itself offers on this dispute (its links and allowed_response_options).
// Not legal advice: it informs, computes and drafts, and the landlord approves the exact response.

import { createHash } from "node:crypto";
import { beyondInforming, cleanText, strayCitation } from "./agent-words";
import { usd } from "./deductions";

const cents = (n: number) => Math.round(n * 100) / 100;
type Obj = Record<string, unknown>;
const obj = (v: unknown): Obj => (v && typeof v === "object" && !Array.isArray(v) ? (v as Obj) : {});
const list = (v: unknown): unknown[] => (Array.isArray(v) ? v : []);
const str = (v: unknown): string | null => (typeof v === "string" && v.trim() ? v.trim() : null);
const money = (v: unknown): number | null => { const n = Number(obj(v).value); return Number.isFinite(n) ? cents(n) : null; };

/* ---------- PayPal's dispute ---------- */

export const DEFENSE_ACTIONS = ["provide_evidence", "accept_claim", "make_offer"] as const;
export type DefenseAction = (typeof DEFENSE_ACTIONS)[number];

/** PayPal's reasons in the landlord's words. */
export const REASON_WORDS: Record<string, string> = {
  CREDIT_NOT_PROCESSED: "Refund not received",
  MERCHANDISE_OR_SERVICE_NOT_RECEIVED: "Not received",
  MERCHANDISE_OR_SERVICE_NOT_AS_DESCRIBED: "Not as described",
  UNAUTHORISED: "Payment not authorized",
  DUPLICATE_TRANSACTION: "Paid twice",
  INCORRECT_AMOUNT: "Wrong amount",
  PAYMENT_BY_OTHER_MEANS: "Paid another way",
  CANCELED_RECURRING_BILLING: "Canceled recurring billing",
  PROBLEM_WITH_REMITTANCE: "Problem with the payment",
  OTHER: "Other",
};
export const STATUS_WORDS: Record<string, string> = {
  OPEN: "Open",
  WAITING_FOR_SELLER_RESPONSE: "Waiting on you",
  WAITING_FOR_BUYER_RESPONSE: "Waiting on the tenants",
  UNDER_REVIEW: "PayPal reviewing",
  RESOLVED: "Resolved",
  OTHER: "Open",
};
/** PayPal's outcomes in the landlord's words (PayPal spells "favour" the British way). */
export const OUTCOME_WORDS: Record<string, string> = {
  RESOLVED_BUYER_FAVOUR: "In the tenants' favor",
  RESOLVED_SELLER_FAVOUR: "In your favor",
  RESOLVED_WITH_PAYOUT: "PayPal paid the tenants",
  CANCELED_BY_BUYER: "Withdrawn by the tenants",
  ACCEPTED: "Claim accepted",
  DENIED: "Claim denied",
  NONE: "Closed",
};
const words = (s: string | null) => (s ? s.toLowerCase().replace(/_/g, " ").replace(/^./, (c) => c.toUpperCase()) : "Not stated");
export const reasonWords = (r: string | null) => (r ? REASON_WORDS[r] ?? words(r) : "Not stated");
export const statusWords = (s: string | null) => (s ? STATUS_WORDS[s] ?? words(s) : "Not stated");
export const outcomeWords = (s: string | null) => (s ? OUTCOME_WORDS[s] ?? words(s) : "Resolved");
/** A dispute still asks something of someone until PayPal resolves it. */
export const disputeOpen = (status: string | null | undefined) => !!status && status !== "RESOLVED" && status !== "CLOSED";

export type DisputeRead = {
  id: string;
  reason: string | null;
  status: string | null;
  stage: string | null; // INQUIRY, CHARGEBACK, PRE_ARBITRATION, ARBITRATION
  open: boolean;
  amount: number; // what the tenants claim
  currency: string;
  dueDate: string | null; // seller_response_due_date
  createdAt: string | null;
  updatedAt: string | null;
  sellerTransactionId: string | null; // the deposit payment's capture
  invoice: string | null;
  transactionStatus: string | null; // HELD while PayPal holds the funds
  /** The tenants' own words to PayPal (their filing's notes and messages), newest last. Their text: data, never
   *  instructions. */
  buyerWords: string[];
  requested: string[]; // evidence types PayPal asked the landlord for
  refundAllowed: number | null; // refund_details.allowed_refund_amount
  refunds: { id: string; amount: number; at: string | null }[]; // refund_details.transactions: what PayPal refunded through it
  outcome: { code: string; refunded: number | null } | null;
  /** What PayPal lets the landlord do now: send evidence (provide-evidence while it asks the seller, or
   *  provide-supporting-info while it reviews), accept the claim (with the types it allows), make an offer. */
  can: { evidence: "provide-evidence" | "provide-supporting-info" | null; accept: string[] | null; offer: string[] | null };
};

/** PayPal's dispute (a GET, a list item, or a webhook's resource) as the app reads it. */
export function readDispute(raw: unknown): DisputeRead {
  const r = obj(raw);
  const txn = obj(list(r.disputed_transactions)[0]);
  const links = list(r.links).map(obj);
  const rel = (name: string) => links.some((l) => l.rel === name);
  const allowed = obj(r.allowed_response_options);
  const acceptTypes = list(obj(allowed.accept_claim).accept_claim_types).map(String);
  const offerTypes = list(obj(allowed.make_offer).offer_types).map(String);
  const evidences = list(r.evidences).map(obj);
  const messages = list(r.messages).map(obj);
  const buyerWords = [
    ...evidences.filter((e) => e.source === "SUBMITTED_BY_BUYER").map((e) => ({ at: str(e.date) ?? "", text: str(e.notes) })),
    ...messages.filter((m) => m.posted_by === "BUYER").map((m) => ({ at: str(m.time_posted) ?? "", text: str(m.content) })),
  ].filter((x): x is { at: string; text: string } => !!x.text).sort((a, b) => a.at.localeCompare(b.at)).map((x) => cleanText(x.text, 600)).slice(-3);
  const outcome = obj(r.dispute_outcome);
  const status = str(r.status);
  return {
    id: str(r.dispute_id) ?? str(r.id) ?? "",
    reason: str(r.reason), status, stage: str(r.dispute_life_cycle_stage), open: disputeOpen(status),
    amount: money(r.dispute_amount) ?? 0, currency: str(obj(r.dispute_amount).currency_code) ?? "USD",
    dueDate: str(r.seller_response_due_date), createdAt: str(r.create_time), updatedAt: str(r.update_time),
    sellerTransactionId: str(txn.seller_transaction_id), invoice: str(txn.invoice_number), transactionStatus: str(txn.transaction_status),
    buyerWords,
    requested: [...new Set(evidences.filter((e) => e.source === "REQUESTED_FROM_SELLER").map((e) => String(e.evidence_type ?? "")).filter(Boolean))],
    refundAllowed: money(obj(r.refund_details).allowed_refund_amount),
    refunds: list(obj(r.refund_details).transactions).map(obj).filter((t) => str(t.id)).map((t) => ({ id: str(t.id)!, amount: money(t.gross_amount) ?? 0, at: str(t.create_time) })),
    outcome: str(outcome.outcome_code) ? { code: str(outcome.outcome_code)!, refunded: money(outcome.amount_refunded) } : null,
    can: {
      evidence: rel("provide_evidence") ? "provide-evidence" : rel("provide_supporting_info") ? "provide-supporting-info" : null,
      accept: rel("accept_claim") ? (acceptTypes.length ? acceptTypes : ["REFUND"]) : null,
      offer: rel("make_offer") ? (offerTypes.length ? offerTypes : ["REFUND"]) : null,
    },
  };
}

/* ---------- What the landlord may keep ---------- */

export type PositionInput = {
  depositHeld: number; // collected through PayPal (0 when it wasn't paid)
  returned: number; // every refund, Payout, settlement and dispute refund that didn't fail
  movedOut: boolean; // a move-out date is on file
  /** No move-out date is on file, but the tenancy has ended by another date on file (the lease end, the planned
   *  move-out, or the one the tenants gave through their link, now past). What may be kept is then counted as after a
   *  move-out, and evidence alone (keep everything claimed) waits until the move-out date is recorded. */
  ended?: boolean;
  /** The most the lawful ranges let the landlord keep across the deductions on file (lawful-range.ts, totals.maxKeep);
   *  null or 0 with none on file. */
  maxKeep: number | null;
  agreedBack?: number | null; // a settlement both sides agreed that hasn't been paid yet: what it gives back
  claimed: number; // the dispute's amount
};

export type Position = {
  /** tenancy: running, the whole deposit held as security; moved_out: a move-out date is on file; ended: no move-out
   *  date on file, but the lease end or a planned move-out has passed. */
  phase: "tenancy" | "moved_out" | "ended";
  held: number; // what the landlord still holds of the deposit
  lawfulKeep: number; // the most of it the rules let the landlord keep
  owedBack: number; // what is owed back now: held less lawfulKeep
  claimed: number; // what the tenants claim through PayPal
  contested: number; // what a defense would keep of the claim: claimed less owedBack, never below 0
};

export function defensePosition(i: PositionInput): Position {
  const held = cents(Math.max(0, i.depositHeld - i.returned));
  let lawfulKeep = held;
  if (i.movedOut || i.ended) {
    lawfulKeep = Math.min(held, Math.max(0, i.maxKeep ?? 0));
    if (i.agreedBack && i.agreedBack > 0) lawfulKeep = Math.max(0, lawfulKeep - i.agreedBack);
  }
  lawfulKeep = cents(lawfulKeep);
  const owedBack = cents(Math.max(0, held - lawfulKeep));
  const claimed = cents(Math.max(0, i.claimed));
  const phase = i.movedOut ? "moved_out" : i.ended ? "ended" : "tenancy";
  return { phase, held, lawfulKeep, owedBack, claimed, contested: cents(Math.max(0, claimed - owedBack)) };
}

/** Whether the tenancy has ended by a date on file although no move-out date is recorded: the lease end, the planned
 *  move-out or the one the tenants gave through their link, on or before today. A running month-to-month tenancy with
 *  no notice has none of them. */
export const endedWithoutMoveOut = (o: { today: string; moveOutDate: string | null; endDate: string | null; plannedMoveOut: string | null; tenantPlanned: string | null }) =>
  !o.moveOutDate && [o.endDate, o.plannedMoveOut, o.tenantPlanned].some((d) => !!d && d.slice(0, 10) < o.today);

/* ---------- The responses left ---------- */

export type ActionOption = {
  action: DefenseAction;
  min: number | null; // the least money back it may send; null when it sends none
  max: number | null;
  fixed: number | null; // when the amount is set by code (the owed refund, a claim accepted in full)
};

/** The responses the rules and PayPal both allow, and why none is left when that happens. `block` is why this
 *  workspace can't answer at all (a demo copy's shared deposit, a live PayPal build). */
export function defenseOptions(p: Position, d: DisputeRead, o: { block?: string | null } = {}): { options: ActionOption[]; none: string | null } {
  if (o.block) return { options: [], none: o.block };
  if (!d.open) return { options: [], none: "PayPal has resolved this dispute." };
  const owed = p.owedBack;
  const options: ActionOption[] = [];
  // Evidence alone keeps everything claimed: only when nothing is owed back, and never while the record can't say
  // whether the tenancy is still running (it ended by a date on file, but no move-out date is recorded).
  if (d.can.evidence && owed <= 0.005 && p.phase !== "ended") options.push({ action: "provide_evidence", min: null, max: null, fixed: null });
  // Accepting in part only where PayPal offers it on this dispute, and never below what is owed; in full otherwise.
  if (d.can.accept?.includes("PARTIAL_REFUND") && p.claimed > 0) {
    options.push({ action: "accept_claim", min: cents(Math.min(Math.max(owed, 0.01), p.claimed)), max: p.claimed, fixed: null });
  } else if (d.can.accept?.includes("REFUND") && p.claimed > 0) options.push({ action: "accept_claim", min: p.claimed, max: p.claimed, fixed: p.claimed });
  if (d.can.offer?.includes("REFUND") && p.claimed > 0) options.push({ action: "make_offer", min: cents(Math.min(Math.max(owed, 0.01), p.claimed)), max: p.claimed, fixed: null });
  if (options.length) return { options, none: null };
  const none = !d.can.evidence && !d.can.accept && !d.can.offer
    ? "PayPal isn't taking a response from you on this dispute right now (it may be reviewing it). Check PayPal again later."
    : p.phase === "ended" && d.can.evidence
      ? `${RECORD_MOVE_OUT} PayPal takes only evidence on this dispute now, which would argue for keeping the deposit.`
      : owed > 0.005 && d.can.evidence
        ? `${usd(owed)} is owed back by the rules, and PayPal takes only evidence on this dispute now, which would argue for keeping it. PayPal also refuses a partial refund while the case is open. Respond in PayPal, or check again later. PayPal's hold doesn't pause the state's deadline for the statement and refund.`
        : "None of the responses PayPal allows here stays inside the rules. Respond in PayPal.";
  return { options: [], none };
}

const RECORD_MOVE_OUT = "The lease end or the planned move-out has passed, but no move-out date is on file. Record the move-out date first (or the new lease end, if the tenancy goes on).";

/** Why evidence alone isn't among the responses, in the record's terms, when PayPal would take evidence or the rules
 *  are why it can't go: for the card, beside the agent's proposal. Null when it is offered or nothing is. */
export function evidenceWithheld(p: Position, d: DisputeRead, options: ActionOption[]): string | null {
  if (!options.length || options.some((o) => o.action === "provide_evidence")) return null;
  if (p.phase === "ended") return `Evidence alone isn't offered. ${RECORD_MOVE_OUT}`;
  if (p.owedBack > 0.005) {
    return `Evidence alone isn't offered: ${usd(p.owedBack)} is owed back by the rules, and PayPal refuses a partial refund while the case is open, so what is owed goes back through the dispute itself.`;
  }
  if (!d.can.evidence) return "Evidence alone isn't offered: PayPal isn't taking evidence on this dispute now.";
  return null;
}

/* ---------- Evidence ---------- */

/** One thing the landlord can send PayPal: the statement, a line's photo pair (the box drawn), its receipt, its
 *  after-repair photo. `files` says how many files it adds (PayPal takes at most 10, 10 MB each, 50 MB in all). */
export type EvidenceItem = { key: string; label: string; kind: "statement" | "lease" | "photos" | "receipt" | "after"; line: number | null; files: number };
export const MAX_EVIDENCE_FILES = 10;
export const MAX_EVIDENCE_FILE_BYTES = 10 * 1024 * 1024;
export const MAX_EVIDENCE_BYTES = 50 * 1024 * 1024;

/** The record that always goes: the itemized statement after a move-out, the signed lease while the tenancy runs. */
const always = (c: EvidenceItem) => c.kind === "statement" || c.kind === "lease";

/** The keys to send, in order: the statement (or, while the tenancy runs, the lease) first whenever there is one, then
 *  what was asked for, each once, while the files fit PayPal's count. */
export function pickEvidence(asked: unknown, catalog: EvidenceItem[]): { keys: string[]; dropped: string[] } {
  const want = [...new Set(list(asked).map(String))];
  const dropped = want.filter((k) => !catalog.some((c) => c.key === k));
  const order = [...catalog.filter(always), ...want.map((k) => catalog.find((c) => c.key === k && !always(c))).filter((c): c is EvidenceItem => !!c)];
  const keys: string[] = [];
  let files = 0;
  for (const c of order) {
    if (keys.includes(c.key)) continue;
    if (files + c.files > MAX_EVIDENCE_FILES) { dropped.push(c.key); continue; }
    keys.push(c.key);
    files += c.files;
  }
  return { keys, dropped };
}

/* ---------- The response ---------- */

export type RawDefense = { action: string; amount?: number | null; note?: string; summary?: string; evidence?: string[]; citations?: string[] };

export type DefenseResponse = {
  disputeId: string;
  action: DefenseAction;
  amount: number | null; // money back through PayPal; null for evidence alone
  note: string; // what PayPal reads (and, for an offer, the tenants)
  summary: string; // for the landlord
  evidence: string[]; // catalog keys
  citations: string[];
  adjustments: string[]; // what the code changed in the agent's answer
  position: Position;
  options: ActionOption[];
  model: string;
  steps: number;
  at: string;
};

export type DefenseContext = {
  dispute: DisputeRead;
  position: Position;
  options: ActionOption[];
  catalog: EvidenceItem[];
  citations: string[]; // the only citations it may use: the pack's
  figures: number[]; // every amount the note may name: the deposit, each charge and its ceiling, the refunds, the totals
  fallbackNote: (action: DefenseAction, amount: number | null) => string; // the code's own explanation, always true
};

export const ACTION_LABEL: Record<DefenseAction, string> = {
  provide_evidence: "Send evidence",
  accept_claim: "Accept the claim",
  make_offer: "Offer a refund",
};

/** Where the defense failed: the preparation (Claude and our records), one of the three PayPal calls, or something
 *  of ours partway through a send (the evidence files' build before the call, the record after it). */
export type FailureStep = "prepare" | "evidence" | "accept" | "offer" | "partway";

const FAILURE_WORDS: Record<FailureStep, string> = {
  prepare: "Something on our side failed while the response was being prepared.",
  evidence: "PayPal didn't answer the evidence request.",
  accept: "PayPal didn't answer the acceptance.",
  offer: "PayPal didn't answer the offer.",
  partway: "Something on our side failed partway.",
};

const oneSentence = (s: string) => {
  const t = s.replace(/[\u0000-\u001f\u007f]+/g, " ").replace(/\s+/g, " ").trim().slice(0, 160).trim();
  return /[.!?]$/.test(t) ? t : `${t}.`;
};

/** PayPal's own words from a refusal: its answer's JSON (each detail's description, else its issue; else the
 *  message, else the name), the plain sentence a refusal of ours carries when there was no answer body ("Not a PayPal
 *  dispute id"), else the status alone (a paypal() message with no body is the call's path, not words). Never the JSON
 *  itself. */
export function paypalSaid(status: number, body: string, message = ""): string {
  const fallback = `PayPal answered ${status || "nothing"}.`;
  const trimmed = body.trim();
  if (!trimmed) return /[{}<>]/.test(message) || /^PayPal (GET|POST|PATCH|PUT|DELETE) /.test(message) || !message.trim() ? fallback : oneSentence(message);
  try {
    const j = JSON.parse(trimmed) as { details?: { description?: unknown; issue?: unknown }[]; message?: unknown; name?: unknown };
    const text = (v: unknown) => (typeof v === "string" ? v.trim() : "");
    const descriptions = (Array.isArray(j.details) ? j.details : []).map((d) => text(d?.description) || text(d?.issue)).filter(Boolean);
    const said = descriptions.length ? [...new Set(descriptions)].join(" ") : typeof j.message === "string" && j.message.trim() ? j.message : typeof j.name === "string" ? j.name : "";
    return said ? oneSentence(said) : fallback;
  } catch {
    return fallback;
  }
}

/** PayPalRefused's shape (paypal.ts): an Error carrying PayPal's status and its answer's body. */
function refusal(e: unknown): { status: number; body: string; message: string } | null {
  if (!(e instanceof Error)) return null;
  const { status, body } = e as Error & { status?: unknown; body?: unknown };
  return typeof status === "number" && typeof body === "string" ? { status, body, message: e.message } : null;
}

/** What the PayPal dispute card says about a failure, in words a landlord can read: PayPal's own words when PayPal
 *  refused (paypalSaid), a sentence of ours for everything else (an AI SDK's, Anthropic's or Postgres's message, a
 *  fetch that failed), by the step that failed; `claude` says Claude never answered. The raw text goes to the server's
 *  log, and to the audit log where the step writes one, never to the page. A refusal is known by its shape (PayPalRefused in paypal.ts carries
 *  PayPal's status and body), so this stays free of that module. */
export function failureWords(e: unknown, step: FailureStep, o: { claude?: boolean } = {}): string {
  const r = refusal(e);
  if (r) return paypalSaid(r.status, r.body, r.message);
  if (o.claude) return "Claude didn't answer, so nothing was prepared.";
  return FAILURE_WORDS[step];
}

/** The dollar figures a note names. */
export const figuresIn = (s: string) => [...s.matchAll(/\$\s?(\d{1,3}(?:,\d{3})+|\d+)(?:\.(\d{1,2}))?/g)].map((m) => cents(Number(`${m[1].replace(/,/g, "")}.${m[2] ?? "0"}`)));

const NOTE_MAX = 2000;

/** The agent's proposed response made lawful: an action the rules and PayPal both allow (else the first that is), its
 *  amount inside that action's bounds, evidence from the catalog with the statement first, citations from the pack,
 *  and a note with no figure the record doesn't hold and no wording past informing (else the code's own note). Every
 *  change is listed in `adjustments`. Null when no response is possible at all. */
export function validateDefense(raw: RawDefense | null | undefined, ctx: DefenseContext, meta: { model: string; steps: number; at?: string }): DefenseResponse | null {
  if (!ctx.options.length) return null;
  const adjustments: string[] = [];
  let option = ctx.options.find((o) => o.action === raw?.action);
  const swapped = !option;
  if (!option) {
    if (raw?.action) adjustments.push(`"${String(raw.action).slice(0, 40)}" isn't a response the rules and PayPal allow here, so the first one that is was used.`);
    option = ctx.options[0];
  }
  let amount: number | null = null;
  const askedAmount = raw?.amount == null ? NaN : Number(raw.amount);
  if (option.min != null) {
    amount = option.fixed ?? (Number.isFinite(askedAmount) ? cents(askedAmount) : option.min);
    if (option.fixed != null && Number.isFinite(askedAmount) && Math.abs(cents(askedAmount) - option.fixed) > 0.005) {
      adjustments.push(`The amount is set by the rules for this response: ${usd(option.fixed)}, not ${usd(cents(askedAmount))}.`);
    } else if (option.fixed == null && !Number.isFinite(askedAmount)) {
      adjustments.push(`No amount was proposed, so it is the least the rules allow: ${usd(option.min)}.`);
    }
    if (amount < option.min) { adjustments.push(`${usd(amount)} is less than the ${usd(option.min)} owed back by the rules; raised to ${usd(option.min)}.`); amount = option.min; }
    if (option.max != null && amount > option.max) { adjustments.push(`${usd(amount)} is more than the tenants claim; held to ${usd(option.max)}.`); amount = option.max; }
  }
  // What PayPal's reviewer reads must say what the response does. A response with money in it names its final amount
  // and never the different one the agent asked for (code may have set or moved it); a response code swapped for
  // another keeps none of the agent's words.
  const named = (s: string) => figuresIn(s).map((n) => n.toFixed(2));
  const states = (s: string) => amount == null || (named(s).includes(amount.toFixed(2))
    && !(Number.isFinite(askedAmount) && Math.abs(cents(askedAmount) - amount) > 0.005 && named(s).includes(cents(askedAmount).toFixed(2))));
  const allowedFigures = new Set([...ctx.figures, ...(amount != null ? [amount] : [])].map((n) => cents(n).toFixed(2)));
  const fallback = ctx.fallbackNote(option.action, amount);
  const allowed = new Set(ctx.citations);
  let note = cleanText(raw?.note, NOTE_MAX);
  const strayInNote = strayCitation(note, allowed);
  if (!note) { adjustments.push("No note was written, so the app's own explanation goes to PayPal."); note = fallback; }
  else if (swapped) { adjustments.push("The response changed, so the app's own explanation goes to PayPal."); note = fallback; }
  else if (beyondInforming(note)) { adjustments.push("The note went past informing, so the app's own explanation goes to PayPal."); note = fallback; }
  else if (strayInNote) { adjustments.push(`The note cites "${strayInNote}", which isn't one of the state's citations, so the app's own explanation goes to PayPal.`); note = fallback; }
  else {
    const strange = figuresIn(note).filter((n) => !allowedFigures.has(n.toFixed(2)));
    if (strange.length) { adjustments.push(`The note named ${strange.map(usd).join(", ")}, which the record doesn't hold, so the app's own explanation goes to PayPal.`); note = fallback; }
    else if (!states(note)) { adjustments.push(`The note didn't name the response's amount, ${usd(amount ?? 0)}, so the app's own explanation goes to PayPal.`); note = fallback; }
  }
  let summary = cleanText(raw?.summary, 450);
  if (!summary || swapped || beyondInforming(summary) || strayCitation(summary, allowed) || !states(summary)) summary = defaultSummary(option.action, amount, ctx.position);
  let evidence: string[] = [];
  if (option.action === "provide_evidence") {
    const picked = pickEvidence(raw?.evidence, ctx.catalog);
    evidence = picked.keys;
    if (picked.dropped.length) adjustments.push(`Left out ${picked.dropped.length} evidence item${picked.dropped.length === 1 ? "" : "s"} the app doesn't have or PayPal's 10-file limit can't take.`);
  }
  const asked = list(raw?.citations).map((c) => cleanText(c, 160)).filter(Boolean);
  const citations = asked.filter((c) => allowed.has(c));
  if (asked.length > citations.length) adjustments.push(`Dropped ${asked.length - citations.length} citation${asked.length - citations.length === 1 ? "" : "s"} not in the state's rules.`);
  return {
    disputeId: ctx.dispute.id, action: option.action, amount, note, summary, evidence, citations: [...new Set(citations)], adjustments,
    position: ctx.position, options: ctx.options, model: meta.model, steps: meta.steps, at: meta.at ?? new Date().toISOString(),
  };
}

function defaultSummary(a: DefenseAction, amount: number | null, p: Position): string {
  switch (a) {
    case "provide_evidence": return `Nothing more is owed back by the rules, so show PayPal the itemized statement and its records for the ${usd(p.claimed)} claimed. PayPal holds that money until it decides.`;
    case "accept_claim": {
      const more = amount != null ? cents(amount - p.owedBack) : 0;
      return `Accept the tenants' claim: PayPal returns ${usd(amount ?? p.claimed)} to them and closes the dispute, which ends its hold now.${more > 0.005 ? ` That is ${usd(more)} more than the rules require back.` : ""}`;
    }
    case "make_offer": return `Offer the tenants ${usd(amount ?? 0)} back through PayPal; nothing moves unless they accept.`;
  }
}

/** The exact response a hash stands for: what the landlord sees and approves, so a response changed after the page
 *  was loaded can't be approved with the old click. */
export function responseHash(r: Pick<DefenseResponse, "disputeId" | "action" | "amount" | "note" | "evidence" | "position">): string {
  const body = JSON.stringify([r.disputeId, r.action, r.amount, r.note, r.evidence, r.position.held, r.position.lawfulKeep, r.position.owedBack, r.position.claimed]);
  return createHash("sha256").update(body).digest("hex").slice(0, 24);
}

/** The JSON part of PayPal's evidence call: one evidence, carrying the landlord's explanation and every file. PayPal
 *  refuses two or more evidences on a dispute whose items carry no item id (tried in the sandbox on 2026-10-05: a
 *  PROOF_OF_REFUND and an OTHER together came back 400, ITEM_ID_IS_MANDATORY_FOR_MULTIPLE_EVIDENCES), so when a refund
 *  of this payment went before the dispute, the one evidence is the proof of that refund (its ids, which PayPal can
 *  check against the payment) with the note and the files; otherwise it is OTHER. For provide-supporting-info,
 *  PayPal's simpler shape. */
export function evidenceInput(route: "provide-evidence" | "provide-supporting-info", o: { note: string; files: string[]; refundIds: string[] }) {
  if (route === "provide-supporting-info") return { notes: o.note };
  const documents = o.files.length ? { documents: o.files.map((name) => ({ name })) } : {};
  return {
    evidences: [o.refundIds.length
      ? { evidence_type: "PROOF_OF_REFUND", evidence_info: { refund_ids: o.refundIds }, notes: o.note, ...documents }
      : { evidence_type: "OTHER", notes: o.note, ...documents }],
  };
}

/** A file name PayPal will take: letters, digits, dots, dashes; one of its types. */
export const evidenceName = (base: string, ext: "pdf" | "jpg" | "png") => `${base.toLowerCase().replace(/[^a-z0-9.-]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 60) || "file"}.${ext}`;

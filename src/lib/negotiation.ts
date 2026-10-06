import "server-only";
import { cache } from "react";
import type { LanguageModel } from "ai";
import { allowedCitations } from "./advocate";
import { isDemoExample } from "./copy";
import { audit, db } from "./db";
import { caseFile, disputeFacts, sentDispute, wholeDepositFirst, type DisputeFacts, type DisputeRow, type DisputeStatus } from "./disputes";
import { claudeNeverAnswered, type Allowance } from "./limits";
import {
  agentTurns, agreed, cleanPolicy, effectiveLimit, keepsOf, latestOf, MAX_AGENT_TURNS, MAX_TURNS, offerTurn, runNegotiation,
  statementKeeps, type NegotiationPolicy, type Side, type StopReason, type Turn, type TurnLine, type TurnMove,
} from "./negotiator";
import { checkProposal } from "./lawful-range";
import { tenancyDepositBlock } from "./demo-pool";
import { settledExtra } from "./refund-rail";
import type { StatePack } from "./states/types";

// The negotiation over a sent dispute, with the database: the turns as stored, the landlord's negotiator run (claimed
// once, counted against the advocate's daily allowance, each turn stored as it is made so both pages show it at once),
// the humans' own offers, the tenants' acceptance, and what each side's page shows. The agents, the checks and the
// loop are in negotiator.ts; the money in settlement.ts.

/** A run that started this long ago and never finished may be started again. */
export const NEGOTIATION_STALE_SECONDS = 300;
/** How long a settlement payment PayPal never confirmed may be checked by sending the same request again (settlement.ts):
 *  inside both PayPal's 45 days for a refund's PayPal-Request-Id and its 30 days for a Payout's batch id. The database
 *  holds the same figures (claim_settlement, supabase/migrations/20261004010359_settlement_review_fixes.sql). */
export const RECHECK_DAYS = 28;
/** A payment still marked as sending this long after its claim lost its process (a restart mid-call): checked like one
 *  PayPal never answered. */
export const STALE_SENDING_MINUTES = 10;

export type NegotiationRow = DisputeRow & {
  negotiator_policy: NegotiationPolicy | null;
  negotiation_status: "running" | "done" | "failed" | null;
  negotiation_started_at: string | null;
  negotiation_error: string | null;
  negotiation_outcome: StoredOutcome | null;
};

export type StoredOutcome = { reason: StopReason | "failed"; landlord_back: number; tenant_back: number; wanted?: number; limit?: number; at: string };

export type SettlementRow = {
  id: string; dispute_id: string; tenancy_id: string; turn_id: string | null; amount: number | string; terms: TurnLine[];
  status: "pending" | "approved" | "sending" | "sent" | "failed" | "cancelled";
  tenant_accepted_at: string | null; tenant_name: string | null; landlord_approved_at: string | null;
  rail: "refund_original_payment" | "payout" | null; paypal_id: string | null; paypal_status: string | null; error: string | null; sent_at: string | null;
  paypal_request_id: string | null; paypal_requested_at: string | null;
  raw?: unknown; // PayPal's answer; {demo_example: true} for a demo copy's recorded settlement
  created_at: string; updated_at: string;
};

const num = (v: unknown) => Number(v ?? 0);

/** A payment PayPal never confirmed (it may have gone), or one whose process died mid-call: nothing changes the
 *  settlement until it is checked with PayPal. */
export function unconfirmed(s: Pick<SettlementRow, "status" | "paypal_status" | "updated_at"> | null): boolean {
  if (!s) return false;
  if (s.status === "failed" && s.paypal_status === "NO_RESPONSE") return true;
  return s.status === "sending" && Date.parse(s.updated_at) < Date.now() - STALE_SENDING_MINUTES * 60_000;
}

/** Whether "Check with PayPal" may send the same request again (claim_settlement's rule): the attempt's key on record,
 *  its rail chosen, and inside RECHECK_DAYS of the key. */
function recheckable(s: SettlementRow): boolean {
  return unconfirmed(s) && !!s.paypal_request_id && !!s.rail && !!s.paypal_requested_at
    && Date.parse(s.paypal_requested_at) > Date.now() - RECHECK_DAYS * 86_400_000;
}

/** A negotiator run in progress: started and not finished, and not so long ago that it must have died. */
export const runningNow = (d: Pick<NegotiationRow, "negotiation_status" | "negotiation_started_at">) =>
  d.negotiation_status === "running" && !!d.negotiation_started_at && Date.parse(d.negotiation_started_at) >= Date.now() - NEGOTIATION_STALE_SECONDS * 1000;

export function turnFromRow(r: Record<string, unknown>): Turn {
  return {
    id: r.id as string, n: Number(r.n), side: r.side as Side, actor: r.actor as Turn["actor"], move: r.move as TurnMove,
    proposal: ((r.proposal ?? []) as TurnLine[]).map((l) => ({ ...l, amount: num(l.amount), keep: num(l.keep), min: num(l.min), max: num(l.max) })),
    total_keep: num(r.total_keep), amount_back: num(r.amount_back),
    message: (r.message as string | null) ?? null, reasoning: (r.reasoning as string | null) ?? null,
    citations: ((r.citations ?? []) as string[]), checks: (r.checks as Turn["checks"]) ?? null, created_at: r.created_at as string,
  };
}

export async function loadTurns(disputeId: string): Promise<Turn[]> {
  const { data } = await db.from("negotiation_turns").select("*").eq("dispute_id", disputeId).order("n");
  return ((data ?? []) as Record<string, unknown>[]).map(turnFromRow);
}

export async function loadSettlement(disputeId: string): Promise<SettlementRow | null> {
  const { data } = await db.from("settlements").select("*").eq("dispute_id", disputeId).maybeSingle();
  return (data as SettlementRow | null) ?? null;
}

/** The statuses a negotiation answers from. */
const NEGOTIABLE: DisputeStatus[] = ["open", "negotiating", "no_agreement"];

/** Store one turn: the database numbers it, moves the dispute, and makes (or cancels) the settlement. Null when the
 *  dispute moved on meanwhile. */
async function storeTurn(d: Pick<DisputeRow, "id" | "tenancy_id">, turn: Omit<Turn, "n"> & { n?: number }, o: { from: DisputeStatus[]; agreement: boolean; tenantName?: string | null }): Promise<string | null> {
  const { data, error } = await db.rpc("negotiation_turn", {
    p_dispute: d.id,
    p_turn: { ...turn, tenant_name: o.tenantName ?? null },
    p_from: o.from,
    p_status: o.agreement ? "agreed" : "negotiating",
    p_max_turns: MAX_TURNS,
  });
  if (error) {
    console.error("negotiation turn failed", error.message);
    return null;
  }
  return (data as string | null) ?? null;
}

/* ---------- The landlord's negotiator ---------- */

export type RunResult = { ok: true; outcome: StoredOutcome; turns: number } | { ok: false; error: string; status: number; running?: boolean };

/** Why the negotiator can't answer now, or null when it may (checked before anything is claimed or spent). */
export function negotiatorRefusal(d: NegotiationRow, turns: Turn[], facts: DisputeFacts, policy: NegotiationPolicy): string | null {
  if (!NEGOTIABLE.includes(d.status)) {
    return d.status === "agreed" ? "The two sides agreed. Approve the settlement, or make a different offer." : "This dispute is closed.";
  }
  if (agentTurns(turns) >= MAX_AGENT_TURNS) return "The agents used their three exchanges. Make an offer yourself, or accept the tenants' ask.";
  if (agreed(turns)) return "The two sides already agree.";
  // The landlord answers next when the tenants made the last move; its own last figures (the statement, at most each
  // charge's max) must fit its limit, or no lawful answer can.
  const last = turns[turns.length - 1];
  const limit = effectiveLimit(policy, facts.ranges);
  if (last?.side === "tenant" && limit != null) {
    const own = latestOf(turns, "landlord");
    const back = checkProposal(facts.ranges, own ? keepsOf(own) : statementKeeps(facts.ranges)).amountBack;
    if (back > limit + 0.005) {
      return `Any answer gives back at least $${back.toFixed(2)}, more than your limit. ${policy.autoConcede ? "Raise your limit" : "Let your negotiator concede what the law and your records don't support, or raise your limit"} to let it answer.`;
    }
  }
  return null;
}

/** Run the agents on a dispute the landlord's route already resolved: claim the run, take today's allowance, run the
 *  loop with each turn stored as it is made, then record how it ended. `models` is for tests. */
export async function runNegotiator(tenancyId: string, d: NegotiationRow, policy: NegotiationPolicy, take: () => Promise<Allowance>, models?: { landlord?: LanguageModel; tenant?: LanguageModel }): Promise<RunResult> {
  const facts = await disputeFacts(tenancyId);
  if (!facts) return { ok: false, error: "No such tenancy.", status: 404 };
  const turns = await loadTurns(d.id);
  const refusal = negotiatorRefusal(d, turns, facts, policy);
  if (refusal) return { ok: false, error: refusal, status: 409 };

  const { data: claimed, error: ce } = await db.rpc("claim_negotiation_run", { p_dispute: d.id, p_stale_seconds: NEGOTIATION_STALE_SECONDS });
  if (ce) {
    console.error("negotiation claim failed", ce.message);
    return { ok: false, error: "Couldn't start the negotiation. Try again.", status: 500 };
  }
  if (!claimed) return { ok: false, error: "The agents are already negotiating. This page updates as they go.", status: 409, running: true };
  const release = (status: "done" | "failed" | null, fields: Record<string, unknown> = {}) =>
    db.from("disputes").update({ negotiation_status: status, updated_at: new Date().toISOString(), ...fields }).eq("id", d.id);

  const allowance = await take();
  if (allowance.refused) {
    await release(d.negotiation_outcome ? "done" : null);
    return { ok: false, error: (await allowance.refused.clone().json().catch(() => ({})))?.error ?? "Today's limit for this is used up.", status: allowance.refused.status };
  }

  await db.from("disputes").update({ negotiator_policy: policy }).eq("id", d.id);
  await audit(tenancyId, "landlord", "negotiation_started", { dispute_id: d.id, policy, agent_turns_before: agentTurns(turns) });
  let stored = 0;
  try {
    const outcome = await runNegotiation({
      file: caseFile(facts, d), pack: facts.pack, turns, policy, models,
      persist: async (turn, agreement) => {
        const id = await storeTurn(d, turn, { from: NEGOTIABLE, agreement });
        if (!id) return null;
        stored++;
        await audit(tenancyId, "agent", "negotiation_turn", { dispute_id: d.id, n: turn.n, side: turn.side, move: turn.move, amount_back: turn.amount_back });
        return id;
      },
    });
    // A run that asked no model (a forfeited deposit, conceded in code) spends nothing of today's allowance.
    if (!outcome.calls) await allowance.giveBack();
    const at = new Date().toISOString();
    const out: StoredOutcome = { reason: outcome.reason, landlord_back: outcome.landlordBack, tenant_back: outcome.tenantBack, at,
      ...(outcome.wanted != null ? { wanted: outcome.wanted, limit: outcome.limit } : {}) };
    if (outcome.reason === "no_movement" || outcome.reason === "exhausted") {
      // Both final positions are on record in the turns and here; the dispute closes with no agreement, and either
      // human may still make an offer.
      await db.from("disputes").update({ status: "no_agreement", closed_at: at }).eq("id", d.id).in("status", ["open", "negotiating"]);
    }
    await release("done", { negotiation_outcome: out, negotiation_error: null });
    await audit(tenancyId, "agent", "negotiation_ended", { dispute_id: d.id, reason: outcome.reason, landlord_back: outcome.landlordBack, tenant_back: outcome.tenantBack, turns: stored, calls: outcome.calls });
    return { ok: true, outcome: out, turns: stored };
  } catch (e) {
    console.error("negotiation failed", e);
    if (!stored && claudeNeverAnswered(e)) await allowance.giveBack();
    const message = e instanceof Error ? e.message.slice(0, 300) : "failed";
    const now = await loadTurns(d.id);
    await release("failed", {
      negotiation_error: message,
      negotiation_outcome: { reason: "failed", landlord_back: num(latestOf(now, "landlord")?.amount_back), tenant_back: num(latestOf(now, "tenant")?.amount_back), at: new Date().toISOString() },
    });
    await audit(tenancyId, "agent", "negotiation_failed", { dispute_id: d.id, error: message, turns: stored });
    return { ok: false, error: stored ? "The agents stopped partway. What they said so far is below; run them again to go on." : "The agents couldn't start. Try again in a minute.", status: 500 };
  }
}

/* ---------- A human's own offer ---------- */

export type OfferResult = { ok: true; agreed: boolean; amountBack: number } | { ok: false; error: string; status: number };

/** The landlord's or the tenants' own offer (an amount back, or the other side's last figures accepted as they are),
 *  checked against the lawful range and stored as a turn. A tenant's acceptance of the landlord's offer is their
 *  acceptance of the settlement too. */
export async function makeOffer(tenancyId: string, d: NegotiationRow, side: Side, o: { amount: number | null; accept: boolean; message: string | null; tenantName?: string | null }): Promise<OfferResult> {
  const from: DisputeStatus[] = ["open", "negotiating", "no_agreement", "agreed"];
  if (!from.includes(d.status)) return { ok: false, error: d.status === "settled" ? "This dispute is settled." : "This dispute is closed.", status: 409 };
  // A run that started too long ago and never finished died with its process: it no longer holds the humans back.
  if (runningNow(d)) return { ok: false, error: "The agents are negotiating right now. Make your offer once they finish.", status: 409 };
  const [facts, turns, settlement] = await Promise.all([disputeFacts(tenancyId), loadTurns(d.id), d.status === "agreed" ? loadSettlement(d.id) : Promise.resolve(null)]);
  if (!facts) return { ok: false, error: "No such tenancy.", status: 404 };
  // A payment on its way, or one PayPal never confirmed, holds the settlement as it is until PayPal answers.
  if (settlement && (settlement.status === "sending" || unconfirmed(settlement))) {
    return { ok: false, status: 409, error: side === "landlord"
      ? "PayPal hasn't confirmed the payment of this settlement yet, so it can't change. Check with PayPal first."
      : "Your landlord's payment of this settlement is being confirmed with PayPal, so it can't change now." };
  }
  // The tenants' acceptance is final for them: the confirmation said so. The landlord may still decline with an offer.
  if (side === "tenant" && settlement?.tenant_accepted_at && settlement.status !== "cancelled") {
    return { ok: false, error: "You accepted this settlement, so it can't be changed here.", status: 409 };
  }
  const otherSide: Side = side === "landlord" ? "tenant" : "landlord";
  const mine = latestOf(turns, side), theirs = latestOf(turns, otherSide);
  if (side === "tenant" && !theirs) return { ok: false, error: "Your landlord hasn't answered yet.", status: 409 };
  if (o.accept && !theirs) return { ok: false, error: "There's no offer to accept yet.", status: 409 };
  const last = turns[turns.length - 1];
  const res = offerTurn({
    side, ranges: facts.ranges, amount: o.amount, accept: o.accept, message: o.message,
    own: mine ? keepsOf(mine) : statementKeeps(facts.ranges), other: theirs ? keepsOf(theirs) : statementKeeps(facts.ranges),
    // Once the two sides agree, an offer withdraws from the agreed figures (the settlement's terms, the last turn).
    agreed: d.status === "agreed" && last ? keepsOf(last) : undefined,
    allowed: new Set(allowedCitations(facts.pack, facts.ranges)),
  });
  if (!res.ok) return { ok: false, error: res.error, status: 400 };
  if (side === "tenant") res.turn.checks = { adjustments: [], by: o.tenantName ?? d.opened_by };
  const agreement = !!theirs && Math.abs(res.turn.amount_back - Number(theirs.amount_back)) < 0.005;
  // Every dispute holds at most MAX_TURNS turns; past that only an acceptance goes in, so the two can still close.
  if (!agreement && turns.length >= MAX_TURNS) {
    return { ok: false, error: `This negotiation has used its ${MAX_TURNS} turns. Accept the other side's figure to settle, or leave it unsettled.`, status: 409 };
  }
  const id = await storeTurn(d, res.turn, { from, agreement, tenantName: side === "tenant" ? o.tenantName ?? d.opened_by : null });
  if (!id) return { ok: false, error: "The negotiation moved on meanwhile. Reload the page.", status: 409 };
  await audit(tenancyId, side, "negotiation_offer", { dispute_id: d.id, amount_back: res.turn.amount_back, accept: o.accept, name: side === "tenant" ? o.tenantName ?? d.opened_by : null });
  if (agreement) {
    await audit(tenancyId, side, "settlement_agreed", { dispute_id: d.id, amount: res.turn.amount_back, by: side });
    if (side === "tenant") await audit(tenancyId, "tenant", "settlement_accepted", { dispute_id: d.id, amount: res.turn.amount_back, name: o.tenantName ?? d.opened_by });
  }
  return { ok: true, agreed: agreement, amountBack: res.turn.amount_back };
}

/** The tenants accept the settlement the two sides agreed on. */
export async function acceptSettlement(tenancyId: string, d: NegotiationRow, name: string): Promise<{ ok: true } | { ok: false; error: string; status: number }> {
  const { data, error } = await db.rpc("accept_settlement", { p_dispute: d.id, p_name: name });
  if (error) {
    console.error("settlement acceptance failed", error.message);
    return { ok: false, error: "Couldn't record that. Try again.", status: 500 };
  }
  if (!data) return { ok: false, error: "There's no settlement waiting on you: it was already accepted, or the offer changed.", status: 409 };
  const s = await loadSettlement(d.id);
  await audit(tenancyId, "tenant", "settlement_accepted", { dispute_id: d.id, amount: s ? Number(s.amount) : null, name });
  return { ok: true };
}

/** The landlord's sent dispute with its negotiation columns. */
export async function negotiationDispute(tenancyId: string): Promise<NegotiationRow | null> {
  return (await sentDispute(tenancyId)) as NegotiationRow | null;
}

/* ---------- What each side's page shows ---------- */

export type TurnLineView = { n: number; title: string; amount: number; keep: number; back: number; max: number; move: TurnLine["move"] | null; reason: string | null; citation: string | null };
export type TurnView = {
  n: number; side: Side; actor: Turn["actor"]; move: TurnMove; amountBack: number; totalKeep: number;
  message: string | null; reasoning: string | null; citations: string[]; adjustments: string[]; at: string | null;
  lines: TurnLineView[];
  limit: { wanted: number; limit: number } | null; // the landlord's page only
  by: string | null; // the tenant who made a human tenant turn
};
export type SettlementView = {
  amount: number; status: SettlementRow["status"]; terms: TurnLineView[];
  tenantAcceptedAt: string | null; tenantName: string | null; landlordApprovedAt: string | null;
  rail: SettlementRow["rail"]; paypalId: string | null; paypalStatus: string | null; sentAt: string | null; error: string | null;
  retry: boolean; // PayPal refused, so it may be tried again
  unconfirmed: boolean; // PayPal never confirmed the payment: nothing changes until it is checked
  recheck: boolean; // and "Check with PayPal" may send the same request again
  example: boolean; // the demo's recorded example (a copy's closed unit): history only, no PayPal money moved
  // The statement's refund was already the whole deposit (New York's forfeited deductions under a live dispute), so the
  // settlement records what was agreed and moves no money (settlement.ts).
  wholeBack: boolean;
};
export type NegotiationView = {
  turns: TurnView[];
  running: boolean;
  startedAt: string | null;
  failed: string | null; // why the last run stopped short (the landlord's page only)
  outcome: StoredOutcome | null;
  agentTurnsLeft: number;
  landlordBack: number | null; // the landlord's last offer, null before it answered
  tenantBack: number; // the tenants' last ask
  minBack: number;
  maxBack: number;
  settlement: SettlementView | null;
  // The statement's refund, not sent yet, is the whole deposit (New York's forfeited deductions under this live dispute,
  // refund-rail.ts): whatever is agreed is already inside it, so the pages don't call it money on top of that refund.
  wholeOwed: boolean;
  forum: StatePack["dispute"]["forum"];
  courtsGuide: StatePack["courtsGuide"];
};

export function negotiationView(d: NegotiationRow, facts: DisputeFacts, turns: Turn[], s: SettlementRow | null, side: Side): NegotiationView {
  const titleOf = (id: string) => facts.ranges.lines.find((l) => l.id === id)?.title ?? "A charge no longer on the statement";
  const linesOf = (ls: TurnLine[]): TurnLineView[] => ls.map((l) => ({
    n: l.n, title: titleOf(l.deduction_id), amount: num(l.amount), keep: num(l.keep), back: Math.round((num(l.amount) - num(l.keep)) * 100) / 100,
    max: num(l.max), move: l.move ?? null, reason: l.reason ?? null, citation: l.citation ?? null,
  }));
  // The tenants' case (turn 1) carries its figures only; when their advocate wrote it, each charge's verdict reason and
  // citation come from the case itself.
  const caseLines = (t: Turn) => t.n === 1 && t.actor === "agent" && d.advocate
    ? t.proposal.map((l) => {
      const a = d.advocate!.lines.find((x) => x.id === l.deduction_id);
      return a ? { ...l, reason: a.reason, citation: a.citation } : l;
    })
    : t.proposal;
  const views: TurnView[] = turns.map((t) => ({
    n: t.n, side: t.side, actor: t.actor, move: t.move, amountBack: t.amount_back, totalKeep: t.total_keep,
    message: t.message, reasoning: t.reasoning, citations: t.citations ?? [],
    adjustments: (t.checks?.adjustments ?? []),
    at: t.created_at ?? null, lines: linesOf(caseLines(t)),
    limit: side === "landlord" ? t.checks?.private?.limit ?? null : null,
    by: t.side === "tenant" && t.actor === "human" ? t.checks?.by ?? (t.n === 1 ? d.opened_by : null) : null,
  }));
  const settlement: SettlementView | null = s && s.status !== "cancelled" ? {
    amount: num(s.amount), status: s.status, terms: linesOf(s.terms ?? []),
    tenantAcceptedAt: s.tenant_accepted_at, tenantName: s.tenant_name, landlordApprovedAt: s.landlord_approved_at,
    rail: s.rail, paypalId: s.paypal_id, paypalStatus: s.paypal_status, sentAt: s.sent_at,
    error: side === "landlord" ? s.error : null,
    retry: s.status === "failed" && s.paypal_status === "REFUSED",
    unconfirmed: unconfirmed(s),
    recheck: recheckable(s),
    example: isDemoExample(s.raw),
    wholeBack: !!facts.refunded && facts.depositHeld > 0 && settledExtra({ agreed: num(s.amount), depositHeld: facts.depositHeld, refunded: facts.refunded.amount }) === 0 && num(s.amount) > 0,
  } : null;
  const outcome = d.negotiation_outcome;
  return {
    turns: views,
    running: runningNow(d),
    startedAt: d.negotiation_started_at,
    failed: side === "landlord" && d.negotiation_status === "failed" ? d.negotiation_error : null,
    // The tenants never learn that the landlord's negotiator stopped for its private limit: to them it just stopped.
    outcome: outcome && side === "tenant"
      ? { reason: outcome.reason === "limit" ? "stopped" : outcome.reason, landlord_back: outcome.landlord_back, tenant_back: outcome.tenant_back, at: outcome.at }
      : outcome,
    agentTurnsLeft: Math.max(0, MAX_AGENT_TURNS - agentTurns(turns)),
    landlordBack: latestOf(turns, "landlord")?.amount_back ?? null,
    tenantBack: latestOf(turns, "tenant")?.amount_back ?? 0,
    minBack: facts.ranges.totals.minBack,
    maxBack: facts.ranges.totals.maxBack,
    settlement,
    wholeOwed: wholeDepositFirst(d.status, facts),
    forum: facts.pack.dispute.forum,
    courtsGuide: facts.pack.courtsGuide,
  };
}

/** The policy as the landlord last set it, or the default. */
export const policyOf = (d: Pick<NegotiationRow, "negotiator_policy">) => cleanPolicy(d.negotiator_policy);

export type LoadedNegotiation = NegotiationView & {
  status: DisputeStatus; policy: NegotiationPolicy | null; openedBy: string | null;
  payBlock: string | null; // the landlord's page only: why this demo copy can't pay a settlement (a shared deposit)
};

/** A side's view of the negotiation over the tenancy's sent dispute, or null before one was sent. The landlord's page
 *  gets its policy, its agent's limit notes and whether this copy of the demo can pay; the tenants' never does. */
export async function loadNegotiation(tenancyId: string, side: Side, readFacts: () => Promise<DisputeFacts | null> = () => disputeFacts(tenancyId),
  readDispute: () => Promise<DisputeRow | null> = () => sentDispute(tenancyId)): Promise<LoadedNegotiation | null> {
  const d = (await readDispute()) as NegotiationRow | null;
  if (!d) return null;
  const [facts, turns, s] = await Promise.all([readFacts(), loadTurns(d.id), loadSettlement(d.id)]);
  if (!facts) return null;
  const payBlock = side === "landlord" && d.workspace_id && d.status === "agreed" && s && s.status !== "sent"
    ? await tenancyDepositBlock(d.workspace_id, tenancyId) : null;
  return { ...negotiationView(d, facts, turns, s, side), status: d.status, policy: side === "landlord" ? policyOf(d) : null, openedBy: d.opened_by,
    payBlock: payBlock ? payBlock.replace("send its refund", "pay a settlement") : null };
}

export type DisputeAlert = { tenancyId: string; title: string; sub: string; href: string; tone: "amber" };

/** The bell's (and the Properties page's) dispute entries for a workspace: a dispute waiting on the landlord's answer,
 *  a settlement the tenants accepted that waits on the landlord's approval (not in a demo copy that can't pay one), a
 *  payment PayPal never confirmed, and a negotiator that stopped to ask before going past its limit. */
async function loadDisputeAlerts(workspaceId: string): Promise<DisputeAlert[]> {
  const { data } = await db.from("disputes").select("tenancy_id, status, negotiation_status, negotiation_outcome, settlements(status, tenant_accepted_at, paypal_status, updated_at), tenancies(properties(address))")
    .eq("workspace_id", workspaceId).in("status", ["open", "negotiating", "agreed"]).order("updated_at", { ascending: false }).limit(10);
  type S = { status: SettlementRow["status"]; tenant_accepted_at: string | null; paypal_status: string | null; updated_at: string };
  type Row = { tenancy_id: string; status: DisputeStatus; negotiation_status: string | null; negotiation_outcome: StoredOutcome | null;
    settlements: S[] | S | null; tenancies: { properties: { address: string } | null } | null };
  const out: DisputeAlert[] = [];
  for (const r of (data ?? []) as unknown as Row[]) {
    const s = Array.isArray(r.settlements) ? r.settlements.find((x) => x.status !== "cancelled") : r.settlements;
    const sub = r.tenancies?.properties?.address ?? "A property";
    const entry = (title: string, hash: string) => out.push({ tenancyId: r.tenancy_id, title, sub, href: `/tenancy/${r.tenancy_id}?tab=move-out#${hash}`, tone: "amber" });
    if (r.status === "open") entry("Tenants disputed the statement", "dispute");
    else if (r.status === "agreed" && s && unconfirmed(s)) entry("Check the settlement with PayPal", "negotiation");
    else if (r.status === "agreed" && s?.tenant_accepted_at && (s.status === "pending" || (s.status === "failed" && s.paypal_status === "REFUSED"))) {
      if (!(await tenancyDepositBlock(workspaceId, r.tenancy_id))) entry("Approve and pay the settlement", "negotiation");
    } else if (r.status === "negotiating" && r.negotiation_status === "done" && r.negotiation_outcome?.reason === "limit") {
      entry("Your negotiator asks for your OK", "negotiation");
    }
  }
  return out;
}
/** disputeAlerts for the workspace, read once per request: the app shell's bell and the Properties page share it. */
export const disputeAlerts = cache(loadDisputeAlerts);

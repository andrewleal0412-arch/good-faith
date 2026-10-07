import "server-only";
import type { Pending } from "./agent";
import { timeline, type TimelineItem } from "./agent-timeline";
import { closeOutFacts, guardWithFacts, paidAgo, type CloseOutFacts, type Rail } from "./closeout";
import { dateIn, shortDate, whenText } from "./dates";
import { db } from "./db";
import { usd } from "./deductions";
import { DEMO_DEPOSIT_DATE, DEMO_REFUND_BLOCKS } from "./demo-pool";
import { returnCompleted, returnFailed, wasPaid } from "./invoice-status";
import { streetLine } from "./ledger";
import { tabHref } from "./property-view";
import type { DeliveryRecord } from "./statement";
import { deadlineWords, packFor, refundRecordWords } from "./states/server";
import type { StatePack } from "./states/types";

// The refund as Mercury's Review transfer reads it, for the focused /tenancy/<id>/refund page: who gets what from
// which deposit, the checks the rules ran (the same closeOutFacts the agent reads and guardRefund re-runs before
// money moves), the agent's steps, and once PayPal has the money, the receipt. Presentation only: what may be refunded
// and the approval itself stay in closeout.ts and agent.ts.

export type Check = {
  key: string;
  label: string;
  value: string;
  state: "ok" | "warn" | "fail";
  tip: { title: string; body: string; cite?: string };
};

export type RunView = {
  id: string;
  status: string;
  error: string | null;
  startedAt: string; // the run's timestamp
  proposedAt: string | null; // when it paused for the landlord's approval
  items: TimelineItem[];
};

export type RefundView = {
  tenancyId: string;
  landlord: string;
  street: string;
  tenants: string[];
  paypalEmail: string | null;
  back: string; // the property's Move-out tab, where Back, Close and Done go
  statement: { due: string | null; delivery: DeliveryRecord | null };
  sent: {
    kind: "refund" | "payout";
    amount: number;
    deposit: number; // the deposit it came out of
    paypalId: string | null;
    status: string; // PayPal's, in words
    tone: "green" | "amber" | "red";
    at: string;
    approvedAt: string | null;
    run: RunView | null;
    fromPayPal?: string; // when PayPal's webhook reported the status; absent when it didn't
  } | null;
  review: {
    amount: number;
    depositHeld: number;
    deductions: number;
    balanceClaimed: number;
    standing?: string; // how the claimed amount stands when it is not a plain deduction ("Claimed, disputed"); absent in California
    forfeited?: boolean; // the deductions are forfeited (New York after day 14), so the whole deposit goes back
    // What PayPal already returned through the tenants' PayPal dispute, which comes off the amount; notKept: the
    // deductions it covered past the refund owed. Absent when there is none.
    viaDispute?: { amount: number; disputeId: string | null; notKept: number };
    // Refunds made in PayPal that the landlord recorded as this deposit's refund, which come off the amount the same
    // way; notKept as above. Absent when there is none.
    outside?: { amount: number; notKept: number };
    // Refunds made in PayPal still waiting to be recorded or marked not this deposit, which hold the refund (each is one
    // of the blockers); where to decide them. Absent when there is none.
    waiting?: { count: number; amount: number; href: string };
    rail: Rail;
    why: string;
    noteToPayer?: string; // what PayPal shows the tenants when the whole deposit goes back (closeout.ts); absent otherwise
    method: string | null; // how the tenants paid, PayPal's code
    blockers: string[];
    warnings: string[];
    // A demo copy that holds no sandbox deposit of its own (made when the day's pre-paid deposits were used up, or the
    // Texas unit, whose deposit is always its template's): everything works but sending the money. demoBlock is the
    // sentence it shows, present only then.
    poolEmpty: boolean;
    demoBlock?: string;
    checks: Check[];
    run: RunView | null;
    pending: { tool: string; amount: number; check: string | null } | null; // check: null = matches the rules right now
  } | null;
};

/** "m•••@gmail.com": enough to recognize the account without spelling it out on screen. Shared with the tenant page. */
export { maskEmail } from "./copy";

/** A rules entry split into its citation and its words, e.g. "Civ. Code 1950.5(h)(1)" and "The itemized...". An entry
 *  whose head is not a citation (no section number in it) stays whole. */
function rule(text: string | undefined): { cite?: string; body: string } {
  if (!text) return { body: "" };
  const i = text.indexOf(": ");
  if (i < 0 || !/\d/.test(text.slice(0, i)) || i > 90) return { body: text };
  const body = text.slice(i + 2);
  return { cite: text.slice(0, i), body: body.charAt(0).toUpperCase() + body.slice(1) };
}

const plural = (n: number, w: string) => `${n} ${w}${n === 1 ? "" : "s"}`;
const statusWords = (s: string) => (s === "ONHOLD" ? "On hold" : s.charAt(0) + s.slice(1).toLowerCase().replace(/_/g, " "));

/** When PayPal's webhook reported a payment row's status (raw.status_from, src/lib/paypal-webhook.ts), or null. */
const reportedAt = (raw: unknown): string | null => {
  const s = (raw as { status_from?: { source?: string; at?: string } } | null)?.status_from;
  return s?.source === "paypal" && typeof s.at === "string" ? s.at : null;
};

/** The rules engine's answers as one-line checks, each with the rule behind it in a tip. */
function checksOf(f: CloseOutFacts, pendingAmount: number | null, demo: boolean, pack: StatePack, words: { within: string; title: string }): Check[] {
  const out: Check[] = [];
  const RULES = f.rules;
  const d = f.deposit;
  out.push({
    key: "deposit", label: "Deposit paid in PayPal",
    value: d ? `${usd(d.amount)}${d.paidAt ? `, ${shortDate(dateIn(d.paidAt, pack.timeZone.id))}` : ""}` : "Not collected",
    state: d && wasPaid(d.status) && d.live ? "ok" : "fail",
    tip: { title: "The deposit", body: d
      ? `PayPal reports invoice ${d.invoiceId} as ${statusWords(d.status).toLowerCase()}${d.live ? ", checked just now" : ", as last recorded: PayPal could not be reached"}.${demo ? ` ${DEMO_DEPOSIT_DATE}` : ""}`
      : "No deposit was collected through PayPal for this tenancy." },
  });
  const a = f.refundAgreement;
  if (a || pack.refund.agreementRequired) {
    // California's agreement to a PayPal refund; in a state with no such rule, the tenants' written designation.
    const record = refundRecordWords(pack);
    out.push({
      key: "agreement", label: record.check,
      value: a ? `Signed ${shortDate(dateIn(a.signedAt, pack.timeZone.id))}` : "Not on file",
      state: a ? "ok" : "fail",
      tip: { title: record.tip, ...rule(RULES.electronicRefund) },
    });
  }
  if (f.tenancy.tenants.length > 1) {
    out.push({
      key: "payees", label: "One refund for all tenants",
      value: f.tenancy.tenants.length === 2 ? "Payable to both" : `Payable to all ${f.tenancy.tenants.length}`,
      state: "ok", tip: { title: "More than one tenant", ...rule(RULES.roommates) },
    });
  }
  const missing = f.deductions.filter((x) => x.missingDocs.length);
  out.push({
    key: "documents", label: "Deductions documented",
    value: !f.deductions.length ? "No deductions" : missing.length ? `${plural(missing.length, "item")} missing documents`
      : pack.documents.refundCheck(f.totals.documentsRequired, f.totals.deductions),
    state: missing.length ? "fail" : "ok",
    tip: { title: "Documents", ...rule(RULES.documents) },
  });
  const matches = pendingAmount == null || pendingAmount.toFixed(2) === f.plan.amount.toFixed(2);
  const forfeit = f.standing?.forfeits ? f.standing : null;
  out.push(forfeit ? {
    // Forfeited deductions (New York after day 14): the whole deposit goes back. Until the deductions are removed (or,
    // under a live dispute, the refund is the whole deposit) nothing can be sent, so the check fails.
    key: "amount", label: "Deposit in full",
    value: `${usd(f.totals.depositHeld)}, ${usd(f.totals.deductions)} in deductions forfeited`,
    state: f.wholeDeposit && matches ? "ok" : "fail",
    tip: { title: forfeit.label, body: forfeit.note },
  } : {
    key: "amount", label: f.standing ? `Deposit less the amount ${f.standing.label.toLowerCase()}` : "Deposit less deductions",
    value: `${usd(f.totals.depositHeld)} less ${usd(f.totals.deductions)}${f.viaDispute ? `, less ${usd(f.viaDispute.amount)} through the PayPal dispute` : ""}${f.outside ? `, less ${usd(f.outside.amount)} refunded in PayPal` : ""}`,
    state: matches ? "ok" : "fail",
    tip: { title: "The refund", body: `What is left of the deposit after the itemized deductions goes back to the tenants.${f.viaDispute ? " What PayPal already returned through the tenants' PayPal dispute counts toward it." : ""}${f.outside ? " A refund made in PayPal that you recorded as this deposit's refund counts toward it too." : ""}`, cite: pack.deadline.tip.cite },
  });
  const t = f.tenancy;
  out.push({
    key: "deadline", label: words.within,
    value: t.statementDue && t.daysLeft != null ? `Due ${shortDate(t.statementDue)}, ${whenText(t.daysLeft)}` : "No move-out date",
    state: !t.moveOutDate ? "fail" : t.daysLeft != null && t.daysLeft < 0 ? "warn" : "ok",
    tip: { title: words.title, ...rule(RULES.deadline) },
  });
  if (f.plan.rail === "refund_original_payment" || f.plan.rail === "payout") {
    out.push({
      key: "rail", label: f.plan.rail === "payout" ? "Payout to the designated account" : "Refund to the original payment",
      value: f.plan.rail === "payout" ? "PayPal Payout"
        : d?.daysSincePaid != null ? `Paid ${paidAgo(d.daysSincePaid)}` : "Inside 180 days",
      state: "ok",
      tip: { title: "How the money goes back", body: `${f.plan.why} ${RULES.refundWindow}` },
    });
  }
  return out;
}

async function runView(run: Record<string, unknown> | null | undefined): Promise<RunView | null> {
  if (!run) return null;
  const { data: proposed } = await db.from("audit_log").select("created_at, detail").eq("tenancy_id", run.tenancy_id as string)
    .eq("action", "refund_proposed").order("created_at", { ascending: false }).limit(20);
  const p = (proposed ?? []).find((x) => (x.detail as { run_id?: string } | null)?.run_id === run.id);
  return {
    id: run.id as string, status: run.status as string, error: (run.error as string | null) ?? null,
    startedAt: run.created_at as string, proposedAt: p?.created_at ?? null,
    items: timeline((run.messages ?? []) as Parameters<typeof timeline>[0]),
  };
}

export async function loadRefundView(id: string, opts: { demo?: boolean } = {}): Promise<RefundView | null> {
  const { data: t } = await db.from("tenancies").select("*, properties(address, city, owner_name, state)").eq("id", id).maybeSingle();
  if (!t) return null;
  const pack = packFor((t.properties as { state?: string | null } | null)?.state);
  const [{ data: payments }, { data: runs }, { data: approvals }, { count: deductionCount }] = await Promise.all([
    db.from("payments").select("*").eq("tenancy_id", id).order("created_at"),
    db.from("agent_runs").select("*").eq("tenancy_id", id).eq("kind", "close_out").order("created_at", { ascending: false }).limit(10),
    db.from("audit_log").select("created_at, detail").eq("tenancy_id", id).eq("action", "refund_approved").order("created_at", { ascending: false }).limit(1),
    // Whether anything is claimed: Florida's deadline turns on it (15 days with no claim, 30 after a claim notice).
    db.from("deductions").select("id", { count: "exact", head: true }).eq("tenancy_id", id),
  ]);
  const prop = t.properties as { address: string; city: string | null; owner_name: string | null } | null;
  const terms = t.lease_terms as { landlordName?: string | null; propertyAddress?: string | null } | null;
  const agreement = t.refund_agreement as { paypal_email: string } | null;
  // The deadline on the tenancy's track, as the close-out facts count it (closeout.ts): the same inputs, so the receipt
  // page and the review agree with the tenancy page.
  const clock = {
    moveOutDate: t.move_out_date as string | null, endDate: t.end_date as string | null, plannedMoveOut: t.planned_move_out as string | null,
    claimed: (deductionCount ?? 0) > 0, claimNoticeDate: (t.notices as { claim_notice?: { date: string } } | null)?.claim_notice?.date ?? null,
  };
  const words = deadlineWords(pack, clock);
  const base = {
    tenancyId: id,
    landlord: prop?.owner_name ?? terms?.landlordName ?? "Landlord",
    street: streetLine(prop?.address ?? terms?.propertyAddress ?? "this unit"),
    tenants: ((t.tenants ?? []) as { name: string }[]).map((x) => x.name),
    paypalEmail: agreement?.paypal_email ?? null,
    back: tabHref(id, "move-out", "refund"),
    statement: {
      due: clock.moveOutDate ? pack.deadline.due(clock) : null,
      delivery: (t.statement_delivery ?? null) as DeliveryRecord | null,
    },
  };

  // Once PayPal has the money, the receipt; the run shown is the one the landlord approved.
  const returned = (payments ?? []).find((p) => p.kind === "refund" || p.kind === "payout");
  if (returned) {
    const approved = approvals?.[0];
    const runId = (approved?.detail as { run_id?: string } | null)?.run_id;
    const run = (runs ?? []).find((r) => r.id === runId) ?? runs?.[0];
    const status = String(returned.status ?? "");
    return {
      ...base,
      sent: {
        kind: returned.kind, amount: Number(returned.amount), paypalId: returned.paypal_id, at: returned.created_at,
        deposit: Number((payments ?? []).find((p) => p.kind === "deposit_invoice")?.amount ?? 0),
        status: returnCompleted(status) ? "Completed" : returnFailed(status) ? `${statusWords(status)}, nothing was sent` : statusWords(status || "PENDING"),
        tone: returnCompleted(status) ? "green" : returnFailed(status) ? "red" : "amber",
        approvedAt: approved?.created_at ?? null,
        run: await runView(run),
        ...(reportedAt(returned.raw) ? { fromPayPal: reportedAt(returned.raw)! } : {}),
      },
      review: null,
    };
  }

  // Before then, the rules engine's facts, live from PayPal, and the latest run with any refund it is waiting on.
  const f = await closeOutFacts(id);
  const run = runs?.[0];
  let pending: NonNullable<RefundView["review"]>["pending"] = null;
  if (run?.status === "awaiting_approval" && run.pending) {
    const pd = run.pending as Pending;
    const refund = pd.toolName === "create_refund";
    const amount = refund ? (pd.input.amount as { value?: string })?.value ?? "" : String(pd.input.amount ?? "");
    pending = {
      tool: pd.toolName, amount: Number(amount),
      // The facts just read, so the page asks PayPal once; Send re-runs guardRefund from scratch.
      check: guardWithFacts(f, refund
        ? { rail: "refund_original_payment", amount, captureId: pd.input.capture_id as string }
        : { rail: "payout", amount, email: pd.input.email as string }),
    };
  }
  const demoBlock = f.blockers.find((b) => DEMO_REFUND_BLOCKS.includes(b)) ?? null;
  if (demoBlock) console.warn(`demo copy tenancy ${id}: its refund page says it holds no sandbox deposit of its own`);
  return {
    ...base,
    sent: null,
    review: {
      // What goes back: the whole deposit once the deductions are forfeited (New York after day 14), else the rest; less
      // what PayPal already returned through the tenants' PayPal dispute.
      amount: pending?.amount ?? Math.max(0, Math.round(((f.standing?.forfeits ? f.totals.depositHeld : f.totals.refund) - (f.viaDispute?.amount ?? 0) - (f.outside?.amount ?? 0)) * 100) / 100), depositHeld: f.totals.depositHeld, deductions: f.totals.deductions,
      ...(f.viaDispute ? { viaDispute: { amount: f.viaDispute.amount, disputeId: f.viaDispute.disputeId, notKept: f.viaDispute.notKept } } : {}),
      ...(f.outside ? { outside: { amount: f.outside.amount, notKept: f.outside.notKept } } : {}),
      ...(f.outsideOpen?.length ? { waiting: { count: f.outsideOpen.length, amount: Math.round(f.outsideOpen.reduce((t2, r) => t2 + r.amount, 0) * 100) / 100, href: tabHref(id, "payments", "outside-refunds") } } : {}),
      balanceClaimed: f.totals.balanceClaimed, ...(f.standing && !f.standing.forfeits ? { standing: f.standing.label } : {}), ...(f.standing?.forfeits ? { forfeited: true } : {}),
      rail: f.plan.rail, why: f.plan.why, ...(f.plan.noteToPayer ? { noteToPayer: f.plan.noteToPayer } : {}), method: f.deposit?.method ?? null,
      blockers: f.blockers.filter((b) => b !== demoBlock), warnings: f.warnings, poolEmpty: !!demoBlock, ...(demoBlock ? { demoBlock } : {}),
      checks: checksOf(f, pending?.amount ?? null, !!opts.demo, pack, words),
      run: await runView(run), pending,
    },
  };
}

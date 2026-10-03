import "server-only";
import type { Pending } from "./agent";
import { timeline, type TimelineItem } from "./agent-timeline";
import { closeOutFacts, guardWithFacts, RULES, type CloseOutFacts, type Rail } from "./closeout";
import { pacificDate, shortDate, whenText } from "./dates";
import { db } from "./db";
import { statementDue, usd } from "./deductions";
import { returnCompleted, returnFailed, wasPaid } from "./invoice-status";
import { streetLine } from "./ledger";
import { tabHref } from "./property-view";
import type { DeliveryRecord } from "./statement";

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
  } | null;
  review: {
    amount: number;
    depositHeld: number;
    deductions: number;
    balanceClaimed: number;
    rail: Rail;
    why: string;
    method: string | null; // how the tenants paid, PayPal's code
    blockers: string[];
    warnings: string[];
    checks: Check[];
    run: RunView | null;
    pending: { tool: string; amount: number; check: string | null } | null; // check: null = matches the rules right now
  } | null;
};

/** "m•••@gmail.com": enough to recognize the account without spelling it out on screen. */
export function maskEmail(email: string | null | undefined): string | null {
  if (!email) return null;
  const at = email.indexOf("@");
  return at > 0 ? `${email[0]}•••${email.slice(at)}` : email;
}

/** A RULES entry split into its citation and its words, e.g. "Civ. Code 1950.5(h)(1)" and "The itemized...". */
function rule(text: string): { cite?: string; body: string } {
  const i = text.indexOf(": ");
  if (!text.startsWith("Civ. Code") || i < 0) return { body: text };
  const body = text.slice(i + 2);
  return { cite: text.slice(0, i), body: body.charAt(0).toUpperCase() + body.slice(1) };
}

const plural = (n: number, w: string) => `${n} ${w}${n === 1 ? "" : "s"}`;
const statusWords = (s: string) => s.charAt(0) + s.slice(1).toLowerCase().replace(/_/g, " ");

/** The rules engine's answers as one-line checks, each with the rule behind it in a tip. */
function checksOf(f: CloseOutFacts, pendingAmount: number | null): Check[] {
  const out: Check[] = [];
  const d = f.deposit;
  out.push({
    key: "deposit", label: "Deposit paid in PayPal",
    value: d ? `${usd(d.amount)}${d.paidAt ? `, ${shortDate(pacificDate(d.paidAt))}` : ""}` : "Not collected",
    state: d && wasPaid(d.status) && d.live ? "ok" : "fail",
    tip: { title: "The deposit", body: d
      ? `PayPal reports invoice ${d.invoiceId} as ${statusWords(d.status).toLowerCase()}${d.live ? ", checked just now" : ", as last recorded: PayPal could not be reached"}.`
      : "No deposit was collected through PayPal for this tenancy." },
  });
  const a = f.refundAgreement;
  out.push({
    key: "agreement", label: "Refund by PayPal agreed in writing",
    value: a ? `Signed ${shortDate(pacificDate(a.signedAt))}` : "Not on file",
    state: a ? "ok" : "fail",
    tip: { title: "Refund by PayPal", ...rule(RULES.electronicRefund) },
  });
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
      : f.totals.documentsRequired ? "Invoices, labor and photos" : `${usd(125)} or less, not required`,
    state: missing.length ? "fail" : "ok",
    tip: { title: "Documents", ...rule(RULES.documents) },
  });
  const matches = pendingAmount == null || pendingAmount.toFixed(2) === f.plan.amount.toFixed(2);
  out.push({
    key: "amount", label: "Deposit less deductions",
    value: `${usd(f.totals.depositHeld)} less ${usd(f.totals.deductions)}`,
    state: matches ? "ok" : "fail",
    tip: { title: "The refund", body: "What is left of the deposit after the itemized deductions goes back to the tenants.", cite: "Civ. Code 1950.5(h)(1)" },
  });
  const t = f.tenancy;
  out.push({
    key: "deadline", label: "Within the 21 days",
    value: t.statementDue && t.daysLeft != null ? `Due ${shortDate(t.statementDue)}, ${whenText(t.daysLeft)}` : "No move-out date",
    state: !t.moveOutDate ? "fail" : t.daysLeft != null && t.daysLeft < 0 ? "warn" : "ok",
    tip: { title: "21-day deadline", ...rule(RULES.deadline) },
  });
  if (f.plan.rail === "refund_original_payment" || f.plan.rail === "payout") {
    out.push({
      key: "rail", label: f.plan.rail === "payout" ? "Payout to the designated account" : "Refund to the original payment",
      value: f.plan.rail === "payout" ? "PayPal Payout"
        : d?.daysSincePaid != null ? `Paid ${plural(d.daysSincePaid, "day")} ago` : "Inside 180 days",
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

export async function loadRefundView(id: string): Promise<RefundView | null> {
  const { data: t } = await db.from("tenancies").select("*, properties(address, city, owner_name)").eq("id", id).maybeSingle();
  if (!t) return null;
  const [{ data: payments }, { data: runs }, { data: approvals }] = await Promise.all([
    db.from("payments").select("*").eq("tenancy_id", id).order("created_at"),
    db.from("agent_runs").select("*").eq("tenancy_id", id).eq("kind", "close_out").order("created_at", { ascending: false }).limit(10),
    db.from("audit_log").select("created_at, detail").eq("tenancy_id", id).eq("action", "refund_approved").order("created_at", { ascending: false }).limit(1),
  ]);
  const prop = t.properties as { address: string; city: string | null; owner_name: string | null } | null;
  const terms = t.lease_terms as { landlordName?: string | null; propertyAddress?: string | null } | null;
  const agreement = t.refund_agreement as { paypal_email: string } | null;
  const base = {
    tenancyId: id,
    landlord: prop?.owner_name ?? terms?.landlordName ?? "Landlord",
    street: streetLine(prop?.address ?? terms?.propertyAddress ?? "this unit"),
    tenants: ((t.tenants ?? []) as { name: string }[]).map((x) => x.name),
    paypalEmail: agreement?.paypal_email ?? null,
    back: tabHref(id, "move-out", "refund"),
    statement: {
      due: t.move_out_date ? statementDue(t.move_out_date as string) : null,
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
  return {
    ...base,
    sent: null,
    review: {
      amount: pending?.amount ?? f.totals.refund, depositHeld: f.totals.depositHeld, deductions: f.totals.deductions,
      balanceClaimed: f.totals.balanceClaimed, rail: f.plan.rail, why: f.plan.why, method: f.deposit?.method ?? null,
      blockers: f.blockers, warnings: f.warnings, checks: checksOf(f, pending?.amount ?? null),
      run: await runView(run), pending,
    },
  };
}

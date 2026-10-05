import "server-only";
import { connectPayPal, mcpJson } from "./agent";
import { closeOutState, paidAgo } from "./closeout";
import { audit, db } from "./db";
import { depositBlock } from "./demo-pool";
import { usd } from "./deductions";
import { returnFailed, wasPaid } from "./invoice-status";
import { PayPalRefused, SANDBOX, sendPayout, type Invoice } from "./paypal";
import { railFor, refundOwed, REFUND_WINDOW_DAYS } from "./refund-rail";

// The settlement's money: once the tenants accepted and the landlord approved, the amount agreed on top of the
// statement's refund goes back through PayPal. The rail is the close-out's own rule (railFor, refund-rail.ts, read
// from the same facts, closeOutState): a partial refund of the original deposit payment through PayPal's Agent
// Toolkit over MCP while that payment is inside PayPal's 180-day window, was made from the account the tenants named
// (where they named one) and still has enough left on it; otherwise a Payout to the account they named in writing;
// otherwise nothing, and the page says why.
//
// The guard is the settlement's own, not the close-out's guardRefund (which checks the statement's refund, a different
// amount): the claim (claim_settlement) makes sure a double click pays once and only after both humans said yes, and
// settlementPlan, recomputed from the database and PayPal's live state right before PayPal is called, refuses a deposit
// this workspace doesn't own (a demo copy's shared template payment), a live PayPal environment without a landlord
// sign-in, PayPal unreachable, an unpaid deposit, a missing written agreement where the state needs one, a statement
// whose own refund hasn't gone yet, and an amount the payment can't cover; and once the whole deposit went back (New
// York's forfeited deductions under a live dispute, refund-rail.ts), it moves no money at all. The close-out's other blockers (a charge
// missing its documents, and the pack's own: Washington's move-in checklist, Florida's claim notice, New York's day 14,
// Texas's forwarding address) limit what a landlord may keep, or when the statement's refund is owed; a settlement
// only gives back more, to tenants who accepted it, and the lawful range already gave those charges back, so they
// don't stop it.
//
// Every attempt carries an idempotency key made by the claim (PayPal-Request-Id for the refund, sender_batch_id for a
// Payout). When PayPal never answered, the settlement stays unconfirmed and can't be renegotiated or paid afresh;
// "Check with PayPal" sends the same request with the same key, so PayPal answers with the first refund if it went
// (PayPal keeps refund keys 45 days and refuses a repeated Payout batch id for 30) or sends it now, once.

export type SettlementRail = "refund_original_payment" | "payout";
export type SettlementPlan =
  | { rail: SettlementRail; amount: number; captureId?: string; email?: string; remaining: number; why: string }
  | { rail: "none"; amount: 0; why: string }
  | { blocked: string };

const cents = (n: number) => Math.round(n * 100) / 100;

type InvoiceWithRefunds = Invoice & {
  payments?: Invoice["payments"] & { paid_amount?: { value?: string } };
  refunds?: { refund_amount?: { value?: string } };
};

/** How the settlement's amount goes back, or why it can't, from the facts as they stand now. */
export async function settlementPlan(tenancyId: string, amount: number): Promise<SettlementPlan> {
  if (amount <= 0) return { rail: "none", amount: 0, why: "The settlement changes what the statement keeps without any money moving: the deposit was used in full." };
  if (!SANDBOX) return { blocked: "This build has no landlord sign-in, so it won't move live money." };
  let state: Awaited<ReturnType<typeof closeOutState>>;
  try {
    state = await closeOutState(tenancyId);
  } catch {
    return { blocked: "No such tenancy." };
  }
  const { facts: f, invoice, workspaceId, pack, payments } = state;
  const inv = payments.find((p) => p.kind === "deposit_invoice");
  if (!f.deposit || !inv?.paypal_id) return { blocked: "No deposit was collected through PayPal for this tenancy, so the settlement can't go back through PayPal." };

  // A demo copy refunds only a sandbox payment of its own: never the template's, which every copy shows.
  const demo = await depositBlock(workspaceId, inv.paypal_id);
  if (demo) return { blocked: demo.replace("send its refund", "send this settlement") };

  if (!f.deposit.live || !invoice) return { blocked: "PayPal couldn't be reached, so nothing was sent. Try again in a minute." };
  if (!wasPaid(f.deposit.status)) return { blocked: `The deposit invoice is ${f.deposit.status.toLowerCase().replace(/_/g, " ")} in PayPal, not paid, so nothing goes back through PayPal.` };
  if (!f.refundAgreement && pack.refund.agreementRequired) return { blocked: pack.refund.noAgreementBlocker };
  // The settlement goes back on top of the statement's refund, so that refund goes first: the amended statement then
  // records two payments that were both sent. Where the deductions are forfeited and a live dispute holds them (New
  // York after day 14), that refund is the whole deposit (refund-rail.ts, refundOwed).
  const owed = refundOwed(f);
  if (owed > 0 && !f.alreadyReturned) {
    return { blocked: `Send the statement's refund of ${usd(owed)} first (Review refund): the settlement goes back on top of it.` };
  }

  // Once the whole deposit went back (the close-out's refund of the whole deposit, when its deductions were forfeited
  // under a live dispute), the settlement has nothing left to send: it records what was agreed and moves no money.
  const back = cents(payments.filter((p) => ["refund", "payout", "settlement_refund", "settlement_payout"].includes(p.kind) && !returnFailed(p.status))
    .reduce((s, p) => s + Number(p.amount), 0));
  if (f.totals.depositHeld - back <= 0.005) {
    return { rail: "none", amount: 0, why: `The whole deposit, ${usd(f.totals.depositHeld)}, already went back to the tenants, so the settlement moves no more money.` };
  }

  // What is left of the payment to refund: PayPal's own count, and ours (the statement's refund and any earlier
  // settlement refund that didn't fail), whichever leaves less.
  const live = invoice as InvoiceWithRefunds;
  const paid = Number(live.payments?.paid_amount?.value ?? inv.amount);
  const refundedByPayPal = Number(live.refunds?.refund_amount?.value ?? 0);
  const refundedByUs = payments.filter((p) => (p.kind === "refund" || p.kind === "settlement_refund") && !returnFailed(p.status))
    .reduce((s, p) => s + Number(p.amount), 0);
  const remaining = cents(paid - Math.max(refundedByPayPal, refundedByUs));

  const c = railFor(f.deposit, f.refundAgreement?.paypalEmail ?? null, { amount, remaining });
  if (c.rail === "refund_original_payment") {
    return { rail: c.rail, amount, captureId: c.captureId, remaining,
      why: `A partial refund of the tenants' original PayPal payment, paid ${paidAgo(c.daysSincePaid)} and inside PayPal's ${REFUND_WINDOW_DAYS}-day window, with ${usd(remaining)} of it left to refund.` };
  }
  if (c.rail === "payout") {
    const to = c.email;
    return { rail: "payout", amount, email: to, remaining,
      why: c.because === "short" ? `Only ${usd(remaining)} of the original payment is left to refund, so it goes out as a Payout to ${to}.`
        : c.because === "other_account" ? `The deposit was paid from another account than the one the tenants named, so it goes out as a Payout to ${to}.`
          : c.because === "no_capture" ? `There's no PayPal payment to refund against, so it goes out as a Payout to ${to}.`
            : c.because === "no_date" ? `PayPal has no payment date for the deposit, so it goes out as a Payout to ${to}.`
              : `The deposit payment is past PayPal's ${REFUND_WINDOW_DAYS}-day refund window, so it goes out as a Payout to ${to}.` };
  }
  return { blocked: c.because === "no_designation" ? pack.refund.noDesignationBlocker
    : `Only ${usd(remaining)} of the original payment is left to refund, and the tenants named no PayPal account for a Payout.` };
}

type RecheckPlan = { rail: SettlementRail; captureId?: string; email?: string } | { blocked: string };

/** For a payment PayPal never confirmed: the same request again, on the rail it went out on. Only what makes the
 *  request at all is checked (the deposit still this workspace's, a sandbox build, the capture or the account to send
 *  it to); not what is left of the payment, since the first attempt may have used it. */
async function recheckPlan(tenancyId: string, rail: SettlementRail | null): Promise<RecheckPlan> {
  if (!SANDBOX) return { blocked: "This build has no landlord sign-in, so it won't move live money." };
  if (!rail) return { blocked: "The earlier attempt has no PayPal rail on record." };
  let state: Awaited<ReturnType<typeof closeOutState>>;
  try {
    state = await closeOutState(tenancyId);
  } catch {
    return { blocked: "No such tenancy." };
  }
  const { facts: f, workspaceId, payments } = state;
  const inv = payments.find((p) => p.kind === "deposit_invoice");
  if (!inv?.paypal_id || !f.deposit) return { blocked: "No deposit was collected through PayPal for this tenancy." };
  const demo = await depositBlock(workspaceId, inv.paypal_id);
  if (demo) return { blocked: demo.replace("send its refund", "send this settlement") };
  if (rail === "refund_original_payment") {
    return f.deposit.captureId ? { rail, captureId: f.deposit.captureId } : { blocked: "PayPal shows no payment to refund against." };
  }
  return f.refundAgreement ? { rail, email: f.refundAgreement.paypalEmail } : { blocked: "The tenants' PayPal account isn't on record any more." };
}

export type PayResult =
  | { ok: true; rail: SettlementRail | null; paypalId: string | null; status: string | null; amount: number }
  | { ok: false; error: string; status: number };

type ClaimedSettlement = {
  id: string; dispute_id: string; tenancy_id: string; amount: number | string; rail: SettlementRail | null; raw: unknown;
  paypal_request_id: string | null; recheck?: boolean;
};

const NOTE = "Settlement of your security deposit dispute, as you accepted it.";

/** PayPal's own create_refund tool, served over MCP in this process like the close-out's: a partial refund of the
 *  capture for exactly the agreed amount, with the claim's idempotency key. Returns the tool's result. */
async function toolkitRefund(o: { captureId: string; amount: number; requestId: string; toolCallId: string }): Promise<unknown> {
  const pp = await connectPayPal({ requestId: o.requestId });
  try {
    const tools = await pp.client.tools();
    const create = tools.create_refund;
    if (!create?.execute) throw new PayPalRefused("PayPal Agent Toolkit didn't expose create_refund");
    return await create.execute({ capture_id: o.captureId, amount: { currency_code: "USD", value: o.amount.toFixed(2) }, note_to_payer: NOTE },
      { toolCallId: o.toolCallId, messages: [], context: {} });
  } finally {
    await pp.close().catch(() => {});
  }
}

/** What paySettlement plans with and calls PayPal through. A test stands them in to drive every path (refused, never
 *  answered, checked again) through the real claim and finish functions without moving money; the app's route always
 *  uses the defaults. */
export type PayDeps = {
  plan?: typeof settlementPlan;
  recheckPlan?: typeof recheckPlan;
  refund?: typeof toolkitRefund;
  payout?: typeof sendPayout;
};

/** "Approve and pay", or "Check with PayPal" for a payment PayPal never confirmed: claim the settlement (once, only
 *  after the tenants accepted), check the rail against the facts as they stand, then send the money and record it, or
 *  record why not. */
export async function paySettlement(tenancyId: string, disputeId: string, deps: PayDeps = {}): Promise<PayResult> {
  const { data: claimed, error: ce } = await db.rpc("claim_settlement", { p_dispute: disputeId });
  if (ce) {
    console.error("settlement claim failed", ce.message);
    return { ok: false, error: "Couldn't start the payment. Try again.", status: 500 };
  }
  if (!claimed) return { ok: false, error: "This settlement isn't waiting on your approval: it is being paid or was paid, or the tenants haven't accepted it yet.", status: 409 };
  const s = claimed as ClaimedSettlement;
  const amount = cents(Number(s.amount));
  const recheck = s.recheck === true;
  const requestId = s.paypal_request_id ?? `settlement-${s.id}`;
  await audit(tenancyId, "landlord", recheck ? "settlement_rechecked" : "settlement_approved", { settlement_id: s.id, amount });

  const finish = async (outcome: "sent" | "refused" | "unknown" | "blocked", o: { rail?: SettlementRail | null; kind?: string | null; paypalId?: string | null; paypalStatus?: string | null; raw?: unknown; error?: string | null } = {}) => {
    const { data, error } = await db.rpc("finish_settlement", {
      p_settlement: s.id, p_outcome: outcome, p_rail: o.rail ?? null, p_kind: o.kind ?? null, p_paypal_id: o.paypalId ?? null,
      p_paypal_status: o.paypalStatus ?? null, p_raw: o.raw ?? null, p_error: o.error ?? null,
    });
    if (error || !data) console.error("settlement finish failed", error?.message ?? "not in sending");
  };
  // A check that couldn't reach a verdict leaves the payment unconfirmed, as it was: never a fresh attempt.
  const stillUnknown = async (rail: SettlementRail | null, error: string, raw?: unknown) => {
    await finish("unknown", { rail, raw: raw ?? s.raw ?? null, error: error.slice(0, 300) });
    await audit(tenancyId, "agent", "settlement_unconfirmed", { settlement_id: s.id, amount, error: error.slice(0, 300) });
  };

  let plan: { rail: SettlementRail; captureId?: string; email?: string };
  if (recheck) {
    const p = await (deps.recheckPlan ?? recheckPlan)(tenancyId, s.rail);
    if ("blocked" in p) {
      await stillUnknown(s.rail, p.blocked);
      return { ok: false, error: `${p.blocked} PayPal wasn't asked again, so the earlier attempt is still unconfirmed.`, status: 409 };
    }
    plan = p;
  } else {
    const p = await (deps.plan ?? settlementPlan)(tenancyId, amount);
    if ("blocked" in p) {
      await finish("blocked", { error: p.blocked });
      await audit(tenancyId, "system", "settlement_blocked", { settlement_id: s.id, amount, reason: p.blocked });
      return { ok: false, error: p.blocked, status: 409 };
    }
    if (p.rail === "none") {
      await finish("sent");
      await audit(tenancyId, "landlord", "settlement_paid", { settlement_id: s.id, amount: 0 });
      return { ok: true, rail: null, paypalId: null, status: null, amount: 0 };
    }
    plan = p;
  }

  // The rail goes on record under this attempt's key before PayPal is called: from here on, an attempt that loses its
  // process is checked with PayPal, never sent afresh; and a process that lost its claim meanwhile (a later claim made
  // a new key) stops here without calling PayPal.
  const { data: marked, error: me } = await db.from("settlements").update({ rail: plan.rail, updated_at: new Date().toISOString() })
    .eq("id", s.id).eq("status", "sending").eq("paypal_request_id", requestId).select("id");
  if (me || !marked?.length) {
    console.error("settlement rail not recorded", me?.message ?? "the claim moved on");
    return { ok: false, error: "The payment couldn't be recorded before PayPal was asked, so nothing was sent. Reload the page and try again in a few minutes.", status: 409 };
  }

  if (plan.rail === "refund_original_payment") {
    let out: unknown;
    try {
      out = await (deps.refund ?? toolkitRefund)({ captureId: plan.captureId!, amount, requestId, toolCallId: `settlement-${s.id}` });
    } catch (e) {
      // Refused before PayPal took the request (the sign-in or the toolkit): nothing was sent. Anything else may have
      // reached PayPal.
      console.error("settlement refund couldn't finish", e);
      const message = e instanceof Error ? e.message.slice(0, 300) : "failed";
      if (e instanceof PayPalRefused && !recheck) {
        await finish("refused", { rail: plan.rail, error: message });
        await audit(tenancyId, "agent", "settlement_failed", { settlement_id: s.id, amount, error: message });
        return { ok: false, error: "PayPal didn't accept the refund. Nothing was sent; you can try again.", status: 502 };
      }
      await stillUnknown(plan.rail, message);
      return { ok: false, error: "PayPal didn't answer, so the refund may or may not have gone. Check with PayPal again in a minute: the same request can't pay twice.", status: 502 };
    }
    const r = mcpJson(out) as ({ id?: string; status?: string; error?: unknown; ok?: boolean; code?: string; message?: string } | null);
    if (r?.id && !r.error && r.status && !returnFailed(r.status)) {
      await finish("sent", { rail: plan.rail, kind: "settlement_refund", paypalId: r.id, paypalStatus: r.status, raw: r });
      await audit(tenancyId, "agent", "settlement_paid", { settlement_id: s.id, amount, refund_id: r.id, status: r.status, capture_id: plan.captureId, rail: plan.rail, rechecked: recheck || undefined });
      return { ok: true, rail: plan.rail, paypalId: r.id, status: r.status, amount };
    }
    const refusedByPayPal = (r?.ok === false && r.code === "PAYPAL_API_HTTP_ERROR") || (!!r?.id && !!r.status && returnFailed(r.status));
    const why = String(r?.message ?? r?.status ?? "No answer").slice(0, 300);
    // On a check, PayPal would have answered with the first refund had it gone; a refusal still isn't taken as proof,
    // so the payment stays unconfirmed and can be checked again with the same key.
    if (refusedByPayPal && !recheck) {
      await finish("refused", { rail: plan.rail, raw: r, error: why });
      await audit(tenancyId, "agent", "settlement_failed", { settlement_id: s.id, amount, error: r?.message ?? r?.status ?? r });
      return { ok: false, status: 502, error: `PayPal didn't accept the refund${r?.message ? `: ${String(r.message).slice(0, 160)}` : ""}. Nothing was sent; you can try again.` };
    }
    await stillUnknown(plan.rail, why, r);
    return { ok: false, status: 502, error: recheck ? `PayPal didn't confirm the refund this time either (${why.slice(0, 120)}). It is still unconfirmed: check the PayPal sandbox, or check again later.`
      : "PayPal didn't confirm the refund, so it may or may not have gone. Check with PayPal again: the same request can't pay twice." };
  }

  // A Payout to the account the tenants named in writing. The batch id is the claim's key, so PayPal never processes a
  // second batch for the same attempt.
  try {
    const p = await (deps.payout ?? sendPayout)({ email: plan.email!, amount, note: NOTE, batchId: requestId });
    await finish("sent", { rail: plan.rail, kind: "settlement_payout", paypalId: p.id, paypalStatus: p.status, raw: p });
    await audit(tenancyId, "agent", "settlement_paid", { settlement_id: s.id, amount, payout_batch_id: p.id, status: p.status, email: plan.email, rail: plan.rail, rechecked: recheck || undefined });
    return { ok: true, rail: plan.rail, paypalId: p.id, status: p.status, amount };
  } catch (e) {
    const message = e instanceof Error ? e.message.slice(0, 300) : "failed";
    // A check's refusal is what PayPal answers when the first batch went (its batch id is taken), so it proves nothing.
    if (e instanceof PayPalRefused && !recheck) {
      await finish("refused", { rail: plan.rail, error: message });
      await audit(tenancyId, "agent", "settlement_failed", { settlement_id: s.id, amount, error: message });
      return { ok: false, status: 502, error: "PayPal didn't accept the Payout. Nothing was sent; you can try again." };
    }
    await stillUnknown(plan.rail, message);
    return { ok: false, status: 502, error: recheck ? "PayPal refused a second batch with the same id, which it does when the first one went. Check the PayPal sandbox before anything else is sent."
      : "PayPal didn't answer, so the Payout may or may not have gone. Check with PayPal again: the same batch can't pay twice." };
  }
}

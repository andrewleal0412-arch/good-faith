import "server-only";
import { createMCPClient, type MCPTransport } from "@ai-sdk/mcp";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { PayPalAgentToolkit } from "@paypal/agent-toolkit/mcp";
import { generateText, isStepCount, tool, type ModelMessage, type ToolSet } from "ai";
import { z } from "zod";
import { closeOutFacts, guardWithFacts } from "./closeout";
import { audit, db } from "./db";
import { e2eStubs } from "./e2e-switch";
import { fakeToolkit } from "./e2e-toolkit";
import { returnFailed } from "./invoice-status";
import { claude } from "./model";
import { accessToken, PayPalRefused, SANDBOX, sendPayout } from "./paypal";
import { statementChecklist } from "./statement";
import { tenancyPack } from "./tenancy-pack";
import type { StatePack } from "./states/types";

// The close-out agent. Claude runs the move-out end to end with PayPal's own Agent Toolkit, served in-process over
// MCP and limited to the four PayPal actions it needs. Amounts, dates and the refund rail come from the rules engine
// (lib/closeout.ts); the agent verifies them with PayPal, moves the money, and explains it. Every money tool waits
// for the landlord's approval, guardRefund re-checks it against the rules before PayPal is called, and the call
// carries an idempotency key from our own records (closeOutRefundKey; a Payout's batch id), so a retry can't pay twice.

/** The close-out agent's instructions under the tenancy's state pack: California's are the original prompt word for
 *  word; each pack names its own statute and checklist, and the citations come only from the facts' "rules". */
export const systemPrompt = (pack: StatePack) => pack.ai.closeOutSystem;

/** PayPal's Agent Toolkit as an MCP server in this process, with only the actions the close-out uses. The dispute's
 *  settlement (src/lib/settlement.ts) sends its refund through the same toolkit, with its own guard (a claim in the
 *  database, then a plan recomputed from the database and PayPal right before the call) and an idempotency key: with
 *  `requestId` every call carries PayPal-Request-Id, so the same request sent again returns the first refund instead
 *  of making a second (PayPal keeps refund keys for 45 days). */
export async function connectPayPal(o: { requestId?: string; disputes?: boolean } = {}) {
  const configuration = {
    // A PayPal dispute's defense (src/lib/chargeback-store.ts) also reads the dispute: list_disputes and get_dispute.
    actions: { invoices: { get: true }, payments: { createRefund: true, getRefunds: true }, ...(o.disputes ? { disputes: { list: true, get: true } } : {}) },
    context: { sandbox: SANDBOX, ...(o.requestId ? { request_id: o.requestId } : {}) },
  };
  // The judges'-path test (src/lib/e2e-switch.ts, never on Render): the same toolkit server, answered by the fake
  // PayPal in this process (src/lib/e2e-toolkit.ts), so no request reaches PayPal.
  const server = e2eStubs() ? fakeToolkit(configuration, o.requestId) : new PayPalAgentToolkit({ accessToken: await accessToken(), configuration });
  const [clientSide, serverSide] = InMemoryTransport.createLinkedPair();
  await server.connect(serverSide);
  const client = await createMCPClient({ transport: clientSide as unknown as MCPTransport, protocolVersionDiscovery: false });
  return { client, close: async () => { await client.close(); await server.close(); } };
}

/** The JSON PayPal returned, out of an MCP tool result ({ content: [{ type: "text", text }] }). */
export function mcpJson(out: unknown): Record<string, unknown> | null {
  const text = (out as { content?: { type: string; text?: string }[] })?.content?.find((c) => c.type === "text")?.text;
  try { return text ? JSON.parse(text) : null; } catch { return null; }
}

/** The close-out refund's idempotency key (PayPal-Request-Id), from our own records: the tenancy, the amount, and how
 *  many earlier attempts PayPal refused outright (refund_failed with `refused` in the audit log; a Payout's refusal,
 *  marked `payout`, is the Payout's own, keyed by its batch id, and doesn't count). A retry after an answer that never
 *  came (a new run with the same plan) is the same request, so PayPal answers with the refund it already made (it
 *  keeps refund keys 45 days) instead of making a second; an attempt after a clear refusal, or with another amount,
 *  is a new request. A refund that went without an answer and a plan that then changed is caught by closeOutState
 *  instead: PayPal's invoice shows a refund the app has no record of, and that blocks the close-out. */
export async function closeOutRefundKey(tenancyId: string, amount: string): Promise<string> {
  const { count } = await db.from("audit_log").select("id", { count: "exact", head: true })
    .eq("tenancy_id", tenancyId).eq("action", "refund_failed").eq("detail->>refused", "true").is("detail->>payout", null);
  const cents = Math.round(Number(amount) * 100);
  return `closeout-${tenancyId}-${cents}${count ? `-r${count}` : ""}`;
}

/** A refund PayPal refused (an error answer, or a refund it made and marked failed), as opposed to one it never
 *  answered, which may have gone. */
const refusedByPayPal = (r: Record<string, unknown> | null) =>
  (r?.ok === false && r.code === "PAYPAL_API_HTTP_ERROR") || (!!r?.id && returnFailed(r.status as string | undefined));

function closeOutTools(tenancyId: string, paypal: ToolSet, pack: StatePack): ToolSet {
  const missing = ["get_invoice", "create_refund", "get_refund"].filter((n) => !paypal[n]);
  if (missing.length) throw new Error(`PayPal Agent Toolkit didn't expose ${missing.join(", ")}`);
  const createRefund = paypal.create_refund;
  return {
    get_close_out_facts: tool({
      description: pack.ai.factsToolDescription,
      inputSchema: z.object({}),
      execute: async () => closeOutFacts(tenancyId),
    }),
    get_statement_checklist: tool({
      description: pack.ai.checklistToolDescription,
      inputSchema: z.object({}),
      execute: async () => statementChecklist(tenancyId),
    }),
    get_invoice: paypal.get_invoice,
    get_refund: paypal.get_refund,
    create_refund: {
      ...createRefund,
      needsApproval: true,
      execute: async (input, options) => {
        const i = input as { capture_id?: string; amount?: { value?: string } };
        const amount = i.amount?.value ?? "";
        // guardRefund, with the facts kept for the note: read fresh from the database and PayPal right now.
        const facts = await closeOutFacts(tenancyId);
        const blocked = guardWithFacts(facts, { rail: "refund_original_payment", amount, captureId: i.capture_id });
        if (blocked) {
          await audit(tenancyId, "system", "refund_blocked", { reason: blocked });
          // Same shape as PayPal's own tool results, so the agent reads it like any other answer.
          return { content: [{ type: "text", text: JSON.stringify({ blocked }) }], isError: true };
        }
        // A refund of the whole deposit carries code's note saying so, whatever the agent wrote (plan.noteToPayer).
        const sent = facts.plan.noteToPayer ? { ...(input as Record<string, unknown>), note_to_payer: facts.plan.noteToPayer } : input;
        // The toolkit's own create_refund, on a connection that sends this refund's idempotency key with the call.
        const requestId = await closeOutRefundKey(tenancyId, amount);
        let out: unknown;
        const keyed = await connectPayPal({ requestId });
        try {
          const create = (await keyed.client.tools()).create_refund;
          if (!create?.execute) throw new PayPalRefused("PayPal Agent Toolkit didn't expose create_refund");
          out = await create.execute(sent, options);
        } catch (e) {
          const refused = e instanceof PayPalRefused;
          await audit(tenancyId, "agent", "refund_failed", { amount: Number(amount), error: String(e).slice(0, 300), request_id: requestId, ...(refused ? { refused: true } : { unconfirmed: true }) });
          throw e;
        } finally {
          await keyed.close().catch(() => {});
        }
        const r = mcpJson(out);
        if (r?.id && !r.error) {
          await db.from("payments").insert({ tenancy_id: tenancyId, kind: "refund", paypal_id: r.id, amount: Number(amount), status: r.status, raw: { ...r, request_id: requestId } });
          await audit(tenancyId, "agent", "refund_sent", { amount: Number(amount), refund_id: r.id, status: r.status, capture_id: i.capture_id });
        } else {
          const refused = refusedByPayPal(r);
          await audit(tenancyId, "agent", "refund_failed", { amount: Number(amount), error: r?.error ?? r, request_id: requestId, ...(refused ? { refused: true } : { unconfirmed: true }) });
        }
        return out;
      },
    },
    send_payout: tool({
      description: "Send the refund as a PayPal Payout to the PayPal email the tenants designated in writing. Use only when the plan's rail is payout. Waits for the landlord's approval.",
      inputSchema: z.object({
        email: z.string().describe("The plan's email"),
        amount: z.string().describe("Exactly the plan's amount with two decimals, e.g. \"1790.00\""),
        note: z.string().max(200).describe("Note to the tenants: the security deposit refund less itemized deductions; the statement follows"),
      }),
      needsApproval: true,
      execute: async ({ email, amount, note }) => {
        const facts = await closeOutFacts(tenancyId);
        const blocked = guardWithFacts(facts, { rail: "payout", amount, email });
        if (blocked) {
          await audit(tenancyId, "system", "refund_blocked", { reason: blocked });
          return { blocked };
        }
        // One batch id per tenancy, as before: PayPal refuses a batch id it has seen in the last 30 days, so a second
        // close-out Payout can't go out whatever happened to the first (and the same id goes as PayPal-Request-Id).
        let p: Awaited<ReturnType<typeof sendPayout>>;
        try {
          p = await sendPayout({ email, amount: Number(amount), note: facts.plan.noteToPayer ?? note, batchId: `deposit-${tenancyId}` });
        } catch (e) {
          await audit(tenancyId, "agent", "refund_failed", { amount: Number(amount), error: String(e).slice(0, 300), payout: true, ...(e instanceof PayPalRefused ? { refused: true } : { unconfirmed: true }) });
          throw e;
        }
        await db.from("payments").insert({ tenancy_id: tenancyId, kind: "payout", paypal_id: p.id, amount: Number(amount), status: p.status, raw: p });
        await audit(tenancyId, "agent", "refund_sent", { amount: Number(amount), payout_batch_id: p.id, status: p.status, email });
        return p;
      },
    }),
  };
}

export type Pending = { approvalId: string; toolCallId: string; toolName: string; input: Record<string, unknown> };

/** Run the model until it finishes or asks for approval, then save the whole conversation on the run. */
async function advance(runId: string, tenancyId: string, messages: ModelMessage[]) {
  const pack = await tenancyPack(tenancyId);
  const pp = await connectPayPal();
  try {
    const result = await generateText({
      model: claude("close_out"),
      system: systemPrompt(pack),
      messages,
      tools: closeOutTools(tenancyId, await pp.client.tools(), pack),
      stopWhen: isStepCount(12),
    });
    const all = [...messages, ...result.responseMessages];
    const req = result.content.find((p) => p.type === "tool-approval-request");
    const pending: Pending | null = req
      ? { approvalId: req.approvalId, toolCallId: req.toolCall.toolCallId, toolName: req.toolCall.toolName, input: req.toolCall.input as Record<string, unknown> }
      : null;
    await db.from("agent_runs").update({
      messages: all, pending, status: pending ? "awaiting_approval" : "done", updated_at: new Date().toISOString(),
    }).eq("id", runId);
    if (pending) {
      const amt = pending.toolName === "create_refund" ? (pending.input.amount as { value?: string })?.value : pending.input.amount;
      await audit(tenancyId, "agent", "refund_proposed", { run_id: runId, tool: pending.toolName, amount: Number(amt) });
    } else {
      await audit(tenancyId, "agent", "close_out_finished", { run_id: runId });
    }
    return { status: pending ? "awaiting_approval" : "done" };
  } catch (e) {
    console.error("close-out run failed", e);
    // The run's page shows this sentence; the error itself is in the log.
    const error = e instanceof PayPalRefused && e.status
      ? `PayPal refused a request (HTTP ${e.status}), so nothing more was sent. Run the close-out again.`
      : "The agent stopped before it finished. Run the close-out again.";
    await db.from("agent_runs").update({ status: "failed", error, updated_at: new Date().toISOString() }).eq("id", runId);
    return { status: "failed", error };
  } finally {
    await pp.close().catch(() => {});
  }
}

/** An error whose message is written for the landlord: the routes show it as it is. Any other error is logged, and the
 *  page gets a plain sentence instead (a PayPal or Claude error carries API paths and response bodies). */
export class Shown extends Error {}

/** The landlord pages sit behind a shared demo access code (src/proxy.ts), and each visitor works in a private copy
 *  of the demo, but that is not a landlord's own login. Until there is one, the agent moves sandbox money only: a LIVE
 *  PayPal environment is refused here, before a run exists. */
export function refuseLiveWithoutSignIn() {
  if (!SANDBOX) throw new Shown("This build has no landlord sign-in, so it won't move live money. Set PAYPAL_ENVIRONMENT=SANDBOX (docs/DEPLOY.md).");
}

export async function startCloseOut(tenancyId: string) {
  refuseLiveWithoutSignIn();
  const { data: run, error } = await db.from("agent_runs").insert({ tenancy_id: tenancyId, kind: "close_out", status: "running" }).select("id").single();
  if (error || !run) {
    // The close-out route answers with this message, so the database's own words stay in the log.
    console.error("agent run insert failed", error?.message);
    throw new Shown("The agent couldn't start. Try again.");
  }
  await audit(tenancyId, "agent", "close_out_started", { run_id: run.id });
  const messages: ModelMessage[] = [{ role: "user", content: "Close out the security deposit for this tenancy." }];
  return { runId: run.id as string, ...(await advance(run.id, tenancyId, messages)) };
}

/** The landlord's answer to a pending money movement. The run resumes either way; on a decline nothing moves. */
export async function answerApproval(tenancyId: string, runId: string, approved: boolean) {
  refuseLiveWithoutSignIn();
  const { data: run } = await db.from("agent_runs").select("*").eq("id", runId).eq("tenancy_id", tenancyId).single();
  if (!run) throw new Shown("No such run.");
  const pending = run.pending as Pending | null;
  if (run.status !== "awaiting_approval" || !pending) throw new Shown("Nothing is waiting for approval.");
  // Claim the approval atomically, so a double click can't resume the run twice.
  const { data: claimed } = await db.from("agent_runs").update({ status: "running", pending: null, updated_at: new Date().toISOString() })
    .eq("id", runId).eq("status", "awaiting_approval").select("id");
  if (!claimed?.length) throw new Shown("That was already answered.");
  const amt = pending.toolName === "create_refund" ? (pending.input.amount as { value?: string })?.value : pending.input.amount;
  await audit(tenancyId, "landlord", approved ? "refund_approved" : "refund_declined", { run_id: runId, amount: Number(amt), tool: pending.toolName });
  const messages: ModelMessage[] = [...(run.messages as ModelMessage[]), {
    role: "tool",
    content: [{ type: "tool-approval-response", approvalId: pending.approvalId, approved, ...(approved ? {} : { reason: "The landlord declined." }) }],
  }];
  return advance(runId, tenancyId, messages);
}

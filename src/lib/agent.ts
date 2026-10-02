import "server-only";
import { anthropic } from "@ai-sdk/anthropic";
import { createMCPClient, type MCPTransport } from "@ai-sdk/mcp";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { PayPalAgentToolkit } from "@paypal/agent-toolkit/mcp";
import { generateText, isStepCount, tool, type ModelMessage, type ToolSet } from "ai";
import { z } from "zod";
import { closeOutFacts, guardRefund } from "./closeout";
import { audit, db } from "./db";
import { accessToken, SANDBOX, sendPayout } from "./paypal";
import { statementChecklist } from "./statement";

// The close-out agent. Claude runs the move-out end to end with PayPal's own Agent Toolkit, served in-process over
// MCP and limited to the four PayPal actions it needs. Amounts, dates and the refund rail come from the rules engine
// (lib/closeout.ts); the agent verifies them with PayPal, moves the money, and explains it. Every money tool waits
// for the landlord's approval, and guardRefund re-checks it against the rules before PayPal is called.

const MODEL = process.env.ANTHROPIC_MODEL ?? "claude-opus-5-5";

const SYSTEM = `You are the close-out agent in Good Faith, which helps small California landlords return security deposits correctly. You work for the landlord and you are fair to the tenant.

For this move-out:
1. Call get_close_out_facts. It comes from the rules engine and is authoritative for amounts, dates and the refund plan.
2. If it lists blockers, stop: in two or three sentences, tell the landlord what's blocking and what to do next. Don't call any PayPal tool. One exception: when the only blocker is that the deposit was already returned, the money is done, so skip to step 6.
3. Confirm the deposit with PayPal: call get_invoice for the deposit invoice and check that it is PAID and that its transaction id matches the facts.
4. Return the money on the plan's rail, for exactly the plan's amount:
   - refund_original_payment: call create_refund with capture_id set to the plan's captureId, amount {"currency_code": "USD", "value": the amount with two decimals}, invoice_id set to the deposit invoice id, and a note_to_payer under 200 characters saying this is the security deposit refund less itemized deductions and that the itemized statement follows.
   - payout: call send_payout to the plan's email.
   - nothing_to_refund: don't move any money.
   The landlord approves every money movement before it runs. Call a money tool once, and never retry it with a different amount.
5. After a refund goes through, call get_refund to confirm its status.
6. Call get_statement_checklist. It grades the itemized statement against the 13 items the rules spec asks for, says what is still missing, and whether its delivery was recorded.
7. Finish with a short summary for the landlord: what was returned and how, the deductions, the statement deadline, and what the statement still needs before it is delivered (the checklist's stillMissing, in plain words). If nothing is missing, say the statement is complete and ready to deliver by the deadline. The landlord opens the statement with the "Open the itemized statement" button on this page, so never quote a path or link. Give every date as a full date, such as October 1, 2026, never "today" or "yesterday".

Before each tool call, say in one short sentence what you're about to check or do. Your text is shown as plain text, so write plain sentences for a non-lawyer with no markdown at all: no asterisks, no headings, no numbered or bulleted lists, no emojis. Keep the final summary to one or two short paragraphs.

Cite only the citations in the facts' "rules", word for word, and only where they apply. Never cite a code section from memory. Don't give legal advice beyond those rules. If a tool returns an error or says "Blocked", explain it to the landlord and stop.`;

/** PayPal's Agent Toolkit as an MCP server in this process, with only the actions the close-out uses. */
async function connectPayPal() {
  const server = new PayPalAgentToolkit({
    accessToken: await accessToken(),
    configuration: {
      actions: { invoices: { get: true }, payments: { createRefund: true, getRefunds: true } },
      context: { sandbox: SANDBOX },
    },
  });
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

function closeOutTools(tenancyId: string, paypal: ToolSet): ToolSet {
  const missing = ["get_invoice", "create_refund", "get_refund"].filter((n) => !paypal[n]);
  if (missing.length) throw new Error(`PayPal Agent Toolkit didn't expose ${missing.join(", ")}`);
  const createRefund = paypal.create_refund;
  return {
    get_close_out_facts: tool({
      description: "The tenancy's close-out file from the rules engine: move-out date and 21-day deadline, the deposit as PayPal reports it, the tenants' written refund agreement, every deduction with its math and any missing documents, totals, blockers, warnings, and the refund plan the rules allow (rail, amount, and the capture id or email). Call this first.",
      inputSchema: z.object({}),
      execute: async () => closeOutFacts(tenancyId),
    }),
    get_statement_checklist: tool({
      description: "The itemized statement's completeness: the 13 items of the rules spec's checklist (Civ. Code 1950.5(h), local deposit-interest ordinances and DRE guidance), each done, missing or not applicable with a one-line reason, what is still missing, and whether delivery was recorded. Read-only; call it after the refund, or when the deposit was already returned.",
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
        const blocked = await guardRefund(tenancyId, { rail: "refund_original_payment", amount, captureId: i.capture_id });
        if (blocked) {
          await audit(tenancyId, "system", "refund_blocked", { reason: blocked });
          // Same shape as PayPal's own tool results, so the agent reads it like any other answer.
          return { content: [{ type: "text", text: JSON.stringify({ blocked }) }], isError: true };
        }
        const out = await createRefund.execute!(input, options);
        const r = mcpJson(out);
        if (r?.id && !r.error) {
          await db.from("payments").insert({ tenancy_id: tenancyId, kind: "refund", paypal_id: r.id, amount: Number(amount), status: r.status, raw: r });
          await audit(tenancyId, "agent", "refund_sent", { amount: Number(amount), refund_id: r.id, status: r.status, capture_id: i.capture_id });
        } else {
          await audit(tenancyId, "agent", "refund_failed", { amount: Number(amount), error: r?.error ?? r });
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
        const blocked = await guardRefund(tenancyId, { rail: "payout", amount, email });
        if (blocked) {
          await audit(tenancyId, "system", "refund_blocked", { reason: blocked });
          return { blocked };
        }
        const p = await sendPayout({ email, amount: Number(amount), note, batchId: `deposit-${tenancyId}` });
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
  const pp = await connectPayPal();
  try {
    const result = await generateText({
      model: anthropic(MODEL),
      system: SYSTEM,
      messages,
      tools: closeOutTools(tenancyId, await pp.client.tools()),
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
    const error = e instanceof Error ? e.message : String(e);
    await db.from("agent_runs").update({ status: "failed", error, updated_at: new Date().toISOString() }).eq("id", runId);
    return { status: "failed", error };
  } finally {
    await pp.close().catch(() => {});
  }
}

/** The landlord pages have no sign-in yet, so the routes that start and approve a close-out accept any caller. Until
 *  there is one, the agent moves sandbox money only: a LIVE PayPal environment is refused here, before a run exists. */
function refuseLiveWithoutSignIn() {
  if (!SANDBOX) throw new Error("This build has no landlord sign-in, so it won't move live money. Set PAYPAL_ENVIRONMENT=SANDBOX (docs/DEPLOY.md).");
}

export async function startCloseOut(tenancyId: string) {
  refuseLiveWithoutSignIn();
  const { data: run, error } = await db.from("agent_runs").insert({ tenancy_id: tenancyId, kind: "close_out", status: "running" }).select("id").single();
  if (error || !run) throw new Error(error?.message ?? "couldn't start the run");
  await audit(tenancyId, "agent", "close_out_started", { run_id: run.id });
  const messages: ModelMessage[] = [{ role: "user", content: "Close out the security deposit for this tenancy." }];
  return { runId: run.id as string, ...(await advance(run.id, tenancyId, messages)) };
}

/** The landlord's answer to a pending money movement. The run resumes either way; on a decline nothing moves. */
export async function answerApproval(tenancyId: string, runId: string, approved: boolean) {
  refuseLiveWithoutSignIn();
  const { data: run } = await db.from("agent_runs").select("*").eq("id", runId).eq("tenancy_id", tenancyId).single();
  if (!run) throw new Error("No such run.");
  const pending = run.pending as Pending | null;
  if (run.status !== "awaiting_approval" || !pending) throw new Error("Nothing is waiting for approval.");
  // Claim the approval atomically, so a double click can't resume the run twice.
  const { data: claimed } = await db.from("agent_runs").update({ status: "running", pending: null, updated_at: new Date().toISOString() })
    .eq("id", runId).eq("status", "awaiting_approval").select("id");
  if (!claimed?.length) throw new Error("That was already answered.");
  const amt = pending.toolName === "create_refund" ? (pending.input.amount as { value?: string })?.value : pending.input.amount;
  await audit(tenancyId, "landlord", approved ? "refund_approved" : "refund_declined", { run_id: runId, amount: Number(amt), tool: pending.toolName });
  const messages: ModelMessage[] = [...(run.messages as ModelMessage[]), {
    role: "tool",
    content: [{ type: "tool-approval-response", approvalId: pending.approvalId, approved, ...(approved ? {} : { reason: "The landlord declined." }) }],
  }];
  return advance(runId, tenancyId, messages);
}

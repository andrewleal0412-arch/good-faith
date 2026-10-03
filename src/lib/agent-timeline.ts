// Turns a stored agent conversation into what the landlord sees: the agent's own sentences, and one row per tool call
// with a plain-English title and PayPal's answer. Pure, so it runs on the server page without the model.

import { usd } from "./deductions";

export type TimelineItem =
  | { kind: "say"; text: string }
  | { kind: "step"; id: string; tool: string; title: string; detail: string; state: "ok" | "error" | "waiting" | "declined" };

type Part = { type: string; text?: string; toolCallId?: string; toolName?: string; input?: Record<string, unknown>;
  output?: { type: string; value?: unknown }; approvalId?: string; approved?: boolean };
type Message = { role: string; content: string | Part[] };

/** Whatever JSON a tool returned: our tools give it directly, PayPal's MCP tools as text content. */
function json(output: Part["output"]): Record<string, unknown> | null {
  if (!output) return null;
  const parse = (t?: string) => { try { return t ? JSON.parse(t) : null; } catch { return { text: t }; } };
  const v = output.value as { content?: { type: string; text?: string }[] } | string | undefined;
  if (output.type === "content" && Array.isArray(output.value)) return parse((output.value as { text?: string }[]).find((c) => c.text)?.text);
  if (typeof v === "object" && v?.content) return parse(v.content.find((c) => c.type === "text")?.text);
  if (typeof v === "object" && v) return v as Record<string, unknown>;
  if (typeof v === "string") return output.type.startsWith("error") ? { error: v } : parse(v);
  return null;
}

const longDate = (iso?: string | null) =>
  iso ? new Date(`${iso.slice(0, 10)}T12:00:00Z`).toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric", timeZone: "UTC" }) : "--";

function title(tool: string, input: Record<string, unknown>): string {
  switch (tool) {
    case "get_close_out_facts": return "Read the close-out file";
    case "get_invoice": return "Checked the deposit with PayPal";
    case "create_refund": return `Refund ${usd(Number((input.amount as { value?: string })?.value))} against the tenants' PayPal payment`;
    case "get_refund": return "Confirmed the refund with PayPal";
    case "send_payout": return `Send ${usd(Number(input.amount))} by PayPal Payout to ${input.email}`;
    case "get_statement_checklist": return "Checked the itemized statement";
    default: return tool.replace(/_/g, " ");
  }
}

function detail(tool: string, out: Record<string, unknown> | null): { text: string; error: boolean } {
  if (!out) return { text: "", error: false };
  if (out.blocked) return { text: String(out.blocked), error: true };
  if (out.error) return { text: `PayPal error: ${typeof out.error === "string" ? out.error : JSON.stringify(out.error).slice(0, 200)}`, error: true };
  switch (tool) {
    case "get_close_out_facts": {
      const f = out as { blockers?: string[]; totals?: { depositHeld: number; deductions: number; refund: number }; tenancy?: { statementDue?: string } };
      if (f.blockers?.length) return { text: f.blockers.join(" "), error: true };
      return { text: `Deposit ${usd(f.totals!.depositHeld)}, deductions ${usd(f.totals!.deductions)}, refund ${usd(f.totals!.refund)}. Statement due ${longDate(f.tenancy?.statementDue)}.`, error: false };
    }
    case "get_invoice": {
      const i = out as { id?: string; status?: string; payments?: { paid_amount?: { value?: string }; transactions?: { payment_id?: string; payment_date?: string }[] } };
      const t = i.payments?.transactions?.[0];
      return { text: `${i.id}: ${i.status}${i.payments?.paid_amount?.value ? `, ${usd(Number(i.payments.paid_amount.value))} paid` : ""}${t?.payment_date ? ` ${longDate(t.payment_date)}` : ""}${t?.payment_id ? ` (payment ${t.payment_id})` : ""}`, error: false };
    }
    case "create_refund":
    case "get_refund": {
      const r = out as { id?: string; status?: string };
      return { text: `PayPal refund ${r.id}: ${r.status}`, error: r.status !== "COMPLETED" && r.status !== "PENDING" };
    }
    case "send_payout": {
      const p = out as { id?: string; status?: string };
      return { text: `Payout batch ${p.id}: ${p.status}`, error: false };
    }
    case "get_statement_checklist": {
      const c = out as { checklist?: { state: string }[]; stillMissing?: string[] };
      const applicable = c.checklist?.filter((i) => i.state !== "not_applicable").length ?? 0;
      const done = c.checklist?.filter((i) => i.state === "done").length ?? 0;
      return c.stillMissing?.length
        ? { text: `${done} of ${applicable} items done. Still missing: ${c.stillMissing.join(" ")}`, error: false }
        : { text: `All ${applicable} items that apply are done.`, error: false };
    }
    default: return { text: JSON.stringify(out).slice(0, 160), error: false };
  }
}

export function timeline(messages: Message[]): TimelineItem[] {
  const items: TimelineItem[] = [];
  const steps = new Map<string, Extract<TimelineItem, { kind: "step" }>>();
  const approvalToCall = new Map<string, string>();
  for (const m of messages) {
    if (m.role === "user" || typeof m.content === "string") continue;
    for (const p of m.content) {
      // Shown as plain text; drop any stray markdown emphasis.
      if (p.type === "text" && p.text?.trim() && m.role === "assistant") items.push({ kind: "say", text: p.text.trim().replace(/\*\*(.+?)\*\*/g, "$1") });
      else if (p.type === "tool-call" && p.toolCallId && p.toolName) {
        const s = { kind: "step" as const, id: p.toolCallId, tool: p.toolName, title: title(p.toolName, p.input ?? {}), detail: "", state: "ok" as const };
        steps.set(p.toolCallId, s);
        items.push(s);
      } else if (p.type === "tool-approval-request" && p.approvalId && p.toolCallId) {
        approvalToCall.set(p.approvalId, p.toolCallId);
        const s = steps.get(p.toolCallId);
        if (s) Object.assign(s, { state: "waiting", detail: "Waiting for your approval" });
      } else if (p.type === "tool-approval-response" && p.approvalId) {
        const s = steps.get(approvalToCall.get(p.approvalId) ?? "");
        if (s) Object.assign(s, p.approved ? { state: "ok", detail: "Approved by you" } : { state: "declined", detail: "You declined. Nothing was sent." });
      } else if (p.type === "tool-result" && p.toolCallId) {
        const s = steps.get(p.toolCallId);
        if (!s) continue;
        const d = detail(s.tool, json(p.output));
        if (p.output?.type === "execution-denied") Object.assign(s, { state: "declined", detail: "You declined. Nothing was sent." });
        else Object.assign(s, { state: d.error ? "error" : "ok", detail: d.text || s.detail });
      }
    }
  }
  return items.map((i) => (i.kind === "step" ? { kind: "step", id: i.id, tool: i.tool, title: i.title, detail: i.detail, state: i.state } : i));
}

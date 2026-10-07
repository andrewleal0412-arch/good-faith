import "server-only";
import { randomUUID } from "node:crypto";
import type { LanguageModel } from "ai";
import { MockLanguageModelV4 } from "ai/test";
import { e2eLog } from "./e2e-switch";

// The scripted models behind every Claude job while the e2e stubs are on (src/lib/e2e-switch.ts; never on Render):
// the AI SDK's MockLanguageModelV4, the same stub the check scripts use, answering as the demo's agents do, through
// the app's real tools and the code's real checks. Each answer is worked out from what the job was given (the tool
// results, the prompt), never from the database, so the code still decides every amount: the close-out agent
// proposes the plan's own refund, the advocate asks for half of each disputed charge back inside its lawful range,
// and the two negotiators meet in the middle (on the demo's carpet: $600 kept, then $450, $270 back, the same story
// as the closed unit's recorded settlement, scripts/demo-history.mjs). The lease check answers with the facts Claude
// read from demo/lease-single-owner.pdf for the demo's move-out unit, and refuses any other file. The jobs off the
// demo's path (the photo inspection, the PayPal dispute's defense) refuse, so nothing unscripted ever answers.

export type ClaudeJob = "lease" | "inspect" | "close_out" | "advocate" | "negotiator" | "chargeback";

type Part = { type: string; text?: string; toolName?: string; toolCallId?: string; output?: { type: string; value?: unknown; reason?: string }; filename?: string };
type Msg = { role: string; content: string | Part[] };
type CallOptions = { prompt: Msg[] };

const usage = { inputTokens: { total: 0, noCache: 0, cacheRead: undefined, cacheWrite: undefined }, outputTokens: { total: 0, text: 0, reasoning: undefined } };
const answer = (text: string) => ({ content: [{ type: "text" as const, text }], finishReason: { unified: "stop" as const, raw: undefined }, usage, warnings: [] });
const callTools = (...calls: { name: string; input?: Record<string, unknown> }[]) => ({
  content: calls.map((c) => ({ type: "tool-call" as const, toolCallId: `e2e-${c.name}-${randomUUID().slice(0, 8)}`, toolName: c.name, input: JSON.stringify(c.input ?? {}) })),
  finishReason: { unified: "tool-calls" as const, raw: undefined }, usage, warnings: [],
});

const tryJson = (t: unknown): unknown => {
  if (typeof t !== "string") return t;
  try { return JSON.parse(t); } catch { return { text: t }; }
};

/** A tool's answer as the model was shown it: our own tools' JSON, PayPal's MCP tools' text content, a denial. */
function readOutput(o: Part["output"]): Record<string, unknown> {
  if (!o) return {};
  if (o.type === "execution-denied") return { denied: true, reason: o.reason ?? null };
  if (o.type === "error-text" || o.type === "error-json") return { error: o.value };
  if (o.type === "content" && Array.isArray(o.value)) return (tryJson((o.value as Part[]).find((p) => p.type === "text")?.text) ?? {}) as Record<string, unknown>;
  const v = o.type === "text" ? tryJson(o.value) : o.value;
  const mcp = v as { content?: Part[]; isError?: boolean } | null;
  if (mcp && Array.isArray(mcp.content)) return { ...(tryJson(mcp.content.find((p) => p.type === "text")?.text) as Record<string, unknown>), ...(mcp.isError ? { isError: true } : {}) };
  return (v ?? {}) as Record<string, unknown>;
}

/** Every tool result in the conversation so far, by tool name, latest last. */
function results(prompt: Msg[]): Map<string, Record<string, unknown>[]> {
  const out = new Map<string, Record<string, unknown>[]>();
  for (const m of prompt) {
    if (m.role !== "tool" || typeof m.content === "string") continue;
    for (const p of m.content) {
      if (p.type !== "tool-result" || !p.toolName) continue;
      out.set(p.toolName, [...(out.get(p.toolName) ?? []), readOutput(p.output)]);
    }
  }
  return out;
}
const last = (r: Map<string, Record<string, unknown>[]>, name: string) => r.get(name)?.at(-1) ?? null;
const systemText = (prompt: Msg[]) => prompt.filter((m) => m.role === "system").map((m) => (typeof m.content === "string" ? m.content : "")).join("\n");
const userText = (prompt: Msg[]) => prompt.filter((m) => m.role === "user").flatMap((m) => (typeof m.content === "string" ? [m.content] : m.content.filter((p) => p.type === "text").map((p) => p.text ?? ""))).join("\n");

const cents = (n: number) => Math.round(n * 100) / 100;
const usd = (n: number) => `$${n.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
const money = (s: string) => Number(s.replace(/,/g, ""));
const clamp = (x: number, lo: number, hi: number) => Math.min(Math.max(x, lo), hi);

/* ---------- The lease check ---------- */

/** What Claude read from demo/lease-single-owner.pdf (the demo's move-out unit's stored lease_terms), with the two
 *  fields added since. */
const DEMO_LEASE = {
  propertyAddress: "1140 E. Juniper Hollow Ln, Orange, CA 92867",
  city: "Orange",
  state: "CA",
  landlordName: "Elena Marquez",
  ownerType: "natural_person",
  ownerPropertyCount: 1,
  ownerUnitCount: 1,
  buildingUnitCount: null,
  tenants: ["Priya Raman", "Daniel Okafor"],
  tenancyStartDate: "2025-10-01",
  leaseEndDate: "2026-09-30",
  monthlyRent: 2400,
  securityDeposit: 4800,
  otherMoveInCharges: [{
    label: "Cleaning fee", amount: 300, refundable: false,
    quote: "Tenant shall also pay a nonrefundable cleaning fee of $300.00, which covers professional cleaning at the end of the tenancy and will not be returned.",
  }],
  nonrefundableLanguage: ["Tenant shall also pay a nonrefundable cleaning fee of $300.00, which covers professional cleaning at the end of the tenancy and will not be returned."],
  lateFee: {
    amount: 120, percentOfRent: 5, deductibleFromDeposit: true,
    quote: "If rent is not received by the 5th day of the month, Tenant shall pay a late charge of $120.00 (5% of the monthly rent), which Landlord may deduct from the security deposit.",
  },
  mandatoryCleaningClause: "Tenant shall also pay a nonrefundable cleaning fee of $300.00, which covers professional cleaning at the end of the tenancy and will not be returned.",
  electronicPaymentMethods: ["PayPal", "Zelle"],
  tenantIsServiceMember: null,
};
export const DEMO_LEASE_FILE = "lease-single-owner.pdf";

function lease(o: CallOptions) {
  const files = o.prompt.flatMap((m) => (typeof m.content === "string" ? [] : m.content.filter((p) => p.type === "file")));
  const name = files[0]?.filename ?? "";
  if (name !== DEMO_LEASE_FILE) throw new Error(`The e2e stub reads only demo/${DEMO_LEASE_FILE}, not "${name.slice(0, 80)}".`);
  return answer(JSON.stringify(DEMO_LEASE));
}

/* ---------- The close-out agent ---------- */

type Facts = { plan?: { rail?: string; amount?: number; captureId?: string; email?: string; noteToPayer?: string; why?: string }; deposit?: { invoiceId?: string } | null; blockers?: string[] };

function closeOut(o: CallOptions) {
  const r = results(o.prompt);
  const facts = last(r, "get_close_out_facts") as Facts | null;
  if (!facts) return callTools({ name: "get_close_out_facts" });
  const plan = facts.plan ?? {};
  if (plan.rail !== "refund_original_payment" && plan.rail !== "payout") {
    return answer(`Nothing goes back through PayPal yet. ${plan.why ?? ""} ${(facts.blockers ?? []).join(" ")}`.trim());
  }
  if (!last(r, "get_invoice") && facts.deposit?.invoiceId) return callTools({ name: "get_invoice", input: { invoice_id: facts.deposit.invoiceId } });
  const amount = Number(plan.amount ?? 0).toFixed(2);
  const moneyTool = plan.rail === "payout" ? "send_payout" : "create_refund";
  const sent = last(r, moneyTool);
  if (!sent) {
    return plan.rail === "payout"
      ? callTools({ name: "send_payout", input: { email: plan.email, amount, note: "Your security deposit refund less itemized deductions. The itemized statement follows." } })
      : callTools({ name: "create_refund", input: { capture_id: plan.captureId, amount: { currency_code: "USD", value: amount }, ...(facts.deposit?.invoiceId ? { invoice_id: facts.deposit.invoiceId } : {}), note_to_payer: "Your security deposit refund less itemized deductions. The itemized statement follows." } });
  }
  if (sent.denied) return answer("You declined the refund, so nothing was sent. The plan stays on file for when you're ready.");
  if (sent.blocked || sent.error || sent.ok === false) return answer(`The refund didn't go: ${String(sent.blocked ?? sent.message ?? JSON.stringify(sent.error)).slice(0, 300)}`);
  if (moneyTool === "create_refund" && sent.id && !last(r, "get_refund")) return callTools({ name: "get_refund", input: { refund_id: sent.id } });
  if (!last(r, "get_statement_checklist")) return callTools({ name: "get_statement_checklist" });
  return answer(`The ${usd(Number(amount))} refund went back through PayPal and PayPal confirmed it. Next, deliver the itemized statement and record how it went out.`);
}

/* ---------- The tenants' advocate ---------- */

type StatementLine = { line: number; title: string; amount: number; disputed: boolean };
type DeductionLine = { line: number; title: string; lawfulRange: { min: number; max: number; standing: string; citations: string[] } };

function advocate(o: CallOptions) {
  const r = results(o.prompt);
  const statement = last(r, "read_statement") as { lines?: StatementLine[] } | null;
  const deductions = last(r, "read_deductions") as { lines?: DeductionLine[] } | null;
  if (!statement || !deductions) return callTools({ name: "read_statement" }, { name: "read_deductions" }, { name: "read_rules" });
  const disputed = (statement.lines ?? []).filter((l) => l.disputed);
  // The photos of every disputed line, once, before judging it (the system prompt asks for that).
  if (disputed.length && !r.has("view_photos")) return callTools(...disputed.map((l) => ({ name: "view_photos", input: { line: l.line } })));
  const lines = (deductions.lines ?? []).map((d) => {
    const s = (statement.lines ?? []).find((x) => x.line === d.line);
    const range = d.lawfulRange;
    const citation = range.citations[0] ?? "";
    if (range.standing === "unlawful" || range.standing === "unsupported") {
      return { line: d.line, verdict: range.standing, keep: 0, citation, reason: "The code found nothing the landlord may keep of this charge, so the case asks for all of it back." };
    }
    if (!s?.disputed) return { line: d.line, verdict: "solid", keep: range.max, citation, reason: "Not one you disputed. The documents on file support it as charged." };
    const keep = clamp(Math.round(range.max / 2), range.min, range.max);
    return { line: d.line, verdict: "weak", keep, citation,
      reason: "The photo comparison suggested a cheaper fix, and nothing on file says it was tried first. The charge is already prorated, so the case asks for half of it back." };
  });
  const back = lines.reduce((sum, l) => {
    const d = (statement.lines ?? []).find((x) => x.line === l.line);
    return sum + (d ? d.amount - l.keep : 0);
  }, 0);
  return answer(JSON.stringify({
    lines,
    summary: `Your strongest point is the charge you disputed: the record leaves a question about it. The other charges are documented, so the case leaves them as charged. It proposes ${usd(cents(back))} back.`,
  }));
}

/* ---------- The two negotiators ---------- */

type NegLine = { n: number; title: string; min: number; max: number; cite: string };

function figures(text: string, label: string): Map<number, number> {
  const row = text.match(new RegExp(`^${label}: (.+)$`, "m"))?.[1] ?? "";
  return new Map([...row.matchAll(/line (\d+) \$([\d,]+\.\d\d)/g)].map((m) => [Number(m[1]), money(m[2])]));
}

function negotiationLines(text: string): NegLine[] {
  const allowed = (text.match(/^Citations you may use: (.+)$/m)?.[1] ?? "").split(" | ").filter(Boolean);
  const blocks = text.split(/\n(?=Line \d+\. )/).filter((b) => /^Line \d+\. /.test(b));
  return blocks.map((b) => {
    const head = b.match(/^Line (\d+)\. (.+?): charged \$([\d,]+\.\d\d)\./)!;
    const range = b.match(/Lawful range: \$([\d,]+\.\d\d) to \$([\d,]+\.\d\d)/);
    const cites = b.match(/Cites: (.+)$/m)?.[1] ?? "";
    // The first citation of the line's own list that is on the allowed list, the longest where one contains another.
    const cite = allowed.filter((c) => cites.includes(c)).sort((x, y) => cites.indexOf(x) - cites.indexOf(y) || y.length - x.length)[0] ?? allowed[0] ?? "";
    return { n: Number(head[1]), title: head[2], min: range ? money(range[1]) : 0, max: range ? money(range[2]) : money(head[3]), cite };
  });
}

function negotiator(o: CallOptions) {
  const landlord = /You are the landlord's negotiator/.test(systemText(o.prompt));
  const text = userText(o.prompt);
  const lines = negotiationLines(text);
  if (!lines.length) throw new Error("The e2e negotiator stub couldn't read the charges in its prompt.");
  const own = figures(text, "Your last figures"), other = figures(text, "The other side's last figures");
  const first = /\(the statement as charged, capped at each max\)/.test(text);
  const out = lines.map((l) => {
    const mine = own.get(l.n) ?? l.max, theirs = other.get(l.n) ?? mine;
    if (Math.abs(mine - theirs) < 0.005) return { line: l.n, move: "hold", keep: mine, citation: l.cite, reason: landlord ? "Documented as charged and agreed." : "Not disputed." };
    const lo = Math.min(mine, theirs), hi = Math.max(mine, theirs);
    if (landlord && first) {
      const keep = clamp(Math.round((mine - (mine - theirs) / 3) / 10) * 10, lo, hi);
      return { line: l.n, move: "counter", keep, citation: l.cite, reason: "The photos and the invoice support most of this charge. The record leaves one question, so part of it is given back." };
    }
    if (landlord) return { line: l.n, move: "concede", keep: theirs, citation: l.cite, reason: "The record leaves that question open, so meeting here is fair to both sides." };
    const keep = clamp(Math.floor((mine + theirs) / 2 / 50) * 50, lo, hi);
    return { line: l.n, move: "counter", keep, citation: l.cite, reason: "Nothing on file says the cheaper fix was tried first. A figure closer to the middle reflects that gap." };
  });
  const moved = out.some((l) => l.move !== "hold");
  return answer(JSON.stringify(landlord
    ? {
        lines: out,
        message: first ? "The charge is documented and already prorated. The record leaves one question, so we give back part of it." : moved ? "Agreed on the disputed charge. The others stand as stated." : "The charges stand as stated.",
        reasoning: first ? "The disputed charge has its invoice, photos and proration on file, which supports most of it. Its weak point is the cheaper fix the comparison suggested. Giving back part of it reflects that." : "The tenants moved toward the middle on the one open question. Settling here ends it.",
      }
    : {
        lines: out,
        message: "The tenants accept the documented charges. On the disputed one, the missing cheaper fix is the gap in the record, so we propose meeting closer to the middle.",
        reasoning: "The landlord's records support most of the charge, so holding at half back would likely stall. A figure between the two positions closes the gap in one more step.",
      }));
}

/* ---------- The model for each job ---------- */

const SCRIPTS: Record<ClaudeJob, (o: CallOptions) => ReturnType<typeof answer> | ReturnType<typeof callTools>> = {
  lease,
  close_out: closeOut,
  advocate,
  negotiator,
  inspect: () => { throw new Error("The e2e stubs don't cover the photo inspection: the demo's move-out unit comes inspected."); },
  chargeback: () => { throw new Error("The e2e stubs don't cover the PayPal dispute's defense agent."); },
};

/** The scripted stand-in for one Claude job. Only src/lib/model.ts calls it, and only while the e2e stubs are on. */
export function stubModel(job: ClaudeJob): LanguageModel {
  return new MockLanguageModelV4({
    provider: "e2e-stub",
    modelId: `e2e-stub-${job}`,
    doGenerate: async (options: unknown) => {
      e2eLog(`stub model answered a ${job} call (no Claude call made)`);
      return SCRIPTS[job](options as CallOptions) as never;
    },
  }) as unknown as LanguageModel;
}

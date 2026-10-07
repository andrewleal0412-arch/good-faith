import { audit, db } from "@/lib/db";
import { bad, disputeFacts, draftAction, latestDispute, liveDispute, MESSAGE_MAX, REASON_MAX, REASON_MIN, stripBasis, tenantWrite } from "@/lib/disputes";
import { runningNow, type NegotiationRow } from "@/lib/negotiation";
import { resolveTenantToken, tokenNotFound } from "@/lib/tenant-links";

export const runtime = "nodejs";

/** One line of text: control characters and line breaks become spaces. */
const line = (v: unknown) => (typeof v === "string" ? v.replace(/[\u0000-\u001f]+/g, " ").replace(/\s{2,}/g, " ").trim() : "");
/** A few lines of text: line breaks kept (at most two in a row), other control characters dropped. */
const text = (v: unknown) => (typeof v === "string" ? v.replace(/\r\n?/g, "\n").replace(/[\u0000-\u0009\u000b-\u001f]+/g, " ").replace(/\n{3,}/g, "\n\n").replace(/[ \t]{2,}/g, " ").trim() : "");
/** The most a draft's JSON may weigh: every reason and the message at their limits fit many times over. */
const BODY_MAX = 64_000;
/** A run of saves is audited once: a change is logged when the draft hadn't changed for this long. */
const AUDIT_QUIET_MS = 5 * 60_000;

// Where the advocate's run on the draft stands, for the page waiting on a run it didn't start (another tab, or a
// reload mid-run): its status and, once done, its case; and, once sent, where the negotiation stands (its status and
// how many turns it holds), for the page showing the two agents' turns as they land. Read-only, so the demo's
// templates answer too.
export async function GET(_req: Request, ctx: RouteContext<"/api/t/[token]/dispute">) {
  const { token } = await ctx.params;
  const link = await resolveTenantToken(token, { touch: false });
  if (!link) return tokenNotFound();
  const [d, latest] = await Promise.all([liveDispute(link.tenancyId), latestDispute(link.tenancyId)]);
  // The negotiation over a sent dispute (live or closed), for the page showing it while the agents go back and forth.
  const sent = latest && latest.status !== "draft" ? (latest as NegotiationRow) : null;
  const { count } = sent ? await db.from("negotiation_turns").select("id", { count: "exact" }).eq("dispute_id", sent.id).limit(1) : { count: 0 };
  return Response.json(
    {
      status: d?.status ?? null, advocateStatus: d?.advocate_status ?? null,
      advocateError: d?.advocate_status === "failed" ? d.advocate_error : null, advocate: d?.advocate ? stripBasis(d.advocate) : null,
      sentStatus: sent?.status ?? null, turns: count ?? 0,
      // A run whose process died reads as stopped, so the page stops waiting on it.
      negotiationStatus: sent && runningNow(sent) ? "running" : sent?.negotiation_status === "running" ? "failed" : sent?.negotiation_status ?? null,
    },
    { headers: { "Cache-Control": "no-store" } },
  );
}

// The tenants' dispute while they write it: which deductions, why, and anything else for the landlord. Saved as a
// draft that only their link sees (the landlord's pages list a dispute once it is sent); sending it again changes the
// draft. Opens only after the itemized statement went out. After a dispute the tenants withdrew, the first save opens
// a new one of the same statement; a settled dispute, or one with no agreement, stays closed. Authorized by the link
// token alone, audited as the tenant.
export async function POST(req: Request, ctx: RouteContext<"/api/t/[token]/dispute">) {
  const { token } = await ctx.params;
  const link = await tenantWrite(token);
  if (link instanceof Response) return link;

  if (Number(req.headers.get("content-length") ?? 0) > BODY_MAX) return bad("That's too long to save.", 413);
  const raw = await req.text().catch(() => "");
  if (raw.length > BODY_MAX) return bad("That's too long to save.", 413);
  let body: unknown = null;
  try { body = JSON.parse(raw); } catch { /* answered below */ }
  if (!body || typeof body !== "object" || Array.isArray(body)) return bad("Pick the deductions you dispute and say why.");
  const b = body as { name?: unknown; items?: unknown; message?: unknown };

  const facts = await disputeFacts(link.tenancyId);
  if (!facts) return tokenNotFound();
  if (!facts.deliveredAt || !facts.delivery) return bad("A dispute opens once your landlord has sent the itemized statement.", 409);

  if (!Array.isArray(b.items) || !b.items.length) return bad("Pick at least one deduction.");
  if (b.items.length > facts.deductions.length) return bad("That's more deductions than the statement has.");
  const reasons: Record<string, string> = {};
  for (const it of b.items as { deductionId?: unknown; reason?: unknown }[]) {
    const id = typeof it?.deductionId === "string" ? it.deductionId : "";
    const d = facts.ranges.lines.find((l) => l.id === id);
    if (!d) return bad("One of those deductions isn't on your statement. Reload the page.");
    if (reasons[id] != null) return bad(`Line ${d.n} is listed twice.`);
    const why = text(it.reason);
    if (why.length < REASON_MIN) return bad(`Say why you dispute line ${d.n}, ${d.title.toLowerCase()}.`);
    if (why.length > REASON_MAX) return bad(`Keep the reason for line ${d.n} under ${REASON_MAX} characters.`);
    reasons[id] = why;
  }
  const message = text(b.message);
  if (message.length > MESSAGE_MAX) return bad(`Keep the message under ${MESSAGE_MAX} characters.`);
  const name = line(b.name) || (facts.tenants.length === 1 ? facts.tenants[0] : "");
  if (!name || !facts.tenants.includes(name)) return bad("Pick your name as it appears on the lease.");

  const now = new Date().toISOString();
  const fields = { opened_by: name, deduction_ids: Object.keys(reasons), reasons, message: message || null, updated_at: now };
  const latest = await latestDispute(link.tenancyId);
  // A withdrawn dispute is history: this save opens a new one beside it (draftAction, dispute-status.ts).
  const act = draftAction(latest?.status ?? null);
  if (act === "closed") return bad("Your dispute of this statement is closed, so a new one can't be opened here.", 409);
  if (act === "sent") return bad("Your dispute is already with your landlord, so it can't be changed here.", 409);
  const existing = act === "update" ? latest : null;
  if (existing) {
    const { data, error } = await db.from("disputes").update(fields).eq("id", existing.id).eq("status", "draft").select("id");
    if (error) {
      console.error("dispute draft update failed", error.message);
      return bad("Couldn't save that. Try again.", 500);
    }
    if (!data?.length) return bad("Your dispute is already with your landlord, so it can't be changed here.", 409);
    // The link is public past the gate, so a burst of saves writes one audit entry, not one each.
    if (Date.now() - Date.parse(existing.updated_at) > AUDIT_QUIET_MS) {
      await audit(link.tenancyId, "tenant", "dispute_draft_changed", { lines: fields.deduction_ids.length, link_id: link.linkId });
    }
    return Response.json({ ok: true });
  }
  const { error } = await db.from("disputes").insert({
    tenancy_id: link.tenancyId, workspace_id: facts.workspaceId, link_id: link.linkId, status: "draft",
    statement_delivered_at: facts.deliveredAt, ...fields,
  });
  if (error) {
    // Two saves at once: the unique index keeps one live dispute, and the second save tries again as a change.
    console.error("dispute draft insert failed", error.message);
    return bad(error.code === "23505" ? "Your dispute was saved a moment ago. Save it again to keep this version." : "Couldn't save that. Try again.", error.code === "23505" ? 409 : 500);
  }
  await audit(link.tenancyId, "tenant", latest ? "dispute_reopened" : "dispute_drafted", { lines: fields.deduction_ids.length, link_id: link.linkId, ...(latest ? { after: latest.id } : {}) });
  return Response.json({ ok: true });
}

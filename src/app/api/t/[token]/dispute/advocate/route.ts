import { runAdvocate } from "@/lib/advocate";
import { audit, db } from "@/lib/db";
import { ADVOCATE_STALE_SECONDS, bad, caseFile, disputeBasis, disputeFacts, liveDispute, loadCasePhoto, tenantWrite } from "@/lib/disputes";
import { claudeNeverAnswered, takeTenantAllowance } from "@/lib/limits";
import { tokenNotFound } from "@/lib/tenant-links";

export const runtime = "nodejs";
export const maxDuration = 300;

// "Ask my advocate": the tenants' advocate reads the file and writes their case (src/lib/advocate.ts), which the code
// checks against the lawful range before it is saved on the draft. One run at a time per dispute (claimed in the
// database, so a double tap can't spend two Claude calls), counted against the tenancy's daily allowance before Claude
// is called, and given back when Claude never answered.
export async function POST(_req: Request, ctx: RouteContext<"/api/t/[token]/dispute/advocate">) {
  const { token } = await ctx.params;
  const link = await tenantWrite(token);
  if (link instanceof Response) return link;
  const [dispute, facts] = await Promise.all([liveDispute(link.tenancyId), disputeFacts(link.tenancyId)]);
  if (!facts) return tokenNotFound();
  if (!dispute) return bad("Save your reasons first.", 409);
  if (dispute.status !== "draft") return bad("Your dispute is already with your landlord.", 409);
  if (!dispute.deduction_ids.some((id) => facts.deductions.some((d) => d.id === id))) return bad("Pick at least one deduction first.");

  const { data: claimed, error: ce } = await db.rpc("claim_advocate_run", { p_dispute: dispute.id, p_stale_seconds: ADVOCATE_STALE_SECONDS });
  if (ce) {
    console.error("advocate claim failed", ce.message);
    return bad("Couldn't start your advocate. Try again.", 500);
  }
  // `running` tells the page to wait for that run instead of showing an error.
  if (!claimed) return Response.json({ error: "Your advocate is already working on it. This page updates when it's done.", running: true }, { status: 409 });
  const release = (status: "done" | "failed" | null, error: string | null) =>
    db.from("disputes").update({ advocate_status: status, advocate_error: error, updated_at: new Date().toISOString() }).eq("id", dispute.id);

  const allowance = await takeTenantAllowance(link.tenancyId, "advocate");
  if (allowance.refused) {
    // Nothing ran: the draft goes back to where it was (its earlier case, if it had one).
    await release(dispute.advocate ? "done" : null, null);
    return allowance.refused;
  }

  const file = caseFile(facts, dispute);
  try {
    const c = await runAdvocate(file, facts.pack, { loadPhoto: loadCasePhoto });
    const stored = { ...c, basis: disputeBasis(dispute, facts) };
    const { data: saved, error } = await db.from("disputes").update({ advocate: stored, advocate_status: "done", advocate_error: null, updated_at: new Date().toISOString() })
      .eq("id", dispute.id).eq("status", "draft").select("id");
    if (error) throw new Error(error.message);
    if (!saved?.length) {
      // Sent while the case was being written (only after a stale claim: send_dispute refuses during a run).
      await release(dispute.advocate ? "done" : null, null);
      return bad("Your dispute was sent before your advocate finished, so this case wasn't added.", 409);
    }
    await audit(link.tenancyId, "agent", "advocate_case_written", {
      dispute_id: dispute.id, lines: c.lines.length, amount_back: c.amountBack, adjustments: c.adjustments.length, steps: c.steps, link_id: link.linkId,
    });
    return Response.json({ case: c });
  } catch (e) {
    console.error("advocate run failed", e);
    if (claudeNeverAnswered(e)) await allowance.giveBack();
    // An earlier case stays in place; the error is kept for the page and the logs.
    await release(dispute.advocate ? "done" : "failed", e instanceof Error ? e.message.slice(0, 300) : "failed");
    return bad("Your advocate couldn't finish. Try again in a minute.", 500);
  }
}

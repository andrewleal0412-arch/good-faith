import { audit, db } from "@/lib/db";
import { bad, disputeFacts, evidencePrefix, liveDispute, MAX_EVIDENCE, tenantWrite, type Evidence } from "@/lib/disputes";
import { imageType, notAPhotoServer, photoTooLarge, readForm, TOO_LARGE, UNREADABLE } from "@/lib/images";
import { takeTenantAllowance, uploadUnits } from "@/lib/limits";
import { tokenNotFound } from "@/lib/tenant-links";
import { UPLOAD_BUDGET } from "@/lib/uploads";

export const runtime = "nodejs";
export const maxDuration = 60;

// The tenants' own photos for their dispute (a draft only), each for one disputed deduction. Checked by their
// bytes like every upload, counted against the link's daily upload allowance, stored in the private photos bucket
// under the tenancy's workspace prefix, and added to the draft under its row lock, at most MAX_EVIDENCE in all.
export async function POST(req: Request, ctx: RouteContext<"/api/t/[token]/dispute/evidence">) {
  const { token } = await ctx.params;
  const link = await tenantWrite(token);
  if (link instanceof Response) return link;
  const form = await readForm(req);
  if (!form) return bad(UNREADABLE);
  const files = form.getAll("files").filter((f): f is File => f instanceof File && f.size > 0);
  const deductionId = typeof form.get("deductionId") === "string" ? String(form.get("deductionId")) : "";
  if (!files.length) return bad("Add at least one photo.");
  if (files.length > MAX_EVIDENCE) return bad(`Add at most ${MAX_EVIDENCE} photos.`);
  const big = files.find((f) => f.size > UPLOAD_BUDGET);
  if (big) return bad(photoTooLarge(big.name, big.size));
  if (files.reduce((n, f) => n + f.size, 0) > UPLOAD_BUDGET) return bad(TOO_LARGE, 413);

  const [dispute, facts] = await Promise.all([liveDispute(link.tenancyId), disputeFacts(link.tenancyId)]);
  if (!facts || !facts.workspaceId) return tokenNotFound();
  if (!dispute || dispute.status !== "draft") return bad(dispute ? "Your dispute is already with your landlord, so photos can't be added here." : "Save your reasons first.", 409);
  if (!dispute.deduction_ids.includes(deductionId) || !facts.deductions.some((d) => d.id === deductionId)) return bad("Add each photo under a charge you dispute. Reload the page.");
  if ((dispute.evidence ?? []).length + files.length > MAX_EVIDENCE) return bad(`A dispute can carry ${MAX_EVIDENCE} photos, and this one has ${(dispute.evidence ?? []).length}.`);

  const checked: { file: File; bytes: Uint8Array; type: string }[] = [];
  for (const f of files) {
    const bytes = new Uint8Array(await f.arrayBuffer());
    const type = await imageType(bytes);
    if (!type) return bad(notAPhotoServer(f.name));
    checked.push({ file: f, bytes, type });
  }
  const allowance = await takeTenantAllowance(link.linkId, "upload_mb", uploadUnits(checked.reduce((n, c) => n + c.bytes.length, 0)));
  if (allowance.refused) return allowance.refused;

  const prefix = evidencePrefix(facts.workspaceId, link.tenancyId, dispute.id);
  const items: Evidence[] = [];
  for (const { file, bytes, type } of checked) {
    const id = crypto.randomUUID();
    const path = `${prefix}${id}.${type.slice("image/".length)}`;
    const up = await db.storage.from("photos").upload(path, bytes, { contentType: type });
    if (up.error) {
      if (items.length) await db.storage.from("photos").remove(items.map((x) => x.path));
      await allowance.giveBack();
      console.error("dispute photo upload failed", up.error.message);
      return bad("Couldn't save the photos. Try again.", 500);
    }
    items.push({ id, path, name: file.name.replace(/[\u0000-\u001f]/g, " ").slice(0, 120), type, bytes: bytes.length, deduction_id: deductionId, added_at: new Date().toISOString() });
  }
  const { data: stored, error } = await db.rpc("add_dispute_evidence", { p_dispute: dispute.id, p_items: items, p_max: MAX_EVIDENCE });
  if (error || !stored) {
    await db.storage.from("photos").remove(items.map((x) => x.path));
    await allowance.giveBack();
    if (error) console.error("dispute photo record failed", error.message);
    return bad(error ? "Couldn't save the photos. Try again." : `A dispute can carry ${MAX_EVIDENCE} photos.`, error ? 500 : 409);
  }
  await audit(link.tenancyId, "tenant", "dispute_evidence_added", { count: items.length, link_id: link.linkId });
  return Response.json({ ok: true, evidence: items.map((x) => ({ id: x.id, name: x.name, deductionId: x.deduction_id })) });
}

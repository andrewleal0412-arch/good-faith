import sharp from "sharp";
import { audit, db } from "@/lib/db";
import { bad, evidencePrefix, liveDispute, tenantWrite, type Evidence } from "@/lib/disputes";
import { resolveTenantToken, tokenNotFound } from "@/lib/tenant-links";
import { thumbnail } from "@/lib/thumbs";

export const runtime = "nodejs";

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

// One of the tenants' dispute photos, for their own page: read from the private bucket here (a signed URL would carry
// the storage path, and the path carries the tenancy id), downscaled for the page; with ?size=thumb, its small version
// (src/lib/thumbs.ts), for the page's tiles. DELETE takes it off a draft.
export async function GET(req: Request, ctx: RouteContext<"/api/t/[token]/dispute/evidence/[evidenceId]">) {
  const { token, evidenceId } = await ctx.params;
  if (!UUID_RE.test(evidenceId)) return tokenNotFound();
  const link = await resolveTenantToken(token, { touch: false });
  if (!link) return tokenNotFound();
  const { data: rows } = await db.from("disputes").select("evidence").eq("tenancy_id", link.tenancyId);
  const hit = (rows ?? []).flatMap((r) => (r.evidence ?? []) as Evidence[]).find((e) => e.id === evidenceId);
  if (!hit) return tokenNotFound();
  if (new URL(req.url).searchParams.get("size") === "thumb") {
    const t = await thumbnail(hit.path);
    if (!t) return tokenNotFound();
    return new Response(t.bytes, { headers: { "Content-Type": t.type, "Content-Disposition": "inline", "Cache-Control": "private, max-age=600" } });
  }
  const { data, error } = await db.storage.from("photos").download(hit.path);
  if (error || !data) return tokenNotFound();
  const original = new Uint8Array(await data.arrayBuffer());
  let bytes = original, type = data.type || hit.type || "image/jpeg";
  try {
    bytes = new Uint8Array(await sharp(original).rotate().resize({ width: 1600, height: 1600, fit: "inside", withoutEnlargement: true }).jpeg({ quality: 80 }).toBuffer());
    type = "image/jpeg";
  } catch { /* sharp couldn't read it; the original goes out as stored */ }
  return new Response(bytes, { headers: { "Content-Type": type, "Content-Disposition": "inline", "Cache-Control": "private, max-age=600" } });
}

export async function DELETE(_req: Request, ctx: RouteContext<"/api/t/[token]/dispute/evidence/[evidenceId]">) {
  const { token, evidenceId } = await ctx.params;
  if (!UUID_RE.test(evidenceId)) return tokenNotFound();
  const link = await tenantWrite(token);
  if (link instanceof Response) return link;
  const dispute = await liveDispute(link.tenancyId);
  if (!dispute || dispute.status !== "draft") return bad("Your dispute is already with your landlord, so its photos stay.", 409);
  const { data: hit, error } = await db.rpc("remove_dispute_evidence", { p_dispute: dispute.id, p_item: evidenceId });
  if (error) {
    console.error("dispute photo removal failed", error.message);
    return bad("Couldn't remove that photo. Try again.", 500);
  }
  if (!hit) return tokenNotFound();
  // Only a file under this dispute's own folder is ever removed.
  const path = (hit as Evidence).path;
  if (dispute.workspace_id && path.startsWith(evidencePrefix(dispute.workspace_id, link.tenancyId, dispute.id))) {
    const { error: re } = await db.storage.from("photos").remove([path]);
    if (re) console.error("dispute photo file removal failed", re.message);
  }
  await audit(link.tenancyId, "tenant", "dispute_evidence_removed", { link_id: link.linkId });
  return Response.json({ ok: true });
}

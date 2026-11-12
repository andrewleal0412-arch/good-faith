import sharp from "sharp";
import { clientAddress } from "@/lib/access-throttle";
import { audit, db } from "@/lib/db";
import { bad, evidencePrefix, liveDispute, tenantWrite, type Evidence } from "@/lib/disputes";
import { imageType } from "@/lib/images";
import { rateLimiter } from "@/lib/rate-limit";
import { resolveTenantToken, tokenNotFound, tooManyRequests } from "@/lib/tenant-links";
import { inTurn, thumbnail } from "@/lib/thumbs";
import { MAX_PIXELS } from "@/lib/uploads";

export const runtime = "nodejs";

// A photo at full size is downloaded and resized by sharp on every request (only the ?size=thumb version is kept in
// the thumbnail cache), from a link that is public past the gate, so a full-size GET counts its callers by address
// before it reads anything: the page's tiles are thumbs and don't count, a full size opens on a click, and a loop on
// the URL is held to this.
const limited = rateLimiter({ perAddress: 60, total: 600, ms: 60_000 });

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

// One of the tenants' dispute photos, for their own page: read from the private bucket here (a signed URL would carry
// the storage path, and the path carries the tenancy id), downscaled for the page; with ?size=thumb, its small version
// (src/lib/thumbs.ts), for the page's tiles. DELETE takes it off a draft.
export async function GET(req: Request, ctx: RouteContext<"/api/t/[token]/dispute/evidence/[evidenceId]">) {
  const { token, evidenceId } = await ctx.params;
  if (!UUID_RE.test(evidenceId)) return tokenNotFound();
  const thumb = new URL(req.url).searchParams.get("size") === "thumb";
  if (!thumb && limited(clientAddress(req.headers))) return tooManyRequests();
  const link = await resolveTenantToken(token, { touch: false });
  if (!link) return tokenNotFound();
  const { data: rows } = await db.from("disputes").select("evidence").eq("tenancy_id", link.tenancyId);
  const hit = (rows ?? []).flatMap((r) => (r.evidence ?? []) as Evidence[]).find((e) => e.id === evidenceId);
  if (!hit) return tokenNotFound();
  if (thumb) {
    const t = await thumbnail(hit.path);
    if (!t) return tokenNotFound();
    return new Response(t.bytes, { headers: { "Content-Type": t.type, "Content-Disposition": "inline", "Cache-Control": "private, max-age=600" } });
  }
  const { data, error } = await db.storage.from("photos").download(hit.path);
  if (error || !data) return tokenNotFound();
  const original = new Uint8Array(await data.arrayBuffer());
  let bytes = original, type = data.type || hit.type || "image/jpeg";
  // Checked again before decoding, for a file stored before the upload check refused its shape (src/lib/images.ts),
  // and decoded in the thumbnail maker's turn, two at a time.
  if (await imageType(original)) try {
    bytes = await inTurn(async () => new Uint8Array(await sharp(original, { limitInputPixels: MAX_PIXELS }).rotate().resize({ width: 1600, height: 1600, fit: "inside", withoutEnlargement: true }).jpeg({ quality: 80 }).toBuffer()));
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

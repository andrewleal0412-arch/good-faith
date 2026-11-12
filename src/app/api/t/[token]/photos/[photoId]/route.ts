import sharp from "sharp";
import { clientAddress } from "@/lib/access-throttle";
import { db } from "@/lib/db";
import { imageType } from "@/lib/images";
import { rateLimiter } from "@/lib/rate-limit";
import { resolveTenantToken, tokenNotFound, tooManyRequests } from "@/lib/tenant-links";
import { statementDelivered } from "@/lib/tenant-view";
import { inTurn, thumbnail } from "@/lib/thumbs";
import { MAX_PIXELS } from "@/lib/uploads";

export const runtime = "nodejs";

// A photo at full size is downloaded and resized by sharp on every request (only the ?size=thumb version is kept in
// the thumbnail cache), from a link that is public past the gate, so a full-size GET counts its callers by address
// before it reads anything, as the dispute photo route does: the page's tiles are thumbs and don't count, a full size
// opens on a click, and a loop on the URL is held to this.
const limited = rateLimiter({ perAddress: 60, total: 600, ms: 60_000 });

/** Whether the tenancy's itemized statement has gone out (tenant-view.ts's rule): the moment its move-out photos are
 *  the tenants' too. */
async function delivered(tenancyId: string): Promise<boolean> {
  const { data } = await db.from("tenancies").select("statement_delivered_at, statement_delivery").eq("id", tenancyId).maybeSingle();
  return !!data && statementDelivered(data);
}

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** Phone photos are downscaled to this many pixels on the long side for the page; the originals stay in the bucket. */
const PHOTO_PX = 1600, PHOTO_QUALITY = 80;
/** How long a browser may keep one: short, so a revoked link stops showing photos within minutes. */
const CACHE_SECONDS = 600;

// One photo for the tenants, by their link token: a move-in photo (Civ. Code 1950.5(g)(1)), or once the itemized
// statement is delivered a move-out photo a deduction was read from, which is the statement's own exhibit and shows
// on their page under its charge with Claude's box. The file is read from the private bucket here rather than handed
// out as a signed URL: a signed URL carries the storage path, and the path carries the tenancy id, which must not
// reach the tenant. Before the statement goes out the move-out photos belong with the landlord's draft and are
// refused here as not found; the after-repair photos stay inside the statement's packet. With ?size=thumb, its small
// version for the page (src/lib/thumbs.ts); the tile opens the photo itself.
export async function GET(req: Request, ctx: RouteContext<"/api/t/[token]/photos/[photoId]">) {
  const { token, photoId } = await ctx.params;
  if (!UUID_RE.test(photoId)) return tokenNotFound();
  const thumb = new URL(req.url).searchParams.get("size") === "thumb";
  if (!thumb && limited(clientAddress(req.headers))) return tooManyRequests();
  const link = await resolveTenantToken(token, { touch: false });
  if (!link) return tokenNotFound();
  const { data: p } = await db.from("photos").select("storage_path, phase").eq("id", photoId).eq("tenancy_id", link.tenancyId).in("phase", ["move_in", "move_out_before"]).maybeSingle();
  if (!p) return tokenNotFound();
  if (p.phase === "move_out_before" && !(await delivered(link.tenancyId))) return tokenNotFound();
  if (thumb) {
    const t = await thumbnail(p.storage_path);
    if (!t) return tokenNotFound();
    return new Response(t.bytes, { headers: { "Content-Type": t.type, "Content-Disposition": "inline", "Cache-Control": `private, max-age=${CACHE_SECONDS}` } });
  }
  const { data, error } = await db.storage.from("photos").download(p.storage_path);
  if (error || !data) return tokenNotFound();
  const original = new Uint8Array(await data.arrayBuffer());
  let bytes = original, type = data.type || "image/jpeg";
  // Checked again before decoding, for a file stored before the upload check refused its shape (src/lib/images.ts),
  // and decoded in the thumbnail maker's turn, two at a time.
  if (await imageType(original)) try {
    bytes = await inTurn(async () => new Uint8Array(await sharp(original, { limitInputPixels: MAX_PIXELS }).rotate().resize({ width: PHOTO_PX, height: PHOTO_PX, fit: "inside", withoutEnlargement: true }).jpeg({ quality: PHOTO_QUALITY }).toBuffer()));
    type = "image/jpeg";
  } catch { /* sharp couldn't read it; the original goes out as stored */ }
  return new Response(bytes, {
    headers: { "Content-Type": type, "Content-Disposition": "inline", "Cache-Control": `private, max-age=${CACHE_SECONDS}` },
  });
}

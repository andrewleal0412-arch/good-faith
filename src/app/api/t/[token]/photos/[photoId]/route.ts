import sharp from "sharp";
import { db } from "@/lib/db";
import { resolveTenantToken, tokenNotFound } from "@/lib/tenant-links";
import { thumbnail } from "@/lib/thumbs";

export const runtime = "nodejs";

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** Phone photos are downscaled to this many pixels on the long side for the page; the originals stay in the bucket. */
const PHOTO_PX = 1600, PHOTO_QUALITY = 80;
/** How long a browser may keep one: short, so a revoked link stops showing photos within minutes. */
const CACHE_SECONDS = 600;

// One move-in photo for the tenants, by their link token (Civ. Code 1950.5(g)(1)). The file is read from the private
// bucket here rather than handed out as a signed URL: a signed URL carries the storage path, and the path carries
// the tenancy id, which must not reach the tenant. Only move-in photos: the move-out photos belong with the
// statement, and reach the tenants inside its packet. With ?size=thumb, its small version for the page's grid
// (src/lib/thumbs.ts); the tile opens the photo itself.
export async function GET(req: Request, ctx: RouteContext<"/api/t/[token]/photos/[photoId]">) {
  const { token, photoId } = await ctx.params;
  if (!UUID_RE.test(photoId)) return tokenNotFound();
  const link = await resolveTenantToken(token, { touch: false });
  if (!link) return tokenNotFound();
  const { data: p } = await db.from("photos").select("storage_path").eq("id", photoId).eq("tenancy_id", link.tenancyId).eq("phase", "move_in").maybeSingle();
  if (!p) return tokenNotFound();
  if (new URL(req.url).searchParams.get("size") === "thumb") {
    const t = await thumbnail(p.storage_path);
    if (!t) return tokenNotFound();
    return new Response(t.bytes, { headers: { "Content-Type": t.type, "Content-Disposition": "inline", "Cache-Control": `private, max-age=${CACHE_SECONDS}` } });
  }
  const { data, error } = await db.storage.from("photos").download(p.storage_path);
  if (error || !data) return tokenNotFound();
  const original = new Uint8Array(await data.arrayBuffer());
  let bytes = original, type = data.type || "image/jpeg";
  try {
    bytes = new Uint8Array(await sharp(original).rotate().resize({ width: PHOTO_PX, height: PHOTO_PX, fit: "inside", withoutEnlargement: true }).jpeg({ quality: PHOTO_QUALITY }).toBuffer());
    type = "image/jpeg";
  } catch { /* sharp couldn't read it; the original goes out as stored */ }
  return new Response(bytes, {
    headers: { "Content-Type": type, "Content-Disposition": "inline", "Cache-Control": `private, max-age=${CACHE_SECONDS}` },
  });
}

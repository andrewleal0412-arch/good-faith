import { ACCESS_MESSAGES } from "@/lib/session";
import { isPhotoPath, thumbEtag, thumbnail } from "@/lib/thumbs";
import { currentWorkspace, maySign } from "@/lib/workspace";

export const runtime = "nodejs";

/** A stored photo's file never changes (src/lib/thumbs.ts), so the landlord's browser keeps its thumbnail for 30 days. */
const CACHE = "private, max-age=2592000, immutable";

// One photo's thumbnail for the landlord's pages (the photo grids, the property and room thumbnails, the statement's
// photos), by its path in the private photos bucket: only a path the session's workspace may see, by the rule every
// signed link follows (maySign: its own uploads, the demo templates' read-only files, the owner's older files). Any
// other path answers 404, as one that doesn't exist.
export async function GET(req: Request, ctx: RouteContext<"/api/thumbs/[...path]">) {
  const path = (await ctx.params).path.join("/");
  if (!isPhotoPath(path)) return new Response("Not found", { status: 404 });
  const ws = await currentWorkspace();
  if (!ws) return Response.json({ error: ACCESS_MESSAGES.signedOut }, { status: 401 });
  if (!(await maySign(ws, path))) return new Response("Not found", { status: 404 });
  const etag = thumbEtag(path);
  if (req.headers.get("if-none-match") === etag) return new Response(null, { status: 304, headers: { ETag: etag, "Cache-Control": CACHE } });
  const t = await thumbnail(path);
  if (!t) return new Response("Not found", { status: 404 });
  return new Response(t.bytes, { headers: { "Content-Type": t.type, "Content-Disposition": "inline", "Cache-Control": CACHE, ETag: etag } });
}

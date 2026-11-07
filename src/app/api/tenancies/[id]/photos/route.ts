import { after } from "next/server";
import { audit, db } from "@/lib/db";
import { imageType, notAPhotoServer, photoTooLarge, readForm, TOO_LARGE, UNREADABLE } from "@/lib/images";
import { takeAllowance, uploadUnits } from "@/lib/limits";
import { warmThumbnail } from "@/lib/thumbs";
import { PHOTOS_PER_REQUEST, UPLOAD_BUDGET } from "@/lib/uploads";
import { routeTenancy, uploadPrefix } from "@/lib/workspace";

export const runtime = "nodejs";
export const maxDuration = 60;

const PHASES = ["move_in", "move_out_before", "move_out_after"] as const;
/** Photos one tenancy may hold across every room and phase: far above a real unit's, low enough that an open demo
 *  can't fill the storage plan. */
const PHOTOS_PER_TENANCY = 120;

// Photos by room and phase, the three AB 2801 stages (Civ. Code 1950.5(g)): move-in, move-out before repairs, and
// after repairs. Stored in the private photos bucket.
export async function POST(req: Request, ctx: RouteContext<"/api/tenancies/[id]/photos">) {
  const { id } = await ctx.params;
  const ws = await routeTenancy(id, { write: true });
  if (ws instanceof Response) return ws;
  const form = await readForm(req);
  if (!form) return Response.json({ error: UNREADABLE }, { status: 400 });
  const phase = String(form.get("phase") ?? "move_in") as (typeof PHASES)[number];
  const room = String(form.get("room") ?? "").replace(/[\u0000-\u001f]/g, " ").trim().slice(0, 60);
  // Every file sent is checked by its bytes, whatever type the browser declared for it.
  const files = form.getAll("files").filter((f): f is File => f instanceof File);
  if (!PHASES.includes(phase)) return Response.json({ error: "Unknown photo phase." }, { status: 400 });
  if (!room) return Response.json({ error: "Name the room." }, { status: 400 });
  if (!files.length) return Response.json({ error: "Add at least one photo." }, { status: 400 });
  // The browser sends at most PHOTOS_PER_REQUEST photos and UPLOAD_BUDGET bytes per request (src/lib/uploads.ts).
  if (files.length > PHOTOS_PER_REQUEST) return Response.json({ error: `Send at most ${PHOTOS_PER_REQUEST} photos at a time.` }, { status: 400 });
  const big = files.find((f) => f.size > UPLOAD_BUDGET);
  if (big) return Response.json({ error: photoTooLarge(big.name, big.size) }, { status: 400 });
  if (files.reduce((n, f) => n + f.size, 0) > UPLOAD_BUDGET) return Response.json({ error: TOO_LARGE }, { status: 413 });
  const { count } = await db.from("photos").select("id", { count: "exact", head: true }).eq("tenancy_id", id);
  if ((count ?? 0) + files.length > PHOTOS_PER_TENANCY) {
    return Response.json({ error: `A property can hold ${PHOTOS_PER_TENANCY} photos in this demo, and this one has ${count ?? 0}.` }, { status: 400 });
  }

  // Every file is checked before any is stored, so a refused one leaves nothing behind.
  const checked: { file: File; bytes: Uint8Array<ArrayBuffer>; type: string }[] = [];
  for (const f of files) {
    const bytes = new Uint8Array(await f.arrayBuffer());
    const type = await imageType(bytes);
    if (!type) return Response.json({ error: notAPhotoServer(f.name) }, { status: 400 });
    checked.push({ file: f, bytes, type });
  }
  // Today's allowance of stored upload megabytes (src/lib/limits.ts), so an open demo can't fill the storage plan.
  const run = await takeAllowance("upload_mb", uploadUnits(checked.reduce((n, c) => n + c.bytes.length, 0)));
  if (run.refused) return run.refused;

  const rows = [];
  const stored: { path: string; bytes: Uint8Array<ArrayBuffer>; type: string }[] = [];
  for (const { file, bytes, type } of checked) {
    const ext = type.slice("image/".length);
    // Under the workspace's own prefix, so a demo copy's uploads are its own to sign and the sweep's to remove.
    const path = `${uploadPrefix(ws)}${id}/${phase}/${crypto.randomUUID()}.${ext}`;
    const up = await db.storage.from("photos").upload(path, bytes, { contentType: type });
    if (up.error) {
      console.error("photo upload failed", up.error.message);
      return Response.json({ error: "Couldn't store the photos. Try again." }, { status: 500 });
    }
    rows.push({ tenancy_id: id, phase, room, storage_path: path, caption: file.name });
    stored.push({ path, bytes, type });
  }
  const { error } = await db.from("photos").insert(rows);
  if (error) {
    console.error("photo rows insert failed", error.message);
    return Response.json({ error: "Couldn't save the photos. Try again." }, { status: 500 });
  }
  // Their small versions for the grids (src/lib/thumbs.ts), from the bytes in hand, once this has answered.
  after(() => { for (const s of stored) warmThumbnail(s.path, s.bytes, s.type); });
  // The browser sends a big selection in several requests; "total" is the whole selection, so the log can say 4 of 6.
  const total = Number(form.get("total"));
  await audit(id, "landlord", "photos_added", { phase, room, count: rows.length, ...(Number.isInteger(total) && total > rows.length ? { total } : {}) });
  return Response.json({ ok: true, count: rows.length });
}

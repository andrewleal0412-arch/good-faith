import { audit, db } from "@/lib/db";
import { imageType, notAPhotoServer } from "@/lib/images";

export const runtime = "nodejs";
export const maxDuration = 60;

const PHASES = ["move_in", "move_out_before", "move_out_after"] as const;

// Photos by room and phase, the three AB 2801 stages (Civ. Code 1950.5(g)): move-in, move-out before repairs, and
// after repairs. Stored in the private photos bucket.
export async function POST(req: Request, ctx: RouteContext<"/api/tenancies/[id]/photos">) {
  const { id } = await ctx.params;
  const form = await req.formData();
  const phase = String(form.get("phase") ?? "move_in") as (typeof PHASES)[number];
  const room = String(form.get("room") ?? "").trim();
  const files = form.getAll("files").filter((f): f is File => f instanceof File && f.type.startsWith("image/"));
  if (!PHASES.includes(phase)) return Response.json({ error: "Unknown photo phase." }, { status: 400 });
  if (!room) return Response.json({ error: "Name the room." }, { status: 400 });
  if (!files.length) return Response.json({ error: "Add at least one photo." }, { status: 400 });

  // Every file is checked before any is stored, so a refused one leaves nothing behind.
  const checked: { file: File; bytes: Uint8Array; type: string }[] = [];
  for (const f of files) {
    const bytes = new Uint8Array(await f.arrayBuffer());
    const type = await imageType(bytes);
    if (!type) return Response.json({ error: notAPhotoServer(f.name) }, { status: 400 });
    checked.push({ file: f, bytes, type });
  }

  const rows = [];
  for (const { file, bytes, type } of checked) {
    const ext = type.slice("image/".length);
    const path = `${id}/${phase}/${crypto.randomUUID()}.${ext}`;
    const up = await db.storage.from("photos").upload(path, bytes, { contentType: type });
    if (up.error) return Response.json({ error: up.error.message }, { status: 500 });
    rows.push({ tenancy_id: id, phase, room, storage_path: path, caption: file.name });
  }
  const { error } = await db.from("photos").insert(rows);
  if (error) return Response.json({ error: error.message }, { status: 500 });
  // The browser sends a big selection in several requests; "total" is the whole selection, so the log can say 4 of 6.
  const total = Number(form.get("total"));
  await audit(id, "landlord", "photos_added", { phase, room, count: rows.length, ...(Number.isInteger(total) && total > rows.length ? { total } : {}) });
  return Response.json({ ok: true, count: rows.length });
}

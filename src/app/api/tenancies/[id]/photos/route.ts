import { audit, db } from "@/lib/db";

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

  const rows = [];
  for (const f of files) {
    const ext = (f.name.split(".").pop() || "jpg").toLowerCase();
    const path = `${id}/${phase}/${crypto.randomUUID()}.${ext}`;
    const up = await db.storage.from("photos").upload(path, new Uint8Array(await f.arrayBuffer()), { contentType: f.type });
    if (up.error) return Response.json({ error: up.error.message }, { status: 500 });
    rows.push({ tenancy_id: id, phase, room, storage_path: path, caption: f.name });
  }
  const { error } = await db.from("photos").insert(rows);
  if (error) return Response.json({ error: error.message }, { status: 500 });
  await audit(id, "landlord", "photos_added", { phase, room, count: rows.length });
  return Response.json({ ok: true, count: rows.length });
}

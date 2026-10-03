import { audit, db } from "@/lib/db";
import { inspectRoom, type Finding, type InspectPhoto } from "@/lib/inspect";
import { claudeNeverAnswered, inspectPhotoLimit, inspectRoomLimit, takeAllowance } from "@/lib/limits";

export const runtime = "nodejs";
export const maxDuration = 300;

// Compare every room that has both move-in and move-out photos, rooms in parallel. Findings are saved on the
// tenancy; nothing is charged yet. The landlord reviews each one before any deduction exists.
export async function POST(_req: Request, ctx: RouteContext<"/api/tenancies/[id]/inspect">) {
  const { id } = await ctx.params;
  const { data: photos } = await db.from("photos").select("phase, room, storage_path, created_at").eq("tenancy_id", id).order("created_at");
  const rooms = new Map<string, { in: string[]; out: string[] }>();
  for (const p of photos ?? []) {
    if (p.phase === "move_out_after") continue;
    const r = rooms.get(p.room) ?? { in: [], out: [] };
    (p.phase === "move_in" ? r.in : r.out).push(p.storage_path);
    rooms.set(p.room, r);
  }
  // Each room is one Claude call with its photos, so the demo compares a bounded number of rooms, each with its first
  // few photos per phase (src/lib/limits.ts). The indexes the findings carry point into these same trimmed lists.
  const most = inspectPhotoLimit();
  const ready = [...rooms.entries()].filter(([, r]) => r.in.length && r.out.length)
    .map(([room, r]) => [room, { in: r.in.slice(0, most), out: r.out.slice(0, most) }] as const);
  if (!ready.length) return Response.json({ error: "Add move-out photos for a room that has move-in photos." }, { status: 400 });
  const roomLimit = inspectRoomLimit();
  if (ready.length > roomLimit) {
    return Response.json({ error: `This demo compares up to ${roomLimit} rooms at a time, and this property has ${ready.length} with photos.` }, { status: 400 });
  }
  // Today's allowance, checked before Claude is called.
  const run = await takeAllowance("inspect");
  if (run.refused) return run.refused;

  // The stored content type travels with the bytes: it was read from the file itself when it was uploaded, and Claude
  // refuses an image whose declared type does not match.
  const photo = async (path: string): Promise<InspectPhoto> => {
    const { data, error } = await db.storage.from("photos").download(path);
    if (error || !data) throw new Error(`couldn't load ${path}`);
    return { data: new Uint8Array(await data.arrayBuffer()), mediaType: data.type || "image/jpeg" };
  };
  // Each room reports its own failure, so the error names the room instead of the whole inspection. Nothing is saved
  // unless every room finished: a partial set would silently drop the rooms that failed.
  // A room "spent" nothing when it failed before Claude answered: its photos didn't load, or the API refused the call.
  const results = await Promise.all(ready.map(async ([room, r]) => {
    let asked = false;
    try {
      const [inP, outP] = await Promise.all([Promise.all(r.in.map(photo)), Promise.all(r.out.map(photo))]);
      asked = true;
      const findings = await inspectRoom(room, inP, outP);
      // Attach the actual photo paths so the statement can show each before/after pair (AB 2801).
      return { room, findings: findings.map((f) => ({ ...f, id: crypto.randomUUID(), source: "inspection" as const, moveInPath: r.in[f.moveInPhoto] ?? r.in[0], moveOutPath: r.out[f.moveOutPhoto] ?? r.out[0] })), spent: true };
    } catch (e) {
      console.error(`inspection failed for ${room}`, e);
      return { room, findings: null, spent: asked && !claudeNeverAnswered(e) };
    }
  }));
  const failed = results.filter((r) => !r.findings).map((r) => r.room);
  if (failed.length) {
    // When no room got an answer from Claude, the inspection cost nothing and goes back to today's allowance.
    if (results.every((r) => !r.spent)) await run.giveBack();
    return Response.json({ error: `The inspection of the ${failed.join(" and the ")} didn't finish. Try again.` }, { status: 500 });
  }
  try {
    const findings: (Finding & { id: string; source: "inspection"; moveInPath: string; moveOutPath: string })[] = results.flatMap((r) => r.findings ?? []);
    // The suggested findings are replaced and the ones the landlord added by hand stay, in one locked step, so a
    // finding added while the comparison ran isn't lost.
    const { error } = await db.rpc("replace_suggested_findings", { p_tenancy: id, p_findings: findings });
    if (error) throw new Error(error.message);
    await audit(id, "agent", "move_out_inspected", {
      rooms: ready.map(([room]) => room),
      wear_and_tear: findings.filter((f) => f.classification === "wear_and_tear").length,
      damage: findings.filter((f) => f.classification === "damage").length,
      cleaning: findings.filter((f) => f.classification === "cleaning").length,
      unclear: findings.filter((f) => f.classification === "unclear").length,
    });
    return Response.json({ findings });
  } catch (e) {
    console.error("inspection failed", e);
    return Response.json({ error: "The inspection didn't finish. Try again." }, { status: 500 });
  }
}

import { audit, db } from "@/lib/db";
import { inspectRoom, type Finding } from "@/lib/inspect";

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
  const ready = [...rooms.entries()].filter(([, r]) => r.in.length && r.out.length);
  if (!ready.length) return Response.json({ error: "Add move-out photos for a room that has move-in photos." }, { status: 400 });

  const bytes = async (path: string) => {
    const { data, error } = await db.storage.from("photos").download(path);
    if (error || !data) throw new Error(`couldn't load ${path}`);
    return new Uint8Array(await data.arrayBuffer());
  };
  try {
    const results = await Promise.all(ready.map(async ([room, r]) => {
      const [inB, outB] = await Promise.all([Promise.all(r.in.map(bytes)), Promise.all(r.out.map(bytes))]);
      const findings = await inspectRoom(room, inB, outB);
      // Attach the actual photo paths so the statement can show each before/after pair (AB 2801).
      return findings.map((f) => ({ ...f, id: crypto.randomUUID(), moveInPath: r.in[f.moveInPhoto] ?? r.in[0], moveOutPath: r.out[f.moveOutPhoto] ?? r.out[0] }));
    }));
    const findings: (Finding & { id: string; moveInPath: string; moveOutPath: string })[] = results.flat();
    await db.from("tenancies").update({ move_out_findings: findings, move_out_inspected_at: new Date().toISOString(), status: "moving_out" }).eq("id", id);
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

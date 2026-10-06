import { audit, db } from "@/lib/db";
import { KIND, type Classification, type StoredFinding } from "@/lib/findings";
import { openSeal } from "@/lib/jev";
import { routeTenancy } from "@/lib/workspace";

export const runtime = "nodejs";

const KINDS: Classification[] = ["damage", "cleaning", "wear_and_tear"];
const REMEDY: Record<string, string> = { damage: "repair", cleaning: "clean", wear_and_tear: "none" };
// Text fields lose control characters, which Postgres refuses inside jsonb, and are kept short.
const text = (v: unknown, max: number) => (typeof v === "string" ? v.replace(/[\u0000-\u001f]/g, " ").trim().slice(0, max) : "");

// A finding the landlord adds by hand: something the comparison missed in a room's photos. It is the landlord's own
// call, marked as theirs, and a deduction can then be made from it like any other. Wear and tear can be recorded but,
// as everywhere else, never charged. A new comparison keeps it.
export async function POST(req: Request, ctx: RouteContext<"/api/tenancies/[id]/findings">) {
  const { id } = await ctx.params;
  const ws = await routeTenancy(id, { write: true });
  if (ws instanceof Response) return ws;
  const b = (await req.json().catch(() => null)) as Record<string, unknown> | null;
  if (!b || typeof b !== "object") return Response.json({ error: "Send the finding." }, { status: 400 });
  const item = text(b.item, 120), observation = text(b.observation, 600), room = text(b.room, 60);
  const classification = b.classification as Classification;
  if (!item) return Response.json({ error: "Say what changed." }, { status: 400 });
  if (!KINDS.includes(classification)) return Response.json({ error: "Pick damage, cleaning or wear and tear." }, { status: 400 });

  const { data: t } = await db.from("tenancies").select("move_out_findings").eq("id", id).single();
  if (!t) return Response.json({ error: "No such tenancy." }, { status: 404 });
  const { data: sent } = await db.from("payments").select("id").eq("tenancy_id", id).in("kind", ["refund", "payout"]).limit(1);
  if (sent?.length) return Response.json({ error: "The deposit has already been returned, so the findings are final." }, { status: 409 });

  // The photos it is read from: the same pair as a finding on that card, or the room's first move-in and move-out
  // photos when the room had no finding yet.
  const findings = (t.move_out_findings ?? []) as StoredFinding[];
  const like = typeof b.like === "string" ? findings.find((f) => f.id === b.like) : undefined;
  let pair = like ? { room: like.room, moveInPath: like.moveInPath, moveOutPath: like.moveOutPath } : null;
  if (!pair && room) {
    const { data: photos } = await db.from("photos").select("phase, storage_path").eq("tenancy_id", id).eq("room", room).order("created_at");
    const inP = photos?.find((p) => p.phase === "move_in")?.storage_path, outP = photos?.find((p) => p.phase === "move_out_before")?.storage_path;
    if (inP && outP) pair = { room, moveInPath: inP, moveOutPath: outP };
  }
  if (!pair) return Response.json({ error: "That room needs a move-in and a move-out photo first." }, { status: 400 });

  const finding: StoredFinding = {
    id: crypto.randomUUID(), ...pair, item, label: item, observation: observation || "Added by the landlord.",
    classification, reason: `Recorded by the landlord as ${KIND[classification].label.toLowerCase()}.`,
    remedy: REMEDY[classification], severity: "moderate", confidence: 1, source: "landlord", status: null,
  };
  // Appended in one locked step, so a review saved at the same moment isn't overwritten.
  const { data: added, error } = await db.rpc("append_move_out_finding", { p_tenancy: id, p_finding: finding });
  if (error || !added) {
    console.error("finding insert failed", error?.message ?? "no tenancy");
    return Response.json({ error: "Couldn't save. Try again." }, { status: 500 });
  }
  // Jev's read the form showed when it was saved, for the audit log, only when the classify route sealed it for these
  // very words (openSeal): a read the browser made up isn't recorded. The landlord's pick stands either way.
  const sealed = openSeal(id, { item, observation }, b.read);
  const read = sealed ? { kind: sealed.kind, p: Math.round(sealed.p * 100) / 100 } : undefined;
  await audit(id, "landlord", "finding_added", { item, room: pair.room, classification, ...(read ? { read } : {}) });
  return Response.json({ id: finding.id });
}

import { readJson } from "@/lib/body";
import { audit, db } from "@/lib/db";
import type { FindingStatus, StoredFinding } from "@/lib/findings";
import { routeTenancy } from "@/lib/workspace";

export const runtime = "nodejs";

type Loaded = { finding: StoredFinding } | Response;

/** The finding named, or the response that says why it can't be changed: the deposit has been
 *  returned (the record is final), or the finding is from an older comparison. */
async function load(id: string, fid: string): Promise<Loaded> {
  const { data: t } = await db.from("tenancies").select("move_out_findings").eq("id", id).single();
  if (!t) return Response.json({ error: "No such tenancy." }, { status: 404 });
  const { data: sent } = await db.from("payments").select("id").eq("tenancy_id", id).in("kind", ["refund", "payout"]).limit(1);
  if (sent?.length) return Response.json({ error: "The deposit has already been returned, so the findings are final." }, { status: 409 });
  const findings = (t.move_out_findings ?? []) as StoredFinding[];
  const finding = findings.find((f) => f.id === fid);
  if (!finding) return gone();
  return { finding };
}

/** Set the finding's status, or remove it, in one locked step (supabase/migrations/..._atomic_move_out_findings.sql),
 *  so two reviews in flight on the same tenancy both land. Null: the finding is gone; false: the write failed. */
async function save(id: string, fid: string, status: FindingStatus | null, remove = false): Promise<boolean | null> {
  const { data, error } = await db.rpc("set_move_out_finding", { p_tenancy: id, p_finding: fid, p_status: status, p_remove: remove });
  if (error) {
    console.error("finding update failed", error.message);
    return false;
  }
  return data ? true : null;
}

const gone = () => Response.json({ error: "That finding is from an older comparison. Refresh the page." }, { status: 404 });

// The landlord's review of one finding. "accepted" is for wear and tear: agreed, and not charged (a damage or cleaning
// finding is accepted by making its deduction). "dismissed" sets a suggestion aside; it stays on the record, muted.
// null reopens it.
export async function PATCH(req: Request, ctx: RouteContext<"/api/tenancies/[id]/findings/[fid]">) {
  const { id, fid } = await ctx.params;
  const ws = await routeTenancy(id, { write: true });
  if (ws instanceof Response) return ws;
  const b = (await readJson(req, 16_000)) as { status?: unknown } | null;
  const status = b && typeof b === "object" && "status" in b ? b.status : undefined;
  if (status !== null && status !== "accepted" && status !== "dismissed") {
    return Response.json({ error: "Send accepted, dismissed or null." }, { status: 400 });
  }
  const r = await load(id, fid);
  if (r instanceof Response) return r;
  if (status === "accepted" && r.finding.classification !== "wear_and_tear") {
    return Response.json({ error: "Accept damage or cleaning by adding its deduction." }, { status: 400 });
  }
  if (status === "dismissed") {
    const { data: d } = await db.from("deductions").select("id").eq("tenancy_id", id).eq("finding->>id", fid).limit(1);
    if (d?.length) return Response.json({ error: "Remove its deduction first." }, { status: 409 });
  }
  const saved = await save(id, fid, status as FindingStatus | null);
  if (saved === null) return gone();
  if (!saved) return Response.json({ error: "Couldn't save. Try again." }, { status: 500 });
  await audit(id, "landlord", "finding_reviewed", { item: r.finding.item, room: r.finding.room, classification: r.finding.classification, status });
  return Response.json({ ok: true });
}

// Only a finding the landlord added can be removed; a suggested one is dismissed instead, so the record keeps it.
export async function DELETE(_req: Request, ctx: RouteContext<"/api/tenancies/[id]/findings/[fid]">) {
  const { id, fid } = await ctx.params;
  const ws = await routeTenancy(id, { write: true });
  if (ws instanceof Response) return ws;
  const r = await load(id, fid);
  if (r instanceof Response) return r;
  if (r.finding.source !== "landlord") return Response.json({ error: "Suggested findings are dismissed, not removed." }, { status: 400 });
  const { data: d } = await db.from("deductions").select("id").eq("tenancy_id", id).eq("finding->>id", fid).limit(1);
  if (d?.length) return Response.json({ error: "Remove its deduction first." }, { status: 409 });
  const saved = await save(id, fid, null, true);
  if (saved === null) return gone();
  if (!saved) return Response.json({ error: "Couldn't save. Try again." }, { status: 500 });
  await audit(id, "landlord", "finding_removed", { item: r.finding.item, room: r.finding.room });
  return Response.json({ ok: true });
}

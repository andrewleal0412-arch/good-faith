import "server-only";
import { db } from "./db";
import { guideSteps, type GuideStep, type GuideTenancy } from "./demo-guide";
import { packFor } from "./states/server";
import { workspaceTenancies } from "./units";
import { currentWorkspace } from "./workspace";

// The demo guide's eight steps for the session's own workspace, read from the copy's own rows: where each beat of
// docs/DEMO_SCRIPT.md happens in this copy, and which of them already happened (src/lib/demo-guide.ts does the
// deciding, with no database). The landlord layout renders them with the rest of the chrome, and the guide's own route
// (src/app/api/demo/guide/route.ts) answers with them again after a click from one landlord page to another, where
// Next keeps the layout it has already rendered.

/** The disputes the tenants sent, by tenancy: every status but `draft`, which is still theirs and was never sent. The
 *  shell's own read keeps only the live ones (src/lib/units.ts, LIVE_DISPUTES), so reading the guide's dispute and
 *  negotiation beats off that list would un-tick them the moment a dispute ended without a settlement (no agreement, or
 *  withdrawn). Scoped to the session's workspace by the disputes' own column, as the bell's read is. */
async function sentDisputes(workspaceId: string): Promise<Map<string, string[]>> {
  const { data, error } = await db.from("disputes").select("tenancy_id, status").eq("workspace_id", workspaceId).neq("status", "draft");
  if (error) console.error("demo guide: couldn't read the disputes", error.message);
  const out = new Map<string, string[]>();
  for (const d of (data ?? []) as { tenancy_id: string; status: string }[]) {
    out.set(d.tenancy_id, [...(out.get(d.tenancy_id) ?? []), d.status]);
  }
  return out;
}

/** The eight steps as this copy shows them, or null for a workspace with no tenancy to point at. Two reads, both for
 *  this workspace only: the tenancies the shell has loaded for its notifications anyway (React cache, one request) and
 *  the copy's sent disputes. */
export async function demoGuideSteps(): Promise<GuideStep[] | null> {
  const ws = await currentWorkspace();
  if (!ws) return null;
  const [{ rows }, sent] = await Promise.all([workspaceTenancies(), sentDisputes(ws.id)]);
  return guideSteps(rows.map((t): GuideTenancy => ({
    id: t.id,
    address: t.properties?.address ?? null,
    state: packFor(t.properties?.state).code,
    moveOutDate: t.move_out_date,
    leaseChecked: !!t.lease_terms,
    inspected: !!t.move_out_inspected_at,
    statementDelivered: !!t.statement_delivered_at,
    payments: (t.payments ?? []).map((p) => ({ kind: p.kind, status: p.status })),
    disputesSent: sent.get(t.id) ?? [],
  })));
}

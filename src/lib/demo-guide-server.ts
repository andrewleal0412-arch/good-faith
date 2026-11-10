import "server-only";
import { displayName } from "./copy";
import { db } from "./db";
import { guideSteps, liveUnit, type GuideStep, type GuideTenancy } from "./demo-guide";
import { todayIn } from "./dates";
import { heldNow, welcomeOf, type DemoWelcome } from "./demo-welcome";
import { streetLine } from "./ledger";
import { closedOut, dueOf } from "./next-step";
import { SANDBOX } from "./paypal";
import { packFor } from "./states/server";
import { demoTenantPath } from "./tenant-links";
import { tabHref } from "./tenancy-tabs";
import { loadUnits, workspaceTenancies } from "./units";
import { currentWorkspace, DEMO_ACCOUNT, type Workspace } from "./workspace";

// The demo guide's seven steps for the session's own workspace, read from the copy's own rows: where each beat of
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

/** What picks the next move inside a beat on the live unit (GuideTenancy, src/lib/demo-guide.ts): its latest close-out
 *  run, whether the tenants accepted the settlement of its live dispute, and its tenants' page in this copy. Three small
 *  reads, for that one unit only. */
async function liveFacts(ws: Workspace, tenancyId: string): Promise<Pick<GuideTenancy, "closeOut" | "tenantsAccepted" | "tenantPath">> {
  const [run, disputes, tenantPath] = await Promise.all([
    db.from("agent_runs").select("status").eq("tenancy_id", tenancyId).eq("kind", "close_out").order("created_at", { ascending: false }).limit(1).maybeSingle(),
    db.from("disputes").select("id").eq("tenancy_id", tenancyId).eq("workspace_id", ws.id).in("status", ["agreed", "settled"]),
    demoTenantPath(ws, tenancyId).catch((e) => { console.error("demo guide: couldn't read the tenants' page", e); return null; }),
  ]);
  if (run.error) console.error("demo guide: couldn't read the close-out run", run.error.message);
  const ids = (disputes.data ?? []).map((d) => d.id as string);
  const accepted = ids.length
    ? await db.from("settlements").select("id").in("dispute_id", ids).neq("status", "cancelled").not("tenant_accepted_at", "is", null).limit(1)
    : { data: [], error: null };
  if (accepted.error) console.error("demo guide: couldn't read the settlement", accepted.error.message);
  return { closeOut: (run.data?.status as string | undefined) ?? null, tenantsAccepted: !!accepted.data?.length, tenantPath };
}

/** The seven steps as this copy shows them, or null for a workspace with no tenancy to point at. Two reads, both for
 *  this workspace only: the tenancies the shell has loaded for its notifications anyway (React cache, one request) and
 *  the copy's sent disputes; then the live unit's own moving parts (liveFacts). `seen` is the look beats this browser
 *  has opened, from its cookie (SEEN_COOKIE). */
export async function demoGuideSteps(seen: ReadonlySet<number>): Promise<GuideStep[] | null> {
  const ws = await currentWorkspace();
  if (!ws) return null;
  const [{ rows }, sent] = await Promise.all([workspaceTenancies(), sentDisputes(ws.id)]);
  const units = rows.map((t): GuideTenancy => ({
    id: t.id,
    address: t.properties?.address ?? null,
    state: packFor(t.properties?.state).code,
    moveOutDate: t.move_out_date,
    leaseChecked: !!t.lease_terms,
    inspected: !!t.move_out_inspected_at,
    statementDelivered: !!t.statement_delivered_at,
    payments: (t.payments ?? []).map((p) => ({ kind: p.kind, status: p.status })),
    disputesSent: sent.get(t.id) ?? [],
  }));
  const live = liveUnit(units);
  if (live) Object.assign(live, await liveFacts(ws, live.id));
  return guideSteps(units, seen);
}

/** What the Landlord | Tenants switch needs (components/guide-bar.tsx): the live unit, its tenants' page in this copy,
 *  whether the statement's delivery is recorded (the tenants have nothing to dispute until it is), and what recording
 *  it takes: today where the unit is (its pack's zone, as the delivery route counts it) and the first tenant on the
 *  lease. Null outside a demo copy, and for a copy whose live unit has no tenants' page. */
export type DemoSide = {
  tenancyId: string; tenantPath: string; delivered: boolean;
  today: string; to: string | null; landlordHref: string;
};
export async function demoSide(): Promise<DemoSide | null> {
  const ws = await currentWorkspace();
  if (!ws || ws.kind !== "demo") return null;
  const { rows } = await workspaceTenancies();
  const live = liveUnit(rows.map((t) => ({ ...t, address: t.properties?.address ?? null, moveOutDate: t.move_out_date })));
  if (!live) return null;
  const tenantPath = await demoTenantPath(ws, live.id);
  if (!tenantPath) return null;
  return {
    tenancyId: live.id, tenantPath, delivered: !!live.statement_delivered_at,
    today: todayIn(packFor(live.properties?.state).timeZone.id),
    to: live.tenants?.[0]?.name ?? null,
    landlordHref: tabHref(live.id, "move-out"),
  };
}

/** The welcome's words for this copy (src/lib/demo-welcome.ts), from the units Properties reads anyway (React cache,
 *  one request), or null for a copy with no tenancy. */
export async function demoWelcome(): Promise<DemoWelcome | null> {
  const { today, units } = await loadUnits();
  return welcomeOf({
    account: displayName(DEMO_ACCOUNT), today, sandbox: SANDBOX,
    units: units.map(({ summary: s }) => ({
      id: s.id,
      address: s.address,
      street: streetLine(s.address),
      city: s.city,
      state: s.state,
      tenants: s.tenants,
      deposit: s.deposit?.amount ?? null,
      held: heldNow(s),
      moveOutDate: s.moveOutDate,
      inspected: !!s.moveOutInspectedAt,
      due: closedOut(s) ? null : dueOf(s),
      closed: closedOut(s),
    })),
  });
}

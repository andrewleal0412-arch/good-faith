import "server-only";
import { cache } from "react";
import { db } from "./db";
import { daysBetween, pacificToday } from "./dates";
import { tenancyEvents, type CalendarEvent } from "./ics";
import { paidElectronically, returnFailed } from "./invoice-status";
import { byUrgency, nextStep, type NextStep, type TenancySummary } from "./next-step";
import { refundNoticeStatus, type ElectronicEvidence, type Notices, type RefundAgreementSummary } from "./notices";
import type { LeaseTerms } from "./rules";
import { tenantMoveOutSentOn, type TenantMoveOut } from "./tenant";
import { currentWorkspace, DEMO_ACCOUNT, signedUrlsFor } from "./workspace";

// Every tenancy as the landlord's home base sees it, from the database alone: no PayPal round trip per row, so the
// deposit's status is as last stored (the tenancy page refreshes it from PayPal whenever it is opened).

export type TenancyRow = {
  id: string;
  status: string;
  tenants: { name: string }[];
  monthly_rent: number | string | null;
  start_date: string | null;
  end_date: string | null;
  notice_given_on: string | null;
  planned_move_out: string | null;
  move_out_date: string | null;
  move_out_inspected_at: string | null;
  statement_delivered_at: string | null;
  refund_agreement: { paypal_email: string; signed_by: string[]; signed_at: string } | null;
  lease_terms: LeaseTerms | null;
  notices: Notices | null;
  tenant_move_out: TenantMoveOut | null;
  properties: { address: string; city: string | null; owner_name: string | null } | null;
};
export type PaymentRow = { kind: string; paypal_id: string | null; amount: number | string; status: string; raw: { transactions?: { method?: string }[] } | null };
export type PhotoRow = { phase: string };
export type DeductionRow = { category: string; amount: number | string };

export function summarizeTenancy(t: TenancyRow, payments: PaymentRow[], photos: PhotoRow[], deductions: DeductionRow[]): TenancySummary {
  const inv = payments.find((p) => p.kind === "deposit_invoice") ?? null;
  // A refund PayPal refused or reversed returned nothing, so it does not close the tenancy out (the ledger counts the same way).
  const returned = payments.find((p) => (p.kind === "refund" || p.kind === "payout") && !returnFailed(p.status)) ?? null;
  const terms = t.lease_terms;
  const agreement: RefundAgreementSummary | null = t.refund_agreement
    ? { paypalEmail: t.refund_agreement.paypal_email, signedBy: t.refund_agreement.signed_by, signedAt: t.refund_agreement.signed_at }
    : null;
  // What makes the electronic-refund rule apply: the deposit came in electronically, or at least the lease allows it (D16, D17).
  const method = inv?.raw?.transactions?.[0]?.method ?? null;
  const depositElectronic = !!inv && paidElectronically(inv.status, method);
  const evidence: ElectronicEvidence = depositElectronic
    ? { kind: "paid", text: `The security was paid electronically through PayPal invoice ${inv.paypal_id}` }
    : terms?.electronicPaymentMethods?.length
      ? { kind: "lease", text: `The lease provides for electronic payment (${terms.electronicPaymentMethods.join(", ")})` }
      : null;
  return {
    id: t.id,
    address: t.properties?.address ?? terms?.propertyAddress ?? "Address not recorded",
    city: t.properties?.city ?? terms?.city ?? null,
    landlord: t.properties?.owner_name ?? terms?.landlordName ?? null,
    tenants: (t.tenants ?? []).map((x) => x.name),
    monthlyRent: t.monthly_rent == null ? null : Number(t.monthly_rent),
    status: t.status,
    startDate: t.start_date,
    endDate: t.end_date,
    noticeGivenOn: t.notice_given_on,
    plannedMoveOut: t.planned_move_out,
    moveOutDate: t.move_out_date,
    moveOutInspectedAt: t.move_out_inspected_at,
    statementDeliveredAt: t.statement_delivered_at,
    agreement: !!agreement,
    deposit: inv ? { amount: Number(inv.amount), status: inv.status, paypalId: inv.paypal_id } : null,
    depositElectronic,
    moveInPhotos: photos.filter((p) => p.phase === "move_in").length,
    moveOutPhotos: photos.filter((p) => p.phase === "move_out_before").length,
    deductions: deductions.map((d) => ({ category: d.category, amount: Number(d.amount) })),
    returned: returned ? { amount: Number(returned.amount), kind: returned.kind } : null,
    notices: t.notices ?? {},
    refundNotice: refundNoticeStatus(agreement, evidence),
    tenantMoveOut: t.tenant_move_out
      ? { name: t.tenant_move_out.name, plannedMoveOut: t.tenant_move_out.planned_move_out, forwardingAddress: t.tenant_move_out.forwarding_address, sentOn: tenantMoveOutSentOn(t.tenant_move_out) }
      : null,
  };
}

/** One tenancy's summary, for the calendar feed and the notice drafts. Callers check the tenancy is in the session's
 *  workspace first (pageTenancy, routeTenancy). */
export async function loadUnit(id: string): Promise<TenancySummary | null> {
  const [{ data: t }, { data: payments }, { data: photos }, { data: deductions }] = await Promise.all([
    db.from("tenancies").select("*, properties(address, city, owner_name)").eq("id", id).single(),
    db.from("payments").select("kind, paypal_id, amount, status, raw").eq("tenancy_id", id).order("created_at"),
    db.from("photos").select("phase").eq("tenancy_id", id),
    db.from("deductions").select("category, amount").eq("tenancy_id", id),
  ]);
  if (!t) return null;
  return summarizeTenancy(t as TenancyRow, (payments ?? []) as PaymentRow[], (photos ?? []) as PhotoRow[], (deductions ?? []) as DeductionRow[]);
}

export type UnitRow = { summary: TenancySummary; next: NextStep; events: CalendarEvent[] };
export type Upcoming = CalendarEvent & { tenancyId: string; daysAway: number };

/** How far ahead the units page looks. */
export const UPCOMING_DAYS = 120;

/** Every unit in the session's workspace, most urgent first. Cached per request, so the app shell's notifications and
 *  the page share one read. The rows under the tenancies are read through them (an inner join on the tenancy's
 *  workspace), so another workspace's payments, photos and deductions never leave the database. */
export const loadUnits = cache(async (): Promise<{ today: string; units: UnitRow[]; upcoming: Upcoming[]; owners: string[] }> => {
  const today = pacificToday();
  const ws = await currentWorkspace();
  if (!ws) return { today, units: [], upcoming: [], owners: [] };
  const [{ data: rows }, { data: payments }, { data: photos }, { data: deductions }] = await Promise.all([
    db.from("tenancies").select("*, properties(address, city, owner_name)").eq("workspace_id", ws.id).order("created_at"),
    db.from("payments").select("tenancy_id, kind, paypal_id, amount, status, raw, tenancies!inner(workspace_id)").eq("tenancies.workspace_id", ws.id).order("created_at"),
    db.from("photos").select("tenancy_id, phase, tenancies!inner(workspace_id)").eq("tenancies.workspace_id", ws.id),
    db.from("deductions").select("tenancy_id, category, amount, tenancies!inner(workspace_id)").eq("tenancies.workspace_id", ws.id),
  ]);
  const inOrder: UnitRow[] = ((rows ?? []) as TenancyRow[]).map((t) => {
    const summary = summarizeTenancy(t,
      ((payments ?? []) as (PaymentRow & { tenancy_id: string })[]).filter((p) => p.tenancy_id === t.id),
      ((photos ?? []) as (PhotoRow & { tenancy_id: string })[]).filter((p) => p.tenancy_id === t.id),
      ((deductions ?? []) as (DeductionRow & { tenancy_id: string })[]).filter((d) => d.tenancy_id === t.id));
    return { summary, next: nextStep(summary, today), events: tenancyEvents(summary) };
  });
  // The owners the leases name, oldest tenancy first: a fixed order, so the account the shell shows never depends on
  // which unit is most urgent today.
  const owners = [...new Set(inOrder.map((u) => u.summary.landlord).filter((x): x is string => !!x))];
  const units = [...inOrder].sort(byUrgency);
  const upcoming: Upcoming[] = units.flatMap((u) => u.events.map((e) => ({ ...e, tenancyId: u.summary.id, daysAway: daysBetween(today, e.date) })))
    .filter((e) => e.daysAway >= 0 && e.daysAway <= UPCOMING_DAYS)
    .sort((a, b) => a.daysAway - b.daysAway);
  return { today, units, upcoming, owners };
});

/** The account the app shell and the PayPal card show. A demo copy is always the demo landlord's business; the owner's
 *  workspace shows GOOD_FAITH_ACCOUNT when it is set, otherwise the owner of the oldest tenancy on file. Fixed per
 *  workspace, so it can't change between page loads as units change status. */
export async function accountName(owners: string[]): Promise<string | null> {
  if ((await currentWorkspace())?.kind === "demo") return DEMO_ACCOUNT;
  return process.env.GOOD_FAITH_ACCOUNT?.trim() || owners[0] || null;
}

/** One move-in photo per tenancy for its thumbnail (the living room when there is one), as short-lived signed URLs.
 *  Only tenancies in the session's workspace. */
export async function loadThumbnails(ids: string[]): Promise<Map<string, string>> {
  const out = new Map<string, string>();
  const ws = await currentWorkspace();
  if (!ids.length || !ws) return out;
  const { data } = await db.from("photos").select("tenancy_id, room, storage_path, tenancies!inner(workspace_id)").eq("phase", "move_in")
    .in("tenancy_id", ids).eq("tenancies.workspace_id", ws.id).order("created_at");
  const pick = new Map<string, { room: string; path: string }>();
  for (const p of (data ?? []) as { tenancy_id: string; room: string; storage_path: string }[]) {
    const had = pick.get(p.tenancy_id);
    if (!had || (!/living/i.test(had.room) && /living/i.test(p.room))) pick.set(p.tenancy_id, { room: p.room, path: p.storage_path });
  }
  const paths = ids.map((id) => pick.get(id)?.path).filter((x): x is string => !!x);
  if (!paths.length) return out;
  const byPath = await signedUrlsFor(ws, "photos", paths);
  for (const id of ids) {
    const path = pick.get(id)?.path;
    const url = path ? byPath.get(path) : null;
    if (url) out.set(id, url);
  }
  return out;
}

export type ActivityRow = { id: string; tenancyId: string; actor: string; action: string; detail: Record<string, unknown> | null; createdAt: string };

/** The latest audit entries across every tenancy in the session's workspace, newest first, leaving out the actions in
 *  `quiet`. */
export async function loadRecentActivity(limit: number, quiet: string[]): Promise<ActivityRow[]> {
  const ws = await currentWorkspace();
  if (!ws) return [];
  // The quiet actions are left out here rather than in the query: a few extra rows are cheaper than a dynamic filter.
  const { data } = await db.from("audit_log").select("id, tenancy_id, actor, action, detail, created_at, tenancies!inner(workspace_id)")
    .eq("tenancies.workspace_id", ws.id).order("created_at", { ascending: false }).limit(limit * 3);
  return ((data ?? []) as { id: string; tenancy_id: string; actor: string; action: string; detail: Record<string, unknown> | null; created_at: string }[])
    .filter((r) => !quiet.includes(r.action)).slice(0, limit)
    .map((r) => ({ id: r.id, tenancyId: r.tenancy_id, actor: r.actor, action: r.action, detail: r.detail, createdAt: r.created_at }));
}

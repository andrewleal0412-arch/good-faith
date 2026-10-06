import "server-only";
import { cache } from "react";
import { db } from "./db";
import { dateIn, daysBetween, pacificToday, todayIn } from "./dates";
import { tenancyEvents, type CalendarEvent } from "./ics";
import { paidElectronically, returnFailed, wasPaid } from "./invoice-status";
import { byUrgency, liveDispute, nextStep, type NextStep, type TenancySummary } from "./next-step";
import { refundNoticeStatus, type ElectronicEvidence, type Notices, type RefundAgreementSummary } from "./notices";
import type { LeaseTerms } from "./rules";
import { disputeReturns } from "./refund-rail";
import { packFor } from "./states/server";
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
  notice_given_by?: "tenant" | "landlord" | null; // added with the state packs; absent before the column existed
  planned_move_out: string | null;
  move_out_date: string | null;
  move_out_inspected_at: string | null;
  statement_delivered_at: string | null;
  statement_delivery?: { date?: string | null } | null;
  refund_agreement: { paypal_email: string; signed_by: string[]; signed_at: string } | null;
  lease_terms: LeaseTerms | null;
  notices: Notices | null;
  tenant_move_out: TenantMoveOut | null;
  properties: { address: string; city: string | null; owner_name: string | null; state?: string | null } | null;
};
export type PaymentRow = {
  kind: string; paypal_id: string | null; amount: number | string; status: string; created_at?: string;
  raw: { transactions?: { method?: string }[]; reversal?: unknown } | null; // reversal: PayPal's webhook reversed the payment
};
export type PhotoRow = { phase: string };
export type DeductionRow = { category: string; amount: number | string };

export function summarizeTenancy(t: TenancyRow, payments: PaymentRow[], photos: PhotoRow[], deductions: DeductionRow[]): TenancySummary {
  const inv = payments.find((p) => p.kind === "deposit_invoice") ?? null;
  // A refund PayPal refused or reversed returned nothing, so it does not close the tenancy out (the ledger counts the same way).
  const returned = payments.find((p) => (p.kind === "refund" || p.kind === "payout") && !returnFailed(p.status)) ?? null;
  // Money PayPal sent back through the tenants' PayPal dispute: a prior return, which comes off what is left to return
  // (refundLeft), so the unit stays open while anything is still owed.
  const via = disputeReturns(payments);
  const terms = t.lease_terms;
  const pack = packFor(t.properties?.state);
  // A deadline that forfeits the deductions (New York after day 14, as the close-out's standing reads it, in the
  // property's own zone): none of them is kept, so the whole deposit stays owed (refundLeft) and, like the ledger,
  // nothing counts as deducted. Only a pack with such a deadline sets it; California's summary never carries it.
  const zone = pack.timeZone.id;
  const held = inv && wasPaid(inv.status) ? Number(inv.amount) : 0;
  const claimed = deductions.reduce((s, d) => s + Number(d.amount), 0);
  const forfeited = deductions.length > 0 && !!pack.deadline.forfeits?.({
    moveOutDate: t.move_out_date, today: todayIn(zone), deliveredOn: t.statement_delivery?.date ?? null,
    returnedOn: returned?.created_at ? dateIn(returned.created_at, zone) : null, refundOwed: held - claimed > 0.005,
  });
  // A dispute's settlement on top of the refund, counted where it matters to the unit's own state: once forfeited, the
  // whole deposit is owed, and a settlement can be what sends the rest of it (forfeitShort, next-step.ts).
  const settledBack = forfeited ? Math.round(payments.filter((p) => (p.kind === "settlement_refund" || p.kind === "settlement_payout") && !returnFailed(p.status))
    .reduce((s, p) => s + Number(p.amount), 0) * 100) / 100 : 0;
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
    state: pack.code,
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
    // The delivery record's own date, for a state whose deadline forfeits the deductions (New York's day 14); the
    // others never read it, so their summaries stay as they were.
    ...(pack.steps.forfeit ? { statementDeliveredOn: t.statement_delivery?.date ?? null } : {}),
    agreement: !!agreement,
    // A deposit PayPal reversed (a chargeback, its webhook said so) is no longer held, as the ledger counts it.
    deposit: inv ? { amount: Number(inv.amount), status: inv.status, paypalId: inv.paypal_id, ...(inv.raw?.reversal ? { reversed: true } : {}) } : null,
    depositElectronic,
    moveInPhotos: photos.filter((p) => p.phase === "move_in").length,
    moveOutPhotos: photos.filter((p) => p.phase === "move_out_before").length,
    deductions: deductions.map((d) => ({ category: d.category, amount: Number(d.amount) })),
    returned: returned ? { amount: Number(returned.amount), kind: returned.kind } : null,
    ...(via ? { viaDispute: via.amount } : {}),
    ...(forfeited ? { forfeited: true } : {}),
    ...(settledBack > 0 ? { settledBack } : {}),
    notices: t.notices ?? {},
    refundNotice: refundNoticeStatus(agreement, evidence, pack),
    tenantMoveOut: t.tenant_move_out
      ? { name: t.tenant_move_out.name, plannedMoveOut: t.tenant_move_out.planned_move_out, forwardingAddress: t.tenant_move_out.forwarding_address, sentOn: tenantMoveOutSentOn(t.tenant_move_out, pack.timeZone.id) }
      : null,
    // Who gave the notice to end the tenancy, and the unit counts some states' rules turn on (New York's inspection-rights
    // notice; Florida's holding notice; New York's interest). California's rules read none of them.
    noticeGivenBy: t.notice_given_by ?? null,
    landlordUnits: terms?.ownerUnitCount ?? null,
    buildingUnits: terms?.buildingUnitCount ?? null,
  };
}

/** The tenancy columns the summary reads (not the findings, the lease's flags or its file: a row is several kB with
 *  them), with its property. */
const TENANCY_COLS = "id, status, tenants, monthly_rent, start_date, end_date, notice_given_on, notice_given_by, planned_move_out, move_out_date, "
  + "move_out_inspected_at, statement_delivered_at, statement_delivery, refund_agreement, lease_terms, notices, tenant_move_out, created_at, "
  + "properties(address, city, owner_name, state)";
/** And the rows under it that the summary, the ledger and the thumbnails read, embedded in the same request
 *  (PostgREST follows each table's tenancy_id): the payments and photos in the order they were made; the deductions
 *  twice, as the summary always read them (category and amount, in the table's own order) and as the ledger lists them
 *  (in the order they were made), so neither reads them differently than before. Disputes only while live (a draft
 *  stays the tenants'), PayPal disputes only while PayPal hasn't resolved them. */
const UNDER = "payments(id, kind, paypal_id, amount, status, raw, created_at), photos(phase, room, storage_path, created_at), "
  + "deductions(category, amount), ledger_deductions:deductions(id, category, room, item, amount, is_estimate, created_at), disputes(status), paypal_disputes(id, status)";
const LIVE_DISPUTES = ["open", "negotiating", "agreed"];

/** A tenancy with the rows under it, as one embedded read returns it. */
export type TenancyWithRows = TenancyRow & {
  created_at: string;
  tenants: { name: string; email?: string | null }[];
  payments: (PaymentRow & { id: string; created_at: string })[];
  photos: { phase: string; room: string; storage_path: string; created_at: string }[];
  deductions: { category: string; amount: number | string }[];
  ledger_deductions: { id: string; category: string; room: string | null; item: string; amount: number | string; is_estimate: boolean | null; created_at: string }[];
  disputes: { status: string }[];
  paypal_disputes: { id: string; status: string | null }[];
};

const tenanciesWithRows = () => db.from("tenancies").select(`${TENANCY_COLS}, ${UNDER}`)
  .order("created_at", { referencedTable: "payments" }).order("created_at", { referencedTable: "photos" })
  .order("created_at", { referencedTable: "ledger_deductions" })
  .in("disputes.status", LIVE_DISPUTES).neq("paypal_disputes.status", "RESOLVED");

const summaryOf = (t: TenancyWithRows): TenancySummary => {
  const dispute = liveDispute(t.disputes?.[0]?.status);
  return {
    ...summarizeTenancy(t, t.payments ?? [], t.photos ?? [], t.deductions ?? []),
    dispute: dispute ?? null,
    ...(t.paypal_disputes?.length ? { paypalDispute: true } : {}),
  };
};

/** One tenancy's summary, for the calendar feed and the notice drafts, in one read. Callers check the tenancy is in
 *  the session's workspace first (pageTenancy, routeTenancy). Its live dispute is read as the units page reads it, so
 *  the next step agrees with the tenancy page (New York's day-14 step changes under a dispute). */
export async function loadUnit(id: string): Promise<TenancySummary | null> {
  const { data: t } = await tenanciesWithRows().eq("id", id).maybeSingle();
  if (!t) return null;
  const s = summaryOf(t as unknown as TenancyWithRows);
  // As before: no dispute key at all when none is live.
  if (!s.dispute) delete (s as { dispute?: unknown }).dispute;
  return s;
}

/** Every tenancy in the session's workspace with the rows under it (its payments, photos, deductions and live
 *  disputes), in one request. Cached per request, so the app shell, the page, the ledger and the thumbnails share it.
 *  Filtered by the session's workspace in the query itself, so another workspace's rows never leave the database. */
export const workspaceTenancies = cache(async (): Promise<{ rows: TenancyWithRows[]; error: string | null }> => {
  const ws = await currentWorkspace();
  if (!ws) return { rows: [], error: null };
  const { data, error } = await tenanciesWithRows().eq("workspace_id", ws.id).order("created_at");
  if (error) console.error("workspace read failed:", error.message);
  return { rows: (data ?? []) as unknown as TenancyWithRows[], error: error ? error.message : null };
});

/** One unit as the home base sees it. `today` is the unit's own: the day where the property is (its pack's zone), which
 *  its next step and every days-left on it are counted from. */
export type UnitRow = { summary: TenancySummary; next: NextStep; events: CalendarEvent[]; today: string };
export type Upcoming = CalendarEvent & { tenancyId: string; daysAway: number };

/** How far ahead the units page looks. */
export const UPCOMING_DAYS = 120;

/** Every unit in the session's workspace, most urgent first. Cached per request, so the app shell's notifications and
 *  the page share one read (workspaceTenancies). Each unit's next step is counted from its own today (its state's
 *  zone: at 9:30 PM in California it is already tomorrow in New York); `today` is the landlord's, Pacific, for the
 *  page's own labels. */
export const loadUnits = cache(async (): Promise<{ today: string; units: UnitRow[]; upcoming: Upcoming[]; owners: string[] }> => {
  const today = pacificToday();
  const { rows } = await workspaceTenancies();
  const inOrder: UnitRow[] = rows.map((t) => {
    const summary = summaryOf(t);
    const own = todayIn(packFor(summary.state).timeZone.id);
    return { summary, next: nextStep(summary, own), events: tenancyEvents(summary), today: own };
  });
  // The owners the leases name, oldest tenancy first: a fixed order, so the account the shell shows never depends on
  // which unit is most urgent today.
  const owners = [...new Set(inOrder.map((u) => u.summary.landlord).filter((x): x is string => !!x))];
  const units = [...inOrder].sort(byUrgency);
  const upcoming: Upcoming[] = units.flatMap((u) => u.events.map((e) => ({ ...e, tenancyId: u.summary.id, daysAway: daysBetween(u.today, e.date) })))
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
 *  Only tenancies in the session's workspace: the photos come from workspaceTenancies, so this costs only the signing. */
export async function loadThumbnails(ids: string[]): Promise<Map<string, string>> {
  const out = new Map<string, string>();
  const ws = await currentWorkspace();
  if (!ids.length || !ws) return out;
  const want = new Set(ids);
  const pick = new Map<string, { room: string; path: string }>();
  for (const t of (await workspaceTenancies()).rows) {
    if (!want.has(t.id)) continue;
    for (const p of t.photos ?? []) {
      if (p.phase !== "move_in") continue;
      const had = pick.get(t.id);
      if (!had || (!/living/i.test(had.room) && /living/i.test(p.room))) pick.set(t.id, { room: p.room, path: p.storage_path });
    }
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

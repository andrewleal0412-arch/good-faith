import "server-only";
import { db } from "./db";
import { daysBetween, pacificToday } from "./dates";
import { tenancyEvents, type CalendarEvent } from "./ics";
import { paidElectronically, returnFailed } from "./invoice-status";
import { byUrgency, nextStep, type NextStep, type TenancySummary } from "./next-step";
import { refundNoticeStatus, type ElectronicEvidence, type Notices, type RefundAgreementSummary } from "./notices";
import type { LeaseTerms } from "./rules";
import { tenantMoveOutSentOn, type TenantMoveOut } from "./tenant";

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

/** One tenancy's summary, for the calendar feed and the notice drafts. */
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

export async function loadUnits(): Promise<{ today: string; units: UnitRow[]; upcoming: Upcoming[] }> {
  const today = pacificToday();
  const [{ data: rows }, { data: payments }, { data: photos }, { data: deductions }] = await Promise.all([
    db.from("tenancies").select("*, properties(address, city, owner_name)").order("created_at"),
    db.from("payments").select("tenancy_id, kind, paypal_id, amount, status, raw").order("created_at"),
    db.from("photos").select("tenancy_id, phase"),
    db.from("deductions").select("tenancy_id, category, amount"),
  ]);
  const units: UnitRow[] = ((rows ?? []) as TenancyRow[]).map((t) => {
    const summary = summarizeTenancy(t,
      ((payments ?? []) as (PaymentRow & { tenancy_id: string })[]).filter((p) => p.tenancy_id === t.id),
      ((photos ?? []) as (PhotoRow & { tenancy_id: string })[]).filter((p) => p.tenancy_id === t.id),
      ((deductions ?? []) as (DeductionRow & { tenancy_id: string })[]).filter((d) => d.tenancy_id === t.id));
    return { summary, next: nextStep(summary, today), events: tenancyEvents(summary) };
  }).sort(byUrgency);
  const upcoming: Upcoming[] = units.flatMap((u) => u.events.map((e) => ({ ...e, tenancyId: u.summary.id, daysAway: daysBetween(today, e.date) })))
    .filter((e) => e.daysAway >= 0 && e.daysAway <= UPCOMING_DAYS)
    .sort((a, b) => a.daysAway - b.daysAway);
  return { today, units, upcoming };
}

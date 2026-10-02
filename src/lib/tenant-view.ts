import "server-only";
import { pacificToday } from "./dates";
import { db } from "./db";
import { settle, statementDue } from "./deductions";
import { refreshDepositInvoice, type DepositInvoiceRow } from "./deposit";
import { paidElectronically, wasPaid } from "./invoice-status";
import type { Category, DeliveryRecord } from "./statement";
import type { TenantMoveOut } from "./tenant";

// The tenant-facing facts of one tenancy and nothing else. Every column is named: the lease flags, the activity log,
// the agent's runs, the landlord's draft deductions and every other tenancy stay out by construction, not by
// filtering afterwards. The tenancy id never leaves this module either: the page links only through its token.

export type TenantView = {
  today: string;
  address: string;
  landlord: string | null;
  tenants: string[];
  startDate: string | null;
  endDate: string | null;
  deposit: {
    amount: number; status: string; paid: boolean; electronic: boolean; paidAt: string | null; method: string | null;
    invoiceId: string | null; payLink: string | null; // the PayPal pay link, only while the invoice is unpaid
  } | null;
  agreement: { text: string | null; paypalEmail: string; signedBy: string[]; signedAt: string } | null;
  photos: { id: string; room: string }[]; // move-in photos, served through the token route
  noticeGivenOn: string | null; // the notice as the landlord recorded it
  plannedMoveOut: string | null;
  moveOutDate: string | null; // the actual move-out, which starts the 21-day clock
  statementDue: string | null;
  moveOut: TenantMoveOut | null; // what the tenants sent through the link
  // The itemized statement, only once the landlord delivered it: until then the deductions are the landlord's draft.
  statement: {
    delivery: DeliveryRecord; deliveredAt: string; depositHeld: number;
    deductions: { item: string; room: string | null; category: Category; amount: number }[];
    total: number; refund: number; balanceClaimed: number; documentsRequired: boolean;
  } | null;
  returned: { amount: number; kind: string; status: string; paypalId: string | null; at: string } | null;
};

const TENANCY_COLUMNS = "tenants, start_date, end_date, notice_given_on, planned_move_out, move_out_date, statement_delivered_at, statement_delivery, refund_agreement, tenant_move_out, properties(address, owner_name)";

export async function loadTenantView(tenancyId: string): Promise<TenantView | null> {
  const { data: t } = await db.from("tenancies").select(TENANCY_COLUMNS).eq("id", tenancyId).single();
  if (!t) return null;
  const delivered = !!t.statement_delivered_at && !!t.statement_delivery;
  const [{ data: payments }, { data: photos }, { data: deductionRows }] = await Promise.all([
    db.from("payments").select("id, kind, paypal_id, amount, status, raw, created_at").eq("tenancy_id", tenancyId).order("created_at"),
    db.from("photos").select("id, room").eq("tenancy_id", tenancyId).eq("phase", "move_in").order("created_at"),
    delivered ? db.from("deductions").select("item, room, category, amount").eq("tenancy_id", tenancyId).order("created_at") : Promise.resolve({ data: [] as { item: string; room: string | null; category: Category; amount: number | string }[] }),
  ]);

  const stored = (payments ?? []).find((p) => p.kind === "deposit_invoice") as DepositInvoiceRow | undefined;
  const inv = stored ? await refreshDepositInvoice(stored) : null;
  const txn = inv?.raw?.transactions?.[0];
  const paid = !!inv && wasPaid(inv.status);
  const deposit: TenantView["deposit"] = inv ? {
    amount: Number(inv.amount), status: inv.status, paid, electronic: paidElectronically(inv.status, txn?.method ?? null),
    paidAt: txn?.payment_date_time ?? null, method: txn?.method ?? null, invoiceId: inv.paypal_id,
    payLink: paid ? null : inv.raw?.payLink ?? null,
  } : null;

  const a = t.refund_agreement as { text?: string; paypal_email: string; signed_by: string[]; signed_at: string } | null;
  const ret = (payments ?? []).find((p) => p.kind === "refund" || p.kind === "payout") ?? null;
  const prop = t.properties as unknown as { address: string; owner_name: string | null } | null;

  let statement: TenantView["statement"] = null;
  if (delivered) {
    const rows = (deductionRows ?? []).map((d) => ({ item: d.item as string, room: d.room as string | null, category: d.category as Category, amount: Number(d.amount) }));
    const depositHeld = deposit?.paid ? deposit.amount : 0;
    const s = settle(depositHeld, rows);
    statement = {
      delivery: t.statement_delivery as DeliveryRecord, deliveredAt: t.statement_delivered_at as string, depositHeld, deductions: rows,
      total: s.total, refund: s.refund, balanceClaimed: s.balanceClaimed, documentsRequired: s.documentsRequired,
    };
  }

  return {
    today: pacificToday(),
    address: prop?.address ?? "Address not recorded",
    landlord: prop?.owner_name ?? null,
    tenants: ((t.tenants ?? []) as { name: string }[]).map((x) => x.name),
    startDate: t.start_date, endDate: t.end_date,
    deposit,
    agreement: a ? { text: a.text ?? null, paypalEmail: a.paypal_email, signedBy: a.signed_by, signedAt: a.signed_at } : null,
    photos: (photos ?? []).map((p) => ({ id: p.id as string, room: p.room as string })),
    noticeGivenOn: t.notice_given_on, plannedMoveOut: t.planned_move_out, moveOutDate: t.move_out_date,
    statementDue: t.move_out_date ? statementDue(t.move_out_date) : null,
    moveOut: (t.tenant_move_out ?? null) as TenantMoveOut | null,
    statement,
    returned: ret ? { amount: Number(ret.amount), kind: ret.kind, status: ret.status, paypalId: ret.paypal_id, at: ret.created_at } : null,
  };
}

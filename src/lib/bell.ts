import { dateIn, shortDate } from "./dates";
import { usd } from "./deductions";
import { streetLine } from "./ledger";
import { closedOut, REVERSED_STEP, type NextStep, type TenancySummary } from "./next-step";
import { packFor } from "./states";
import { tabHref } from "./tenancy-tabs";

// The bell's PayPal lines (the app shell, src/app/(landlord)/layout.tsx). A report from PayPal that needs the landlord
// shows once, under Needs you, with PayPal's detail, and not again under From PayPal: a deposit PayPal reversed on a
// unit not closed out (until then nothing can go back against it), and a refund made in PayPal still waiting to be
// recorded as the deposit's refund or marked not this deposit (reconcile.ts). Once the landlord decided it, its report
// is handled (paypalAlerts marks it) and shows nowhere: the decision is on the tenancy's Activity. Everything else PayPal
// reported stays under From PayPal. Pure, so scripts/reconcile-check.mjs reads the same rule.

export type BellLine = { title: string; sub: string; href: string; tone: "red" | "amber" | "green" };
/** A PayPal report as paypalAlerts gives it (paypal-webhook-store.ts): its line, the audit action behind it, its figure
 *  and when it came. */
export type BellReport = BellLine & { tenancyId: string; kind: string; amount: number | null; at: string; handled?: boolean };
/** The refunds made in PayPal waiting on one tenancy (outside-refunds.ts, openOutsideRefunds). */
export type BellOutside = { tenancyId: string; address: string; refunds: { amount: number | string; refunded_at: string | null }[] };

/** How many of PayPal's reports the bell shows. */
export const FROM_PAYPAL_LINES = 5;

export function paypalBell(o: { units: { summary: TenancySummary; next: NextStep }[]; reports: BellReport[]; outside: BellOutside[] }): {
  needsYou: BellLine[]; // the lines for Needs you, in this order: the reversed deposits, then the refunds made in PayPal
  fromPayPal: BellLine[]; // what is left for From PayPal
  coveredStep: (u: { summary: TenancySummary; next: NextStep }) => boolean; // a unit's own step a line above already says
} {
  const zoneOf = (id: string) => packFor(o.units.find((u) => u.summary.id === id)?.summary.state ?? "CA").timeZone.id;
  const day = (ts: string, id: string) => shortDate(dateIn(ts, zoneOf(id)));
  const reversed = o.units.filter((u) => u.summary.deposit?.reversed && !closedOut(u.summary));
  const reversedIds = new Set(reversed.map((u) => u.summary.id));
  const outsideIds = new Set(o.outside.filter((x) => x.refunds.length).map((x) => x.tenancyId));
  const reversals: BellLine[] = reversed.map((u) => {
    const report = o.reports.find((a) => a.kind === "deposit_reversed" && a.tenancyId === u.summary.id);
    const amount = report?.amount ?? u.summary.deposit?.amount ?? null;
    return {
      title: REVERSED_STEP, tone: "red", href: tabHref(u.summary.id, "payments"),
      sub: `${streetLine(u.summary.address)}, ${amount != null ? `${usd(amount)} ` : ""}reversed by PayPal${report ? ` ${day(report.at, u.summary.id)}` : ""}`,
    };
  });
  const madeInPayPal: BellLine[] = o.outside.filter((x) => x.refunds.length).map((x) => {
    const first = x.refunds[0];
    const total = Math.round(x.refunds.reduce((s, r) => s + Number(r.amount), 0) * 100) / 100;
    return {
      title: "Refund made in PayPal", tone: "amber", href: tabHref(x.tenancyId, "payments", "outside-refunds"),
      sub: x.refunds.length > 1
        ? `${streetLine(x.address)}, ${x.refunds.length} refunds, ${usd(total)}`
        : `${streetLine(x.address)}, ${usd(Number(first.amount))}${first.refunded_at ? ` on ${day(first.refunded_at, x.tenancyId)}` : ""}`,
    };
  });
  const fromPayPal = o.reports
    .filter((a) => !(a.kind === "deposit_reversed" && reversedIds.has(a.tenancyId)) && !(a.kind === "paypal_refund_unrecorded" && (outsideIds.has(a.tenancyId) || a.handled)))
    .slice(0, FROM_PAYPAL_LINES)
    .map((a) => ({ title: a.title, sub: streetLine(a.sub), href: a.href, tone: a.tone }));
  return {
    needsYou: [...reversals, ...madeInPayPal],
    fromPayPal,
    coveredStep: (u) => reversedIds.has(u.summary.id) && u.next.label === REVERSED_STEP,
  };
}

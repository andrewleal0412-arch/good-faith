// Insights: the landlord's portfolio in numbers, from the Payments ledger's own rows (ledger.ts), so every figure here
// agrees with Payments and Properties: what each tenancy collected, what went back as refunds and settlements, what
// the statements kept, what is still held, by state and over time. Pure, so the page computes it on the server and the
// filters compute it again in the browser.

import { addDays } from "./dates";
import { ledgerTotals, type LedgerRow } from "./ledger";
import type { StateCode } from "./states/types";

/** One tenancy as Insights lists it: where it is, its status chip, and its next deadline. */
export type InsightUnit = {
  id: string;
  state: StateCode;
  stateName: string;
  street: string; // the street line, the property's name in the grid
  address: string; // the whole address
  tenants: string;
  start: string | null;
  status: { label: string; tone: "green" | "amber" | "red" | "gray" };
  due: string | null; // the state's statement and refund deadline, once the tenants moved out
  deliveredOn: string | null; // the day the statement went out where the property is, for the chart of what is held over time
};

/** One tenancy's money, from its ledger rows. */
export type Money = { collected: number; returned: number; settled: number; kept: number; held: number; deducted: number; deductions: number };

const cents = (n: number) => Math.round(n * 100) / 100;
const sum = (xs: LedgerRow[]) => cents(xs.reduce((t, r) => t + r.amount, 0));
const back = (r: LedgerRow) => (r.kind === "refund" || r.kind === "payout" || r.kind === "dispute_refund") && (r.effect === "returned" || r.effect === "pending");
const settled = (r: LedgerRow) => r.kind === "settlement" && (r.effect === "returned" || r.effect === "pending");

/** A tenancy's money: collected, returned (refunds, payouts and PayPal's own refunds through a dispute), settled (a
 *  dispute's settlement on top of the statement's refund), held (as the ledger counts it), and kept: what was
 *  collected and is neither held nor gone back, which is what the statement kept net of any settlement. `deducted` is
 *  every deduction on file, drafts included, as the statement lists them, less any the deadline forfeited (New York
 *  after day 14), which keep nothing. */
export function moneyOf(rows: LedgerRow[]): Money {
  const collected = sum(rows.filter((r) => r.effect === "collected"));
  const returned = sum(rows.filter(back));
  const s = sum(rows.filter(settled));
  const held = ledgerTotals(rows).held;
  const ded = rows.filter((r) => r.kind === "deduction" && r.effect !== "forfeited");
  return {
    collected, returned, settled: s, held, kept: cents(Math.max(0, collected - returned - s - held)),
    deducted: sum(ded), deductions: ded.length,
  };
}

export type Category = "damage" | "cleaning" | "rent";
export const CATEGORY_LABEL: Record<Category, string> = { damage: "Damage", cleaning: "Cleaning", rent: "Unpaid rent" };

/** Every deduction on file by category (each pack tags them "damage", "cleaning" or "rent"), with how many; a forfeited
 *  one (New York after day 14) keeps nothing, so it isn't counted. */
export function byCategory(rows: LedgerRow[]): { category: Category; label: string; amount: number; count: number }[] {
  return (["damage", "cleaning", "rent"] as Category[]).map((c) => {
    const xs = rows.filter((r) => r.kind === "deduction" && r.effect !== "forfeited" && r.tagShort === c);
    return { category: c, label: CATEGORY_LABEL[c], amount: sum(xs), count: xs.length };
  });
}

/** The day money first moved (collected, sent back, or kept on a statement that went out): where a chart over time
 *  starts. A deposit request or a draft deduction moved nothing, so a request sent a year before its payment doesn't
 *  stretch the timeline over months of zeros. */
export function firstMoneyDate(rows: LedgerRow[]): string | null {
  return rows.reduce<string | null>((m, r) => (r.signed !== 0 && (!m || r.date < m) ? r.date : m), null);
}

export type Period = { key: string; label: string; from: string; to: string };
export type SeriesPoint = Period & { collected: number; refunds: number; settlements: number; held: number };

/** The periods a chart over time uses: weeks while the records span a little over two months, months up to two years,
 *  quarters past that, and never fewer than eight, so a young portfolio still reads as a timeline. */
export type Grain = "week" | "month" | "quarter";
export function periods(firstDate: string | null, today: string): { grain: Grain; list: Period[] } {
  const span = firstDate ? Math.round((Date.parse(`${today}T12:00:00Z`) - Date.parse(`${firstDate}T12:00:00Z`)) / 86_400_000) : 0;
  const out: Period[] = [];
  const d = new Date(`${today}T12:00:00Z`);
  const short = (iso: string) => new Date(`${iso}T12:00:00Z`).toLocaleDateString("en-US", { month: "short", day: "numeric", timeZone: "UTC" });
  if (span <= 70) {
    // Weeks from Monday.
    const monday = addDays(today, -((d.getUTCDay() + 6) % 7));
    const n = Math.max(8, Math.ceil(span / 7) + 1);
    for (let i = n - 1; i >= 0; i--) {
      const from = addDays(monday, -7 * i);
      out.push({ key: from, label: short(from), from, to: addDays(from, 6) });
    }
    return { grain: "week", list: out };
  }
  const quarter = span > 730;
  const step = quarter ? 3 : 1;
  const startMonth = quarter ? Math.floor(d.getUTCMonth() / 3) * 3 : d.getUTCMonth();
  const first = firstDate ? new Date(`${firstDate}T12:00:00Z`) : d;
  const months = (d.getUTCFullYear() - first.getUTCFullYear()) * 12 + (startMonth - first.getUTCMonth());
  const n = Math.max(8, Math.ceil(months / step) + 1);
  for (let i = n - 1; i >= 0; i--) {
    const m = new Date(Date.UTC(d.getUTCFullYear(), startMonth - step * i, 1, 12));
    const from = m.toISOString().slice(0, 10);
    const end = new Date(Date.UTC(m.getUTCFullYear(), m.getUTCMonth() + step, 0, 12)).toISOString().slice(0, 10);
    const label = quarter ? `Q${Math.floor(m.getUTCMonth() / 3) + 1} ${m.getUTCFullYear()}` : m.toLocaleDateString("en-US", { month: "short", year: m.getUTCMonth() === 0 || i === n - 1 ? "numeric" : undefined, timeZone: "UTC" });
    out.push({ key: from, label, from, to: end });
  }
  return { grain: quarter ? "quarter" : "month", list: out };
}

/** The day a row starts to count in a running balance. A deduction the ledger counts as claimed (ledger.ts) took
 *  nothing out while it was a draft: it counts from the day its statement went out (`deliveredOn`, the property's day per
 *  tenancy), or, with no delivery on record, from the first refund or Payout that went, not from the day it was
 *  entered. Every other row counts from its own date. */
function countsFrom(rows: LedgerRow[], deliveredOn: ReadonlyMap<string, string | null>): (r: LedgerRow) => string {
  const firstBack = new Map<string, string>();
  for (const r of rows) {
    if ((r.kind === "refund" || r.kind === "payout") && r.effect !== "failed" && (!firstBack.has(r.tenancyId) || r.date < firstBack.get(r.tenancyId)!)) firstBack.set(r.tenancyId, r.date);
  }
  return (r) => {
    if (r.kind !== "deduction" || r.effect !== "claimed") return r.date;
    const start = deliveredOn.get(r.tenancyId) ?? firstBack.get(r.tenancyId) ?? r.date;
    return start > r.date ? start : r.date;
  };
}

/** Each period's money: what came in, what went back as refunds and as settlements, and what was held at its end
 *  (the ledger's running balance over every row that counted by that day, countsFrom). */
export function series(rows: LedgerRow[], ps: Period[], deliveredOn: ReadonlyMap<string, string | null> = new Map()): SeriesPoint[] {
  const from = countsFrom(rows, deliveredOn);
  return ps.map((p) => {
    const inP = rows.filter((r) => r.date >= p.from && r.date <= p.to);
    return {
      ...p,
      collected: sum(inP.filter((r) => r.effect === "collected")),
      refunds: sum(inP.filter(back)),
      settlements: sum(inP.filter(settled)),
      held: ledgerTotals(rows.filter((r) => from(r) <= p.to)).held,
    };
  });
}

export type InsightRow = InsightUnit & Money & { kind: "tenancy" };
export type InsightGroup = Money & { kind: "state" | "property"; id: string; state: StateCode; stateName: string; street: string | null; label: string; count: number };

/** Each tenancy with its money, and the totals of every state and of every property with more than one tenancy. */
export function insightRows(units: InsightUnit[], rows: LedgerRow[]): { tenancies: InsightRow[]; groups: InsightGroup[]; total: Money } {
  const by = new Map<string, LedgerRow[]>();
  for (const r of rows) by.set(r.tenancyId, [...(by.get(r.tenancyId) ?? []), r]);
  const tenancies: InsightRow[] = units.map((u) => ({ ...u, ...moneyOf(by.get(u.id) ?? []), kind: "tenancy" }));
  const add = (xs: Money[]): Money => ({
    collected: cents(xs.reduce((t, x) => t + x.collected, 0)), returned: cents(xs.reduce((t, x) => t + x.returned, 0)),
    settled: cents(xs.reduce((t, x) => t + x.settled, 0)), kept: cents(xs.reduce((t, x) => t + x.kept, 0)),
    held: cents(xs.reduce((t, x) => t + x.held, 0)), deducted: cents(xs.reduce((t, x) => t + x.deducted, 0)),
    deductions: xs.reduce((t, x) => t + x.deductions, 0),
  });
  const groups: InsightGroup[] = [];
  // States by name, so the table reads the same whatever is most urgent today.
  for (const state of [...new Set(tenancies.map((t) => t.state))].sort((a, b) => units.find((u) => u.state === a)!.stateName.localeCompare(units.find((u) => u.state === b)!.stateName))) {
    const inState = tenancies.filter((t) => t.state === state);
    groups.push({ ...add(inState), kind: "state", id: `state:${state}`, state, stateName: inState[0].stateName, street: null, label: inState[0].stateName, count: inState.length });
    for (const street of [...new Set(inState.map((t) => t.street))]) {
      const here = inState.filter((t) => t.street === street);
      if (here.length > 1) groups.push({ ...add(here), kind: "property", id: `property:${state}:${street}`, state, stateName: inState[0].stateName, street, label: street, count: here.length });
    }
  }
  return { tenancies, groups, total: add(tenancies) };
}

// Editing a deduction's inputs in place: the Move-out tab's deductions grid and the route that saves it
// (PATCH /api/tenancies/[id]/deductions/[did]). Pure, so the grid checks a cell as it is typed with the same code the
// route runs before it stores anything, and the amount the grid shows is the one the server stores: both come from
// chargeable() in deductions.ts.
//
// What an edit may change: the facts the amount is computed from (the vendor's invoice, the landlord's hours and rate,
// the item's age and useful life). Never the amount itself, which stays the code's. An edit is refused when:
// - the value isn't a number the input can take;
// - the method can't compute an amount from it (chargeable's own rule);
// - the line's lawful range is $0 whatever the numbers say (a state bar, a late statement that forfeits, wear and
//   tear): the reason is the range's own;
// - the amount would go over the guidance's prorated value (a carpet over a life longer than 10 years), the cap the
//   tenants' dispute would hold it to (lawful-range.ts, guidanceCap);
// - the statement has gone out and the edit would raise the charge on it.
// Missing documents are not a reason to refuse an edit: they are the record's gap, shown on the row, and the landlord
// can still supply them. Not legal advice: the checks encode the state pack and the guidance, as the range does.

import { chargeable, usd, type DeductionInput, type Performer, type Proration, type Work } from "./deductions";
import { guidanceCap, type LineRange } from "./lawful-range";

export type EditField = "invoiceTotal" | "hours" | "hourlyRate" | "itemAgeYears" | "usefulLifeYears";
export const EDIT_FIELDS: EditField[] = ["invoiceTotal", "hours", "hourlyRate", "itemAgeYears", "usefulLifeYears"];

/** A deduction as the grid edits it: its method, the inputs, and what the code made of them. */
export type EditRow = {
  id: string;
  category: "rent" | "damage" | "cleaning";
  item: string;
  work: Work;
  performer: Performer;
  proration: Proration;
  invoiceTotal: number | null; // the vendor's invoice; null for the landlord's own labor
  hours: number | null;
  hourlyRate: number | null;
  itemAgeYears: number | null;
  usefulLifeYears: number | null;
  amount: number;
  math: string;
};

/** What holds a line beyond its own inputs: a bar that leaves $0 lawful whatever the numbers say (with the range's
 *  reason and citation), and a ceiling once the statement went out (a charge on it may only go down). */
export type EditLimits = {
  bar: { text: string; cite: string } | null;
  ceiling: number | null;
  guidanceCite: string;
};

export const FIELD_LABEL: Record<EditField, string> = {
  invoiceTotal: "Invoice", hours: "Hours", hourlyRate: "Hourly rate", itemAgeYears: "Age", usefulLifeYears: "Useful life",
};

/** The inputs each method reads: a vendor's invoice or the landlord's hours and rate, then the age (and the useful
 *  life) when the cost is prorated. Unpaid rent has none the grid can change. */
export function editableFields(r: Pick<EditRow, "category" | "performer" | "proration">): EditField[] {
  if (r.category === "rent") return [];
  const out: EditField[] = r.performer === "vendor" ? ["invoiceTotal"] : ["hours", "hourlyRate"];
  if (r.proration === "useful_life") out.push("itemAgeYears", "usefulLifeYears");
  else if (r.proration === "paint_schedule") out.push("itemAgeYears");
  return out;
}

export const inputsOf = (r: EditRow): DeductionInput => ({
  category: r.category, work: r.work, performer: r.performer, proration: r.proration,
  invoiceTotal: r.performer === "vendor" ? r.invoiceTotal : null,
  hours: r.hours, hourlyRate: r.hourlyRate, itemAgeYears: r.itemAgeYears, usefulLifeYears: r.usefulLifeYears,
});

/** Each input's own bounds: what a person could mean, not what the law allows (that comes after). */
const BOUNDS: Record<EditField, { min: number; open: boolean; max: number; say: (max: number) => string }> = {
  invoiceTotal: { min: 0, open: false, max: 100_000, say: (m) => `Enter the invoice total, from $0.00 to ${usd(m)}.` },
  hours: { min: 0, open: true, max: 200, say: (m) => `Enter the hours, more than 0 and at most ${m}.` },
  hourlyRate: { min: 0, open: false, max: 1_000, say: (m) => `Enter an hourly rate from $0.00 to ${usd(m)}.` },
  itemAgeYears: { min: 0, open: false, max: 100, say: (m) => `Enter the item's age in years, from 0 to ${m}.` },
  usefulLifeYears: { min: 0, open: true, max: 100, say: (m) => `Enter a useful life in years, more than 0 and at most ${m}.` },
};

/** A typed value as a number, or NaN: an empty cell, words, or more than two decimal places (cents). */
export function parseInput(raw: unknown): number {
  if (typeof raw === "number") return Number.isFinite(raw) ? raw : NaN;
  if (typeof raw !== "string") return NaN;
  const s = raw.replace(/[$,\s]/g, "");
  return /^\d+(\.\d{1,2})?$|^\.\d{1,2}$/.test(s) ? Number(s) : NaN;
}

export type Changes = Partial<Record<EditField, unknown>>;

export type EditResult =
  | { ok: true; row: EditRow; guidance: boolean }
  | { ok: false; field: EditField | null; reason: string; cite: string | null };

/** Inputs changed (one cell in the grid, or a few in the Edit drawer), each checked, then the amount worked out again
 *  once from all of them and held to the line's limits (limitsFor). */
export function checkEdit(row: EditRow, changes: Changes, limits: EditLimits): EditResult {
  const fields = (Object.keys(changes) as EditField[]).filter((f) => EDIT_FIELDS.includes(f));
  const last = fields[fields.length - 1] ?? null;
  const no = (reason: string, cite: string | null = null, field: EditField | null = last): EditResult => ({ ok: false, field, reason, cite });
  if (!fields.length) return no("Nothing to change.");
  const allowed = editableFields(row);
  const next: EditRow = { ...row };
  for (const field of fields) {
    if (!allowed.includes(field)) return no(`${FIELD_LABEL[field]} isn't part of how this charge is worked out.`, null, field);
    const value = parseInput(changes[field]);
    const b = BOUNDS[field];
    if (!Number.isFinite(value) || value < b.min || (b.open && value <= b.min) || value > b.max || Math.abs(Math.round(value * 100) - value * 100) > 1e-6) {
      return no(b.say(b.max), null, field);
    }
    next[field] = value;
  }
  const c = chargeable(inputsOf(next));
  if ("error" in c) return no(c.error);
  if (limits.bar && c.amount > 0.005) {
    return no(`Over the lawful range, which is $0.00 for this charge. ${limits.bar.text}`, limits.bar.cite);
  }
  const g = guidanceCap(row.item, inputsOf(next));
  if (g && c.amount > g.amount + 0.005) {
    return no(`Over the lawful range: the guidance uses a ${g.life}-year life for this item, so at ${next.itemAgeYears} year${next.itemAgeYears === 1 ? "" : "s"} old it comes to ${usd(g.amount)} at most.`, limits.guidanceCite);
  }
  if (limits.ceiling != null && c.amount > limits.ceiling + 0.005) {
    return no(`The statement went out with ${usd(limits.ceiling)} for this charge, so it can only go down now.`);
  }
  return { ok: true, row: { ...next, amount: c.amount, math: c.math }, guidance: c.guidance };
}

/** One input's value in words, for the audit log and the grid's messages. */
export const inputWords = (field: EditField, v: number | null) =>
  v == null ? "not set" : field === "invoiceTotal" || field === "hourlyRate" ? usd(v) : field === "hours" ? `${v} hour${v === 1 ? "" : "s"}` : `${v} year${v === 1 ? "" : "s"}`;

/** The limits of a line from its lawful range: the first flag that makes the range $0 on its own (a state bar, a late
 *  statement that forfeits, wear and tear), leaving out missing documents, which supplying them cures; and, once the
 *  statement is out, its amount as the ceiling. */
export function limitsFor(line: Pick<LineRange, "flags"> | null | undefined, o: { delivered: boolean; amount: number; guidanceCite: string }): EditLimits {
  const bar = line?.flags.find((f) => f.effect === "zero" && f.code !== "documents") ?? null;
  return { bar: bar ? { text: bar.text, cite: bar.cite } : null, ceiling: o.delivered ? o.amount : null, guidanceCite: o.guidanceCite };
}

/** The range engine's own verdict on a line after an edit (the route runs lawfulRanges again with the edit in place):
 *  the reason the amount is over it, or null. The same bars as limitsFor, and every cap (its own math, the guidance's
 *  useful life). `barredBefore: false` says the line had no bar before the edit, so a bar now is the edit's own doing
 *  (New York: lowering a charge on a statement that used the whole deposit leaves a refund owed, already late), and
 *  the reason says so rather than calling a value the grid showed as valid over the range. */
export function rangeBreach(line: Pick<LineRange, "flags" | "amount">, o: { barredBefore?: boolean } = {}): { reason: string; cite: string } | null {
  const bar = line.flags.find((f) => f.effect === "zero" && f.code !== "documents");
  if (bar && line.amount > 0.005) {
    return {
      reason: o.barredBefore === false
        ? `With this change the lawful range for this charge would be $0.00. ${bar.text}`
        : `Over the lawful range, which is $0.00 for this charge. ${bar.text}`,
      cite: bar.cite,
    };
  }
  const cap = line.flags.filter((f) => f.effect === "cap" && f.amount != null).sort((a, b) => a.amount! - b.amount!)[0];
  if (cap && line.amount > cap.amount! + 0.005) return { reason: `Over the lawful range: ${cap.text}`, cite: cap.cite };
  return null;
}

/** A stored deduction row (snake_case, numbers as strings) as the grid edits it. */
export function editRowOf(d: {
  id: string; category: string; item: string; work: string; performer: string; proration: string; amount: number | string; math: string;
  billed?: number | string | null; hours?: number | string | null; hourly_rate?: number | string | null;
  item_age_years?: number | string | null; useful_life_years?: number | string | null;
}): EditRow {
  const n = (v: unknown) => (v == null || v === "" || !Number.isFinite(Number(v)) ? null : Number(v));
  return {
    id: d.id, category: d.category as EditRow["category"], item: d.item, work: d.work as Work, performer: d.performer as Performer,
    proration: (d.proration || "none") as Proration,
    invoiceTotal: d.performer === "vendor" ? n(d.billed) : null,
    hours: n(d.hours), hourlyRate: n(d.hourly_rate), itemAgeYears: n(d.item_age_years), usefulLifeYears: n(d.useful_life_years),
    amount: Number(d.amount), math: d.math,
  };
}

/** The stored columns an edited row writes, as the add route writes them. */
export function storedColumns(r: EditRow) {
  return {
    billed: r.performer === "vendor" ? r.invoiceTotal : (r.hours ?? 0) * (r.hourlyRate ?? 0),
    hours: r.performer === "own_labor" ? r.hours : null,
    hourly_rate: r.performer === "own_labor" ? r.hourlyRate : null,
    item_age_years: r.itemAgeYears,
    useful_life_years: r.usefulLifeYears,
    amount: r.amount,
    math: r.math,
  };
}

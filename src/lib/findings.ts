// Move-out findings as the tenancy stores them (tenancies.move_out_findings): what the inspection suggested, or what
// the landlord added by hand, with the landlord's review of each. Pure, so the page, the client components and the
// API routes share one reading of the rules: wear and tear is never chargeable, and a finding is "accepted" either
// by a deduction made from it or, for wear and tear, by the landlord agreeing it isn't charged.

import { cleanBox, type Box } from "./boxes";

export type Classification = "wear_and_tear" | "damage" | "cleaning" | "unclear";
export type FindingStatus = "accepted" | "dismissed";

export type StoredFinding = {
  id?: string;
  room: string;
  item: string;
  label?: string | null; // a short name for the photo marker (inspections from 2026-10-02 on)
  summary?: string | null; // one line for the findings list (inspections from 2026-10-02 on)
  observation: string;
  classification: Classification;
  reason: string;
  remedy: string;
  severity: string;
  confidence: number;
  moveInPhoto?: number;
  moveOutPhoto?: number;
  moveInPath: string;
  moveOutPath: string;
  box?: unknown; // fractions of the move-out photo; read through cleanBox
  moveInBox?: unknown;
  source?: "inspection" | "landlord"; // absent on older rows, which all came from the inspection
  status?: FindingStatus | null; // the landlord's review; absent until reviewed
};

/** How each classification reads: the chip, the Why? tip's rule and its citation (docs/LEGAL_RULES.md, A and C). */
export const KIND: Record<Classification, { label: string; tone: "red" | "amber" | "gray"; rule: string; note: string; cite: string }> = {
  damage: {
    label: "Damage", tone: "red", rule: "Damage beyond ordinary wear and tear",
    note: "May be deducted: the reasonable repair cost, and a replacement prorated by age.",
    cite: "Civ. Code 1950.5(b)(2)",
  },
  cleaning: {
    label: "Cleaning", tone: "amber", rule: "Cleaning back to move-in condition",
    note: "May be deducted, only back to how clean the unit was at move-in.",
    cite: "Civ. Code 1950.5(b)(3), (e)(2)(C)",
  },
  wear_and_tear: {
    label: "Wear and tear", tone: "gray", rule: "Ordinary wear and tear",
    note: "Not chargeable under California law.",
    cite: "Civ. Code 1950.5(b)(2), (e)(2)(A); DRE guide pp. 83-85",
  },
  unclear: {
    label: "Unclear", tone: "gray", rule: "Can't tell from the photos",
    note: "Needs a better photo before anything is charged. The landlord carries the burden of showing a deduction is reasonable.",
    cite: "Civ. Code 1950.5(g)(2), (m)",
  },
};

/** The room and the two photos a finding was read from: findings that share them share one card on the page. */
export const pairKey = (f: Pick<StoredFinding, "room" | "moveInPath" | "moveOutPath">) => `${f.room}|${f.moveInPath}|${f.moveOutPath}`;

/** Findings in page order (grouped by room and photo pair, in the order the pairs first appear) and numbered down the
 *  page. The Move-out tab, its Deductions table and the photo markers all use these numbers. */
export function inPageOrder<T extends StoredFinding>(findings: T[]): (T & { n: number; pair: string })[] {
  const groups = new Map<string, T[]>();
  for (const f of findings) {
    const k = pairKey(f);
    groups.set(k, [...(groups.get(k) ?? []), f]);
  }
  let n = 0;
  return [...groups.entries()].flatMap(([pair, fs]) => fs.map((f) => ({ ...f, n: ++n, pair })));
}

/** The checked boxes of a stored finding: null for rows from before boxes, or for any value that isn't one. */
export const boxesOf = (f: StoredFinding): { box: Box | null; moveInBox: Box | null } =>
  ({ box: cleanBox(f.box), moveInBox: cleanBox(f.moveInBox) });

/** Where a thing is, as the inspection words it ("Bedroom carpet near center of room"): the title keeps the thing. */
const WHERE = /\s+(?:just\s+|directly\s+)?(?:near|below|above|beside|behind|under|over|on|in|at|along|by|next to|right of|left of)\s+/i;

/** The finding's short title: the inspection's label, or for rows from before labels, the item cut to the thing itself
 *  (before any comma or parenthesis, then before where it is when that is still long), one line at about 32 characters. */
export function findingTitle(f: { item: string; label?: string | null }): string {
  const label = f.label?.trim();
  if (label) return label;
  let t = f.item.split(/\s*[,(;]/)[0].trim() || f.item.trim();
  if (t.length > 32) {
    const thing = t.split(WHERE)[0];
    if (thing.length >= 4) t = thing;
  }
  return t.length > 32 ? t.slice(0, 32).replace(/\s+\S*$/, "") : t;
}

/** One line for the findings list: the inspection's summary, or for older rows the observation's first sentence without
 *  the "The move-out photo shows" opener, cut at a clause (or a word) near 110 characters. The full text is the title. */
export function findingLine(f: { observation: string; summary?: string | null }): string {
  const s = f.summary?.trim();
  if (s) return s;
  const body = f.observation.trim().replace(/^(?:in\s+)?the move-out photo(?:\s+shows|\s+has|,)?\s*/i, "");
  let first = body.match(/^.*?[.!?](?=\s|$)/)?.[0] ?? body;
  first = first.charAt(0).toUpperCase() + first.slice(1);
  if (first.length <= 110) return first;
  const comma = first.lastIndexOf(",", 110);
  if (comma >= 50) return `${first.slice(0, comma)}.`;
  return `${first.slice(0, 107).replace(/\s+\S*$/, "")}...`;
}

/** The first sentence of the model's reason, for the Why? tip; the full text stays on the row's title. */
export function gist(reason: string): string {
  const first = reason.match(/^.*?[.!?](?=\s|$)/)?.[0] ?? reason;
  return first.length > 160 ? `${first.slice(0, 157).replace(/\s+\S*$/, "")}...` : first;
}

// The lawful range of every deduction on an itemized statement the tenants dispute: the least and the most the landlord
// may keep of it, from the deduction's own math (deductions.ts), the documents on file, the inspection finding it came
// from, and the tenancy's state rule pack. Pure, so the dispute routes, the tenants' advocate and (next) the landlord's
// negotiator all read the same answer, and every proposal either agent makes is checked against it (checkProposal)
// before anyone sees it.
//
// The floor is $0: a landlord may always give more back. The ceiling is what the law and the record support at most:
// - $0 for ordinary wear and tear, for a charge a state rule bars outright (Washington without the signed move-in
//   checklist, or without the documents its statute requires), and for every charge when the state forfeits the
//   deposit over a late statement (New York, Washington) on every reading of the dates on file: these are "unlawful";
// - $0 for a charge missing the documents the statute requires where supplying them can still support it (California),
//   or whose own math comes to $0: these are "unsupported", since the record, not a bar, is what falls short;
// - what the deduction's own inputs give, when the stored amount is more;
// - the guidance-prorated value, when a replacement's useful life runs past the guidance's (carpet: 10 years);
// - otherwise the amount on the statement.
// What the law leaves to judgment (a replacement at full cost, the inspection suggesting cleaning where the item was
// replaced, the state's own cleaning rule, an unsure or unclear finding, evidence the statute doesn't require but the
// burden of proof does, a good-faith estimate, a late statement where lateness alone forfeits nothing or where the
// forfeiture turns on a reading or a fact the file can't settle) is flagged with the rule it turns on and leaves the
// ceiling alone. Not legal advice: the range encodes the pack's rules and the record, and a court may decide
// differently.

import { CATEGORY_ORDER } from "./copy";
import { chargeable, chargeTitle, evidenceGaps, missingDocs, settle, suggestedLife, usd, type DeductionInput, type Performer, type Proration, type StoredDeduction, type Work } from "./deductions";
import type { Notices } from "./notices";
import type { StateCode, StatePack } from "./states/types";

/** The inspection finding a deduction was made from, as the deduction snapshots it (the whole finding the landlord
 *  deducted from; older rows carry only its id and photos). */
export type FindingSnapshot = {
  id?: string; moveInPath?: string; moveOutPath?: string;
  classification?: string; remedy?: string; confidence?: number | string; severity?: string;
  item?: string; label?: string | null; summary?: string | null; observation?: string; reason?: string;
  box?: unknown; moveInBox?: unknown;
};

/** A deduction row with the inputs its amount was computed from. */
export type RangeDeduction = Omit<StoredDeduction, "finding"> & {
  billed: number | null;
  hours: number | null;
  hourly_rate: number | null;
  item_age_years: number | null;
  useful_life_years: number | null;
  finding: FindingSnapshot | null;
};

export type RangeInput = {
  deductions: RangeDeduction[]; // in the order entered; the statement's numbering is worked out here
  depositHeld: number; // what was collected, 0 when it wasn't paid
  today: string; // in the property's zone (the pack's timeZone)
  moveOutDate: string | null;
  endDate: string | null;
  plannedMoveOut: string | null;
  notices: Notices;
  deliveredOn: string | null; // the delivery record's date
  refundedOn: string | null; // the day the first refund or Payout that didn't fail was sent (the property's zone)
};

/** zero: the law allows nothing for this charge; unsupported: the record on file supports nothing for it (documents
 *  the statute requires are missing, and supplying them could still support it); cap: it allows at most `amount`;
 *  weak: a point for the tenants that leaves the ceiling alone. */
export type RangeFlag = { code: string; effect: "zero" | "unsupported" | "cap" | "weak"; text: string; cite: string; amount?: number };

export type LineRange = {
  id: string;
  n: number; // the statement's line number
  title: string;
  room: string | null;
  category: "rent" | "damage" | "cleaning";
  amount: number; // on the statement
  min: number;
  max: number;
  /** What the code alone says of the charge: unlawful (the law allows $0), unsupported (the record on file supports
   *  $0: a required document missing, or its own math), weak (capped or flagged), or solid. The advocate may argue a
   *  solid charge from the photos; it may not call a charge unlawful or unsupported the code doesn't. */
  standing: Standing;
  flags: RangeFlag[];
  reasons: string[];
  citations: string[];
};

export type Standing = "unlawful" | "unsupported" | "weak" | "solid";

export type Ranges = {
  state: StateCode;
  lines: LineRange[];
  /** Whether the statement went out late, the pack's rule, and `doubt` when the forfeiture is arguable (then `forfeits`
   *  is false and the late flag only weakens each line). `text` and `cite` are what to show: the doubt's when there is
   *  one, the rule's otherwise. */
  late: { late: boolean | null; forfeits: boolean; doubt: boolean; effect: "forfeit" | "flag"; text: string; cite: string };
  totals: {
    deducted: number; // every charge on the statement
    depositHeld: number;
    retained: number; // what the statement kept of the deposit
    maxKeep: number; // the most the landlord may keep across every line
    minBack: number; // the least that goes back to the tenants on top of the statement's refund, whatever is agreed
    maxBack: number; // the most: everything retained
  };
};

const cents = (n: number) => Math.round(n * 100) / 100;
const words = (xs: string[]) => (xs.length < 2 ? xs.join("") : `${xs.slice(0, -1).join(", ")} and ${xs[xs.length - 1]}`);
const num = (v: unknown): number | null => (v == null || v === "" || !Number.isFinite(Number(v)) ? null : Number(v));

/** The statement's order: rent, then damage, then cleaning, each in the order entered (as statement.ts numbers them). */
export function statementOrder<T extends { category: "rent" | "damage" | "cleaning" }>(rows: T[]): T[] {
  return rows.map((r, i) => ({ r, i })).sort((a, b) => CATEGORY_ORDER[a.r.category] - CATEGORY_ORDER[b.r.category] || a.i - b.i).map((x) => x.r);
}

/** What is back to the tenants, beyond the statement's refund, if the landlord keeps `keep` in all: the statement kept
 *  `retained` of the deposit, and a smaller total is returned first from that (a balance claimed over the deposit
 *  shrinks before any money moves). */
export const backFor = (r: Pick<Ranges["totals"], "retained" | "depositHeld">, keep: number) =>
  cents(Math.max(0, r.retained - Math.min(Math.max(0, keep), r.depositHeld)));

/** What a replacement comes to over the guidance's useful life, when its inputs prorate it over a longer one (carpet:
 *  10 years): the most the range allows for it. Null when the guidance has no life for the item, the charge isn't
 *  prorated by useful life, its life is within the guidance's, or its age isn't on file. The range and the deductions
 *  grid (deduction-edit.ts) both read it, so an edit is held to the same cap the tenants' dispute would be. */
export function guidanceCap(item: string, inputs: DeductionInput): { amount: number; math: string; life: number } | null {
  const life = suggestedLife(item);
  if (inputs.proration !== "useful_life" || !life || !inputs.usefulLifeYears || inputs.usefulLifeYears <= life || inputs.itemAgeYears == null) return null;
  const guided = chargeable({ ...inputs, usefulLifeYears: life });
  return "amount" in guided ? { amount: guided.amount, math: guided.math, life } : null;
}

export function lawfulRanges(input: RangeInput, pack: StatePack): Ranges {
  const rows = statementOrder(input.deductions.map((d) => ({ ...d, amount: cents(Number(d.amount)) })));
  const s = settle(input.depositHeld, rows, pack);
  const sentOn = input.deliveredOn && input.refundedOn && input.refundedOn > input.deliveredOn ? input.refundedOn : input.deliveredOn;
  const lateness = pack.dispute.isLate({
    today: input.today, moveOutDate: input.moveOutDate, endDate: input.endDate, plannedMoveOut: input.plannedMoveOut,
    notices: input.notices, deliveredOn: input.deliveredOn, refundedOn: input.refundedOn, sentOn, claimed: rows.length > 0,
    refundOwed: s.refund > 0.005,
  });
  const doubt = lateness.late ? lateness.doubt ?? null : null;
  const late: Ranges["late"] = {
    late: lateness.late, effect: pack.dispute.late.effect, doubt: !!doubt,
    forfeits: lateness.late === true && pack.dispute.late.effect === "forfeit" && !doubt,
    text: doubt?.text ?? pack.dispute.late.text, cite: doubt?.cite ?? pack.dispute.late.cite,
  };
  const lines = rows.map((d, i) => lineRange(d, i + 1, { pack, documentsRequired: s.documentsRequired, late, notices: input.notices }));
  const deducted = s.total;
  const retained = cents(Math.min(deducted, input.depositHeld));
  const maxKeep = cents(lines.reduce((t, l) => t + l.max, 0));
  const totals = { deducted, depositHeld: cents(input.depositHeld), retained, maxKeep, minBack: 0, maxBack: retained };
  totals.minBack = backFor(totals, maxKeep);
  return { state: pack.code, lines, late, totals };
}

function lineRange(d: RangeDeduction, n: number, ctx: { pack: StatePack; documentsRequired: boolean; late: Ranges["late"]; notices: Notices }): LineRange {
  const { pack } = ctx;
  const flags: RangeFlag[] = [];
  const add = (code: string, effect: RangeFlag["effect"], text: string, cite: string, amount?: number) =>
    flags.push({ code, effect, text, cite, ...(amount != null ? { amount: cents(amount) } : {}) });
  const rent = d.category === "rent";
  const finding = d.finding ?? null;
  const cls = finding?.classification ?? null;
  const kind = d.category === "rent" ? null : pack.findings[d.category];

  // The statement as a whole: a late one forfeits everything in some states and is only evidence in others, or where
  // the forfeiture turns on a reading of the dates or a fact the file doesn't record.
  if (ctx.late.late) add("late", ctx.late.forfeits ? "zero" : "weak", ctx.late.text, ctx.late.cite);

  // A rule that bars the line before any evidence (Washington's checklist).
  const bar = pack.dispute.lineBar?.(d, ctx.notices);
  if (bar) add("barred", "zero", bar.text, bar.cite);

  if (!rent) {
    if (cls === "wear_and_tear") {
      add("wear_and_tear", "zero", `${pack.findings.wear_and_tear.rule}. ${pack.findings.wear_and_tear.note}`, pack.findings.wear_and_tear.cite);
    }

    // The documents the statute requires (California over $125 and the after photo; Washington always). Texas's
    // "some evidence" is product policy, not statute, so it only weakens the line, below. Where supplying them can
    // still support the charge (California), it is unsupported; where the gap bars it (Washington), unlawful.
    const POLICY = /^evidence /;
    const required = missingDocs(d as StoredDeduction, ctx.documentsRequired, pack).filter((m) => !POLICY.test(m));
    if (required.length) {
      const photoOnly = required.length === 1 && required[0] === "after-repair photo";
      const cite = (photoOnly ? pack.documents.afterPhotoTip.cite : null) ?? pack.statement.documentsCite(true);
      const cure = pack.dispute.documentsCure;
      add("documents", cure ? "unsupported" : "zero",
        `The statement has no ${words(required)} for this charge, which the law requires with it.${cure ? ` ${cure.text}` : ""}`,
        cure ? `${cite}; ${cure.cite}` : cite);
    }

    // The amount against its own inputs, and a replacement's useful life against the guidance's.
    const inputs = {
      category: d.category, work: d.work as Work, performer: d.performer as Performer, proration: d.proration as Proration,
      invoiceTotal: num(d.billed), hours: num(d.hours), hourlyRate: num(d.hourly_rate),
      itemAgeYears: num(d.item_age_years), usefulLifeYears: num(d.useful_life_years),
    };
    const again = chargeable(inputs);
    if ("amount" in again && again.amount < d.amount - 0.005) {
      add("math", "cap", `Its own inputs come to ${usd(again.amount)}, not the ${usd(d.amount)} charged: ${again.math}.`, kind!.cite, again.amount);
    }
    const guided = guidanceCap(d.item, inputs);
    if (guided && guided.amount < d.amount - 0.005) {
      add("useful_life", "cap", `Prorated over a ${inputs.usefulLifeYears}-year life where the guidance uses ${guided.life} years: ${guided.math}.`, pack.copy.guidanceCite, guided.amount);
    }
    if (d.work === "replace" && d.proration === "none") {
      add("full_cost", "weak", `Replaced at full cost, with nothing taken off for the item's age. ${pack.copy.guidanceNote}`, pack.copy.guidanceCite);
    } else if (d.work === "replace" && d.proration === "useful_life" && (inputs.itemAgeYears == null || inputs.usefulLifeYears == null)) {
      add("full_cost", "weak", `Prorated by useful life, but the item's ${inputs.itemAgeYears == null ? "age" : "useful life"} isn't on file, so nothing shows what was taken off for its age. ${pack.copy.guidanceNote}`, pack.copy.guidanceCite);
    }

    // What the inspection said of it.
    if (finding?.remedy === "clean" && d.work === "replace") {
      add("remedy", "weak", `The photo comparison suggested cleaning, and the item was replaced.${d.note ? " The landlord's note says why." : " No note says why."}`, kind!.cite);
    } else if (finding?.remedy === "none") {
      add("remedy", "weak", "The photo comparison suggested no work for this.", kind!.cite);
    }
    if (cls === "unclear") add("unclear", "weak", `${pack.findings.unclear.rule}. ${pack.findings.unclear.note}`, pack.findings.unclear.cite);
    const conf = num(finding?.confidence);
    if (cls && cls !== "unclear" && cls !== "wear_and_tear" && conf != null && conf < 0.6) {
      add("unsure", "weak", `The photo comparison was unsure of this (${Math.round(conf * 100)}% sure). ${pack.dispute.evidence.text}`, pack.dispute.evidence.cite);
    }
    const cleaning = pack.dispute.cleaningRule?.({ category: d.category, performer: d.performer, item: d.item });
    if (cleaning) add("cleaning_rule", "weak", cleaning.text, cleaning.cite);

    // Evidence the statute leaves out but the burden of proof asks for.
    const gaps = [...evidenceGaps(d as StoredDeduction, pack), ...missingDocs(d as StoredDeduction, ctx.documentsRequired, pack).filter((m) => POLICY.test(m)).map(() => "evidence")];
    if (gaps.length) add("evidence", "weak", `No ${words([...new Set(gaps)])} on file for it. ${pack.dispute.evidence.text}`, pack.dispute.evidence.cite);
    if (d.is_estimate) add("estimate", "weak", `${pack.documents.estimateTip.title}: ${pack.documents.estimateTip.text}`, pack.documents.estimateTip.cite ?? pack.dispute.evidence.cite);
  }

  const zero = flags.some((f) => f.effect === "zero");
  const unsupported = flags.some((f) => f.effect === "unsupported");
  const caps = flags.filter((f) => f.effect === "cap").map((f) => f.amount!);
  const max = zero || unsupported ? 0 : cents(Math.max(0, Math.min(d.amount, ...caps)));
  // A cap that reaches $0 (the charge's own math, or the guidance's life) leaves nothing on file to support it.
  const standing: Standing = zero ? "unlawful" : unsupported || (max === 0 && d.amount > 0) ? "unsupported" : flags.length ? "weak" : "solid";
  const own = rent ? pack.statute.tagCite(pack.tags.rent.tag) : kind!.cite;
  const reasons = flags.length ? flags.map((f) => f.text) : [rent
    ? "Unpaid rent as the statement lists it. The rent ledger isn't in the app, so the code can't check it."
    : `Nothing on file limits this charge: ${kind!.rule.toLowerCase()}, with the documents the state asks for.`];
  return {
    id: d.id, n, title: rent ? d.item : chargeTitle(d.item, d.work as Work).title, room: d.room, category: d.category, amount: d.amount,
    min: 0, max, standing, flags, reasons,
    citations: [...new Set(flags.length ? flags.map((f) => f.cite) : [own])],
  };
}

/** Every citation an agent may use on a case over these ranges: the ranges' own and the pack's rule cites. An agent
 *  copies one; anything else is replaced with the line's first (advocate.ts, negotiator.ts, chargeback-store.ts). It
 *  lives here, with the ranges, so a page that only shows a case's citations doesn't load an agent and its model SDK. */
export function allowedCitations(pack: StatePack, ranges: Ranges): string[] {
  const own = ranges.lines.flatMap((l) => l.citations);
  const kinds = (["damage", "cleaning", "wear_and_tear", "unclear"] as const).map((k) => pack.findings[k].cite);
  const tags = (["rent", "damage", "cleaning"] as const).map((k) => pack.statute.tagCite(pack.tags[k].tag));
  return [...new Set([...own, ...kinds, ...tags, pack.dispute.late.cite, ranges.late.cite, pack.dispute.evidence.cite, pack.copy.guidanceCite,
    pack.documents.afterPhotoTip.cite, pack.documents.estimateTip.cite, pack.statement.documentsCite(true), pack.deadline.tip.cite].filter((c): c is string => !!c))];
}

/* ---------- Checking a proposal ---------- */

export type ProposalLine = { id: string; n: number; amount: number; asked: number | null; keep: number; min: number; max: number; problem: string | null };
export type ProposalCheck = { ok: boolean; lines: ProposalLine[]; totalKeep: number; amountBack: number; problems: string[] };

/** A proposal (what one side proposes the landlord keeps of each charge) checked against the ranges: each keep is
 *  clamped into its range, a line left out keeps what the statement charged (as far as its range allows), and an id
 *  that isn't on the statement is refused. `ok` is false when anything had to change, and `problems` says what. */
export function checkProposal(r: Ranges, keeps: Record<string, number | null | undefined>): ProposalCheck {
  const problems: string[] = [];
  for (const id of Object.keys(keeps)) if (!r.lines.some((l) => l.id === id)) problems.push(`No deduction ${id} on this statement.`);
  const lines = r.lines.map((l): ProposalLine => {
    const raw = keeps[l.id];
    const asked = raw == null ? null : Number(raw);
    let keep = asked == null ? l.amount : asked;
    let problem: string | null = null;
    if (!Number.isFinite(keep)) { problem = `Line ${l.n}: not an amount.`; keep = l.max; }
    keep = cents(keep);
    if (keep > l.max) {
      if (asked != null) problem = `Line ${l.n}: ${usd(keep)} is more than the ${usd(l.max)} the law and the record support.`;
      keep = l.max;
    } else if (keep < l.min) {
      problem = `Line ${l.n}: below ${usd(l.min)}.`;
      keep = l.min;
    }
    if (problem) problems.push(problem);
    return { id: l.id, n: l.n, amount: l.amount, asked, keep, min: l.min, max: l.max, problem };
  });
  const totalKeep = cents(lines.reduce((t, l) => t + l.keep, 0));
  return { ok: !problems.length, lines, totalKeep, amountBack: backFor(r.totals, totalKeep), problems };
}

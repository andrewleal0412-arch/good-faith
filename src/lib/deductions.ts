// Deduction math, shared by the form (live preview) and the server (the stored amount). Pure functions only.
// Statute vs guidance (docs/LEGAL_RULES.md section C): the $125 documentation threshold and the 21-day deadline are
// Civ. Code 1950.5; useful-life proration and the paint schedule are DRE guidance, so the statement labels them.

export type Work = "repair" | "replace" | "clean" | "other";
export type Performer = "vendor" | "own_labor";
export type Proration = "none" | "useful_life" | "paint_schedule";

export type DeductionInput = {
  category: "rent" | "damage" | "cleaning";
  work: Work;
  performer: Performer;
  invoiceTotal?: number | null;
  hours?: number | null;
  hourlyRate?: number | null;
  proration: Proration;
  itemAgeYears?: number | null;
  usefulLifeYears?: number | null;
};

export const usd = (n: number) => `$${n.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
const cents = (n: number) => Math.round(n * 100) / 100;
const yrs = (n: number) => `${n} year${n === 1 ? "" : "s"}`;

/** What the work cost before any proration: the vendor's invoice, or hours x rate for the landlord's own labor (h)(2)(A). */
export function billed(d: DeductionInput): number | null {
  if (d.performer === "vendor") return d.invoiceTotal != null && d.invoiceTotal >= 0 ? cents(d.invoiceTotal) : null;
  if (d.hours == null || d.hourlyRate == null || d.hours <= 0 || d.hourlyRate < 0) return null;
  return cents(d.hours * d.hourlyRate);
}

/** DRE paint schedule (2-year life): under 6 months full cost, 6-12 months two thirds, 1-2 years one third, then nothing. */
export function paintShare(ageYears: number): number {
  if (ageYears < 0.5) return 1;
  if (ageYears < 1) return 2 / 3;
  if (ageYears < 2) return 1 / 3;
  return 0;
}

/** The chargeable amount and a one-line explanation of how it was reached (the "written explanation of the cost",
 *  (h)(2)(D)). Returns an error string when an input the method needs is missing. */
export function chargeable(d: DeductionInput): { amount: number; math: string; guidance: boolean } | { error: string } {
  const base = billed(d);
  if (base == null) {
    return { error: d.performer === "vendor" ? "Enter the invoice total." : "Enter the hours and the hourly rate." };
  }
  const labor = d.performer === "own_labor" ? `${d.hours} hour${d.hours === 1 ? "" : "s"} × ${usd(d.hourlyRate!)}/hour` : null;

  if (d.proration === "useful_life") {
    const age = d.itemAgeYears, life = d.usefulLifeYears;
    if (age == null || life == null || life <= 0 || age < 0) return { error: "Enter the item's age and its useful life." };
    const left = Math.max(0, life - age);
    const amount = cents(base * (left / life));
    return {
      amount, guidance: true,
      math: `${labor ? `${labor} = ${usd(base)}, ` : `${usd(base)} `}× ${yrs(left)} left of a ${life}-year useful life (${yrs(age)} old) = ${usd(amount)}`,
    };
  }
  if (d.proration === "paint_schedule") {
    const age = d.itemAgeYears;
    if (age == null || age < 0) return { error: "Enter how long ago it was painted." };
    const share = paintShare(age);
    const amount = cents(base * share);
    const label = share === 1 ? "full cost" : share === 0 ? "nothing" : share > 0.5 ? "two thirds" : "one third";
    return {
      amount, guidance: true,
      math: `${labor ? `${labor} = ${usd(base)}, ` : `${usd(base)} `}× ${label} (paint ${yrs(age)} old, 2-year paint schedule) = ${usd(amount)}`,
    };
  }
  return { amount: base, guidance: false, math: labor ? `${labor} = ${usd(base)}` : `Vendor invoice: ${usd(base)}` };
}

/** Sensible default proration for a finding: replacements prorate by useful life; repairs and cleaning don't. */
export function defaultProration(work: Work): Proration {
  return work === "replace" ? "useful_life" : "none";
}

/** Useful life to suggest. Only carpet has a DRE worked example (10 years); everything else the landlord enters. */
export function suggestedLife(item: string): number | null {
  return /carpet/i.test(item) ? 10 : null;
}

/** (h)(4): receipts and invoices aren't required when repair and cleaning deductions total $125 or less. */
export const RECEIPT_THRESHOLD = 125;

export type StoredDeduction = {
  id: string;
  category: "rent" | "damage" | "cleaning";
  room: string | null;
  item: string;
  work: Work;
  performer: Performer;
  amount: number;
  math: string;
  proration: Proration;
  is_estimate: boolean;
  receipt_path: string | null;
  after_photo_paths: string[];
  vendor: { name?: string; address?: string; phone?: string } | null;
  labor_description: string | null;
  note?: string | null; // why the work was done, for the statement with the cost ((h)(2)(D)); absent on older rows
  finding: { id?: string; moveInPath?: string; moveOutPath?: string } | null;
};

/** What the statement still needs for each deduction under (h)(2) and (g)(2). Empty when it's complete.
 *  A good-faith estimate (h)(3) stands in for the finished repair and its invoice, so it needs neither the after
 *  photo nor the receipt yet; the vendor's name, address and phone take the invoice's place. */
export function missingDocs(d: StoredDeduction, documentsRequired: boolean): string[] {
  const out: string[] = [];
  if (d.category === "rent") return out;
  if (!d.after_photo_paths.length && !d.is_estimate) out.push("after-repair photo");
  if (!documentsRequired) return out;
  if (d.performer === "vendor") {
    if (!d.receipt_path && !d.is_estimate) out.push("invoice or receipt");
    if (!d.vendor?.name || !d.vendor?.address || !d.vendor?.phone) out.push("vendor name, address and phone");
  } else if (!d.labor_description) out.push("description of the work");
  return out;
}

/** Deposit held minus deductions. A negative balance is a claim against the tenant, never collected automatically. */
export function settle(depositHeld: number, deductions: { category: string; amount: number }[]) {
  const total = cents(deductions.reduce((s, d) => s + Number(d.amount), 0));
  const repairAndCleaning = cents(deductions.filter((d) => d.category !== "rent").reduce((s, d) => s + Number(d.amount), 0));
  const refund = cents(depositHeld - total);
  return {
    total, repairAndCleaning, refund: Math.max(0, refund), balanceClaimed: refund < 0 ? -refund : 0,
    documentsRequired: repairAndCleaning > RECEIPT_THRESHOLD,
  };
}

/** (h)(1): the itemized statement and refund are due within 21 calendar days after the tenant vacates. */
export function statementDue(moveOutDate: string): string {
  const d = new Date(`${moveOutDate}T12:00:00Z`);
  d.setUTCDate(d.getUTCDate() + 21);
  return d.toISOString().slice(0, 10);
}

import "server-only";
import { pacificDate } from "./dates";
import { db } from "./db";
import { depositNotOurs, POOL_EMPTY } from "./demo-pool";
import { missingDocs, settle, statementDue, usd, type StoredDeduction } from "./deductions";
import { wasPaid } from "./invoice-status";
import { getInvoice, type Invoice } from "./paypal";

// The move-out close-out, in plain code. The agent reads these facts and drives PayPal, but what may be refunded,
// how, and to whom is decided here, and every money tool re-checks it at the moment it runs (guardRefund).
//
// Rules (docs/LEGAL_RULES.md): refund within 21 days of move-out (D15); paid electronically means refunded
// electronically, by PayPal only with the tenants' written agreement (D16, AB 414); one refund for all adults unless
// they agreed to split it (D19); deductions over $125 need their documents (D20, D22).
// PayPal: a payment can be refunded against itself for 180 days; after that the money goes out as a Payout.

export const REFUND_WINDOW_DAYS = 180;

export type Rail = "refund_original_payment" | "payout" | "nothing_to_refund" | "blocked";

export type CloseOutFacts = {
  today: string;
  tenancy: { address: string; tenants: string[]; moveOutDate: string | null; statementDue: string | null; daysLeft: number | null };
  deposit: { invoiceId: string; status: string; amount: number; paidAt: string | null; method: string | null; captureId: string | null;
    daysSincePaid: number | null; billedTo: string | null; live: boolean } | null;
  refundAgreement: { paypalEmail: string; signedBy: string[]; signedAt: string } | null;
  deductions: { item: string; room: string | null; category: string; amount: number; math: string; missingDocs: string[] }[];
  totals: { depositHeld: number; deductions: number; refund: number; balanceClaimed: number; documentsRequired: boolean };
  alreadyReturned: { kind: string; amount: number; paypalId: string; at: string } | null;
  plan: { rail: Rail; amount: number; captureId?: string; email?: string; why: string };
  blockers: string[];
  warnings: string[];
  rules: typeof RULES;
};

/** The only citations the agent may use. It cites from this list, never from memory (it mixed up (g) and (h)). */
export const RULES = {
  deadline: "Civ. Code 1950.5(h)(1): the itemized statement and the refund are due within 21 days after the tenant vacates.",
  electronicRefund: "Civ. Code 1950.5(h)(1)(A): when the landlord received the deposit or the rent electronically, the deposit is refunded electronically, and by PayPal only if the tenant agreed in writing.",
  roommates: "Civ. Code 1950.5(h)(1)(C): one refund for all adult tenants unless every adult signed an allocation agreement.",
  documents: "Civ. Code 1950.5(h)(2): the statement includes invoices or receipts, labor time and hourly rate, and the photos, unless repair and cleaning deductions total $125 or less ((h)(4)).",
  photos: "Civ. Code 1950.5(g)(2): photos of each item before and after the repair or cleaning that is deducted.",
  estimate: "Civ. Code 1950.5(h)(3): if a repair isn't finished or a document isn't in hand within the 21 days, the statement deducts a good-faith estimate with the vendor's contact details, and the final documents follow within 14 days of completion or receipt.",
  delivery: "Civ. Code 1950.5(h)(1)(B) and (h)(6): the statement goes by personal delivery or first-class mail to the address the tenant provided, or to the vacated unit if none; email only if the landlord and tenant agreed to it in writing.",
  wearAndTear: "Civ. Code 1950.5(b)(2) and (e)(1)-(2): ordinary wear and tear and conditions that predate the tenancy can't be deducted.",
  badFaith: "Civ. Code 1950.5(h)(7) and (m): bad-faith retention can cost up to twice the deposit in statutory damages.",
  usefulLife: "Useful-life proration and the paint schedule come from the DRE's California Tenants guide. They are guidance, not statute.",
  refundWindow: "PayPal policy, not law: a payment can be refunded against itself for 180 days; after that the money goes out as a Payout.",
};

const pacificToday = () => new Date().toLocaleDateString("en-CA", { timeZone: "America/Los_Angeles" });
const daysBetween = (from: string, to: string) => Math.round((Date.parse(to) - Date.parse(from)) / 86_400_000);
const days = (n: number) => `${n} day${n === 1 ? "" : "s"}`;
/** How long ago a payment was, in words: today, yesterday, or so many days ago. */
export const paidAgo = (n: number) => (n <= 0 ? "today" : n === 1 ? "yesterday" : `${days(n)} ago`);

export async function closeOutFacts(tenancyId: string): Promise<CloseOutFacts> {
  const today = pacificToday();
  const [{ data: t }, { data: payments }, { data: rows }] = await Promise.all([
    db.from("tenancies").select("*, properties(address)").eq("id", tenancyId).single(),
    db.from("payments").select("*").eq("tenancy_id", tenancyId).order("created_at"),
    db.from("deductions").select("*").eq("tenancy_id", tenancyId).order("created_at"),
  ]);
  if (!t) throw new Error("No such tenancy.");
  const blockers: string[] = [];
  const warnings: string[] = [];

  const moveOut = t.move_out_date as string | null;
  const due = moveOut ? statementDue(moveOut) : null;
  const daysLeft = due ? daysBetween(today, due) : null;
  if (!moveOut) blockers.push("Set the move-out date first: it starts the 21-day clock.");
  if (daysLeft != null && daysLeft < 0) warnings.push(`The 21-day deadline passed ${days(-daysLeft)} ago. Refund now; a late statement risks the whole deposit if a court finds bad faith (1950.5(h)(7), (m)).`);

  // The deposit as PayPal reports it right now, not as we stored it. If PayPal can't be reached, the statement still
  // renders from what the tenancy page last stored, but no money moves on stale facts: the outage is a blocker.
  const inv = (payments ?? []).find((p) => p.kind === "deposit_invoice");
  let deposit: CloseOutFacts["deposit"] = null;
  if (inv?.paypal_id) {
    let live: Invoice, isLive = true;
    try {
      live = await getInvoice(inv.paypal_id);
    } catch (e) {
      console.error("PayPal invoice lookup failed; using the stored status", e);
      isLive = false;
      live = { id: inv.paypal_id, status: inv.status, payments: { transactions: (inv.raw as Invoice["payments"] | null)?.transactions ?? [] } };
      blockers.push("PayPal couldn't be reached, so the deposit's status is as last recorded. Try again in a minute before returning any money.");
    }
    const txn = live.payments?.transactions?.[0];
    const paidAt = txn?.payment_date_time ?? null;
    deposit = {
      invoiceId: live.id, status: live.status, amount: Number(inv.amount), paidAt, method: txn?.method ?? null,
      captureId: txn?.payment_id ?? null,
      // The Pacific day it was paid, as every page shows it, so "Paid yesterday" and the payment's date agree.
      daysSincePaid: paidAt ? daysBetween(pacificDate(paidAt), today) : null,
      billedTo: live.primary_recipients?.[0]?.billing_info?.email_address ?? null,
      live: isLive,
    };
    if (!wasPaid(live.status)) blockers.push(`The deposit invoice is ${live.status.toLowerCase().replace(/_/g, " ")} in PayPal, not paid, so there's nothing to return through PayPal.`);
  } else {
    blockers.push("No deposit was collected through PayPal for this tenancy.");
  }

  const agreement = t.refund_agreement as { paypal_email: string; signed_by: string[]; signed_at: string } | null;
  if (!agreement) blockers.push("No written refund-method agreement: PayPal can't be used without it (1950.5(h)(1)(A)).");

  const deductions = (rows ?? []).map((d) => ({ ...d, amount: Number(d.amount) })) as StoredDeduction[];
  const depositHeld = deposit && wasPaid(deposit.status) ? deposit.amount : 0;
  const s = settle(depositHeld, deductions);
  const items = deductions.map((d) => ({
    item: d.item, room: d.room, category: d.category, amount: d.amount, math: d.math, missingDocs: missingDocs(d, s.documentsRequired),
  }));
  for (const d of items) if (d.missingDocs.length) blockers.push(`${d.item}: still needs ${d.missingDocs.join(", ")}. Add it or remove the deduction.`);

  const returned = (payments ?? []).find((p) => p.kind === "refund" || p.kind === "payout");
  const alreadyReturned = returned
    ? { kind: returned.kind, amount: Number(returned.amount), paypalId: returned.paypal_id, at: returned.created_at }
    : null;
  // A demo copy refunds only a sandbox deposit of its own (src/lib/demo-pool.ts): one made when the pool was empty
  // shows the template's deposit, which is never refunded from a copy.
  if (!alreadyReturned && inv?.paypal_id && (await depositNotOurs(t.workspace_id as string, inv.paypal_id))) blockers.push(POOL_EMPTY);
  if (alreadyReturned) blockers.push(`The deposit was already returned: ${usd(alreadyReturned.amount)} by PayPal ${alreadyReturned.kind} ${alreadyReturned.paypalId} on ${alreadyReturned.at.slice(0, 10)}, sent by this close-out after the landlord approved it. Don't send another.`);

  const facts: CloseOutFacts = {
    today,
    tenancy: { address: (t.properties as { address: string }).address, tenants: (t.tenants as { name: string }[]).map((x) => x.name),
      moveOutDate: moveOut, statementDue: due, daysLeft },
    deposit,
    refundAgreement: agreement ? { paypalEmail: agreement.paypal_email, signedBy: agreement.signed_by, signedAt: agreement.signed_at } : null,
    deductions: items,
    totals: { depositHeld, deductions: s.total, refund: s.refund, balanceClaimed: s.balanceClaimed, documentsRequired: s.documentsRequired },
    alreadyReturned,
    plan: { rail: "blocked", amount: 0, why: "" },
    blockers,
    warnings,
    rules: RULES,
  };
  facts.plan = plan(facts);
  return facts;
}

function plan(f: CloseOutFacts): CloseOutFacts["plan"] {
  if (f.blockers.length) return { rail: "blocked", amount: 0, why: "Resolve the blockers first." };
  const amount = f.totals.refund;
  if (amount <= 0) {
    return { rail: "nothing_to_refund", amount: 0,
      why: `Deductions use the whole deposit${f.totals.balanceClaimed ? `, leaving ${usd(f.totals.balanceClaimed)} claimed from the tenants` : ""}. The itemized statement still goes out.` };
  }
  const email = f.refundAgreement!.paypalEmail;
  const d = f.deposit!;
  const sameAccount = !!d.billedTo && d.billedTo.toLowerCase() === email.toLowerCase();
  if (d.captureId && d.daysSincePaid != null && d.daysSincePaid <= REFUND_WINDOW_DAYS && sameAccount) {
    return { rail: "refund_original_payment", amount, captureId: d.captureId, email,
      why: `Paid ${paidAgo(d.daysSincePaid)} through PayPal from the account the tenants designated, inside PayPal's ${REFUND_WINDOW_DAYS}-day refund window, so the refund goes back against that payment.` };
  }
  return { rail: "payout", amount, email,
    why: !d.captureId ? "There's no PayPal payment to refund against, so the money goes out as a Payout to the designated account."
      : !sameAccount ? `The deposit was billed to ${d.billedTo ?? "another address"}, not the account the tenants designated, so it goes out as a Payout to ${email}.`
        : d.daysSincePaid == null ? `PayPal has no payment date for the deposit, so it goes out as a Payout to ${email}.`
          : `The deposit was paid ${days(d.daysSincePaid)} ago, past PayPal's ${REFUND_WINDOW_DAYS}-day refund window, so it goes out as a Payout to ${email}.` };
}

export type RefundIntent = { rail: Rail; amount: string; captureId?: string; email?: string };

/** The last word before money moves: recomputed from the database and PayPal at that moment, so a deduction edited
 *  after the agent proposed the refund, a second click, or a model mistake all stop here. Null means go. */
export async function guardRefund(tenancyId: string, p: RefundIntent) {
  return guardWithFacts(await closeOutFacts(tenancyId), p);
}

/** guardRefund's check against facts already loaded: for a page that has just read them and shows the answer. The
 *  money routes always call guardRefund, which reads the facts fresh. */
export function guardWithFacts(f: CloseOutFacts, p: RefundIntent) {
  if (f.plan.rail === "blocked") return `Blocked: ${f.blockers.join(" ")}`;
  if (p.rail !== f.plan.rail) return `Blocked: the rules call for ${f.plan.rail.replace(/_/g, " ")}, not ${p.rail.replace(/_/g, " ")}. ${f.plan.why}`;
  if (p.amount !== f.plan.amount.toFixed(2)) return `Blocked: the refund owed is ${usd(f.plan.amount)} (deposit ${usd(f.totals.depositHeld)} minus ${usd(f.totals.deductions)} in deductions), not $${p.amount}.`;
  if (p.rail === "refund_original_payment" && p.captureId !== f.plan.captureId) return `Blocked: the deposit payment is ${f.plan.captureId}, not ${p.captureId}.`;
  if (p.rail === "payout" && p.email?.toLowerCase() !== f.plan.email?.toLowerCase()) return `Blocked: the tenants designated ${f.plan.email}, not ${p.email}.`;
  return null;
}

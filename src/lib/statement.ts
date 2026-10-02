import "server-only";
import { closeOutFacts, type CloseOutFacts } from "./closeout";
import { TAGS } from "./copy";
import { db } from "./db";
import { missingDocs, RECEIPT_THRESHOLD, usd, type Proration, type StoredDeduction, type Work } from "./deductions";
import { paidElectronically, wasPaid } from "./invoice-status";
import { lawfulDeposit, MOVE_IN_PHOTOS_FROM, totalSecurity, type LeaseTerms } from "./rules";
import { tenantMoveOutUpdatedOn, type TenantMoveOut } from "./tenant";

// The itemized security deposit statement (Civ. Code 1950.5(h)): everything the document needs, from the database and
// PayPal's live state, in the order of docs/LEGAL_RULES.md section B. The rules themselves live in closeout.ts and
// deductions.ts; this file arranges their answers and grades the 13-item checklist so the page can show completeness.

export type Category = "rent" | "damage" | "cleaning";

// The (b) tags live in copy.ts, which has no server imports, so the ledger grid can read them in the browser too.
export { TAGS } from "./copy";

export type ChecklistState = "done" | "missing" | "not_applicable";
export type ChecklistItem = { n: number; title: string; cite: string; state: ChecklistState; reason: string };

export type StatementPhoto = { role: "move_in" | "move_out_before" | "move_out_after"; label: string; path: string };

export type StatementDeduction = {
  id: string;
  n: number;
  category: Category;
  tag: string;
  tagLabel: string;
  room: string | null;
  item: string;
  work: Work;
  amount: number;
  explanation: string; // the stored math: the written explanation of the cost, (h)(2)(D)
  note: string | null; // why the work was done, in the landlord's words: the rest of that explanation
  proration: Proration;
  guidance: boolean; // prorated by useful life or the paint schedule, which is DRE guidance and not statute
  isEstimate: boolean;
  labor: { description: string | null; hours: number | null; hourlyRate: number | null } | null;
  vendor: { name: string | null; address: string | null; phone: string | null; invoicePath: string | null } | null;
  photos: StatementPhoto[];
  missing: string[];
};

export type DeliveryRecord = {
  method: "personal" | "mail" | "email";
  date: string; // YYYY-MM-DD; the statement is dated the day it goes out
  to: string | null; // the adult tenant it went to; any one of them will do ((h)(1)(C))
  address: string | null; // mail: the forwarding address, or the unit when there is none ((h)(6))
  address_kind?: "forwarding" | "unit" | null; // mail: which of the two (h)(6) addresses it was
  email: string | null;
  by_agreement: boolean; // email is allowed only by written agreement ((h)(1)(B))
};

export type Statement = {
  tenancyId: string;
  today: string; // the live Pacific date, for the delivery form
  statementDate: string; // the date on the document: the delivery date once recorded, else today
  landlord: string;
  property: { address: string; city: string | null };
  tenants: string[];
  tenantContacts: { name: string; email: string | null }[];
  moveOutDate: string | null;
  statementDue: string | null;
  daysLeft: number | null; // the live countdown while the statement is a draft; null once delivered
  security: {
    amount: number; paid: boolean; electronic: boolean; live: boolean; paidAt: string | null; method: string | null;
    invoiceId: string; invoiceStatus: string; leaseAsked: number | null; cap: number | null; basisNote: string | null;
  } | null;
  deductions: StatementDeduction[];
  totals: CloseOutFacts["totals"] & { repairAndCleaning: number };
  documents: { required: boolean; note: string }; // the rule that applies; what is attached is stated by each rendering
  refund: {
    amount: number;
    state: "sent" | "due" | "none";
    method: string;
    paypalId: string | null;
    sentAt: string | null;
    paypalEmail: string | null;
    payees: string[];
    agreement: { signedBy: string[]; signedAt: string } | null;
    note: string;
  };
  balanceClaimed: { amount: number; text: string } | null;
  interest: { city: string | null; known: boolean; note: string; checkReason: string };
  delivery: DeliveryRecord | null;
  deliveredAt: string | null;
  tenantForwarding: { address: string; name: string | null; date: string } | null; // given by the tenants through their link, for (h)(6)
  checklist: ChecklistItem[];
};

export const longDate = (iso: string) =>
  new Date(`${iso.slice(0, 10)}T12:00:00Z`).toLocaleDateString("en-US", { month: "long", day: "numeric", year: "numeric", timeZone: "UTC" });

/** The Pacific calendar date of a timestamp. */
export const pacificDate = (ts: string) => new Date(ts).toLocaleDateString("en-CA", { timeZone: "America/Los_Angeles" });

// The disclaimers live in copy.ts, which has no server imports, so the static home page can print one too.
export { DISCLAIMERS } from "./copy";

export const DELIVERY_LABEL: Record<DeliveryRecord["method"], string> = {
  personal: "personal delivery", mail: "first-class mail", email: "email, by written agreement",
};

/** One line for a delivery record, e.g. "first-class mail to 482 N. Glassell St on October 1, 2026". A mailing to the
 *  vacated unit says so, since that is allowed only when no forwarding address was provided ((h)(6)). */
export function describeDelivery(d: DeliveryRecord): string {
  const where = d.method === "mail" && d.address
    ? ` to ${d.address}${d.address_kind === "unit" ? " (the vacated unit; no forwarding address was provided)" : ""}`
    : d.method === "email" && d.email ? ` to ${d.email}` : d.to ? ` to ${d.to}` : "";
  return `${DELIVERY_LABEL[d.method]}${where} on ${longDate(d.date)}`;
}

// D28: the only local deposit-interest rules on record here (LEGAL_RULES sources S10-S13). The statement says whether
// the city is one of these and nothing more; the rates change every year and are not computed.
const INTEREST_CITIES: { match: RegExp; note: string }[] = [
  { match: /^san\s+francisco$/i, note: "San Francisco requires interest on security deposits (S.F. Admin. Code ch. 49)." },
  { match: /^los\s+angeles$/i, note: "Los Angeles requires interest on security deposits for units under its Rent Stabilization Ordinance (LAMC 151.06.02)." },
  { match: /^berkeley$/i, note: "Berkeley requires interest on security deposits (BMC 13.76.070)." },
  { match: /^west\s+hollywood$/i, note: "West Hollywood requires interest on security deposits (WHMC 17.32.020)." },
];

const KNOWN_CITIES = "San Francisco, Los Angeles RSO units, Berkeley and West Hollywood";

function localInterest(city: string | null): Statement["interest"] {
  const hit = city ? INTEREST_CITIES.find((c) => c.match.test(city.trim())) : null;
  if (hit) {
    return {
      city, known: true,
      note: `${hit.note} Under that ordinance unpaid interest is due with the deposit at move-out. The rate and the period the deposit was held come from the city's rent program and are not included in this statement.`,
      checkReason: `${hit.note} This tool does not compute it; the rate and the period the deposit was held come from the city's rent program.`,
    };
  }
  const note = `No local deposit interest is included. California has no statewide requirement, and ${city ?? "the property's city"} is not among the cities with a security deposit interest ordinance on record here (${KNOWN_CITIES}).`;
  return { city, known: false, note, checkReason: note };
}

type Row = StoredDeduction & { hours: number | null; hourly_rate: number | null };

const ORDER: Record<Category, number> = { rent: 0, damage: 1, cleaning: 2 };

export async function buildStatement(tenancyId: string): Promise<Statement | null> {
  const [{ data: t }, { data: rows }] = await Promise.all([
    db.from("tenancies").select("*, properties(*)").eq("id", tenancyId).single(),
    db.from("deductions").select("*").eq("tenancy_id", tenancyId).order("created_at"),
  ]);
  if (!t) return null;
  const facts = await closeOutFacts(tenancyId);

  const prop = t.properties as { address: string; city: string | null; owner_name: string | null };
  const terms = (t.lease_terms ?? null) as LeaseTerms | null;
  const tenantContacts = (t.tenants as { name: string; email?: string | null }[]).map((x) => ({ name: x.name, email: x.email ?? null }));
  const tenants = tenantContacts.map((x) => x.name);
  const landlord = prop.owner_name ?? terms?.landlordName ?? "Landlord";
  const city = prop.city ?? terms?.city ?? null;
  const moveInPhotosRequired = !!t.start_date && (t.start_date as string) >= MOVE_IN_PHOTOS_FROM;

  // Once delivered, the document is frozen on the day it went out; until then it carries today's date and the clock.
  const delivery = (t.statement_delivery ?? null) as DeliveryRecord | null;
  const deliveredAt = (t.statement_delivered_at ?? null) as string | null;
  const statementDate = delivery?.date ?? facts.today;

  // 2. Security received and its basis. The amount is what PayPal collected; the note explains how the lease labeled
  // it, since every move-in charge but first month's rent is security (D1), and the cap when the lease asked for more.
  const lawful = terms ? lawfulDeposit(terms) : null;
  const dep = facts.deposit;
  let basisNote: string | null = null;
  if (terms && dep && (terms.otherMoveInCharges.length || (terms.securityDeposit != null && terms.securityDeposit !== dep.amount))) {
    const parts = [terms.securityDeposit ? `deposit ${usd(terms.securityDeposit)}` : null,
      ...terms.otherMoveInCharges.map((c) => `${c.label.toLowerCase()} ${usd(c.amount)}`)].filter(Boolean).join(", ");
    basisNote = `The lease asked for ${usd(totalSecurity(terms))} at the start of the tenancy (${parts}). Everything charged at the start of a tenancy except first month's rent counts as security, however it is labeled (Civ. Code 1950.5(b)).`;
    if (lawful && lawful.charged > lawful.cap) {
      const twoMonths = terms.monthlyRent != null && lawful.cap > terms.monthlyRent;
      basisNote += ` The cap for this tenancy is ${usd(lawful.cap)}, so ${usd(dep.amount)} was collected (Civ. Code 1950.5(c)(1)${twoMonths ? ", (c)(5)" : ""}).`;
    }
  }
  const security: Statement["security"] = dep ? {
    amount: dep.amount, paid: wasPaid(dep.status),
    electronic: paidElectronically(dep.status, dep.method),
    live: dep.live, paidAt: dep.paidAt, method: dep.method, invoiceId: dep.invoiceId, invoiceStatus: dep.status,
    leaseAsked: lawful?.charged ?? null, cap: lawful?.cap ?? null, basisNote,
  } : null;

  // 3 to 8. One line per deduction with its tag, cost explanation, labor or vendor details and photo evidence.
  // Unpaid rent ((b)(1)) has no work behind it, so it carries neither labor nor vendor details.
  const stored = ((rows ?? []) as Row[]).map((d) => ({ ...d, amount: Number(d.amount) }))
    .sort((a, b) => ORDER[a.category] - ORDER[b.category]);
  const deductions: StatementDeduction[] = stored.map((d, i) => {
    const photos: StatementPhoto[] = [];
    const verb = d.work === "clean" ? "cleaning" : "repair";
    if (d.finding?.moveInPath) photos.push({ role: "move_in", label: "Move-in", path: d.finding.moveInPath });
    if (d.finding?.moveOutPath) photos.push({ role: "move_out_before", label: `Move-out, before ${verb}`, path: d.finding.moveOutPath });
    for (const p of d.after_photo_paths ?? []) photos.push({ role: "move_out_after", label: `After ${verb}`, path: p });
    const rent = d.category === "rent";
    return {
      id: d.id, n: i + 1, category: d.category, tag: TAGS[d.category].tag, tagLabel: TAGS[d.category].label,
      room: d.room, item: d.item, work: d.work, amount: d.amount, explanation: d.math, note: d.note ?? null, proration: d.proration,
      guidance: d.proration !== "none", isEstimate: d.is_estimate,
      labor: !rent && d.performer === "own_labor"
        ? { description: d.labor_description, hours: d.hours == null ? null : Number(d.hours), hourlyRate: d.hourly_rate == null ? null : Number(d.hourly_rate) }
        : null,
      vendor: !rent && d.performer === "vendor"
        ? { name: d.vendor?.name ?? null, address: d.vendor?.address ?? null, phone: d.vendor?.phone ?? null, invoicePath: d.receipt_path }
        : null,
      photos,
      missing: missingDocs(d, facts.totals.documentsRequired),
    };
  });

  const repairAndCleaning = Math.round(deductions.filter((d) => d.category !== "rent").reduce((s, d) => s + d.amount, 0) * 100) / 100;
  const totals = { ...facts.totals, repairAndCleaning };

  // 9. The (h)(2) documents rule that applies, and the (h)(4)-(5) notice when they are not required. Whether each
  // document is in fact attached is stated by the page and the PDF from what they hold, never assumed here.
  const documents = {
    required: totals.documentsRequired,
    note: !deductions.some((d) => d.category !== "rent")
      ? "No repair or cleaning was deducted, so no invoices, receipts or labor records apply."
      : totals.documentsRequired
        ? `Repair and cleaning deductions total ${usd(repairAndCleaning)}, more than ${usd(RECEIPT_THRESHOLD)}, so the law requires the invoices and receipts, the labor records and the photos with this statement (Civ. Code 1950.5(h)(2)).`
        : `Repair and cleaning deductions total ${usd(repairAndCleaning)}, which is ${usd(RECEIPT_THRESHOLD)} or less, so the invoices, receipts and labor records are not required with this statement. The tenant may request them within 14 days of receiving this statement, and the landlord then has 14 days to provide them (Civ. Code 1950.5(h)(4)-(5)).`,
  };

  // 10. The refund: what PayPal already sent, or what the plan calls for.
  const ret = facts.alreadyReturned;
  const agreement = facts.refundAgreement;
  const paypalEmail = agreement?.paypalEmail ?? null;
  let refund: Statement["refund"];
  const base = { paypalEmail, payees: tenants, agreement: agreement ? { signedBy: agreement.signedBy, signedAt: agreement.signedAt } : null };
  if (ret) {
    refund = {
      ...base, amount: ret.amount, state: "sent", paypalId: ret.paypalId, sentAt: ret.at,
      method: ret.kind === "payout" ? `PayPal Payout to ${paypalEmail ?? "the designated PayPal account"}` : "PayPal refund of the original deposit payment",
      note: "",
    };
  } else if (totals.depositHeld === 0) {
    refund = { ...base, amount: 0, state: "none", paypalId: null, sentAt: null, method: "No security was received through PayPal, so there is nothing to refund.", note: "" };
  } else if (totals.refund <= 0) {
    refund = { ...base, amount: 0, state: "none", paypalId: null, sentAt: null, method: "No refund is due: the deductions use the whole security.", note: "" };
  } else {
    const plan = facts.plan;
    refund = {
      ...base, amount: totals.refund, state: "due", paypalId: null, sentAt: null,
      method: plan.rail === "payout" ? `PayPal Payout to ${plan.email}, to be sent`
        : plan.rail === "refund_original_payment" ? "PayPal refund of the original deposit payment, to be sent"
          : paypalEmail ? `Electronic refund by PayPal to ${paypalEmail}, to be sent`
            : security?.electronic ? "To be sent electronically; no refund method is on file"
              : "To be sent by personal delivery or first-class mail check, or by a method agreed to in writing",
      note: "",
    };
  }
  const signed = agreement ? `the written agreement signed by ${agreement.signedBy.join(" and ")} on ${longDate(pacificDate(agreement.signedAt))}` : null;
  const paidBy = security?.method ? security.method.toLowerCase().replace(/_/g, " ") : "a method PayPal did not record";
  refund.note = [
    tenants.length > 1 ? `One refund payable to all adult tenants named on the lease (${tenants.join(" and ")}); the statement may go to any one of them (Civ. Code 1950.5(h)(1)(C)).` : null,
    !security?.paid ? null
      : security.electronic
        ? signed
          ? `The security was paid electronically, so it is refunded electronically: by PayPal under ${signed} (Civ. Code 1950.5(h)(1)(A)).`
          : "The security was paid electronically, so it is refunded electronically to an account the tenant designates; PayPal needs the tenant's written agreement (Civ. Code 1950.5(h)(1)(A))."
        : signed
          ? `The security was recorded as paid by ${paidBy}. The refund goes by PayPal under ${signed}, a method the parties agreed to in writing; an electronic refund is also required when rent was paid electronically (Civ. Code 1950.5(h)(1)(A)).`
          : `The security was recorded as paid by ${paidBy}. The refund goes by personal delivery or first-class mail check, electronically if rent was paid electronically, or by a method agreed to in writing; PayPal needs the tenant's written agreement (Civ. Code 1950.5(h)(1)(A)).`,
  ].filter(Boolean).join(" ");

  // 12. A balance claimed is a claim, never a demand, and nothing collects it.
  const balanceClaimed = totals.balanceClaimed > 0
    ? { amount: totals.balanceClaimed, text: `The deductions exceed the security held by ${usd(totals.balanceClaimed)}. This statement records that amount as a claim. It is not a demand for immediate payment.` }
    : null;

  // 13. Where the statement is mailed: the forwarding address the tenants gave through their link, if they did ((h)(6)),
  // dated by its latest change, since the address as it stands is what matters here.
  const tm = (t.tenant_move_out ?? null) as TenantMoveOut | null;
  const s: Statement = {
    tenancyId, today: facts.today, statementDate, landlord, property: { address: prop.address, city }, tenants, tenantContacts,
    moveOutDate: facts.tenancy.moveOutDate, statementDue: facts.tenancy.statementDue, daysLeft: delivery ? null : facts.tenancy.daysLeft,
    security, deductions, totals, documents, refund, balanceClaimed, interest: localInterest(city), delivery, deliveredAt,
    tenantForwarding: tm ? { address: tm.forwarding_address, name: tm.name, date: tenantMoveOutUpdatedOn(tm) } : null,
    checklist: [],
  };
  s.checklist = checklist(s, moveInPhotosRequired);
  return s;
}

/** The 13 items of LEGAL_RULES section B, each done, missing or not applicable, with a one-line reason. */
function checklist(s: Statement, moveInPhotosRequired: boolean): ChecklistItem[] {
  const out: ChecklistItem[] = [];
  const item = (n: number, title: string, cite: string, state: ChecklistState, reason: string) => out.push({ n, title, cite, state, reason });
  const list = (xs: string[]) => xs.join(", ");
  const plural = (n: number, word: string) => `${n} ${word}${n === 1 ? "" : "s"}`;
  const docsNotRequired = `Not required: repair and cleaning deductions total ${usd(RECEIPT_THRESHOLD)} or less.`;
  const repairs = s.deductions.filter((d) => d.category !== "rent");

  // 1. Parties and dates.
  const missing1 = [!s.tenants.length ? "tenant names" : null, !s.property.address ? "unit address" : null, !s.moveOutDate ? "move-out date" : null].filter(Boolean) as string[];
  item(1, "Tenant names, unit address, move-out date, statement date and the 21-day deadline", "(h)(1)",
    missing1.length ? "missing" : "done",
    missing1.length ? `Still needed: ${list(missing1)}.` : `${list(s.tenants)}; moved out ${longDate(s.moveOutDate!)}; statement dated ${longDate(s.statementDate)}; due ${longDate(s.statementDue!)}.`);

  // 2. Security received.
  item(2, "Security received and its basis", "(h)(1), (b)",
    s.security?.paid ? "done" : "missing",
    s.security?.paid
      ? `${usd(s.security.amount)} paid ${s.security.paidAt ? longDate(pacificDate(s.security.paidAt)) : ""} through PayPal invoice ${s.security.invoiceId}${s.security.basisNote ? "; how the lease labeled the security is explained" : ""}.`
      : s.security ? `PayPal invoice ${s.security.invoiceId} is ${s.security.invoiceStatus.toLowerCase().replace(/_/g, " ")}, not paid.` : "No deposit was collected through PayPal for this tenancy.");

  // 3. One line per deduction, tagged.
  item(3, "One line per deduction, tagged (b)(1) rent, (b)(2) damage or (b)(3) cleaning", "(b), (h)(1)",
    s.deductions.length ? "done" : "not_applicable",
    s.deductions.length ? `${plural(s.deductions.length, "deduction")}, each tagged: ${list(s.deductions.map((d) => d.tag))}.`
      : s.totals.depositHeld === 0 ? "No deductions, and no security was collected through PayPal." : "No deductions; the whole security is refunded.");

  // 4. Own labor.
  const labor = s.deductions.filter((d) => d.labor);
  const laborShort = labor.filter((d) => !d.labor!.description || d.labor!.hours == null || d.labor!.hourlyRate == null);
  item(4, "Landlord or employee labor: description, time and hourly rate", "(h)(2)(A)",
    !labor.length ? "not_applicable" : !laborShort.length ? "done" : s.documents.required ? "missing" : "not_applicable",
    !labor.length ? "No deduction is for the landlord's own labor."
      : !laborShort.length ? `${plural(labor.length, "item")} with the work described, the hours and the rate.`
        : s.documents.required ? `Still needed for ${list(laborShort.map((d) => d.item))}: description, hours and rate.` : docsNotRequired);

  // 5. Vendors. An estimate ((h)(3)) stands in for the invoice until it arrives; the vendor's contact is required either way.
  const vendors = s.deductions.filter((d) => d.vendor);
  const vendorShort = vendors.filter((d) => (!d.vendor!.invoicePath && !d.isEstimate) || !d.vendor!.name || !d.vendor!.address || !d.vendor!.phone);
  const invoiced = vendors.filter((d) => d.vendor!.invoicePath).length;
  item(5, "Outside vendors: copy of the invoice, with the vendor's name, address and phone", "(h)(2)(B)",
    !vendors.length ? "not_applicable" : !vendorShort.length ? "done" : s.documents.required ? "missing" : "not_applicable",
    !vendors.length ? "No deduction is for a vendor's work."
      : !vendorShort.length
        ? `${plural(vendors.length, "vendor")}, each with name, address and phone (${list(vendors.map((d) => d.vendor!.name!))}); ${plural(invoiced, "invoice")} on file${vendors.length > invoiced ? `, ${plural(vendors.length - invoiced, "estimate")} with the invoice to follow` : ""}.`
        : s.documents.required ? `Still needed for ${list(vendorShort.map((d) => d.item))}: ${list([...new Set(vendorShort.flatMap((d) => d.missing))])}.` : docsNotRequired);

  // 6. Materials. The tool records vendor invoices and own labor; a separate materials receipt is not modeled.
  item(6, "Materials: receipt, or a vendor price list for stock items", "(h)(2)(C)", "not_applicable",
    vendors.length ? "No materials were bought separately; materials on a vendor's invoice are covered by item 5." : "No materials were bought separately.");

  // 7. Photos and the written cost explanation. An estimate's repair is not finished, so it has no after photo yet.
  const photoShort = repairs.map((d) => {
    const need: string[] = [];
    if (moveInPhotosRequired && !d.photos.some((p) => p.role === "move_in")) need.push("move-in photo");
    if (!d.photos.some((p) => p.role === "move_out_before")) need.push("before photo");
    if (!d.isEstimate && !d.photos.some((p) => p.role === "move_out_after")) need.push("after photo");
    if (!d.explanation) need.push("cost explanation");
    return [d, need] as const;
  }).filter(([, need]) => need.length);
  const estimates = repairs.filter((d) => d.isEstimate);
  item(7, `Every repair or cleaning deduction: before and after photos${moveInPhotosRequired ? ", the move-in photo" : ""} and a written cost explanation`, "(g), (h)(2)(D)",
    !repairs.length ? "not_applicable" : photoShort.length ? "missing" : "done",
    !repairs.length ? "No repair or cleaning was deducted."
      : photoShort.length ? photoShort.map(([d, need]) => `${d.item}: ${list(need)}`).join("; ") + "."
        : estimates.length
          ? `${plural(repairs.length, "item")}, each with ${moveInPhotosRequired ? "move-in and " : ""}before photos on file and the cost explained; after photos for the ${plural(repairs.length - estimates.length, "finished repair")}, none yet for the ${plural(estimates.length, "estimate")}.`
          : `${plural(repairs.length, "item")}, each with ${moveInPhotosRequired ? "move-in, " : ""}before and after photos on file and the cost explained.`);

  // 8. Estimates: a vendor's estimate needs the vendor's name, address and phone; the landlord's own unfinished repair has no vendor.
  const estShort = estimates.filter((d) => d.vendor && (!d.vendor.name || !d.vendor.address || !d.vendor.phone));
  item(8, "Good-faith estimates marked as such, with the vendor's contact and the 14-day follow-up", "(h)(3)",
    !estimates.length ? "not_applicable" : estShort.length ? "missing" : "done",
    !estimates.length ? "No deduction is an estimate; every cost is final."
      : estShort.length ? `Still needed for ${list(estShort.map((d) => d.item))}: the vendor's name, address and phone.`
        : `${plural(estimates.length, "estimate")} marked${estimates.some((d) => d.vendor) ? ", with the vendor's name, address and phone" : ""}; the final cost and documents follow within 14 days of completion or receipt.`);

  // 9. The $125 notice.
  item(9, "If documents are left out because deductions total $125 or less, say so and note the 14-day request right", "(h)(4)-(5)",
    !repairs.length ? "not_applicable" : s.documents.required ? "not_applicable" : "done",
    !repairs.length ? "No repair or cleaning was deducted."
      : s.documents.required ? `Repair and cleaning deductions total ${usd(s.totals.repairAndCleaning)}, over ${usd(RECEIPT_THRESHOLD)}, so the documents go with the statement instead.`
        : "The statement says the documents are not required and that the tenant may request them within 14 days.");

  // 10. Refund amount, method and payees.
  const needsAgreement = !!s.security?.electronic && !s.refund.agreement && s.refund.state !== "none";
  item(10, "Refund amount, method and payees", "(h)(1)(A), (h)(1)(C)",
    needsAgreement ? "missing" : "done",
    needsAgreement ? "The security was paid electronically, so the refund goes electronically, and by PayPal only with the tenants' written agreement, which is not on file."
      : s.refund.state === "sent" ? `${usd(s.refund.amount)} sent by ${s.refund.method} (${s.refund.paypalId}) on ${longDate(pacificDate(s.refund.sentAt!))}, payable to ${list(s.refund.payees)}.`
        : s.refund.state === "due" ? `${usd(s.refund.amount)} by ${s.refund.method}, payable to ${list(s.refund.payees)}.`
          : s.refund.method);

  // 11. Local interest.
  item(11, "Local deposit interest, with the rate and period, if the city requires it", "local ordinances (S10-S13)",
    s.interest.known ? "missing" : "not_applicable", s.interest.checkReason);

  // 12. Balance claimed.
  item(12, "If deductions exceed the deposit, the balance claimed, stated as a claim and not a demand", "(e)(1); DRE guide",
    s.balanceClaimed ? "done" : "not_applicable",
    s.balanceClaimed ? `${usd(s.balanceClaimed.amount)} is stated as a claim, not a demand for payment.` : "The deductions do not exceed the security held.");

  // 13. Delivery.
  item(13, "Delivery record: personal delivery, first-class mail to the forwarding address (else the unit), or email under a written agreement", "(h)(1)(B), (h)(6)",
    s.delivery ? "done" : "missing",
    s.delivery ? `Delivered by ${describeDelivery(s.delivery)}.` : "Record how and when the statement was delivered, once it goes out.");

  return out;
}

/** What the close-out agent reads after the refund: the checklist and what is still missing. Read-only. The landlord
 *  opens the statement from the tenancy page, so no paths are handed to the model to quote. */
export async function statementChecklist(tenancyId: string) {
  const s = await buildStatement(tenancyId);
  if (!s) throw new Error("No such tenancy.");
  return {
    statementDate: s.statementDate,
    statementDue: s.statementDue,
    daysLeft: s.daysLeft,
    delivered: s.delivery ? describeDelivery(s.delivery) : null,
    checklist: s.checklist,
    stillMissing: s.checklist.filter((c) => c.state === "missing").map((c) => `${c.n}. ${c.title}: ${c.reason}`),
  };
}

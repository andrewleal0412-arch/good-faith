import { wasPaid } from "./invoice-status";
import { streetLine } from "./ledger";
import { closedOut, outsideCovers, packOf, REVERSED_STEP, type NextStep, type StepIcon, type TenancySummary } from "./next-step";
import { tabHref } from "./tenancy-tabs";

// How a tenancy reads in the app's chrome: one status chip (one color per status), the filter group it belongs to,
// and the one verb its next step links to. Pure: the Properties table, the record header and the Move-outs list
// all read it. The legal reasoning stays in next-step.ts; this only names and routes it.

export type ChipTone = "green" | "amber" | "red" | "gray";
export type StatusGroup = "move-in" | "leased" | "move-out" | "closed";
export type PropertyStatus = { label: string; tone: ChipTone; group: StatusGroup };

export const GROUP_LABEL: Record<StatusGroup, string> = { "move-in": "Move-in", leased: "Leased", "move-out": "Move-out", closed: "Closed" };

/** Paid and still held: a payment PayPal reversed (a chargeback) is not. */
const paid = (s: TenancySummary) => !!s.deposit && wasPaid(s.deposit.status) && !s.deposit.reversed;

/** Move-in is finished once the refund agreement (where the state's pack requires one), the paid deposit, the move-in
 *  photos (where required: California, for a tenancy from July 2025 on) and the state's own move-in records are on
 *  file. */
export const moveInOpen = (s: TenancySummary) => {
  const pack = packOf(s);
  const photosFrom = pack.moveIn.photosFrom;
  return (pack.refund.agreementRequired && !s.agreement) || !paid(s)
    || (!s.moveInPhotos && !!photosFrom && !!s.startDate && s.startDate >= photosFrom)
    || pack.steps.openMoveIn(s).length > 0;
};

/** Which stage of the tenancy a unit is in, from its dates alone: the filter group of a unit that is not closed. */
const stageOf = (s: TenancySummary): StatusGroup =>
  s.moveOutDate || s.statementDeliveredAt || s.noticeGivenOn || s.tenantMoveOut ? "move-out"
    : moveInOpen(s) ? "move-in" : "leased";

/** Closed: the statement and the money are out (closedOut), no dispute on the unit is live, and no step is still
 *  asking for the deposit back in full. A unit already closed out is an open move-out again while the tenants' dispute
 *  of the statement, or their PayPal dispute of the deposit payment, is live, and while its step is to take every
 *  deduction off (Florida past the claim notice's 30 days, where the deductions may have used the whole deposit and
 *  none of it may be kept). The Properties filter, its count and the Move-outs list read this one rule, so no page
 *  counts a unit closed that another shows as open (units/page.tsx, move-outs/page.tsx). */
export const propertyClosed = (s: TenancySummary, n?: NextStep) =>
  closedOut(s) && !s.dispute && !s.paypalDispute && !n?.removeDeductions;

export function propertyStatus(s: TenancySummary, n: NextStep): PropertyStatus {
  // A PayPal dispute or chargeback of the deposit payment, before anything else while PayPal hasn't resolved it. It
  // keeps the unit out of Closed until PayPal is done with it, even where the statement and the refund went.
  if (s.paypalDispute) return { label: "PayPal dispute", tone: "red", group: stageOf(s) };
  if (propertyClosed(s, n)) return { label: "Closed", tone: "gray", group: "closed" };
  if (closedOut(s)) {
    // Closed out, but not finished: the tenants' dispute of the statement while it is live, or a step that still asks
    // for the whole deposit back (New York after day 14, Florida past the claim notice's 30 days). An open move-out
    // again, as the Move-outs list has it.
    if (s.dispute === "agreed") return { label: "Settlement agreed", tone: "amber", group: "move-out" };
    if (s.dispute) return { label: "Disputed", tone: "amber", group: "move-out" };
    // The step left is to take every deduction off, which only a pack's forfeiture asks for, and both packs that ask
    // raise it at "overdue" (scripts/state-packs-check.mjs holds that), so the chip is fixed rather than read off the
    // level. A pack that ever asks for it less urgently belongs in the general path below instead.
    return { label: "Overdue", tone: "red", group: "move-out" };
  }
  const group = stageOf(s);
  // PayPal reversed the deposit payment: before anything else, until the tenancy is closed out.
  if (s.deposit?.reversed) return { label: "Payment reversed", tone: "red", group };
  if (n.level === "overdue") return { label: "Overdue", tone: "red", group };
  if (group === "move-out") {
    if (s.statementDeliveredAt) return { label: "Refund due", tone: "amber", group };
    if (s.returned || outsideCovers(s)) return { label: "Statement due", tone: "amber", group };
    if (s.moveOutDate) return { label: s.moveOutInspectedAt ? "Move-out review" : "Moved out", tone: "amber", group };
    return { label: "Notice given", tone: "amber", group };
  }
  if (group === "move-in") {
    // An invoice the tenants have not paid waits on them, not on the landlord.
    if (s.agreement && s.deposit && !paid(s)) return { label: "Deposit requested", tone: "gray", group };
    return { label: "Move-in", tone: "amber", group };
  }
  return { label: "Leased", tone: "green", group };
}

export { TABS, tabHref, tabOf, type TabKey } from "./tenancy-tabs";

export type StepLink = {
  label: string; // the table's one verb ("Review findings")
  title: string; // the same step as a one-line title for the Next steps boxes ("Review move-out findings")
  href: string;
  icon: StepIcon;
};

/** Where the rail and the record's Next step card spell a terse table verb out; anything else keeps the verb. */
const TITLE: Record<string, string> = {
  "Review findings": "Review move-out findings",
  "Compare photos": "Compare move-out photos",
  "Record delivery": "Record statement delivery",
  "Record notice": "Record the move-out notice",
  "Check refund notice": "Check the refund notice",
  "View invoice": "Deposit invoice unpaid",
  "Check PayPal": REVERSED_STEP,
  "Check in": "Check in before the lease ends",
};

/** The one verb a row links to for its next step, and where it goes. Unknown steps fall back to the step's own words.
 *  The link is shown on the property too (the record header, the Overview's Next step card) and in the bell on every
 *  page, so it can be clicked on the very tab it opens, where a link to the bare tab would change nothing. Each one
 *  therefore opens another page or names a section of its tab (scripts/state-packs-check.mjs holds that). */
export function stepLink(s: TenancySummary, n: NextStep): StepLink {
  const l = step(s, n);
  // A state pack's own step reads by its full words in the boxes ("Get the forwarding address in writing").
  return { ...l, title: n.action ? n.label : TITLE[l.label] ?? l.label };
}

/** A dispute that waits on the landlord comes before the unit's own next step: in the Properties table and its rail,
 *  the Move-outs list and the bell alike (the bell's entries: the tenants' dispute, src/lib/negotiation.ts). */
const DISPUTE_STEP: Record<string, Pick<StepLink, "label" | "icon">> = {
  "Tenants disputed the statement": { label: "Answer dispute", icon: "doc" },
  "Approve and pay the settlement": { label: "Approve settlement", icon: "send" },
  "Check the settlement with PayPal": { label: "Check payment", icon: "send" },
  "Your negotiator asks for your OK": { label: "Answer negotiator", icon: "pen" },
  // The tenants' PayPal dispute of the deposit payment (src/lib/chargeback-store.ts, paypalDisputeAlerts).
  "Answer the PayPal dispute": { label: "Answer PayPal", icon: "card" },
  "Approve the PayPal dispute response": { label: "Approve response", icon: "send" },
  "Check the PayPal dispute response": { label: "Check response", icon: "card" },
};
/** The step link for one of the bell's dispute entries (a DisputeAlert: its title and where it opens). */
export const disputeStep = (a: { title: string; href: string }): StepLink =>
  ({ label: DISPUTE_STEP[a.title]?.label ?? "View dispute", icon: DISPUTE_STEP[a.title]?.icon ?? "doc", title: a.title, href: a.href });

function step(s: TenancySummary, n: NextStep): Omit<StepLink, "title"> {
  const id = s.id;
  const L = n.label;
  // A state pack's own step names where it opens.
  if (n.action) return { label: n.action.label, href: n.action.path.startsWith("?") ? `/tenancy/${id}${n.action.path}` : `/tenancy/${id}/${n.action.path}`, icon: n.action.icon };
  if (L === "Done") return { label: "View statement", href: `/tenancy/${id}/statement`, icon: "doc" };
  if (L === "Send the refund") return { label: "Send refund", href: `/tenancy/${id}/refund`, icon: "send" };
  if (L === "Take move-out photos") return { label: "Add move-out photos", href: tabHref(id, "move-out", "photos"), icon: "camera" };
  if (L === "Compare move-in and move-out photos") return { label: "Compare photos", href: tabHref(id, "move-out", "photos"), icon: "image" };
  if (L === "Record the statement delivery") return { label: "Record delivery", href: `/tenancy/${id}/statement#delivery`, icon: "mail" };
  if (L === "Send the itemized statement and refund") return { label: "Review findings", href: tabHref(id, "move-out", "photos"), icon: "image" };
  if (L === "Record the tenants' notice") return { label: "Record notice", href: tabHref(id, "move-out", "notice"), icon: "pen" };
  if (L === "Send the initial-inspection notice") return { label: "Send inspection notice", href: `/tenancy/${id}/notices/inspection`, icon: "mail" };
  if (L === "Send the electronic-refund notice") return { label: "Send refund notice", href: `/tenancy/${id}/notices/electronic-refund`, icon: "mail" };
  if (L.startsWith("Check whether the electronic-refund notice")) return { label: "Check refund notice", href: `/tenancy/${id}/notices/electronic-refund`, icon: "mail" };
  if (L === "Set the planned move-out date") return { label: "Set move-out date", href: tabHref(id, "move-out", "notice"), icon: "calendar" };
  if (L === "Inspection window opens") return { label: "View dates", href: tabHref(id, "move-out", "notice"), icon: "calendar" };
  if (L === "Move-out") return { label: "Record move-out", href: tabHref(id, "move-out", "photos"), icon: "key" };
  if (L === "Record the tenants' refund agreement") return { label: "Record agreement", href: tabHref(id, "overview", "move-in"), icon: "file-check" };
  // The same step where the state takes no agreement (New York, Texas, Florida: the tenants' PayPal account), under
  // its own words, to the same card, so its button answers on the Overview too (with no section it went nowhere there).
  if (L === packOf(s).refund.agreementStep.label) return { label: L, href: tabHref(id, "overview", "move-in"), icon: "doc" };
  if (L === "Send the PayPal deposit invoice") return { label: "Request deposit", href: tabHref(id, "overview", "move-in"), icon: "receive" };
  if (L === "Deposit invoice unpaid") return { label: "View invoice", href: tabHref(id, "payments", "ledger"), icon: "card" };
  if (L === REVERSED_STEP) return { label: "Check PayPal", href: tabHref(id, "payments", "ledger"), icon: "card" };
  if (L === "Take move-in photos" || L === "Add move-in condition evidence") return { label: "Add move-in photos", href: tabHref(id, "overview", "move-in"), icon: "camera" };
  if (L.startsWith("Lease ended")) return { label: "Update lease", href: tabHref(id, "move-out", "notice"), icon: "calendar" };
  if (L === "Lease ends") return { label: "Check in", href: tabHref(id, "move-out", "notice"), icon: "calendar" };
  if (L.startsWith("Check in")) return { label: "View dates", href: tabHref(id, "overview", "dates"), icon: "calendar" };
  // Nothing to do, so nothing to open: a list's "View" opens the property, and the property's own Next step card says
  // the words with no button (page.tsx).
  if (L === "Nothing due") return { label: "View", href: tabHref(id, "overview"), icon: "doc" };
  // A step nothing above names: to the Overview's Next step card, where its own words and its tip are.
  return { label: L, href: tabHref(id, "overview", "next-step"), icon: "doc" };
}

/** "482 N. Glassell St, Unit B" and "Orange, CA 92866" from the lease's one-line address. */
export function splitAddress(address: string, city: string | null): { street: string; cityLine: string } {
  const street = streetLine(address);
  const rest = address.slice(street.length).replace(/^,\s*/, "").trim();
  return { street, cityLine: rest || city || "" };
}

/** A street line for a heading: the unit designator keeps its number ("Unit B"), so a wrap never leaves the "B" alone. */
export const keepUnit = (street: string) => street.replace(/\b(Unit|Apt\.?|Apartment|Suite|Ste\.?|#)\s+(\S+)$/i, "$1\u00a0$2");

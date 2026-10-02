import { wasPaid } from "./invoice-status";
import { streetLine } from "./ledger";
import { closedOut, type NextStep, type TenancySummary } from "./next-step";
import { MOVE_IN_PHOTOS_FROM } from "./rules";

// How a tenancy reads in the app's chrome: one status chip (one color per status), the filter group it belongs to,
// and the one verb its next step links to. Pure: the Properties table, the record header and the Move-outs list
// all read it. The legal reasoning stays in next-step.ts; this only names and routes it.

export type ChipTone = "green" | "amber" | "red" | "gray";
export type StatusGroup = "move-in" | "leased" | "move-out" | "closed";
export type PropertyStatus = { label: string; tone: ChipTone; group: StatusGroup };

export const GROUP_LABEL: Record<StatusGroup, string> = { "move-in": "Move-in", leased: "Leased", "move-out": "Move-out", closed: "Closed" };

const paid = (s: TenancySummary) => !!s.deposit && wasPaid(s.deposit.status);

/** Move-in is finished once the refund agreement, the paid deposit and (for a tenancy from July 2025 on) the move-in
 *  photos are on file. */
export const moveInOpen = (s: TenancySummary) =>
  !s.agreement || !paid(s) || (!s.moveInPhotos && !!s.startDate && s.startDate >= MOVE_IN_PHOTOS_FROM);

export function propertyStatus(s: TenancySummary, n: NextStep): PropertyStatus {
  if (closedOut(s)) return { label: "Closed", tone: "gray", group: "closed" };
  const group: StatusGroup = s.moveOutDate || s.statementDeliveredAt || s.noticeGivenOn || s.tenantMoveOut ? "move-out"
    : moveInOpen(s) ? "move-in" : "leased";
  if (n.level === "overdue") return { label: "Overdue", tone: "red", group };
  if (group === "move-out") {
    if (s.statementDeliveredAt) return { label: "Refund due", tone: "amber", group };
    if (s.returned) return { label: "Statement due", tone: "amber", group };
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

export type TabKey = "overview" | "move-out" | "payments" | "documents" | "tenants";
export const TABS: { key: TabKey; label: string }[] = [
  { key: "overview", label: "Overview" },
  { key: "move-out", label: "Move-out" },
  { key: "payments", label: "Payments" },
  { key: "documents", label: "Documents" },
  { key: "tenants", label: "Tenants" },
];

export const tabHref = (id: string, tab: TabKey, hash = "") => `/tenancy/${id}${tab === "overview" ? "" : `?tab=${tab}`}${hash ? `#${hash}` : ""}`;

export type StepLink = {
  label: string; // the table's one verb ("Review findings")
  title: string; // the same step as a one-line title for the Next steps boxes ("Review move-out findings")
  href: string;
  icon: "image" | "camera" | "send" | "mail" | "doc" | "pen" | "calendar" | "file-check" | "receive" | "card" | "key";
};

/** Where the rail and the record's Next step card spell a terse table verb out; anything else keeps the verb. */
const TITLE: Record<string, string> = {
  "Review findings": "Review move-out findings",
  "Compare photos": "Compare move-out photos",
  "Record delivery": "Record statement delivery",
  "Record notice": "Record the move-out notice",
  "Check refund notice": "Check the refund notice",
  "View invoice": "Deposit invoice unpaid",
  "Check in": "Check in before the lease ends",
};

/** The one verb a row links to for its next step, and where it goes. Unknown steps fall back to the step's own words. */
export function stepLink(s: TenancySummary, n: NextStep): StepLink {
  const l = step(s, n);
  return { ...l, title: TITLE[l.label] ?? l.label };
}

function step(s: TenancySummary, n: NextStep): Omit<StepLink, "title"> {
  const id = s.id;
  const L = n.label;
  if (L === "Done") return { label: "View statement", href: `/tenancy/${id}/statement`, icon: "doc" };
  if (L === "Send the refund") return { label: "Send refund", href: tabHref(id, "move-out", "refund"), icon: "send" };
  if (L === "Take move-out photos") return { label: "Add move-out photos", href: tabHref(id, "move-out", "photos"), icon: "camera" };
  if (L === "Compare move-in and move-out photos") return { label: "Compare photos", href: tabHref(id, "move-out", "photos"), icon: "image" };
  if (L === "Record the statement delivery") return { label: "Record delivery", href: `/tenancy/${id}/statement#delivery`, icon: "mail" };
  if (L === "Send the itemized statement and refund") return { label: "Review findings", href: tabHref(id, "move-out"), icon: "image" };
  if (L === "Record the tenants' notice") return { label: "Record notice", href: tabHref(id, "move-out", "notice"), icon: "pen" };
  if (L === "Send the initial-inspection notice") return { label: "Send inspection notice", href: `/tenancy/${id}/notices/inspection`, icon: "mail" };
  if (L === "Send the electronic-refund notice") return { label: "Send refund notice", href: `/tenancy/${id}/notices/electronic-refund`, icon: "mail" };
  if (L.startsWith("Check whether the electronic-refund notice")) return { label: "Check refund notice", href: `/tenancy/${id}/notices/electronic-refund`, icon: "mail" };
  if (L === "Set the planned move-out date") return { label: "Set move-out date", href: tabHref(id, "move-out", "notice"), icon: "calendar" };
  if (L === "Inspection window opens") return { label: "View dates", href: tabHref(id, "move-out", "notice"), icon: "calendar" };
  if (L === "Move-out") return { label: "Record move-out", href: tabHref(id, "move-out", "photos"), icon: "key" };
  if (L === "Record the tenants' refund agreement") return { label: "Record agreement", href: tabHref(id, "overview", "move-in"), icon: "file-check" };
  if (L === "Send the PayPal deposit invoice") return { label: "Request deposit", href: tabHref(id, "overview", "move-in"), icon: "receive" };
  if (L === "Deposit invoice unpaid") return { label: "View invoice", href: tabHref(id, "payments"), icon: "card" };
  if (L === "Take move-in photos" || L === "Add move-in condition evidence") return { label: "Add move-in photos", href: tabHref(id, "overview", "move-in"), icon: "camera" };
  if (L.startsWith("Lease ended")) return { label: "Update lease", href: tabHref(id, "move-out", "notice"), icon: "calendar" };
  if (L === "Lease ends") return { label: "Check in", href: tabHref(id, "move-out", "notice"), icon: "calendar" };
  if (L.startsWith("Check in")) return { label: "View dates", href: tabHref(id, "overview"), icon: "calendar" };
  if (L === "Nothing due") return { label: "View", href: tabHref(id, "overview"), icon: "doc" };
  return { label: L, href: tabHref(id, "overview"), icon: "doc" };
}

/** "482 N. Glassell St, Unit B" and "Orange, CA 92866" from the lease's one-line address. */
export function splitAddress(address: string, city: string | null): { street: string; cityLine: string } {
  const street = streetLine(address);
  const rest = address.slice(street.length).replace(/^,\s*/, "").trim();
  return { street, cityLine: rest || city || "" };
}

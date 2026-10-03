import { longDate } from "./dates";

// How the itemized statement went out, as the landlord recorded it. Client-safe (no server imports), so the state
// packs' checklists and the pages share one wording. statement.ts re-exports these.

export type DeliveryRecord = {
  method: "personal" | "mail" | "email";
  date: string; // YYYY-MM-DD; the statement is dated the day it goes out
  to: string | null; // the adult tenant it went to
  address: string | null; // mail: the forwarding address, or the unit when there is none
  address_kind?: "forwarding" | "unit" | null; // mail: which of the two addresses it was
  email: string | null;
  by_agreement: boolean; // email under the agreement or condition the state's rule names
  // Email: the rule it went under as the state pack words it ("email under s. 83.505, Florida Statutes"); absent for
  // California's written agreement and every record from before the packs.
  basis?: string | null;
};

export const DELIVERY_LABEL: Record<DeliveryRecord["method"], string> = {
  personal: "personal delivery", mail: "first-class mail", email: "email, by written agreement",
};

/** One line for a delivery record, e.g. "first-class mail to 482 N. Glassell St on October 1, 2026". A mailing to the
 *  vacated unit says so, since that is allowed only when no forwarding address was provided. */
export function describeDelivery(d: DeliveryRecord): string {
  const where = d.method === "mail" && d.address
    ? ` to ${d.address}${d.address_kind === "unit" ? " (the vacated unit; no forwarding address was provided)" : ""}`
    : d.method === "email" && d.email ? ` to ${d.email}` : d.to ? ` to ${d.to}` : "";
  return `${d.method === "email" && d.basis ? d.basis : DELIVERY_LABEL[d.method]}${where} on ${longDate(d.date)}`;
}

/** The same in a few words for a list row ("Mailed Oct 1, 2026 to the vacated unit"); describeDelivery is its tip. */
export function deliveryLine(d: DeliveryRecord): string {
  const when = new Date(`${d.date.slice(0, 10)}T12:00:00Z`).toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric", timeZone: "UTC" });
  if (d.method === "mail") return `Mailed ${when}${d.address_kind === "unit" ? " to the vacated unit" : d.address_kind === "forwarding" ? " to the forwarding address" : ""}`;
  if (d.method === "email") return `Emailed ${when}`;
  return `Handed over ${when}`;
}

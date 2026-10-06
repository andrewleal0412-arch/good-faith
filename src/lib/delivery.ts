import { dateIn, longDate, shortDate } from "./dates";

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

/** The day the delivery was recorded, where the property is (`zone`, its pack's), when that is later than the delivery
 *  date the record names: a statement handed over on Friday and recorded on Monday. Null when it was recorded the same
 *  day, and for a record from before tenancies.statement_delivery_recorded_at, which reads as recorded on its date. */
export function recordedLater(d: Pick<DeliveryRecord, "date"> | null, recordedAt: string | null | undefined, zone: string): string | null {
  if (!d || !recordedAt || Number.isNaN(Date.parse(recordedAt))) return null;
  const on = dateIn(recordedAt, zone);
  return on > d.date.slice(0, 10) ? on : null;
}

/** What tenancies.statement_delivery_recorded_at becomes on a save of the delivery record: when this delivery date was
 *  recorded. A correction that keeps the date (a fixed address, another adult named) keeps the first recording, or a
 *  record from before the column keeps reading as recorded on its date (null); a new delivery, or a new date, is
 *  recorded `now`. */
export const recordedAtFor = (previous: Pick<DeliveryRecord, "date"> | null, date: string, existing: string | null, now: string): string | null =>
  (previous && previous.date === date ? existing : now);

/** "recorded October 6, 2026" (long) or "recorded Oct 6, 2026" (short), for beside a delivery date. */
export const recordedWords = (on: string, long = true) => `recorded ${long ? longDate(on) : shortDate(on)}`;

/** One line for a delivery record, e.g. "first-class mail to 482 N. Glassell St on October 1, 2026". A mailing to the
 *  vacated unit says so, since that is allowed only when no forwarding address was provided. With `recordedOn` (a
 *  delivery recorded on a later day, recordedLater), the day it was recorded follows the date: "on October 1, 2026
 *  (recorded October 6, 2026)". */
export function describeDelivery(d: DeliveryRecord, recordedOn?: string | null): string {
  const where = d.method === "mail" && d.address
    ? ` to ${d.address}${d.address_kind === "unit" ? " (the vacated unit; no forwarding address was provided)" : ""}`
    : d.method === "email" && d.email ? ` to ${d.email}` : d.to ? ` to ${d.to}` : "";
  return `${d.method === "email" && d.basis ? d.basis : DELIVERY_LABEL[d.method]}${where} on ${longDate(d.date)}${recordedOn ? ` (${recordedWords(recordedOn)})` : ""}`;
}

/** The same in a few words for a list row ("Mailed Oct 1, 2026 to the vacated unit"); describeDelivery is its tip. */
export function deliveryLine(d: DeliveryRecord): string {
  const when = shortDate(d.date);
  if (d.method === "mail") return `Mailed ${when}${d.address_kind === "unit" ? " to the vacated unit" : d.address_kind === "forwarding" ? " to the forwarding address" : ""}`;
  if (d.method === "email") return `Emailed ${when}`;
  return `Handed over ${when}`;
}

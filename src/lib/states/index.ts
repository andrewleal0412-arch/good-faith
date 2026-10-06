// The state rule packs, by USPS code, and the helpers that pick a tenancy's pack. A tenancy follows the law of the
// state its property is in (properties.state, backfilled to CA for every row made before the packs existed). A state
// with no pack is refused by name: the lease check says which states are supported.
//
// Client-safe: the lease check and the tenancy's client components import this, and get each pack's ClientPack half.
// Server code imports `./server`, whose packFor joins the server half (the checklist, the agent's rules and prompt).

import { dateIn, todayIn } from "../dates";
import { CA } from "./ca";
import { FL } from "./fl";
import { NY } from "./ny";
import { TX } from "./tx";
import { WA } from "./wa";
import type { ClientPack, ClockInput, StateCode, ZoneException } from "./types";

export type { ClientPack, StateCode, StatePack } from "./types";

const PACKS: Record<StateCode, ClientPack> = { CA, NY, TX, FL, WA };

/** The supported states, California first, then alphabetically. */
export const SUPPORTED: StateCode[] = ["CA", "FL", "NY", "TX", "WA"];

export const isSupported = (code: string | null | undefined): code is StateCode => !!code && code in PACKS;

/** The pack for a state code. Throws for an unsupported one: a tenancy is never started in a state without a pack. */
export function packFor(code: string | null | undefined): ClientPack {
  const c = (code ?? "CA").toUpperCase();
  if (!isSupported(c)) throw new Error(`No rule pack for ${c}.`);
  return PACKS[c];
}

/** "California, Florida, New York, Texas and Washington". */
export const supportedNames = () => {
  const names = SUPPORTED.map((c) => PACKS[c].name);
  return `${names.slice(0, -1).join(", ")} and ${names[names.length - 1]}`;
};

/** Every state and DC, so an unsupported one is named in the refusal. */
export const STATE_NAMES: Record<string, string> = {
  AL: "Alabama", AK: "Alaska", AZ: "Arizona", AR: "Arkansas", CA: "California", CO: "Colorado", CT: "Connecticut",
  DE: "Delaware", DC: "the District of Columbia", FL: "Florida", GA: "Georgia", HI: "Hawaii", ID: "Idaho", IL: "Illinois",
  IN: "Indiana", IA: "Iowa", KS: "Kansas", KY: "Kentucky", LA: "Louisiana", ME: "Maine", MD: "Maryland",
  MA: "Massachusetts", MI: "Michigan", MN: "Minnesota", MS: "Mississippi", MO: "Missouri", MT: "Montana", NE: "Nebraska",
  NV: "Nevada", NH: "New Hampshire", NJ: "New Jersey", NM: "New Mexico", NY: "New York", NC: "North Carolina",
  ND: "North Dakota", OH: "Ohio", OK: "Oklahoma", OR: "Oregon", PA: "Pennsylvania", RI: "Rhode Island",
  SC: "South Carolina", SD: "South Dakota", TN: "Tennessee", TX: "Texas", UT: "Utah", VT: "Vermont", VA: "Virginia",
  WA: "Washington", WV: "West Virginia", WI: "Wisconsin", WY: "Wyoming", PR: "Puerto Rico",
};

const BY_NAME = Object.fromEntries(Object.entries(STATE_NAMES).map(([c, n]) => [n.replace(/^the /, "").toLowerCase(), c]));

/** A state code from what a lease or a landlord wrote: "TX", "Texas", or a one-line address ending ", Austin, TX 78701". */
export function stateCode(raw: string | null | undefined): string | null {
  if (!raw) return null;
  const s = raw.trim();
  if (/^[A-Za-z]{2}$/.test(s) && STATE_NAMES[s.toUpperCase()]) return s.toUpperCase();
  const named = BY_NAME[s.toLowerCase().replace(/\.$/, "")];
  if (named) return named;
  // The last "XX 12345" (or "XX, 12345", or "XX" at the end) in an address.
  const m = s.match(/(?:^|[\s,])([A-Za-z]{2})\.?,?\s+\d{5}(?:-\d{4})?\s*(?:,?\s*(?:USA|United States))?\s*$/) ?? s.match(/,\s*([A-Za-z]{2})\s*$/);
  if (m && STATE_NAMES[m[1].toUpperCase()]) return m[1].toUpperCase();
  const word = Object.entries(BY_NAME).find(([n]) => new RegExp(`,\\s*${n.replace(/ /g, "\\s+")}\\s*(?:\\d{5}(?:-\\d{4})?)?\\s*$`, "i").test(s));
  return word ? word[1] : null;
}

/** The plain refusal for a state with no pack. */
export function unsupportedMessage(code: string | null): string {
  const where = code && STATE_NAMES[code] ? `This lease is for a property in ${STATE_NAMES[code]}.` : "The lease doesn't say which state the property is in.";
  return `${where} Good Faith supports ${supportedNames()} for now. Pick the state if the lease got it wrong.`;
}

/** The one pack every given tenancy follows, or null when they span several states: a list's header tip then speaks
 *  generally and each row's own tip names its state's rule. */
export function onePack(codes: (string | null | undefined)[]): ClientPack | null {
  const set = new Set(codes.map((c) => (c ?? "CA").toUpperCase()));
  if (set.size > 1) return null;
  return packFor([...set][0] ?? "CA");
}

/** The deadline's words for a tenancy on its track: the due date's label, the refund page's check and its tip title.
 *  California's, Texas's, New York's and Washington's never change (Texas says "Refund and itemized list due", in its
 *  statute's words); Florida's follow the claim notice. */
export function deadlineWords(pack: ClientPack, c: ClockInput): { due: string; within: string; title: string } {
  return pack.deadline.words?.(c) ?? { due: "Statement and refund due", within: `Within the ${pack.deadline.days} days`, title: `${pack.deadline.days}-day deadline` };
}

/** What the tenants' signed refund record is called. Where a PayPal refund needs their written agreement (California's
 *  1950.5(h)(1)(A); Washington, by product policy) it is the refund agreement; elsewhere it is only their written
 *  designation of the PayPal account (Texas, New York, Florida), and never named as an agreement the law asks for. */
export function refundRecordWords(pack: Pick<ClientPack, "refund">) {
  return pack.refund.agreementRequired
    ? { name: "Refund agreement", check: "Refund by PayPal agreed in writing", tip: "Refund by PayPal", unsigned: "PayPal refund, in writing", none: "Not agreed" }
    : { name: "Refund account", check: "Refund account designated in writing", tip: "Refund account", unsigned: "PayPal account, in writing", none: "Not designated" };
}

/** The local rules a pack knows of for a city, shown only as a warning that local rules may add requirements. */
export function localOverlays(pack: ClientPack, city: string | null | undefined) {
  if (!city) return [];
  return pack.localOverlays.filter((o) => o.match.test(city.trim()));
}

/** The time zone a property's deadlines are counted in: its state pack's (Andrew, 2026-10-05). */
export const zoneOf = (code: string | null | undefined) => packFor(code).timeZone.id;

/** Today where the property is: the calendar day its state's deadlines are counted from. */
export const todayFor = (code: string | null | undefined) => todayIn(zoneOf(code));

/** The calendar day of a timestamp where the property is (a refund sent, a record made). */
export const dayFor = (ts: string, code: string | null | undefined) => dateIn(ts, zoneOf(code));

/** The parts of the state on another clock that a property's city is in (El Paso, Pensacola): shown as a warning only.
 *  The deadlines stay in the pack's own zone. */
export function zoneWarnings(pack: Pick<ClientPack, "timeZone">, city: string | null | undefined): ZoneException[] {
  if (!city) return [];
  return pack.timeZone.exceptions.filter((e) => e.match.test(city.trim()));
}

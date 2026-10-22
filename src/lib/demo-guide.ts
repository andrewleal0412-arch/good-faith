import { returnFailed, wasPaid } from "./invoice-status";
import { squash } from "./lease-key";
import { tabHref } from "./tenancy-tabs";

// The demo guide: the eight beats of docs/DEMO_SCRIPT.md as a short checklist inside a private demo copy, so a judge
// who never opens the README still finds every beat in their own copy. Shown only in a copy made with the judges' code
// (src/app/(landlord)/layout.tsx), never in the owner's workspace.
//
// docs/DEMO_SCRIPT.md is the source of the beats. BEATS below carries each beat's number, its title, the short name of
// the screen it happens on and, for the two beats that name a property, that property's address, straight from that
// file's beat table; scripts/e2e-demo.py reads both files and fails when they drift, so a beat renamed, reordered,
// moved to another screen or moved to another unit has to move in both places.
//
// Nothing here is stored: each step's tick is read off the copy's own rows (the lease Claude read, the paid deposit
// invoice, the photo comparison, the refund, the dispute, the negotiation, the settlement, a unit in a second state),
// and "hidden" and "collapsed" live in the browser as a cookie. No table and no column was added for it.

/** One beat as the guide shows it. */
export type GuideStep = {
  n: number; // the beat's number in docs/DEMO_SCRIPT.md
  title: string; // its name there ("Refund approval")
  line: string; // one short line, in plain words
  where: string; // the screen the link opens, named as the app names it ("Review refund")
  href: string; // that screen in this copy, down to the card
  done: boolean; // the copy's own rows already show this beat happened
};

/** The eight beats, in order. `where` is the default screen name; a step whose screen depends on how far the copy has
 *  come (beat 5, beat 8) names its own in `steps` below. `unit` is the property the beat's own row in that table names,
 *  which is how the guide picks the unit each beat runs on, so what a judge does in the copy can't move it. */
export const BEATS: readonly { n: number; title: string; line: string; where: string; unit?: string }[] = [
  { n: 1, title: "Lease check", line: "Claude reads the lease; code checks it against the statute.", where: "Check a lease" },
  { n: 2, title: "Deposit by PayPal", line: "The deposit came in by PayPal invoice, the lawful amount only.", where: "Move-in", unit: "1140 E. Juniper Hollow Ln" },
  { n: 3, title: "Move-out boxes", line: "Claude boxes what changed between the photos.", where: "Move-out tab" },
  { n: 4, title: "Refund approval", line: "The close-out agent proposes the refund; you approve it.", where: "Review refund" },
  { n: 5, title: "Tenant dispute", line: "The tenants dispute a charge; their own agent writes their case.", where: "Statement" },
  { n: 6, title: "Two-agent negotiation", line: "The two agents trade offers; code checks every turn.", where: "Move-out tab" },
  { n: 7, title: "PayPal settlement", line: "Both sides say yes, and PayPal sends the agreed amount.", where: "Move-out tab" },
  { n: 8, title: "Multi-state", line: "The second state's law, from its own rule pack.", where: "Properties", unit: "2317 Mesquite Bend Dr, Unit 3" },
];

/** What the guide reads off one tenancy in the copy: the columns the app shell has already loaded for its own
 *  notifications (src/lib/units.ts, workspaceTenancies), nothing more. */
export type GuideTenancy = {
  id: string;
  address: string | null; // the property's address, which names the unit a beat runs on (BEATS, `unit`)
  state: string; // the two-letter code of the pack its deposit law comes from
  moveOutDate: string | null;
  leaseChecked: boolean; // the deposit terms Claude read are on file
  inspected: boolean; // Claude compared the move-in and move-out photos
  statementDelivered: boolean;
  payments: { kind: string; status: string | null }[];
  // Every dispute the tenants sent on this unit, by status, drafts left out and a closed one kept: a dispute that ended
  // without a settlement ("no_agreement", "withdrawn") still happened, so its beats stay ticked (demo-guide-server.ts).
  disputesSent: string[];
};

const has = (t: GuideTenancy, kinds: string[]) => t.payments.some((p) => kinds.includes(p.kind) && !returnFailed(p.status));

/** Whether a unit is the one a beat names: its address begins with the street line in the beat's row of the table in
 *  docs/DEMO_SCRIPT.md, with case, punctuation and the city, state and ZIP that follow it ignored (squash,
 *  src/lib/lease-key.ts), so "1140 E. Juniper Hollow Ln" matches "1140 E. Juniper Hollow Ln, Orange, CA 92866". */
function isUnit(address: string | null, named: string | undefined): boolean {
  if (!named) return false;
  const want = squash(named), had = squash(address);
  return !!want && (had === want || had.startsWith(`${want} `));
}

const beat = (n: number) => BEATS.find((b) => b.n === n);

/** The unit the demo's live path runs on: the one docs/DEMO_SCRIPT.md beat 2 names, by address. It has to be something
 *  a judge cannot change in the copy, since several beats point at it: picking the most recent move-out would hand the
 *  guide to the Texas unit the moment a judge set a move-out date on it (the Texas unit's own page offers one, and
 *  beat 8 sends them there), and the live beats would un-tick. The most recent move-out is the fallback, for a copy
 *  whose addresses are not the demo's. */
export function liveUnit<T extends Pick<GuideTenancy, "address" | "moveOutDate">>(units: T[]): T | null {
  const named = units.find((u) => isUnit(u.address, beat(2)?.unit));
  if (named) return named;
  const moved = units.filter((u) => u.moveOutDate);
  if (!moved.length) return units[0] ?? null;
  return moved.reduce((best, u) => (u.moveOutDate! > best.moveOutDate! ? u : best));
}

/** The unit under another state's rule pack, for the multi-state beat: the one beat 8 names, else any unit whose pack
 *  is not the live unit's, else none (a copy with one state only). */
export function otherState<T extends Pick<GuideTenancy, "address" | "state">>(units: T[], live: T): T | null {
  return units.find((u) => isUnit(u.address, beat(8)?.unit)) ?? units.find((u) => u.state !== live.state) ?? null;
}

/** A dispute whose two agents traded offers, whatever came of it: the negotiation beat stays ticked after a settlement,
 *  after an end with no agreement (which the demo script plans for) and after the tenants withdrew. */
const NEGOTIATED = ["negotiating", "agreed", "settled", "no_agreement"];

/** The eight steps for this copy: where each beat happens in it, and which of them its rows already show. Null when
 *  the copy holds no tenancy at all, where the guide would have nothing to point at. */
export function guideSteps(units: GuideTenancy[]): GuideStep[] | null {
  const live = liveUnit(units);
  if (!live) return null;
  // The unit under another state's rule pack (the demo's Texas unit), for the multi-state beat.
  const other = otherState(units, live);
  // The settlement reads the same way the deductions lock does (src/lib/dispute-status.ts): a settlement payment went,
  // or the dispute was settled (the demo's recorded example was settled with no PayPal money behind it).
  const sent = live.disputesSent;
  const settled = has(live, ["settlement_refund", "settlement_payout"]) || sent.includes("settled");
  const done: Record<number, boolean> = {
    1: units.some((u) => u.leaseChecked),
    2: live.payments.some((p) => p.kind === "deposit_invoice" && wasPaid(p.status)),
    3: live.inspected,
    4: has(live, ["refund", "payout"]),
    5: sent.length > 0 || settled,
    6: sent.some((s) => NEGOTIATED.includes(s)) || settled,
    7: settled,
    8: !!other,
  };
  // Where each beat happens in this copy, down to the card. Two of them depend on how far the copy has come:
  //  - beat 5 is the tenants' own page, which the Tenants tab's Tenant link card opens ("Open the tenant's view").
  //    Until the statement's delivery is recorded there is nothing for them to dispute, so until then it opens the
  //    statement's delivery card instead, which is the step the demo script records before beat 5.
  //  - beat 8 opens the unit in the other state, and falls back to Properties in a copy that has none.
  const href: Record<number, string> = {
    1: "/lease",
    2: tabHref(live.id, "overview", "move-in"),
    3: tabHref(live.id, "move-out", "photos"),
    4: `/tenancy/${live.id}/refund`,
    5: live.statementDelivered ? tabHref(live.id, "tenants", "tenant-link") : `/tenancy/${live.id}/statement#delivery`,
    6: tabHref(live.id, "move-out", "negotiation"),
    7: tabHref(live.id, "move-out", "negotiation"),
    8: other ? tabHref(other.id, "overview") : "/units",
  };
  const where: Record<number, string> = {
    5: live.statementDelivered ? "Tenant link" : "Statement",
    8: other ? `${other.state} unit` : "Properties",
  };
  return BEATS.map((b) => ({ ...b, where: where[b.n] ?? b.where, href: href[b.n], done: done[b.n] }));
}

/** The cookie the browser keeps the guide's state in: absent is open, "shut" is collapsed to its one line, "off" is
 *  hidden for good (the account menu brings it back). A preference, no data. */
export const GUIDE_COOKIE = "gf_guide";
export type GuideState = "open" | "shut" | "off";
export const guideState = (v: string | undefined): GuideState => (v === "off" ? "off" : v === "shut" ? "shut" : "open");

/** The cookie that says this browser has seen the welcome (src/lib/demo-welcome.ts): "seen", or absent. The card opens
 *  once per browser, on Properties; "Welcome tour" in the account menu opens it again. */
export const WELCOME_COOKIE = "gf_welcome";

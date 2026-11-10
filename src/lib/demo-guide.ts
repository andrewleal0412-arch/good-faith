import { returnFailed } from "./invoice-status";
import { squash } from "./lease-key";
import { tabHref } from "./tenancy-tabs";

// The demo guide: the seven beats of docs/DEMO_SCRIPT.md as a short checklist inside a private demo copy, so a judge
// who never opens the README still finds every beat in their own copy, and the next-step bar under every page
// (components/guide-bar.tsx) that says what to press next and rings it. Shown only in a copy made with the judges' code
// (src/app/(landlord)/layout.tsx), never in the owner's workspace.
//
// The order is the story a judge follows on one unit, one beat after the other: Claude's boxes on the move-out photos,
// the refund back on the same PayPal deposit, the tenants' dispute and their advocate, the two agents' negotiation, both
// humans' yes and PayPal's payment; then the two beats that stand alone, the lease check and the second state. The
// deposit by PayPal invoice has no beat of its own: it is the "From" of the refund review, where it matters (the refund
// goes back on that same payment).
//
// docs/DEMO_SCRIPT.md is the source of the beats. BEATS below carries each beat's number, its title, the short name of
// the screen it happens on and, for the two beats that name a property, that property's address, straight from that
// file's beat table; scripts/e2e-demo.py reads both files and fails when they drift, so a beat renamed, reordered,
// moved to another screen or moved to another unit has to move in both places.
//
// Nothing here is stored: each step's tick is read off the copy's own rows (the photo comparison, the refund, the
// dispute, the negotiation, the settlement, the lease Claude read, a unit in a second state), and "hidden",
// "collapsed", "open" and which of the look beats this browser has opened live in the browser as cookies. No table and
// no column was added for it.
//
// A fresh copy already holds three of the beats (the photo comparison, the lease Claude read, the unit in the second
// state): they are what the copy is made of, and a judge has them to look at, not to do. Ticking them off before the
// judge has opened anything would read as "3 of 7 done" on the first screen, which says to skip them. So those three
// (LOOK_BEATS) are `held` by the copy from the start and `done` only once this browser has opened their page (the lease
// beat once a check's result is on it), kept in a cookie like Hide; the other four are done when the copy's rows show
// them, which in a copy happens only by the judge's own clicks.

/** Which side of the demo a control is on: the landlord's app, or the tenants' own page (/t/<token>). */
export type GuideSide = "landlord" | "tenants";

/** One thing to press (or look at) for a beat, as the next-step bar says it after "Step 2 of 7:": "press Prepare
 *  refund". `target` names the control on its page (its data-guide-target), which the bar scrolls to and rings; `href` is that page in this copy,
 *  or null for a control every demo page carries (the Landlord | Tenants switch). A `wait` is Claude at work: the bar
 *  says on what and for about how long, and its target is the part of the page where the answer lands. */
export type GuideMove = { label: string; side: GuideSide; href: string | null; target: string | null; wait?: true };

/** One beat as the guide shows it. */
export type GuideStep = {
  n: number; // the beat's number in docs/DEMO_SCRIPT.md
  title: string; // its name there ("Refund approval")
  line: string; // one short line, in plain words
  where: string; // the screen the link opens, named as the app names it ("Review refund")
  href: string; // that screen in this copy, down to the card
  held: boolean; // the copy's own rows already show this beat happened
  done: boolean; // ticked: held, and for a look beat (LOOK_BEATS) opened in this browser
  // What to press next for this beat, in order from where the copy stands: the first is the move the rows say is next;
  // the ones after it happen on the same page (the tenants' dispute form: ask the advocate, then send), and the bar
  // takes the last of them whose control is on the page.
  moves: GuideMove[];
};

/** The beats a fresh copy already holds, ticked only once this browser has opened their page: the photo beat and the
 *  second state on arriving at the page their link opens (pageBeat), the lease beat once a lease check's result is on
 *  the page (BEAT_EVENT). */
export const LOOK_BEATS: readonly number[] = [1, 6, 7];
/** The lease check's beat, which comes by BEAT_EVENT rather than by its page. */
export const LEASE_BEAT = 6;

/** The seven beats, in order. `where` is the default screen name; a step whose screen depends on how far the copy has
 *  come (the dispute, the settlement, the second state) names its own in `steps` below. `unit` is the property the
 *  beat's own row in that table names, which is how the guide picks the unit each beat runs on, so what a judge does in
 *  the copy can't move it. */
export const BEATS: readonly { n: number; title: string; line: string; where: string; unit?: string }[] = [
  { n: 1, title: "Move-out boxes", line: "Claude boxes what changed between the move-in and move-out photos.", where: "Move-out tab", unit: "1140 E. Juniper Hollow Ln" },
  { n: 2, title: "Refund approval", line: "The deposit came in by PayPal invoice; the close-out agent proposes the refund on that same payment, and you approve it.", where: "Review refund" },
  { n: 3, title: "Tenant dispute", line: "As the tenants, dispute a charge; their own agent writes their case.", where: "Tenants' page" },
  { n: 4, title: "Two-agent negotiation", line: "The two agents trade offers; code checks every turn.", where: "Move-out tab" },
  { n: 5, title: "PayPal settlement", line: "Both sides say yes, and PayPal sends the agreed amount.", where: "Move-out tab" },
  { n: 6, title: "Lease check", line: "Claude reads a lease; code checks it against the statute.", where: "Check a lease" },
  { n: 7, title: "Multi-state", line: "A Texas unit runs on Texas law, from its own rule pack.", where: "Properties", unit: "2317 Mesquite Bend Dr, Unit 3" },
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
  // The live unit's moving parts, read for it alone (demo-guide-server.ts), which pick the next move inside a beat; absent
  // on the other units, and in the unit checks that leave them out.
  closeOut?: string | null; // the latest close-out run's status: "running", "awaiting_approval", "done", or null for none
  tenantsAccepted?: boolean; // the tenants accepted the settlement the agents agreed
  tenantPath?: string | null; // the tenants' page of this copy (/t/<token>), when the copy carries its demo token
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

/** The unit the demo's live path runs on: the one docs/DEMO_SCRIPT.md beat 1 names, by address. It has to be something
 *  a judge cannot change in the copy, since several beats point at it: picking the most recent move-out would hand the
 *  guide to the Texas unit the moment a judge set a move-out date on it (the Texas unit's own page offers one, and
 *  beat 7 sends them there), and the live beats would un-tick. The most recent move-out is the fallback, for a copy
 *  whose addresses are not the demo's. */
export function liveUnit<T extends Pick<GuideTenancy, "address" | "moveOutDate">>(units: T[]): T | null {
  const named = units.find((u) => isUnit(u.address, beat(1)?.unit));
  if (named) return named;
  const moved = units.filter((u) => u.moveOutDate);
  if (!moved.length) return units[0] ?? null;
  return moved.reduce((best, u) => (u.moveOutDate! > best.moveOutDate! ? u : best));
}

/** The unit under another state's rule pack, for the multi-state beat: the one beat 7 names, else any unit whose pack
 *  is not the live unit's, else none (a copy with one state only). */
export function otherState<T extends Pick<GuideTenancy, "address" | "state">>(units: T[], live: T): T | null {
  return units.find((u) => isUnit(u.address, beat(7)?.unit)) ?? units.find((u) => u.state !== live.state) ?? null;
}

/** A dispute whose two agents have finished trading offers, whatever came of it: the negotiation beat stays ticked after
 *  a settlement and after an end with no agreement (which the demo script plans for). While they are still at it
 *  ("negotiating") the beat is the wait, not done. */
const NEGOTIATED = ["agreed", "settled", "no_agreement"];

/** The seven steps for this copy: where each beat happens in it, which of them its rows already show, and what to press
 *  next for each. Null when the copy holds no tenancy at all, where the guide would have nothing to point at. */
export function guideSteps(units: GuideTenancy[], seen: ReadonlySet<number> = new Set()): GuideStep[] | null {
  const live = liveUnit(units);
  if (!live) return null;
  // The unit under another state's rule pack (the demo's Texas unit), for the multi-state beat.
  const other = otherState(units, live);
  // The settlement reads the same way the deductions lock does (src/lib/dispute-status.ts): a settlement payment went,
  // or the dispute was settled (the demo's recorded example was settled with no PayPal money behind it).
  const sent = live.disputesSent;
  const settled = has(live, ["settlement_refund", "settlement_payout"]) || sent.includes("settled");
  const done: Record<number, boolean> = {
    1: live.inspected,
    2: has(live, ["refund", "payout"]),
    3: sent.length > 0 || settled,
    4: sent.some((s) => NEGOTIATED.includes(s)) || settled,
    5: settled,
    6: units.some((u) => u.leaseChecked),
    7: !!other,
  };
  const tenants = live.tenantPath ?? null;
  const moveOut = (card: string) => tabHref(live.id, "move-out", card);
  // Where each beat happens in this copy, down to the card. The tenants' beats open the tenants' own page once the
  // statement's delivery is recorded; until then there is nothing for them to dispute, and the Landlord | Tenants switch
  // records it first (components/guide-bar.tsx), so the dispute's link is the statement's delivery card.
  const href: Record<number, string> = {
    1: moveOut("photos"),
    2: `/tenancy/${live.id}/refund`,
    3: tenants && live.statementDelivered ? tenants : `/tenancy/${live.id}/statement#delivery`,
    4: moveOut("negotiation"),
    5: moveOut("negotiation"),
    6: "/lease",
    7: other ? tabHref(other.id, "overview") : "/units",
  };
  const where: Record<number, string> = {
    3: tenants && live.statementDelivered ? "Tenants' page" : "Statement",
    7: other ? `${other.state} unit` : "Properties",
  };
  const land = (label: string, href: string | null, target: string | null): GuideMove => ({ label, side: "landlord", href, target });
  const ten = (label: string, href: string | null, target: string | null): GuideMove => ({ label, side: "tenants", href, target });
  const wait = (m: GuideMove): GuideMove => ({ ...m, wait: true });
  // The live dispute's status (one withdrawn before it doesn't count), which picks the negotiation's and the settlement's move.
  const status = sent.find((s) => s !== "withdrawn") ?? null;
  const moves: Record<number, GuideMove[]> = {
    1: [land("look at the boxes Claude drew on the move-out photos", href[1], "photos")],
    2: live.closeOut === "running" ? [wait(land("Claude, the close-out agent, is preparing the refund, usually under a minute", href[2], "refund-working"))]
      : live.closeOut === "awaiting_approval" ? [land("press Send refund", href[2], "send-refund")]
      : [land("press Prepare refund", href[2], "prepare-refund"),
        wait(land("Claude, the close-out agent, is preparing the refund, usually under a minute", href[2], "refund-working")),
        land("press Send refund", href[2], "send-refund")],
    3: !tenants ? [land("open the Tenants tab's Tenant link", tabHref(live.id, "tenants", "tenant-link"), "tenant-link")]
      : !live.statementDelivered ? [land("press Tenants at the top: it records the statement's delivery, then opens their page", null, "side-tenants")]
      : [ten("press Dispute it, under Deductions", tenants, "dispute-start"),
        ten("tick a charge, say why, pick your name, then press Ask my advocate", `${tenants}/dispute`, "ask-advocate"),
        wait(ten("Claude, the tenants' advocate, is writing their case, about a minute", `${tenants}/dispute`, "advocate-working")),
        ten("press Send under the case, then Send in the dialog", `${tenants}/dispute`, "send-dispute")],
    4: status === "negotiating" ? [wait(land("the two agents are negotiating, a live Claude call a turn, about half a minute each", href[4], "negotiation"))]
      : [land("press Let my negotiator answer", href[4], "negotiate")],
    5: status === "no_agreement" ? [land("no agreement this time: make an offer on the Move-out tab, or Start over for a fresh copy", href[5], "negotiation")]
      : live.tenantsAccepted ? [land("press Approve and pay", href[5], "approve-pay")]
      : [ten("as the tenants, pick your name and press Accept settlement", tenants ? `${tenants}/dispute` : null, "accept-settlement")],
    6: [land("press Check the sample lease", href[6], "sample-lease")],
    7: [land("look at the Rules chip under the Texas unit's address", href[7], "rules")],
  };
  return BEATS.map((b) => ({
    ...b, where: where[b.n] ?? b.where, href: href[b.n], held: done[b.n], done: done[b.n] && (!LOOK_BEATS.includes(b.n) || seen.has(b.n)), moves: moves[b.n],
  }));
}

/** The cookie that keeps which look beats this browser has opened: their numbers joined by ".", "1.6.7". Absent is
 *  none. A preference, no data; the server reads it so the first render already shows the right ticks. */
export const SEEN_COOKIE = "gf_guide_seen";
export const seenBeats = (v: string | undefined): Set<number> =>
  new Set((v ?? "").split(/[^0-9]+/).map(Number).filter((n) => BEATS.some((b) => b.n === n)));
export const seenValue = (seen: ReadonlySet<number>): string => [...seen].sort((a, b) => a - b).join(".");

/** The event the guide sends when this browser has just opened a look beat (its cookie already holds it), so the
 *  next-step bar reads the steps again and moves on. */
export const SEEN_EVENT = "gf:guide-seen";

/** The event the lease check sends once a check's result is on the page (src/app/(landlord)/lease/lease-check.tsx),
 *  with the beat's number as its detail, and the guide ticks that beat if the copy holds it. */
export const BEAT_EVENT = "gf:demo-beat";

/** The look beat whose page a location is, by the step's own link: the same path and the same ?tab (Overview when
 *  there is none, src/lib/tenancy-tabs.ts), the hash and any other query left out, so "/tenancy/<id>?tab=move-out" is
 *  the photo beat's page and "/tenancy/<tx>" the second state's. The lease beat is not found this way (a visit to Check
 *  a lease is not a check): it comes by BEAT_EVENT. */
export function pageBeat(steps: readonly GuideStep[], pathname: string, search: string): number | null {
  const at = (path: string, query: string) => `${path}?${new URLSearchParams(query).get("tab") ?? "overview"}`;
  const here = at(pathname, search);
  for (const s of steps) {
    if (s.n === LEASE_BEAT || !LOOK_BEATS.includes(s.n)) continue;
    const [noHash] = s.href.split("#");
    const [path, query = ""] = noHash.split("?");
    if (at(path, query) === here) return s.n;
  }
  return null;
}

/** The cookie the browser keeps the guide's state in, once this browser has chosen one: "open" is the seven rows,
 *  "shut" is collapsed to its one line (the count, and the next beat as a link to its page), "off" is hidden for good
 *  (the account menu brings it back). Absent, no choice yet (guideChoice gives null), the guide takes the page's
 *  default (guideDefault): open on Properties, the copy's first screen, where the welcome tour ends on it and no beat
 *  needs the room (beat 7's chip is in the table beside it), and one line on every other page, so the screen a beat
 *  opens (the photos, the upload box, the Move-in card) is not pushed 250 px down by the checklist that sent the
 *  judge there. A choice made on any page holds on every page. A preference, no data. */
export const GUIDE_COOKIE = "gf_guide";
export type GuideState = "open" | "shut" | "off";
export const guideChoice = (v: string | undefined): GuideState | null => (v === "off" || v === "shut" || v === "open" ? v : null);
/** Properties, the one page the guide opens its rows on by default: /units, and the bare address, which renders the
 *  same page (src/app/(landlord)/page.tsx) and is where the access gate sends a judge (as components/demo-welcome.tsx
 *  and the sidebar read it). */
export const GUIDE_HOME: readonly string[] = ["/", "/units"];
export const guideDefault = (pathname: string): GuideState => (GUIDE_HOME.includes(pathname) ? "open" : "shut");
/** What the guide shows on a page: this browser's choice when it has made one, else the page's default. */
export const guideView = (choice: GuideState | null, pathname: string): GuideState => choice ?? guideDefault(pathname);

/** The cookie that says this browser put the next-step bar away (components/guide-bar.tsx): "off", or absent for
 *  shown. Hidden, the bar is a small "Next step" button in the corner that brings it back; Demo guide in the account
 *  menu brings it back too. A preference, no data; the server reads it so a hidden bar never flashes in. */
export const BAR_COOKIE = "gf_guide_bar";

/** The cookie that says this browser has seen the welcome (src/lib/demo-welcome.ts): "seen", or absent. The card opens
 *  once per browser, on Properties; "Welcome tour" in the account menu opens it again. */
export const WELCOME_COOKIE = "gf_welcome";

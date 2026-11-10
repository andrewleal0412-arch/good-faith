import { dayLabel } from "./dates";
import { BEATS, guideSteps, liveUnit, otherState } from "./demo-guide";
import { wasPaid } from "./invoice-status";
import type { TenancySummary } from "./next-step";
import { packFor } from "./states";

// The welcome a judge's copy opens with: one card on what this is and whose shoes they are in, then, if they want it,
// a four-stop tour of Properties that ends on the demo guide's seven steps (components/demo-welcome.tsx). A judge meets
// three new ideas before the first screen (the judges' code, a private copy, the guide), and this is the one place
// that puts them together.
//
// Every name, figure and date it says is read off the copy's own units, the same two the guide runs on (liveUnit and
// otherState, src/lib/demo-guide.ts), and each state's deadline comes from its own pack. Nothing is stored but the
// cookie that says this browser has seen it (WELCOME_COOKIE).

/** One stop of the tour: the part of Properties it rings (a selector the page carries), and what it says there. */
export type TourStop = { anchor: string; title: string; body: string };

/** The card's words and the tour's stops. `start` is where the tour's last button goes: the move-out photos, beat 1. */
export type DemoWelcome = { title: string; lead: string; lines: string[]; stops: TourStop[]; start: string };

/** What the welcome reads off one unit, from the rows Properties has already loaded (src/lib/units.ts, loadUnits). */
export type WelcomeUnit = {
  id: string;
  address: string | null; // the whole address, which names the unit a beat runs on
  street: string; // the street line, as Properties shows it
  city: string | null;
  state: string; // the two-letter code of its pack
  tenants: string[];
  deposit: number | null; // the deposit invoice's amount
  held: boolean; // that deposit was paid and nothing of it has gone back (heldNow)
  moveOutDate: string | null;
  inspected: boolean; // Claude compared the move-in and move-out photos
  due: string | null; // the statement and refund deadline under its pack, while the unit is open
  closed: boolean; // the statement is out and the deposit settled (closedOut, src/lib/next-step.ts)
};

/** A unit's deposit is held while it was paid, PayPal has not reversed it, and nothing of it has gone back by any
 *  route: the refund or Payout, the tenants' PayPal dispute, a refund recorded here, or a settlement. */
export const heldNow = (s: Pick<TenancySummary, "deposit" | "returned" | "viaDispute" | "outside" | "settledBack">): boolean =>
  !!s.deposit && wasPaid(s.deposit.status) && !s.deposit.reversed && !s.returned && !s.viaDispute && !s.outside && !s.settledBack;

const WHOLE = new Intl.NumberFormat("en-US", { maximumFractionDigits: 0 });
const CENTS = new Intl.NumberFormat("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const dollars = (n: number) => `$${Number.isInteger(n) ? WHOLE.format(n) : CENTS.format(n)}`;
const and = (xs: string[]) => (xs.length < 2 ? xs.join("") : `${xs.slice(0, -1).join(", ")} and ${xs[xs.length - 1]}`);
const lower = (s: string) => s.charAt(0).toLowerCase() + s.slice(1);

/** The welcome for this copy, or null for a copy with no tenancy to point at. `account` is the demo landlord's business
 *  (DEMO_ACCOUNT, src/lib/workspace.ts), `today` the copy's own today. */
export function welcomeOf({ units, account, today, sandbox }: { units: WelcomeUnit[]; account: string; today: string; sandbox: boolean }): DemoWelcome | null {
  const live = liveUnit(units);
  if (!live) return null;
  const other = otherState(units, live);
  const pack = packFor(live.state);
  const who = live.tenants.length ? and(live.tenants) : "The tenants";
  const first = live.tenants.length ? and(live.tenants.map((t) => t.split(" ")[0])) : "The tenants";
  const deposit = live.deposit != null ? `${dollars(live.deposit)} deposit` : "deposit";
  const moved = live.moveOutDate ? `moved out on ${dayLabel(live.moveOutDate, today)}` : "are moving out";
  // The account menu opens it again at any point of the demo, so the lead asks for the close-out only while it is due.
  const task = live.closed ? `Their ${deposit} is closed out.` : `Close out their ${deposit}. ${pack.name} gives you ${pack.deadline.summary}.`;

  const stops: TourStop[] = [
    {
      anchor: `[data-tour-unit="${live.id}"]`,
      title: "Your move-out",
      body: live.inspected
        ? `${first} ${moved}. ${live.held ? `Their ${deposit} is held, and Claude` : "Claude"} has already boxed what changed in the photos.`
        : `${first} ${moved}. Next, Claude compares the move-in and move-out photos.`,
    },
    {
      anchor: '[data-tour="next-steps"]',
      title: "What the law needs next",
      body: `Each card is one property's next step, from its own state's law.${live.due
        ? ` The clock on ${live.street} runs out on ${dayLabel(live.due, today)}: ${lower(pack.deadline.tip.title)}.` : ""}`,
    },
    ...(other ? [{
      anchor: `[data-tour-unit="${other.id}"]`,
      title: "A second state",
      body: `${other.city ? `This unit is in ${other.city}, so ${packFor(other.state).name} law runs it.` : `This unit follows ${packFor(other.state).name} law.`} ${packFor(other.state).deadline.tip.text}`,
    }] : []),
    {
      anchor: '[data-tour="guide"]',
      title: `Your ${BEATS.length} steps`,
      body: "The demo in order. Each step opens where it happens in your copy, and ticks itself off once your copy shows it done; the three your copy already holds, once you open them. The bar at the bottom of every page says what to press next, and Take me there rings it. The account menu brings this tour back.",
    },
  ];

  // Beat 1's own link, as the guide builds it, so the two never disagree on where the move-out photos are.
  const start = guideSteps([{ ...live, leaseChecked: false, statementDelivered: false, payments: [], disputesSent: [] }])!.find((s) => s.n === 1)!.href;

  return {
    title: `You're the landlord at ${account}`,
    lead: `${who} ${live.moveOutDate ? "moved" : "are moving"} out of ${live.street}. ${task}`,
    lines: [
      "Claude compares the move-in and move-out photos. Code prices each charge against the statute.",
      sandbox ? "PayPal runs in its sandbox: real API calls, test money." : "PayPal is live here: real money moves.",
      `${BEATS.length} steps, ticked off in the checklist at the top of each page. Three of them wait on Claude: the refund under a minute, the tenants' case about a minute, the negotiation a turn at a time.`,
    ],
    stops,
    start,
  };
}

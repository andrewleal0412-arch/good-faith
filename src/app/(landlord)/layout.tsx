import { headers } from "next/headers";
import { redirect } from "next/navigation";
import { Suspense } from "react";
import { AppShell, type ShellAlert, type ShellChrome } from "@/components/app-shell";
import { RouteSkeleton } from "@/components/route-skeleton";
import { initialsOf } from "@/components/ui";
import { displayName } from "@/lib/copy";
import { longDate } from "@/lib/dates";
import { SANDBOX } from "@/lib/paypal";
import { canSignOut } from "@/lib/session-server";
import { stepLink } from "@/lib/property-view";
import { streetLine } from "@/lib/ledger";
import { disputeAlerts } from "@/lib/negotiation";
import { paypalAlerts } from "@/lib/paypal-webhook-store";
import { paypalDisputeAlerts } from "@/lib/chargeback-store";
import { accountName, loadUnits, type UnitRow } from "@/lib/units";
import { packFor, SUPPORTED } from "@/lib/states";
import { noticeOf } from "@/lib/notice-page";
import { currentWorkspace, DEMO_ACCOUNT, ownedTenancy, type Workspace } from "@/lib/workspace";
import { PATH_HEADER } from "@/lib/page-path";

// The shell reads the database (the account, the bell), so no landlord page may be prerendered at build time with
// whatever the data was then: every page under this layout renders per request.
export const dynamic = "force-dynamic";

/** Never fails: a read that can't be done leaves its part of the chrome empty, and the page reports its own error. */
const settled = <T,>(p: Promise<T>, fallback: T, what: string) => p.catch((e) => { console.error(`App shell: couldn't load ${what}`, e); return fallback; });

/** The parts of the chrome that come from the database: the account, the bell and Help's guides. Every read starts at
 *  once (the units are the request's one workspace read, which the page shares). */
async function chromeOf(ws: Workspace | null): Promise<ShellChrome> {
  const [{ units, owners }, disputes, ppDisputes, paypal] = await Promise.all([
    settled(loadUnits(), { units: [] as UnitRow[], owners: [] as string[], today: "", upcoming: [] }, "the units"),
    ws ? settled(disputeAlerts(ws.id), [], "the disputes") : Promise.resolve([]),
    ws ? settled(paypalDisputeAlerts(ws.id), [], "the PayPal disputes") : Promise.resolve([]),
    ws ? settled(paypalAlerts(ws.id), [], "PayPal's reports") : Promise.resolve([]),
  ]);

  // The account: a demo copy's is the demo landlord's business; the owner's GOOD_FAITH_ACCOUNT, or the owner of the
  // oldest tenancy (accountName), shown without "LLC".
  const named = await accountName(owners).catch(() => null);
  const account = named ? displayName(named) : "Your account";

  // The bell: the tenants' PayPal disputes of their deposit payments (one to answer, a response to approve or to
  // check), then their disputes that wait on the landlord (an answer, an approval, or the negotiator asking first),
  // then the steps that are overdue or due within five days.
  const alerts: ShellAlert[] = [
    ...ppDisputes.map((a) => ({ title: a.title, sub: `${streetLine(a.sub)}${a.due ? `, respond by ${longDate(a.due)}` : ""}`, href: a.href, tone: a.tone })),
    ...disputes.map((a) => ({ ...a, sub: streetLine(a.sub) })),
    ...units
      .filter((u) => u.next.level === "overdue" || u.next.level === "urgent")
      .slice(0, 6)
      .map((u): ShellAlert => ({
        title: u.next.label,
        sub: `${streetLine(u.summary.address)}${u.next.due ? `, ${u.next.deadline ? "due" : ""} ${longDate(u.next.due)}`.replace(",  ", ", ") : ""}`,
        href: stepLink(u.summary, u.next).href,
        tone: u.next.level === "overdue" ? "red" : "amber",
      })),
  ];

  // Help's deposit-law guide and disclaimer: California's, as always, unless the workspace rents in other states; then
  // one guide per state, and the disclaimer of that state (or a general one across several).
  const states = SUPPORTED.filter((c) => units.some((u) => u.summary.state === c));
  const shown = states.length ? states : (["CA"] as const);
  const rules = shown.map((c) => ({ label: `${packFor(c).name} deposit rules`, href: packFor(c).courtsGuide.url }));
  const disclaimer = shown.length === 1
    ? packFor(shown[0]).copy.disclaimers[0]
    : "This tool organizes your records and fills in templates based on each property's state deposit law and published state guidance. It does not give legal advice, does not evaluate your specific situation, and is not a substitute for an attorney where the property is.";

  // What PayPal reported lately through its webhook (src/lib/paypal-webhook.ts): a deposit paid, a refund or Payout
  // that finished or came back, a reversal, a PayPal dispute.
  return {
    account, initials: initialsOf(account), owners, alerts, disclaimer, rules,
    paypal: paypal.map((a) => ({ title: a.title, sub: streetLine(a.sub), href: a.href, tone: a.tone })),
  };
}

/** Whether the page asked for will answer "not found": a property that isn't in this workspace (or doesn't exist), or
 *  a notice its state doesn't have. Both reads are the ones the page itself makes, kept for it (React cache). */
async function answersNotFound(path: string): Promise<boolean> {
  const m = path.match(/^\/tenancy\/([^/]+)(?:\/notices\/([^/]+))?/);
  if (!m) return false;
  if (!(await ownedTenancy(m[1]))) return true;
  return m[2] ? !(await noticeOf(m[1], m[2])) : false;
}

// Every landlord page sits in the app shell. The tenants' page (/t/<token>) is outside this group and never sees it.
// The frame (sidebar, top bar, the page's own skeleton) goes out at once; the account, the bell and the page's data
// stream in after it, so the first paint never waits on the database.
//
// The page sits in one Suspense boundary that stays mounted from page to page: a page opened from the shell renders in
// a transition inside it, so its skeleton (which the shell draws itself on the click) is never committed as a
// fallback, and React's 300 ms hold on a fallback once shown never delays the content. Per-route loading.tsx files
// would mount a new boundary on every click. The one cost of streaming is the status code, fixed once the first bytes
// are out, so an address that answers 404 is checked first and rendered without the boundary: the page's own
// notFound() then comes before anything is sent, and the shell's not-found page goes out with a 404.
export default async function LandlordLayout({ children }: LayoutProps<"/">) {
  // A signed session whose copy of the demo is gone (the sweep removes copies after two weeks) has nothing to show:
  // the access page makes a new one. With the gate off (local dev) every request is the owner. This read is kept in
  // memory for a minute (workspace.ts), so it rarely waits on the database.
  let ws: Workspace | null = null;
  let unreadable = false;
  try {
    ws = await currentWorkspace();
  } catch (e) {
    unreadable = true;
    console.error("App shell: couldn't read the workspace", e);
  }
  if (!ws && !unreadable && canSignOut()) redirect("/access?e=ended");

  // A demo copy's account is always the demo landlord's, and the owner's is fixed when GOOD_FAITH_ACCOUNT is set: then
  // the avatar and the account name are in the first paint too.
  const known = ws?.kind === "demo" ? DEMO_ACCOUNT : ws?.kind === "owner" ? process.env.GOOD_FAITH_ACCOUNT?.trim() || null : null;
  const account = known ? displayName(known) : null;
  const notFoundFirst = ws ? await answersNotFound((await headers()).get(PATH_HEADER) ?? "") : false;
  return (
    <AppShell sandbox={SANDBOX} signOut={canSignOut()} startOver={canSignOut() && ws?.kind === "demo"}
      account={account ? { account, initials: initialsOf(account) } : null} chrome={chromeOf(ws)}>
      {notFoundFirst ? children : <Suspense fallback={<RouteSkeleton />}>{children}</Suspense>}
    </AppShell>
  );
}

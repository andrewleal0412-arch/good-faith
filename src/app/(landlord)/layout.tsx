import { redirect } from "next/navigation";
import { AppShell, type ShellAlert, type ShellData } from "@/components/app-shell";
import { initialsOf } from "@/components/ui";
import { displayName } from "@/lib/copy";
import { longDate } from "@/lib/dates";
import { SANDBOX } from "@/lib/paypal";
import { canSignOut } from "@/lib/session-server";
import { stepLink } from "@/lib/property-view";
import { streetLine } from "@/lib/ledger";
import { disputeAlerts } from "@/lib/negotiation";
import { accountName, loadUnits, type UnitRow } from "@/lib/units";
import { packFor, SUPPORTED } from "@/lib/states";
import { currentWorkspace, type Workspace } from "@/lib/workspace";

// The shell reads the database (the account, the bell), so no landlord page may be prerendered at build time with
// whatever the data was then: every page under this layout renders per request.
export const dynamic = "force-dynamic";

// Every landlord page sits in the app shell. The tenants' page (/t/<token>) is outside this group and never sees it.
export default async function LandlordLayout({ children }: LayoutProps<"/">) {
  // A signed session whose copy of the demo is gone (the sweep removes copies after two weeks) has nothing to show:
  // the access page makes a new one. With the gate off (local dev) every request is the owner.
  let ws: Workspace | null = null;
  let unreadable = false;
  try {
    ws = await currentWorkspace();
  } catch (e) {
    unreadable = true;
    console.error("App shell: couldn't read the workspace", e);
  }
  if (!ws && !unreadable && canSignOut()) redirect("/access?e=ended");

  // The chrome must render even when the database can't be read, so a failed read leaves an empty bell and a generic
  // account rather than taking every page down with it (the page itself reports its own error).
  let units: UnitRow[] = [];
  let owners: string[] = [];
  try {
    ({ units, owners } = await loadUnits());
  } catch (e) {
    console.error("App shell: couldn't load the units", e);
  }

  // The account: a demo copy's is the demo landlord's business; the owner's GOOD_FAITH_ACCOUNT, or the owner of the
  // oldest tenancy (accountName), shown without "LLC".
  const named = await accountName(owners).catch(() => null);
  const account = named ? displayName(named) : "Your account";

  // The bell: steps that are overdue or due within five days.
  const alerts: ShellAlert[] = units
    .filter((u) => u.next.level === "overdue" || u.next.level === "urgent")
    .slice(0, 6)
    .map((u) => ({
      title: u.next.label,
      sub: `${streetLine(u.summary.address)}${u.next.due ? `, ${u.next.deadline ? "due" : ""} ${longDate(u.next.due)}`.replace(",  ", ", ") : ""}`,
      href: stepLink(u.summary, u.next).href,
      tone: u.next.level === "overdue" ? "red" : "amber",
    }));

  // And the tenants' disputes that wait on the landlord: an answer, an approval, or the negotiator asking first.
  if (ws) {
    try {
      alerts.unshift(...(await disputeAlerts(ws.id)).map((a) => ({ ...a, sub: streetLine(a.sub) })));
    } catch (e) {
      console.error("App shell: couldn't load the disputes", e);
    }
  }

  // Help's deposit-law guide and disclaimer: California's, as always, unless the workspace rents in other states; then
  // one guide per state, and the disclaimer of that state (or a general one across several).
  const states = SUPPORTED.filter((c) => units.some((u) => u.summary.state === c));
  const shown = states.length ? states : (["CA"] as const);
  const rules = shown.map((c) => ({ label: `${packFor(c).name} deposit rules`, href: packFor(c).courtsGuide.url }));
  const disclaimer = shown.length === 1
    ? packFor(shown[0]).copy.disclaimers[0]
    : "This tool organizes your records and fills in templates based on each property's state deposit law and published state guidance. It does not give legal advice, does not evaluate your specific situation, and is not a substitute for an attorney where the property is.";

  const data: ShellData = {
    account, initials: initialsOf(account), owners, sandbox: SANDBOX, alerts, disclaimer, rules, signOut: canSignOut(),
    startOver: canSignOut() && ws?.kind === "demo",
  };
  return <AppShell data={data}>{children}</AppShell>;
}

import { AppShell, type ShellAlert, type ShellData } from "@/components/app-shell";
import { initialsOf } from "@/components/ui";
import { DISCLAIMERS, displayName } from "@/lib/copy";
import { longDate } from "@/lib/dates";
import { SANDBOX } from "@/lib/paypal";
import { canSignOut } from "@/lib/session-server";
import { stepLink } from "@/lib/property-view";
import { streetLine } from "@/lib/ledger";
import { accountName, loadUnits, type UnitRow } from "@/lib/units";

// The shell reads the database (the account, the bell), so no landlord page may be prerendered at build time with
// whatever the data was then: every page under this layout renders per request.
export const dynamic = "force-dynamic";

// Every landlord page sits in the app shell. The tenants' page (/t/<token>) is outside this group and never sees it.
export default async function LandlordLayout({ children }: LayoutProps<"/">) {
  // The chrome must render even when the database can't be read, so a failed read leaves an empty bell and a generic
  // account rather than taking every page down with it (the page itself reports its own error).
  let units: UnitRow[] = [];
  let owners: string[] = [];
  try {
    ({ units, owners } = await loadUnits());
  } catch (e) {
    console.error("App shell: couldn't load the units", e);
  }

  // The account: GOOD_FAITH_ACCOUNT, or the owner of the oldest tenancy (accountName), shown without "LLC".
  const named = accountName(owners);
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

  const data: ShellData = { account, initials: initialsOf(account), owners, sandbox: SANDBOX, alerts, disclaimer: DISCLAIMERS[0], signOut: canSignOut() };
  return <AppShell data={data}>{children}</AppShell>;
}

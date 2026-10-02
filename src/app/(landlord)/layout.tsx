import { AppShell, type ShellAlert, type ShellData } from "@/components/app-shell";
import { initialsOf } from "@/components/ui";
import { DISCLAIMERS } from "@/lib/copy";
import { longDate } from "@/lib/dates";
import { SANDBOX } from "@/lib/paypal";
import { stepLink } from "@/lib/property-view";
import { streetLine } from "@/lib/ledger";
import { loadUnits, type UnitRow } from "@/lib/units";

// The shell reads the database (the account, the bell), so no landlord page may be prerendered at build time with
// whatever the data was then: every page under this layout renders per request.
export const dynamic = "force-dynamic";

// Every landlord page sits in the app shell. The tenants' page (/t/<token>) is outside this group and never sees it.
export default async function LandlordLayout({ children }: LayoutProps<"/">) {
  // The chrome must render even when the database can't be read, so a failed read leaves an empty bell and a generic
  // account rather than taking every page down with it (the page itself reports its own error).
  let units: UnitRow[] = [];
  try {
    units = (await loadUnits()).units;
  } catch (e) {
    console.error("App shell: couldn't load the units", e);
  }

  // The account is the landlord the leases name; with several on file, the one with the most units.
  const counts = new Map<string, number>();
  for (const u of units) if (u.summary.landlord) counts.set(u.summary.landlord, (counts.get(u.summary.landlord) ?? 0) + 1);
  const owners = [...counts.keys()];
  const account = [...counts.entries()].sort((a, b) => b[1] - a[1])[0]?.[0] ?? "Your account";

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

  const data: ShellData = { account, initials: initialsOf(account), owners, sandbox: SANDBOX, alerts, disclaimer: DISCLAIMERS[0] };
  return <AppShell data={data}>{children}</AppShell>;
}

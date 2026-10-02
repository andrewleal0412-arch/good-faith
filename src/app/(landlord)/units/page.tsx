import Link from "next/link";
import type { Metadata } from "next";
import { ButtonLink } from "@/components/button";
import { Icon, PayPalMark } from "@/components/icons";
import { InfoTip } from "@/components/info-tip";
import { Menu } from "@/components/menu";
import {
  Card, CardHead, EmptyState, Fact, FactStrip, KV, ListRow, Money, PageHead, Segmented, StatusChip, StepBox, Table, Td, Th, Thumb, trClass,
} from "@/components/ui";
import { foldActivity, QUIET_ACTIONS } from "@/lib/activity";
import { dayLabel, daysBetween, pacificDate, shortDate } from "@/lib/dates";
import { statementDue } from "@/lib/deductions";
import { wasPaid } from "@/lib/invoice-status";
import { loadLedger } from "@/lib/ledger-load";
import { ledgerTotals } from "@/lib/ledger";
import { closedOut, refundLeft, type TenancySummary } from "@/lib/next-step";
import { GROUP_LABEL, propertyStatus, splitAddress, stepLink, tabHref, type StatusGroup } from "@/lib/property-view";
import { loadRecentActivity, loadThumbnails, loadUnits, UPCOMING_DAYS } from "@/lib/units";

export const dynamic = "force-dynamic";
export const metadata: Metadata = { title: "Properties" };

// Properties, the landlord's home: quick actions, three facts, every tenancy with its status and the one thing it
// needs next (worked out from its own dates in src/lib/next-step.ts), recent activity, and a rail with the next steps,
// the nearest 21-day deadline and PayPal.

/** What the unit holds right now, from the stored PayPal records and the deductions; the ledger counts the same way. */
function heldNow(s: TenancySummary): number {
  if (!s.deposit || s.returned || !wasPaid(s.deposit.status)) return 0;
  if (s.statementDeliveredAt) return refundLeft(s) ?? s.deposit.amount;
  return s.deposit.amount;
}

const plural = (n: number, one: string, many = `${one}s`) => `${n} ${n === 1 ? one : many}`;

export default async function PropertiesPage({ searchParams }: PageProps<"/units">) {
  const sp = await searchParams;
  const filter = (typeof sp.filter === "string" ? sp.filter : "all") as StatusGroup | "all";
  const q = typeof sp.q === "string" ? sp.q.trim().toLowerCase() : "";

  const { today, units, upcoming } = await loadUnits();
  const [ledger, thumbs, log] = await Promise.all([
    loadLedger(),
    loadThumbnails(units.map((u) => u.summary.id)),
    loadRecentActivity(40, QUIET_ACTIONS),
  ]);

  const rows = units.map((u) => ({ ...u, status: propertyStatus(u.summary, u.next), step: stepLink(u.summary, u.next), addr: splitAddress(u.summary.address, u.summary.city) }));
  const searched = q ? rows.filter((r) => `${r.summary.address} ${r.summary.tenants.join(" ")}`.toLowerCase().includes(q)) : rows;
  const groups = (["move-in", "leased", "move-out", "closed"] as StatusGroup[]).map((g) => [g, searched.filter((r) => r.status.group === g).length] as const);
  const shown = filter === "all" ? searched : searched.filter((r) => r.status.group === filter);
  const href = (f: string) => `/units?${new URLSearchParams({ ...(f !== "all" ? { filter: f } : {}), ...(q ? { q } : {}) })}`.replace(/\?$/, "");

  // The three facts: what is held now, and what went back and was kept this calendar year, from the ledger's rows.
  const year = today.slice(0, 4);
  const lrows = "error" in ledger ? [] : ledger.rows;
  const held = "error" in ledger ? units.reduce((s, u) => s + heldNow(u.summary), 0) : ledgerTotals(lrows).held;
  const holding = units.filter((u) => heldNow(u.summary) > 0).length;
  const refunds = lrows.filter((r) => r.effect === "returned" && r.date.startsWith(year));
  const deducted = lrows.filter((r) => r.kind === "deduction" && r.effect === "claimed" && r.date.startsWith(year) && r.amount > 0);
  const sum = (xs: { amount: number }[]) => Math.round(xs.reduce((s, r) => s + r.amount, 0) * 100) / 100;

  // The rail: open steps, most urgent first (loadUnits sorts them), and the nearest running 21-day clock.
  const steps = rows.filter((r) => r.next.level !== "done" && r.next.level !== "later").slice(0, 3);
  const clock = rows.filter((r) => r.summary.moveOutDate && !closedOut(r.summary))
    .map((r) => ({ ...r, due: statementDue(r.summary.moveOutDate!) }))
    .sort((a, b) => a.due.localeCompare(b.due))[0];
  const invoices = units.filter((u) => u.summary.deposit).length;
  // Coming up: every dated event across the units in the next few months, nearest first, less the deadline the card
  // above already shows.
  const coming = upcoming.filter((e) => !(clock && e.tenancyId === clock.summary.id && e.kind === "statement_due")).slice(0, 5);
  const owners = new Map<string, number>();
  for (const u of units) if (u.summary.landlord) owners.set(u.summary.landlord, (owners.get(u.summary.landlord) ?? 0) + 1);
  const account = [...owners.entries()].sort((a, b) => b[1] - a[1])[0]?.[0] ?? "Connected";

  // Recent activity, with a run of deductions or photos on one unit folded into one line.
  const street = new Map(rows.map((r) => [r.summary.id, r.addr.street]));
  const tenantsOf = new Map(rows.map((r) => [r.summary.id, r.summary.tenants]));
  const activity = foldActivity(log, (id) => tenantsOf.get(id) ?? [], 5).map(({ entry: e, title }) => ({
    key: e.id, title, sub: street.get(e.tenancyId) ?? "", date: dayLabel(pacificDate(e.createdAt), today), href: `/tenancy/${e.tenancyId}`,
  }));

  // Quick actions go to the unit that needs them, or to the lease check when none does.
  const needsDeposit = rows.find((r) => r.summary.agreement && !r.summary.deposit) ?? rows.find((r) => !r.summary.deposit);
  const leased = rows.find((r) => r.status.group === "leased");

  return (
    <>
      <PageHead title="Properties" actions={<ButtonLink variant="primary" href="/lease"><Icon name="plus" />Add property</ButtonLink>} />

      <div className="mb-6 flex flex-wrap gap-2">
        <ButtonLink href="/lease"><Icon name="file-check" />Check a lease</ButtonLink>
        <ButtonLink href={needsDeposit ? tabHref(needsDeposit.summary.id, "overview", "move-in") : "/lease"}><Icon name="receive" />Request deposit</ButtonLink>
        <ButtonLink href={leased ? tabHref(leased.summary.id, "move-out", "notice") : "/move-outs"}><Icon name="key" />Start move-out</ButtonLink>
      </div>

      <FactStrip className="mb-6">
        <Fact label="Deposits held" big value={<Money value={held} cents="small" />} sub={plural(holding, "tenancy", "tenancies")} />
        <Fact label="Refunded this year" big value={<Money value={sum(refunds)} cents="small" />} sub={plural(refunds.length, "refund")} />
        <Fact label="Deducted this year" big value={<Money value={sum(deducted)} cents="small" />} sub={plural(deducted.length, "item")} />
      </FactStrip>

      {units.length === 0 ? (
        <Card>
          <EmptyState title="No properties yet" sub="Check a lease to add the first one."
            action={<ButtonLink variant="primary" href="/lease"><Icon name="file-check" />Check a lease</ButtonLink>} />
        </Card>
      ) : (
        <div className="grid items-start gap-6 lg:grid-cols-[minmax(0,1fr)_288px]">
          <div className="min-w-0">
            <div className="mb-3.5 flex flex-wrap items-center gap-2">
              <Segmented active={filter} items={[
                { key: "all", label: "All", count: searched.length, href: href("all") },
                ...groups.filter(([g, n]) => n > 0 || g === filter).map(([g, n]) => ({ key: g, label: GROUP_LABEL[g], count: n, href: href(g) })),
              ]} />
              {q && (
                <Link href={href(filter)} className="ml-1 inline-flex h-[30px] items-center gap-1.5 rounded-md border border-line px-2.5 text-sm text-ink-2 hover:bg-surface">
                  &ldquo;{q}&rdquo;<Icon name="x" className="size-3 text-ink-4" />
                </Link>
              )}
            </div>

            {/* The table at desktop width; cards on a phone. */}
            <Card className="hidden md:block">
              {shown.length ? (
                <Table>
                  <thead>
                    <tr>
                      <Th first>Property</Th><Th>Tenants</Th><Th align="right">Rent</Th><Th align="right">Deposit</Th><Th>Status</Th><Th>Next step</Th><Th last />
                    </tr>
                  </thead>
                  <tbody>
                    {shown.map((r) => {
                      const s = r.summary;
                      return (
                        <tr key={s.id} className={trClass}>
                          <Td first className="whitespace-nowrap">
                            <Link href={`/tenancy/${s.id}`} className="flex items-center gap-3">
                              <Thumb src={thumbs.get(s.id) ?? null} />
                              <span className="min-w-0">
                                <span className="block font-medium text-ink">{r.addr.street}</span>
                                <span className="block text-xs text-ink-3">{r.addr.cityLine}</span>
                              </span>
                            </Link>
                          </Td>
                          <Td className="whitespace-nowrap">{s.tenants.length ? s.tenants.map((t) => <div key={t}>{t}</div>) : <span className="text-ink-3">None named</span>}</Td>
                          <Td align="right">{s.monthlyRent != null ? <Money value={s.monthlyRent} /> : "--"}</Td>
                          <Td align="right">{s.deposit ? <Money value={s.deposit.amount} /> : <span className="text-ink-3">--</span>}</Td>
                          <Td><StatusChip tone={r.status.tone}>{r.status.label}</StatusChip></Td>
                          <Td className="whitespace-nowrap"><Link href={r.step.href} className="font-medium text-brand hover:underline">{r.step.label}</Link></Td>
                          <Td last className="w-11">
                            <Menu label={`More for ${r.addr.street}`} items={[
                              { label: "Open", href: `/tenancy/${s.id}`, icon: "building" },
                              { label: "Move-out", href: tabHref(s.id, "move-out"), icon: "key" },
                              { label: "Payments", href: tabHref(s.id, "payments"), icon: "card" },
                              { label: "Statement", href: `/tenancy/${s.id}/statement`, icon: "doc" },
                              ...(r.events.length ? [{ label: "Add to calendar", href: `/api/tenancies/${s.id}/calendar`, icon: "calendar" as const, plain: true }] : []),
                            ]} />
                          </Td>
                        </tr>
                      );
                    })}
                  </tbody>
                </Table>
              ) : <EmptyState icon="search" title="No properties match" sub="Try another filter or search." />}
            </Card>

            <div className="flex flex-col gap-2.5 md:hidden">
              {shown.map((r) => {
                const s = r.summary;
                return (
                  <Card key={s.id} className="flex items-start gap-3 p-3.5">
                    <Link href={`/tenancy/${s.id}`} aria-label={r.addr.street} tabIndex={-1}><Thumb src={thumbs.get(s.id) ?? null} size={48} /></Link>
                    <div className="min-w-0 flex-1">
                      <Link href={`/tenancy/${s.id}`} className="block font-medium">{r.addr.street}</Link>
                      <div className="truncate text-xs text-ink-3">{s.tenants.join(", ") || "No tenants named"}</div>
                      <div className="mt-2 flex gap-4 text-xs text-ink-3">
                        <span>Rent<b className="block text-sm font-medium text-ink">{s.monthlyRent != null ? <Money value={s.monthlyRent} /> : "--"}</b></span>
                        <span>Deposit<b className="block text-sm font-medium text-ink">{s.deposit ? <Money value={s.deposit.amount} /> : "--"}</b></span>
                      </div>
                      <div className="mt-2.5 flex items-center justify-between gap-2">
                        <StatusChip tone={r.status.tone}>{r.status.label}</StatusChip>
                        <Link href={r.step.href} className="truncate text-sm font-medium text-brand">{r.step.label}</Link>
                      </div>
                    </div>
                  </Card>
                );
              })}
              {!shown.length && <Card><EmptyState icon="search" title="No properties match" sub="Try another filter or search." /></Card>}
            </div>

            <Card className="mt-6">
              <CardHead title="Recent activity" right={<Link href="/ledger" className="text-sm text-brand hover:underline">View all</Link>} />
              <div className="px-5 py-1">
                {activity.length ? activity.map((a) => <ListRow key={a.key} title={a.title} sub={a.sub} right={a.date} href={a.href} />)
                  : <p className="py-3 text-sm text-ink-3">Nothing yet.</p>}
              </div>
            </Card>
          </div>

          <div className="flex flex-col gap-4 max-lg:order-first">
            <Card>
              <CardHead title="Next steps" />
              <div className="flex flex-col gap-2 p-4">
                {steps.length ? steps.map((r) => (
                  <StepBox key={r.summary.id} icon={r.step.icon} title={r.step.title} sub={r.addr.street} href={r.step.href} />
                )) : <p className="text-sm text-ink-3">Nothing due right now.</p>}
              </div>
            </Card>

            {clock && (() => {
              const s = clock.summary;
              const left = daysBetween(today, clock.due);
              const state = s.statementDeliveredAt ? "Delivered" : s.deductions.length || s.moveOutInspectedAt ? "Draft" : "Not started";
              return (
                <Card className="p-5">
                  <div className="text-sm font-medium">Statement and refund due</div>
                  <div className="mb-2 text-xs text-ink-3">{clock.addr.street}</div>
                  <div className="text-xl font-medium tabular-nums">{shortDate(clock.due)}</div>
                  <div className={`mt-0.5 flex items-center gap-[5px] text-sm ${left < 0 ? "text-red" : "text-ink-3"}`}>
                    {left < 0 ? `${-left} days late` : left === 0 ? "Due today" : `${left} days left`}
                    <InfoTip title="21 days after move-out" cite="Civ. Code 1950.5(h)(1)">
                      The itemized statement and the refund are due within 21 calendar days after the tenants leave. Bad-faith retention can cost up to twice the deposit (1950.5(m)).
                    </InfoTip>
                  </div>
                  <div className="my-3.5 h-px bg-line" />
                  <KV align="right" rows={[
                    ["Moved out", shortDate(s.moveOutDate!)],
                    ["Deposit held", s.deposit ? <Money key="d" value={heldNow(s) || s.deposit.amount} /> : "--"],
                    ["Statement", <span key="s" className={state === "Not started" ? "text-ink-3" : ""}>{state}</span>],
                  ]} />
                </Card>
              );
            })()}

            {coming.length > 0 && (
              <Card>
                <CardHead title="Coming up" meta={`Next ${UPCOMING_DAYS} days`} />
                <div className="px-5 py-1">
                  {coming.map((e) => (
                    <ListRow key={`${e.tenancyId}-${e.kind}`} title={e.label.split(",")[0]} hint={e.label} sub={street.get(e.tenancyId) ?? ""} right={dayLabel(e.date, today)}
                      href={`/tenancy/${e.tenancyId}`} />
                  ))}
                </div>
              </Card>
            )}

            <Card soft className="p-5 max-md:hidden">
              <div className="flex items-center gap-2 text-sm font-medium"><PayPalMark size={16} />PayPal</div>
              <KV align="right" className="mt-2.5" rows={[
                ["Account", account],
                ["Deposit invoices", String(invoices)],
              ]} />
            </Card>
          </div>
        </div>
      )}
    </>
  );
}

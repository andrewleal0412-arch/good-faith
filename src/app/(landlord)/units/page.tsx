import Link from "@/components/link";
import type { Metadata } from "next";
import { ButtonLink } from "@/components/button";
import { Icon, PayPalMark } from "@/components/icons";
import { InfoTip } from "@/components/info-tip";
import { Menu } from "@/components/menu";
import {
  Card, CardHead, EmptyState, Fact, FactStrip, KV, ListRow, Money, PageHead, Segmented, StatusChip, StepBox, Table, Td, Th, Thumb, trClass,
} from "@/components/ui";
import { foldActivity, QUIET_ACTIONS } from "@/lib/activity";
import { displayName } from "@/lib/copy";
import { dayLabel, daysBetween, pacificDate, shortDate } from "@/lib/dates";
import { wasPaid } from "@/lib/invoice-status";
import { loadLedger } from "@/lib/ledger-load";
import { ledgerTotals } from "@/lib/ledger";
import { paypalDisputeAlerts } from "@/lib/chargeback-store";
import { disputeAlerts, type DisputeAlert } from "@/lib/negotiation";
import { closedOut, dueLabelOf, dueOf, packOf, refundLeft, type TenancySummary } from "@/lib/next-step";
import { GROUP_LABEL, keepUnit, propertyStatus, splitAddress, stepLink, tabHref, type StatusGroup, type StepLink } from "@/lib/property-view";
import { packFor } from "@/lib/states/server";
import { accountName, loadRecentActivity, loadThumbnails, loadUnits, UPCOMING_DAYS } from "@/lib/units";
import { currentWorkspace } from "@/lib/workspace";

export const dynamic = "force-dynamic";
export const metadata: Metadata = { title: "Properties" };

// Properties, the landlord's home: quick actions, three facts, every tenancy with its status and the one thing it
// needs next (worked out from its own dates and its state's rule pack in src/lib/next-step.ts), recent activity, and a
// rail with the next steps, the nearest statement and refund deadline (21 days in California) and PayPal.

/** What the unit holds right now, from the stored PayPal records and the deductions; the ledger counts the same way. */
function heldNow(s: TenancySummary): number {
  if (!s.deposit || s.returned || !wasPaid(s.deposit.status) || s.deposit.reversed) return 0;
  if (s.statementDeliveredAt) return refundLeft(s) ?? s.deposit.amount;
  return s.deposit.amount;
}

/** The state whose deposit law a property follows, as a small tag beside its street; the tip names the statute. */
function StateTag({ state }: { state: string }) {
  const pack = packFor(state);
  return <span title={`${pack.name}: ${pack.statute.short}`} className="ml-1.5 inline-flex h-[18px] items-center rounded-xs bg-surface-2 px-1 align-[1px] text-xs font-medium text-ink-3">{pack.code}</span>;
}

/** A street with its state tag. When the column is narrow the street wraps between words, and the tag stays with the
 *  last one ("Unit 3 TX"), so it never sits alone on a line. */
function Street({ street, state }: { street: string; state: string }) {
  const s = keepUnit(street);
  const i = s.lastIndexOf(" ");
  return <>{s.slice(0, i + 1)}<span className="whitespace-nowrap">{s.slice(i + 1)}<StateTag state={state} /></span></>;
}

const plural = (n: number, one: string, many = `${one}s`) => `${n} ${n === 1 ? one : many}`;

/** A tenants' dispute that waits on the landlord comes before the unit's own next step: in the table, the rail and the
 *  bell alike (the bell's entries, src/lib/negotiation.ts). */
const DISPUTE_STEP: Record<string, Pick<StepLink, "label" | "icon">> = {
  "Tenants disputed the statement": { label: "Answer dispute", icon: "doc" },
  "Approve and pay the settlement": { label: "Approve settlement", icon: "send" },
  "Check the settlement with PayPal": { label: "Check payment", icon: "send" },
  "Your negotiator asks for your OK": { label: "Answer negotiator", icon: "pen" },
  // The tenants' PayPal dispute of the deposit payment (src/lib/chargeback-store.ts, paypalDisputeAlerts).
  "Answer the PayPal dispute": { label: "Answer PayPal", icon: "card" },
  "Approve the PayPal dispute response": { label: "Approve response", icon: "send" },
  "Check the PayPal dispute response": { label: "Check response", icon: "card" },
};
const disputeStep = (a: DisputeAlert): StepLink => ({ label: DISPUTE_STEP[a.title]?.label ?? "View dispute", icon: DISPUTE_STEP[a.title]?.icon ?? "doc", title: a.title, href: a.href });

export default async function PropertiesPage({ searchParams }: PageProps<"/units">) {
  const sp = await searchParams;
  const filter = (typeof sp.filter === "string" ? sp.filter : "all") as StatusGroup | "all";
  const q = typeof sp.q === "string" ? sp.q.trim().toLowerCase() : "";

  // Every read at once: the units and the ledger share the request's one workspace read (the shell's too), the
  // thumbnails are only signed once it is in, and the activity and the disputes don't wait for it.
  const ws = await currentWorkspace();
  const [{ today, units, upcoming, owners }, ledger, thumbs, log, disputes] = await Promise.all([
    loadUnits(),
    loadLedger(),
    loadUnits().then((u) => loadThumbnails(u.units.map((x) => x.summary.id))),
    loadRecentActivity(40, QUIET_ACTIONS),
    ws ? Promise.all([
      disputeAlerts(ws.id).catch((e) => { console.error("Properties: couldn't load the disputes", e); return [] as DisputeAlert[]; }),
      paypalDisputeAlerts(ws.id).catch((e) => { console.error("Properties: couldn't load the PayPal disputes", e); return []; }),
    ]).then(([a, b]) => [...b, ...a] as DisputeAlert[]) : Promise.resolve([] as DisputeAlert[]),
  ]);
  // A PayPal dispute's step comes first: PayPal's date is the nearer one.
  const disputeOf = new Map([...disputes].reverse().map((a) => [a.tenancyId, a]));

  const rows = units.map((u) => {
    const a = disputeOf.get(u.summary.id);
    return { ...u, status: propertyStatus(u.summary, u.next), step: a ? disputeStep(a) : stepLink(u.summary, u.next), dispute: !!a, addr: splitAddress(u.summary.address, u.summary.city) };
  });
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
  // A settled dispute gave part of the deductions back: they count as settled, as the ledger and each unit's Payments
  // tab count them (ledgerTotals), and the settlement itself is in Refunded.
  const settled = lrows.filter((r) => r.kind === "settlement" && (r.effect === "returned" || r.effect === "pending") && r.date.startsWith(year));
  const sum = (xs: { amount: number }[]) => Math.round(xs.reduce((s, r) => s + r.amount, 0) * 100) / 100;

  // The rail: a dispute waiting on the landlord first, then open steps, most urgent first (loadUnits sorts them), and
  // the nearest running statement clock.
  const steps = [...rows.filter((r) => r.dispute), ...rows.filter((r) => !r.dispute && r.next.level !== "done" && r.next.level !== "later")].slice(0, 3);
  const clock = rows.filter((r) => r.summary.moveOutDate && !closedOut(r.summary))
    .map((r) => ({ ...r, due: dueOf(r.summary) ?? r.summary.moveOutDate!, pack: packOf(r.summary) }))
    .sort((a, b) => a.due.localeCompare(b.due))[0];
  const invoices = units.filter((u) => u.summary.deposit).length;
  // Coming up: every dated event across the units in the next few months, nearest first, less the deadline the card
  // above already shows.
  const coming = upcoming.filter((e) => !(clock && e.tenancyId === clock.summary.id && e.kind === "statement_due")).slice(0, 5);
  const named = await accountName(owners);
  const account = named ? displayName(named) : "Connected";

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
        <Fact label="Deducted this year" big value={<Money value={Math.max(0, Math.round((sum(deducted) - sum(settled)) * 100) / 100)} cents="small" />}
          sub={`${plural(deducted.length, "item")}${settled.length ? `, less ${plural(settled.length, "settlement")}` : ""}`} />
      </FactStrip>

      {units.length === 0 ? (
        <Card>
          <EmptyState title="No properties yet" sub="Check a lease to add the first one."
            action={<ButtonLink variant="primary" href="/lease"><Icon name="file-check" />Check a lease</ButtonLink>} />
        </Card>
      ) : (
        <div className="grid items-start gap-6 xl:grid-cols-[minmax(0,1fr)_288px]">
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

            {/* The table from 1024px, with Tenants from 1400px (below that the tenants take the city's line); cards below
                1024px. The rail sits beside the table from 1280px, under it before. The table is never wider than about
                840px (the 1208px page less its gutters and the rail), so it has no Rent column: rent is on each unit's
                page and the phone cards. The street may wrap, so a long address or step never pushes the last columns
                out of the card; every other cell keeps to one line. */}
            <Card className="hidden lg:block">
              {shown.length ? (
                <Table>
                  <thead>
                    <tr>
                      <Th first>Property</Th><Th className="max-[1399px]:hidden">Tenants</Th><Th align="right">Deposit</Th><Th>Status</Th><Th>Next step</Th><Th last />
                    </tr>
                  </thead>
                  <tbody>
                    {shown.map((r) => {
                      const s = r.summary;
                      return (
                        <tr key={s.id} className={trClass}>
                          <Td first>
                            <Link href={`/tenancy/${s.id}`} className="flex items-center gap-3">
                              <Thumb src={thumbs.get(s.id) ?? null} />
                              <span className="min-w-0">
                                <span className="block font-medium text-ink"><Street street={r.addr.street} state={s.state} /></span>
                                <span className="block whitespace-nowrap text-xs text-ink-3 max-[1399px]:hidden">{r.addr.cityLine}</span>
                                <span className="block whitespace-nowrap text-xs text-ink-3 min-[1400px]:hidden">{s.tenants.join(", ") || r.addr.cityLine}</span>
                              </span>
                            </Link>
                          </Td>
                          <Td className="whitespace-nowrap max-[1399px]:hidden">{s.tenants.length ? s.tenants.map((t) => <div key={t}>{t}</div>) : <span className="text-ink-3">None named</span>}</Td>
                          <Td align="right">{s.deposit ? <Money value={s.deposit.amount} /> : <span className="text-ink-3">None</span>}</Td>
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

            <div className="flex flex-col gap-2.5 lg:hidden">
              {shown.map((r) => {
                const s = r.summary;
                return (
                  <Card key={s.id} className="flex items-start gap-3 p-3.5">
                    <Link href={`/tenancy/${s.id}`} aria-label={r.addr.street} tabIndex={-1}><Thumb src={thumbs.get(s.id) ?? null} size={48} /></Link>
                    <div className="min-w-0 flex-1">
                      <Link href={`/tenancy/${s.id}`} className="block font-medium"><Street street={r.addr.street} state={s.state} /></Link>
                      <div className="truncate text-xs text-ink-3">{s.tenants.join(", ") || "No tenants named"}</div>
                      <div className="mt-2 flex gap-4 text-xs text-ink-3">
                        <span>Rent<b className="block text-sm font-medium text-ink">{s.monthlyRent != null ? <Money value={s.monthlyRent} /> : "Not set"}</b></span>
                        <span>Deposit<b className="block text-sm font-medium text-ink">{s.deposit ? <Money value={s.deposit.amount} /> : "None"}</b></span>
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

          {/* Beside the table from 1280px; above it before, two cards to a row on a tablet. */}
          <div className="flex flex-col gap-4 max-xl:order-first md:max-xl:grid md:max-xl:grid-cols-2 md:max-xl:items-start">
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
                  <div className="text-sm font-medium">{dueLabelOf(s)}</div>
                  <div className="mb-2 text-xs text-ink-3">{clock.addr.street}</div>
                  <div className="text-xl font-medium tabular-nums">{shortDate(clock.due)}</div>
                  <div className={`mt-0.5 flex items-center gap-[5px] text-sm ${left < 0 ? "text-red" : "text-ink-3"}`}>
                    {left < 0 ? `${-left} days late` : left === 0 ? "Due today" : `${left} days left`}
                    <InfoTip title={clock.pack.deadline.tip.title} cite={clock.pack.deadline.tip.cite}>{clock.pack.deadline.railText}</InfoTip>
                  </div>
                  <div className="my-3.5 h-px bg-line" />
                  <KV align="right" rows={[
                    ["Moved out", shortDate(s.moveOutDate!)],
                    ["Deposit held", !s.deposit ? "None" : s.deposit.reversed ? <span key="d" className="text-red">Reversed</span> : <Money key="d" value={heldNow(s) || s.deposit.amount} />],
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

            <Card soft className="p-5 max-xl:hidden">
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

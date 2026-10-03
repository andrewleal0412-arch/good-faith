import Link from "next/link";
import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { cache } from "react";
import { ButtonLink } from "@/components/button";
import { Icon } from "@/components/icons";
import { InfoTip } from "@/components/info-tip";
import { Menu, type MenuItem } from "@/components/menu";
import { Card, CardHead, Fact, FactStrip, KV, ListRow, Money, StatusChip, StepBox, Table, Tabs, Td, Th, Thumb, trClass } from "@/components/ui";
import { describe, foldActivity, QUIET_ON_RECORD } from "@/lib/activity";
import type { Pending } from "@/lib/agent";
import { wasPaid } from "@/lib/invoice-status";
import { db, signedUrls } from "@/lib/db";
import { settle, statementDue, type StoredDeduction } from "@/lib/deductions";
import { boxesOf, findingTitle, inPageOrder, type StoredFinding } from "@/lib/findings";
import { refreshDepositInvoice } from "@/lib/deposit";
import { dayLabel, daysBetween, pacificDate, pacificToday, shortDate, whenText } from "@/lib/dates";
import { tenancyEvents } from "@/lib/ics";
import { ledgerRows, type LedgerDeduction } from "@/lib/ledger";
import { closedOut, nextStep } from "@/lib/next-step";
import { NOTICE_INFO, NOTICE_SLUG, describeNoticeGiven, type NoticeKind, type Notices } from "@/lib/notices";
import { keepUnit, propertyStatus, splitAddress, stepLink, tabHref, TABS, type TabKey } from "@/lib/property-view";
import { lawfulDeposit, type Flag, type LeaseTerms } from "@/lib/rules";
import { deliveryLine, describeDelivery, type DeliveryRecord } from "@/lib/statement";
import { describeTenantMoveOut, type TenantMoveOut } from "@/lib/tenant";
import { activeTenantLink } from "@/lib/tenant-links";
import { summarizeTenancy } from "@/lib/units";
import { MoneyTimeline } from "./money";
import { MoveInSteps } from "./move-in-steps";
import { MoveOut, type FindingView, type QuietRoom } from "./move-out";
import { CloseOut } from "./close-out";
import { NoticeSection } from "./notice";
import { Settlement } from "./settlement";
import { TenantLinkPanel } from "./tenant-link";

export const dynamic = "force-dynamic";

/** The tenancy row with its property, read once per request: the page title and the page share it. */
const loadTenancy = cache(async (id: string) => (await db.from("tenancies").select("*, properties(*)").eq("id", id).maybeSingle()).data);

export async function generateMetadata({ params }: PageProps<"/tenancy/[id]">): Promise<Metadata> {
  const { id } = await params;
  const p = ((await loadTenancy(id))?.properties ?? null) as { address: string; city: string | null } | null;
  return { title: p ? splitAddress(p.address, p.city).street : "Property" };
}

// One property: the record header (photo, address, status, the statement and the one primary action) over five tabs.
// Overview holds move-in and the activity; Move-out the notice, the photos, the deductions and the refund; Payments
// the money; Documents every paper the law asks for; Tenants the people, their agreement and their private link.

export default async function TenancyPage({ params, searchParams }: PageProps<"/tenancy/[id]">) {
  const { id } = await params;
  const sp = await searchParams;
  const tab: TabKey = TABS.some((x) => x.key === sp.tab) ? (sp.tab as TabKey) : "overview";

  // One round of reads, all at once. Each tab loads what it shows: the activity on Overview, the latest close-out run on
  // Move-out, the tenant link on Tenants. The rest (payments, photos, deductions) feeds the record header's status on
  // every tab.
  const [t, { data: payments }, { data: photos }, { data: deductionRows }, { data: log }, { data: runs }, tenantLink] = await Promise.all([
    loadTenancy(id),
    db.from("payments").select("*").eq("tenancy_id", id).order("created_at"),
    db.from("photos").select("*").eq("tenancy_id", id).order("created_at"),
    db.from("deductions").select("*").eq("tenancy_id", id).order("created_at"),
    tab === "overview"
      ? db.from("audit_log").select("*").eq("tenancy_id", id).order("created_at", { ascending: false }).limit(40)
      : Promise.resolve({ data: [] }),
    tab === "move-out"
      ? db.from("agent_runs").select("*").eq("tenancy_id", id).eq("kind", "close_out").order("created_at", { ascending: false }).limit(1)
      : Promise.resolve({ data: [] }),
    tab === "tenants" ? activeTenantLink(id) : Promise.resolve(null),
  ]);
  if (!t) notFound();

  const deductions = (deductionRows ?? []).map((d) => ({ ...d, amount: Number(d.amount) })) as StoredDeduction[];
  const photoRows = (photos ?? []) as { id: string; storage_path: string; phase: string; room: string; taken_at: string | null; created_at: string }[];
  const moveInRows = photoRows.filter((x) => x.phase === "move_in");
  const thumbRow = moveInRows.find((x) => /living/i.test(x.room)) ?? moveInRows[0] ?? null;
  // Move-out findings in page order and numbered; rooms the comparison looked at and found nothing in, by their first
  // move-in and move-out photos, so a finding can still be added by hand.
  const stored = inPageOrder((t.move_out_findings ?? []) as StoredFinding[]);
  const inspectedAt = t.move_out_inspected_at as string | null;
  const quietPairs = inspectedAt ? [...new Set(photoRows.filter((x) => x.phase === "move_out_before" && x.created_at <= inspectedAt).map((x) => x.room))]
    .filter((r) => !stored.some((f) => f.room === r))
    .flatMap((r) => {
      const i = photoRows.find((x) => x.room === r && x.phase === "move_in"), o = photoRows.find((x) => x.room === r && x.phase === "move_out_before");
      return i && o ? [{ r, i, o }] : [];
    }) : [];

  // Two slow calls, run together and only for the tabs that show them. PayPal's live invoice status, so "Paid" shows
  // the moment the tenant pays: on Overview and Move-out while the deposit is not yet stored as paid (once it is, they
  // show only that it was paid, which a refund does not change), and always on Payments, whose rows name the refund
  // state PayPal reports. Documents and Tenants read it as stored, like the Properties page. The refreshed row takes
  // the stored one's place in the list the summary reads. And the photos' signed links, in one request: the header's
  // thumbnail on every tab, the move-in photos on Overview, the move-out photos and every finding's pair on Move-out.
  const storedInvoice = (payments ?? []).find((p) => p.kind === "deposit_invoice");
  const refresh = !!storedInvoice && (tab === "payments" || ((tab === "overview" || tab === "move-out") && !wasPaid(storedInvoice.status)));
  const toSign = [
    ...(thumbRow ? [thumbRow.storage_path] : []),
    ...(tab === "overview" ? moveInRows.map((x) => x.storage_path) : []),
    ...(tab === "move-out" ? [
      ...photoRows.filter((x) => x.phase === "move_out_before").map((x) => x.storage_path),
      ...stored.flatMap((f) => [f.moveInPath, f.moveOutPath]),
      ...quietPairs.flatMap(({ i, o }) => [i.storage_path, o.storage_path]),
    ] : []),
  ];
  const [invoice, urlOf] = await Promise.all([
    refresh ? refreshDepositInvoice(storedInvoice) : Promise.resolve(storedInvoice ?? null),
    signedUrls("photos", toSign),
  ]);
  const invoiceStatus: string | null = invoice?.status ?? null;
  const paymentRows = (payments ?? []).map((p) => (invoice && p.id === invoice.id ? invoice : p));

  const url = (path: string | null | undefined) => (path ? urlOf.get(path) ?? null : null);
  const photoViews = photoRows.map((p) => ({ id: p.id, phase: p.phase, room: p.room, url: url(p.storage_path) }));
  // The day each photo was taken, by storage path, for the comparison cards.
  const dateOf = (path: string) => {
    const p = photoRows.find((x) => x.storage_path === path);
    return p ? shortDate(pacificDate(p.taken_at ?? p.created_at)) : null;
  };
  // Each finding with its checked boxes, its photos and the deduction made from it. Rows from before boxes, or before
  // the landlord's review, read as no box and not reviewed.
  const findings: FindingView[] = stored.map((f) => {
    const d = deductions.find((x) => f.id && x.finding?.id === f.id);
    return {
      id: f.id, n: f.n, pair: f.pair, room: f.room, item: f.item, label: f.label ?? null, summary: f.summary ?? null, observation: f.observation,
      classification: f.classification, reason: f.reason, remedy: f.remedy, severity: f.severity, confidence: Number(f.confidence) || 0,
      source: f.source ?? "inspection", status: f.status ?? null, ...boxesOf(f),
      beforeUrl: url(f.moveInPath), afterUrl: url(f.moveOutPath), beforeDate: dateOf(f.moveInPath), afterDate: dateOf(f.moveOutPath),
      deduction: d ? { id: d.id, amount: d.amount, math: d.math, note: d.note ?? null, proration: d.proration, performer: d.performer, work: d.work, category: d.category } : null,
    };
  });
  const quietRooms: QuietRoom[] = quietPairs.map(({ r, i, o }) => ({
    room: r, beforeUrl: url(i.storage_path), afterUrl: url(o.storage_path), beforeDate: dateOf(i.storage_path), afterDate: dateOf(o.storage_path),
  }));
  const numbers = Object.fromEntries(stored.filter((f) => f.id).map((f) => [f.id!, f.n]));
  const wearRows = stored.filter((f) => f.id && f.classification === "wear_and_tear" && f.status !== "dismissed")
    .map((f) => ({ id: f.id!, n: f.n, item: findingTitle(f), full: f.item, room: f.room, photos: (f.moveInPath ? 1 : 0) + (f.moveOutPath ? 1 : 0) }));
  const paid = wasPaid(invoiceStatus);
  const returned = (payments ?? []).find((x) => x.kind === "refund" || x.kind === "payout");

  // The latest close-out run and the amount of any refund it is waiting on. The review page re-checks it against the
  // rules; this page only says where it stands.
  const run = runs?.[0];
  const pd = run?.status === "awaiting_approval" ? (run.pending as Pending | null) : null;
  const pendingAmount = pd ? Number(pd.toolName === "create_refund" ? (pd.input.amount as { value?: string })?.value : pd.input.amount) : null;
  const agreement = t.refund_agreement as { paypal_email: string; signed_by: string[]; signed_at: string } | null;
  const terms = t.lease_terms as LeaseTerms;
  const flags = (t.lease_flags ?? []) as Flag[];
  const prop = t.properties as { address: string; city: string | null; owner_name: string | null };
  const contacts = (t.tenants ?? []) as { name: string; email: string | null }[];
  // The same summary the Properties page reads: the status, the next step and the dates for the calendar.
  const summary = summarizeTenancy(t, paymentRows, photos ?? [], deductions);
  const today = pacificToday();
  const next = nextStep(summary, today);
  const status = propertyStatus(summary, next);
  const step = stepLink(summary, next);
  const events = tenancyEvents(summary);
  const closed = closedOut(summary);
  const addr = splitAddress(prop.address, prop.city);
  const tenantMoveOut = (t.tenant_move_out ?? null) as TenantMoveOut | null;
  const moveIn = photoViews.filter((x) => x.phase === "move_in");
  const thumb = thumbRow ? url(thumbRow.storage_path) : null;
  const inspected = !!t.move_out_inspected_at;
  const held = paid && invoice ? Number(invoice.amount) : null;
  const money = settle(held ?? 0, deductions);
  const due = t.move_out_date ? statementDue(t.move_out_date) : null;
  const delivery = t.statement_delivery ? (t.statement_delivery as DeliveryRecord) : null;
  // This unit's money events, from the refreshed invoice row and the deductions, as the Payments ledger lists them.
  const moneyRows = ledgerRows(t, paymentRows, (deductionRows ?? []) as LedgerDeduction[]);
  const paidOn = moneyRows.find((r) => r.kind === "payment")?.date ?? null;
  // Activity: short titles, the quiet bookkeeping left out, runs of deductions or photos folded into one line.
  const activity = foldActivity((log ?? []).filter((e) => !QUIET_ON_RECORD.includes(e.action))
    .map((e) => ({ id: e.id as string, tenancyId: id, actor: e.actor as string, action: e.action as string, detail: e.detail as Record<string, unknown> | null, createdAt: e.created_at as string })),
  () => summary.tenants, 40);

  // The record header's one primary action: the refund review (its own focused page) once the findings are in,
  // otherwise the next step. It is the view's only indigo button, so the cards below show theirs as secondary.
  const reviewRefund = inspected && !returned && !closed;
  const primary = reviewRefund ? { label: "Review refund", href: `/tenancy/${id}/refund` }
    : !closed && step.label !== "View" && step.label !== "View statement" ? step : null;
  const quiet = !!primary;
  const hasStatement = inspected || !!t.move_out_date;
  const statementLabel = t.statement_delivered_at ? "Statement" : "Statement draft";
  const more: MenuItem[] = [
    // On a phone the Statement button folds into this menu.
    ...(hasStatement ? [{ label: statementLabel, href: `/tenancy/${id}/statement`, icon: "doc" as const }] : []),
    ...(events.length ? [{ label: "Add to calendar", href: `/api/tenancies/${id}/calendar`, icon: "calendar" as const, plain: true }] : []),
    { label: "Open in Payments", href: `/ledger?tenancy=${id}`, icon: "card" },
    ...(inspected ? [{ label: "Download statement PDF", href: `/api/tenancies/${id}/statement/pdf`, icon: "download" as const, plain: true }] : []),
    { label: "Tenant link", href: tabHref(id, "tenants", "tenant-link"), icon: "link" },
    { divider: true },
    { label: "Inspection notice draft", href: `/tenancy/${id}/notices/inspection`, icon: "doc" },
    { label: "Refund notice draft", href: `/tenancy/${id}/notices/electronic-refund`, icon: "doc" },
  ];

  // The notice and its dates: first on the tab before the comparison, last after it.
  const notice = (
    <section id="notice" className="scroll-mt-24">
      <NoticeSection
        tenancyId={id}
        today={today}
        tenants={summary.tenants}
        endDate={summary.endDate}
        noticeGivenOn={summary.noticeGivenOn}
        plannedMoveOut={summary.plannedMoveOut}
        moveOutDate={summary.moveOutDate}
        moveOutLocked={!!returned}
        notices={summary.notices}
        refundNotice={summary.refundNotice}
        events={events.map((e) => ({ kind: e.kind, date: e.date, label: e.label }))}
        closed={closed}
        tenantMoveOut={tenantMoveOut}
        quiet={quiet}
      />
    </section>
  );

  return (
    <>
      <div className="flex flex-wrap items-center gap-x-4 gap-y-3">
        {/* On a phone the back button and the menu sit level with the address's first line, not centered on the block. */}
        <Link href="/units" aria-label="Back to Properties"
          className="inline-flex size-8 shrink-0 items-center justify-center rounded-full border border-line text-ink-2 hover:bg-surface max-sm:self-start">
          <Icon name="arrow-left" className="size-[15px]" />
        </Link>
        <Thumb src={thumb} size={64} className="rounded-md max-sm:hidden" />
        {/* A 16rem basis, so on a narrow window the buttons wrap below the address instead of squeezing it word by word. */}
        <div className="min-w-0 flex-[1_1_16rem]">
          <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
            <h1 className="text-balance text-xl font-medium">{keepUnit(addr.street)}</h1>
            <StatusChip tone={status.tone} size="lg">{status.label}</StatusChip>
          </div>
          <div className="mt-0.5 text-base text-ink-3">{addr.cityLine}</div>
        </div>
        <div className={`flex items-center gap-2 ${primary ? "max-sm:w-full" : "max-sm:self-start"}`}>
          {hasStatement && (
            <ButtonLink href={`/tenancy/${id}/statement`} className="max-sm:hidden"><Icon name="doc" />{statementLabel}</ButtonLink>
          )}
          {primary && <ButtonLink variant="primary" href={primary.href} className="max-sm:flex-1">{primary.label}</ButtonLink>}
          <Menu label="More actions" items={more} buttonClass="inline-flex size-[34px] items-center justify-center rounded-md bg-surface-2 text-ink hover:bg-surface-3" />
        </div>
      </div>

      <Tabs className="mb-6 mt-5" active={tab} items={TABS.map((x) => ({ key: x.key, label: x.label, href: tabHref(id, x.key) }))} />

      {tab === "overview" && (
        <>
          <FactStrip cols={4} className="mb-6">
              <Fact label={returned || closed ? "Deposit" : "Deposit held"} big={held != null} value={held != null ? <Money value={held} cents="small" phoneCents="full" /> : <span className="text-ink-3">Not paid</span>}
                sub={held != null ? (returned ? `Refunded ${shortDate(pacificDate(returned.created_at))}` : paidOn ? `Paid ${shortDate(paidOn)}` : "Paid by PayPal") : invoice ? "Invoice sent" : "Not requested"} />
              <Fact label="Rent" value={t.monthly_rent != null ? <Money value={Number(t.monthly_rent)} /> : <span className="text-ink-3">Not stated</span>} sub="Per month" />
              <Fact label="Lease start" value={t.start_date ? shortDate(t.start_date) : <span className="text-ink-3">Not stated</span>} sub={t.end_date ? "Fixed term" : undefined} />
              <Fact label="Lease end" value={t.end_date ? shortDate(t.end_date) : "Month to month"} sub={t.move_out_date ? `Moved out ${shortDate(t.move_out_date)}` : t.planned_move_out ? `Moving out ${shortDate(t.planned_move_out)}` : "No notice"} />
          </FactStrip>

        <div className="grid items-start gap-6 lg:grid-cols-[minmax(0,1fr)_288px]">
          <div className="flex min-w-0 flex-col gap-6">
            <Card id="move-in" className="scroll-mt-24">
              <CardHead title="Move-in" meta={`${[true, !!agreement, paid, moveIn.length > 0].filter(Boolean).length} of 4 done`} />
              <MoveInSteps
                tenancyId={id}
                tenants={summary.tenants}
                flagCounts={{
                  violations: flags.filter((f) => f.severity === "violation").length,
                  warnings: flags.filter((f) => f.severity === "warning").length,
                }}
                agreement={agreement}
                lawful={terms ? lawfulDeposit(terms) : null}
                invoice={invoice ? { id: invoice.paypal_id, amount: Number(invoice.amount), status: invoiceStatus ?? "SENT",
                  payLink: (invoice.raw as { payLink?: string } | null)?.payLink ?? null } : null}
                photos={photoViews}
                quiet={quiet}
                locked={!!t.move_out_date || closed}
              />
            </Card>

            <Card>
              <CardHead title="Activity" />
              <div className="px-5 py-1">
                {activity.slice(0, 8).map((a) => <LogRow key={a.entry.id} a={a} today={today} />)}
                {activity.length > 8 && (
                  <details className="group">
                    <summary className="flex cursor-pointer list-none items-center gap-1 border-t border-line-2 py-3 text-sm font-medium text-brand hover:underline group-open:hidden">
                      Show {activity.length - 8} more<Icon name="chev-down" className="size-3.5" />
                    </summary>
                    <div className="border-t border-line-2">{activity.slice(8).map((a) => <LogRow key={a.entry.id} a={a} today={today} />)}</div>
                  </details>
                )}
                {!activity.length && <p className="py-3 text-sm text-ink-3">Nothing yet.</p>}
              </div>
            </Card>
          </div>

          <div className="flex flex-col gap-4 max-lg:order-first">
            <Card>
              <CardHead title="Next step" right={next.cite || next.detail ? (
                <InfoTip align="end" title={next.label} cite={next.cite ?? undefined}>{next.detail}</InfoTip>
              ) : undefined} />
              <div className="flex flex-col gap-2 p-4">
                {next.level === "done" ? (
                  <p className="flex items-center gap-2 text-sm text-green"><Icon name="check" className="size-3.5" />Closed out</p>
                ) : (
                  <StepBox icon={step.icon} title={step.label === "View" ? next.label : step.title}
                    sub={next.due && next.daysLeft != null ? `${next.dueLabel ? `${next.dueLabel} ` : ""}${shortDate(next.due)}, ${whenText(next.daysLeft, next.deadline)}` : undefined}
                    href={step.href} />
                )}
                {next.also.length > 0 && (
                  <ul className="mt-1 flex flex-col gap-1.5 text-xs text-ink-3">
                    {next.also.map((a) => <li key={a} className="flex items-start gap-2"><span className="mt-1.5 size-1.5 shrink-0 rounded-full bg-amber-dot" />{a.charAt(0).toUpperCase() + a.slice(1)}</li>)}
                  </ul>
                )}
              </div>
            </Card>

            <Card className="p-5">
              <div className="flex items-center gap-2">
                <span className="text-sm font-medium">Dates</span>
                {events.length > 0 && <a href={`/api/tenancies/${id}/calendar`} className="ml-auto text-sm text-brand hover:underline">Add to calendar</a>}
              </div>
              {events.length ? (
                <KV align="right" className="mt-3" rows={events.map((e) => [<span key={e.kind} title={e.label}>{e.label.split(",")[0]}</span>, shortDate(e.date)])} />
              ) : (
                <p className="mt-2 text-sm text-ink-3">{closed ? "Closed out. No dates left." : "Set the lease end or record a notice."}</p>
              )}
            </Card>
          </div>
        </div>
        </>
      )}

      {tab === "move-out" && (
        <div className="flex flex-col gap-7">
          <FactStrip cols={4}>
            <Fact label="Deposit held" value={held != null ? <Money value={held} /> : <span className="text-ink-3">Not paid</span>}
              sub={held != null ? (paidOn ? `Paid by PayPal, ${shortDate(paidOn)}` : "Paid by PayPal") : "Not paid"} />
            <Fact label="Deductions" value={<Money value={money.total} />} sub={`${deductions.length} item${deductions.length === 1 ? "" : "s"}`} />
            <Fact label={returned ? "Refunded" : money.balanceClaimed > 0 ? "Balance claimed" : "Refund due"} big
              value={<Money value={returned ? Number(returned.amount) : money.balanceClaimed > 0 ? money.balanceClaimed : money.refund} cents="small" phoneCents="full" />}
              sub={returned ? `By PayPal, ${shortDate(pacificDate(returned.created_at))}` : summary.tenants.length ? `To ${summary.tenants.join(" and ")}` : "To the tenants"} />
            <Fact label="Statement and refund due"
              info={<InfoTip align="end" title="21 days after move-out" cite="Civ. Code 1950.5(h)(1)">The itemized statement and the refund are due within 21 calendar days after the tenants leave.</InfoTip>}
              value={due ? shortDate(due) : <span className="text-ink-3">Not set</span>}
              sub={due ? (t.statement_delivered_at ? `Delivered ${shortDate(pacificDate(t.statement_delivered_at))}` : whenText(daysBetween(today, due))) : t.planned_move_out ? `Move-out planned ${shortDate(t.planned_move_out)}` : "No move-out yet"} />
          </FactStrip>

          {/* Before the comparison the notice and its dates lead; after it, the photos and the money do, and the notice
              record moves to the foot of the tab. */}
          {!inspected && notice}

          <section id="photos" className="scroll-mt-24">
            <MoveOut
              tenancyId={id}
              rooms={[...new Set(moveIn.map((x) => x.room))]}
              moveOutPhotos={photoViews.filter((x) => x.phase === "move_out_before")}
              findings={findings}
              quietRooms={quietRooms}
              inspectedAt={inspectedAt}
              moveOutDate={t.move_out_date}
              locked={!!returned}
              quiet={quiet}
            />
          </section>

          {inspected && (
            <section id="deductions" className="scroll-mt-24">
              <Settlement
                tenancyId={id}
                depositHeld={held}
                deductions={deductions}
                numbers={numbers}
                wear={wearRows}
                returned={returned ? { amount: Number(returned.amount), kind: returned.kind, id: returned.paypal_id, at: returned.created_at } : null}
              />
            </section>
          )}

          {inspected && (
            <section id="refund" className="scroll-mt-24">
              <CloseOut
                tenancyId={id}
                tenants={summary.tenants}
                due={money.refund}
                returned={returned ? { amount: Number(returned.amount), kind: returned.kind, id: returned.paypal_id, on: pacificDate(returned.created_at) } : null}
                run={run ? { status: run.status, error: run.error, at: run.created_at ? pacificDate(run.created_at) : null, pendingAmount } : null}
              />
            </section>
          )}

          {inspected && notice}
        </div>
      )}

      {tab === "payments" && (
        <MoneyTimeline tenancyId={id} rows={moneyRows} />
      )}

      {tab === "documents" && (
        <Documents id={id} leasePath={t.lease_pdf_path as string | null} flags={flags} agreement={agreement} moveInCount={moveIn.length}
          notices={summary.notices} refundNoticeNeeded={summary.refundNotice.needed} noticeGiven={!!summary.noticeGivenOn}
          inspected={inspected} delivery={delivery} hasEvents={events.length > 0} />
      )}

      {tab === "tenants" && (
        <div className="flex flex-col gap-6">
          <Card>
            <CardHead title="Tenants" meta={`${contacts.length}`} />
            {/* Below 1024px: each tenant as a list row, and the one refund account under them. */}
            <ul className="lg:hidden">
              {contacts.map((c) => {
                const signed = agreement?.signed_by.includes(c.name);
                return (
                  <li key={c.name} className="flex items-center gap-3 border-b border-line-2 px-4 py-3">
                    <div className="min-w-0 flex-1">
                      <div className="truncate text-sm font-medium">{c.name}</div>
                      <div className="truncate text-xs text-ink-3">{c.email ?? "No email on file"}</div>
                    </div>
                    {signed ? <StatusChip tone="green">Signed {shortDate(pacificDate(agreement!.signed_at))}</StatusChip> : <StatusChip tone="amber">Not signed</StatusChip>}
                  </li>
                );
              })}
              <li className="flex items-center gap-3 px-4 py-3 text-sm">
                <span className="text-ink-3">Refund to</span>
                <span className="ml-auto min-w-0 truncate">{agreement ? `PayPal, ${agreement.paypal_email}` : <span className="text-ink-3">Not agreed</span>}</span>
              </li>
            </ul>
            <div className="max-lg:hidden">
            <Table minWidth={560}>
              <thead><tr><Th first>Name</Th><Th>Email</Th><Th>Refund agreement</Th><Th last>Refund to</Th></tr></thead>
              <tbody>
                {contacts.map((c) => {
                  const signed = agreement?.signed_by.includes(c.name);
                  return (
                    <tr key={c.name} className={trClass}>
                      <Td first className="font-medium">{c.name}</Td>
                      <Td>{c.email ?? <span className="text-ink-3">Not on file</span>}</Td>
                      <Td>{signed ? <StatusChip tone="green">Signed {shortDate(pacificDate(agreement!.signed_at))}</StatusChip> : <StatusChip tone="amber">Not signed</StatusChip>}</Td>
                      <Td last>{agreement ? <span className="inline-flex items-center gap-1.5">PayPal, {agreement.paypal_email}</span> : <span className="text-ink-3">Not agreed</span>}</Td>
                    </tr>
                  );
                })}
              </tbody>
            </Table>
            </div>
          </Card>

          {tenantMoveOut && (
            <Card className="p-5">
              <div className="flex items-center gap-2 text-sm font-medium">
                From the tenant link
                <InfoTip title="What the tenants sent">{describeTenantMoveOut(tenantMoveOut)}.</InfoTip>
              </div>
              <KV className="mt-3" rows={[
                ["Moving out", shortDate(tenantMoveOut.planned_move_out)],
                ["Forwarding address", tenantMoveOut.forwarding_address],
              ]} />
            </Card>
          )}

          <section id="tenant-link" className="scroll-mt-24">
            <TenantLinkPanel tenancyId={id} address={prop.address} contacts={contacts} active={tenantLink} quiet={quiet} />
          </section>
        </div>
      )}
    </>
  );
}

/** One audit entry: the short title, who did it, and the day; the full sentence is the row's tooltip. */
function LogRow({ a, today }: { a: { entry: { actor: string; action: string; detail: Record<string, unknown> | null; createdAt: string }; title: string }; today: string }) {
  const e = a.entry;
  return (
    <ListRow title={a.title} hint={describe(e.action, e.detail)}
      sub={e.actor === "agent" ? "Agent" : e.actor === "tenant" ? "Tenant" : e.actor === "system" ? "System" : "You"}
      right={dayLabel(pacificDate(e.createdAt), today)} />
  );
}

/** Every paper the law asks for on this tenancy, in the order they come up, with where each one opens. */
async function Documents(p: {
  id: string; leasePath: string | null; flags: Flag[]; agreement: { signed_by: string[]; signed_at: string } | null; moveInCount: number;
  notices: Notices; refundNoticeNeeded: boolean | null;
  noticeGiven: boolean; inspected: boolean; delivery: DeliveryRecord | null; hasEvents: boolean;
}) {
  const leaseUrl = p.leasePath ? (await signedUrls("leases", [p.leasePath])).get(p.leasePath) ?? null : null;
  const v = p.flags.filter((f) => f.severity === "violation").length;
  const notice = (kind: NoticeKind) => {
    const given = p.notices[kind];
    if (given) return { text: `Given ${shortDate(given.date)}`, tone: "green" as const, title: `Given by ${describeNoticeGiven(given)}` };
    if (kind === "electronic_refund" && p.refundNoticeNeeded === false) return { text: "Not needed", tone: "gray" as const, title: null };
    return { text: p.noticeGiven ? "Draft" : "Not due yet", tone: p.noticeGiven ? "amber" as const : "gray" as const, title: null };
  };
  const rows: { name: string; sub: string; subTitle?: string; status: React.ReactNode; open: React.ReactNode; info?: React.ReactNode }[] = [
    {
      name: "Lease", sub: v ? `${v} violation${v === 1 ? "" : "s"} flagged` : "Checked",
      status: <StatusChip tone="green">Checked</StatusChip>,
      open: leaseUrl ? <a href={leaseUrl} target="_blank" rel="noreferrer" className="font-medium text-brand hover:underline">Open PDF</a> : <span className="text-ink-3">No file</span>,
    },
    {
      name: "Refund agreement", sub: p.agreement ? `Signed by ${p.agreement.signed_by.join(" and ")}` : "PayPal refund, in writing",
      status: p.agreement ? <StatusChip tone="green">Signed {shortDate(pacificDate(p.agreement.signed_at))}</StatusChip> : <StatusChip tone="amber">Not signed</StatusChip>,
      open: <Link href={tabHref(p.id, "overview", "move-in")} className="font-medium text-brand hover:underline">View</Link>,
      info: <InfoTip title="Refund by PayPal" cite="Civ. Code 1950.5(h)(1)(A), (h)(1)(C)">Since January 1, 2026, a deposit received electronically comes back electronically, and by PayPal only with every adult tenant&apos;s written agreement.</InfoTip>,
    },
    {
      name: "Move-in photos", sub: `${p.moveInCount} photo${p.moveInCount === 1 ? "" : "s"}`,
      status: p.moveInCount ? <StatusChip tone="green">On file</StatusChip> : <StatusChip tone="amber">Missing</StatusChip>,
      open: <Link href={tabHref(p.id, "overview", "move-in")} className="font-medium text-brand hover:underline">View</Link>,
      info: <InfoTip title="Move-in photos" cite="Civ. Code 1950.5(g)(1), AB 2801">Required for tenancies that began on or after July 1, 2025.</InfoTip>,
    },
    ...(["inspection", "electronic_refund"] as NoticeKind[]).map((k) => {
      const s = notice(k);
      return {
        name: NOTICE_INFO[k].short.charAt(0).toUpperCase() + NOTICE_INFO[k].short.slice(1), sub: s.title ?? NOTICE_INFO[k].title,
        status: <StatusChip tone={s.tone}>{s.text}</StatusChip>,
        open: <Link href={`/tenancy/${p.id}/notices/${NOTICE_SLUG[k]}`} className="font-medium text-brand hover:underline">Open draft</Link>,
        info: <InfoTip title={NOTICE_INFO[k].title} cite={NOTICE_INFO[k].cite} />,
      };
    }),
    {
      name: "Itemized statement", sub: p.delivery ? deliveryLine(p.delivery) : p.inspected ? "With photos and invoices" : "After the move-out comparison",
      subTitle: p.delivery ? describeDelivery(p.delivery).replace(/^./, (c) => c.toUpperCase()) : undefined,
      status: p.delivery ? <StatusChip tone="green">Delivered</StatusChip> : p.inspected ? <StatusChip tone="amber">Draft</StatusChip> : <StatusChip tone="gray">Not started</StatusChip>,
      open: p.inspected ? (
        <span className="inline-flex gap-3">
          <Link href={`/tenancy/${p.id}/statement`} className="font-medium text-brand hover:underline">Open</Link>
          <a href={`/api/tenancies/${p.id}/statement/pdf`} className="font-medium text-brand hover:underline">PDF</a>
        </span>
      ) : <span className="text-ink-3">Not ready</span>,
      info: <InfoTip title="The itemized statement" cite="Civ. Code 1950.5(h)(1)-(2)">Due with the refund within 21 days after move-out, with the photos, invoices and receipts the deductions rely on.</InfoTip>,
    },
    ...(p.hasEvents ? [{
      name: "Calendar", sub: "Every deadline as an .ics file", status: <span className="text-ink-3">Ready</span>,
      open: <a href={`/api/tenancies/${p.id}/calendar`} className="font-medium text-brand hover:underline">Download</a>,
    }] : []),
  ];
  return (
    <Card>
      {/* Below 1024px: the document and its state, with where it opens under it. */}
      <ul className="lg:hidden">
        {rows.map((r) => (
          <li key={r.name} className="border-b border-line-2 px-4 py-3 last:border-b-0">
            <div className="flex items-center gap-3">
              <div className="min-w-0 flex-1">
                <div className="flex items-center gap-1.5 text-sm font-medium">{r.name}{r.info}</div>
                <div className="truncate text-xs text-ink-3" title={r.subTitle}>{r.sub}</div>
              </div>
              <span className="shrink-0">{r.status}</span>
            </div>
            <div className="mt-1.5 text-sm">{r.open}</div>
          </li>
        ))}
      </ul>
      <div className="max-lg:hidden">
      <Table minWidth={620}>
        <thead><tr><Th first>Document</Th><Th>Status</Th><Th last align="right" /></tr></thead>
        <tbody>
          {rows.map((r) => (
            <tr key={r.name} className={trClass}>
              <Td first>
                <div className="flex items-center gap-3">
                  <span className="flex size-8 shrink-0 items-center justify-center rounded-sm bg-surface text-ink-3"><Icon name="doc" className="size-[15px]" /></span>
                  <div className="min-w-0">
                    <div className="flex items-center gap-1.5 font-medium">{r.name}{r.info}</div>
                    <div className="truncate text-xs text-ink-3" title={r.subTitle}>{r.sub}</div>
                  </div>
                </div>
              </Td>
              <Td className="whitespace-nowrap">{r.status}</Td>
              <Td last align="right">{r.open}</Td>
            </tr>
          ))}
        </tbody>
      </Table>
      </div>
    </Card>
  );
}

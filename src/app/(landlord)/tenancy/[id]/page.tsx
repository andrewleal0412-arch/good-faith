import Link from "@/components/link";
import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { cache, type ReactNode } from "react";
import { ButtonLink } from "@/components/button";
import { Icon } from "@/components/icons";
import { InfoTip } from "@/components/info-tip";
import { Menu, type MenuItem } from "@/components/menu";
import { PresenceList } from "@/components/motion";
import { RollMoney } from "@/components/roll-money";
import { RulesChip } from "@/components/rules-chip";
import { Card, CardHead, Fact, FactStrip, KV, ListRow, Money, StatusChip, StepBox, Table, Td, Th, Thumb, trClass } from "@/components/ui";
import { describe, foldActivity, QUIET_ON_RECORD } from "@/lib/activity";
import type { Pending } from "@/lib/agent";
import { returnFailed, wasPaid } from "@/lib/invoice-status";
import { db } from "@/lib/db";
import { DEMO_DEPOSIT_DATE, depositBlock } from "@/lib/demo-pool";
import { settle, usd, type StoredDeduction } from "@/lib/deductions";
import { boxesOf, findingTitle, inPageOrder, type StoredFinding } from "@/lib/findings";
import { recordsKey, refreshDepositInvoice, type DepositInvoiceRow } from "@/lib/deposit";
import type { Invoice } from "@/lib/paypal";
import { disputeBanner, loadPayPalDispute } from "@/lib/chargeback-store";
import { deductionsLock, factsFrom, loadLandlordDispute, sentDispute, type DisputeRow } from "@/lib/disputes";
import { limitsFor } from "@/lib/deduction-edit";
import { loadNegotiation } from "@/lib/negotiation";
import { dateIn, dayLabel, daysBetween, shortDate, todayIn, whenText } from "@/lib/dates";
import { tenancyEvents } from "@/lib/ics";
import { jevConfigured } from "@/lib/jev";
import { ledgerRows, type LedgerDeduction } from "@/lib/ledger";
import { closedOut, dueLabelOf, dueOf, inspectionExcused, liveDispute, nextStep, notKeptAfterDispute, refundLeft } from "@/lib/next-step";
import { disputeReturns } from "@/lib/refund-rail";
import { loadOutsideRefunds, noteFromInvoice, type OutsideRefundRow } from "@/lib/outside-refunds";
import { openNotes, outsideReturnedAt, outsideReturns, type RecordRow } from "@/lib/reconcile";
import { NOTICE_SLUG, describeNoticeGiven, listedRecords, noticeInfoFor, recordsFor, type NoticeKind, type Notices } from "@/lib/notices";
import { keepUnit, propertyStatus, splitAddress, stepLink, tabHref, tabOf, type TabKey } from "@/lib/property-view";
import { lawfulDeposit, type Flag, type LeaseTerms } from "@/lib/rules";
import { packFor, refundRecordWords } from "@/lib/states/server";
import type { StatePack } from "@/lib/states/types";
import { deliveryLine, describeDelivery, type DeliveryRecord } from "@/lib/statement";
import { describeTenantMoveOut, type TenantMoveOut } from "@/lib/tenant";
import { tenantLinkView } from "@/lib/tenant-links";
import { summarizeTenancy } from "@/lib/units";
import { currentWorkspace, isTemplate, isUuid, signedUrlsFor, thumbsFor, type Workspace } from "@/lib/workspace";
import { MoneyTimeline } from "./money";
import { PayPalDisputeBanner, PayPalDisputeCard, PayPalDisputeCheck } from "./paypal-dispute";
import { OutsideRefundsBanner, OutsideRefundsCard } from "./outside-refunds";
import { MoveInSteps } from "./move-in-steps";
import { MoveOut, type FindingView, type QuietRoom } from "./move-out";
import { CloseOut } from "./close-out";
import { DisputeBanner, DisputeCard } from "./dispute";
import { Negotiation } from "./negotiation";
import { NoticeSection } from "./notice";
import { Settlement } from "./settlement";
import { OnTab, TabBar, TabPanel, TabState } from "./tab-state";
import { TenantLinkPanel } from "./tenant-link";

export const dynamic = "force-dynamic";

type Row = Record<string, unknown> & { id: string; created_at: string };
type PaymentRecord = DepositInvoiceRow & Row & { kind: string };

/** The tenancy row with its property and the rows under it (its payments, photos and deductions, each in the order it
 *  was made), in one read, once per request (the page title and the page share it), and only when it is in the
 *  session's workspace: a tenancy in another visitor's copy reads exactly like one that doesn't exist. */
const loadTenancy = cache(async (id: string) => {
  const ws = await currentWorkspace();
  if (!ws || !isUuid(id)) return null;
  const { data } = await db.from("tenancies").select("*, properties(*), payments(*), photos(*), deductions(*)").eq("id", id).eq("workspace_id", ws.id)
    .order("created_at", { referencedTable: "payments" }).order("created_at", { referencedTable: "photos" }).order("created_at", { referencedTable: "deductions" })
    .maybeSingle();
  if (!data) return null;
  const { payments, photos, deductions, ...t } = data as Record<string, unknown> & { payments: PaymentRecord[] | null; photos: Row[] | null; deductions: Row[] | null };
  return { ...t, payments: payments ?? [], photos: photos ?? [], deductions: deductions ?? [], ws } as Record<string, unknown> & {
    id: string; ws: Workspace; payments: PaymentRecord[]; photos: Row[]; deductions: Row[];
  };
});

export async function generateMetadata({ params }: PageProps<"/tenancy/[id]">): Promise<Metadata> {
  const { id } = await params;
  const p = ((await loadTenancy(id))?.properties ?? null) as { address: string; city: string | null } | null;
  return { title: p ? splitAddress(p.address, p.city).street : "Property" };
}

// One property: the record header (photo, address, status, the statement and the one primary action) over five tabs.
// Overview holds move-in and the activity; Move-out the notice, the photos, the deductions and the refund; Payments
// the money; Documents every paper the law asks for; Tenants the people, their agreement and their private link.
// Every tab is in the one response, so switching between them needs no request (tab-state.tsx); the tab the address
// names is the one in the HTML.

export default async function TenancyPage({ params, searchParams }: PageProps<"/tenancy/[id]">) {
  const { id } = await params;
  const sp = await searchParams;
  const tab: TabKey = tabOf(sp.tab);

  // One round of reads, all at once, for every tab: the tenancy and the rows under it (the record header's status on
  // every tab), the activity for Overview, the latest close-out run, the dispute and its negotiation for Move-out, the
  // tenant link for Tenants. The dispute's facts (the statement's deductions and their lawful ranges) come from the
  // tenancy's own rows, and the dispute is read once, for the dispute card, the negotiation and the deductions grid.
  // Nothing read here is used, refreshed or signed before the tenancy itself is found in the session's workspace
  // (loadTenancy); for any other id the page is the not-found page. Payments' PayPal reads come after, in their own
  // tab (PaymentsTab).
  const facts = () => loadTenancy(id).then((x) => (x ? factsFrom(id, x, x.deductions, x.payments) : null));
  let sentRead: Promise<DisputeRow | null> | undefined;
  const sent = () => (sentRead ??= sentDispute(id));
  const [t, { data: log }, { data: runs }, link, dispute, negotiation, ppBanner, template, outsideNotes] = await Promise.all([
    loadTenancy(id),
    db.from("audit_log").select("id, actor, action, detail, created_at").eq("tenancy_id", id).order("created_at", { ascending: false }).limit(40),
    db.from("agent_runs").select("id, status, pending, error, created_at").eq("tenancy_id", id).eq("kind", "close_out").order("created_at", { ascending: false }).limit(1),
    // The tenant link, and in a demo copy, where one person plays both sides, the tenants' page it opens ("Open the
    // tenant's view").
    currentWorkspace().then((w) => (w ? tenantLinkView(w, id) : { link: null, demoPath: null })),
    // The tenants' dispute once they sent it (a draft stays theirs): the banner on every tab, the card on Move-out;
    // and the negotiation over it, on Move-out.
    loadLandlordDispute(id, facts, sent),
    loadNegotiation(id, "landlord", facts, sent),
    // The tenants' PayPal dispute of the deposit payment, while PayPal hasn't resolved it: the banner on every tab.
    disputeBanner(id).catch(() => null),
    isTemplate(id),
    // Refunds made in PayPal, not from here, that PayPal reported on this deposit's payment (reconcile.ts): the ones
    // still waiting for the landlord show on every tab; the Payments tab reads PayPal again for new ones.
    loadOutsideRefunds(id),
  ]);
  if (!t) notFound();
  // Every day on this page is a calendar day where the property is (its state pack's zone): today, which the deadline
  // counts from, and the day of each refund, signature and photo. California's is Pacific, as it always was.
  const zone = packFor((t.properties as { state?: string | null } | null)?.state).timeZone.id;
  const dayOf = (ts: string) => dateIn(ts, zone);
  const tenantLink = link.link;
  const tenantPath = link.demoPath;

  const payments = t.payments;
  const photos = t.photos;
  const deductionRows = t.deductions;
  const deductions = deductionRows.map((d) => ({ ...d, amount: Number(d.amount) })) as unknown as StoredDeduction[];
  const photoRows = photos as unknown as { id: string; storage_path: string; phase: string; room: string; taken_at: string | null; created_at: string }[];
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

  // PayPal's live invoice status, so "Paid" shows the moment the tenant pays: while the deposit is not yet stored as
  // paid (once it is, the header, Overview and Move-out show only that it was paid, which a refund does not change),
  // and when the page opens on Payments, whose rows name the refund state PayPal reports. Opened on another tab, the
  // Payments tab asks PayPal itself, after the rest of the page (PaymentsTab). The refreshed row takes the stored
  // one's place in the list the summary reads. And the photos: signed links to the full photos, in one request, for
  // every finding's pair on Move-out and the tenants' dispute photos (each opens on its own); the small versions
  // (src/lib/thumbs.ts, no request) for the header's thumbnail, the move-in photos on Overview, the move-out photos by
  // room and the dispute photos' tiles.
  const storedInvoice = payments.find((p) => p.kind === "deposit_invoice");
  const refresh = !!storedInvoice && (tab === "payments" || !wasPaid(storedInvoice.status));
  // A paid deposit's invoice as PayPal gave it in the last minute stands in for a new read while the records are as
  // they were then (refreshDepositInvoice, `reuse`); one not yet paid is always read live.
  const reuse = storedInvoice && wasPaid(storedInvoice.status) ? { workspaceId: t.ws.id, records: recordsKey(payments, outsideNotes) } : undefined;
  const toSign = [
    ...stored.flatMap((f) => [f.moveInPath, f.moveOutPath]),
    ...quietPairs.flatMap(({ i, o }) => [i.storage_path, o.storage_path]),
    ...(dispute?.evidence ?? []).map((e) => e.path),
  ];
  const toThumb = [
    ...(thumbRow ? [thumbRow.storage_path] : []),
    ...moveInRows.map((x) => x.storage_path),
    ...photoRows.filter((x) => x.phase === "move_out_before").map((x) => x.storage_path),
    ...(dispute?.evidence ?? []).map((e) => e.path),
  ];
  // PayPal's invoice as just read, when it was: the Payments tab checks its refunds against the records.
  const got: { live: Invoice | null } = { live: null };
  const [invoice, urlOf, thumbOf] = await Promise.all([
    refresh ? refreshDepositInvoice(storedInvoice, { store: !template, reuse, onLive: (inv) => { got.live = inv; } }) : Promise.resolve(storedInvoice ?? null),
    signedUrlsFor(t.ws, "photos", toSign),
    thumbsFor(t.ws, toThumb),
  ]);
  const invoiceStatus: string | null = invoice?.status ?? null;
  const paymentRows = payments.map((p) => (invoice && p.id === invoice.id ? invoice : p));
  // The live check, when the page just read PayPal (opened on Payments, or the deposit not yet stored as paid): a refund
  // of the deposit payment PayPal lists that the records don't hold is noted now, before the header, the banner and the
  // Next step read what waits, so the request that first spots it shows it everywhere. Opened on another tab, the
  // Payments tab reads PayPal itself, after the rest of the page.
  const capture = ((storedInvoice?.raw as { transactions?: { payment_id?: string }[] } | null)?.transactions?.[0]?.payment_id) ?? null;
  const notes = got.live && !template && storedInvoice?.paypal_id
    ? await noteFromInvoice({ tenancyId: id, workspaceId: t.ws.id, invoice: got.live, payments: payments as unknown as RecordRow[], notes: outsideNotes, depositInvoiceId: storedInvoice.paypal_id as string, captureId: capture })
    : outsideNotes;

  const url = (path: string | null | undefined) => (path ? urlOf.get(path) ?? null : null);
  const small = (path: string | null | undefined) => (path ? thumbOf.get(path) ?? null : null);
  // The photos as the grids and room thumbnails show them: their small versions.
  const photoViews = photoRows.map((p) => ({ id: p.id, phase: p.phase, room: p.room, url: small(p.storage_path) }));
  // The day each photo was taken, by storage path, for the comparison cards.
  const dateOf = (path: string) => {
    const p = photoRows.find((x) => x.storage_path === path);
    return p ? shortDate(dayOf(p.taken_at ?? p.created_at)) : null;
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
  const own = payments.find((x) => x.kind === "refund" || x.kind === "payout");
  // Money PayPal itself returned through the tenants' PayPal dispute (an accepted claim, PayPal's decision): a prior
  // return. It stands for the refund only once it covers what is owed; until then the rest still goes from here.
  const via = disputeReturns(payments as unknown as { kind: string; paypal_id: string | null; amount: number | string; status: string; created_at: string }[]);
  // Refunds made in PayPal that the landlord recorded as this deposit's refund: a prior return the same way, and the
  // ones PayPal reported that wait for the landlord's decision.
  const outside = outsideReturns(payments as unknown as { kind: string; paypal_id: string | null; amount: number | string; status: string; created_at: string }[]);
  const waiting = template ? [] : openNotes(notes, payments as unknown as { kind: string; paypal_id: string | null; amount: number | string; status: string }[]);

  // The latest close-out run and the amount of any refund it is waiting on. The review page re-checks it against the
  // rules; this page only says where it stands.
  const run = runs?.[0];
  const pd = run?.status === "awaiting_approval" ? (run.pending as Pending | null) : null;
  const pendingAmount = pd ? Number(pd.toolName === "create_refund" ? (pd.input.amount as { value?: string })?.value : pd.input.amount) : null;
  const agreement = t.refund_agreement as { paypal_email: string; signed_by: string[]; signed_at: string } | null;
  const terms = t.lease_terms as LeaseTerms;
  const flags = (t.lease_flags ?? []) as Flag[];
  const prop = t.properties as { address: string; city: string | null; owner_name: string | null; state?: string | null };
  const pack = packFor(prop.state);
  const contacts = (t.tenants ?? []) as { name: string; email: string | null }[];
  // The same summary the Properties page reads: the status, the next step and the dates for the calendar.
  const summary = {
    ...summarizeTenancy(t as unknown as Parameters<typeof summarizeTenancy>[0], paymentRows, photos as unknown as { phase: string }[], deductions),
    dispute: liveDispute(dispute?.status), ...(ppBanner ? { paypalDispute: true } : {}),
  };
  const today = todayIn(zone);
  const next = nextStep(summary, today);
  const status = propertyStatus(summary, next);
  const step = stepLink(summary, next);
  const events = tenancyEvents(summary);
  const closed = closedOut(summary);
  const addr = splitAddress(prop.address, prop.city);
  const tenantMoveOut = (t.tenant_move_out ?? null) as TenantMoveOut | null;
  const moveIn = photoViews.filter((x) => x.phase === "move_in");
  const thumb = thumbRow ? small(thumbRow.storage_path) : null;
  const inspected = !!t.move_out_inspected_at;
  const held = paid && invoice ? Number(invoice.amount) : null;
  // PayPal reversed the deposit payment (a chargeback, its webhook said so): paid once, no longer held.
  const reversal = (invoice?.raw as { reversal?: { at?: string | null } } | null)?.reversal ?? null;
  const reversedSub = reversal ? `Reversed by PayPal${reversal.at ? `, ${shortDate(dayOf(reversal.at))}` : ""}` : null;
  const money = settle(held ?? 0, deductions, pack);
  const due = dueOf(summary);
  // What went back: the close-out's refund or Payout, or, once they cover what is owed (refundLeft, which takes them
  // off), a refund made in PayPal and recorded as this deposit's refund, or PayPal's refund through the tenants' PayPal
  // dispute.
  const priorCovers = !own && (!!via || !!outside) && held != null && refundLeft(summary) === 0;
  const returned = own ?? (priorCovers && outside ? { kind: "outside_refund", amount: outside.amount, paypal_id: outside.refunds[0].id, created_at: outside.refunds[0].at ?? new Date().toISOString(), status: outside.status }
    : priorCovers && via ? { kind: "dispute_refund", amount: via.amount, paypal_id: via.disputeId, created_at: via.at, status: "COMPLETED" } : undefined);
  // Before the close-out's own refund, what went back already (its amount comes off what is owed).
  const prior = Math.round(((via?.amount ?? 0) + (outside?.amount ?? 0)) * 100) / 100;
  // What the Move-out tab's Refunded figure shows: the close-out's refund, or what went back before it once that covers
  // what is owed (a refund made in PayPal with any PayPal dispute's money beside it).
  const returnedHere = returned ? Math.round((Number(returned.amount) + (returned.kind === "outside_refund" ? via?.amount ?? 0 : 0)) * 100) / 100 : 0;
  const notKept = notKeptAfterDispute(summary);
  const delivery = t.statement_delivery ? (t.statement_delivery as DeliveryRecord) : null;
  // New York after day 14 (the statement's standing): the deductions stay as claimed and the whole deposit is owed back.
  // The day the rest of the deposit went: the close-out's own refund, else the day refunds made in PayPal and recorded
  // here (with the dispute's money) returned what the deductions leave owed, as the close-out reads it.
  const returnedOk = returned && !returnFailed(returned.status as string) ? returned : null;
  const outsideAt = !own && held ? outsideReturnedAt(paymentRows as unknown as Parameters<typeof outsideReturnedAt>[0], money.refund) : null;
  const forfeit = held && deductions.length ? pack.close.standing?.({
    today, notices: summary.notices, claimed: money.total, statementDue: due, deliveredOn: delivery?.date ?? null,
    returnedOn: outsideAt ? dayOf(outsideAt) : returnedOk ? dayOf(returnedOk.created_at) : null, refundOwed: money.refund > 0,
  }) : null;
  const forfeited = forfeit?.forfeits ? forfeit : null;
  // The deductions grid on Move-out: whether its inputs may change, and each line's limits from its lawful range (the
  // same range engine the tenants' dispute and the edit route run). Read only once the deductions are final or while a
  // dispute the tenants sent is open (deductionsLock, the rule the deduction routes refuse by), and for the demo's
  // templates.
  const templateLocked = inspected && template;
  const editFacts = inspected && !own ? (() => {
    try {
      return factsFrom(id, t, deductionRows, payments);
    } catch (e) {
      console.error("deduction limits failed", e);
      return null;
    }
  })() : null;
  const lock = deductionsLock({
    payments: paymentRows.map((p) => ({ kind: p.kind as string, amount: p.amount as number | string, status: (p.status as string | null) ?? null })),
    disputes: dispute ? [dispute.status] : [], refundOwed: held != null ? money.refund : null,
  });
  const editing = {
    allowed: !returned && !lock && !templateLocked && !!editFacts,
    reason: templateLocked ? "This is the template every demo copy is made from, so its deductions don't change. A copy's do."
      : lock && !returned ? lock.message
        : !returned && !editFacts ? "The deductions couldn't be checked against their lawful range just now, so they can't be changed. Refresh to try again." : null,
    limits: Object.fromEntries((editFacts?.deductions ?? []).map((d) => [d.id, limitsFor(editFacts!.ranges.lines.find((l) => l.id === d.id), {
      delivered: !!t.statement_delivered_at && !!t.statement_delivery, amount: d.amount, guidanceCite: pack.copy.guidanceCite,
    })])),
  };
  // This unit's money events, from the invoice row as the header reads it and the deductions, as the Payments ledger
  // lists them (the Payments tab lists them from PayPal's latest word).
  const moneyRows = ledgerRows(t as unknown as Parameters<typeof ledgerRows>[0], paymentRows as unknown as Parameters<typeof ledgerRows>[1], deductionRows as unknown as LedgerDeduction[]);
  const paidOn = moneyRows.find((r) => r.kind === "payment")?.date ?? null;
  // A demo copy's deposit is a real sandbox payment made for the demo, so PayPal dates it recently, not at move-in.
  const demoDepositTip = t.ws.kind === "demo" && paidOn
    ? <InfoTip title="A sandbox payment">{DEMO_DEPOSIT_DATE}</InfoTip> : undefined;
  // Activity: short titles, the quiet bookkeeping left out, runs of deductions or photos folded into one line.
  const activity = foldActivity((log ?? []).filter((e) => !QUIET_ON_RECORD.includes(e.action as string))
    .map((e) => ({ id: e.id as string, tenancyId: id, actor: e.actor as string, action: e.action as string, detail: e.detail as Record<string, unknown> | null, createdAt: e.created_at as string })),
  () => summary.tenants, 40);

  // The record header's one primary action: the refund review (its own focused page) once the findings are in,
  // otherwise the next step. It is the view's only indigo button, so the cards below show theirs as secondary.
  const reviewRefund = inspected && !returned && !closed;
  // A PayPal dispute waiting on the landlord comes first (the refund is held while it is open); on Payments, where the
  // dispute's card is, the card's own button is the primary.
  const answerDispute = ppBanner && ppBanner.response !== "sent" && ppBanner.response !== "sending"
    ? { label: ppBanner.response === "ready" ? "Review response" : ppBanner.response === "unknown" ? "Check response" : "Answer dispute", href: tabHref(id, "payments", "paypal-dispute") }
    // A refund made in PayPal holds the refund until the landlord records it or sets it aside, on Payments.
    : waiting.length ? { label: "Review PayPal refund", href: tabHref(id, "payments", "outside-refunds") }
      : null;
  // The Overview's Next step says the same as Properties while the dispute waits on the landlord: PayPal's date first.
  // A refund made in PayPal waiting for the landlord's decision is the step the same way: the refund waits on it.
  const waitingAmount = Math.round(waiting.reduce((t2, r) => t2 + Number(r.amount), 0) * 100) / 100;
  const disputeStep = answerDispute && ppBanner ? {
    icon: ppBanner.response === "ready" ? "send" as const : "card" as const, href: answerDispute.href, tipTitle: "PayPal dispute",
    title: ppBanner.response === "ready" ? "Approve the PayPal dispute response" : ppBanner.response === "unknown" ? "Check the PayPal dispute response" : "Answer the PayPal dispute",
    sub: ppBanner.dueDate ? `PayPal's date ${shortDate(ppBanner.dueDate)}, ${whenText(daysBetween(today, ppBanner.dueDate), true)}` : undefined,
    tip: `The tenants asked PayPal for ${usd(ppBanner.amount)} of the deposit back. The refund waits until the dispute is answered${due ? `; the state's deadline, ${shortDate(due)}, doesn't` : ""}.`,
  } : answerDispute && waiting.length ? {
    icon: "card" as const, href: answerDispute.href, tipTitle: waiting.length > 1 ? "Refunds made in PayPal" : "Refund made in PayPal",
    title: waiting.length > 1 ? "Review the refunds made in PayPal" : "Review the refund made in PayPal",
    sub: `${usd(waitingAmount)}${waiting.length === 1 && waiting[0].refunded_at ? ` on ${shortDate(dayOf(waiting[0].refunded_at))}` : ""}`,
    tip: `PayPal shows ${waiting.length > 1 ? `${waiting.length} refunds` : "a refund"} of the deposit payment that wasn't sent from here. Record ${waiting.length > 1 ? "each one" : "it"} as this deposit's refund, or mark it not this deposit. The refund waits until then${due ? `; the state's deadline, ${shortDate(due)}, doesn't` : ""}.`,
  } : null;
  const primary = answerDispute
    ?? (reviewRefund ? { label: "Review refund", href: `/tenancy/${id}/refund` } : !closed && step.label !== "View" && step.label !== "View statement" ? step : null);
  const primaryOnPayments = answerDispute ? null : primary;
  // Whether a tab's cards show their buttons as secondary: the same on every tab but Payments.
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
    // The state's printable drafts (California: the inspection and refund notices).
    ...(pack.records.some((r) => r.menu) ? [{ divider: true } as MenuItem] : []),
    ...pack.records.filter((r) => r.menu).map((r) => ({ label: r.menu!, href: `/tenancy/${id}/notices/${NOTICE_SLUG[r.kind]}`, icon: "doc" as const })),
  ];
  const actions = (primary: { label: string; href: string } | null) => (
    <div className={`flex items-center gap-2 ${primary ? "max-sm:w-full" : "max-sm:self-start"}`}>
      {hasStatement && (
        <ButtonLink href={`/tenancy/${id}/statement`} className="max-sm:hidden"><Icon name="doc" />{statementLabel}</ButtonLink>
      )}
      {primary && <ButtonLink variant="primary" href={primary.href} className="max-sm:flex-1">{primary.label}</ButtonLink>}
      <Menu label="More actions" items={more} buttonClass="inline-flex size-[34px] items-center justify-center rounded-md bg-surface-2 text-ink transition-colors hover:bg-surface-3" />
    </div>
  );
  const tenantsLabel = summary.tenants.join(" and ") || "The tenants";

  // The notice and its dates: first on the tab before the comparison, last after it.
  const notice = (
    <section id="notice" className="scroll-mt-24">
      <NoticeSection
        tenancyId={id}
        state={pack.code}
        today={today}
        tenants={summary.tenants}
        endDate={summary.endDate}
        noticeGivenOn={summary.noticeGivenOn}
        noticeGivenBy={summary.noticeGivenBy ?? null}
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

  const overview: ReactNode = (
    <>
      <FactStrip cols={4} className="mb-6">
          <Fact label={returned || closed || reversal ? "Deposit" : "Deposit held"} big={held != null} info={held != null && !returned ? demoDepositTip : undefined} value={held != null ? <RollMoney value={held} cents="small" phoneCents="full" /> : <span className="text-ink-3">Not paid</span>}
            sub={reversedSub ?? (held != null ? (returned ? `${returned.kind === "dispute_refund" ? "Returned through the PayPal dispute" : returned.kind === "outside_refund" ? "Refunded in PayPal" : "Refunded"} ${shortDate(dayOf(returned.created_at))}`
              : via ? `${usd(via.amount)} returned through the PayPal dispute` : outside ? `${usd(outside.amount)} refunded in PayPal` : paidOn ? `Paid ${shortDate(paidOn)}` : "Paid by PayPal") : invoice ? "Invoice sent" : "Not requested")} />
          <Fact label="Rent" value={t.monthly_rent != null ? <Money value={Number(t.monthly_rent)} /> : <span className="text-ink-3">Not stated</span>} sub="Per month" />
          <Fact label="Lease start" value={t.start_date ? shortDate(t.start_date as string) : <span className="text-ink-3">Not stated</span>} sub={t.end_date ? "Fixed term" : undefined} />
          <Fact label="Lease end" value={t.end_date ? shortDate(t.end_date as string) : "Month to month"} sub={t.move_out_date ? `Moved out ${shortDate(t.move_out_date as string)}` : t.planned_move_out ? `Moving out ${shortDate(t.planned_move_out as string)}` : "No notice"} />
      </FactStrip>

    <div className="grid items-start gap-6 lg:grid-cols-[minmax(0,1fr)_288px]">
      <div className="flex min-w-0 flex-col gap-6">
        <Card id="move-in" className="scroll-mt-24">
          <CardHead title="Move-in" meta={moveInMeta(pack, { agreement: !!agreement, paid, photos: moveIn.length > 0, notices: summary.notices })} />
          <MoveInSteps
            tenancyId={id}
            state={pack.code}
            notices={summary.notices}
            tenants={summary.tenants}
            flagCounts={{
              violations: flags.filter((f) => f.severity === "violation").length,
              warnings: flags.filter((f) => f.severity === "warning").length,
            }}
            agreement={agreement}
            lawful={terms ? lawfulDeposit(terms, pack) : null}
            invoice={invoice ? { id: invoice.paypal_id as string, amount: Number(invoice.amount), status: invoiceStatus ?? "SENT",
              payLink: (invoice.raw as { payLink?: string } | null)?.payLink ?? null,
              fromPayPal: moneyRows.find((r) => r.kind === "deposit_invoice")?.fromPayPal ?? null, reversed: !!reversal } : null}
            photos={photoViews}
            quiet={quiet}
            locked={!!t.move_out_date || closed}
          />
        </Card>

        <Card>
          <CardHead title="Activity" />
          <div className="px-5 py-1">
            {/* What the landlord just did eases in at the top. */}
            <PresenceList>{activity.slice(0, 8).map((a) => <LogRow key={a.entry.id} a={a} today={today} zone={zone} />)}</PresenceList>
            {activity.length > 8 && (
              <details className="group">
                <summary className="flex cursor-pointer list-none items-center gap-1 border-t border-line-2 py-3 text-sm font-medium text-brand hover:underline group-open:hidden">
                  Show {activity.length - 8} more<Icon name="chev-down" className="size-3.5" />
                </summary>
                <div className="border-t border-line-2">{activity.slice(8).map((a) => <LogRow key={a.entry.id} a={a} today={today} zone={zone} />)}</div>
              </details>
            )}
            {!activity.length && <p className="py-3 text-sm text-ink-3">Nothing yet.</p>}
          </div>
        </Card>
      </div>

      <div className="flex flex-col gap-4 max-lg:order-first">
        <Card>
          <CardHead title="Next step" right={disputeStep ? <InfoTip align="end" title={disputeStep.tipTitle}>{disputeStep.tip}</InfoTip>
            : next.cite || next.detail ? (
            <InfoTip align="end" title={next.label} cite={next.cite ?? undefined}>{next.detail}</InfoTip>
          ) : undefined} />
          <div className="flex flex-col gap-2 p-4">
            {disputeStep ? (
              <StepBox icon={disputeStep.icon} title={disputeStep.title} sub={disputeStep.sub} href={disputeStep.href} />
            ) : next.level === "done" ? (
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
  );

  const moveOut: ReactNode = (
    <div className="flex flex-col gap-7">
      <FactStrip cols={4}>
        <Fact label={reversal ? "Deposit" : "Deposit held"} info={held != null ? demoDepositTip : undefined} value={held != null ? <Money value={held} /> : <span className="text-ink-3">Not paid</span>}
          sub={reversedSub ?? (held != null ? (paidOn ? `Paid by PayPal, ${shortDate(paidOn)}` : "Paid by PayPal") : "Not paid")} />
        <Fact label="Deductions" value={<RollMoney quick value={money.total} />} sub={`${deductions.length} item${deductions.length === 1 ? "" : "s"}${forfeited ? ", forfeited" : ""}`}
          info={forfeited ? <InfoTip title={forfeited.label}>{forfeited.note}</InfoTip> : undefined} />
        <Fact label={returned ? (returned.kind === "dispute_refund" ? "Returned" : "Refunded") : forfeited ? "Owed back" : money.balanceClaimed > 0 ? "Balance claimed" : prior ? "Left to refund" : "Refund due"} big
          value={<RollMoney value={returned ? returnedHere : forfeited ? Math.max(0, Math.round(((held ?? 0) - prior) * 100) / 100)
            : money.balanceClaimed > 0 ? money.balanceClaimed : prior ? refundLeft(summary) ?? 0 : money.refund} cents="small" phoneCents="full" />}
          sub={forfeited && returned && (held ?? 0) - returnedHere - (own ? prior : 0) - (summary.settledBack ?? 0) > 0.005 ? `${usd(Math.round(((held ?? 0) - returnedHere - (own ? prior : 0) - (summary.settledBack ?? 0)) * 100) / 100)} still owed`
            : returned ? (returned.kind === "dispute_refund" ? `Through the PayPal dispute, ${shortDate(dayOf(returned.created_at))}` : returned.kind === "outside_refund" ? `In PayPal${via ? " and the dispute" : ""}, ${shortDate(dayOf(returned.created_at))}` : `By PayPal, ${shortDate(dayOf(returned.created_at))}`)
              : via && !outside ? `After ${usd(via.amount)} through the PayPal dispute` : outside ? `After ${usd(prior)} already refunded` : summary.tenants.length ? `To ${summary.tenants.join(" and ")}` : "To the tenants"} />
        <Fact label={dueLabelOf(summary)}
          info={<InfoTip align="end" title={pack.deadline.tip.title} cite={pack.deadline.tip.cite}>{pack.deadline.tip.text}</InfoTip>}
          value={due ? shortDate(due) : <span className="text-ink-3">Not set</span>}
          sub={due ? (t.statement_delivered_at ? `Delivered ${shortDate(dayOf(t.statement_delivered_at as string))}` : whenText(daysBetween(today, due))) : t.planned_move_out ? `Move-out planned ${shortDate(t.planned_move_out as string)}` : "No move-out yet"} />
      </FactStrip>

      {dispute && <DisputeCard v={dispute} photoUrl={(p) => url(p)} thumbUrl={(p) => small(p)} tenantsLabel={tenantsLabel} zone={zone} />}
      {dispute && negotiation && (
        <Negotiation tenancyId={id} v={negotiation} quiet={quiet} zone={zone}
          tenantsLabel={tenantsLabel} landlordLabel={prop.owner_name ?? "The landlord"} />
      )}

      {/* Before the comparison the notice and its dates lead; after it, the photos and the money do, and the notice
          record moves to the foot of the tab. */}
      {!inspected && notice}

      <section id="photos" className="scroll-mt-24">
        <MoveOut
          tenancyId={id}
          state={pack.code}
          rooms={[...new Set(moveIn.map((x) => x.room))]}
          moveOutPhotos={photoViews.filter((x) => x.phase === "move_out_before")}
          findings={findings}
          quietRooms={quietRooms}
          inspectedAt={inspectedAt}
          moveOutDate={t.move_out_date as string | null}
          locked={!!returned}
          quiet={quiet}
          reads={jevConfigured()}
        />
      </section>

      {inspected && (
        <section id="deductions" className="scroll-mt-24">
          <Settlement
            tenancyId={id}
            state={pack.code}
            depositHeld={held}
            deductions={deductions}
            numbers={numbers}
            wear={wearRows}
            edit={editing}
            returned={returned ? { amount: Number(returned.amount), kind: returned.kind, id: returned.paypal_id as string, at: returned.created_at } : null}
            viaDispute={via ? { amount: via.amount, notKept } : null}
            outside={outside ? { amount: outside.amount, notKept: via ? 0 : notKept } : null}
            forfeited={forfeited ? { label: forfeited.label, note: forfeited.note } : null}
          />
        </section>
      )}

      {inspected && (
        <section id="refund" className="scroll-mt-24">
          <CloseOut
            tenancyId={id}
            tenants={summary.tenants}
            due={Math.max(0, Math.round(((forfeited ? held ?? 0 : money.refund) - prior) * 100) / 100)}
            returned={returned ? { amount: Number(returned.amount), kind: returned.kind, id: returned.paypal_id as string, on: dayOf(returned.created_at) } : null}
            viaDispute={via ? { amount: via.amount, id: via.disputeId, notKept } : null}
            outside={outside ? { amount: outside.amount, count: outside.refunds.length } : null}
            waiting={waiting.length ? { count: waiting.length, amount: waitingAmount } : null}
            run={run ? { status: run.status as string, error: run.error as string | null, at: run.created_at ? dayOf(run.created_at as string) : null, pendingAmount } : null}
            tenantView={tenantPath ? { href: tenantPath, delivered: !!t.statement_delivered_at, disputed: !!dispute } : null}
          />
        </section>
      )}

      {inspected && notice}
    </div>
  );

  const tenants: ReactNode = (
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
                {signed ? <StatusChip tone="green">Signed {shortDate(dayOf(agreement!.signed_at))}</StatusChip> : <StatusChip tone="amber">Not signed</StatusChip>}
              </li>
            );
          })}
          <li className="flex items-center gap-3 px-4 py-3 text-sm">
            <span className="text-ink-3">Refund to</span>
            <span className="ml-auto min-w-0 truncate">{agreement ? `PayPal, ${agreement.paypal_email}` : <span className="text-ink-3">{refundRecordWords(pack).none}</span>}</span>
          </li>
        </ul>
        <div className="max-lg:hidden">
        <Table minWidth={560}>
          <thead><tr><Th first>Name</Th><Th>Email</Th><Th>{refundRecordWords(pack).name}</Th><Th last>Refund to</Th></tr></thead>
          <tbody>
            {contacts.map((c) => {
              const signed = agreement?.signed_by.includes(c.name);
              return (
                <tr key={c.name} className={trClass}>
                  <Td first className="font-medium">{c.name}</Td>
                  <Td>{c.email ?? <span className="text-ink-3">Not on file</span>}</Td>
                  <Td>{signed ? <StatusChip tone="green">Signed {shortDate(dayOf(agreement!.signed_at))}</StatusChip> : <StatusChip tone="amber">Not signed</StatusChip>}</Td>
                  <Td last>{agreement ? <span className="inline-flex items-center gap-1.5">PayPal, {agreement.paypal_email}</span> : <span className="text-ink-3">{refundRecordWords(pack).none}</span>}</Td>
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
            <InfoTip title="What the tenants sent">{describeTenantMoveOut(tenantMoveOut, zone)}.</InfoTip>
          </div>
          <KV className="mt-3" rows={[
            ["Moving out", shortDate(tenantMoveOut.planned_move_out)],
            ["Forwarding address", tenantMoveOut.forwarding_address],
          ]} />
        </Card>
      )}

      <section id="tenant-link" className="scroll-mt-24">
        <TenantLinkPanel tenancyId={id} address={prop.address} contacts={contacts} active={tenantLink} quiet={quiet} demoHref={tenantPath} zone={zone} />
      </section>
    </div>
  );

  return (
    <TabState id={id}>
      <div className="flex flex-wrap items-center gap-x-4 gap-y-3">
        {/* On a phone the back button and the menu sit level with the address's first line, not centered on the block. */}
        <Link href="/units" aria-label="Back to Properties"
          className="inline-flex size-8 shrink-0 items-center justify-center rounded-full border border-line text-ink-2 transition-colors hover:bg-surface max-sm:self-start">
          <Icon name="arrow-left" className="size-[15px]" />
        </Link>
        <Thumb src={thumb} size={64} className="rounded-md max-sm:hidden" />
        {/* A 16rem basis, so on a narrow window the buttons wrap below the address instead of squeezing it word by word. */}
        <div className="min-w-0 flex-[1_1_16rem]">
          <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
            <h1 className="text-balance text-xl font-medium">{keepUnit(addr.street)}</h1>
            <StatusChip live tone={status.tone} size="lg">{status.label}</StatusChip>
          </div>
          <div className="mt-0.5 flex flex-wrap items-center gap-x-3 gap-y-1 text-base text-ink-3">
            <span>{addr.cityLine}</span>
            <RulesChip state={pack.code} city={prop.city} />
          </div>
        </div>
        {primaryOnPayments === primary ? actions(primary) : <OnTab tab="payments" on={actions(primaryOnPayments)}>{actions(primary)}</OnTab>}
      </div>

      <TabBar id={id} className="mb-6 mt-5" />

      {ppBanner && (
        <OnTab tab="payments">
          <PayPalDisputeBanner href={tabHref(id, "payments", "paypal-dispute")} amount={ppBanner.amount} dueDate={ppBanner.dueDate} response={ppBanner.response} />
        </OnTab>
      )}

      {waiting.length > 0 && !ppBanner && (
        <OnTab tab="payments">
          <OutsideRefundsBanner href={tabHref(id, "payments", "outside-refunds")} count={waiting.length}
            amount={waitingAmount} />
        </OnTab>
      )}

      {dispute && (dispute.status === "open" || dispute.status === "negotiating" || dispute.status === "agreed") && (
        <DisputeBanner v={dispute} href={tabHref(id, "move-out", dispute.status === "open" ? "dispute" : "negotiation")} tenantsLabel={tenantsLabel} />
      )}

      <TabPanel tab="overview">{overview}</TabPanel>
      <TabPanel tab="move-out">{moveOut}</TabPanel>
      <TabPanel tab="payments">
        <PaymentsTab id={id} ws={t.ws} stored={storedInvoice ?? null} invoice={invoice} refreshed={refresh} reuse={reuse} payments={payments} deductionRows={deductionRows}
          tenancy={t} template={template} typeTip={pack.ledger.typeTip} zone={zone} quiet={!!primaryOnPayments} notes={notes} />
      </TabPanel>
      <TabPanel tab="documents">
        <Documents ws={t.ws} pack={pack} id={id} leasePath={t.lease_pdf_path as string | null} flags={flags} agreement={agreement} moveInCount={moveIn.length}
          notices={summary.notices} refundNoticeNeeded={summary.refundNotice.needed} noticeGiven={!!summary.noticeGivenOn} movedOut={!!summary.moveOutDate} inspectionExcused={inspectionExcused(summary)}
          inspected={inspected} delivery={delivery} hasEvents={events.length > 0} />
      </TabPanel>
      <TabPanel tab="tenants">{tenants}</TabPanel>
    </TabState>
  );
}

/** The Payments tab: the PayPal dispute (open or resolved) with the response the defense agent prepared, the unit's
 *  money as the ledger lists it, with PayPal's latest word on the deposit invoice, and Check PayPal. Opened on another
 *  tab, the page didn't wait for PayPal: this tab asks it here, streamed in after the rest of the page. */
async function PaymentsTab(p: {
  id: string; ws: Workspace; stored: PaymentRecord | null; invoice: PaymentRecord | null; refreshed: boolean; reuse?: { workspaceId: string; records: string };
  payments: PaymentRecord[]; deductionRows: Row[];
  tenancy: Record<string, unknown>; template: boolean; typeTip: StatePack["ledger"]["typeTip"]; zone: string; quiet: boolean; notes: OutsideRefundRow[];
}) {
  // PayPal's invoice, read here when the page didn't read it (the live check): a refund of the deposit payment it lists
  // that the records don't hold is noted for the landlord's decision (reconcile.ts), as its webhook notes it. When the
  // page read it, the page noted them already, and `notes` is what it found.
  const got: { live: Invoice | null } = { live: null };
  const invoice = p.refreshed || !p.stored ? p.invoice : await refreshDepositInvoice(p.stored, { store: !p.template, reuse: p.reuse, onLive: (inv) => { got.live = inv; } });
  const live = got.live;
  const records = p.payments as unknown as RecordRow[];
  const capture = ((p.stored?.raw as { transactions?: { payment_id?: string }[] } | null)?.transactions?.[0]?.payment_id) ?? null;
  const notes = live && !p.template && p.stored?.paypal_id
    ? await noteFromInvoice({ tenancyId: p.id, workspaceId: p.ws.id, invoice: live, payments: records, notes: p.notes, depositInvoiceId: p.stored.paypal_id, captureId: capture })
    : p.notes;
  const outsideCard = p.template ? [] : notes.filter((n) => n.status === "open" || n.status === "dismissed");
  const shownNotes = outsideCard.length ? [...openNotes(outsideCard, records), ...outsideCard.filter((n) => n.status === "dismissed")] : [];
  const rows = p.payments.map((x) => (invoice && x.id === invoice.id ? invoice : x));
  const moneyRows = ledgerRows(p.tenancy as unknown as Parameters<typeof ledgerRows>[0], rows as unknown as Parameters<typeof ledgerRows>[1], p.deductionRows as unknown as LedgerDeduction[]);
  const paid = wasPaid(invoice?.status ?? null);
  const reversal = (invoice?.raw as { reversal?: unknown } | null)?.reversal ?? null;
  // No dispute on file: the webhook reports one when it opens, and Check PayPal asks PayPal directly. Not for a
  // template, nor for a deposit PayPal hasn't recorded as paid.
  const [paypalDispute, block] = await Promise.all([
    loadPayPalDispute(p.id, p.ws).catch((e) => { console.error("PayPal dispute view failed", e); return null; }),
    // A demo copy may refund only a deposit it holds itself (demo-pool.ts); the owner's are its own.
    paid && !reversal && !p.template && p.ws.kind === "demo" ? depositBlock(p.ws.id, p.stored?.paypal_id) : Promise.resolve(null),
  ]);
  return (
    <div className="flex flex-col gap-6">
      {paypalDispute && <PayPalDisputeCard tenancyId={p.id} v={paypalDispute} quiet={p.quiet} zone={p.zone} />}
      {shownNotes.length > 0 && (
        <OutsideRefundsCard tenancyId={p.id} zone={p.zone} quiet={p.quiet || !!paypalDispute}
          refunds={shownNotes.map((n) => ({ id: n.refund_id, amount: Number(n.amount), at: n.refunded_at, status: n.status, decidedAt: n.decided_at ?? null }))} />
      )}
      <MoneyTimeline tenancyId={p.id} rows={moneyRows} typeTip={p.typeTip} zone={p.zone} />
      {!paypalDispute && paid && !reversal && !p.template && !block && <PayPalDisputeCheck tenancyId={p.id} />}
    </div>
  );
}

/** "2 of 4 done": the lease check, the refund agreement (or account), the paid deposit and the move-in photos, plus the state's
 *  own move-in records (a Washington checklist, the account a deposit is held in). */
function moveInMeta(pack: StatePack, o: { agreement: boolean; paid: boolean; photos: boolean; notices: Notices }) {
  const records = recordsFor(pack, "move_in");
  const done = [true, o.agreement, o.paid, o.photos, ...records.map((r) => !!o.notices[r.kind])].filter(Boolean).length;
  return `${done} of ${4 + records.length} done`;
}

/** One audit entry: the short title, who did it, and the day; the full sentence is the row's tooltip. */
function LogRow({ a, today, zone }: { a: { entry: { actor: string; action: string; detail: Record<string, unknown> | null; createdAt: string }; title: string }; today: string; zone: string }) {
  const e = a.entry;
  return (
    <ListRow title={a.title} hint={describe(e.action, e.detail)}
      sub={e.actor === "agent" ? "Agent" : e.actor === "tenant" ? "Tenant" : e.actor === "system" ? (e.detail?.source === "paypal" || e.detail?.source === "paypal_check" ? "PayPal" : "System") : "You"}
      right={dayLabel(dateIn(e.createdAt, zone), today)} />
  );
}

/** Every paper the law asks for on this tenancy, in the order they come up, with where each one opens. */
async function Documents(p: {
  ws: Workspace; pack: StatePack; id: string; leasePath: string | null; flags: Flag[]; agreement: { signed_by: string[]; signed_at: string } | null; moveInCount: number;
  notices: Notices; refundNoticeNeeded: boolean | null;
  noticeGiven: boolean; movedOut: boolean; inspectionExcused: boolean; inspected: boolean; delivery: DeliveryRecord | null; hasEvents: boolean;
}) {
  const leaseUrl = p.leasePath ? (await signedUrlsFor(p.ws, "leases", [p.leasePath])).get(p.leasePath) ?? null : null;
  const v = p.flags.filter((f) => f.severity === "violation").length;
  const info = noticeInfoFor(p.pack);
  const notice = (kind: NoticeKind) => {
    const given = p.notices[kind];
    if (given) return { text: `Given ${shortDate(given.date)}`, tone: "green" as const, title: `Given by ${describeNoticeGiven(given)}` };
    if (kind === "electronic_refund" && p.refundNoticeNeeded === false) return { text: "Not needed", tone: "gray" as const, title: null };
    if (kind === "inspection" && p.inspectionExcused) return { text: "Not needed", tone: "gray" as const, title: "The tenants ended the tenancy with less than two weeks' notice" };
    // Once the tenants moved out, a notice never recorded is just that, not one still to come.
    if (p.movedOut) return { text: "Not recorded", tone: "gray" as const, title: null };
    return { text: p.noticeGiven ? "Draft" : "Not due yet", tone: p.noticeGiven ? "amber" as const : "gray" as const, title: null };
  };
  const rows: { name: string; sub: string; subTitle?: string; status: React.ReactNode; open: React.ReactNode; info?: React.ReactNode }[] = [
    {
      name: "Lease", sub: v ? `${v} violation${v === 1 ? "" : "s"} flagged` : "Checked",
      status: <StatusChip tone="green">Checked</StatusChip>,
      open: leaseUrl ? <a href={leaseUrl} target="_blank" rel="noreferrer" className="font-medium text-brand hover:underline">Open PDF</a> : <span className="text-ink-3">No file</span>,
    },
    {
      name: refundRecordWords(p.pack).name, sub: p.agreement ? `Signed by ${p.agreement.signed_by.join(" and ")}` : refundRecordWords(p.pack).unsigned,
      status: p.agreement ? <StatusChip tone="green">Signed {shortDate(dateIn(p.agreement.signed_at, p.pack.timeZone.id))}</StatusChip> : <StatusChip tone="amber">Not signed</StatusChip>,
      open: <Link href={tabHref(p.id, "overview", "move-in")} className="font-medium text-brand hover:underline">View</Link>,
      info: <InfoTip title={p.pack.refund.documentsTip.title} cite={p.pack.refund.documentsTip.cite}>{p.pack.refund.documentsTip.text}</InfoTip>,
    },
    {
      name: "Move-in photos", sub: `${p.moveInCount} photo${p.moveInCount === 1 ? "" : "s"}`,
      status: p.moveInCount ? <StatusChip tone="green">On file</StatusChip> : <StatusChip tone="amber">Missing</StatusChip>,
      open: <Link href={tabHref(p.id, "overview", "move-in")} className="font-medium text-brand hover:underline">View</Link>,
      info: <InfoTip title={p.pack.moveIn.photosDocTip.title} cite={p.pack.moveIn.photosDocTip.cite}>{p.pack.moveIn.photosDocTip.text}</InfoTip>,
    },
    // The state's own move-in records (a Washington checklist, the account the deposit is held in), then its notices.
    ...recordsFor(p.pack, "move_in").map((r) => {
      const given = p.notices[r.kind];
      return {
        name: r.short.charAt(0).toUpperCase() + r.short.slice(1), sub: given ? `${r.verb} ${shortDate(given.date)}` : r.title,
        status: given ? <StatusChip tone="green">{r.verb}</StatusChip> : <StatusChip tone="amber">Not recorded</StatusChip>,
        open: <Link href={`/tenancy/${p.id}/notices/${NOTICE_SLUG[r.kind]}`} className="font-medium text-brand hover:underline">{r.draft ? "Open draft" : "Open"}</Link>,
        info: <InfoTip title={r.title} cite={r.cite}>{r.tip}</InfoTip>,
      };
    }),
    ...(Object.keys(info) as NoticeKind[]).map((k) => {
      const s = notice(k);
      const n = info[k]!;
      return {
        name: n.short.charAt(0).toUpperCase() + n.short.slice(1), sub: s.title ?? n.title,
        status: <StatusChip tone={s.tone}>{s.text}</StatusChip>,
        open: <Link href={`/tenancy/${p.id}/notices/${NOTICE_SLUG[k]}`} className="font-medium text-brand hover:underline">Open draft</Link>,
        info: <InfoTip title={n.title} cite={n.cite} />,
      };
    }),
    // After the move-out: the state's own records (a Florida claim notice, a Texas forwarding address). A record that
    // answers another (Florida's objection to a claim notice) appears once that one is on file.
    ...listedRecords(p.pack, "move_out", p.notices).map((r) => {
      const given = p.notices[r.kind];
      return {
        name: r.short.charAt(0).toUpperCase() + r.short.slice(1), sub: given ? `${r.verb} ${shortDate(given.date)}` : r.title,
        status: given ? <StatusChip tone="green">{r.verb}</StatusChip> : <StatusChip tone="gray">Not recorded</StatusChip>,
        open: <Link href={`/tenancy/${p.id}/notices/${NOTICE_SLUG[r.kind]}`} className="font-medium text-brand hover:underline">{r.draft ? "Open draft" : "Open"}</Link>,
        info: <InfoTip title={r.title} cite={r.cite}>{r.tip}</InfoTip>,
      };
    }),
    {
      name: "Itemized statement", sub: p.delivery ? deliveryLine(p.delivery) : p.inspected ? "With photos and invoices" : "After the move-out comparison",
      subTitle: p.delivery ? describeDelivery(p.delivery).replace(/^./, (c) => c.toUpperCase()) : undefined,
      status: p.delivery ? <StatusChip live tone="green">Delivered</StatusChip> : p.inspected ? <StatusChip live tone="amber">Draft</StatusChip> : <StatusChip live tone="gray">Not started</StatusChip>,
      open: p.inspected ? (
        <span className="inline-flex gap-3">
          <Link href={`/tenancy/${p.id}/statement`} className="font-medium text-brand hover:underline">Open</Link>
          <a href={`/api/tenancies/${p.id}/statement/pdf`} className="font-medium text-brand hover:underline">PDF</a>
        </span>
      ) : <span className="text-ink-3">Not ready</span>,
      info: <InfoTip title={p.pack.statement.documentRow.title} cite={p.pack.statement.documentRow.cite}>{p.pack.statement.documentRow.text}</InfoTip>,
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

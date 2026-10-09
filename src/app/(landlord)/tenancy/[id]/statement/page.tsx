import Link from "@/components/link";
import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { Suspense, type ReactNode } from "react";
import { ButtonLink } from "@/components/button";
import { Icon, type IconName } from "@/components/icons";
import { InfoTip, TipLabel } from "@/components/info-tip";
import { Bone, Skeleton } from "@/components/skeletons";
import { Card, CardHead, Fact, FactStrip, Money, StatusChip, type Tone } from "@/components/ui";
import { closeOutFacts } from "@/lib/closeout";
import { dayLabel, shortDate, whenText } from "@/lib/dates";
import { DEMO_EXAMPLE, TENANT_VIEW_TIP } from "@/lib/copy";
import { usd } from "@/lib/deductions";
import { streetLine } from "@/lib/ledger";
import { demoTenantPath } from "@/lib/tenant-links";
import { pageTenancy, signedUrlsFor, thumbsFor } from "@/lib/workspace";
import {
  buildStatement, dateIn, describeDelivery, longDate, statementFrame, statementRows,
  type ChecklistItem, type Statement, type StatementDeduction, type StatementFrame, type StatementSettlement,
} from "@/lib/statement";
import { packFor } from "@/lib/states/server";
import type { StatePack } from "@/lib/states/types";
import { DeliveryPanel } from "./delivery-form";
import { DownloadPdf } from "./download-pdf";

export const dynamic = "force-dynamic";
export const metadata: Metadata = { title: "Itemized statement" };

// The itemized statement (California: Civ. Code 1950.5(h); elsewhere the tenancy's state pack) as a document beside
// two cards: the delivery record and the state's checklist. The document keeps every word the statement needs on paper; on screen its citations and longer
// explanations sit behind info icons, and print brings them back as text. The PDF packet is the copy that goes out,
// since it carries the photo exhibits and the invoice copies; this page prints too.
//
// The page is drawn from the statement's own rows first (statementFrame: who, the dates, each deduction with its
// photos, the documents rule, interest, the delivery record), and what PayPal's live answer decides (the deposit, the
// totals, the refund, a settlement's figures, the checklist) streams in behind its own skeletons a moment later, read
// once for all of them (buildStatement, closeOutFacts). Record delivery stays off until that answer is in, as it was
// when the page waited for it.

/** A checklist citation in full: California's items name subsections ("(h)(1)"). */
const cite = (c: string, pack: StatePack) => (c.startsWith("(") ? pack.statute.tagCite(c) : c);
const payMethod = (m: string | null) => (!m ? "PayPal" : m === "PAYPAL" ? "PayPal" : m.charAt(0) + m.slice(1).toLowerCase().replace(/_/g, " "));
const CATEGORY: Record<StatementDeduction["category"], { label: string; tone: Tone }> = {
  rent: { label: "Unpaid rent", tone: "gray" },
  damage: { label: "Damage", tone: "red" },
  cleaning: { label: "Cleaning", tone: "amber" },
};


export default async function StatementPage({ params }: PageProps<"/tenancy/[id]/statement">) {
  const { id } = await params;
  const ws = await pageTenancy(id);
  // PayPal's live answer is asked for at once, beside the statement's own rows; nothing below waits for it but the
  // parts it decides.
  const facts = closeOutFacts(id);
  facts.catch(() => {});
  const [r, tenantPath] = await Promise.all([statementRows(id), demoTenantPath(ws, id)]);
  if (!r) notFound();
  const live = buildStatement(id, r, facts);
  live.catch(() => {});
  const f = statementFrame(id, r);
  const pack = packFor(f.state);
  const sec = pack.statement.sections;

  // The photos' small versions (src/lib/thumbs.ts, no request) and short-lived links to the invoices, one request. No
  // link means the file is not in the bucket (or not one this workspace may open).
  const urls = new Map<string, string | null>();
  const [photoLinks, receiptLinks] = await Promise.all([
    thumbsFor(ws, f.deductions.flatMap((d) => d.photos.map((p) => p.path))),
    signedUrlsFor(ws, "receipts", f.deductions.flatMap((d) => (d.vendor?.invoicePath ? [d.vendor.invoicePath] : []))),
  ]);
  for (const [p, u] of photoLinks) urls.set(`photos/${p}`, u);
  for (const [p, u] of receiptLinks) urls.set(`receipts/${p}`, u);

  const repairs = f.deductions.filter((d) => d.category !== "rent");
  const invoicesMissing = f.deductions.filter((d) => d.vendor?.invoicePath && !urls.get(`receipts/${d.vendor.invoicePath}`));
  const pdfHref = `/api/tenancies/${id}/statement/pdf`;
  const delivered = !!f.delivery;
  // The sections in order; the settlement's is there when one was paid, the balance claimed's when PayPal's answer
  // says the deductions pass the deposit (LiveTail numbers it and the delivery's).
  const nSettlement = f.amended ? 5 : null;
  const nInterest = f.amended ? 6 : 5;
  const panel = { tenancyId: id, state: pack.code, tenants: f.tenantContacts, unitAddress: f.property.address, today: f.today, due: f.statementDue,
    existing: f.delivery, recordedOn: f.deliveryRecordedOn ?? null, forwarding: f.tenantForwarding };

  return (
    <div className="w-full print:max-w-none">
      <div className="flex flex-wrap items-center gap-x-4 gap-y-3 print:hidden">
        <Link href={`/tenancy/${id}?tab=move-out`} aria-label="Back to the property"
          className="inline-flex size-8 shrink-0 items-center justify-center rounded-full border border-line text-ink-2 transition-colors hover:bg-surface">
          <Icon name="arrow-left" className="size-[15px]" />
        </Link>
        <div className="min-w-0 flex-[1_1_16rem]">
          <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
            <h1 className="text-xl font-medium">Itemized statement</h1>
            <StatusChip tone={delivered ? "green" : "amber"} size="lg">{delivered ? "Delivered" : "Draft"}</StatusChip>
            {f.amended && <StatusChip tone="gray" size="lg">Amended</StatusChip>}
          </div>
          <div className="mt-0.5 text-base text-ink-3">{streetLine(f.property.address)}</div>
        </div>
        <div className="flex items-center gap-2 max-sm:w-full">
          <ButtonLink plain href={`${pdfHref}?inline=1`} target="_blank" rel="noreferrer" className="max-sm:flex-1">Print</ButtonLink>
          <DownloadPdf href={pdfHref} className="max-sm:flex-1" title="This statement with its photo exhibits and invoice copies: the version to mail or email" />
        </div>
      </div>

      <Suspense fallback={<FactsWaiting f={f} pack={pack} />}>
        <LiveFacts live={live} pack={pack} />
      </Suspense>

      <div className="mt-6 grid items-start gap-6 lg:grid-cols-[minmax(0,1fr)_300px] lg:grid-rows-[auto_1fr] print:mt-0 print:block">
        {/* On a phone the column reads Delivery, Checklist, then the document, so the checklist sits by the card it explains. */}
        <div className="print:hidden lg:col-start-2 lg:row-start-1">
          {/* Off until PayPal's answer is in: the same panel, its button waiting. */}
          <Suspense fallback={<DeliveryPanel {...panel} waiting />}>
            <LiveDelivery live={live} panel={panel} />
          </Suspense>
          {/* In a demo copy one person plays both sides: once the statement is out, the tenants' page is a click away. */}
          {delivered && tenantPath && (
            <p className="mt-3 flex items-center gap-1.5 px-1 text-sm">
              <a href={tenantPath} target="_blank" rel="noopener noreferrer" className="inline-flex items-center gap-1 font-medium text-brand hover:underline">
                Open the tenant&apos;s view<Icon name="arrow-up-right" className="size-3.5" />
              </a>
              <InfoTip align="end" title="The tenants' side">{TENANT_VIEW_TIP}</InfoTip>
            </p>
          )}
        </div>

        <article className="min-w-0 max-lg:order-3 rounded-lg border border-line bg-canvas p-5 shadow-sm sm:p-8 lg:col-start-1 lg:row-span-2 lg:row-start-1 print:rounded-none print:border-0 print:p-0 print:shadow-none">
          <header className="print-block">
            <p className="flex items-center gap-1.5 text-xs font-medium text-ink-3">
              Itemized security deposit statement
              <Cite cite={pack.statement.headerTip.cite} title={pack.statement.headerTip.title}>{pack.statement.headerTip.text}</Cite>
            </p>
            <h2 className="mt-1.5 text-xl font-medium">{f.property.address}</h2>
            <dl className="mt-5 grid grid-cols-2 gap-x-6 gap-y-4 sm:grid-cols-3">
              <Field label="From">{f.landlord}</Field>
              <Field label="To">{f.tenants.join(" and ")}</Field>
              <Field label="Moved out">{f.moveOutDate ? longDate(f.moveOutDate) : "Not set"}</Field>
              <Field label="Statement date">{longDate(f.statementDate)}</Field>
              <Field label={<>Due by<Cite cite={pack.deadline.tip.cite} title={pack.deadline.tip.title}>{pack.statement.dueTipText}</Cite></>}>
                {f.statementDue ? longDate(f.statementDue) : "Not set"}
                <span className="hidden text-xs text-ink-3 print:block">{pack.statement.pdf.dueSuffix}</span>
              </Field>
            </dl>
          </header>

          <Section n={1} title={sec.security.title} cite={sec.security.cite} tip={sec.security.text}>
            <Suspense fallback={<Waiting label="the deposit" lines={[90, 200, 210, 250]} />}>
              <LiveSecurity live={live} pack={pack} />
            </Suspense>
          </Section>

          <Section n={2} title={sec.deductions.title} cite={sec.deductions.cite} tip={sec.deductions.text}>
            <Suspense fallback={null}>
              <LiveStanding live={live} />
            </Suspense>
            {f.deductions.length ? (
              <ol className="divide-y divide-line-2">
                {f.deductions.map((d) => <Deduction key={d.id} pack={pack} d={d} urls={urls} />)}
              </ol>
            ) : (
              <Suspense fallback={<Waiting label="the deductions" lines={[200]} />}>
                <LiveNoDeductions live={live} />
              </Suspense>
            )}
            {f.wear && f.wear.length > 0 && (
              <div className="print-block mt-4 border-t border-line-2 pt-3">
                <p className="text-sm font-medium">Considered and not charged</p>
                <ul className="mt-1.5 flex flex-col gap-1 text-sm text-ink-2">
                  {f.wear.map((w, i) => (
                    <li key={i} className="flex justify-between gap-4">
                      <span className="min-w-0">{w.item}<span className="text-ink-3">, {w.room}: normal wear and tear</span></span>
                      <span className="shrink-0 tabular-nums">{usd(0)}</span>
                    </li>
                  ))}
                </ul>
              </div>
            )}
            <Suspense fallback={<TotalsWaiting />}>
              <LiveTotals live={live} />
            </Suspense>
          </Section>

          <Section n={3} title="Documents" cite={pack.statement.documentsCite(f.documents.required)} tip={f.documents.note}>
            {/* On screen a line and the rule in the tip; on paper the rule in full, and where the copies are. */}
            <p className="text-ink-2 print:hidden">
              {!repairs.length ? "No repair or cleaning was deducted." : pack.statement.documentsLine(f.documents.required, f.totals.repairAndCleaning)}
            </p>
            {repairs.length > 0 && <p className="mt-1 text-sm text-ink-3 print:hidden">In the PDF packet: the photos for each item and copies of the invoices</p>}
            <p className="hidden text-ink-2 print:block">{f.documents.note}</p>
            {repairs.length > 0 && (
              <p className="mt-2 hidden text-sm text-ink-2 print:block">The photos are printed with each item above. Copies of the invoices are in the PDF packet of this statement.</p>
            )}
            {invoicesMissing.length > 0 && (
              <p className="mt-2 text-sm text-amber">
                Not available: {invoicesMissing.map((d) => `the invoice from ${d.vendor!.name ?? "the vendor"} for item ${d.n} (file not found)`).join("; ")}.
              </p>
            )}
          </Section>

          <Suspense fallback={<Section n={4} title="Refund" cite={sec.refund}><Waiting label="the refund" lines={[90, 280, 220, 240]} /></Section>}>
            <LiveRefund live={live} n={4} cite={sec.refund} />
          </Suspense>

          {nSettlement && (
            <Suspense fallback={<Section n={nSettlement} title="Settlement" tip={SETTLEMENT_TIP}><Waiting label="the settlement" lines={[300, 240, 200]} /></Section>}>
              <LiveSettlement live={live} n={nSettlement} />
            </Suspense>
          )}

          <Section n={nInterest} title={pack.statement.interestTitle} tip={f.interest.note}>
            <p className={f.interest.known ? "text-amber print:text-ink-2" : "text-ink-2"}>
              <span className="print:hidden">
                {f.interest.known ? `Required${f.interest.city ? ` in ${f.interest.city}` : ""}; not computed here` : `None required${f.interest.city ? ` in ${f.interest.city}` : ""}`}
              </span>
              <span className="hidden print:inline">{f.interest.note}</span>
            </p>
          </Section>

          {/* The delivery's number follows a balance claimed, which PayPal's answer decides: drawn as it is meanwhile. */}
          <Suspense fallback={<DeliverySection n={nInterest + 1} f={f} pack={pack} />}>
            <LiveTail live={live} n={nInterest + 1} f={f} pack={pack} />
          </Suspense>

          <footer className="mt-10 border-t border-line pt-4 text-xs text-ink-3 print:pt-5">
            <p className="hidden print:block">{pack.copy.preparedUnder}</p>
            {/* On paper the two notes the statement's reader needs; on screen all four behind one tip. */}
            <p className="hidden print:mt-2 print:block">{pack.copy.disclaimers[1]}</p>
            <p className="mt-2 hidden print:block">{pack.copy.disclaimers[3]}</p>
            <p className="flex items-center gap-1.5 print:hidden">
              About this tool
              <InfoTip title="Not legal advice">
                {pack.copy.disclaimers.map((d, i) => <span key={i} className={`block ${i ? "mt-1.5" : ""}`}>{d}</span>)}
              </InfoTip>
            </p>
          </footer>
        </article>

        <div className="print:hidden max-lg:order-2 lg:col-start-2 lg:row-start-2">
          <Suspense fallback={<ChecklistWaiting />}>
            <LiveChecklist live={live} pack={pack} />
          </Suspense>
        </div>
      </div>
    </div>
  );
}

/* ---------- What PayPal's live answer decides, streamed in ---------- */

type Live = Promise<Statement | null>;

/** The statement with PayPal's answer. It can't be missing here (the page checked its rows first), so a null reads
 *  as the not-found page. */
async function statementOf(live: Live): Promise<Statement> {
  const s = await live;
  if (!s) notFound();
  return s;
}

/** What the money figures add up to, from the statement as PayPal's answer completes it. */
function moneyOf(s: Statement) {
  const sent = s.refund.state === "sent";
  // Forfeited deductions (New York after day 14): the lines stay as what was claimed, they come back off in the totals,
  // and the whole security is what is owed. A claim over the deposit is a separate matter, so no balance is shown then.
  const forfeits = !!s.standing?.forfeits;
  const claim = forfeits ? null : s.balanceClaimed;
  const via = s.viaDispute;
  // Refunds made in PayPal and recorded here: the refund itself when they cover it (asRefund), else lines before it.
  const outside = s.outside && !s.outside.asRefund ? s.outside : null;
  const prior = (via?.amount ?? 0) + (outside?.amount ?? 0);
  const stillOwed = forfeits && sent ? Math.max(0, Math.round((s.totals.depositHeld - s.refund.amount - (s.settlement?.amount ?? 0) - prior) * 100) / 100) : 0;
  // Money PayPal returned through the tenants' PayPal dispute or refunded in PayPal, with the statement's refund if it
  // went too.
  const returnedInAll = prior ? Math.round((prior + (sent ? s.refund.amount : 0)) * 100) / 100 : 0;
  return { sent, forfeits, claim, via, outside, prior, stillOwed, returnedInAll };
}

const dueByFact = (f: Pick<Statement, "statementDue" | "delivery" | "deliveryRecordedOn" | "today" | "daysLeft">, pack: StatePack) => (
  <Fact label="Due by"
    info={<InfoTip align="end" title={pack.deadline.tip.title} cite={pack.deadline.tip.cite}>{pack.deadline.tip.text}</InfoTip>}
    value={f.statementDue ? shortDate(f.statementDue) : "Not set"}
    sub={f.delivery ? (f.deliveryRecordedOn ? `Delivered ${dayLabel(f.delivery.date, f.today)}, recorded ${dayLabel(f.deliveryRecordedOn, f.today)}` : `Delivered ${shortDate(f.delivery.date)}`) : f.daysLeft != null ? whenText(f.daysLeft) : "No move-out yet"} />
);

async function LiveFacts({ live, pack }: { live: Live; pack: StatePack }) {
  const s = await statementOf(live);
  const dayOf = (ts: string) => dateIn(ts, pack.timeZone.id);
  const { sent, forfeits, claim, via, outside, prior, stillOwed, returnedInAll } = moneyOf(s);
  return (
    <FactStrip cols={4} className="mt-6 print:hidden">
      <Fact label="Security held" value={<Money value={s.totals.depositHeld} />}
        sub={s.security?.paid ? (s.security.paidAt ? `Paid ${shortDate(dayOf(s.security.paidAt))}` : "Paid") : "Not paid"} />
      <Fact label={s.standing && !forfeits ? s.standing.label : "Deductions"} value={<Money value={s.totals.deductions} />}
        sub={`${s.deductions.length} item${s.deductions.length === 1 ? "" : "s"}${forfeits ? ", forfeited" : ""}`}
        info={s.standing ? <InfoTip title={s.standing.label}>{s.standing.note}</InfoTip> : undefined} />
      {s.settlement ? (
        <Fact big label="Returned in all" value={<Money value={s.settlement.returnedInAll} cents="small" phoneCents="full" />}
          sub={`Statement and settlement, ${shortDate(s.settlement.sentAt ? dayOf(s.settlement.sentAt) : s.today)}`} />
      ) : prior ? (
        <Fact big label="Returned in all" value={<Money value={returnedInAll} cents="small" phoneCents="full" />}
          sub={!sent && s.refund.amount > 0 ? `${usd(s.refund.amount)} still to refund`
            : outside && !via ? (sent ? "Refunds in PayPal and from here" : "Refunded in PayPal")
              : sent ? "PayPal dispute and refund" : "Through the PayPal dispute"} />
      ) : (
        <Fact big label={claim ? "Balance claimed" : sent ? "Refunded" : forfeits ? "Owed back" : "Refund due"}
          value={<Money value={claim ? claim.amount : s.refund.amount} cents="small" phoneCents="full" />}
          sub={stillOwed ? `${usd(stillOwed)} still owed` : sent && s.refund.sentAt ? `${s.outside?.asRefund ? "In PayPal" : "By PayPal"}, ${shortDate(dayOf(s.refund.sentAt))}` : `To ${s.tenants.join(" and ") || "the tenants"}`} />
      )}
      {dueByFact(s, pack)}
    </FactStrip>
  );
}

/** The facts strip while PayPal answers: the deadline, which is the statement's own, and bones in the money's facts
 *  (real Fact cells, so the strip keeps its layout at every width). */
function FactsWaiting({ f, pack }: { f: StatementFrame; pack: StatePack }) {
  return (
    <FactStrip cols={4} className="mt-6 print:hidden">
      {[0, 1, 2].map((i) => (
        <Fact key={i} big={i === 2}
          label={<>{!i && <span role="status" className="sr-only">Loading the deposit and the totals</span>}<Bone mark w={84} h={12} className="my-0.5" /></>}
          value={<Bone mark w={i === 2 ? 132 : 104} h={22} className="my-[3px]" />} sub={<Bone mark w={92} h={12} className="my-0.5" />} />
      ))}
      {dueByFact(f, pack)}
    </FactStrip>
  );
}

/** Bone lines in the document while PayPal answers, one per row of what will stand there, each a row's height. */
function Waiting({ label, lines }: { label: string; lines: number[] }) {
  return (
    <Skeleton label={label} className="flex flex-col gap-2 print:hidden">
      {lines.map((w, i) => <div key={i} className="flex h-6 items-center gap-4"><Bone w={96} h={13} /><Bone w={w} h={13} className="max-w-[60%]" /></div>)}
    </Skeleton>
  );
}

async function LiveSecurity({ live, pack }: { live: Live; pack: StatePack }) {
  const s = await statementOf(live);
  const dayOf = (ts: string) => dateIn(ts, pack.timeZone.id);
  return s.security ? (
    <Rows rows={[
      ["Amount", <span key="a" className="font-medium tabular-nums">{usd(s.security.amount)}</span>],
      s.security.paid
        ? ["Paid", `${s.security.paidAt ? `${longDate(dayOf(s.security.paidAt))}, ` : ""}by ${payMethod(s.security.method)}`]
        : ["Status", `${s.security.invoiceStatus.toLowerCase().replace(/_/g, " ")}, not paid`],
      ["PayPal invoice", <span key="i" className="break-all tabular-nums">{s.security.invoiceId}</span>],
      ...(s.security.basisNote ? [["Basis", (
        <span key="b">
          <span className="print:hidden">
            {s.security.leaseAsked != null && s.security.cap != null && s.security.leaseAsked > s.security.amount
              ? `The lease asked for ${usd(s.security.leaseAsked)}; the cap is ${usd(s.security.cap)}`
              : "How the lease labeled it"}
            <span className="ml-1.5 inline-flex align-[-2px]"><InfoTip title="The basis of the security">{s.security.basisNote}</InfoTip></span>
          </span>
          <span className="hidden print:inline">{s.security.basisNote}</span>
        </span>
      )] as [ReactNode, ReactNode]] : []),
      ...(!s.security.live ? [["Note", "PayPal could not be reached just now; the payment is as last recorded."] as [ReactNode, ReactNode]] : []),
    ]} />
  ) : (
    <p className="text-ink-2">No security deposit was collected through PayPal for this tenancy.</p>
  );
}

async function LiveStanding({ live }: { live: Live }) {
  const s = await statementOf(live);
  return s.standing ? <p className="mb-4 text-sm text-amber print:text-ink-2"><span className="font-medium">{s.standing.label}.</span> {s.standing.note}</p> : null;
}

async function LiveNoDeductions({ live }: { live: Live }) {
  const s = await statementOf(live);
  return <p className="text-ink-2">{s.totals.depositHeld === 0 ? "No deductions." : "No deductions. The whole security is refunded."}</p>;
}

async function LiveTotals({ live }: { live: Live }) {
  const s = await statementOf(live);
  const { sent, forfeits, claim, via, outside, prior, stillOwed } = moneyOf(s);
  return (
    <dl className="print-block ml-auto mt-4 grid max-w-[320px] grid-cols-[minmax(0,1fr)_auto] gap-x-6 gap-y-1.5 border-t border-line pt-4">
      <dt className="text-ink-3">Security held</dt><dd className="text-right tabular-nums">{usd(s.totals.depositHeld)}</dd>
      <dt className="text-ink-3">{s.standing && !forfeits ? s.standing.label : "Deductions"}</dt><dd className="text-right"><Money value={s.totals.deductions} sign={s.totals.deductions ? "minus" : undefined} /></dd>
      {forfeits && <><dt className="text-ink-3">{s.standing!.label}</dt><dd className="text-right"><Money value={s.totals.deductions} sign="plus" /></dd></>}
      {/* PayPal's refund through the tenants' PayPal dispute: past the refund owed, the deductions it covered aren't kept. */}
      {via && via.notKept > 0 && <><dt className="text-ink-3">Not kept, after the PayPal dispute</dt><dd className="text-right"><Money value={via.notKept} sign="plus" /></dd></>}
      {s.outside && s.outside.notKept > 0 && <><dt className="text-ink-3">Not kept, after the refund in PayPal</dt><dd className="text-right"><Money value={s.outside.notKept} sign="plus" /></dd></>}
      {via && <><dt className="text-ink-3">Returned through the PayPal dispute</dt><dd className="text-right"><Money value={via.amount} sign="minus" /></dd></>}
      {outside && <><dt className="text-ink-3">Refunded in PayPal</dt><dd className="text-right"><Money value={outside.amount} sign="minus" /></dd></>}
      <dt className="mt-1 border-t border-line pt-2 font-medium">{claim ? "Balance claimed" : sent ? "Refunded" : forfeits ? "Owed back" : prior ? "Left to refund" : "Refund"}</dt>
      <dd className="mt-1 border-t border-line pt-2 text-right text-lg font-medium tabular-nums">{usd(claim ? claim.amount : s.refund.amount)}</dd>
      {stillOwed > 0 && <><dt className="text-ink-3">Still owed</dt><dd className="text-right tabular-nums">{usd(stillOwed)}</dd></>}
    </dl>
  );
}

function TotalsWaiting() {
  return (
    <Skeleton label="the totals" className="ml-auto mt-4 flex max-w-[320px] flex-col gap-1.5 border-t border-line pt-4 print:hidden">
      {[0, 1].map((i) => <div key={i} className="flex h-6 items-center justify-between gap-6"><Bone w={110} h={13} /><Bone w={80} h={13} /></div>)}
      <div className="mt-1 flex h-[37px] items-center justify-between gap-6 border-t border-line pt-2"><Bone w={70} h={14} /><Bone w={96} h={20} /></div>
    </Skeleton>
  );
}

async function LiveRefund({ live, n, cite }: { live: Live; n: number; cite: string }) {
  const s = await statementOf(live);
  const dayOf = (ts: string) => dateIn(ts, packFor(s.state).timeZone.id);
  const { via, outside } = moneyOf(s);
  return (
    <Section n={n} title="Refund" cite={cite} tip={s.refund.note || undefined}>
      <Rows rows={[
        ...(via ? [["Through the PayPal dispute", `${usd(via.amount)}${via.disputeId ? `, dispute ${via.disputeId}` : ""}${via.at ? `, ${longDate(dayOf(via.at))}` : ""}`] as [ReactNode, ReactNode]] : []),
        ...(outside ? outside.refunds.map((r) => ["Refunded in PayPal", <span key={r.id} className="break-all">{usd(r.amount)}, refund {r.id}{r.at ? `, ${longDate(dayOf(r.at))}` : ""}</span>] as [ReactNode, ReactNode]) : []),
        ["Amount", <span key="a" className="font-medium tabular-nums">{usd(s.refund.amount)}</span>],
        ["Method", s.refund.method],
        ...(s.refund.paypalId ? [["PayPal ID", <span key="id" className="break-all tabular-nums">{s.refund.paypalId}</span>] as [ReactNode, ReactNode]] : []),
        ...(s.refund.sentAt ? [["Sent", longDate(dayOf(s.refund.sentAt))] as [ReactNode, ReactNode]] : []),
        ...(s.refund.state !== "none" ? [["Payable to", s.refund.payees.join(" and ")] as [ReactNode, ReactNode]] : []),
        ...(s.refund.state !== "none" && s.refund.paypalEmail ? [["PayPal account", <span key="e" className="break-all">{s.refund.paypalEmail}</span>] as [ReactNode, ReactNode]] : []),
      ]} />
      {via && via.notKept > 0 && (
        <p className="mt-3 text-sm text-ink-2">PayPal returned more through the tenants&apos; PayPal dispute than this statement&apos;s refund, so {usd(via.notKept)} of the deductions above is not kept.</p>
      )}
      {s.outside && s.outside.notKept > 0 && (
        <p className="mt-3 text-sm text-ink-2">More was refunded in PayPal than this statement&apos;s refund, so {usd(s.outside.notKept)} of the deductions above is not kept.</p>
      )}
      {s.refund.note && <p className="mt-3 hidden text-sm text-ink-2 print:block">{s.refund.note}</p>}
    </Section>
  );
}

async function LiveSettlement({ live, n }: { live: Live; n: number }) {
  const s = await statementOf(live);
  return s.settlement
    ? <SettlementSection n={n} st={s.settlement} landlord={s.landlord} deducted={s.totals.deductions} refund={s.refund.amount} deposit={s.totals.depositHeld} zone={packFor(s.state).timeZone.id} />
    : null;
}

/** The balance claimed, when the deductions pass the deposit, and the delivery after it. */
async function LiveTail({ live, n, f, pack }: { live: Live; n: number; f: StatementFrame; pack: StatePack }) {
  const s = await statementOf(live);
  return (
    <>
      {s.balanceClaimed && (
        <Section n={n} title="Balance claimed">
          <p className="text-lg font-medium tabular-nums">{usd(s.balanceClaimed.amount)}</p>
          <p className="mt-1 text-ink-2">{s.balanceClaimed.text}</p>
        </Section>
      )}
      <DeliverySection n={s.balanceClaimed ? n + 1 : n} f={f} pack={pack} />
    </>
  );
}

function DeliverySection({ n, f, pack }: { n: number; f: StatementFrame; pack: StatePack }) {
  const sec = pack.statement.sections;
  return (
    <Section n={n} title={sec.delivery.title} cite={sec.delivery.cite} tip={sec.delivery.text}>
      {f.delivery ? (
        <p className="text-ink-2">
          Delivered by {describeDelivery(f.delivery, f.deliveryRecordedOn)}{f.delivery.to && f.delivery.method !== "personal" ? `, addressed to ${f.delivery.to}` : ""}.
        </p>
      ) : (
        <p className="text-ink-3">To be recorded when the statement goes out.</p>
      )}
    </Section>
  );
}

async function LiveChecklist({ live, pack }: { live: Live; pack: StatePack }) {
  const s = await statementOf(live);
  return <Checklist items={s.checklist} pack={pack} />;
}

function ChecklistWaiting() {
  return (
    <Card>
      <CardHead title="Checklist" />
      <Skeleton label="the checklist" className="px-5 pb-3 pt-4">
        <Bone h={6} className="rounded-full" />
        <div className="mt-2">
          {Array.from({ length: 8 }, (_, i) => <div key={i} className="flex h-[34px] items-center gap-2.5"><Bone w={18} h={18} className="rounded-full" /><Bone w={`${78 - (i % 3) * 12}%`} h={13} /></div>)}
        </div>
        <div className="mt-1 flex h-[33px] items-center border-t border-line-2 pt-2"><Bone w={110} h={11} /></div>
      </Skeleton>
    </Card>
  );
}

/** The delivery panel once PayPal's answer is in. */
async function LiveDelivery({ live, panel }: { live: Live; panel: Parameters<typeof DeliveryPanel>[0] }) {
  await statementOf(live);
  return <DeliveryPanel {...panel} />;
}

const SETTLEMENT_TIP = "The tenants disputed this statement through their link. Their advocate and the landlord's negotiator, each held to what the law and the record allow, agreed on the figures below; the tenants accepted them and the landlord approved them. This section amends the statement. Not legal advice.";

/** The amended statement: the tenants disputed it, both sides settled, and the extra amount went back by PayPal. */
function SettlementSection({ n, st, landlord, deducted, refund, deposit, zone }: { n: number; st: StatementSettlement; landlord: string; deducted: number; refund: number; deposit: number; zone: string }) {
  const dayOf = (ts: string) => dateIn(ts, zone); // the day where the property is
  const how = st.example ? DEMO_EXAMPLE.short
    : st.rail === "payout" ? "PayPal Payout to the account the tenants designated" : st.rail ? "PayPal refund of the original deposit payment"
      : st.refundSent && refund >= deposit - 0.005 ? "No money moved: the whole deposit had already gone back with the statement" : "No money moved: the deposit was used in full";
  return (
    <Section n={n} title="Settlement" tip={SETTLEMENT_TIP}>
      <p className="text-ink-2">
        {st.acceptedBy ?? "The tenants"} accepted the settlement{st.acceptedAt ? ` on ${longDate(dayOf(st.acceptedAt))}` : ""}, and {landlord} approved it{st.approvedAt ? ` on ${longDate(dayOf(st.approvedAt))}` : ""}.
      </p>
      {st.lines.length > 0 && (
        <ul className="mt-3 flex flex-col gap-1.5 text-sm">
          {st.lines.map((l) => (
            <li key={l.n} className="flex justify-between gap-4">
              <span className="min-w-0">Item {l.n}. {l.item}<span className="text-ink-3">: kept {usd(l.keep)} of {usd(l.amount)}</span></span>
              <Money value={l.adjustment} className="shrink-0" />
            </li>
          ))}
        </ul>
      )}
      <dl className="print-block ml-auto mt-4 grid max-w-[340px] grid-cols-[minmax(0,1fr)_auto] gap-x-6 gap-y-1.5 border-t border-line pt-4">
        <dt className="text-ink-3">Deductions on the statement</dt><dd className="text-right tabular-nums">{usd(deducted)}</dd>
        <dt className="text-ink-3">Agreed adjustment</dt><dd className="text-right"><Money value={st.adjustment} /></dd>
        <dt className="text-ink-3">Deductions as settled</dt><dd className="text-right tabular-nums">{usd(st.keptAfter)}</dd>
        <dt className="text-ink-3">{st.refundSent ? "Refunded with the statement" : "Refund due with the statement, not sent yet"}</dt><dd className="text-right tabular-nums">{usd(refund)}</dd>
        <dt className="text-ink-3">Settlement</dt><dd className="text-right tabular-nums">{usd(st.amount)}</dd>
        <dt className="mt-1 border-t border-line pt-2 font-medium">Returned in all</dt>
        <dd className="mt-1 border-t border-line pt-2 text-right text-lg font-medium tabular-nums">{usd(st.returnedInAll)}</dd>
        {st.balanceAfter > 0 && <><dt className="text-ink-3">Balance still claimed</dt><dd className="text-right tabular-nums">{usd(st.balanceAfter)}</dd></>}
      </dl>
      <div className="mt-4 text-sm">
        <Rows rows={[
          ["Method", st.example ? <span key="m" className="inline-flex items-center gap-1.5">{how}<span className="inline-flex print:hidden"><InfoTip align="end" title="A recorded example">{DEMO_EXAMPLE.text}</InfoTip></span></span> : how],
          ...(st.paypalId ? [["PayPal ID", <span key="id" className="break-all tabular-nums">{st.paypalId}</span>] as [ReactNode, ReactNode]] : []),
          ...(st.sentAt && st.paypalId ? [["Sent", longDate(dayOf(st.sentAt))] as [ReactNode, ReactNode]] : []),
        ]} />
      </div>
    </Section>
  );
}

/** An info icon on screen; on paper the citation itself. */
function Cite({ cite, title, children }: { cite?: string; title: string; children?: ReactNode }) {
  return (
    <>
      <span className="inline-flex print:hidden"><InfoTip title={title} cite={cite}>{children}</InfoTip></span>
      {cite && <span className="hidden text-xs font-normal text-ink-3 print:inline">{cite}</span>}
    </>
  );
}

function Field({ label, children }: { label: ReactNode; children: ReactNode }) {
  return (
    <div className="min-w-0">
      <dt className="flex items-center gap-1.5 text-xs text-ink-3">{label}</dt>
      <dd className="mt-0.5 break-words">{children}</dd>
    </div>
  );
}

/** Label and value side by side. `stack` (a deduction's details) puts the label over the value on a phone, where two
 *  columns beside the item number would leave the value a few words wide. */
function Rows({ rows, stack }: { rows: [ReactNode, ReactNode][]; stack?: boolean }) {
  return (
    <dl className={stack ? "grid grid-cols-1 gap-y-2 sm:grid-cols-[96px_minmax(0,1fr)] sm:gap-x-4"
      : "grid grid-cols-[104px_minmax(0,1fr)] gap-x-4 gap-y-2 sm:grid-cols-[132px_minmax(0,1fr)]"}>
      {rows.map(([k, v], i) => (
        <div key={i} className="contents">
          <dt className={stack ? "text-xs text-ink-3 sm:text-sm" : "text-ink-3"}>{k}</dt>
          <dd className={`min-w-0 break-words text-ink ${stack ? "-mt-1.5 sm:mt-0" : ""}`}>{v}</dd>
        </div>
      ))}
    </dl>
  );
}

// No print-block on the section: Deductions is taller than a page, and keeping it whole left page 1 half empty.
function Section({ n, title, cite, tip, children }: { n: number; title: string; cite?: string; tip?: string; children: ReactNode }) {
  return (
    <section className="mt-8 border-t border-line pt-6">
      <h2 className="flex flex-wrap items-center gap-x-2 gap-y-1 text-lg font-medium">
        <span className="tabular-nums text-ink-3">{n}</span>
        {title}
        {(tip || cite) && <Cite cite={cite} title={title}>{tip}</Cite>}
      </h2>
      <div className="mt-3">{children}</div>
    </section>
  );
}

function Deduction({ pack, d, urls }: { pack: StatePack; d: StatementDeduction; urls: Map<string, string | null> }) {
  const c = CATEGORY[d.category];
  const invoiceUrl = d.vendor?.invoicePath ? urls.get(`receipts/${d.vendor.invoicePath}`) : null;
  const rows: [ReactNode, ReactNode][] = [
    ["Cost", (
      <span key="c">
        {/* The stored math carries its own label when it is a plain invoice ("Vendor invoice: $140.00"). */}
        {d.explanation}
        {d.guidance && (
          <>
            <span className="ml-1.5 inline-flex align-[-2px] print:hidden">
              <InfoTip title="Guidance, not statute">Prorated by {d.proration === "useful_life" ? "useful life" : "the paint schedule"}, {pack.statement.guidanceSource}. A court may decide differently.</InfoTip>
            </span>
            <span className="hidden text-ink-3 print:inline"> (prorated by {d.proration === "useful_life" ? "useful life" : "the paint schedule"}: {pack.copy.guidanceLabel}, not statute)</span>
          </>
        )}
      </span>
    )],
    ...(d.note ? [["Why", d.note] as [ReactNode, ReactNode]] : []),
    ...(d.labor ? [["Labor", `${d.labor.description ?? "No description recorded"}. ${d.labor.hours ?? "?"} hour${d.labor.hours === 1 ? "" : "s"} at ${d.labor.hourlyRate == null ? "an unrecorded rate" : `${usd(d.labor.hourlyRate)} an hour`}.`] as [ReactNode, ReactNode]] : []),
    ...(d.vendor ? [["Vendor", [d.vendor.name, d.vendor.address, d.vendor.phone].filter(Boolean).join(", ") || "Not recorded"] as [ReactNode, ReactNode]] : []),
    ...(d.vendor ? [["Invoice", d.vendor.invoicePath ? (invoiceUrl ? (
      <span key="i">
        <a href={invoiceUrl} target="_blank" rel="noreferrer" className="font-medium text-brand hover:underline print:hidden">Open the invoice</a>
        <span className="hidden print:inline">A copy is in the PDF packet of this statement.</span>
      </span>
    ) : <span key="i" className="text-amber">On file, but the file could not be found</span>)
      : d.isEstimate ? "Estimate; the invoice follows when received" : <span key="i" className="text-amber">Not on file</span>] as [ReactNode, ReactNode]] : []),
  ];
  return (
    <li className="print-block py-5 first:pt-0">
      <div className="flex items-start gap-3">
        <span className="mt-0.5 flex size-5 shrink-0 items-center justify-center rounded-xs bg-surface-2 text-xs font-medium tabular-nums text-ink-2">{d.n}</span>
        <div className="min-w-0 flex-1">
          <div className="flex items-start gap-3">
            <p className="min-w-0 flex-1 font-medium">{d.item}</p>
            <span className="shrink-0 font-medium tabular-nums">{usd(d.amount)}</span>
          </div>
          <div className="mt-1 flex flex-wrap items-center gap-x-2 gap-y-1 text-sm text-ink-3">
            <span className="print:hidden"><StatusChip tone={c.tone} dot={false}>{c.label}</StatusChip></span>
            <span className="hidden print:inline">{d.tag} {d.tagLabel}</span>
            {d.room && <span>{d.room}</span>}
            <span className="inline-flex print:hidden"><InfoTip title={`${d.tag} ${d.tagLabel}`} cite={pack.statute.tagCite(d.tag)} /></span>
          </div>
          <div className="mt-3 text-sm"><Rows rows={rows} stack /></div>
          {d.isEstimate && (
            <p className="mt-2 text-sm text-amber">
              {pack.statement.estimateLine}
              <span className="hidden print:inline"> ({pack.statement.estimateCite})</span>
              <span className="ml-1.5 inline-flex align-[-2px] print:hidden"><InfoTip title="Estimates" cite={pack.statement.estimateCite}>The work is not finished or the invoice is not in hand yet.</InfoTip></span>
            </p>
          )}
          {d.photos.length > 0 && (
            <div className="mt-3 grid grid-cols-3 gap-2">
              {d.photos.map((p) => (
                // The same file may play two roles (a move-in photo reused as the before photo), so the key carries the role.
                <figure key={`${p.role}-${p.path}`} className="min-w-0">
                  {urls.get(`photos/${p.path}`) ? (
                    // eslint-disable-next-line @next/next/no-img-element
                    <img decoding="async" src={urls.get(`photos/${p.path}`)!} alt={`${d.item}, ${p.label}`} className="aspect-[4/3] w-full rounded-md border border-line object-cover" />
                  ) : (
                    <div className="flex aspect-[4/3] w-full items-center justify-center rounded-md bg-surface text-xs text-ink-3">Not available</div>
                  )}
                  <figcaption className="mt-1 truncate text-xs text-ink-3">{p.label}</figcaption>
                </figure>
              ))}
            </div>
          )}
          {d.missing.length > 0 && <p className="mt-2 text-sm text-amber print:hidden">Still needed: {d.missing.join(", ")}</p>}
        </div>
      </div>
    </li>
  );
}

const MARK: Record<ChecklistItem["state"], [string, IconName | null]> = {
  done: ["bg-green-bg text-green", "check"],
  missing: ["bg-amber-bg text-amber", "clock"],
  not_applicable: ["bg-surface-2 text-ink-4", null],
};

function Checklist({ items, pack }: { items: ChecklistItem[]; pack: StatePack }) {
  const applies = items.filter((c) => c.state !== "not_applicable");
  const na = items.filter((c) => c.state === "not_applicable");
  const done = applies.filter((c) => c.state === "done").length;
  const row = (c: ChecklistItem) => {
    const [cls, icon] = MARK[c.state];
    return (
      <li key={c.n} className="flex items-center gap-2.5 py-[7px] text-sm">
        <span aria-hidden className={`flex size-[18px] shrink-0 items-center justify-center rounded-full ${cls}`}>
          {icon ? <Icon name={icon} className="size-3" /> : <span className="h-px w-2 bg-current" />}
        </span>
        {/* The mark's meaning in words, for a screen reader. */}
        <span className="sr-only">{c.state === "done" ? "Done:" : c.state === "missing" ? "Missing:" : "Not applicable:"}</span>
        <span className={`min-w-0 flex-1 ${c.state === "not_applicable" ? "text-ink-3" : "text-ink-2"}`}>
          <InfoTip title={`${c.n}. ${c.title}`} cite={cite(c.cite, pack)}
            trigger={<TipLabel>{pack.statement.short[c.n] ?? c.title}</TipLabel>}>
            {c.reason}
          </InfoTip>
        </span>
      </li>
    );
  };
  return (
    <Card>
      <CardHead title="Checklist" meta={`${done} of ${applies.length}`} right={
        <InfoTip align="end" title="The statement checklist">{pack.statement.checklistTip}</InfoTip>} />
      <div className="px-5 pb-3 pt-4">
        <div className="h-1.5 overflow-hidden rounded-full bg-surface-2" role="progressbar" aria-label="Checklist progress"
          aria-valuemin={0} aria-valuemax={applies.length} aria-valuenow={done}>
          <div className={`h-full rounded-full ${done === applies.length ? "bg-green-dot" : "bg-amber-dot"}`} style={{ width: `${applies.length ? (done / applies.length) * 100 : 0}%` }} />
        </div>
        <ul className="mt-2">{applies.map(row)}</ul>
        {na.length > 0 && (
          <details className="group mt-1 border-t border-line-2 pt-2">
            <summary className="flex cursor-pointer list-none items-center gap-1 py-1 text-xs font-medium text-ink-3 [&::-webkit-details-marker]:hidden">
              {na.length} don&apos;t apply here
              <Icon name="chev-down" className="size-3.5 transition-transform group-open:rotate-180" />
            </summary>
            <ul>{na.map(row)}</ul>
          </details>
        )}
      </div>
    </Card>
  );
}

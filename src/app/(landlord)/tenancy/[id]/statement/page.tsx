import Link from "@/components/link";
import type { Metadata } from "next";
import { notFound } from "next/navigation";
import type { ReactNode } from "react";
import { ButtonLink } from "@/components/button";
import { Icon, type IconName } from "@/components/icons";
import { InfoTip, TipLabel } from "@/components/info-tip";
import { Card, CardHead, Fact, FactStrip, Money, StatusChip, type Tone } from "@/components/ui";
import { shortDate, whenText } from "@/lib/dates";
import { DEMO_EXAMPLE, TENANT_VIEW_TIP } from "@/lib/copy";
import { usd } from "@/lib/deductions";
import { streetLine } from "@/lib/ledger";
import { demoTenantPath } from "@/lib/tenant-links";
import { pageTenancy, signedUrlsFor } from "@/lib/workspace";
import { buildStatement, describeDelivery, longDate, pacificDate, type ChecklistItem, type StatementDeduction, type StatementSettlement } from "@/lib/statement";
import { packFor } from "@/lib/states/server";
import type { StatePack } from "@/lib/states/types";
import { DeliveryPanel } from "./delivery-form";

export const dynamic = "force-dynamic";
export const metadata: Metadata = { title: "Itemized statement" };

// The itemized statement (California: Civ. Code 1950.5(h); elsewhere the tenancy's state pack) as a document beside
// two cards: the delivery record and the state's checklist. The document keeps every word the statement needs on paper; on screen its citations and longer
// explanations sit behind info icons, and print brings them back as text. The PDF packet is the copy that goes out,
// since it carries the photo exhibits and the invoice copies; this page prints too.

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
  const [s, tenantPath] = await Promise.all([buildStatement(id), demoTenantPath(ws, id)]);
  if (!s) notFound();
  const pack = packFor(s.state);
  const sec = pack.statement.sections;

  // Short-lived links to the private photos and invoices, two requests in all. No link means the file is not in the
  // bucket (or not one this workspace may open).
  const urls = new Map<string, string | null>();
  const [photoLinks, receiptLinks] = await Promise.all([
    signedUrlsFor(ws, "photos", s.deductions.flatMap((d) => d.photos.map((p) => p.path))),
    signedUrlsFor(ws, "receipts", s.deductions.flatMap((d) => (d.vendor?.invoicePath ? [d.vendor.invoicePath] : []))),
  ]);
  for (const [p, u] of photoLinks) urls.set(`photos/${p}`, u);
  for (const [p, u] of receiptLinks) urls.set(`receipts/${p}`, u);

  const repairs = s.deductions.filter((d) => d.category !== "rent");
  const invoicesMissing = s.deductions.filter((d) => d.vendor?.invoicePath && !urls.get(`receipts/${d.vendor.invoicePath}`));
  const pdfHref = `/api/tenancies/${id}/statement/pdf`;
  const delivered = !!s.delivery;
  const sent = s.refund.state === "sent";
  // Forfeited deductions (New York after day 14): the lines stay as what was claimed, they come back off in the totals,
  // and the whole security is what is owed. A claim over the deposit is a separate matter, so no balance is shown then.
  const forfeits = !!s.standing?.forfeits;
  const claim = forfeits ? null : s.balanceClaimed;
  const via = s.viaDispute;
  const stillOwed = forfeits && sent ? Math.max(0, Math.round((s.totals.depositHeld - s.refund.amount - (s.settlement?.amount ?? 0) - (via?.amount ?? 0)) * 100) / 100) : 0;
  // Money PayPal returned through the tenants' PayPal dispute, with the statement's refund if it went too.
  const returnedInAll = via ? Math.round((via.amount + (sent ? s.refund.amount : 0)) * 100) / 100 : 0;
  let n = 0;
  const next = () => ++n;

  return (
    <div className="w-full print:max-w-none">
      <div className="flex flex-wrap items-center gap-x-4 gap-y-3 print:hidden">
        <Link href={`/tenancy/${id}?tab=move-out`} aria-label="Back to the property"
          className="inline-flex size-8 shrink-0 items-center justify-center rounded-full border border-line text-ink-2 hover:bg-surface">
          <Icon name="arrow-left" className="size-[15px]" />
        </Link>
        <div className="min-w-0 flex-[1_1_16rem]">
          <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
            <h1 className="text-xl font-medium">Itemized statement</h1>
            <StatusChip tone={delivered ? "green" : "amber"} size="lg">{delivered ? "Delivered" : "Draft"}</StatusChip>
            {s.settlement && <StatusChip tone="gray" size="lg">Amended</StatusChip>}
          </div>
          <div className="mt-0.5 text-base text-ink-3">{streetLine(s.property.address)}</div>
        </div>
        <div className="flex items-center gap-2 max-sm:w-full">
          <ButtonLink plain href={`${pdfHref}?inline=1`} target="_blank" rel="noreferrer" className="max-sm:flex-1">Print</ButtonLink>
          <ButtonLink plain variant="primary" href={pdfHref} className="max-sm:flex-1"
            title="This statement with its photo exhibits and invoice copies: the version to mail or email"><Icon name="download" />Download PDF</ButtonLink>
        </div>
      </div>

      <FactStrip cols={4} className="mt-6 print:hidden">
        <Fact label="Security held" value={<Money value={s.totals.depositHeld} />}
          sub={s.security?.paid ? (s.security.paidAt ? `Paid ${shortDate(pacificDate(s.security.paidAt))}` : "Paid") : "Not paid"} />
        <Fact label={s.standing && !forfeits ? s.standing.label : "Deductions"} value={<Money value={s.totals.deductions} />}
          sub={`${s.deductions.length} item${s.deductions.length === 1 ? "" : "s"}${forfeits ? ", forfeited" : ""}`}
          info={s.standing ? <InfoTip title={s.standing.label}>{s.standing.note}</InfoTip> : undefined} />
        {s.settlement ? (
          <Fact big label="Returned in all" value={<Money value={s.settlement.returnedInAll} cents="small" phoneCents="full" />}
            sub={`Statement and settlement, ${shortDate(pacificDate(s.settlement.sentAt ?? s.today))}`} />
        ) : via ? (
          <Fact big label="Returned in all" value={<Money value={returnedInAll} cents="small" phoneCents="full" />}
            sub={!sent && s.refund.amount > 0 ? `${usd(s.refund.amount)} still to refund` : sent ? "PayPal dispute and refund" : "Through the PayPal dispute"} />
        ) : (
          <Fact big label={claim ? "Balance claimed" : sent ? "Refunded" : forfeits ? "Owed back" : "Refund due"}
            value={<Money value={claim ? claim.amount : s.refund.amount} cents="small" phoneCents="full" />}
            sub={stillOwed ? `${usd(stillOwed)} still owed` : sent && s.refund.sentAt ? `By PayPal, ${shortDate(pacificDate(s.refund.sentAt))}` : `To ${s.tenants.join(" and ") || "the tenants"}`} />
        )}
        <Fact label="Due by"
          info={<InfoTip align="end" title={pack.deadline.tip.title} cite={pack.deadline.tip.cite}>{pack.deadline.tip.text}</InfoTip>}
          value={s.statementDue ? shortDate(s.statementDue) : "Not set"}
          sub={s.delivery ? `Delivered ${shortDate(s.delivery.date)}` : s.daysLeft != null ? whenText(s.daysLeft) : "No move-out yet"} />
      </FactStrip>

      <div className="mt-6 grid items-start gap-6 lg:grid-cols-[minmax(0,1fr)_300px] lg:grid-rows-[auto_1fr] print:mt-0 print:block">
        {/* On a phone the column reads Delivery, Checklist, then the document, so the checklist sits by the card it explains. */}
        <div className="print:hidden lg:col-start-2 lg:row-start-1">
          <DeliveryPanel tenancyId={id} state={pack.code} tenants={s.tenantContacts} unitAddress={s.property.address} today={s.today} due={s.statementDue}
            existing={s.delivery} forwarding={s.tenantForwarding} />
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
            <h2 className="mt-1.5 text-xl font-medium">{s.property.address}</h2>
            <dl className="mt-5 grid grid-cols-2 gap-x-6 gap-y-4 sm:grid-cols-3">
              <Field label="From">{s.landlord}</Field>
              <Field label="To">{s.tenants.join(" and ")}</Field>
              <Field label="Moved out">{s.moveOutDate ? longDate(s.moveOutDate) : "Not set"}</Field>
              <Field label="Statement date">{longDate(s.statementDate)}</Field>
              <Field label={<>Due by<Cite cite={pack.deadline.tip.cite} title={pack.deadline.tip.title}>{pack.statement.dueTipText}</Cite></>}>
                {s.statementDue ? longDate(s.statementDue) : "Not set"}
                <span className="hidden text-xs text-ink-3 print:block">{pack.statement.pdf.dueSuffix}</span>
              </Field>
            </dl>
          </header>

          <Section n={next()} title={sec.security.title} cite={sec.security.cite} tip={sec.security.text}>
            {s.security ? (
              <Rows rows={[
                ["Amount", <span key="a" className="font-medium tabular-nums">{usd(s.security.amount)}</span>],
                s.security.paid
                  ? ["Paid", `${s.security.paidAt ? `${longDate(pacificDate(s.security.paidAt))}, ` : ""}by ${payMethod(s.security.method)}`]
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
            )}
          </Section>

          <Section n={next()} title={sec.deductions.title} cite={sec.deductions.cite} tip={sec.deductions.text}>
            {s.standing && (
              <p className="mb-4 text-sm text-amber print:text-ink-2"><span className="font-medium">{s.standing.label}.</span> {s.standing.note}</p>
            )}
            {s.deductions.length ? (
              <ol className="divide-y divide-line-2">
                {s.deductions.map((d) => <Deduction key={d.id} pack={pack} d={d} urls={urls} />)}
              </ol>
            ) : (
              <p className="text-ink-2">{s.totals.depositHeld === 0 ? "No deductions." : "No deductions. The whole security is refunded."}</p>
            )}
            {s.wear && s.wear.length > 0 && (
              <div className="print-block mt-4 border-t border-line-2 pt-3">
                <p className="text-sm font-medium">Considered and not charged</p>
                <ul className="mt-1.5 flex flex-col gap-1 text-sm text-ink-2">
                  {s.wear.map((w, i) => (
                    <li key={i} className="flex justify-between gap-4">
                      <span className="min-w-0">{w.item}<span className="text-ink-3">, {w.room}: normal wear and tear</span></span>
                      <span className="shrink-0 tabular-nums">{usd(0)}</span>
                    </li>
                  ))}
                </ul>
              </div>
            )}
            <dl className="print-block ml-auto mt-4 grid max-w-[320px] grid-cols-[minmax(0,1fr)_auto] gap-x-6 gap-y-1.5 border-t border-line pt-4">
              <dt className="text-ink-3">Security held</dt><dd className="text-right tabular-nums">{usd(s.totals.depositHeld)}</dd>
              <dt className="text-ink-3">{s.standing && !forfeits ? s.standing.label : "Deductions"}</dt><dd className="text-right"><Money value={s.totals.deductions} sign={s.totals.deductions ? "minus" : undefined} /></dd>
              {forfeits && <><dt className="text-ink-3">{s.standing!.label}</dt><dd className="text-right"><Money value={s.totals.deductions} sign="plus" /></dd></>}
              {/* PayPal's refund through the tenants' PayPal dispute: past the refund owed, the deductions it covered aren't kept. */}
              {via && via.notKept > 0 && <><dt className="text-ink-3">Not kept, after the PayPal dispute</dt><dd className="text-right"><Money value={via.notKept} sign="plus" /></dd></>}
              {via && <><dt className="text-ink-3">Returned through the PayPal dispute</dt><dd className="text-right"><Money value={via.amount} sign="minus" /></dd></>}
              <dt className="mt-1 border-t border-line pt-2 font-medium">{claim ? "Balance claimed" : sent ? "Refunded" : forfeits ? "Owed back" : via ? "Left to refund" : "Refund"}</dt>
              <dd className="mt-1 border-t border-line pt-2 text-right text-lg font-medium tabular-nums">{usd(claim ? claim.amount : s.refund.amount)}</dd>
              {stillOwed > 0 && <><dt className="text-ink-3">Still owed</dt><dd className="text-right tabular-nums">{usd(stillOwed)}</dd></>}
            </dl>
          </Section>

          <Section n={next()} title="Documents" cite={pack.statement.documentsCite(s.documents.required)} tip={s.documents.note}>
            {/* On screen a line and the rule in the tip; on paper the rule in full, and where the copies are. */}
            <p className="text-ink-2 print:hidden">
              {!repairs.length ? "No repair or cleaning was deducted." : pack.statement.documentsLine(s.documents.required, s.totals.repairAndCleaning)}
            </p>
            {repairs.length > 0 && <p className="mt-1 text-sm text-ink-3 print:hidden">In the PDF packet: the photos for each item and copies of the invoices</p>}
            <p className="hidden text-ink-2 print:block">{s.documents.note}</p>
            {repairs.length > 0 && (
              <p className="mt-2 hidden text-sm text-ink-2 print:block">The photos are printed with each item above. Copies of the invoices are in the PDF packet of this statement.</p>
            )}
            {invoicesMissing.length > 0 && (
              <p className="mt-2 text-sm text-amber">
                Not available: {invoicesMissing.map((d) => `the invoice from ${d.vendor!.name ?? "the vendor"} for item ${d.n} (file not found)`).join("; ")}.
              </p>
            )}
          </Section>

          <Section n={next()} title="Refund" cite={sec.refund} tip={s.refund.note || undefined}>
            <Rows rows={[
              ...(via ? [["Through the PayPal dispute", `${usd(via.amount)}${via.disputeId ? `, dispute ${via.disputeId}` : ""}${via.at ? `, ${longDate(pacificDate(via.at))}` : ""}`] as [ReactNode, ReactNode]] : []),
              ["Amount", <span key="a" className="font-medium tabular-nums">{usd(s.refund.amount)}</span>],
              ["Method", s.refund.method],
              ...(s.refund.paypalId ? [["PayPal ID", <span key="id" className="break-all tabular-nums">{s.refund.paypalId}</span>] as [ReactNode, ReactNode]] : []),
              ...(s.refund.sentAt ? [["Sent", longDate(pacificDate(s.refund.sentAt))] as [ReactNode, ReactNode]] : []),
              ...(s.refund.state !== "none" ? [["Payable to", s.refund.payees.join(" and ")] as [ReactNode, ReactNode]] : []),
              ...(s.refund.state !== "none" && s.refund.paypalEmail ? [["PayPal account", <span key="e" className="break-all">{s.refund.paypalEmail}</span>] as [ReactNode, ReactNode]] : []),
            ]} />
            {via && via.notKept > 0 && (
              <p className="mt-3 text-sm text-ink-2">PayPal returned more through the tenants&apos; PayPal dispute than this statement&apos;s refund, so {usd(via.notKept)} of the deductions above is not kept.</p>
            )}
            {s.refund.note && <p className="mt-3 hidden text-sm text-ink-2 print:block">{s.refund.note}</p>}
          </Section>

          {s.settlement && <SettlementSection n={next()} st={s.settlement} landlord={s.landlord} deducted={s.totals.deductions} refund={s.refund.amount} deposit={s.totals.depositHeld} />}

          <Section n={next()} title={pack.statement.interestTitle} tip={s.interest.note}>
            <p className={s.interest.known ? "text-amber print:text-ink-2" : "text-ink-2"}>
              <span className="print:hidden">
                {s.interest.known ? `Required${s.interest.city ? ` in ${s.interest.city}` : ""}; not computed here` : `None required${s.interest.city ? ` in ${s.interest.city}` : ""}`}
              </span>
              <span className="hidden print:inline">{s.interest.note}</span>
            </p>
          </Section>

          {s.balanceClaimed && (
            <Section n={next()} title="Balance claimed">
              <p className="text-lg font-medium tabular-nums">{usd(s.balanceClaimed.amount)}</p>
              <p className="mt-1 text-ink-2">{s.balanceClaimed.text}</p>
            </Section>
          )}

          <Section n={next()} title={sec.delivery.title} cite={sec.delivery.cite} tip={sec.delivery.text}>
            {s.delivery ? (
              <p className="text-ink-2">
                Delivered by {describeDelivery(s.delivery)}{s.delivery.to && s.delivery.method !== "personal" ? `, addressed to ${s.delivery.to}` : ""}.
              </p>
            ) : (
              <p className="text-ink-3">To be recorded when the statement goes out.</p>
            )}
          </Section>

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
          <Checklist items={s.checklist} pack={pack} />
        </div>
      </div>
    </div>
  );
}

/** The amended statement: the tenants disputed it, both sides settled, and the extra amount went back by PayPal. */
function SettlementSection({ n, st, landlord, deducted, refund, deposit }: { n: number; st: StatementSettlement; landlord: string; deducted: number; refund: number; deposit: number }) {
  const how = st.example ? DEMO_EXAMPLE.short
    : st.rail === "payout" ? "PayPal Payout to the account the tenants designated" : st.rail ? "PayPal refund of the original deposit payment"
      : st.refundSent && refund >= deposit - 0.005 ? "No money moved: the whole deposit had already gone back with the statement" : "No money moved: the deposit was used in full";
  return (
    <Section n={n} title="Settlement" tip="The tenants disputed this statement through their link. Their advocate and the landlord's negotiator, each held to what the law and the record allow, agreed on the figures below; the tenants accepted them and the landlord approved them. This section amends the statement. Not legal advice.">
      <p className="text-ink-2">
        {st.acceptedBy ?? "The tenants"} accepted the settlement{st.acceptedAt ? ` on ${longDate(pacificDate(st.acceptedAt))}` : ""}, and {landlord} approved it{st.approvedAt ? ` on ${longDate(pacificDate(st.approvedAt))}` : ""}.
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
          ...(st.sentAt && st.paypalId ? [["Sent", longDate(pacificDate(st.sentAt))] as [ReactNode, ReactNode]] : []),
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
        <span className={`flex size-[18px] shrink-0 items-center justify-center rounded-full ${cls}`}>
          {icon ? <Icon name={icon} className="size-3" /> : <span className="h-px w-2 bg-current" />}
        </span>
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

import Link from "next/link";
import type { Metadata } from "next";
import { notFound } from "next/navigation";
import type { ReactNode } from "react";
import { ButtonLink } from "@/components/button";
import { Icon, type IconName } from "@/components/icons";
import { InfoTip, TipLabel } from "@/components/info-tip";
import { Card, CardHead, Fact, FactStrip, Money, StatusChip, type Tone } from "@/components/ui";
import { shortDate, whenText } from "@/lib/dates";
import { signedUrl } from "@/lib/db";
import { RECEIPT_THRESHOLD, usd } from "@/lib/deductions";
import { streetLine } from "@/lib/ledger";
import { buildStatement, describeDelivery, DISCLAIMERS, longDate, pacificDate, type ChecklistItem, type StatementDeduction } from "@/lib/statement";
import { DeliveryPanel } from "./delivery-form";

export const dynamic = "force-dynamic";
export const metadata: Metadata = { title: "Itemized statement" };

// The itemized statement (Civ. Code 1950.5(h)) as a document beside two cards: the delivery record and the 13-item
// checklist. The document keeps every word the statement needs on paper; on screen its citations and longer
// explanations sit behind info icons, and print brings them back as text. The PDF packet is the copy that goes out,
// since it carries the photo exhibits and the invoice copies; this page prints too.

const cite = (c: string) => (c.startsWith("(") ? `Civ. Code 1950.5${c}` : c);
const payMethod = (m: string | null) => (!m ? "PayPal" : m === "PAYPAL" ? "PayPal" : m.charAt(0) + m.slice(1).toLowerCase().replace(/_/g, " "));
const CATEGORY: Record<StatementDeduction["category"], { label: string; tone: Tone }> = {
  rent: { label: "Unpaid rent", tone: "gray" },
  damage: { label: "Damage", tone: "red" },
  cleaning: { label: "Cleaning", tone: "amber" },
};

/** The checklist's items in a few words; the whole item is its tip's title. */
const SHORT: Record<number, string> = {
  1: "Parties, dates and deadline", 2: "Security received and its basis", 3: "One tagged line per deduction",
  4: "Labor: work, hours and rate", 5: "Vendor invoices and contacts", 6: "Materials receipts", 7: "Photos and cost explanation",
  8: "Estimates marked as such", 9: "Documents notice, $125 or less", 10: "Refund, method and payees",
  11: "Local deposit interest", 12: "Balance stated as a claim", 13: "Delivery record",
};

export default async function StatementPage({ params }: PageProps<"/tenancy/[id]/statement">) {
  const { id } = await params;
  const s = await buildStatement(id);
  if (!s) notFound();

  // Short-lived links to the private photos and invoices. No link means the file is not in the bucket.
  const urls = new Map<string, string | null>();
  await Promise.all(s.deductions.flatMap((d) => [
    ...d.photos.map(async (p) => { urls.set(`photos/${p.path}`, await signedUrl("photos", p.path)); }),
    ...(d.vendor?.invoicePath ? [signedUrl("receipts", d.vendor.invoicePath).then((u) => { urls.set(`receipts/${d.vendor!.invoicePath}`, u); })] : []),
  ]));

  const repairs = s.deductions.filter((d) => d.category !== "rent");
  const invoicesMissing = s.deductions.filter((d) => d.vendor?.invoicePath && !urls.get(`receipts/${d.vendor.invoicePath}`));
  const pdfHref = `/api/tenancies/${id}/statement/pdf`;
  const delivered = !!s.delivery;
  const sent = s.refund.state === "sent";
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
        <Fact label="Deductions" value={<Money value={s.totals.deductions} />} sub={`${s.deductions.length} item${s.deductions.length === 1 ? "" : "s"}`} />
        <Fact big label={s.balanceClaimed ? "Balance claimed" : sent ? "Refunded" : "Refund due"}
          value={<Money value={s.balanceClaimed ? s.balanceClaimed.amount : s.refund.amount} cents="small" phoneCents="full" />}
          sub={sent && s.refund.sentAt ? `By PayPal, ${shortDate(pacificDate(s.refund.sentAt))}` : `To ${s.tenants.join(" and ") || "the tenants"}`} />
        <Fact label="Due by"
          info={<InfoTip align="end" title="21 days after move-out" cite="Civ. Code 1950.5(h)(1)">The itemized statement and the refund are due within 21 calendar days after the tenants leave.</InfoTip>}
          value={s.statementDue ? shortDate(s.statementDue) : "Not set"}
          sub={s.delivery ? `Delivered ${shortDate(s.delivery.date)}` : s.daysLeft != null ? whenText(s.daysLeft) : "No move-out yet"} />
      </FactStrip>

      <div className="mt-6 grid items-start gap-6 lg:grid-cols-[minmax(0,1fr)_300px] lg:grid-rows-[auto_1fr] print:mt-0 print:block">
        {/* On a phone the column reads Delivery, Checklist, then the document, so the checklist sits by the card it explains. */}
        <div className="print:hidden lg:col-start-2 lg:row-start-1">
          <DeliveryPanel tenancyId={id} tenants={s.tenantContacts} unitAddress={s.property.address} today={s.today} due={s.statementDue}
            existing={s.delivery} forwarding={s.tenantForwarding} />
        </div>

        <article className="min-w-0 max-lg:order-3 rounded-lg border border-line bg-canvas p-5 shadow-sm sm:p-8 lg:col-start-1 lg:row-span-2 lg:row-start-1 print:rounded-none print:border-0 print:p-0 print:shadow-none">
          <header className="print-block">
            <p className="flex items-center gap-1.5 text-xs font-medium text-ink-3">
              Itemized security deposit statement
              <Cite cite="California Civil Code 1950.5(h)" title="The itemized statement">
                Within 21 days after the tenants leave: the basis, amount and disposition of the security, and the refund of what remains.
              </Cite>
            </p>
            <h2 className="mt-1.5 text-xl font-medium">{s.property.address}</h2>
            <dl className="mt-5 grid grid-cols-2 gap-x-6 gap-y-4 sm:grid-cols-3">
              <Field label="From">{s.landlord}</Field>
              <Field label="To">{s.tenants.join(" and ")}</Field>
              <Field label="Moved out">{s.moveOutDate ? longDate(s.moveOutDate) : "Not set"}</Field>
              <Field label="Statement date">{longDate(s.statementDate)}</Field>
              <Field label={<>Due by<Cite cite="Civ. Code 1950.5(h)(1)" title="21 days after move-out">The statement and the refund are due within 21 calendar days after the tenants leave.</Cite></>}>
                {s.statementDue ? longDate(s.statementDue) : "Not set"}
                <span className="hidden text-xs text-ink-3 print:block">21 days after move-out</span>
              </Field>
            </dl>
          </header>

          <Section n={next()} title="Security received" cite="Civ. Code 1950.5(h)(1), (b)"
            tip="The security received and its basis: the date it was paid and any part the lease labeled a fee or advance rent.">
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

          <Section n={next()} title="Deductions" cite="Civ. Code 1950.5(b), (h)(2)"
            tip="One line per deduction, each tagged unpaid rent, damage beyond ordinary wear and tear, or cleaning to the move-in level, with the documents behind it.">
            {s.deductions.length ? (
              <ol className="divide-y divide-line-2">
                {s.deductions.map((d) => <Deduction key={d.id} d={d} urls={urls} />)}
              </ol>
            ) : (
              <p className="text-ink-2">{s.totals.depositHeld === 0 ? "No deductions." : "No deductions. The whole security is refunded."}</p>
            )}
            <dl className="print-block ml-auto mt-4 grid max-w-[320px] grid-cols-[minmax(0,1fr)_auto] gap-x-6 gap-y-1.5 border-t border-line pt-4">
              <dt className="text-ink-3">Security held</dt><dd className="text-right tabular-nums">{usd(s.totals.depositHeld)}</dd>
              <dt className="text-ink-3">Deductions</dt><dd className="text-right"><Money value={s.totals.deductions} sign={s.totals.deductions ? "minus" : undefined} /></dd>
              <dt className="mt-1 border-t border-line pt-2 font-medium">{s.balanceClaimed ? "Balance claimed" : sent ? "Refunded" : "Refund"}</dt>
              <dd className="mt-1 border-t border-line pt-2 text-right text-lg font-medium tabular-nums">{usd(s.balanceClaimed ? s.balanceClaimed.amount : s.refund.amount)}</dd>
            </dl>
          </Section>

          <Section n={next()} title="Documents" cite={s.documents.required ? "Civ. Code 1950.5(h)(2)" : "Civ. Code 1950.5(h)(4)-(5)"} tip={s.documents.note}>
            {/* On screen a line and the rule in the tip; on paper the rule in full, and where the copies are. */}
            <p className="text-ink-2 print:hidden">
              {!repairs.length ? "No repair or cleaning was deducted."
                : s.documents.required ? `Required: repair and cleaning total ${usd(s.totals.repairAndCleaning)}, over ${usd(RECEIPT_THRESHOLD)}`
                  : `Not required: repair and cleaning total ${usd(s.totals.repairAndCleaning)}, ${usd(RECEIPT_THRESHOLD)} or less`}
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

          <Section n={next()} title="Refund" cite="Civ. Code 1950.5(h)(1)(A), (h)(1)(C)" tip={s.refund.note || undefined}>
            <Rows rows={[
              ["Amount", <span key="a" className="font-medium tabular-nums">{usd(s.refund.amount)}</span>],
              ["Method", s.refund.method],
              ...(s.refund.paypalId ? [["PayPal ID", <span key="id" className="break-all tabular-nums">{s.refund.paypalId}</span>] as [ReactNode, ReactNode]] : []),
              ...(s.refund.sentAt ? [["Sent", longDate(pacificDate(s.refund.sentAt))] as [ReactNode, ReactNode]] : []),
              ...(s.refund.state !== "none" ? [["Payable to", s.refund.payees.join(" and ")] as [ReactNode, ReactNode]] : []),
              ...(s.refund.state !== "none" && s.refund.paypalEmail ? [["PayPal account", <span key="e" className="break-all">{s.refund.paypalEmail}</span>] as [ReactNode, ReactNode]] : []),
            ]} />
            {s.refund.note && <p className="mt-3 hidden text-sm text-ink-2 print:block">{s.refund.note}</p>}
          </Section>

          <Section n={next()} title="Local deposit interest" tip={s.interest.note}>
            <p className={s.interest.known ? "text-amber print:text-ink-2" : "text-ink-2"}>
              <span className="print:hidden">
                {s.interest.known ? `Required in ${s.interest.city}; not computed here` : `None required${s.interest.city ? ` in ${s.interest.city}` : ""}`}
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

          <Section n={next()} title="Delivery" cite="Civ. Code 1950.5(h)(1)(B), (h)(6)"
            tip="Personal delivery or first-class mail to the address the tenant gave, or to the vacated unit if none; email only if the landlord and tenant agreed to it in writing.">
            {s.delivery ? (
              <p className="text-ink-2">
                Delivered by {describeDelivery(s.delivery)}{s.delivery.to && s.delivery.method !== "personal" ? `, addressed to ${s.delivery.to}` : ""}.
              </p>
            ) : (
              <p className="text-ink-3">To be recorded when the statement goes out.</p>
            )}
          </Section>

          <footer className="mt-10 border-t border-line pt-4 text-xs text-ink-3 print:pt-5">
            <p className="hidden print:block">Prepared with Good Faith from the landlord&apos;s records, under California Civil Code 1950.5 and published state guidance. It is not legal advice.</p>
            {/* On paper the two notes the statement's reader needs; on screen all four behind one tip. */}
            <p className="hidden print:mt-2 print:block">{DISCLAIMERS[1]}</p>
            <p className="mt-2 hidden print:block">{DISCLAIMERS[3]}</p>
            <p className="flex items-center gap-1.5 print:hidden">
              About this tool
              <InfoTip title="Not legal advice">
                {DISCLAIMERS.map((d, i) => <span key={i} className={`block ${i ? "mt-1.5" : ""}`}>{d}</span>)}
              </InfoTip>
            </p>
          </footer>
        </article>

        <div className="print:hidden max-lg:order-2 lg:col-start-2 lg:row-start-2">
          <Checklist items={s.checklist} />
        </div>
      </div>
    </div>
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

function Deduction({ d, urls }: { d: StatementDeduction; urls: Map<string, string | null> }) {
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
              <InfoTip title="Guidance, not statute">Prorated by {d.proration === "useful_life" ? "useful life" : "the paint schedule"}, from the DRE&apos;s California Tenants guide. A court may decide differently.</InfoTip>
            </span>
            <span className="hidden text-ink-3 print:inline"> (prorated by {d.proration === "useful_life" ? "useful life" : "the paint schedule"}: DRE guidance, not statute)</span>
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
            <span className="inline-flex print:hidden"><InfoTip title={`${d.tag} ${d.tagLabel}`} cite={`Civ. Code 1950.5${d.tag}`} /></span>
          </div>
          <div className="mt-3 text-sm"><Rows rows={rows} stack /></div>
          {d.isEstimate && (
            <p className="mt-2 text-sm text-amber">
              Good-faith estimate: the final cost and documents follow within 14 days of completion or receipt
              <span className="hidden print:inline"> (Civ. Code 1950.5(h)(3))</span>
              <span className="ml-1.5 inline-flex align-[-2px] print:hidden"><InfoTip title="Estimates" cite="Civ. Code 1950.5(h)(3)">The work is not finished or the invoice is not in hand yet.</InfoTip></span>
            </p>
          )}
          {d.photos.length > 0 && (
            <div className="mt-3 grid grid-cols-3 gap-2">
              {d.photos.map((p) => (
                // The same file may play two roles (a move-in photo reused as the before photo), so the key carries the role.
                <figure key={`${p.role}-${p.path}`} className="min-w-0">
                  {urls.get(`photos/${p.path}`) ? (
                    // eslint-disable-next-line @next/next/no-img-element
                    <img src={urls.get(`photos/${p.path}`)!} alt={`${d.item}, ${p.label}`} className="aspect-[4/3] w-full rounded-md border border-line object-cover" />
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

function Checklist({ items }: { items: ChecklistItem[] }) {
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
          <InfoTip title={`${c.n}. ${c.title}`} cite={cite(c.cite)}
            trigger={<TipLabel>{SHORT[c.n] ?? c.title}</TipLabel>}>
            {c.reason}
          </InfoTip>
        </span>
      </li>
    );
  };
  return (
    <Card>
      <CardHead title="Checklist" meta={`${done} of ${applies.length}`} right={
        <InfoTip align="end" title="The statement checklist">
          The 13 items an itemized statement needs under the rules spec: Civ. Code 1950.5(h), local deposit-interest ordinances and DRE guidance. Each item&apos;s tip says why it is done, missing or not needed here.
        </InfoTip>} />
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

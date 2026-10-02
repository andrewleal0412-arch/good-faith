import Link from "next/link";
import { notFound } from "next/navigation";
import { signedUrl } from "@/lib/db";
import { usd } from "@/lib/deductions";
import { buildStatement, describeDelivery, DISCLAIMERS, longDate, pacificDate, type ChecklistItem } from "@/lib/statement";
import { DeliveryForm } from "./delivery-form";

export const dynamic = "force-dynamic";

// The itemized statement (Civ. Code 1950.5(h)) as a document: sections in the order of LEGAL_RULES section B, with a
// completeness checklist beside it that stays off the paper. The PDF packet is the copy that goes out, since it
// carries the photo exhibits and the invoice copies; this page prints too, and its printed copy says where those are.

const STATE: Record<ChecklistItem["state"], string> = { done: "Done", missing: "Missing", not_applicable: "Not applicable" };
const cite = (c: string) => (c.startsWith("(") ? `Civ. Code 1950.5${c}` : c);
const payMethod = (m: string | null) => (!m ? "PayPal" : m === "PAYPAL" ? "PayPal" : m.toLowerCase().replace(/_/g, " "));

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

  const done = s.checklist.filter((c) => c.state === "done").length;
  const applicable = s.checklist.filter((c) => c.state !== "not_applicable").length;
  const dueLine = s.daysLeft == null ? null
    : s.daysLeft < 0 ? `${-s.daysLeft} day${s.daysLeft === -1 ? "" : "s"} late` : s.daysLeft === 0 ? "due today" : `${s.daysLeft} day${s.daysLeft === 1 ? "" : "s"} left`;
  const repairs = s.deductions.filter((d) => d.category !== "rent");
  const invoicesMissing = s.deductions.filter((d) => d.vendor?.invoicePath && !urls.get(`receipts/${d.vendor.invoicePath}`));
  const pdfHref = `/api/tenancies/${id}/statement/pdf`;
  let n = 0;
  const next = () => ++n;

  return (
    <main className="mx-auto w-full max-w-5xl px-5 py-8 print:max-w-none print:p-0">
      <nav className="flex flex-wrap items-center gap-3 print:hidden">
        <Link href={`/tenancy/${id}`} className="text-[13px] font-semibold text-ink-2 hover:text-ink">Back to the tenancy</Link>
        <div className="ml-auto flex flex-wrap gap-2">
          <a href={`${pdfHref}?inline=1`} target="_blank" rel="noreferrer" className="rounded-xl border border-line bg-surface px-4 py-2 text-[14px] font-semibold text-ink hover:bg-bg">
            Print the packet
          </a>
          <a href={pdfHref} className="rounded-xl bg-accent px-4 py-2 text-[14px] font-semibold text-white hover:opacity-90">
            Download PDF packet
          </a>
        </div>
      </nav>
      <p className="mt-2 text-right text-[12px] text-ink-3 print:hidden">The packet is this statement with its photo exhibits and invoice copies: the version to mail or email.</p>

      <div className="mt-4 gap-8 lg:grid lg:grid-cols-[minmax(0,1fr)_300px] print:mt-0 print:block">
        <article className="rounded-2xl bg-surface p-6 shadow-sm sm:p-10 print:rounded-none print:p-0 print:shadow-none">
          <header className="print-block">
            <p className="text-[12px] font-semibold uppercase tracking-[0.14em] text-accent">Itemized security deposit statement</p>
            <h1 className="mt-2 text-[26px] font-semibold leading-tight tracking-[-0.02em]">{s.property.address}</h1>
            <p className="mt-1 text-[13px] text-ink-3">California Civil Code 1950.5(h)</p>
            <dl className="mt-6 grid grid-cols-2 gap-x-6 gap-y-4 text-[14px] sm:grid-cols-3">
              <Field label="From">{s.landlord}</Field>
              <Field label="To">{s.tenants.join(" and ")}</Field>
              <Field label="Moved out">{s.moveOutDate ? longDate(s.moveOutDate) : "Not set"}</Field>
              <Field label="Statement date">{longDate(s.statementDate)}</Field>
              <Field label="Due by">
                {s.statementDue ? longDate(s.statementDue) : "--"}
                {dueLine && <span className={`block text-[12px] ${s.daysLeft! < 0 ? "text-danger" : s.daysLeft! <= 5 ? "text-warn" : "text-ink-3"}`}>{dueLine}</span>}
                {!dueLine && s.delivery && <span className="block text-[12px] text-ink-3">delivered {longDate(s.delivery.date)}</span>}
              </Field>
              <Field label="Deadline">21 days after move-out<span className="block text-[12px] text-ink-3">Civ. Code 1950.5(h)(1)</span></Field>
            </dl>
          </header>

          <Section n={next()} title="Security received" cite="Civ. Code 1950.5(h)(1), (b)">
            {s.security ? (
              <>
                <p className="text-[22px] font-semibold tabular-nums">{usd(s.security.amount)}</p>
                <p className="mt-1 text-[14px] text-ink-2">
                  {s.security.paid
                    ? <>Paid {s.security.paidAt ? `on ${longDate(pacificDate(s.security.paidAt))} ` : ""}by {payMethod(s.security.method)}, PayPal invoice <span className="font-mono text-[12px]">{s.security.invoiceId}</span>.</>
                    : <>PayPal invoice <span className="font-mono text-[12px]">{s.security.invoiceId}</span> is {s.security.invoiceStatus.toLowerCase().replace(/_/g, " ")}, not paid.</>}
                </p>
                {!s.security.live && <p className="mt-1 text-[13px] text-ink-3">PayPal could not be reached just now; the payment is shown as last recorded.</p>}
                {s.security.basisNote && (
                  <p className="mt-3 rounded-xl bg-bg px-4 py-3 text-[13px] leading-relaxed text-ink-2 print:bg-transparent print:px-0 print:py-0">{s.security.basisNote}</p>
                )}
              </>
            ) : (
              <p className="text-[14px] text-ink-2">No security deposit was collected through PayPal for this tenancy.</p>
            )}
          </Section>

          <Section n={next()} title="Deductions" cite="Civ. Code 1950.5(b), (h)(2)">
            {s.deductions.length ? (
              <ol className="divide-y divide-line">
                {s.deductions.map((d) => (
                  <li key={d.id} className="print-block py-5 first:pt-0">
                    <div className="flex flex-wrap items-baseline gap-x-3 gap-y-1">
                      <span className="rounded-full bg-bg px-2.5 py-0.5 text-[12px] font-semibold text-ink-2 print:border print:border-line print:bg-transparent">{d.tag} {d.tagLabel}</span>
                      {d.room && <span className="text-[12px] text-ink-3">{d.room}</span>}
                      <span className="ml-auto text-[15px] font-semibold tabular-nums">{usd(d.amount)}</span>
                    </div>
                    <p className="mt-2 text-[15px] font-semibold">Item {d.n}. {d.item}</p>
                    <p className="mt-1 text-[13px] leading-relaxed text-ink-2">
                      {/* The stored math carries its own label when it is a plain invoice ("Vendor invoice: $140.00"). */}
                      {d.explanation.includes("=") ? <><span className="font-semibold text-ink">Cost: </span>{d.explanation}</> : d.explanation}
                      {d.guidance && <span className="text-ink-3"> (prorated by {d.proration === "useful_life" ? "useful life" : "the paint schedule"}: DRE guidance, not statute)</span>}
                    </p>
                    {d.labor && (
                      <p className="mt-1 text-[13px] leading-relaxed text-ink-2">
                        <span className="font-semibold text-ink">Work by the landlord: </span>
                        {d.labor.description ?? "no description recorded"}. {d.labor.hours ?? "?"} hour{d.labor.hours === 1 ? "" : "s"} at {d.labor.hourlyRate == null ? "an unrecorded rate" : `${usd(d.labor.hourlyRate)} an hour`}.
                      </p>
                    )}
                    {d.vendor && (
                      <p className="mt-1 text-[13px] leading-relaxed text-ink-2">
                        <span className="font-semibold text-ink">Vendor: </span>
                        {[d.vendor.name, d.vendor.address, d.vendor.phone].filter(Boolean).join(", ") || "not recorded"}.{" "}
                        {d.vendor.invoicePath ? (
                          urls.get(`receipts/${d.vendor.invoicePath}`) ? (
                            <>
                              <a href={urls.get(`receipts/${d.vendor.invoicePath}`)!} target="_blank" rel="noreferrer" className="text-info underline print:hidden">Open the invoice</a>
                              <span className="hidden print:inline">Invoice: a copy is in the PDF packet of this statement.</span>
                            </>
                          ) : (
                            <span className="text-warn">Invoice on file, but its file could not be found.</span>
                          )
                        ) : d.isEstimate ? (
                          <span>Estimate; the invoice follows when received.</span>
                        ) : (
                          <span className="text-warn">Invoice not on file.</span>
                        )}
                      </p>
                    )}
                    {d.isEstimate && (
                      <p className="mt-1 text-[13px] leading-relaxed text-warn">
                        Good-faith estimate: the work is not finished or the invoice is not in hand yet. The final cost and documents follow within 14 days of completion or receipt (Civ. Code 1950.5(h)(3)).
                      </p>
                    )}
                    {d.photos.length > 0 && (
                      <div className="mt-3 grid grid-cols-1 gap-2 sm:grid-cols-3 print:grid-cols-3">
                        {d.photos.map((p) => (
                          // The same file may play two roles (a move-in photo reused as the before photo), so the key carries the role.
                          <figure key={`${p.role}-${p.path}`}>
                            {urls.get(`photos/${p.path}`) ? (
                              // eslint-disable-next-line @next/next/no-img-element
                              <img src={urls.get(`photos/${p.path}`)!} alt={`${d.item}, ${p.label}`} className="aspect-[4/3] w-full rounded-lg object-cover" />
                            ) : (
                              <div className="flex aspect-[4/3] w-full items-center justify-center rounded-lg bg-bg text-[12px] text-ink-3">Photo not available</div>
                            )}
                            <figcaption className="mt-1 text-[11px] font-semibold uppercase tracking-[0.1em] text-ink-3">{p.label}</figcaption>
                          </figure>
                        ))}
                      </div>
                    )}
                    {d.missing.length > 0 && <p className="mt-2 text-[13px] text-warn print:hidden">Still needed: {d.missing.join(", ")}.</p>}
                  </li>
                ))}
              </ol>
            ) : (
              <p className="text-[14px] text-ink-2">{s.totals.depositHeld === 0 ? "No deductions." : "No deductions. The whole security is refunded."}</p>
            )}
            <dl className="print-block mt-4 space-y-1.5 border-t-2 border-ink pt-4 text-[14px]">
              <Row label="Security held">{usd(s.totals.depositHeld)}</Row>
              <Row label="Total deductions">{s.totals.deductions ? `-${usd(s.totals.deductions)}` : usd(0)}</Row>
              {s.balanceClaimed ? (
                <Row label="Balance claimed" strong>{usd(s.balanceClaimed.amount)}</Row>
              ) : (
                <Row label={s.refund.state === "sent" ? "Refunded" : "Refund"} strong>{usd(s.refund.amount)}</Row>
              )}
            </dl>
          </Section>

          <Section n={next()} title="Documents" cite={s.documents.required ? "Civ. Code 1950.5(h)(2)" : "Civ. Code 1950.5(h)(4)-(5)"}>
            <p className="text-[14px] leading-relaxed text-ink-2">{s.documents.note}</p>
            {repairs.length > 0 && (
              <>
                {/* What is in hand, said differently on screen and on paper: the paper copy has the photos inline and no invoices. */}
                <p className="mt-2 text-[13px] leading-relaxed text-ink-2 print:hidden">
                  The PDF packet carries the photos for each item and copies of the invoices{s.documents.required ? "" : ", though they are not required"}; the labor records are in the deduction lines.
                </p>
                <p className="mt-2 hidden text-[13px] leading-relaxed text-ink-2 print:block">
                  The photos are printed with each item above. Copies of the invoices are in the PDF packet of this statement.
                </p>
                {invoicesMissing.length > 0 && (
                  <p className="mt-2 text-[13px] leading-relaxed text-warn">
                    Not available: {invoicesMissing.map((d) => `the invoice from ${d.vendor!.name ?? "the vendor"} for item ${d.n} (file not found)`).join("; ")}.
                  </p>
                )}
              </>
            )}
          </Section>

          <Section n={next()} title="Refund" cite="Civ. Code 1950.5(h)(1)(A), (h)(1)(C)">
            <p className="text-[22px] font-semibold tabular-nums">{usd(s.refund.amount)}</p>
            <p className="mt-1 text-[14px] text-ink-2">
              {s.refund.method}
              {s.refund.paypalId && <> (PayPal id <span className="font-mono text-[12px]">{s.refund.paypalId}</span>)</>}
              {s.refund.sentAt && `, sent ${longDate(pacificDate(s.refund.sentAt))}`}
              {s.refund.state !== "none" && "."}
            </p>
            {s.refund.state !== "none" && (
              <p className="mt-1 text-[14px] text-ink-2">
                Payable to {s.refund.payees.join(" and ")}{s.refund.paypalEmail ? <>, PayPal account <span className="font-mono text-[12px]">{s.refund.paypalEmail}</span></> : ""}.
              </p>
            )}
            {s.refund.note && <p className="mt-3 text-[13px] leading-relaxed text-ink-3">{s.refund.note}</p>}
          </Section>

          <Section n={next()} title="Local deposit interest">
            <p className="text-[14px] leading-relaxed text-ink-2">{s.interest.note}</p>
          </Section>

          {s.balanceClaimed && (
            <Section n={next()} title="Balance claimed">
              <p className="text-[22px] font-semibold tabular-nums">{usd(s.balanceClaimed.amount)}</p>
              <p className="mt-1 text-[14px] leading-relaxed text-ink-2">{s.balanceClaimed.text}</p>
            </Section>
          )}

          <Section n={next()} title="Delivery" cite="Civ. Code 1950.5(h)(1)(B), (h)(6)">
            {s.delivery ? (
              <p className="text-[14px] text-ink-2">
                Delivered by {describeDelivery(s.delivery)}{s.delivery.to && s.delivery.method !== "personal" ? `, addressed to ${s.delivery.to}` : ""}.
              </p>
            ) : (
              <p className="text-[14px] text-ink-3">To be recorded when the statement goes out.</p>
            )}
            <div className="print:hidden">
              <DeliveryForm tenancyId={id} tenants={s.tenantContacts} unitAddress={s.property.address} today={s.today} existing={s.delivery} forwarding={s.tenantForwarding} />
            </div>
          </Section>

          <footer className="mt-10 space-y-2 border-t border-line pt-5 text-[11px] leading-relaxed text-ink-3">
            <p className="hidden print:block">Prepared with Deposit Agent from the landlord&apos;s records, under California Civil Code 1950.5 and published state guidance. It is not legal advice.</p>
            <p>{DISCLAIMERS[1]}</p>
            <p>{DISCLAIMERS[3]}</p>
            <div className="space-y-2 print:hidden">
              <p>{DISCLAIMERS[0]}</p>
              <p>{DISCLAIMERS[2]}</p>
            </div>
          </footer>
        </article>

        <aside className="mt-8 lg:mt-0 print:hidden">
          <div className="rounded-2xl bg-surface p-5 shadow-sm lg:sticky lg:top-6 lg:max-h-[calc(100vh-3rem)] lg:overflow-y-auto">
            <p className="text-[12px] font-semibold uppercase tracking-[0.12em] text-ink-3">Completeness</p>
            <p className="mt-1 text-[24px] font-semibold tracking-[-0.01em]">{done} of {applicable}</p>
            <p className="text-[13px] text-ink-2">
              items that apply are in place{applicable < s.checklist.length ? `; ${s.checklist.length - applicable} don't apply here` : ""}.
              The 13 items of the rules spec&apos;s statement checklist: Civ. Code 1950.5(h), local deposit-interest ordinances and DRE guidance.
            </p>
            <ol className="mt-4 space-y-3">
              {s.checklist.map((c) => (
                <li key={c.n} className="flex gap-3">
                  <span className={`mt-1.5 h-2 w-2 shrink-0 rounded-full ${c.state === "done" ? "bg-accent" : c.state === "missing" ? "bg-warn" : "bg-line"}`} />
                  <div className="min-w-0">
                    <p className="text-[13px] font-semibold leading-snug">{c.n}. {c.title}</p>
                    <p className="mt-0.5 text-[12px] leading-snug text-ink-2">{c.reason}</p>
                    <p className="mt-0.5 text-[11px] text-ink-3">{STATE[c.state]} · {cite(c.cite)}</p>
                  </div>
                </li>
              ))}
            </ol>
          </div>
        </aside>
      </div>
    </main>
  );
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div>
      <dt className="text-[11px] font-semibold uppercase tracking-[0.1em] text-ink-3">{label}</dt>
      <dd className="mt-0.5 leading-snug">{children}</dd>
    </div>
  );
}

// No print-block on the section: Deductions is taller than a page, and keeping it whole left page 1 half empty.
function Section({ n, title, cite, children }: { n: number; title: string; cite?: string; children: React.ReactNode }) {
  return (
    <section className="mt-8 border-t border-line pt-6">
      <div className="flex flex-wrap items-baseline gap-3">
        <h2 className="text-[16px] font-semibold">{n}. {title}</h2>
        {cite && <span className="ml-auto text-[12px] text-ink-3">{cite}</span>}
      </div>
      <div className="mt-3">{children}</div>
    </section>
  );
}

function Row({ label, strong, children }: { label: string; strong?: boolean; children: React.ReactNode }) {
  return (
    <div className={`flex justify-between gap-4 ${strong ? "text-[16px] font-semibold" : "text-ink-2"}`}>
      <dt>{label}</dt>
      <dd className="tabular-nums">{children}</dd>
    </div>
  );
}

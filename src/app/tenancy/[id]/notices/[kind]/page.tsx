import Link from "next/link";
import { notFound } from "next/navigation";
import { longDate, pacificToday } from "@/lib/dates";
import { statementDue } from "@/lib/deductions";
import { wasPaid } from "@/lib/invoice-status";
import { ABANDONED_PROPERTY_TEXT, INSPECTION_NOTICE_HOURS, inspectionWindowOpens, kindFromSlug, NOTICE_INFO } from "@/lib/notices";
import { DISCLAIMERS } from "@/lib/statement";
import { loadUnit } from "@/lib/units";
import { NoticeGivenForm } from "../../notice-given-form";
import { PrintButton } from "./print-button";

export const dynamic = "force-dynamic";

// A printable draft of one notice, filled from the tenancy's own dates and nothing else. Section F of the rules spec:
// the page presents the statute's terms and the facts on file; the landlord completes it, prints it and records how it
// went out. Blanks are left where the file has no date.

const Blank = ({ w = "w-40" }: { w?: string }) => <span className={`inline-block ${w} border-b border-ink align-baseline`}>&nbsp;</span>;

export default async function NoticePage({ params }: PageProps<"/tenancy/[id]/notices/[kind]">) {
  const { id, kind: slug } = await params;
  const kind = kindFromSlug(slug);
  if (!kind) notFound();
  const t = await loadUnit(id);
  if (!t) notFound();

  const today = pacificToday();
  const info = NOTICE_INFO[kind];
  const given = t.notices[kind] ?? null;
  const date = given?.date ?? today;
  // The notice goes out before the move-out, so it speaks to the planned end, or the lease end when no notice is recorded.
  const ends = t.plannedMoveOut ?? t.endDate;
  const windowOpens = ends ? inspectionWindowOpens(ends) : null;
  const landlord = t.landlord ?? "The landlord";
  const tenants = t.tenants.join(" and ") || "Tenant";
  // The electronic payment the draft can state as a fact: only the PayPal deposit this tool recorded. Rent by Zelle,
  // card or a portal outside it is a blank the landlord completes (section F: facts on file, not conclusions).
  const electronicDeposit = t.depositElectronic && t.deposit && wasPaid(t.deposit.status) ? t.deposit : null;

  const context = t.noticeGivenOn
    ? <>Notice to end your tenancy at {t.address} was given on {longDate(t.noticeGivenOn)}{ends ? <>, and the tenancy ends on <b>{longDate(ends)}</b></> : null}.</>
    : t.endDate
      ? <>Your lease at {t.address} ends on <b>{longDate(t.endDate)}</b>.</>
      : <>Your tenancy at {t.address} is ending on <Blank />.</>;

  return (
    <main className="mx-auto w-full max-w-5xl px-5 py-8 print:max-w-none print:p-0">
      <nav className="flex flex-wrap items-center gap-3 print:hidden">
        <Link href={`/tenancy/${id}`} className="text-[13px] font-semibold text-ink-2 hover:text-ink">Back to the tenancy</Link>
        <div className="ml-auto"><PrintButton /></div>
      </nav>

      <div className="mt-4 gap-8 lg:grid lg:grid-cols-[minmax(0,1fr)_300px] print:mt-0 print:block">
        <article className="rounded-2xl bg-surface p-6 shadow-sm sm:p-10 print:rounded-none print:p-0 print:shadow-none">
          <header className="print-block">
            <p className="text-[12px] font-semibold uppercase tracking-[0.14em] text-accent">Notice to tenant</p>
            <h1 className="mt-2 text-[26px] font-semibold leading-tight tracking-[-0.02em]">{info.title}</h1>
            <p className="mt-1 text-[13px] text-ink-3">California {info.cite.replace("Civ. Code", "Civil Code section")}</p>
            <dl className="mt-6 grid grid-cols-2 gap-x-6 gap-y-4 text-[14px] sm:grid-cols-4">
              <Field label="From">{landlord}</Field>
              <Field label="To">{tenants}</Field>
              <Field label="Property">{t.address}</Field>
              <Field label="Date">{longDate(date)}</Field>
            </dl>
          </header>

          <div className="mt-8 space-y-4 text-[15px] leading-relaxed text-ink">
            <p>{tenants}:</p>
            <p>{context}</p>

            {kind === "inspection" ? (
              <>
                <p>
                  Under California Civil Code section 1950.5(f), you have the option to request an initial inspection of the unit before
                  the tenancy ends, and the right to be present at it. The purpose of the inspection is to identify anything that would
                  otherwise be deducted from your security deposit, so that you have the chance to fix it before you move out.
                </p>
                <p>
                  <b>To request an inspection,</b> tell {landlord} in writing or by phone at <Blank w="w-56" />. We will try to schedule it
                  at a date and time that works for both of us. The inspection can take place no earlier than two weeks before the tenancy
                  ends{windowOpens && ends ? <>: on or after <b>{longDate(windowOpens)}</b> for a {longDate(ends)} move-out</> : null}.
                </p>
                <p>
                  You will receive at least {INSPECTION_NOTICE_HOURS} hours&apos; written notice of the date and time of the inspection, unless
                  you and the landlord both sign a written waiver of that notice. The inspection goes ahead whether or not you are present,
                  unless you withdraw your request first.
                </p>
                <p>
                  After the inspection you will receive an itemized statement of any repairs or cleaning proposed as deductions from your
                  security deposit, with the text of Civil Code section 1950.5(b)(1) to (4). You then have until the tenancy ends to fix
                  those items.
                </p>
                <p>
                  If you choose not to request an inspection, none is held before you move out and the landlord&apos;s duties under
                  subdivision (f) are discharged. The move-out photographs and the itemized statement due within 21 calendar days after you
                  vacate still apply.
                </p>
                <figure className="print-block rounded-xl border border-line bg-bg px-5 py-4 print:bg-transparent">
                  <figcaption className="text-[11px] font-semibold uppercase tracking-[0.1em] text-ink-3">Required by Civil Code section 1950.5(f)(1)</figcaption>
                  <blockquote className="mt-2 text-[14px] leading-relaxed">&ldquo;{ABANDONED_PROPERTY_TEXT}&rdquo;</blockquote>
                </figure>
              </>
            ) : (
              <>
                <p>
                  {electronicDeposit
                    ? <>Your security deposit of ${electronicDeposit.amount.toLocaleString("en-US", { minimumFractionDigits: 2 })} was received electronically, through PayPal invoice <span className="font-mono text-[13px]">{electronicDeposit.paypalId}</span>. Because the landlord received the security deposit electronically, </>
                    : <>The landlord received your <Blank w="w-40" /> (security deposit or rent) electronically by <Blank w="w-40" /> on <Blank w="w-32" />. Because the landlord received the security deposit or rent electronically, </>}
                  California Civil Code section 1950.5(h)(1)(A) gives you the right to receive the remainder of your security deposit
                  electronically: to a bank account or other financial institution you designate in writing, or by any electronic or virtual
                  method available to the landlord, such as PayPal, if you agree to it in writing.
                </p>
                <p>
                  You and the landlord may instead agree in writing on another method of return, including personal delivery or a check
                  made payable to you and mailed by first-class mail to an address you provide.
                </p>
                <p>
                  The remainder of the security deposit and an itemized statement of any deductions are due no later than 21 calendar days
                  after you vacate{ends ? <>; for a {longDate(ends)} move-out, that is {longDate(statementDue(ends))}</> : null} (Civil Code section 1950.5(h)(1)).
                </p>
                {t.tenants.length > 1 && (
                  <p>
                    With more than one adult tenant on the lease, the remainder is returned in one payment to all adult tenants unless every
                    adult and the landlord sign a written agreement that says how it is divided (Civil Code section 1950.5(h)(1)(C)).
                  </p>
                )}
              </>
            )}
          </div>

          <div className="print-block mt-10 grid grid-cols-1 gap-8 text-[14px] sm:grid-cols-2">
            <div>
              <p className="border-b border-ink pb-8" />
              <p className="mt-1 text-[12px] text-ink-3">{landlord}, landlord</p>
            </div>
            <div>
              <p className="border-b border-ink pb-8" />
              <p className="mt-1 text-[12px] text-ink-3">Date</p>
            </div>
          </div>

          <section className="print-block mt-10 rounded-xl border border-line p-5">
            <p className="text-[12px] font-semibold uppercase tracking-[0.1em] text-ink-3">Tenant&apos;s response (optional)</p>
            {kind === "inspection" ? (
              <ul className="mt-3 space-y-3 text-[14px]">
                <li className="flex gap-3"><Box />I request an initial inspection. Dates and times that work for me: <Blank w="w-64" /></li>
                <li className="flex gap-3"><Box />I do not request an initial inspection.</li>
              </ul>
            ) : (
              <ul className="mt-3 space-y-3 text-[14px]">
                <li className="flex gap-3"><Box /><span>Return my deposit electronically to the bank account or financial institution I designate in writing (details provided separately).</span></li>
                <li className="flex gap-3"><Box /><span>I agree in writing to an electronic return by PayPal to: <Blank w="w-64" /></span></li>
                <li className="flex gap-3"><Box /><span>Another method agreed with the landlord in writing: <Blank w="w-64" /></span></li>
              </ul>
            )}
            <div className="mt-6 grid grid-cols-1 gap-8 text-[14px] sm:grid-cols-2">
              <div><p className="border-b border-ink pb-6" /><p className="mt-1 text-[12px] text-ink-3">Tenant signature</p></div>
              <div><p className="border-b border-ink pb-6" /><p className="mt-1 text-[12px] text-ink-3">Date</p></div>
            </div>
          </section>

          <footer className="mt-10 border-t border-line pt-5 text-[11px] leading-relaxed text-ink-3">
            <p>Prepared with Deposit Agent from the landlord&apos;s records as a template under California Civil Code 1950.5, completed at the landlord&apos;s direction. It is not legal advice.</p>
          </footer>
        </article>

        <aside className="mt-8 lg:mt-0 print:hidden">
          <div className="rounded-2xl bg-surface p-5 shadow-sm lg:sticky lg:top-6">
            <p className="text-[12px] font-semibold uppercase tracking-[0.12em] text-ink-3">Status</p>
            <p className="mt-2 text-[14px] leading-relaxed text-ink-2">
              {given ? "Given. The record is below; the page prints as the copy that went out." : "Draft. Print it, complete the blanks, and record below how and when it went out."}
            </p>
            {kind === "electronic_refund" && (
              <p className={`mt-3 rounded-xl px-3 py-2.5 text-[13px] leading-relaxed ${t.refundNotice.needed === false ? "bg-accent-soft text-ink-2" : t.refundNotice.needed ? "bg-warn-soft text-ink-2" : "bg-bg text-ink-2"}`}>
                <b className="text-ink">{t.refundNotice.needed === false ? "Already covered. " : t.refundNotice.needed ? "Required. " : "Check whether it applies. "}</b>
                {t.refundNotice.reason}
              </p>
            )}
            {kind === "inspection" && !t.noticeGivenOn && (
              <p className="mt-3 rounded-xl bg-bg px-3 py-2.5 text-[13px] leading-relaxed text-ink-2">
                No notice to end the tenancy is recorded yet. (f)(1) calls for this notice within a reasonable time after either party gives
                notice, or before the end of the lease term.
              </p>
            )}
            <div className="mt-4">
              <NoticeGivenForm tenancyId={id} kind={kind} tenants={t.tenants} today={today} given={given} />
            </div>
            <p className="mt-5 text-[11px] leading-relaxed text-ink-3">{DISCLAIMERS[2]}</p>
          </div>
        </aside>
      </div>
    </main>
  );
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="min-w-0">
      <dt className="text-[11px] font-semibold uppercase tracking-[0.1em] text-ink-3">{label}</dt>
      <dd className="mt-0.5 leading-snug">{children}</dd>
    </div>
  );
}

const Box = () => <span className="mt-0.5 inline-block h-4 w-4 shrink-0 rounded-sm border border-ink" />;

import Link from "next/link";
import { notFound } from "next/navigation";
import { longDate, pacificToday } from "@/lib/dates";
import { db } from "@/lib/db";
import { statementDue, usd } from "@/lib/deductions";
import { wasPaid } from "@/lib/invoice-status";
import { dueOf, packOf } from "@/lib/next-step";
import { ABANDONED_PROPERTY_TEXT, inspectionWindowCloses, inspectionWindowOpens, kindFromSlug, recordFor } from "@/lib/notices";
import type { DraftBlock, RecordDef, StatePack } from "@/lib/states/types";
import { loadUnit } from "@/lib/units";
import { pageTenancy } from "@/lib/workspace";
import { Icon } from "@/components/icons";
import { InfoTip } from "@/components/info-tip";
import { Card, CardHead, StatusChip } from "@/components/ui";
import { streetLine } from "@/lib/ledger";
import { NoticeGivenForm } from "../../notice-given-form";
import { PrintButton } from "./print-button";

export const dynamic = "force-dynamic";

// A printable draft of one notice, filled from the tenancy's own dates and nothing else, or the page of a record the
// state's pack asks for (a checklist signed, the account a deposit is held in, a forwarding address received). Section
// F of the rules spec: the page presents the statute's terms and the facts on file; the landlord completes it, prints
// it and records how it went out. Blanks are left where the file has no date. California's two notices are the
// drafts below (they have no draft body in the pack); every other record's page is built from its pack entry.

const Blank = ({ w = "w-40" }: { w?: string }) => <span className={`inline-block ${w} border-b border-ink align-baseline`}>&nbsp;</span>;

export default async function NoticePage({ params }: PageProps<"/tenancy/[id]/notices/[kind]">) {
  const { id, kind: slug } = await params;
  await pageTenancy(id);
  const t = await loadUnit(id);
  if (!t) notFound();
  const pack = packOf(t);
  const kind = kindFromSlug(slug, pack);
  const info = kind ? recordFor(pack, kind) : null;
  if (!kind || !info) notFound();

  const today = pacificToday();
  const given = t.notices[kind] ?? null;
  const date = given?.date ?? today;
  // The notice goes out before the move-out, so it speaks to the planned end, or the lease end when no notice is recorded.
  const ends = t.plannedMoveOut ?? t.endDate;
  const windowOpens = ends ? inspectionWindowOpens(ends, pack) : null;
  // A record with its own draft body, or none to print, is the pack's page; California's two notices, drafted before the
  // packs, keep the page below.
  if (info.draftBody || !info.draft) {
    return <PackRecordPage id={id} t={t} pack={pack} def={info} today={today} />;
  }
  const INSPECTION_NOTICE_HOURS = pack.notices.inspection?.noticeHours ?? 48;
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
    <div className="w-full print:max-w-none">
      <nav className="flex items-center gap-3 print:hidden">
        <Link href={`/tenancy/${id}?tab=move-out#notice`} aria-label="Back to the property"
          className="inline-flex size-8 shrink-0 items-center justify-center rounded-full border border-line text-ink-2 hover:bg-surface">
          <Icon name="arrow-left" className="size-[15px]" />
        </Link>
        <div className="min-w-0 flex-1">
          <h1 className="text-xl font-medium">{info.short.charAt(0).toUpperCase() + info.short.slice(1)}</h1>
          <p className="truncate text-sm text-ink-3">{streetLine(t.address)}</p>
        </div>
        <PrintButton />
      </nav>

      <div className="mt-4 flex flex-col gap-6 lg:grid lg:grid-cols-[minmax(0,1fr)_300px] lg:gap-8 print:mt-0 print:block">
        <article className="rounded-lg border border-line bg-canvas p-6 shadow-sm sm:p-10 print:rounded-none print:border-0 print:p-0 print:shadow-none">
          <header className="print-block">
            <p className="text-xs font-medium text-ink-3">Notice to tenant</p>
            <h2 className="mt-2 text-xl font-medium">{info.title}</h2>
            <p className="mt-1 text-sm text-ink-3">California {info.cite.replace("Civ. Code", "Civil Code section")}</p>
            <dl className="mt-6 grid grid-cols-2 gap-x-6 gap-y-4 text-base sm:grid-cols-4">
              <Field label="From">{landlord}</Field>
              <Field label="To">{tenants}</Field>
              <Field label="Property">{t.address}</Field>
              <Field label="Date">{longDate(date)}</Field>
            </dl>
          </header>

          <div className="mt-8 space-y-4 text-base text-ink">
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
                <figure className="print-block rounded-md border border-line bg-surface px-5 py-4 print:bg-transparent">
                  <figcaption className="text-xs font-medium text-ink-3">Required by Civil Code section 1950.5(f)(1)</figcaption>
                  <blockquote className="mt-2 text-base">&ldquo;{ABANDONED_PROPERTY_TEXT}&rdquo;</blockquote>
                </figure>
              </>
            ) : (
              <>
                <p>
                  {electronicDeposit
                    ? <>Your security deposit of ${electronicDeposit.amount.toLocaleString("en-US", { minimumFractionDigits: 2 })} was received electronically, through PayPal invoice <span className=" text-sm">{electronicDeposit.paypalId}</span>. Because the landlord received the security deposit electronically, </>
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
                  after you vacate{ends ? <>; for a {longDate(ends)} move-out, that is {longDate(statementDue(ends, pack))}</> : null} (Civil Code section 1950.5(h)(1)).
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

          <div className="print-block mt-10 grid grid-cols-1 gap-8 text-base sm:grid-cols-2">
            <div>
              <p className="border-b border-ink pb-8" />
              <p className="mt-1 text-xs text-ink-3">{landlord}, landlord</p>
            </div>
            <div>
              <p className="border-b border-ink pb-8" />
              <p className="mt-1 text-xs text-ink-3">Date</p>
            </div>
          </div>

          <section className="print-block mt-10 rounded-md border border-line p-5">
            <p className="text-xs font-medium text-ink-3">Tenant&apos;s response (optional)</p>
            {kind === "inspection" ? (
              <ul className="mt-3 space-y-3 text-base">
                <li className="flex gap-3"><Box />I request an initial inspection. Dates and times that work for me: <Blank w="w-64" /></li>
                <li className="flex gap-3"><Box />I do not request an initial inspection.</li>
              </ul>
            ) : (
              <ul className="mt-3 space-y-3 text-base">
                <li className="flex gap-3"><Box /><span>Return my deposit electronically to the bank account or financial institution I designate in writing (details provided separately).</span></li>
                <li className="flex gap-3"><Box /><span>I agree in writing to an electronic return by PayPal to: <Blank w="w-64" /></span></li>
                <li className="flex gap-3"><Box /><span>Another method agreed with the landlord in writing: <Blank w="w-64" /></span></li>
              </ul>
            )}
            <div className="mt-6 grid grid-cols-1 gap-8 text-base sm:grid-cols-2">
              <div><p className="border-b border-ink pb-6" /><p className="mt-1 text-xs text-ink-3">Tenant signature</p></div>
              <div><p className="border-b border-ink pb-6" /><p className="mt-1 text-xs text-ink-3">Date</p></div>
            </div>
          </section>

          <footer className="mt-10 border-t border-line pt-5 text-xs text-ink-3">
            <p>{pack.copy.noticeFooter}</p>
          </footer>
        </article>

        <aside className="max-lg:order-first print:hidden">
          <Card className="lg:sticky lg:top-20">
            <CardHead title="Status" right={given ? <StatusChip tone="green">Given</StatusChip> : <StatusChip tone="amber">Draft</StatusChip>} />
            <div className="flex flex-col gap-3 px-5 py-4">
              <p className="flex items-center gap-1.5 text-sm text-ink-2">
                {given ? "Prints as the copy that went out" : "Print it, fill the blanks, then mark it given"}
                <InfoTip align="end" title="You decide">{pack.copy.disclaimers[2]}</InfoTip>
              </p>
              {kind === "electronic_refund" && (
                <p className="flex items-center gap-1.5 text-sm">
                  <span className={`size-2 shrink-0 rounded-full ${t.refundNotice.needed === false ? "bg-green-dot" : t.refundNotice.needed ? "bg-amber-dot" : "bg-ink-4"}`} />
                  {t.refundNotice.needed === false ? "Already covered" : t.refundNotice.needed ? "Required" : "Check whether it applies"}
                  <InfoTip align="end" title={info.title} cite={info.cite}>{t.refundNotice.reason}</InfoTip>
                </p>
              )}
              {kind === "inspection" && !t.noticeGivenOn && (
                <p className="flex items-center gap-1.5 text-sm">
                  <span className="size-2 shrink-0 rounded-full bg-ink-4" />
                  No notice to end the tenancy yet
                  <InfoTip align="end" title="When this notice is due" cite={info.cite}>{info.tip}</InfoTip>
                </p>
              )}
              <NoticeGivenForm tenancyId={id} state={pack.code} kind={kind} tenants={t.tenants} today={today} given={given} />
            </div>
          </Card>
        </aside>
      </div>
    </div>
  );
}

/** A state pack's own record or notice: its draft from the pack when it has one, else what the law asks for and the
 *  form that records it. */
async function PackRecordPage({ id, t, pack, def, today }: { id: string; t: NonNullable<Awaited<ReturnType<typeof loadUnit>>>; pack: StatePack; def: RecordDef; today: string }) {
  const given = t.notices[def.kind] ?? null;
  const ends = t.plannedMoveOut ?? t.endDate;
  // A claim notice states what is claimed: the deductions on file, in the statement's words.
  const { data: rows } = def.kind === "claim_notice"
    ? await db.from("deductions").select("item, room, amount").eq("tenancy_id", id).order("created_at")
    : { data: [] as { item: string; room: string | null; amount: number | string }[] };
  const claim = rows?.length ? { total: rows.reduce((n, r) => n + Number(r.amount), 0), items: rows.map((r) => `${r.item}${r.room ? ` (${r.room})` : ""}, ${usd(Number(r.amount))}`) } : null;
  const landlord = t.landlord ?? "The landlord";
  const blocks = def.draftBody?.({
    landlord, tenants: t.tenants.join(" and ") || "Tenant", address: t.address, today,
    noticeGivenOn: t.noticeGivenOn, endDate: t.endDate, ends,
    windowOpens: ends ? inspectionWindowOpens(ends, pack) : null, windowCloses: ends ? inspectionWindowCloses(ends, pack) : null,
    due: dueOf(t), deposit: t.deposit && wasPaid(t.deposit.status) ? { amount: t.deposit.amount, paypalId: t.deposit.paypalId } : null,
    claim, multipleTenants: t.tenants.length > 1,
  }) ?? null;
  const title = def.short.charAt(0).toUpperCase() + def.short.slice(1);
  const status = def.status?.(t.notices) ?? null; // e.g. whether a Florida objection came in time
  return (
    <div className="w-full print:max-w-none">
      <nav className="flex items-center gap-3 print:hidden">
        <Link href={`/tenancy/${id}${def.phase === "move_in" ? "#move-in" : "?tab=move-out#notice"}`} aria-label="Back to the property"
          className="inline-flex size-8 shrink-0 items-center justify-center rounded-full border border-line text-ink-2 hover:bg-surface">
          <Icon name="arrow-left" className="size-[15px]" />
        </Link>
        <div className="min-w-0 flex-1">
          <h1 className="text-xl font-medium">{title}</h1>
          <p className="truncate text-sm text-ink-3">{streetLine(t.address)}</p>
        </div>
        {blocks && <PrintButton />}
      </nav>

      <div className="mt-4 flex flex-col gap-6 lg:grid lg:grid-cols-[minmax(0,1fr)_300px] lg:gap-8 print:mt-0 print:block">
        {blocks ? (
          <article className="rounded-lg border border-line bg-canvas p-6 shadow-sm sm:p-10 print:rounded-none print:border-0 print:p-0 print:shadow-none">
            <header className="print-block">
              <p className="text-xs font-medium text-ink-3">Notice to tenant</p>
              <h2 className="mt-2 text-xl font-medium">{def.title}</h2>
              <p className="mt-1 text-sm text-ink-3">{def.heading ?? def.cite}</p>
              <dl className="mt-6 grid grid-cols-2 gap-x-6 gap-y-4 text-base sm:grid-cols-4">
                <Field label="From">{landlord}</Field>
                <Field label="To">{t.tenants.join(" and ") || "Tenant"}</Field>
                <Field label="Property">{t.address}</Field>
                <Field label="Date">{longDate(given?.date ?? today)}</Field>
              </dl>
            </header>
            <div className="mt-8 space-y-4 text-base text-ink">
              <p>{t.tenants.join(" and ") || "Tenant"}:</p>
              {blocks.map((b, i) => <Block key={i} b={b} />)}
            </div>
            <div className="print-block mt-10 grid grid-cols-1 gap-8 text-base sm:grid-cols-2">
              <div><p className="border-b border-ink pb-8" /><p className="mt-1 text-xs text-ink-3">{landlord}, landlord</p></div>
              <div><p className="border-b border-ink pb-8" /><p className="mt-1 text-xs text-ink-3">Date</p></div>
            </div>
            {def.response && (
              <section className="print-block mt-10 rounded-md border border-line p-5">
                <p className="text-xs font-medium text-ink-3">Tenant&apos;s response (optional)</p>
                <ul className="mt-3 space-y-3 text-base">
                  {def.response.map((r) => <li key={r} className="flex gap-3"><Box /><span><Filled text={r} /></span></li>)}
                </ul>
                <div className="mt-6 grid grid-cols-1 gap-8 text-base sm:grid-cols-2">
                  <div><p className="border-b border-ink pb-6" /><p className="mt-1 text-xs text-ink-3">Tenant signature</p></div>
                  <div><p className="border-b border-ink pb-6" /><p className="mt-1 text-xs text-ink-3">Date</p></div>
                </div>
              </section>
            )}
            <footer className="mt-10 border-t border-line pt-5 text-xs text-ink-3">
              <p>{pack.copy.noticeFooter}</p>
            </footer>
          </article>
        ) : (
          <Card>
            <CardHead title={def.title} />
            <div className="flex flex-col gap-3 px-5 py-4 text-base text-ink-2">
              <p>{def.tip}</p>
              {def.when && <p className="text-sm text-ink-3">{def.when}</p>}
              <p className="text-xs text-ink-3">{def.cite}. {pack.copy.disclaimers[2]}</p>
            </div>
          </Card>
        )}

        <aside className="max-lg:order-first print:hidden">
          <Card className="lg:sticky lg:top-20">
            <CardHead title="Status" right={given ? <StatusChip tone="green">{def.verb}</StatusChip> : <StatusChip tone="amber">{blocks ? "Draft" : "Not recorded"}</StatusChip>} />
            <div className="flex flex-col gap-3 px-5 py-4">
              <p className="flex items-center gap-1.5 text-sm text-ink-2">
                {given ? (blocks ? "Prints as the copy that went out" : "On record") : blocks ? `Print it, fill the blanks, then mark it ${def.verb.toLowerCase()}` : def.verb === "Received" ? "Record it once it arrives" : "Record it once it is done"}
                <InfoTip align="end" title={def.title} cite={def.cite}>{def.when ?? def.tip}</InfoTip>
              </p>
              {status && (
                <p className="flex items-start gap-1.5 text-sm text-ink-2">
                  <span className={`mt-1.5 size-2 shrink-0 rounded-full ${status.tone === "green" ? "bg-green-dot" : status.tone === "red" ? "bg-red-dot" : "bg-amber-dot"}`} />
                  {status.text}
                </p>
              )}
              <NoticeGivenForm tenancyId={id} state={pack.code} kind={def.kind} tenants={t.tenants} today={today} given={given} />
            </div>
          </Card>
        </aside>
      </div>
    </div>
  );
}

/** The widths a draft's blank may take, spelled out so the stylesheet has each one. */
const BLANK_W: Record<string, string> = { "w-24": "w-24", "w-32": "w-32", "w-40": "w-40", "w-56": "w-56", "w-64": "w-64", "w-72": "w-72", "w-full": "w-full" };

/** A paragraph with its blanks: "[[blank]]" or "[[blank:w-56]]" prints a line to fill in by hand. */
function Filled({ text }: { text: string }) {
  const parts = text.split(/(\[\[blank(?::[\w-]+)?\]\])/);
  return <>{parts.map((x, i) => {
    const m = x.match(/^\[\[blank(?::([\w-]+))?\]\]$/);
    return m ? <Blank key={i} w={BLANK_W[m[1] ?? ""] ?? "w-40"} /> : <span key={i}>{x}</span>;
  })}</>;
}

function Block({ b }: { b: DraftBlock }) {
  if ("quote" in b) {
    return (
      <figure className="print-block rounded-md border border-line bg-surface px-5 py-4 print:bg-transparent">
        <figcaption className="text-xs font-medium text-ink-3">{b.caption}</figcaption>
        <blockquote className="mt-2 whitespace-pre-line text-base"><Filled text={b.quote} /></blockquote>
      </figure>
    );
  }
  if ("list" in b) return <ul className="list-disc space-y-1 pl-5">{b.list.map((x) => <li key={x}><Filled text={x} /></li>)}</ul>;
  return <p><Filled text={b.p} /></p>;
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="min-w-0">
      <dt className="text-xs font-medium text-ink-3">{label}</dt>
      <dd className="mt-0.5">{children}</dd>
    </div>
  );
}

const Box = () => <span className="mt-0.5 inline-block h-4 w-4 shrink-0 rounded-sm border border-ink" />;

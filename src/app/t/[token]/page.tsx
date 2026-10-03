import type { Metadata } from "next";
import { notFound } from "next/navigation";
import type { ReactNode } from "react";
import { buttonClass } from "@/components/button";
import { CopyId } from "@/components/copy-id";
import { Icon } from "@/components/icons";
import { InfoTip, TipLabel } from "@/components/info-tip";
import { Money } from "@/components/ui";
import { displayName, maskEmail } from "@/lib/copy";
import { longDate, pacificDate, shortDate } from "@/lib/dates";
import { returnCompleted, returnFailed } from "@/lib/invoice-status";
import { streetLine } from "@/lib/ledger";
import { keepUnit } from "@/lib/property-view";
import { SANDBOX } from "@/lib/paypal";
import { packFor } from "@/lib/states/server";
import type { StatePack } from "@/lib/states/types";
import { describeDelivery, type DeliveryRecord } from "@/lib/statement";
import { resolveTenantToken } from "@/lib/tenant-links";
import { loadTenantView, type TenantDeduction, type TenantView } from "@/lib/tenant-view";
import { MovingOutForm } from "./moving-out-form";

export const dynamic = "force-dynamic";

// A private page, so not for search engines, and the token in its address is sent to no other site.
export const metadata: Metadata = { title: "Your security deposit", robots: { index: false, follow: false }, referrer: "no-referrer" };

// The tenants' own page, opened with the link their landlord gave them. Airbnb's refund status for the top (the amount,
// one status line, a progress bar), then one-line Details rows, the deductions in the statement's numbering, the
// timeline, the statement to download and where to take a question. Every fact comes from loadTenantView, which names
// its columns; nothing here reaches the landlord's lease flags, activity log or agent runs, and no address on this page
// carries the tenancy id. Section F of the rules spec: the statute's terms and the facts on file, never advice, and
// every rule and citation sits behind an info tip.


const words = (status: string) => status.toLowerCase().replace(/_/g, " ");
const payMethod = (m: string | null) => (!m || m === "PAYPAL" ? "PayPal" : words(m).replace(/^./, (c) => c.toUpperCase()));
const capFirst = (s: string) => s.charAt(0).toUpperCase() + s.slice(1);
const lowerFirst = (s: string) => s.charAt(0).toLowerCase() + s.slice(1);

export default async function TenantPage({ params }: PageProps<"/t/[token]">) {
  const { token } = await params;
  const link = await resolveTenantToken(token);
  if (!link) notFound();
  const v = await loadTenantView(link.tenancyId);
  if (!v) notFound();

  // The law of the state the unit is in: its pack's rules, deadline and citations (California's LEGAL_RULES source S7
  // is the courts' guide, where disputes go).
  const pack = packFor(v.state);
  const COURTS_GUIDE = pack.courtsGuide.url;
  const st = v.statement;
  const pdf = `/api/t/${token}/statement.pdf`;
  const stand = standing(v, pack);
  const steps = v.moveOutDate || st ? progress(v) : null;
  const photosFrom = pack.moveIn.photosFrom;
  const moveInPhotosRequired = !!photosFrom && !!v.startDate && v.startDate >= photosFrom;
  const rooms = [...new Set(v.photos.map((p) => p.room))];
  const landlord = v.landlord ? displayName(v.landlord) : "Your landlord";

  return (
    <div className="min-h-screen bg-canvas">
      <header className="border-b border-line print:hidden">
        <div className="mx-auto flex h-[52px] w-full max-w-[600px] items-center gap-3 px-5">
          <span className="min-w-0 truncate text-base font-medium">{landlord}</span>
          {/* The sandbox in plain text, not a chip: the landlord's Test mode switch is where it is shown in full. */}
          {SANDBOX && <span title="PayPal sandbox: no real money moves" className="ml-auto shrink-0 text-xs text-ink-3">Sandbox</span>}
        </div>
      </header>

      <main className="mx-auto w-full max-w-[600px] px-5 pb-10 pt-6 sm:pt-10">
        <h1 className="text-xl font-medium">{v.moveOutDate || st ? "Your deposit refund" : "Your security deposit"}</h1>
        <p className="mt-0.5 text-sm text-ink-3">{keepUnit(streetLine(v.address))}</p>
        <p className="mt-0.5 text-xs text-ink-3">{pack.name} law applies: {pack.statute.short}</p>

        {/* Where things stand: the one hero number, one status line, one sentence. */}
        <section aria-label="Where things stand" className="mt-6">
          <p className="text-sm text-ink-3">{stand.label}</p>
          {stand.amount != null && <Money value={stand.amount} className="mt-0.5 block text-2xl font-medium" />}
          <p className="mt-1.5 flex items-center gap-2 text-lg font-medium">
            <StatusMark tone={stand.tone} />
            {stand.title}
          </p>
          {stand.line && <p className="mt-1.5 text-ink-2">{stand.line}</p>}
          {stand.pay && (
            <a href={stand.pay} target="_blank" rel="noreferrer" className={buttonClass("primary", "lg", "mt-4 h-11 w-full")}>
              Pay deposit with PayPal<Icon name="arrow-up-right" />
            </a>
          )}
          {steps && <Progress steps={steps} />}
        </section>

        <Section title="Details" info={<InfoTip align="end" title={pack.tenant.detailsTip.title} cite={pack.tenant.detailsTip.cite}>
          {pack.tenant.detailsTip.text}
          {v.deposit?.invoiceId && !st && <span className="mt-1.5 block text-white/70">PayPal invoice {v.deposit.invoiceId}</span>}
        </InfoTip>}>
          <Details rows={detailRows(v, pack)} />
        </Section>

        {st && (
          <Section title="Deductions" meta={st.deductions.length ? `${st.deductions.length}` : undefined}
            info={st.deductions.some((d) => d.category !== "rent") ? (
              <InfoTip align="end" title={pack.tenant.documentsTip(st.documentsRequired).title} cite={pack.tenant.documentsTip(st.documentsRequired).cite}>
                {pack.tenant.documentsTip(st.documentsRequired).text}
              </InfoTip>
            ) : undefined}>
            {st.standing && <p className="mb-3 text-sm text-ink-2"><span className="font-medium">{st.standing.label}.</span> {st.standing.note}</p>}
            {st.deductions.length
              ? <ol>{st.deductions.map((d) => <DeductionRow key={d.n} d={d} pack={pack} />)}</ol>
              : <p className="text-ink-3">None. The whole deposit comes back.</p>}
          </Section>
        )}

        {!st && (
          <Section title={v.moveOutDate ? "Where to mail your statement" : "Moving out"}
            info={<InfoTip align="end" title={pack.tenant.mailTip(!!v.moveOutDate).title} cite={pack.tenant.mailTip(!!v.moveOutDate).cite}>
              {pack.tenant.mailTip(!!v.moveOutDate).text}
            </InfoTip>}>
            <MovingOutForm token={token} tenants={v.tenants} today={v.today} moveOutDate={v.moveOutDate} existing={v.moveOut} quiet={!!stand.pay} />
          </Section>
        )}

        {steps && (
          <Section title="Timeline">
            <Timeline steps={steps} due={st ? null : v.statementDue} delivery={st?.delivery ?? null} deliveryCite={pack.tenant.deliveryCite} />
          </Section>
        )}

        {/* No tip here: the rule for these photos, (g)(1), is the "Photos of the unit" right below. */}
        <Section title="Move-in photos" meta={v.photos.length ? `${v.photos.length}` : undefined}>
          {v.photos.length ? (
            // One grid, in room order, each tile opening the same photo at full size through the token route.
            <ul className="grid grid-cols-3 gap-2 sm:grid-cols-5">
              {rooms.flatMap((r) => v.photos.filter((p) => p.room === r)).map((p) => (
                <li key={p.id} className="min-w-0">
                  <a href={`/api/t/${token}/photos/${p.id}`} target="_blank" rel="noreferrer" aria-label={`${p.room}, move-in photo`}
                    className="block rounded-md outline-none focus-visible:ring-3 focus-visible:ring-brand-100">
                    {/* eslint-disable-next-line @next/next/no-img-element */}
                    <img src={`/api/t/${token}/photos/${p.id}`} alt="" loading="lazy" className="aspect-square w-full rounded-md border border-line bg-surface object-cover" />
                  </a>
                  <p className="mt-1 truncate text-xs text-ink-3" title={p.room}>{p.room}</p>
                </li>
              ))}
            </ul>
          ) : <p className="text-ink-3">None on file.</p>}
        </Section>

        {st && (
          <div className="mt-6 border-t border-line pt-6">
            <a href={`${pdf}?download=1`} className={buttonClass("primary", "lg", "h-11 w-full")}>
              <Icon name="download" />Download itemized statement (PDF)
            </a>
            <p className="mt-2.5 flex items-center justify-center gap-1.5 text-sm text-ink-3">
              <a href={pdf} target="_blank" rel="noreferrer" className="text-brand hover:underline">Open in browser</a>
              {/* Built fresh from the landlord's records on each request (no copy of the mailed PDF is kept), so the tip says so. */}
              <InfoTip align="end" title="About this PDF">
                Built from your landlord&apos;s records as they stand, dated the day the statement went out, with the photo exhibits and copies of any invoices. The paper or email you received is the statement itself.
              </InfoTip>
            </p>

            <div className="mt-4 rounded-lg border border-line-2 bg-surface px-4 py-3.5">
              <p className="font-medium">Questions about a deduction?</p>
              <p className="mt-0.5 text-sm text-ink-3">Ask {landlord} first. The courts&apos; guide explains how disputes are handled.</p>
              <div className="mt-3 flex flex-wrap gap-2">
                <a href="#rights" className={buttonClass("secondary", "sm")}>Your rights</a>
                <a href={COURTS_GUIDE} target="_blank" rel="noreferrer" className={buttonClass("secondary", "sm")}>{pack.courtsGuide.label}<Icon name="arrow-up-right" /></a>
              </div>
            </div>
          </div>
        )}

        {/* One tip for the section (what this page is and isn't); each right opens its own from its title, so the list
            ends without a column of icons. */}
        <Section id="rights" title="Your rights" info={<InfoTip align="end" title="About this page">{pack.copy.tenantAbout}</InfoTip>}>
          <ul>
            {pack.tenant.rights(v, moveInPhotosRequired).map((r) => (
              <li key={r.title} className="border-t border-line-2 py-2.5 first:border-t-0 first:pt-0">
                <InfoTip trigger={<TipLabel>{r.title}</TipLabel>} title={r.title} cite={r.cite}>{r.text}</InfoTip>
              </li>
            ))}
            <li className="border-t border-line-2 pt-2.5">
              <a href={COURTS_GUIDE} target="_blank" rel="noreferrer" className="inline-flex items-center gap-1 text-brand hover:underline">
                {pack.courtsGuide.label} to security deposits<Icon name="arrow-up-right" className="size-3.5" />
              </a>
            </li>
          </ul>
        </Section>

        <footer className="mt-8 text-center text-xs text-ink-3">
          Prepared with <span className="font-medium text-ink-2">Good Faith</span>
        </footer>
      </main>
    </div>
  );
}

/* ---------- Where things stand ---------- */

type Tone = "green" | "amber" | "red" | "gray";

/** The status block, from the latest fact on file: a label, the hero amount, one status line and one sentence. */
function standing(v: TenantView, pack: StatePack): { label: string; amount: number | null; tone: Tone; title: string; line?: ReactNode; pay?: string | null } {
  const st = v.statement;
  const due = (text: string) => withTip(text, <InfoTip align="end" title={pack.tenant.dueTip.title} cite={pack.tenant.dueTip.cite}>{pack.tenant.dueTip.text}</InfoTip>);
  if (v.returned) {
    const r = v.returned, how = r.kind === "payout" ? "PayPal Payout" : "PayPal refund";
    if (returnFailed(r.status)) return { label: "Refund amount", amount: r.amount, tone: "red", title: `Refund ${words(r.status)}`, line: `PayPal reports the ${how} as ${words(r.status)}. Ask your landlord to send it again.` };
    const done = returnCompleted(r.status);
    return {
      label: "Refund amount", amount: r.amount, tone: done ? "green" : "amber", title: `Refund sent ${shortDate(pacificDate(r.at))}`,
      line: `PayPal shows the ${how.replace("PayPal ", "")} as ${done ? "completed" : words(r.status)}.`,
    };
  }
  if (st) {
    const sent = `Statement sent ${shortDate(st.delivery.date)}`;
    if (st.refund > 0) return { label: "Refund due", amount: st.refund, tone: "amber", title: sent, line: v.statementDue ? due(`The refund is due by ${shortDate(v.statementDue)}.`) : undefined };
    if (st.balanceClaimed > 0) return { label: "Balance claimed", amount: st.balanceClaimed, tone: "gray", title: sent, line: "The statement records it as a claim, not a demand for immediate payment." };
    return { label: "Refund", amount: 0, tone: "gray", title: sent, line: "The deductions used the whole deposit." };
  }
  const held = v.deposit?.paid ? v.deposit.amount : null;
  if (v.moveOutDate && v.statementDue) {
    return { label: "Deposit held", amount: held, tone: "amber", title: `Moved out ${shortDate(v.moveOutDate)}`, line: due(`Your statement and refund are due by ${shortDate(v.statementDue)}.`) };
  }
  if (v.noticeGivenOn) {
    return { label: "Deposit held", amount: held, tone: "gray", title: v.plannedMoveOut ? `Moving out ${shortDate(v.plannedMoveOut)}` : "Notice given", line: `Your landlord recorded your notice on ${shortDate(v.noticeGivenOn)}.` };
  }
  if (v.moveOut) {
    return { label: "Deposit held", amount: held, tone: "gray", title: `Moving out ${shortDate(v.moveOut.planned_move_out)}`, line: "Your landlord has your forwarding address." };
  }
  if (v.deposit?.paid) {
    return {
      label: "Deposit held", amount: v.deposit.amount, tone: "green", title: v.deposit.paidAt ? `Paid ${shortDate(pacificDate(v.deposit.paidAt))}` : "Paid",
      line: due(pack.tenant.paidLine),
    };
  }
  if (v.deposit) {
    return { label: "Deposit requested", amount: v.deposit.amount, tone: "amber", title: `Invoice ${words(v.deposit.status)}, not paid yet`, pay: v.deposit.payLink };
  }
  return { label: "Security deposit", amount: null, tone: "gray", title: "No deposit request yet", line: "Your landlord has not sent a deposit invoice through PayPal." };
}

function StatusMark({ tone }: { tone: Tone }) {
  const t = { green: "bg-green-bg text-green", amber: "bg-amber-bg text-amber", red: "bg-red-bg text-red", gray: "bg-surface-2 text-ink-3" }[tone];
  return (
    <span aria-hidden className={`inline-flex size-5 shrink-0 items-center justify-center rounded-full ${t}`}>
      <Icon name={tone === "green" ? "check" : tone === "red" ? "alert" : "clock"} className="size-3" />
    </span>
  );
}

/** Text with a tip tied to its last word, so on a phone the icon wraps with that word instead of sitting alone. */
function withTip(text: string, tip: ReactNode) {
  const cut = text.lastIndexOf(" ");
  return (
    <>
      {text.slice(0, cut + 1)}
      <span className="whitespace-nowrap">{text.slice(cut + 1)}<span className="ml-1.5 inline-flex align-[-2px]">{tip}</span></span>
    </>
  );
}

/* ---------- Progress and timeline ---------- */

type Step = { key: string; label: string; title: string; done: boolean; date: string | null };

/** Move-out to statement in four steps, as the tenants see them. Each is done on its own date; a refund can go out
 *  before or after the statement. */
function progress(v: TenantView): Step[] {
  const st = v.statement;
  const noRefund = !!st && !v.returned && st.refund <= 0;
  const sent = st ? deliveredWord(st.delivery) : null;
  return [
    { key: "out", label: "Moved out", title: "Moved out", done: !!v.moveOutDate, date: v.moveOutDate },
    { key: "inspect", label: "Inspected", title: v.inspectedAt ? "Inspection completed" : "Inspection", done: !!v.inspectedAt, date: v.inspectedAt ? pacificDate(v.inspectedAt) : null },
    v.returned
      ? { key: "refund", label: "Refund sent", title: "Refund sent", done: true, date: pacificDate(v.returned.at) }
      : noRefund
        ? { key: "refund", label: "No refund", title: "No refund due", done: true, date: st!.delivery.date }
        : { key: "refund", label: "Refund sent", title: "Refund", done: false, date: null },
    { key: "statement", label: "Statement", title: sent ? `Itemized statement ${sent}` : "Itemized statement", done: !!st, date: st?.delivery.date ?? null },
  ];
}

const deliveredWord = (d: DeliveryRecord) => (d.method === "mail" ? "mailed" : d.method === "email" ? "emailed" : "delivered");

/** Apple's order progress: a green bar with tick marks and a label under each of the four steps. */
function Progress({ steps }: { steps: Step[] }) {
  const last = steps.reduce((n, s, i) => (s.done ? i : n), -1);
  const at = (i: number) => `${(i / (steps.length - 1)) * 100}%`;
  return (
    <div className="mt-5" role="img" aria-label={`Progress: ${steps.filter((s) => s.done).map((s) => s.label).join(", ") || "not started"}`}>
      <div className="relative mx-[5px] h-1 rounded-full bg-line">
        {last > 0 && <div className="absolute inset-y-0 left-0 rounded-full bg-green-dot" style={{ width: at(last) }} />}
        {steps.map((s, i) => (
          <span key={s.key} style={{ left: at(i) }}
            className={`absolute top-1/2 size-2.5 -translate-x-1/2 -translate-y-1/2 rounded-full border-2 border-white ${s.done ? "bg-green-dot" : "bg-line"}`} />
        ))}
      </div>
      <div className="relative mt-2.5 h-4 text-xs text-ink-3">
        {steps.map((s, i) => (
          <span key={s.key} style={{ left: at(i) }}
            className={`absolute top-0 whitespace-nowrap ${i === 0 ? "" : i === steps.length - 1 ? "-translate-x-full" : "-translate-x-1/2"} ${i === last ? "font-medium text-ink" : ""}`}>
            {s.label}
          </span>
        ))}
      </div>
    </div>
  );
}

/** The same four steps with their dates: green checks for what happened, the brand dot for what comes next. */
function Timeline({ steps, due, delivery, deliveryCite }: { steps: Step[]; due: string | null; delivery: DeliveryRecord | null; deliveryCite: string }) {
  const next = steps.findIndex((s) => !s.done);
  return (
    <ol>
      {steps.map((s, i) => {
        const state = s.done ? "done" : i === next ? "now" : "todo";
        const sub = s.date ? shortDate(s.date) : due && (s.key === "refund" || s.key === "statement") ? `Due by ${shortDate(due)}` : "Not yet";
        return (
          <li key={s.key} className="relative grid grid-cols-[20px_minmax(0,1fr)] gap-x-2.5 pb-[18px] last:pb-0">
            {i < steps.length - 1 && <span aria-hidden className="absolute bottom-[-2px] left-[9.5px] top-5 w-px bg-line" />}
            <span aria-hidden className={`relative z-[1] inline-flex size-5 items-center justify-center rounded-full ${state === "done" ? "bg-green-bg text-green" : state === "now" ? "bg-brand-50" : "border border-line bg-canvas"}`}>
              {state === "done" ? <Icon name="check" className="size-3" /> : state === "now" ? <span className="size-2 rounded-full bg-brand" /> : null}
            </span>
            <div>
              <p className={`flex items-center gap-1.5 font-medium ${state === "todo" ? "text-ink-3" : ""}`}>
                {s.title}
                {s.key === "statement" && delivery && (
                  <InfoTip align="end" title="How it was delivered" cite={deliveryCite}>{capFirst(describeDelivery(delivery))}.</InfoTip>
                )}
              </p>
              <p className="text-xs text-ink-3">{sub}<span className="sr-only">{s.done ? ", done" : ""}</span></p>
            </div>
          </li>
        );
      })}
    </ol>
  );
}

/* ---------- Details ---------- */

type DetailRow = { k: ReactNode; v: ReactNode; total?: boolean };

function detailRows(v: TenantView, pack: StatePack): DetailRow[] {
  const st = v.statement, d = v.deposit, a = v.agreement;
  const masked = maskEmail(a?.paypalEmail);
  const rows: DetailRow[] = [];
  const signed = a ? `Signed by ${a.signedBy.join(" and ")} on ${longDate(pacificDate(a.signedAt))}.` : "";
  const tip = pack.tenant.agreementTip({ agreed: !!a, electronic: !!d?.electronic });
  const agreementTip = (label: string) => (
    <InfoTip trigger={<TipLabel>{label}</TipLabel>} title={tip.title} cite={tip.cite}>
      {a ? <>{a.text ? <>&ldquo;{a.text}&rdquo; </> : null}{signed}</> : tip.text}
    </InfoTip>
  );

  if (d) rows.push({ k: d.paid ? "Deposit paid" : "Deposit requested", v: <Money value={d.amount} /> });
  else rows.push({ k: "Deposit", v: <span className="text-ink-3">Not requested yet</span> });

  if (st) {
    rows.push({ k: st.standing?.label ?? "Deductions", v: st.total ? <Money value={st.total} sign="minus" /> : <Money value={0} /> });
    if (st.balanceClaimed > 0) rows.push({ k: "Balance claimed", v: <Money value={st.balanceClaimed} />, total: true });
    else rows.push({ k: v.returned ? "Refund" : "Refund due", v: <Money value={v.returned?.amount ?? st.refund} />, total: true });
  }

  if (v.returned) {
    const payout = v.returned.kind === "payout";
    rows.push({ k: "Method", v: payout ? "PayPal Payout" : "PayPal refund" });
    rows.push({ k: agreementTip("Sent to"), v: payout ? (masked ? `PayPal, ${masked}` : "PayPal") : "Your original PayPal payment" });
    if (v.returned.paypalId) rows.push({ k: `PayPal ${payout ? "payout" : "refund"} ID`, v: <CopyId text={v.returned.paypalId} label={`Copy the PayPal ${payout ? "payout" : "refund"} ID`} /> });
    return rows;
  }

  if (d?.paid && !st) {
    if (d.paidAt) rows.push({ k: "Paid on", v: shortDate(pacificDate(d.paidAt)) });
    rows.push({ k: "Paid with", v: payMethod(d.method) });
  }
  if (d && !d.paid) rows.push({ k: "Status", v: capFirst(words(d.status)) });
  if (!st || st.refund > 0) rows.push({ k: agreementTip("Refund to"), v: masked ? `PayPal, ${masked}` : <span className="text-ink-3">Not agreed yet</span> });
  return rows;
}

/** One row per fact, the value on the right; the total's rule is drawn once, across the whole row. */
function Details({ rows }: { rows: DetailRow[] }) {
  return (
    <dl className="flex flex-col gap-2.5">
      {rows.map((r, i) => (
        <div key={i} className={`flex items-baseline gap-4 ${r.total ? "mt-0.5 border-t border-line-2 pt-2.5 font-medium" : ""}`}>
          <dt className={`shrink-0 ${r.total ? "" : "text-ink-3"}`}>{r.k}</dt>
          <dd className="min-w-0 flex-1 text-right tabular-nums">{r.v}</dd>
        </div>
      ))}
    </dl>
  );
}

/* ---------- Deductions ---------- */

function DeductionRow({ d, pack }: { d: TenantDeduction; pack: StatePack }) {
  const tone = d.category === "damage" ? "bg-red-bg text-red" : d.category === "cleaning" ? "bg-amber-bg text-amber" : "bg-surface-2 text-ink-3";
  const tag = pack.tags[d.category];
  return (
    <li className="flex gap-3 border-t border-line-2 py-3 first:border-t-0 first:pt-0 last:pb-0">
      <span className={`mt-px flex size-6 shrink-0 items-center justify-center rounded-sm text-xs font-semibold tabular-nums ${tone}`}>{d.n}</span>
      <div className="min-w-0 flex-1">
        {/* The thing and what was done to it; where it was and the basis under it. The item as the statement prints it
            heads the Why? tip, with the math. */}
        <p className="font-medium">{d.title}</p>
        <p className="mt-0.5 text-sm text-ink-3">
          {capFirst([d.room, d.where ? lowerFirst(d.where) : null].filter(Boolean).join(", "))}{d.room || d.where ? ". " : ""}{d.basis}.{" "}
          <InfoTip trigger="why" align="end" title={tag.label} cite={pack.statute.tagCite(tag.tag)}>
            {capFirst(d.item)}{d.room ? ` (${d.room})` : ""}: {d.math}.{d.note ? ` ${d.note}` : ""}{d.proration !== "none" ? ` ${pack.tenant.prorationNote}` : ""}
          </InfoTip>
        </p>
      </div>
      <Money value={d.amount} className="font-medium" />
    </li>
  );
}

/* ---------- Layout ---------- */

function Section({ id, title, meta, info, children }: { id?: string; title: string; meta?: string; info?: ReactNode; children: ReactNode }) {
  return (
    <section id={id} className="mt-6 scroll-mt-6 border-t border-line pt-5">
      <div className="mb-3 flex items-center gap-2">
        <h2 className="text-lg font-medium">{title}</h2>
        {meta && <span className="text-xs text-ink-3">{meta}</span>}
        {info && <span className="ml-auto inline-flex">{info}</span>}
      </div>
      {children}
    </section>
  );
}

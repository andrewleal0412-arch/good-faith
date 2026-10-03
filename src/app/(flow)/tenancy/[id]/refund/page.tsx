import Link from "next/link";
import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { Fragment, type ReactNode } from "react";
import { ButtonLink } from "@/components/button";
import { Icon, PayPalMark, type IconName } from "@/components/icons";
import { InfoTip, TipLabel } from "@/components/info-tip";
import { Money, Notice, StatusChip, Wordmark } from "@/components/ui";
import { PAGE_PATH, runNotes, stripQuotes, type Step } from "@/lib/agent-notes";
import { atText, pacificTime, shortDate } from "@/lib/dates";
import { db } from "@/lib/db";
import { usd } from "@/lib/deductions";
import { describeDelivery, type DeliveryRecord } from "@/lib/statement";
import { loadRefundView, maskEmail, type Check, type RefundView, type RunView } from "@/lib/refund-view";
import { CopyId } from "@/components/copy-id";
import { RefundActions } from "./actions";

export const dynamic = "force-dynamic";

export async function generateMetadata({ params }: PageProps<"/tenancy/[id]/refund">): Promise<Metadata> {
  const { id } = await params;
  const { data } = await db.from("payments").select("kind").eq("tenancy_id", id).in("kind", ["refund", "payout"]).limit(1);
  return { title: data?.length ? "Refund sent" : "Review refund" };
}

// Mercury's Review transfer, one for one: a bar with the wordmark, the account and a close button over a centered
// 560px column. Before the money moves: the amount, To / From / Amount / Method / Arrival, the rules' checks
// and the agent's steps under Details, and one Send refund button that answers the agent's approval request. After:
// the receipt, with the PayPal id to copy and the statement as the next step. No sidebar, no other primary.

export default async function RefundPage({ params }: PageProps<"/tenancy/[id]/refund">) {
  const { id } = await params;
  const v = await loadRefundView(id);
  if (!v) notFound();
  return (
    <div className="flex min-h-screen flex-col bg-canvas">
      <header className="flex h-16 items-center gap-3.5 px-4 sm:px-8">
        <Link href="/units"><Wordmark /></Link>
        <span aria-hidden className="h-5 w-px shrink-0 bg-line" />
        <span className="min-w-0 truncate text-base text-ink-2">{v.landlord}</span>
        <Link href={v.back} aria-label="Close"
          className="ml-auto inline-flex size-[34px] shrink-0 items-center justify-center rounded-md text-ink-2 hover:bg-surface">
          <Icon name="x" />
        </Link>
      </header>
      <main className="flex flex-1 justify-center px-4 pb-20 pt-6 sm:px-8 sm:pt-16">
        <div className="w-[560px] max-w-full">
          {v.sent ? <Sent v={v} /> : <Review v={v} />}
        </div>
      </main>
    </div>
  );
}

const names = (xs: string[]) => (xs.length ? xs.join(" and ") : "the tenants");

function Lead({ to, v }: { to: string; v: RefundView }) {
  return (
    <p className="mt-3 text-ink-3">
      {to} <b className="font-medium text-ink">{names(v.tenants)}</b> from the <b className="font-medium text-ink">{v.street}</b> deposit
    </p>
  );
}

function Rows({ rows }: { rows: [ReactNode, ReactNode, ReactNode?][] }) {
  return (
    <dl className="grid grid-cols-[104px_minmax(0,1fr)] gap-x-4 gap-y-5 sm:grid-cols-[140px_minmax(0,1fr)]">
      {rows.map(([k, val, sub], i) => (
        <Fragment key={i}>
          <dt className="text-ink-3">{k}</dt>
          <dd className="min-w-0 text-ink">
            {val}
            {sub && <span className="mt-px block text-sm text-ink-3">{sub}</span>}
          </dd>
        </Fragment>
      ))}
    </dl>
  );
}

const Divider = () => <div className="my-7 h-px bg-line" />;

/** Text with a tip tied to its last word, so on a phone the icon wraps with that word instead of floating off. */
function withTip(text: string, tip: ReactNode) {
  const cut = text.lastIndexOf(" ");
  return (
    <span>
      {text.slice(0, cut + 1)}
      <span className="whitespace-nowrap">{text.slice(cut + 1)}<span className="ml-1.5 inline-flex align-[-2px]">{tip}</span></span>
    </span>
  );
}

/** The account the money goes to, and the one it comes from. */
function partyRows(v: RefundView): [ReactNode, ReactNode, ReactNode?][] {
  const masked = maskEmail(v.paypalEmail);
  return [
    ["To", names(v.tenants), masked ? <span title={v.paypalEmail ?? undefined}>PayPal, {masked}</span> : "PayPal account not on file"],
    ["From", v.landlord, <span key="pp" className="inline-flex items-center gap-1.5"><PayPalMark size={14} />PayPal business</span>],
  ];
}

/* ---------- Review ---------- */

function Review({ v }: { v: RefundView }) {
  const r = v.review!;
  const run = r.run;
  const awaiting = !!r.pending && run?.status === "awaiting_approval";
  const payout = awaiting ? r.pending!.tool === "send_payout" : r.rail === "payout";
  const nothing = r.rail === "nothing_to_refund";
  const blocked = r.rail === "blocked";
  const running = run?.status === "running";
  const word = payout ? "payout" : "refund";

  const note = awaiting ? `This ${word} will be sent today through PayPal.`
    : blocked ? "Nothing can be sent until the checks below pass."
      : nothing ? "The deductions use the whole deposit, so no money goes back."
        : "Prepared by the agent and sent only when you approve it.";

  const method: [ReactNode, ReactNode, ReactNode?][] = blocked || nothing ? [] : [
    ["Method", withTip(payout ? "PayPal Payout" : "PayPal refund to the original payment", <InfoTip title="How the money goes back">{r.why}</InfoTip>),
      payout ? `The PayPal account the ${v.tenants.length === 1 ? "tenant" : "tenants"} designated`
        : `The ${v.tenants.length === 1 ? "tenant's" : "tenants'"} original PayPal payment`],
    // A refund lands in the PayPal account that paid; anything paid another way is left without a promise.
    ...(payout || r.method === "PAYPAL" ? [["Arrival", "Today"] as [ReactNode, ReactNode]] : []),
  ];

  const mode = awaiting ? "send" as const : "prepare" as const;
  const failedCheck = awaiting ? r.pending!.check : null;

  return (
    <>
      <h1 className="text-xl font-medium">Review {word}</h1>
      <Lead to={`${payout ? "Payout" : "Refund"} to`} v={v} />
      <Money value={r.amount} className="mt-3 block text-2xl font-medium" />
      <p className="mt-2 text-ink-3">{note}</p>

      {r.blockers.length > 0 && (
        <div role="alert" className="mt-5 rounded-md bg-red-bg px-3.5 py-2.5 text-sm text-red">
          {r.blockers.map((b, i) => <p key={i} className={i ? "mt-1" : ""}>{b}</p>)}
        </div>
      )}
      {r.warnings.map((w, i) => <Notice key={i} tone="amber" className="mt-3">{w}</Notice>)}

      <Divider />
      <Rows rows={[
        ...partyRows(v),
        ["Amount", usd(r.amount), `${usd(r.depositHeld)} deposit less ${usd(r.deductions)} in deductions`],
        ...method,
      ]} />
      <Divider />

      <details open className="group">
        <Summary />
        <div className="mt-3">
          <GroupHead title="Checks" right="Just now" />
          <ul>
            {r.checks.map((c) => <CheckRow key={c.key} c={c} />)}
            {awaiting && (
              <CheckRow c={{
                key: "guard", label: "Final check before sending", value: failedCheck ? "Blocked" : "Matches the file",
                state: failedCheck ? "fail" : "ok",
                tip: { title: "The last check", body: `The prepared ${word}'s amount, payment and account, checked against the deposit, the deductions and the refund agreement. When you send it, Good Faith checks once more, as they are at that moment, before PayPal is called.` },
              }} />
            )}
          </ul>
          {failedCheck && <Notice className="mt-2">{failedCheck}</Notice>}
          {run && <AgentRun run={run} amount={r.amount} deposit={r.depositHeld} word={word} />}
        </div>
      </details>

      {run?.status === "failed" && <Notice className="mt-6">The last run stopped: {run.error ?? "no reason was recorded"}.</Notice>}
      {running && <Notice tone="gray" className="mt-6">The agent is working on this {word}. Refresh in a moment.</Notice>}

      <RefundActions
        tenancyId={v.tenancyId}
        back={v.back}
        mode={mode}
        runId={awaiting ? run!.id : undefined}
        label={awaiting ? `Send ${word}` : nothing ? "Run the close-out" : run ? "Prepare again" : `Prepare ${word}`}
        disabled={awaiting ? !!failedCheck : blocked || running}
        auth={awaiting
          ? `By clicking “Send ${word},” you authorize Good Faith to issue this PayPal ${payout ? "Payout" : "refund"}.`
          : "The agent verifies the deposit with PayPal first. Nothing is sent until you approve it."}
      />
    </>
  );
}

function Summary({ meta }: { meta?: ReactNode }) {
  return (
    <summary className="flex cursor-pointer list-none items-center gap-1.5 text-sm font-medium text-ink-2 [&::-webkit-details-marker]:hidden">
      Details
      <Icon name="chev-down" className="size-3.5 text-ink-4 transition-transform group-open:rotate-180" />
      {meta && <span className="ml-auto text-xs font-normal text-ink-3">{meta}</span>}
    </summary>
  );
}

function GroupHead({ title, right, className }: { title: string; right?: ReactNode; className?: string }) {
  return (
    <p className={`flex items-center gap-2 pb-1 text-xs font-medium text-ink-3 ${className ?? ""}`}>
      {title}
      {right && <span className="ml-auto font-normal">{right}</span>}
    </p>
  );
}

type Mark = "ok" | "warn" | "fail" | "waiting" | "declined";
const MARK: Record<Mark, [string, IconName]> = {
  ok: ["bg-green-bg text-green", "check"],
  warn: ["bg-amber-bg text-amber", "alert"],
  fail: ["bg-red-bg text-red", "x"],
  waiting: ["bg-amber-bg text-amber", "clock"],
  declined: ["bg-surface-2 text-ink-3", "x"],
};

function StateMark({ state }: { state: Mark }) {
  const [cls, icon] = MARK[state];
  return <span className={`flex size-[18px] shrink-0 items-center justify-center rounded-full ${cls}`}><Icon name={icon} className="size-3" /></span>;
}

function CheckRow({ c }: { c: Check }) {
  // One line from sm up (label left, value right); on a phone the value drops under the label instead of being cut.
  return (
    <li className="flex min-w-0 items-start gap-2.5 py-[7px] text-sm text-ink-2 sm:items-center">
      <span className="mt-px sm:mt-0"><StateMark state={c.state} /></span>
      <div className="min-w-0 flex-1 sm:flex sm:items-center sm:gap-3">
        <p className="shrink-0"><InfoTip trigger={<TipLabel>{c.label}</TipLabel>} title={c.tip.title} cite={c.tip.cite}>{c.tip.body}</InfoTip></p>
        <p className="mt-0.5 text-xs tabular-nums text-ink-3 sm:ml-auto sm:mt-0 sm:min-w-0 sm:truncate sm:text-right sm:text-sm" title={c.value}>{c.value}</p>
      </div>
    </li>
  );
}

/** One short line per thing the agent did, in the order it did them. A refund waiting for the landlord shows as
 *  prepared, then waiting; PayPal's own answer for each step is the row's tooltip. */
function agentRows(steps: Step[], p: { amount: number; deposit: number; word: string; proposedAt: string | null }) {
  const out: { key: string; title: string; detail: string; state: Mark; right?: string }[] = [];
  for (const s of steps) {
    const detail = stripQuotes(s.detail).text;
    const state: Mark = s.state === "error" ? "fail" : s.state === "declined" ? "declined" : "ok";
    const money = s.tool === "create_refund" || s.tool === "send_payout";
    if (money) {
      const w = s.tool === "send_payout" ? "payout" : "refund";
      if (s.state === "waiting") {
        out.push({ key: s.id, title: `Prepared the ${usd(p.amount)} ${w}`, detail: s.title, state: "ok" });
        out.push({ key: `${s.id}:wait`, title: "Waiting for your approval", detail, state: "waiting", right: p.proposedAt ? pacificTime(p.proposedAt) : undefined });
      } else if (s.state === "declined") {
        out.push({ key: s.id, title: `You declined the ${w}`, detail, state });
      } else if (s.state === "error") {
        out.push({ key: s.id, title: `The ${w} did not go through`, detail, state });
      } else {
        out.push({ key: s.id, title: `Sent the ${w} through PayPal`, detail, state });
      }
      continue;
    }
    const title = s.tool === "get_close_out_facts" ? "Read the lease and the move-out file"
      : s.tool === "get_invoice" ? `Verified the ${usd(p.deposit)} deposit with PayPal`
        : s.tool === "get_refund" ? "Confirmed the refund with PayPal"
          : s.tool === "get_statement_checklist" ? "Checked the itemized statement" : s.title;
    out.push({ key: s.id, title, detail, state });
  }
  return out;
}

/** A page path in the agent's words, as a link. */
function withLinks(text: string): ReactNode[] {
  return text.split(PAGE_PATH).map((part, i) => {
    if (!PAGE_PATH.test(part)) return <Fragment key={i}>{part}</Fragment>;
    return <Link key={i} href={part} className="font-medium text-brand hover:underline">{part.endsWith("/statement") ? "Itemized statement" : "this property"}</Link>;
  });
}

function AgentRun({ run, amount, deposit, word }: { run: RunView; amount: number; deposit: number; word: string }) {
  const n = runNotes(run.items);
  const rows = agentRows(n.steps, { amount, deposit, word, proposedAt: run.proposedAt });
  if (!rows.length && !n.summary.length) return null;
  return (
    <>
      <GroupHead title="Done by the agent" right={atText(run.startedAt)} className="mt-4" />
      <ul>
        {rows.map((x) => (
          <li key={x.key} className="flex min-w-0 items-start gap-2.5 py-[7px] text-sm text-ink-2">
            <span className="mt-px"><StateMark state={x.state} /></span>
            <div className="min-w-0 flex-1" title={x.detail || undefined}>
              <p>{x.title}</p>
              {x.state === "fail" && x.detail && <p className="mt-0.5 text-xs text-ink-3">{x.detail}</p>}
            </div>
            {x.right && <span className="shrink-0 tabular-nums text-ink-3">{x.right}</span>}
          </li>
        ))}
      </ul>
      {/* What the agent wrote at the end, closed: it runs to a paragraph or two. */}
      {n.summary.length > 0 && (
        <details className="group/s mt-2 rounded-md bg-surface px-3.5 py-2.5">
          <summary className="flex cursor-pointer list-none items-center gap-1.5 text-sm text-ink-2 [&::-webkit-details-marker]:hidden">
            The agent&apos;s summary
            {n.cites.length > 0 && <InfoTip title="Rules the agent relied on" cite={n.cites.join("; ")}>The parts of Civil Code 1950.5 the agent checked this close-out against.</InfoTip>}
            <Icon name="chev-down" className="ml-auto size-3.5 text-ink-4 transition-transform group-open/s:rotate-180" />
          </summary>
          {n.summary.map((t, i) => <p key={i} className="mt-2 text-sm text-ink-2">{withLinks(t)}</p>)}
        </details>
      )}
    </>
  );
}

/* ---------- Sent ---------- */

/** How the statement went out, in a few words; the whole record is the line's tooltip. */
function deliveredBy(d: DeliveryRecord): string {
  if (d.method === "email") return `By email to ${d.email ?? d.to ?? "the tenant"}`;
  if (d.method === "personal") return `By personal delivery to ${d.to ?? "the tenant"}`;
  return `By first-class mail to ${d.address_kind === "unit" ? "the vacated unit" : d.address_kind === "forwarding" ? "the forwarding address" : d.address ?? "the tenant"}`;
}

function Sent({ v }: { v: RefundView }) {
  const s = v.sent!;
  const word = s.kind === "payout" ? "Payout" : "Refund";
  const failed = s.tone === "red";
  const statementHref = `/tenancy/${v.tenancyId}/statement`;
  const d = v.statement.delivery;
  return (
    <>
      <h1 className="flex items-center gap-3 text-xl font-medium">
        <span className={`flex size-7 shrink-0 items-center justify-center rounded-full ${failed ? "bg-red-bg text-red" : "bg-green-bg text-green"}`}>
          <Icon name={failed ? "alert" : "check"} className="size-[15px]" />
        </span>
        {failed ? `${word} did not go through` : `${word} sent`}
      </h1>
      <Lead to="To" v={v} />
      <Money value={s.amount} className="mt-3 block text-2xl font-medium" />
      <p className="mt-2 text-ink-3">Sent {atText(s.at)} through PayPal.</p>

      <Divider />
      <Rows rows={[
        ...(s.paypalId ? [[<><span className="max-sm:hidden">PayPal {s.kind === "payout" ? "payout" : "refund"} ID</span><span className="sm:hidden">{word} ID</span></>, <CopyId key="id" text={s.paypalId} label={`Copy the PayPal ${s.kind} ID`} />] as [ReactNode, ReactNode]] : []),
        ["Status", <StatusChip key="st" tone={s.tone}>{s.status}</StatusChip>],
        ...partyRows(v),
        ...(s.approvedAt ? [["Approved by", "You", atText(s.approvedAt)] as [ReactNode, ReactNode, ReactNode]] : []),
      ]} />

      <div className="mt-7 rounded-lg border border-line-2 bg-surface px-5 py-4">
        {d ? (
          <>
            <p className="font-medium">Statement delivered {shortDate(d.date)}</p>
            <p className="mt-0.5 text-sm text-ink-3" title={describeDelivery(d)}>{deliveredBy(d)}</p>
          </>
        ) : (
          <>
            <p className="font-medium">Next: deliver the itemized statement{v.statement.due ? ` by ${shortDate(v.statement.due)}` : ""}</p>
            <p className="mt-0.5 text-sm text-ink-3">The draft lists each deduction, its photos and this {s.kind} ID.</p>
          </>
        )}
      </div>

      <div className="mt-7 flex flex-wrap items-center gap-2.5">
        {d ? (
          <>
            <ButtonLink variant="primary" size="lg" href={v.back}>Done</ButtonLink>
            <ButtonLink size="lg" href={statementHref}><Icon name="doc" />View statement</ButtonLink>
          </>
        ) : (
          <>
            <ButtonLink variant="primary" size="lg" href={`${statementHref}#delivery`}><Icon name="send" />Send statement</ButtonLink>
            <ButtonLink size="lg" href={v.back}>Done</ButtonLink>
          </>
        )}
      </div>

      {s.run && (
        <details className="group mt-10 border-t border-line-2 pt-4">
          <Summary />
          <div className="mt-2">
            <AgentRun run={s.run} amount={s.amount} deposit={s.deposit} word={s.kind} />
          </div>
        </details>
      )}
    </>
  );
}

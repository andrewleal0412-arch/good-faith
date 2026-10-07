import Link from "@/components/link";
import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { Fragment, Suspense, type ReactNode } from "react";
import { ButtonLink } from "@/components/button";
import { Icon, PayPalMark, type IconName } from "@/components/icons";
import { InfoTip, TipLabel } from "@/components/info-tip";
import { Money, Notice, StatusChip, Wordmark } from "@/components/ui";
import { PAGE_PATH, runNotes, stripQuotes, type Step } from "@/lib/agent-notes";
import { atTextIn, shortDate, timeIn } from "@/lib/dates";
import { usd } from "@/lib/deductions";
import { db } from "@/lib/db";
import { POOL_EMPTY } from "@/lib/demo-pool";
import { describeDelivery, type DeliveryRecord } from "@/lib/statement";
import { maskEmail, refundStart, type Check, type RefundReview, type RefundView, type RunView } from "@/lib/refund-view";
import { Bone, Skeleton } from "@/components/skeletons";
import { refundRecordWords } from "@/lib/states/server";
import { tenancyPack } from "@/lib/tenancy-pack";
import { CopyId } from "@/components/copy-id";
import { Moment } from "@/components/motion";
import { StepLine, StepMark } from "@/components/steps";
import { ownedTenancy, pageTenancy } from "@/lib/workspace";
import { RefundActions } from "./actions";

export const dynamic = "force-dynamic";

export async function generateMetadata({ params }: PageProps<"/tenancy/[id]/refund">): Promise<Metadata> {
  const { id } = await params;
  // Nothing about a tenancy in another workspace, not even whether its refund went out.
  if (!(await ownedTenancy(id))) return { title: "Not found" };
  const { data } = await db.from("payments").select("kind").eq("tenancy_id", id).in("kind", ["refund", "payout"]).limit(1);
  return { title: data?.length ? "Refund sent" : "Review refund" };
}

// Mercury's Review transfer, one for one: a bar with the wordmark, the account and a close button over a centered
// 560px column. Before the money moves: the amount, To / From / Amount / Method / Arrival, the rules' checks
// and the agent's steps under Details, and one Send refund button that answers the agent's approval request. After:
// the receipt, with the PayPal id to copy and the statement as the next step. No sidebar, no other primary.
//
// The review draws what the database holds first (who, from which deposit, a prepared refund's amount, the button,
// held off), and what PayPal's live answer decides (the amount and method, the blockers, the checks, the agent's steps,
// whether the button may be pressed) streams in behind its own skeletons a moment later: the button stays off until
// that answer is in, as it did when the page waited for it. The receipt reads nothing from PayPal and comes whole.

export default async function RefundPage({ params }: PageProps<"/tenancy/[id]/refund">) {
  const { id } = await params;
  const ws = await pageTenancy(id);
  const [start, pack] = await Promise.all([refundStart(id, { demo: ws.kind === "demo" }), tenancyPack(id)]);
  if (!start) notFound();
  const v = start.view;
  const live = start.review ? start.review() : null;
  live?.catch(() => {});
  const statute = pack.statute.inline;
  return (
    <div className="flex min-h-screen flex-col bg-canvas">
      <header className="flex h-16 items-center gap-3.5 px-4 sm:px-8">
        <Link href="/units"><Wordmark /></Link>
        <span aria-hidden className="h-5 w-px shrink-0 bg-line" />
        <span className="min-w-0 truncate text-base text-ink-2">{v.landlord}</span>
        <Link href={v.back} aria-label="Close"
          className="ml-auto inline-flex size-[34px] shrink-0 items-center justify-center rounded-md text-ink-2 transition-colors hover:bg-surface">
          <Icon name="x" />
        </Link>
      </header>
      <main className="flex flex-1 justify-center px-4 pb-20 pt-6 sm:px-8 sm:pt-16">
        <div className="gf-page w-[560px] max-w-full">
          {v.sent || !live ? <Sent v={v} statute={statute} zone={pack.timeZone.id} />
            : <Review v={v} awaiting={start.awaiting} ran={start.ran} live={live} statute={statute} record={refundRecordWords(pack).name.toLowerCase()} zone={pack.timeZone.id} />}
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

function Rows({ rows, children }: { rows: [ReactNode, ReactNode, ReactNode?][]; children?: ReactNode }) {
  return (
    <dl className="grid grid-cols-[104px_minmax(0,1fr)] gap-x-4 gap-y-5 sm:grid-cols-[140px_minmax(0,1fr)]">
      <RowList rows={rows} />
      {children}
    </dl>
  );
}

function RowList({ rows }: { rows: [ReactNode, ReactNode, ReactNode?][] }) {
  return rows.map(([k, val, sub], i) => (
    <Fragment key={i}>
      <dt className="text-ink-3">{k}</dt>
      <dd className="min-w-0 text-ink">
        {val}
        {sub && <span className="mt-px block text-sm text-ink-3">{sub}</span>}
      </dd>
    </Fragment>
  ));
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

type Awaiting = { tool: string; amount: number } | null;
type Live = Promise<RefundReview>;

/** The words that change with the rail: a refund against the payment, or a Payout. */
function wordsOf(r: RefundReview) {
  const run = r.run;
  const awaiting = !!r.pending && run?.status === "awaiting_approval";
  const payout = awaiting ? r.pending!.tool === "send_payout" : r.rail === "payout";
  return { run, awaiting, payout, nothing: r.rail === "nothing_to_refund", blocked: r.rail === "blocked", running: run?.status === "running", word: payout ? "payout" : "refund" };
}

/** The review: the parts the database holds at once, and each part PayPal's live answer decides behind its own
 *  skeleton (`live`, read once for all of them). `awaiting`: a prepared refund waiting for approval, as stored, whose
 *  heading and amount need no wait. */
function Review({ v, awaiting, ran, live, statute, record, zone }: { v: RefundView; awaiting: Awaiting; ran: boolean; live: Live; statute: string; record: string; zone: string }) {
  const word = awaiting?.tool === "send_payout" ? "payout" : "refund";
  return (
    <>
      <Suspense fallback={<TopWaiting v={v} awaiting={awaiting} />}>
        <LiveTop v={v} live={live} />
      </Suspense>

      <Divider />
      <Rows rows={partyRows(v)}>
        <Suspense fallback={<RowsWaiting />}>
          <LiveAmountRows v={v} live={live} />
        </Suspense>
      </Rows>
      <Divider />

      <details open className="group">
        <Summary />
        <div className="mt-3">
          <GroupHead title="Checks" right="Just now" />
          <Suspense fallback={<ChecksWaiting />}>
            <LiveChecks live={live} statute={statute} record={record} zone={zone} />
          </Suspense>
        </div>
      </details>

      {/* The button, held off until PayPal's answer is in (the routes behind it check everything again anyway). With no
          run id, Decline is held off too (actions.tsx). */}
      <Suspense fallback={<RefundActions tenancyId={v.tenancyId} back={v.back} mode={awaiting ? "send" : "prepare"} label={awaiting ? `Send ${word}` : ran ? "Prepare again" : `Prepare ${word}`}
        disabled auth="Checking the deposit with PayPal..." />}>
        <LiveActions v={v} live={live} />
      </Suspense>
    </>
  );
}

/** The heading, the amount and the note while PayPal answers: a prepared refund's own (as stored), otherwise bones. */
function TopWaiting({ v, awaiting }: { v: RefundView; awaiting: Awaiting }) {
  if (awaiting) {
    const payout = awaiting.tool === "send_payout";
    return (
      <>
        <h1 className="text-xl font-medium">Review {payout ? "payout" : "refund"}</h1>
        <Lead to={`${payout ? "Payout" : "Refund"} to`} v={v} />
        <Money value={awaiting.amount} className="mt-3 block text-2xl font-medium" />
        <p className="mt-2 text-ink-3">This {payout ? "payout" : "refund"} will be sent today through PayPal.</p>
      </>
    );
  }
  // Each bone a line's height, as the heading, the two lines naming who and which deposit, the amount and the note stand.
  return (
    <Skeleton label="the refund" className="flex flex-col">
      <Bone w={200} h={28} />
      <div className="mt-3 flex h-12 flex-col justify-center gap-2.5"><Bone w="88%" h={14} /><Bone w="30%" h={14} /></div>
      <Bone w={180} h={32} className="mt-3" />
      <div className="mt-2 flex h-6 items-center"><Bone w="62%" h={14} /></div>
    </Skeleton>
  );
}

async function LiveTop({ v, live }: { v: RefundView; live: Live }) {
  const r = await live;
  const { awaiting, payout, nothing, blocked, word } = wordsOf(r);
  const note = awaiting ? `This ${word} will be sent today through PayPal.`
    : r.demoBlock && !r.blockers.length ? `This demo copy can't send the ${word}.`
    : blocked ? "Nothing can be sent until the checks below pass."
      : nothing ? (r.outside ? "The refund made in PayPal, recorded as this deposit's refund, covers what is owed, so no more money goes back."
        : r.viaDispute ? "PayPal already returned what is owed through the tenants' PayPal dispute, so no more money goes back." : "The deductions use the whole deposit, so no money goes back.")
        : "Prepared by the agent and sent only when you approve it.";
  return (
    <>
      <h1 className="text-xl font-medium">Review {word}</h1>
      <Lead to={`${payout ? "Payout" : "Refund"} to`} v={v} />
      <Money value={r.amount} className="mt-3 block text-2xl font-medium" />
      <p className="mt-2 text-ink-3">{note}</p>

      {r.demoBlock && <Notice tone="gray" className="mt-5">{r.demoBlock}</Notice>}
      {r.blockers.length > 0 && (
        <div role="alert" className="mt-5 rounded-md bg-red-bg px-3.5 py-2.5 text-sm text-red">
          {r.blockers.map((b, i) => <p key={i} className={i ? "mt-1" : ""}>{b}</p>)}
          {/* A refund made in PayPal waits for the landlord's decision, on the property's Payments tab. */}
          {r.waiting && <p className="mt-2"><Link href={r.waiting.href} className="font-medium underline">Review the refund{r.waiting.count === 1 ? "" : "s"} made in PayPal</Link></p>}
        </div>
      )}
      {r.warnings.map((w, i) => <Notice key={i} tone="amber" className="mt-3">{w}</Notice>)}
    </>
  );
}

/** Amount and how the money goes back, under To and From. */
async function LiveAmountRows({ v, live }: { v: RefundView; live: Live }) {
  const r = await live;
  const { payout, nothing, blocked } = wordsOf(r);
  const method: [ReactNode, ReactNode, ReactNode?][] = blocked || nothing ? [] : [
    ["Method", withTip(payout ? "PayPal Payout" : "PayPal refund to the original payment", <InfoTip title="How the money goes back">{r.why}</InfoTip>),
      payout ? `The PayPal account the ${v.tenants.length === 1 ? "tenant" : "tenants"} designated`
        : `The ${v.tenants.length === 1 ? "tenant's" : "tenants'"} original PayPal payment`],
    // A refund lands in the PayPal account that paid; anything paid another way is left without a promise.
    ...(payout || r.method === "PAYPAL" ? [["Arrival", "Today"] as [ReactNode, ReactNode]] : []),
    // The whole deposit goes back: the note PayPal shows the tenants says so, in code's words.
    ...(r.noteToPayer ? [["Note", <span key="n" className="text-ink-2">{r.noteToPayer}</span>] as [ReactNode, ReactNode]] : []),
  ];
  return (
    <RowList rows={[
      ["Amount", usd(r.amount), (r.forfeited ? `The whole ${usd(r.depositHeld)} deposit: the ${usd(r.deductions)} in deductions is forfeited`
        : `${usd(r.depositHeld)} deposit less ${usd(r.deductions)} ${r.standing ? r.standing.toLowerCase() : "in deductions"}`)
        + (r.viaDispute ? `, less ${usd(r.viaDispute.amount)} PayPal returned through the tenants' PayPal dispute${r.viaDispute.notKept > 0 ? ` (${usd(r.viaDispute.notKept)} of the deductions not kept)` : ""}` : "")
        + (r.outside ? `, less ${usd(r.outside.amount)} refunded in PayPal${r.outside.notKept > 0 ? ` (${usd(r.outside.notKept)} of the deductions not kept)` : ""}` : "")],
      ...method,
    ]} />
  );
}

function RowsWaiting() {
  return (
    <>
      {[0, 1, 2].map((i) => (
        <Fragment key={i}>
          <dt><Skeleton label="the amount" className="flex h-6 items-center"><Bone w={70} h={14} /></Skeleton></dt>
          <dd className="min-w-0">
            <Skeleton label="the amount" className="flex flex-col">
              <div className="flex h-6 items-center"><Bone w={[110, 230, 60][i]} h={14} className="max-w-full" /></div>
              {i < 2 && <div className="mt-px flex h-5 items-center"><Bone w={i ? 190 : 260} h={12} className="max-w-full" /></div>}
            </Skeleton>
          </dd>
        </Fragment>
      ))}
    </>
  );
}

async function LiveChecks({ live, statute, record, zone }: { live: Live; statute: string; record: string; zone: string }) {
  const r = await live;
  const { run, awaiting, word } = wordsOf(r);
  const failedCheck = awaiting ? r.pending!.check : null;
  return (
    <>
      <ul>
        {r.checks.map((c) => <CheckRow key={c.key} c={c} />)}
        {awaiting && (
          <CheckRow c={{
            key: "guard", label: "Final check before sending", value: failedCheck ? "Blocked" : "Matches the file",
            state: failedCheck ? "fail" : "ok",
            tip: { title: "The last check", body: `The prepared ${word}'s amount, payment and account, checked against the deposit, the deductions and the ${record}. When you send it, Good Faith checks once more, as they are at that moment, before PayPal is called.` },
          }} />
        )}
      </ul>
      {failedCheck && <Notice className="mt-2">{failedCheck}</Notice>}
      {run && <AgentRun run={run} amount={r.amount} deposit={r.depositHeld} word={word} statute={statute} zone={zone} trace />}
    </>
  );
}

function ChecksWaiting() {
  return (
    <Skeleton label="the checks" className="flex flex-col">
      {Array.from({ length: 7 }, (_, i) => (
        <div key={i} className="flex h-[34px] items-center gap-2.5">
          <Bone w={18} h={18} className="rounded-full" /><Bone w={`${46 - (i % 3) * 8}%`} h={13} /><Bone w={110} h={13} className="ml-auto max-sm:hidden" />
        </div>
      ))}
    </Skeleton>
  );
}

/** The run's own notes and the button, once PayPal's answer is in. */
async function LiveActions({ v, live }: { v: RefundView; live: Live }) {
  const r = await live;
  const { run, awaiting, payout, nothing, blocked, running, word } = wordsOf(r);
  const failedCheck = awaiting ? r.pending!.check : null;
  return (
    <>
      {run?.status === "failed" && <Notice className="mt-6">The last run stopped: {run.error ?? "no reason was recorded"}.</Notice>}
      {running && <Notice tone="gray" className="mt-6">The agent is working on this {word}. Refresh in a moment.</Notice>}

      <RefundActions
        tenancyId={v.tenancyId}
        back={v.back}
        mode={awaiting ? "send" : "prepare"}
        runId={awaiting ? run!.id : undefined}
        label={awaiting ? `Send ${word}` : nothing ? "Run the close-out" : run ? "Prepare again" : `Prepare ${word}`}
        disabled={awaiting ? !!failedCheck : blocked || running}
        auth={awaiting
          ? `By clicking “Send ${word},” you authorize Good Faith to issue this PayPal ${payout ? "Payout" : "refund"}.`
          : r.demoBlock ? (r.demoBlock === POOL_EMPTY ? "Preparing is off in this copy because today's sandbox deposits are used up." : "Preparing is off in this copy because its deposit is shared with every other copy.")
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
function agentRows(steps: Step[], p: { amount: number; deposit: number; word: string; proposedAt: string | null; zone: string }) {
  const out: { key: string; title: string; detail: string; state: Mark; right?: string }[] = [];
  for (const s of steps) {
    const detail = stripQuotes(s.detail).text;
    const state: Mark = s.state === "error" ? "fail" : s.state === "declined" ? "declined" : "ok";
    const money = s.tool === "create_refund" || s.tool === "send_payout";
    if (money) {
      const w = s.tool === "send_payout" ? "payout" : "refund";
      if (s.state === "waiting") {
        out.push({ key: s.id, title: `Prepared the ${usd(p.amount)} ${w}`, detail: s.title, state: "ok" });
        out.push({ key: `${s.id}:wait`, title: "Waiting for your approval", detail, state: "waiting", right: p.proposedAt ? timeIn(p.proposedAt, p.zone) : undefined });
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

/** The agent's steps draw one after another, this far apart. */
const STEP_MS = 110;

/** A page path in the agent's words, as a link. */
function withLinks(text: string): ReactNode[] {
  return text.split(PAGE_PATH).map((part, i) => {
    if (!PAGE_PATH.test(part)) return <Fragment key={i}>{part}</Fragment>;
    return <Link key={i} href={part} className="font-medium text-brand hover:underline">{part.endsWith("/statement") ? "Itemized statement" : "this property"}</Link>;
  });
}

/** The agent's steps as a timeline. With `trace` (the review), the first time this viewer sees a run its steps' checks
 *  draw in order and the line fills down to the step waiting for them. */
function AgentRun({ run, amount, deposit, word, statute, zone, trace }: { run: RunView; amount: number; deposit: number; word: string; statute: string; zone: string; trace?: boolean }) {
  const n = runNotes(run.items);
  const rows = agentRows(n.steps, { amount, deposit, word, proposedAt: run.proposedAt, zone });
  if (!rows.length && !n.summary.length) return null;
  const sight = (key: string, part: string) => (trace ? `run:${run.id}:${key}:${part}` : null);
  return (
    <>
      <GroupHead title="Done by the agent" right={atTextIn(run.startedAt, zone)} className="mt-4" />
      <ul>
        {rows.map((x, i) => (
          <li key={x.key} className="relative flex min-w-0 items-start gap-2.5 py-[7px] text-sm text-ink-2">
            {i < rows.length - 1 && (
              <StepLine done={x.state === "ok"} sight={sight(x.key, "line")} delay={i * STEP_MS + 200} className="absolute -bottom-[7px] left-[8.5px] top-[27px] w-px" />
            )}
            <span className="relative mt-px">{x.state === "ok" ? <StepMark small state="done" sight={sight(x.key, "check")} delay={i * STEP_MS} /> : <StateMark state={x.state} />}</span>
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
            {n.cites.length > 0 && <InfoTip title="Rules the agent relied on" cite={n.cites.join("; ")}>The parts of {statute} the agent checked this close-out against.</InfoTip>}
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

function Sent({ v, statute, zone }: { v: RefundView; statute: string; zone: string }) {
  const s = v.sent!;
  const word = s.kind === "payout" ? "Payout" : "Refund";
  const failed = s.tone === "red";
  const statementHref = `/tenancy/${v.tenancyId}/statement`;
  const d = v.statement.delivery;
  // The refund's own short timeline: prepared, approved, sent. Its last step is the one this page completes.
  const prepared = s.run?.proposedAt ?? s.run?.startedAt ?? null;
  const trail: { key: string; label: string; at: string }[] = failed ? [] : [
    ...(prepared ? [{ key: "prepared", label: "Prepared by the agent", at: prepared }] : []),
    ...(s.approvedAt ? [{ key: "approved", label: "Approved by you", at: s.approvedAt }] : []),
    { key: "sent", label: `Sent through PayPal`, at: s.at },
  ];
  // The success moment, the first time this viewer sees a refund sent in the last few minutes, after a click in the
  // browser (in practice: right after Send). In about 600 ms: the mark scales in and its check draws, the amount
  // settles, the timeline's last step completes, and the rest of the receipt fades in. Never on a receipt opened later
  // or by a full page load, never with reduced motion (Moment, motion.tsx, which judges "the last few minutes" in the
  // browser, so the page itself stays the same at any hour).
  const moment = !failed ? `sent:${v.tenancyId}:${s.paypalId ?? s.at}` : null;
  const last = trail.length - 1;
  return (
    <Moment sight={moment} since={s.at}>
      <h1 className="flex items-center gap-3 text-xl font-medium">
        <span data-moment="pop" className={`flex size-7 shrink-0 items-center justify-center rounded-full ${failed ? "bg-red-bg text-red" : "bg-green-bg text-green"}`}>
          <Icon data-moment="draw" data-delay="60" name={failed ? "alert" : "check"} className="size-[15px]" />
        </span>
        {failed ? `${word} did not go through` : `${word} sent`}
      </h1>
      <Lead to="To" v={v} />
      <div data-moment="rise" data-delay="80"><Money value={s.amount} className="mt-3 block text-2xl font-medium" /></div>
      {failed ? (
        <p className="mt-2 text-ink-3">Sent {atTextIn(s.at, zone)} through PayPal.</p>
      ) : (
        <ol className="mt-4" aria-label={`${word} timeline`}>
          {trail.map((t, i) => (
            <li key={t.key} className="relative grid grid-cols-[18px_minmax(0,1fr)_auto] items-start gap-x-2.5 pb-2.5 text-sm last:pb-0">
              {i < last && <span aria-hidden data-moment={i === last - 1 ? "grow-y" : undefined} data-delay="140" className="absolute -bottom-px left-[8.5px] top-[21px] w-px bg-green-dot/45" />}
              <span data-moment={i === last ? "pop" : undefined} data-delay="220" className="relative mt-px flex size-[18px] items-center justify-center rounded-full bg-green-bg text-green">
                <Icon data-moment={i === last ? "draw" : undefined} data-delay="260" name="check" className="size-3" />
              </span>
              <span className={i === last ? "text-ink" : "text-ink-2"}>{t.label}</span>
              <span className="whitespace-nowrap tabular-nums text-ink-3">{atTextIn(t.at, zone)}</span>
            </li>
          ))}
        </ol>
      )}

      <div data-moment="fade" data-delay="200">
      <Divider />
      <Rows rows={[
        ...(s.paypalId ? [[<><span className="max-sm:hidden">PayPal {s.kind === "payout" ? "payout" : "refund"} ID</span><span className="sm:hidden">{word} ID</span></>, <CopyId key="id" text={s.paypalId} label={`Copy the PayPal ${s.kind} ID`} />] as [ReactNode, ReactNode]] : []),
        ["Status", <StatusChip key="st" live tone={s.tone}>{s.status}</StatusChip>, s.fromPayPal ? `From PayPal, ${atTextIn(s.fromPayPal, zone)}` : undefined],
        ...partyRows(v),
        // The timeline above says who approved it and when; a refund that didn't go through says it here.
        ...(s.approvedAt && failed ? [["Approved by", "You", atTextIn(s.approvedAt, zone)] as [ReactNode, ReactNode, ReactNode]] : []),
      ]} />
      </div>

      <div data-moment="fade" data-delay="240" className="mt-7 rounded-lg border border-line-2 bg-surface px-5 py-4">
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

      <div data-moment="fade" data-delay="280" className="mt-7 flex flex-wrap items-center gap-2.5">
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
            <AgentRun run={s.run} amount={s.amount} deposit={s.deposit} word={s.kind} statute={statute} zone={zone} />
          </div>
        </details>
      )}
    </Moment>
  );
}

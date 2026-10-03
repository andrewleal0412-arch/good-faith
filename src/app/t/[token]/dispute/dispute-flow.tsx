"use client";

import { useRouter } from "next/navigation";
import { useEffect, useState, type ReactNode } from "react";
import { Button, buttonClass } from "@/components/button";
import { useConfirm } from "@/components/confirm";
import { FormField } from "@/components/field";
import { Icon } from "@/components/icons";
import { InfoTip, TipLabel } from "@/components/info-tip";
import { Money, Notice, StatusChip, inputClass, textareaClass } from "@/components/ui";
import type { AdvocateCase, Verdict } from "@/lib/advocate";
import { pacificDate, shortDate } from "@/lib/dates";
import type { DisputeLineView, DisputeStatus, TenantDisputeView } from "@/lib/disputes";
import { uploadPhotos } from "@/lib/uploads";

// The tenants' dispute, step by step on a phone: pick the charges and say why (with photos if they have them), ask
// their advocate, read the case it wrote charge by charge, and send it to the landlord, as the case or as their own
// reasons. Once sent, the same page shows what they sent. Every amount here was computed and checked on the server;
// this file only shows it.

const MAX_PHOTOS = 6;
const REASON_MAX = 600;
const MESSAGE_MAX = 1000;
/** While a run started elsewhere (another tab, or before a reload) is in progress, the page asks every few seconds,
 *  for a little longer than the server lets a run go before it may be started again. */
const POLL_MS = 4000;
const POLL_LIMIT = 90;

const usd = (n: number) => `$${n.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
const VERDICT: Record<Verdict, { label: string; tone: "gray" | "amber" | "red" }> = {
  solid: { label: "Looks solid", tone: "gray" },
  weak: { label: "Looks weak", tone: "amber" },
  unsupported: { label: "Not supported", tone: "amber" },
  unlawful: { label: "Not allowed", tone: "red" },
};
const CLOSED: Partial<Record<DisputeStatus, string>> = { settled: "Settled", no_agreement: "No agreement", withdrawn: "Withdrawn" };

export function DisputeFlow({ token, landlord, view, stateName, notLegalAdvice }: {
  token: string; landlord: string; view: TenantDisputeView; stateName: string; notLegalAdvice: string;
}) {
  const router = useRouter();
  const d = view.dispute;
  const runningOnLoad = !!d && d.status === "draft" && d.advocateStatus === "running";
  const [mode, setMode] = useState<"edit" | "working" | "case">(runningOnLoad ? "working" : d?.advocate && d.status === "draft" ? "case" : "edit");
  const [waiting, setWaiting] = useState(runningOnLoad); // a run this page didn't start: poll until it ends
  const [picked, setPicked] = useState<string[]>(d?.items.map((i) => i.deductionId) ?? []);
  const [reasons, setReasons] = useState<Record<string, string>>(Object.fromEntries(d?.items.map((i) => [i.deductionId, i.reason]) ?? []));
  const [message, setMessage] = useState(d?.message ?? "");
  const [name, setName] = useState(d?.openedBy ?? (view.tenants.length === 1 ? view.tenants[0] : ""));
  const [files, setFiles] = useState<Record<string, File[]>>({});
  const [fresh, setFresh] = useState<AdvocateCase | null>(null); // the case a run just returned, before the page refreshes
  const [edited, setEdited] = useState(false); // changes on this page not saved yet
  const [busy, setBusy] = useState<null | "save" | "send" | "remove">(null);
  const [error, setError] = useState(d?.advocateError && d.status === "draft" && !runningOnLoad ? "Your advocate couldn't finish last time. Try again." : "");
  const [confirm, dialog] = useConfirm();

  // A run in progress when the page loaded, or one a second tap found working: ask the server until it ends, then
  // show its case (or the form, if it failed).
  useEffect(() => {
    if (!waiting) return;
    let n = 0;
    let stopped = false;
    const t = setInterval(async () => {
      if (++n > POLL_LIMIT) {
        clearInterval(t);
        setWaiting(false);
        setMode("edit");
        setError("Your advocate is taking longer than it should. Try again in a few minutes.");
        return;
      }
      const r = await fetch(`/api/t/${token}/dispute`, { cache: "no-store" }).catch(() => null);
      const j = r?.ok ? await r.json().catch(() => null) : null;
      if (stopped || !j || j.advocateStatus === "running") return;
      clearInterval(t);
      setWaiting(false);
      if (j.advocate) {
        setFresh(j.advocate as AdvocateCase);
        setMode("case");
      } else setMode("edit");
      if (j.advocateError) setError("Your advocate couldn't finish. Try again in a minute.");
      router.refresh();
    }, POLL_MS);
    return () => { stopped = true; clearInterval(t); };
  }, [waiting, token, router]);

  const evidence = d?.evidence ?? [];
  const queued = picked.reduce((n, id) => n + (files[id]?.length ?? 0), 0);
  // A case this page just got and the refreshed view doesn't show yet stands in for the view's.
  const pending = !!fresh && fresh.at !== d?.advocate?.at;
  const advocate = pending ? fresh : d?.advocate ?? null;
  // The saved draft (or the statement's amounts) changed after the case was written: it can't be sent as it is.
  const serverStale = !pending && !!d?.stale;

  if (d && d.status !== "draft") return <Sent token={token} landlord={landlord} view={view} />;

  const problem = (): string => {
    if (!picked.length) return "Pick at least one charge.";
    const missing = view.lines.find((l) => picked.includes(l.id) && (reasons[l.id] ?? "").trim().length < 3);
    if (missing) return `Say why you dispute line ${missing.n}.`;
    if (!name) return "Pick your name.";
    if (evidence.length + queued > MAX_PHOTOS) return `A dispute can carry ${MAX_PHOTOS} photos.`;
    return "";
  };
  const change = () => setEdited(true);

  /** The draft as it stands on the page, then any photos picked since, so the server always has what the page shows. */
  async function save(): Promise<boolean> {
    const r = await fetch(`/api/t/${token}/dispute`, {
      method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ name, message, items: view.lines.filter((l) => picked.includes(l.id)).map((l) => ({ deductionId: l.id, reason: reasons[l.id] ?? "" })) }),
    });
    const j = await r.json().catch(() => ({}));
    if (!r.ok) { setError(j.error ?? "Couldn't save that. Try again."); return false; }
    for (const [deductionId, fs] of Object.entries(files)) {
      if (!fs.length || !picked.includes(deductionId)) continue;
      const up = await uploadPhotos(`/api/t/${token}/dispute/evidence`, { deductionId }, fs);
      if (!up.ok) { setError(up.error); return false; }
      setFiles((x) => ({ ...x, [deductionId]: [] }));
    }
    setEdited(false);
    return true;
  }

  async function askAdvocate() {
    const p = problem();
    if (p) return setError(p);
    setError("");
    setWaiting(false);
    setMode("working");
    if (!(await save())) return setMode("edit");
    const r = await fetch(`/api/t/${token}/dispute/advocate`, { method: "POST" }).catch(() => null);
    // The connection dropped (a phone that slept mid-run): the run goes on on the server, so wait for it there.
    if (!r) return setWaiting(true);
    const j = await r.json().catch(() => ({}));
    if (j.running) return setWaiting(true);
    if (!r.ok || !j.case) {
      setError(j.error ?? "Your advocate couldn't finish. Try again in a minute.");
      setMode(advocate ? "case" : "edit");
      router.refresh();
      return;
    }
    setFresh(j.case as AdvocateCase);
    setMode("case");
    router.refresh();
  }

  /** Send to the landlord: the advocate's case as the server holds it, or (from the form) the reasons on the page,
   *  saved first, without the case. */
  async function send(withCase: boolean) {
    if (!withCase) {
      const p = problem();
      if (p) return setError(p);
    }
    const sees = withCase
      ? `${landlord} sees your reasons, your photos and your advocate's case.${edited ? " Changes you haven't asked your advocate about aren't included." : ""}`
      : `${landlord} sees your reasons and your photos${advocate ? ", without your advocate's case" : ""}.`;
    const ok = await confirm({
      title: `Send to ${landlord}?`,
      body: `${sees} You can't change it after it's sent.${view.sendNote ? ` ${view.sendNote}` : ""}`,
      action: "Send",
    });
    if (!ok) return;
    setError("");
    setBusy("send");
    if (!withCase && !(await save())) return setBusy(null);
    const r = await fetch(`/api/t/${token}/dispute/send`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ withCase }) });
    const j = await r.json().catch(() => ({}));
    setBusy(null);
    if (!r.ok) {
      setError(j.error ?? "Couldn't send that. Try again.");
      router.refresh();
      return;
    }
    router.refresh();
  }

  async function removePhoto(id: string) {
    setBusy("remove");
    const r = await fetch(`/api/t/${token}/dispute/evidence/${id}`, { method: "DELETE" });
    const j = await r.json().catch(() => ({}));
    setBusy(null);
    if (!r.ok) return setError(j.error ?? "Couldn't remove that photo.");
    router.refresh();
  }

  const sendNote = view.sendNote && <p className="mt-3 text-center text-xs text-ink-3">{view.sendNote}</p>;

  if (mode === "working") {
    return (
      <div role="status" className="mt-6 rounded-lg border border-line-2 bg-surface px-4 py-5">
        <p className="flex items-center gap-2.5 font-medium">
          <span aria-hidden className="size-4 shrink-0 animate-spin rounded-full border-2 border-brand-100 border-t-brand" />
          Your advocate is reading your file
        </p>
        <ul className="mt-3 flex flex-col gap-1.5 text-sm text-ink-3">
          {["The itemized statement", "The photos and what the comparison found", "The math and the documents", `${stateName}'s rules`].map((s) => (
            <li key={s} className="flex items-center gap-2"><span className="size-1.5 rounded-full bg-ink-4" />{s}</li>
          ))}
        </ul>
        <p className="mt-3 text-xs text-ink-3">This takes about a minute. If you leave, it keeps going, and this page shows the case when you come back.</p>
      </div>
    );
  }

  if (mode === "case" && advocate) {
    return (
      <>
        <CaseView c={advocate} view={view} notLegalAdvice={notLegalAdvice} />
        {serverStale ? (
          <Notice tone="amber" className="mt-4">Your dispute changed after your advocate wrote this case. Ask again to bring it up to date, or edit and send your reasons as they are.</Notice>
        ) : edited ? (
          <Notice tone="amber" className="mt-4">You changed your dispute after your advocate wrote this. Ask again to include the change, or send the case as it was written.</Notice>
        ) : null}
        {error && <Notice className="mt-4">{error}</Notice>}
        <div className="mt-6 border-t border-line pt-6">
          {serverStale ? (
            <Button variant="primary" size="lg" className="h-11 w-full" disabled={!!busy} onClick={askAdvocate}>Ask my advocate again</Button>
          ) : (
            <Button variant="primary" size="lg" className="h-11 w-full" disabled={!!busy} onClick={() => send(true)}>
              <Icon name="send" />{busy === "send" ? "Sending..." : `Send to ${landlord}`}
            </Button>
          )}
          <div className="mt-2.5 flex flex-wrap justify-center gap-2">
            <Button size="sm" disabled={!!busy} onClick={() => { setError(""); setMode("edit"); }}>Edit your reasons</Button>
            {!serverStale && edited && <Button size="sm" disabled={!!busy} onClick={askAdvocate}>Ask again</Button>}
          </div>
          {sendNote}
          <p className="mt-4 text-center text-sm text-ink-3">{landlord}&apos;s answer comes back to this page. Nothing changes until you both agree.</p>
        </div>
        {dialog}
      </>
    );
  }

  return (
    <>
      {view.late.late && (
        <Notice tone="amber" className="mt-6">
          The statement {view.late.doubt ? "may have gone" : "went"} out after {stateName}&apos;s deadline.{" "}
          <InfoTip title="A late statement" cite={view.late.cite}>{view.late.text}</InfoTip>
        </Notice>
      )}

      <section className="mt-6">
        <h2 className="text-lg font-medium">Which charges?</h2>
        <p className="mt-0.5 text-sm text-ink-3">Pick the ones you dispute and say why.</p>
        <ul className="mt-3 rounded-lg border border-line">
          {view.lines.map((l) => {
            const on = picked.includes(l.id);
            const mine = evidence.filter((e) => e.deductionId === l.id);
            return (
              <li key={l.id} className="border-t border-line-2 px-4 py-3.5 first:border-t-0">
                <label className="flex cursor-pointer items-start gap-3">
                  <input type="checkbox" className="mt-[3px] size-[18px] shrink-0 accent-brand" checked={on}
                    onChange={(e) => {
                      const now = e.target.checked;
                      setPicked((x) => (now ? [...x, l.id] : x.filter((id) => id !== l.id)));
                      // Photos picked for a charge no longer disputed aren't sent, so they go now, not silently later.
                      if (!now) setFiles((x) => ({ ...x, [l.id]: [] }));
                      change();
                    }} />
                  <span className="min-w-0 flex-1">
                    <span className="block font-medium">{l.n}. {l.title}</span>
                    <span className="block text-sm text-ink-3">{[l.room, l.basis].filter(Boolean).join(". ")}.</span>
                  </span>
                  <Money value={l.amount} className="font-medium" />
                </label>
                {on && (
                  <div className="mt-3 flex flex-col gap-3 sm:pl-[30px]">
                    <FormField label="Why do you dispute it?" note={(reasons[l.id] ?? "").length > REASON_MAX - 150 ? `${(reasons[l.id] ?? "").length} of ${REASON_MAX}` : undefined}>
                      <textarea className={textareaClass} rows={4} maxLength={REASON_MAX} value={reasons[l.id] ?? ""}
                        placeholder="What's wrong with this charge, in your words"
                        onChange={(e) => { const v = e.target.value; setReasons((x) => ({ ...x, [l.id]: v })); change(); }} />
                    </FormField>
                    <Photos token={token} line={l} saved={mine} picked={files[l.id] ?? []} busy={!!busy}
                      room={MAX_PHOTOS - evidence.length - queued + (files[l.id]?.length ?? 0)}
                      onPick={(fs) => { setFiles((x) => ({ ...x, [l.id]: fs })); change(); }} onRemove={removePhoto} />
                  </div>
                )}
              </li>
            );
          })}
        </ul>
      </section>

      <section className="mt-6 flex flex-col gap-4">
        {view.tenants.length > 1 && (
          <FormField label="Your name">
            <select className={inputClass} value={name} onChange={(e) => setName(e.target.value)}>
              <option value="">Pick your name</option>
              {view.tenants.map((t) => <option key={t}>{t}</option>)}
            </select>
          </FormField>
        )}
        <FormField label={`Anything else for ${landlord}`} note="Optional.">
          <textarea className={textareaClass} rows={3} maxLength={MESSAGE_MAX} value={message}
            onChange={(e) => { setMessage(e.target.value); change(); }} />
        </FormField>
      </section>

      {error && <Notice className="mt-4">{error}</Notice>}

      <div className="mt-6 border-t border-line pt-6">
        <Button variant="primary" size="lg" className="h-11 w-full" disabled={!!busy || !picked.length} onClick={askAdvocate}>
          {advocate ? "Ask my advocate again" : "Ask my advocate"}
        </Button>
        <p className="mt-2.5 flex items-start justify-center gap-1.5 text-center text-sm text-ink-3">
          <span>It reads the statement, the photos and {stateName} law, and drafts your case for you to check.</span>
          <span className="mt-0.5 inline-flex"><InfoTip align="end" title="Your advocate">{notLegalAdvice}</InfoTip></span>
        </p>
        <div className="mt-3 flex flex-wrap justify-center gap-2">
          {advocate && <Button size="sm" disabled={!!busy} onClick={() => { setError(""); setMode("case"); }}>Back to the case</Button>}
          <button type="button" disabled={!!busy || !picked.length} onClick={() => send(false)} className={buttonClass("link", "sm")}>
            {busy === "send" ? "Sending..." : "Or send your reasons as they are"}
          </button>
        </div>
        {sendNote}
      </div>
      {dialog}
    </>
  );
}

/* ---------- Photos for one charge ---------- */

function Photos({ token, line, saved, picked, room, busy, onPick, onRemove }: {
  token: string; line: DisputeLineView; saved: { id: string; name: string }[]; picked: File[]; room: number; busy: boolean;
  onPick: (files: File[]) => void; onRemove: (id: string) => void;
}) {
  return (
    <div>
      {saved.length > 0 && (
        <ul className="mb-2 flex flex-wrap gap-2">
          {saved.map((e) => (
            <li key={e.id} className="relative">
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img src={`/api/t/${token}/dispute/evidence/${e.id}`} alt={`Your photo for line ${line.n}`} className="size-16 rounded-md border border-line bg-surface object-cover" />
              <button type="button" disabled={busy} onClick={() => onRemove(e.id)} aria-label={`Remove ${e.name}`}
                className="absolute -right-1.5 -top-1.5 inline-flex size-6 items-center justify-center rounded-full border border-line bg-canvas text-ink-2 shadow-sm hover:bg-surface">
                <Icon name="x" className="size-3" />
              </button>
            </li>
          ))}
        </ul>
      )}
      <label className={buttonClass("secondary", "sm", `cursor-pointer focus-within:ring-3 focus-within:ring-brand-100 ${room <= 0 ? "pointer-events-none opacity-50" : ""}`)}>
        <Icon name="camera" />{picked.length ? `${picked.length} photo${picked.length === 1 ? "" : "s"} to add` : "Add photos"}
        <input type="file" accept="image/*" multiple className="sr-only" disabled={room <= 0}
          onChange={(e) => onPick(Array.from(e.currentTarget.files ?? []).slice(0, Math.max(0, room)))} />
      </label>
      {picked.length > 0 && <p className="mt-1.5 text-xs text-ink-3">Added when you ask your advocate or send.</p>}
    </div>
  );
}

/* ---------- The advocate's case ---------- */

function CaseView({ c, view, notLegalAdvice }: { c: AdvocateCase; view: TenantDisputeView; notLegalAdvice: string }) {
  return (
    <>
      <section aria-label="Your advocate's case" className="mt-6">
        <p className="text-sm text-ink-3">Your advocate proposes back</p>
        <Money value={c.amountBack} className="mt-0.5 block text-2xl font-medium" />
        <p className="mt-1 text-sm text-ink-3">
          {view.statementRefund > 0 ? `On top of the ${usd(view.statementRefund)} refund on the statement, ` : ""}
          {view.statementRefund > 0 ? "from" : "From"} the {usd(view.totals.retained)} deducted.
        </p>
        <p className="mt-3 text-ink-2">{c.summary}</p>
        <p className="mt-2 flex items-center gap-1.5 text-xs text-ink-3">
          Not legal advice
          <InfoTip title="How this was checked">
            {notLegalAdvice} The app checked every amount against what the law and the record allow{c.adjustments.length ? ` and changed ${c.adjustments.length} of the advocate's answers to fit` : ""}.
          </InfoTip>
        </p>
      </section>
      <section className="mt-6 border-t border-line pt-5">
        <h2 className="mb-3 text-lg font-medium">Charge by charge</h2>
        <CaseLines c={c} view={view} />
      </section>
    </>
  );
}

function CaseLines({ c, view }: { c: AdvocateCase; view: TenantDisputeView }) {
  return (
    <ol>
      {c.lines.map((l) => {
        const v = VERDICT[l.verdict];
        const r = view.lines.find((x) => x.id === l.id);
        return (
          <li key={l.id} className="flex gap-3 border-t border-line-2 py-3 first:border-t-0 first:pt-0 last:pb-0">
            <span className="mt-px flex size-6 shrink-0 items-center justify-center rounded-sm bg-surface-2 text-xs font-semibold tabular-nums text-ink-3">{l.n}</span>
            <div className="min-w-0 flex-1">
              <p className="flex flex-wrap items-center gap-x-2 gap-y-1 font-medium">
                {l.title}
                <StatusChip tone={v.tone} dot={false} size="sm">{v.label}</StatusChip>
                {!l.disputed && l.verdict !== "solid" && <span className="text-xs font-normal text-ink-3">Not one you picked</span>}
              </p>
              <p className="mt-0.5 text-sm text-ink-3">
                {l.reason}{" "}
                <InfoTip trigger="why" align="end" title={l.title} cite={l.citation}>
                  {r?.reasons.join(" ")} The most the law and the record support for it: {usd(l.max)}.
                </InfoTip>
              </p>
            </div>
            <div className="shrink-0 text-right">
              <Money value={l.back} className="font-medium" />
              <p className="text-xs text-ink-3">back of {usd(l.amount)}</p>
            </div>
          </li>
        );
      })}
    </ol>
  );
}

/* ---------- Sent ---------- */

function Sent({ token, landlord, view }: { token: string; landlord: string; view: TenantDisputeView }) {
  const d = view.dispute!;
  const closed = CLOSED[d.status];
  return (
    <>
      <section aria-label="Where it stands" className="mt-6">
        <p className="text-sm text-ink-3">You asked back</p>
        <Money value={d.askedBack ?? 0} className="mt-0.5 block text-2xl font-medium" />
        {closed ? (
          <>
            <p className="mt-1.5 flex items-center gap-2 text-lg font-medium">
              <span aria-hidden className="inline-flex size-5 shrink-0 items-center justify-center rounded-full bg-surface-2 text-ink-3"><Icon name="check" className="size-3" /></span>
              Closed: {closed.toLowerCase()}{d.closedAt ? ` ${shortDate(pacificDate(d.closedAt))}` : ""}
            </p>
            <p className="mt-1.5 text-ink-2">This dispute is closed, and a statement is disputed here once.</p>
          </>
        ) : (
          <>
            <p className="mt-1.5 flex items-center gap-2 text-lg font-medium">
              <span aria-hidden className="inline-flex size-5 shrink-0 items-center justify-center rounded-full bg-amber-bg text-amber"><Icon name="clock" className="size-3" /></span>
              Sent to {landlord}{d.sentAt ? ` ${shortDate(pacificDate(d.sentAt))}` : ""}
            </p>
            <p className="mt-1.5 text-ink-2">Their answer comes back to this page. Nothing changes until you both agree.</p>
          </>
        )}
      </section>

      {d.sentWithCase && d.advocate && (
        <Block title="Your case">
          <p className="mb-3 text-sm text-ink-2">{d.advocate.summary}</p>
          <CaseLines c={d.advocate} view={view} />
        </Block>
      )}

      <Block title="Your reasons">
        <ul>
          {d.items.map((it) => {
            const l = view.lines.find((x) => x.id === it.deductionId);
            const photos = d.evidence.filter((e) => e.deductionId === it.deductionId);
            return (
              <li key={it.deductionId} className="border-t border-line-2 py-3 first:border-t-0 first:pt-0">
                <p className="font-medium">{l ? `${l.n}. ${l.title}` : "A charge no longer on the statement"}</p>
                <p className="mt-0.5 whitespace-pre-line text-sm text-ink-2">{it.reason}</p>
                {photos.length > 0 && (
                  <ul className="mt-2 flex flex-wrap gap-2">
                    {photos.map((e) => (
                      <li key={e.id}>
                        <a href={`/api/t/${token}/dispute/evidence/${e.id}`} target="_blank" rel="noreferrer" aria-label={`Your photo ${e.name}`}>
                          {/* eslint-disable-next-line @next/next/no-img-element */}
                          <img src={`/api/t/${token}/dispute/evidence/${e.id}`} alt="" className="size-14 rounded-md border border-line bg-surface object-cover" />
                        </a>
                      </li>
                    ))}
                  </ul>
                )}
              </li>
            );
          })}
        </ul>
        {d.message && <p className="mt-3 whitespace-pre-line border-t border-line-2 pt-3 text-sm text-ink-2">{d.message}</p>}
      </Block>

      <p className="mt-6 text-sm text-ink-3">
        <InfoTip trigger={<TipLabel>If you can&apos;t agree</TipLabel>} title={view.forum.name} cite={view.forum.cite}>{view.forum.text}</InfoTip>
      </p>
    </>
  );
}

function Block({ title, children }: { title: string; children: ReactNode }) {
  return (
    <section className="mt-6 border-t border-line pt-5">
      <h2 className="mb-3 text-lg font-medium">{title}</h2>
      {children}
    </section>
  );
}

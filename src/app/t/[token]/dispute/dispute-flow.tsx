"use client";

import { useRouter } from "next/navigation";
import { useEffect, useId, useState, type ReactNode } from "react";
import { Button, buttonClass, pickerFocus } from "@/components/button";
import { useConfirm } from "@/components/confirm";
import { FormField } from "@/components/field";
import { Icon } from "@/components/icons";
import { InfoTip, TipLabel } from "@/components/info-tip";
import { WorkingDots } from "@/components/motion";
import { NegotiationThread, Position } from "@/components/negotiation-thread";
import { Money, Notice, StatusChip, inputClass, textareaClass } from "@/components/ui";
import { useWatch } from "@/components/watch";
import type { AdvocateCase, Verdict } from "@/lib/advocate";
import { DEMO_EXAMPLE } from "@/lib/copy";
import { dateIn, PACIFIC, shortDate } from "@/lib/dates";
import { canWithdraw } from "@/lib/dispute-status";
import type { DisputeLineView, TenantDisputeView } from "@/lib/disputes";
import { CHECKED_NOTE, INJECTION_NOTE } from "@/lib/jev-notes";
import type { LoadedNegotiation } from "@/lib/negotiation";
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

/** A refused value marked on its field (WCAG 3.3.1): the red notice is an alert, read out as it appears; the field it
 *  names is aria-invalid and described by it, and takes focus, so the reader lands where the fix goes. The mark lasts
 *  while that error is the one shown (a server's error in its place unmarks it). `field` gives a control its mark:
 *  spread it on the input, inside its FormField. */
function useFieldError(error: string) {
  const errorId = useId();
  const [at, setAt] = useState<{ text: string; field: string } | null>(null);
  useEffect(() => {
    if (at) document.querySelector<HTMLElement>(`[data-field="${at.field}"]`)?.focus();
  }, [at]);
  const marked = at && at.text === error ? at.field : null;
  return {
    errorId,
    mark: (text: string, f: string | null) => setAt(f ? { text, field: f } : null),
    field: (f: string) => ({ "data-field": f, ...(marked === f ? { "aria-invalid": true, "aria-describedby": errorId } : {}) }),
    /** Whether the error on screen names this field: once the field is filled in, the caller takes the error down. */
    names: (f: string) => marked === f,
  };
}

const usd = (n: number) => `$${n.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
/** "Harbor View Rentals'", "Elena Marquez's". */
const possessive = (name: string) => (/s$/i.test(name) ? `${name}'` : `${name}'s`);
/** The advocate's verdict on each of the landlord's charges. The chip names the charge: on the tenants' own page a bare
 *  "Looks weak" beside a line they dispute read as their dispute being weak, the opposite of what it says. */
const VERDICT: Record<Verdict, { label: string; tone: "gray" | "amber" | "red" }> = {
  solid: { label: "Charge looks solid", tone: "gray" },
  weak: { label: "Charge looks weak", tone: "amber" },
  unsupported: { label: "Charge not supported", tone: "amber" },
  unlawful: { label: "Charge not allowed", tone: "red" },
};

export function DisputeFlow({ token, landlord, view, stateName, notLegalAdvice, negotiation, zone = PACIFIC }: {
  token: string; landlord: string; view: TenantDisputeView; stateName: string; notLegalAdvice: string; negotiation: LoadedNegotiation | null;
  zone?: string; // the property's time zone (its state pack's), which the dispute's dates are shown in
}) {
  const router = useRouter();
  const d = view.dispute;
  // A dispute the tenants withdrew can be opened again: a new one of the same statement, its form filled in from the
  // withdrawn one's charges and reasons (photos are added again). `draft` is the dispute being written, if any.
  const [again, setAgain] = useState(false);
  const draft = d?.status === "draft" ? d : null;
  const reopening = again && d?.status === "withdrawn"; // until the first save makes the new draft
  const runningOnLoad = !!draft && draft.advocateStatus === "running";
  const [mode, setMode] = useState<"edit" | "working" | "case">(runningOnLoad ? "working" : draft?.advocate ? "case" : "edit");
  const [waiting, setWaiting] = useState(runningOnLoad); // a run this page didn't start: poll until it ends
  const [picked, setPicked] = useState<string[]>(d?.items.map((i) => i.deductionId) ?? []);
  const [reasons, setReasons] = useState<Record<string, string>>(Object.fromEntries(d?.items.map((i) => [i.deductionId, i.reason]) ?? []));
  const [message, setMessage] = useState(d?.message ?? "");
  const [name, setName] = useState(d?.openedBy ?? (view.tenants.length === 1 ? view.tenants[0] : ""));
  const [files, setFiles] = useState<Record<string, File[]>>({});
  const [fresh, setFresh] = useState<AdvocateCase | null>(null); // the case a run just returned, before the page refreshes
  const [edited, setEdited] = useState(false); // changes on this page not saved yet
  const [busy, setBusy] = useState<null | "save" | "send" | "remove">(null);
  const [error, setError] = useState(draft?.advocateError && !runningOnLoad ? "Your advocate couldn't finish last time. Try again." : "");
  const [confirm, dialog] = useConfirm();
  const fe = useFieldError(error);

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

  const evidence = draft?.evidence ?? [];
  const queued = picked.reduce((n, id) => n + (files[id]?.length ?? 0), 0);
  // A case this page just got and the refreshed view doesn't show yet stands in for the view's.
  const pending = !!fresh && fresh.at !== draft?.advocate?.at;
  const advocate = pending ? fresh : draft?.advocate ?? null;
  // The saved draft (or the statement's amounts) changed after the case was written: it can't be sent as it is.
  const serverStale = !pending && !!draft?.stale;

  if (d && !draft && !reopening) {
    return <Sent token={token} landlord={landlord} view={view} negotiation={negotiation} zone={zone} onAgain={d.status === "withdrawn" ? () => { setError(""); setAgain(true); } : undefined} />;
  }

  /** What stops the form going, and the field it names, if one does. */
  const problem = (): { text: string; field: string | null } | null => {
    if (!picked.length) return { text: "Pick at least one charge.", field: null };
    const missing = view.lines.find((l) => picked.includes(l.id) && (reasons[l.id] ?? "").trim().length < 3);
    if (missing) return { text: `Say why you dispute line ${missing.n}.`, field: `reason-${missing.id}` };
    if (!name) return { text: "Pick your name.", field: "name" };
    if (evidence.length + queued > MAX_PHOTOS) return { text: `A dispute can carry ${MAX_PHOTOS} photos.`, field: null };
    return null;
  };
  const refuse = (p: { text: string; field: string | null }) => { fe.mark(p.text, p.field); setError(p.text); };
  const change = () => setEdited(true);
  /** A name picked answers "Pick your name.", so that message goes with the pick, not at the next press. */
  const pickedName = (v: string) => { setName(v); if (v && fe.names("name")) setError(""); };

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
    if (p) return refuse(p);
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
      if (p) return refuse(p);
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
          Your advocate is reading your file
          <WorkingDots className="text-ink-4" />
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
        {error && <Notice id={fe.errorId} className="mt-4">{error}</Notice>}
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
      {reopening && (
        <Notice tone="gray" className="mt-6">A new dispute of the same statement. Your reasons from the withdrawn one are filled in; add any photos again.</Notice>
      )}
      {view.late.late && (
        <Notice tone="amber" className="mt-6">
          This statement {view.late.doubt ? "may be" : "is"} late under {stateName}&apos;s deadline.{" "}
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
                      <textarea className={textareaClass} rows={4} maxLength={REASON_MAX} value={reasons[l.id] ?? ""} {...fe.field(`reason-${l.id}`)}
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
            <select className={inputClass} value={name} onChange={(e) => pickedName(e.target.value)} {...fe.field("name")}>
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

      {error && <Notice id={fe.errorId} className="mt-4">{error}</Notice>}

      <div className="mt-6 border-t border-line pt-6">
        {/* Both ways forward are off until a charge is picked, so the page says so rather than leaving two gray buttons. */}
        {!picked.length && <p className="mb-3 text-center text-sm text-ink-3">Pick a charge above first.</p>}
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
              <img loading="lazy" decoding="async" src={`/api/t/${token}/dispute/evidence/${e.id}?size=thumb`} alt={`Your photo for line ${line.n}`} className="size-16 rounded-md border border-line bg-surface object-cover" />
              <button type="button" disabled={busy} onClick={() => onRemove(e.id)} aria-label={`Remove ${e.name}`}
                className="absolute -right-1.5 -top-1.5 inline-flex size-6 items-center justify-center rounded-full border border-line bg-canvas text-ink-2 shadow-sm transition-colors hover:bg-surface">
                <Icon name="x" className="size-3" />
              </button>
            </li>
          ))}
        </ul>
      )}
      <label className={buttonClass("secondary", "sm", `${pickerFocus} ${room <= 0 ? "pointer-events-none opacity-50" : ""}`)}>
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
  // The answers the app changed; the note on instructions aimed at an AI changes none, so it is told apart.
  const changed = c.adjustments.filter((a) => a !== INJECTION_NOTE);
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
            {notLegalAdvice} The app checked every amount against what the law and the record allow{changed.length ? ` and changed ${changed.length} of the advocate's answers to fit: ${changed.join(" ")}` : "."}
            {c.support ? ` ${CHECKED_NOTE}` : ""}{c.adjustments.includes(INJECTION_NOTE) ? ` ${INJECTION_NOTE}` : ""}
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

/** The dispute once sent: where it stands (the landlord's answer, the settlement to accept, no agreement and what the
 *  state's process is, or withdrawn with the way to dispute again), the negotiation turn by turn, and what the tenants
 *  sent. While it is open they may withdraw it. */
function Sent({ token, landlord, view, negotiation, zone, onAgain }: {
  token: string; landlord: string; view: TenantDisputeView; negotiation: LoadedNegotiation | null; zone: string; onAgain?: () => void;
}) {
  const router = useRouter();
  const dayOf = (ts: string) => dateIn(ts, zone); // the day where the property is
  const d = view.dispute!;
  const n = negotiation;
  const s = n?.settlement ?? null;
  const [name, setName] = useState(d.openedBy ?? (view.tenants.length === 1 ? view.tenants[0] : ""));
  const [busy, setBusy] = useState<null | "accept" | "offer" | "withdraw">(null);
  const [error, setError] = useState("");
  const [offerOpen, setOfferOpen] = useState(false);
  const [amount, setAmount] = useState("");
  const [message, setMessage] = useState("");
  const [confirm, dialog] = useConfirm();
  const fe = useFieldError(error);
  const refuse = (text: string, field: string) => { fe.mark(text, field); setError(text); };

  const settled = !!n && (n.status === "settled" || s?.status === "sent");
  // For as long as the landlord may still move it (their negotiator's answer, an offer, the approval and the payment:
  // any sent dispute that isn't settled or withdrawn), the page asks every few seconds and refreshes when something
  // changed, and while the two agents negotiate it shows each turn as it lands (components/watch.ts). So "Their answer
  // comes back to this page" holds without a reload.
  useWatch({
    on: !!n && !settled && n.status !== "withdrawn",
    url: `/api/t/${token}/dispute`,
    stamp: n?.stamp ?? "",
    running: !!n?.running,
  });
  // The tenants may take back a dispute that is still live, except while the agents run, once they accepted a
  // settlement, or while its payment is on its way (the server checks the same under the dispute's lock).
  const withdrawable = !!n && !settled && canWithdraw({
    status: n.status, running: n.running,
    settlement: s ? { status: s.status, tenantAccepted: !!s.tenantAcceptedAt, unconfirmed: s.unconfirmed } : null,
  });
  const offered = n?.landlordBack ?? null;
  const live = !!n && ["open", "negotiating", "no_agreement", "agreed"].includes(n.status) && !n.running && s?.status !== "sending" && !s?.unconfirmed && !settled;
  const lo = Math.min(offered ?? 0, n?.tenantBack ?? 0), hi = Math.max(offered ?? 0, n?.tenantBack ?? 0);
  // New York after day 14: the statement's refund is the whole deposit, so what is agreed is already inside it.
  const inWhole = s?.wholeBack ? "The whole deposit already went back to you with the statement's refund"
    : n?.wholeOwed ? "The statement's refund to you is the whole deposit" : null;
  // A lawful range of one figure (New York after day 14: every charge $0) leaves no other offer once both are at it.
  const noOtherOffer = !!n && n.maxBack - n.minBack < 0.005;
  const names = { landlord, tenants: "The tenants" };
  /** A name picked answers "Pick your name.", so that message goes with the pick, not at the next press. */
  const pickedName = (v: string) => { setName(v); if (v && fe.names("name")) setError(""); };
  const pickName = view.tenants.length > 1 && (
    <FormField label="Your name">
      <select className={inputClass} value={name} onChange={(e) => pickedName(e.target.value)} {...fe.field("name")}>
        <option value="">Pick your name</option>
        {view.tenants.map((t) => <option key={t}>{t}</option>)}
      </select>
    </FormField>
  );

  async function post(path: string, body: unknown): Promise<boolean> {
    setError("");
    const r = await fetch(`/api/t/${token}/dispute/${path}`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) }).catch(() => null);
    const j = r ? await r.json().catch(() => ({})) : {};
    if (!r?.ok) { setError(j.error ?? "Couldn't send that. Try again."); return false; }
    return true;
  }

  async function acceptSettlement() {
    if (!s) return;
    if (!name) return refuse("Pick your name.", "name");
    const ok = await confirm({
      title: `Accept ${usd(s.amount)} back?`,
      body: inWhole
        ? `${inWhole}, so this moves no more money: it records that the charges were given back. ${landlord} then approves it. You can't change it after you accept.`
        : `${landlord} then approves it, and the money goes back to you through PayPal, on top of the statement's refund. You can't change it after you accept.`,
      action: "Accept settlement",
    });
    if (!ok) return;
    setBusy("accept");
    await post("accept", { name });
    setBusy(null);
    router.refresh();
  }

  async function acceptOffer() {
    if (offered == null) return;
    if (!name) return refuse("Pick your name.", "name");
    const ok = await confirm({
      title: `Accept ${usd(offered)} back?`,
      body: inWhole
        ? `That settles your dispute once ${landlord} approves it. ${inWhole}, so no more money moves.`
        : `That settles your dispute once ${landlord} approves it. The money then goes back to you through PayPal, on top of the statement's refund.`,
      action: "Accept offer",
    });
    if (!ok) return;
    setBusy("accept");
    await post("offer", { accept: true, name });
    setBusy(null);
    router.refresh();
  }

  async function withdraw() {
    if (!name) return refuse("Pick your name.", "name");
    const ok = await confirm({
      title: "Withdraw your dispute?",
      body: `The statement then stands as ${landlord} sent it, and ${landlord} sees that you withdrew it. You can dispute it again later from this page.`,
      action: "Withdraw",
    });
    if (!ok) return;
    setBusy("withdraw");
    await post("withdraw", { name });
    setBusy(null);
    router.refresh();
  }

  async function counter() {
    const amt = Number(amount.replace(/[$,\s]/g, ""));
    if (amount.trim() === "" || !Number.isFinite(amt)) return refuse("Enter how much you ask back.", "amount");
    if (!name) return refuse("Pick your name.", "name");
    setBusy("offer");
    const ok = await post("offer", { amount: amt, message: message.trim() || null, name });
    setBusy(null);
    if (ok) { setOfferOpen(false); setAmount(""); setMessage(""); }
    router.refresh();
  }

  let hero: ReactNode;
  if (n?.status === "withdrawn" || (!n && d.status === "withdrawn")) {
    hero = (
      <>
        <p className="text-sm text-ink-3">You asked back</p>
        <Money value={d.askedBack ?? 0} className="mt-0.5 block text-2xl font-medium" />
        <p className="mt-1.5 flex items-center gap-2 text-lg font-medium">
          <span aria-hidden className="inline-flex size-5 shrink-0 items-center justify-center rounded-full bg-surface-2 text-ink-3"><Icon name="x" className="size-3" /></span>
          Withdrawn{d.closedAt ? ` ${shortDate(dayOf(d.closedAt))}` : ""}
        </p>
        <p className="mt-1.5 text-ink-2">You withdrew this dispute, so the statement stands as {landlord} sent it. You can dispute it again.</p>
        {onAgain && <Button variant="primary" size="lg" className="mt-4 h-11 w-full" onClick={onAgain}>Dispute again</Button>}
      </>
    );
  } else if (settled && s) {
    hero = (
      <>
        <p className="text-sm text-ink-3">Settled</p>
        <Money value={s.wholeBack ? 0 : s.amount} className="mt-0.5 block text-2xl font-medium" />
        <p className="mt-1.5 flex items-center gap-2 text-lg font-medium">
          <span aria-hidden className="inline-flex size-5 shrink-0 items-center justify-center rounded-full bg-green-bg text-green"><Icon name="check" className="size-3" /></span>
          {s.example ? `Settled${s.sentAt ? ` ${shortDate(dayOf(s.sentAt))}` : ""}` : s.amount > 0 && !s.wholeBack ? `Sent by PayPal${s.sentAt ? ` ${shortDate(dayOf(s.sentAt))}` : ""}` : "Settled"}
        </p>
        <p className="mt-1.5 text-ink-2">
          {s.example ? `Back to you on top of the statement's refund. ${DEMO_EXAMPLE.tenant}`
            : s.wholeBack ? "The whole deposit already went back to you with the statement's refund, so no more money moved."
              : s.amount > 0 ? `Back to you on top of the statement's refund${s.paypalId ? `, PayPal ${s.rail === "payout" ? "payout" : "refund"} ${s.paypalId}` : ""}.` : "The deposit was used in full, so no money moved; the balance claimed went down."} The amended statement records it.
        </p>
      </>
    );
  } else if (n?.status === "agreed" && s) {
    hero = (
      <>
        <p className="text-sm text-ink-3">{s.tenantAcceptedAt ? "You accepted" : "Settlement offered"}</p>
        <Money value={s.amount} className="mt-0.5 block text-2xl font-medium" />
        <p className="mt-1.5 flex items-center gap-2 text-lg font-medium">
          <span aria-hidden className="inline-flex size-5 shrink-0 items-center justify-center rounded-full bg-amber-bg text-amber"><Icon name="clock" className="size-3" /></span>
          {s.unconfirmed || s.status === "sending" ? "PayPal is confirming the payment" : s.tenantAcceptedAt ? `Waiting for ${landlord} to approve` : "Both sides agree"}
        </p>
        <p className="mt-1.5 text-ink-2">
          {s.unconfirmed || s.status === "sending"
            ? `${landlord} approved it, and the payment through PayPal is being confirmed. This page shows it once PayPal does.`
            : s.tenantAcceptedAt
              ? `${s.tenantName ?? "You"} accepted it ${shortDate(dayOf(s.tenantAcceptedAt))}. ${inWhole ? `${inWhole}, so no more money moves; ${landlord} approves it to settle the dispute.` : `It goes back to you through PayPal once ${landlord} approves it.`}`
              : inWhole ? `${inWhole}, so this moves no more money: it records that the charges were given back. Nothing changes until you accept it and ${landlord} approves it.`
                : `Back to you on top of the statement's refund. Nothing moves until you accept it and ${landlord} approves it.`}
        </p>
        {!s.tenantAcceptedAt && (
          <div className="mt-4 flex flex-col gap-3">
            {pickName}
            <Button variant="primary" size="lg" className="h-11 w-full" disabled={!!busy} onClick={acceptSettlement}>
              {busy === "accept" ? "Accepting..." : "Accept settlement"}
            </Button>
          </div>
        )}
      </>
    );
  } else if (n?.status === "no_agreement") {
    hero = (
      <>
        <p className="text-sm text-ink-3">No agreement</p>
        <div className="mt-1 grid grid-cols-2 gap-x-4">
          <Position label={`${possessive(landlord)} last offer`} value={offered ?? 0} sub="Back to you" />
          <Position label="Your last ask" value={n.tenantBack} />
        </div>
        <div className="mt-4 rounded-lg border border-line-2 bg-surface px-4 py-3.5">
          <p className="flex items-center gap-1.5 font-medium">
            What happens next
            <InfoTip align="end" title={n.forum.name} cite={n.forum.cite}>Not legal advice. This is the state&apos;s process as the law describes it, not a judgment of your case.</InfoTip>
          </p>
          <p className="mt-1 text-sm text-ink-2">Either of you can still make an offer here. {n.forum.text}</p>
          <a href={n.courtsGuide.url} target="_blank" rel="noreferrer" className="mt-2 inline-flex items-center gap-1 text-sm font-medium text-brand hover:underline">
            {n.courtsGuide.label}<Icon name="arrow-up-right" className="size-3.5" />
          </a>
        </div>
      </>
    );
  } else if (offered != null && n) {
    hero = (
      <>
        <p className="text-sm text-ink-3">{landlord} offers back</p>
        <Money value={offered} className="mt-0.5 block text-2xl font-medium" />
        <p className="mt-1.5 flex items-center gap-2 text-lg font-medium">
          <span aria-hidden className="inline-flex size-5 shrink-0 items-center justify-center rounded-full bg-amber-bg text-amber"><Icon name="clock" className="size-3" /></span>
          {n.running ? "The agents are negotiating" : `You ask ${usd(n.tenantBack)}`}
        </p>
        <p className="mt-1.5 text-ink-2">
          {n.running ? "Each turn appears below as it is made." : "Accept it, or answer with your own figure. Nothing changes until you both agree."}
        </p>
      </>
    );
  } else {
    hero = (
      <>
        <p className="text-sm text-ink-3">You asked back</p>
        <Money value={d.askedBack ?? 0} className="mt-0.5 block text-2xl font-medium" />
        <p className="mt-1.5 flex items-center gap-2 text-lg font-medium">
          <span aria-hidden className="inline-flex size-5 shrink-0 items-center justify-center rounded-full bg-amber-bg text-amber"><Icon name="clock" className="size-3" /></span>
          {`Sent to ${landlord}${d.sentAt ? ` ${shortDate(dayOf(d.sentAt))}` : ""}`}
        </p>
        <p className="mt-1.5 text-ink-2">
          {n?.running ? "The agents are negotiating. Each turn appears below as it is made." : "Their answer comes back to this page. Nothing changes until you both agree."}
        </p>
      </>
    );
  }

  return (
    <>
      <section aria-label="Where it stands" className="mt-6">{hero}</section>

      {error && <Notice id={fe.errorId} className="mt-4">{error}</Notice>}

      {live && offered != null && !(n?.status === "agreed") && (
        <div className="mt-4 flex flex-col gap-3">
          {!offerOpen && pickName}
          {!offerOpen ? (
            <div className="flex flex-col gap-2 sm:flex-row">
              {offered > 0 && (
                <Button variant="primary" size="lg" className="h-11 w-full sm:w-auto sm:flex-1" disabled={!!busy} onClick={acceptOffer}>
                  {busy === "accept" ? "Accepting..." : `Accept ${usd(offered)} back`}
                </Button>
              )}
              <Button variant={offered > 0 ? "secondary" : "primary"} size="lg" className="h-11 w-full sm:w-auto sm:flex-1" disabled={!!busy} onClick={() => setOfferOpen(true)}>Make an offer</Button>
            </div>
          ) : (
            <div className="flex flex-col gap-3 rounded-lg border border-line px-4 py-3.5">
              <FormField label="You ask back" note={lo === hi ? `Both sides are at ${usd(lo)}.` : `Between ${usd(lo)} and ${usd(hi)}.`}>
                <input className={inputClass} inputMode="decimal" value={amount} onChange={(e) => setAmount(e.target.value)} {...fe.field("amount")} />
              </FormField>
              <FormField label={`Message to ${landlord}`} note="Optional.">
                <textarea className={textareaClass} rows={2} maxLength={500} value={message} onChange={(e) => setMessage(e.target.value)} />
              </FormField>
              {pickName}
              <div className="flex flex-wrap gap-2">
                <Button variant="primary" disabled={!!busy} onClick={counter}>{busy === "offer" ? "Sending..." : "Send offer"}</Button>
                <Button variant="link" disabled={!!busy} onClick={() => { setOfferOpen(false); setError(""); }}>Cancel</Button>
              </div>
            </div>
          )}
        </div>
      )}
      {live && n?.status === "agreed" && s && !s.tenantAcceptedAt && !noOtherOffer && (
        <p className="mt-3 text-center text-sm">
          <button type="button" className="font-medium text-brand hover:underline" disabled={!!busy} onClick={() => setOfferOpen(true)}>Or make a different offer</button>
        </p>
      )}
      {live && n?.status === "agreed" && offerOpen && (
        <div className="mt-3 flex flex-col gap-3 rounded-lg border border-line px-4 py-3.5">
          <FormField label="You ask back" note={`Between ${usd(n.minBack)} and ${usd(n.maxBack)}. Any other figure withdraws from the ${usd(s?.amount ?? 0)} agreed.`}>
            <input className={inputClass} inputMode="decimal" value={amount} onChange={(e) => setAmount(e.target.value)} {...fe.field("amount")} />
          </FormField>
          <FormField label={`Message to ${landlord}`} note="Optional.">
            <textarea className={textareaClass} rows={2} maxLength={500} value={message} onChange={(e) => setMessage(e.target.value)} />
          </FormField>
          <div className="flex flex-wrap gap-2">
            <Button variant="primary" disabled={!!busy} onClick={counter}>{busy === "offer" ? "Sending..." : "Send offer"}</Button>
            <Button variant="link" disabled={!!busy} onClick={() => { setOfferOpen(false); setError(""); }}>Cancel</Button>
          </div>
        </div>
      )}

      {n && n.turns.length > 0 && (
        <Block title="The negotiation">
          <p className="mb-1 flex items-center gap-1.5 text-sm text-ink-3">
            Your advocate and {possessive(landlord)} negotiator, turn by turn
            <InfoTip align="end" title="Two agents, inside the law">
              Your advocate, a Claude agent working for you, answers {possessive(landlord)} negotiator, a Claude agent working for them. The app holds every figure to what the law and the record allow, allows three exchanges at most, and nothing takes effect until you accept and {landlord} approves. Not legal advice.
            </InfoTip>
          </p>
          <NegotiationThread turns={n.turns} perspective="tenant" names={names}
            working={n.running ? (n.turns[n.turns.length - 1]?.side === "landlord" ? "tenant" : "landlord") : null} />
        </Block>
      )}

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
                          <img loading="lazy" decoding="async" src={`/api/t/${token}/dispute/evidence/${e.id}?size=thumb`} alt="" className="size-14 rounded-md border border-line bg-surface object-cover" />
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

      {n?.status !== "no_agreement" && !settled && d.status !== "withdrawn" && (
        <p className="mt-6 flex flex-wrap items-center gap-x-4 gap-y-2 text-sm text-ink-3">
          <InfoTip trigger={<TipLabel>If you can&apos;t agree</TipLabel>} title={view.forum.name} cite={view.forum.cite}>{view.forum.text} Not legal advice. This is the state&apos;s process as the law describes it, not a judgment of your case.</InfoTip>
          {withdrawable && (
            <button type="button" disabled={!!busy} onClick={withdraw} className="ml-auto font-medium text-ink-2 hover:text-ink hover:underline disabled:opacity-50">
              {busy === "withdraw" ? "Withdrawing..." : "Withdraw dispute"}
            </button>
          )}
        </p>
      )}
      {dialog}
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

"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { Button } from "@/components/button";
import { Icon } from "@/components/icons";
import { InfoTip, TipLabel } from "@/components/info-tip";
import { Card, Fact, FactStrip, KV, Money, Notice, StatusChip, inlineInputClass, type Tone } from "@/components/ui";
import { DEMO_LEASE_FILE } from "@/lib/demo-lease";
import type { Flag, LeaseTerms } from "@/lib/rules";
import { isSupported, packFor, SUPPORTED, STATE_NAMES, supportedNames, unsupportedMessage } from "@/lib/states";
import { CA } from "@/lib/states/ca";
import type { LawfulDeposit, ClientPack } from "@/lib/states/types";
import { mb, UPLOAD_BUDGET, uploadError } from "@/lib/uploads";

type Result = {
  terms: LeaseTerms; totalSecurity: number; smallLandlordExempt: boolean | null; flags: Flag[];
  leasePath: string | null; lawfulDeposit: LawfulDeposit | null;
  state: string | null; supported: boolean; refusal: string | null; // the state the lease is for, and whether it has a pack
};

const usd = (n: number | null | undefined) =>
  n == null ? "Not stated" : `$${n.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
const shortDay = (iso: string | null | undefined) =>
  iso ? new Date(`${iso.slice(0, 10)}T12:00:00Z`).toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric", timeZone: "UTC" }) : null;

const SEVERITY: Record<Flag["severity"] | "note", { label: string; plural: string; tone: Tone }> = {
  violation: { label: "Violation", plural: "violations", tone: "red" },
  warning: { label: "Warning", plural: "warnings", tone: "amber" },
  info: { label: "Required step", plural: "required steps", tone: "gray" },
  note: { label: "Note", plural: "notes", tone: "gray" },
};

/** A flag's row label: an info flag a pack marks as a note reads "Note", not "Required step". */
const kindOf = (f: Flag) => (f.severity === "info" && f.note ? "note" : f.severity);

/** One short fact under a finding's title, from the terms the rules read. The rule and the lease's own words are its
 *  Why? tip, so a quote is never repeated (or cut off) here. */
function factOf(f: Flag, r: Result): string | null {
  const t = r.terms;
  if (f.fact) return f.fact;
  switch (f.id) {
    case "D3": return r.lawfulDeposit ? `Lease asks ${usd(r.lawfulDeposit.charged)}, cap ${usd(r.lawfulDeposit.cap)}` : null;
    case "D4": return t.monthlyRent ? `Cap is ${usd(t.monthlyRent)} or ${usd(t.monthlyRent * 2)}` : null;
    case "D8": {
      // The charge the quote calls nonrefundable, when the extraction tied one to it.
      const q = (f.quote ?? "").toLowerCase();
      const c = t.otherMoveInCharges.find((x) => q.includes(x.label.toLowerCase())) ?? t.otherMoveInCharges.find((x) => x.refundable === false);
      return c ? `${c.label}, ${usd(c.amount)}` : "Labeled nonrefundable";
    }
    case "D10": return "Required at every move-out";
    case "D26": {
      const fee = t.lateFee;
      if (!fee) return null;
      const what = fee.percentOfRent != null ? `${fee.percentOfRent}% of rent` : fee.amount != null ? usd(fee.amount) : "A late fee";
      return `${what}${fee.deductibleFromDeposit ? ", taken from the deposit" : ""}`;
    }
    case "D13": return t.tenancyStartDate ? `Tenancy starts ${shortDay(t.tenancyStartDate)}` : null;
    case "D16": return t.electronicPaymentMethods.length ? `Tenants can pay by ${t.electronicPaymentMethods.join(", ")}` : null;
    case "D19": return t.tenants.join(", ");
    default: return null;
  }
}

/** The lease page's four steps, each name opening its tip (seven info icons on an empty page read as chrome). */
function Steps({ pack }: { pack: ClientPack }) {
  return (
    <ol className="mb-6 grid grid-cols-2 gap-2 lg:grid-cols-4">
      {pack.lease.steps.map((s, i) => (
        <li key={s.title} className="flex items-center gap-2.5 rounded-md border border-line px-3 py-2.5">
          <span className={`flex size-5 shrink-0 items-center justify-center rounded-full text-xs font-medium ${i === 0 ? "bg-brand text-white" : "bg-surface-2 text-ink-3"}`}>{i + 1}</span>
          <span className="min-w-0 flex-1 text-sm font-medium">
            <InfoTip trigger={<TipLabel>{s.title}</TipLabel>} align={i % 2 ? "end" : "start"} title={s.title} cite={s.cite}>{s.text}</InfoTip>
          </span>
        </li>
      ))}
    </ol>
  );
}

/** The three rules the state is known for, under the check, named for their state: before a lease is read they are
 *  California's, and the line says so, so a Texas lease's check never reads as if California's rules applied to it. */
function Law({ pack, read }: { pack: ClientPack; read: boolean }) {
  return (
    <>
    <p className="mt-6 text-xs text-ink-3">{read ? `${pack.name} rules` : `${pack.name} rules, until a lease's state is read`}</p>
    <Card soft className="mt-2 grid divide-y divide-line-2 sm:grid-cols-3 sm:divide-x sm:divide-y-0">
      {pack.lease.law.map((l, i) => (
        <div key={l.label} className="px-4 py-3">
          <div className="text-sm font-medium">
            <InfoTip trigger={<TipLabel>{l.label}</TipLabel>} align={i === 2 ? "end" : "start"} title={l.label} cite={l.cite}>{l.fact}</InfoTip>
          </div>
          <div className="mt-0.5 text-xs text-ink-3">{l.line}</div>
        </div>
      ))}
    </Card>
    </>
  );
}

// The lease page's steps, the check and the three facts under it, in the words of the state whose lease is on screen:
// California's until a lease from another supported state is read.
export function LeaseCheck() {
  const [code, setCode] = useState<string | null>(null);
  const read = !!code && isSupported(code);
  const shown = read ? packFor(code) : CA;
  return (
    <>
      <Steps pack={shown} />
      <Check code={code} setCode={setCode} />
      <Law pack={shown} read={read} />
    </>
  );
}

function Check({ code, setCode }: { code: string | null; setCode: (c: string | null) => void }) {
  const [state, setState] = useState<"idle" | "reading" | "done" | "error">("idle");
  const [result, setResult] = useState<Result | null>(null);
  const [error, setError] = useState("");
  const [startError, setStartError] = useState("");
  const [fileName, setFileName] = useState("");
  const [sample, setSample] = useState(false); // the result is the sample lease's, from the facts read when the demo was built
  const [dragging, setDragging] = useState(false);
  const [starting, setStarting] = useState(false);
  const router = useRouter();

  async function startTenancy() {
    if (!result) return;
    setStarting(true);
    setStartError("");
    try {
      const r = await fetch("/api/tenancies", {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ terms: result.terms, leasePath: result.leasePath, state: code }),
      });
      const j = await r.json().catch(() => ({}));
      if (!r.ok) throw new Error(j.error ?? "Couldn't start the tenancy. Try again.");
      // In a copy of the demo a lease that already has a tenancy opens it instead of starting a second one
      // (src/app/api/tenancies/route.ts); the property it opens says so in one sentence.
      router.push(j.existing ? `/tenancy/${j.id}?lease=existing` : `/tenancy/${j.id}`);
    } catch (e) {
      setStarting(false);
      setStartError(e instanceof TypeError ? "Couldn't reach the server. Check the connection and try again." : (e as Error).message);
    }
  }

  async function upload(file: File) {
    if (file.type !== "application/pdf") {
      setError("That isn't a PDF. Export the lease as a PDF and try again.");
      setState("error");
      return;
    }
    // The host refuses a bigger request body (src/lib/uploads.ts), so say so here in plain words.
    if (file.size > UPLOAD_BUDGET) {
      setError(`That PDF is ${mb(file.size)}; the limit is ${mb(UPLOAD_BUDGET)}. Export the lease as a smaller PDF (text, not scanned pages) and try again.`);
      setState("error");
      return;
    }
    const body = new FormData();
    body.append("file", file);
    await read(file.name, false, fetch("/api/lease", { method: "POST", body }));
  }

  /** The sample lease, demo/lease-single-owner.pdf, checked from the facts Claude read when the demo was built
   *  (src/lib/demo-lease.ts): no Claude call, so it is in at once; the PDF itself opens from the link beside the button
   *  for anyone who wants to watch Claude read it. */
  function checkSample() {
    return read(DEMO_LEASE_FILE, true, fetch("/api/lease/sample", { method: "POST" }));
  }

  async function read(name: string, isSample: boolean, request: Promise<Response>) {
    setFileName(name);
    setSample(isSample);
    setState("reading");
    setError("");
    const r = await request.catch(() => null);
    if (!r) {
      setError("Couldn't reach the server. Check the connection and try again.");
      setState("error");
      return;
    }
    if (!r.ok) {
      setError(await uploadError(r, "Something went wrong.", "That PDF was too large for the server. Export the lease as a smaller PDF and try again."));
      setState("error");
      return;
    }
    const res = (await r.json()) as Result;
    setResult(res);
    setCode(res.supported ? res.state : null);
    setState("done");
  }

  function reset() {
    setResult(null);
    setCode(null);
    setSample(false);
    setState("idle");
    setError("");
    setStartError("");
  }

  // The pack the result reads with: the lease's own state, or the one the landlord picked. The server's answer is kept
  // for the lease's own state; a picked one is checked here with the same pack (the server checks it again on start).
  const pack = code && isSupported(code) ? packFor(code) : null;
  const chosen: Result | null = result && pack ? (pack.code === result.state && result.supported ? result : {
    ...result, terms: { ...result.terms, state: pack.code }, flags: pack.lease.evaluate({ ...result.terms, state: pack.code }),
    lawfulDeposit: pack.lease.lawful({ ...result.terms, state: pack.code }), supported: true, refusal: null, state: pack.code,
  }) : null;
  const picker = result && (
    <label className="flex items-center gap-2 text-sm text-ink-3">
      State
      <select value={code ?? ""} onChange={(e) => setCode(e.target.value || null)} aria-label="State the property is in" className={`${inlineInputClass} h-8 pr-8`}>
        {!pack && <option value="">{result.state && STATE_NAMES[result.state] ? `${STATE_NAMES[result.state]} (not supported)` : "Pick the state"}</option>}
        {SUPPORTED.map((c) => <option key={c} value={c}>{packFor(c).name}</option>)}
      </select>
    </label>
  );

  if (result && state === "done" && !chosen) {
    return (
      <div className="flex flex-col gap-6">
        <Card className="flex flex-wrap items-center gap-3 px-4 py-3">
          <span className="flex size-8 shrink-0 items-center justify-center rounded-sm bg-surface text-ink-3"><Icon name="doc" className="size-[15px]" /></span>
          <div className="min-w-0 flex-1">
            <p className="truncate text-sm font-medium" title={fileName}>{fileName || "Lease"}</p>
            <p className="truncate text-xs text-ink-3">{result.terms.propertyAddress ?? "Address not found in the lease"}</p>
          </div>
          {picker}
          <Button variant="link" onClick={reset}>Check another</Button>
        </Card>
        <Notice>{result.refusal ?? unsupportedMessage(result.state)}</Notice>
      </div>
    );
  }

  if (chosen && pack && state === "done") {
    const r = chosen;
    const counts = (["violation", "warning", "info", "note"] as const).map((s) => [s, r.flags.filter((f) => kindOf(f) === s).length] as const).filter(([, n]) => n);
    const lawful = r.lawfulDeposit;
    const over = lawful && lawful.charged > lawful.amount ? lawful.charged - lawful.amount : 0;
    const t = r.terms;
    return (
      <div className="flex flex-col gap-6">
        {/* The file that was checked, in one row, with the state its rules follow (always shown, so a misread state is
            corrected before the tenancy starts) and the way to check another. On a phone the state and the link take
            the second row. */}
        <Card className="flex flex-wrap items-center gap-x-3 gap-y-2.5 px-4 py-3">
          <span className="flex size-8 shrink-0 items-center justify-center rounded-sm bg-surface text-ink-3"><Icon name="doc" className="size-[15px]" /></span>
          <div className="min-w-0 flex-1">
            <p className="truncate text-sm font-medium" title={fileName}>{fileName || "Lease"}</p>
            <p className="truncate text-xs text-ink-3">{t.propertyAddress ?? "Address not found in the lease"}</p>
          </div>
          <div className="flex items-center gap-3 max-sm:w-full max-sm:justify-between max-sm:pl-11">
            {picker}
            {sample && <StatusChip tone="gray" dot={false} className="max-sm:hidden">Sample</StatusChip>}
            <StatusChip tone="green" className="max-sm:hidden">Checked</StatusChip>
            <Button variant="link" onClick={reset}>Check another</Button>
          </div>
          {sample && (
            <p className="basis-full text-xs text-ink-3">
              The sample lease, from the facts Claude read when the demo was built. A lease you upload is read live, in about 20 seconds.
            </p>
          )}
        </Card>

        <FactStrip cols={3}>
          <Fact label="Security in the lease" value={<Money value={pack.lease.securityTotal(t)} />}
            sub={(() => {
              // The move-in charges the state counts as security: every one in California (D1), the others by their pack.
              const n = t.otherMoveInCharges.filter(pack.lease.securityCharge).length;
              return n ? `Deposit and ${n} ${pack.lease.chargeWord}${n === 1 ? "" : "s"}` : "Deposit";
            })()} />
          <Fact label="Deposit cap"
            info={<InfoTip align="end" title={pack.lease.capTip.title} cite={pack.lease.capTip.cite}>{pack.lease.capTip.text}</InfoTip>}
            value={lawful ? (lawful.cap != null ? <Money value={lawful.cap} /> : "No cap") : "Can't tell"}
            sub={pack.lease.capSub(t, lawful)} />
          <Fact label="Lawful deposit" big value={lawful ? <Money value={lawful.amount} cents="small" phoneCents="full" /> : "Can't tell"}
            sub={pack.lease.lawfulSub(lawful, over)} />
        </FactStrip>

        <Card>
          <div className="flex flex-wrap items-center gap-x-3 gap-y-2 border-b border-line-2 px-5 py-3.5">
            <h2 className="text-lg font-medium">Findings</h2>
            <span className="text-xs text-ink-3">{r.flags.length}</span>
            <div className="ml-auto flex flex-wrap gap-1.5">
              {counts.map(([s, n]) => <StatusChip key={s} tone={SEVERITY[s].tone} dot={false}>{n} {n === 1 ? SEVERITY[s].label.toLowerCase() : SEVERITY[s].plural}</StatusChip>)}
            </div>
          </div>
          {r.flags.length ? (
            <ul>
              {r.flags.map((f, i) => {
                const s = SEVERITY[kindOf(f)];
                const fact = factOf(f, r);
                return (
                  <li key={i} className="grid grid-cols-[minmax(0,1fr)_auto] items-start gap-x-4 gap-y-1.5 border-b border-line-2 px-5 py-3.5 last:border-b-0 sm:grid-cols-[112px_minmax(0,1fr)_auto]">
                    <span className="max-sm:col-span-2"><StatusChip tone={s.tone} dot={false}>{s.label}</StatusChip></span>
                    <div className="min-w-0">
                      <p className="text-sm font-medium">{f.title}</p>
                      {fact && <p className="mt-0.5 truncate text-xs text-ink-3" title={fact}>{fact}</p>}
                    </div>
                    <InfoTip trigger="why" align="end" title={f.title} cite={f.cite} className="mt-px">
                      {f.detail}
                      {f.quote && <span className="mt-1.5 block text-white/70">Lease: &ldquo;{f.quote}&rdquo;</span>}
                    </InfoTip>
                  </li>
                );
              })}
            </ul>
          ) : (
            <p className="flex items-center gap-2 px-5 py-4 text-sm text-green"><Icon name="check" className="size-3.5" />Nothing in the lease breaks the deposit rules.</p>
          )}
        </Card>

        <Card>
          <div className="flex items-center border-b border-line-2 px-5 py-3.5"><h2 className="text-lg font-medium">Lease terms</h2></div>
          <div className="px-5 py-4">
            <KV rows={[
              ["Property", t.propertyAddress ?? "Not stated"],
              ["Landlord", t.landlordName ?? "Not stated"],
              ["Tenants", t.tenants.join(", ") || "Not stated"],
              ["Starts", shortDay(t.tenancyStartDate) ?? "Not stated"],
              ["Ends", shortDay(t.leaseEndDate) ?? "Month to month"],
              ["Monthly rent", usd(t.monthlyRent)],
              ["Security deposit", usd(t.securityDeposit)],
              ...t.otherMoveInCharges.map((c) => [c.label, `${usd(c.amount)}${c.refundable === false ? ", labeled nonrefundable" : ""}`] as [string, string]),
            ]} />
          </div>
        </Card>

        <Card className="flex flex-wrap items-center gap-x-4 gap-y-3 px-5 py-4">
          <div className="min-w-0 flex-[1_1_18rem]">
            <p className="text-sm font-medium">Start this tenancy</p>
            <p className="mt-0.5 text-sm text-ink-3">
              {(() => {
                const first = pack.refund.agreementRequired ? "the refund agreement" : "the tenants' PayPal account";
                return lawful
                  ? `Next: ${first}, then a PayPal invoice for ${usd(lawful.amount)}${over ? ", the lawful amount" : ""}.`
                  : `Next: ${first}. The deposit invoice waits until the cap is known.`;
              })()}
            </p>
          </div>
          <Button variant="primary" onClick={startTenancy} disabled={starting} className="max-sm:w-full">{starting ? "Starting..." : "Start tenancy"}</Button>
          {startError && <Notice className="basis-full">{startError}</Notice>}
        </Card>
      </div>
    );
  }

  const reading = state === "reading";
  return (
    <div>
      <label
        onDragOver={(e) => { e.preventDefault(); if (!reading) setDragging(true); }}
        onDragLeave={() => setDragging(false)}
        onDrop={(e) => {
          e.preventDefault();
          setDragging(false);
          const f = e.dataTransfer.files?.[0];
          if (f && !reading) upload(f);
        }}
        aria-busy={reading}
        className={`flex flex-col items-center rounded-lg border border-dashed px-6 py-12 text-center transition-colors focus-within:border-brand focus-within:ring-3 focus-within:ring-brand-50 ${
          reading ? "cursor-default border-line bg-surface" : dragging ? "cursor-pointer border-brand bg-brand-50" : "cursor-pointer border-line bg-surface hover:border-brand"
        }`}
      >
        <input type="file" accept="application/pdf" className="sr-only" disabled={reading}
          onChange={(e) => { const f = e.target.files?.[0]; e.target.value = ""; if (f) upload(f); }} />
        <span className="flex size-10 items-center justify-center rounded-full bg-brand-50 text-brand"><Icon name={reading ? "doc" : "upload"} className="size-[18px]" /></span>
        <p className="mt-3 max-w-full truncate text-base font-medium">
          {reading ? `Reading ${fileName}` : dragging ? "Drop the lease to check it" : "Upload a lease"}
        </p>
        <p className="mt-1 text-sm text-ink-3" role={reading ? "status" : undefined}>
          {reading ? "Checking the deposit terms against the statute" : `Drop a PDF here or click to choose one, up to ${mb(UPLOAD_BUDGET)}`}
        </p>
        {reading && (
          <span aria-hidden className="mt-4 block h-1 w-48 overflow-hidden rounded-full bg-line">
            <span className="gf-sweep block h-full w-1/3 rounded-full bg-brand" />
          </span>
        )}
      </label>
      <div className="mt-3 flex flex-wrap items-center gap-x-4 gap-y-1.5 text-sm text-ink-3">
        <p className="flex items-center gap-1.5">
          For properties in {supportedNames()}
          <InfoTip title="Supported states">
            {SUPPORTED.map((c) => <span key={c} className="block">{packFor(c).name}: {packFor(c).statute.short}</span>)}
            <span className="mt-1.5 block text-white/70">The lease&apos;s state picks the rules. Any other state is refused, by name. Not legal advice.</span>
          </InfoTip>
        </p>
        {/* No lease at hand: the sample, checked in one click, or opened as a PDF to drop here for a live read. */}
        <p className="flex items-center gap-1.5 sm:ml-auto">
          No lease at hand?
          <Button variant="link" className="h-auto px-0" onClick={checkSample} disabled={reading}>Check the sample lease</Button>
          or <a href="/api/lease/sample" target="_blank" rel="noopener" className="text-brand hover:underline">open it</a>
        </p>
      </div>
      {state === "error" && <Notice className="mt-4">{error}</Notice>}
    </div>
  );
}

"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { Button } from "@/components/button";
import { Icon } from "@/components/icons";
import { InfoTip } from "@/components/info-tip";
import { Card, Fact, FactStrip, KV, Money, Notice, StatusChip, type Tone } from "@/components/ui";
import type { Flag, LeaseTerms } from "@/lib/rules";
import { mb, UPLOAD_BUDGET, uploadError } from "@/lib/uploads";

type Result = {
  terms: LeaseTerms; totalSecurity: number; smallLandlordExempt: boolean | null; flags: Flag[];
  leasePath: string | null; lawfulDeposit: { amount: number; cap: number; charged: number } | null;
};

const usd = (n: number | null | undefined) =>
  n == null ? "Not stated" : `$${n.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
const shortDay = (iso: string | null | undefined) =>
  iso ? new Date(`${iso.slice(0, 10)}T12:00:00Z`).toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric", timeZone: "UTC" }) : null;

const SEVERITY: Record<Flag["severity"], { label: string; plural: string; tone: Tone }> = {
  violation: { label: "Violation", plural: "violations", tone: "red" },
  warning: { label: "Warning", plural: "warnings", tone: "amber" },
  info: { label: "Required step", plural: "required steps", tone: "gray" },
};

/** One short fact under a finding's title, from the terms the rules read. The rule and the lease's own words are its
 *  Why? tip, so a quote is never repeated (or cut off) here. */
function factOf(f: Flag, r: Result): string | null {
  const t = r.terms;
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

export function LeaseCheck() {
  const [state, setState] = useState<"idle" | "reading" | "done" | "error">("idle");
  const [result, setResult] = useState<Result | null>(null);
  const [error, setError] = useState("");
  const [startError, setStartError] = useState("");
  const [fileName, setFileName] = useState("");
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
        body: JSON.stringify({ terms: result.terms, leasePath: result.leasePath }),
      });
      const j = await r.json().catch(() => ({}));
      if (!r.ok) throw new Error(j.error ?? "Couldn't start the tenancy. Try again.");
      router.push(`/tenancy/${j.id}`);
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
    setFileName(file.name);
    setState("reading");
    setError("");
    const body = new FormData();
    body.append("file", file);
    const r = await fetch("/api/lease", { method: "POST", body }).catch(() => null);
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
    setResult(await r.json());
    setState("done");
  }

  function reset() {
    setResult(null);
    setState("idle");
    setError("");
    setStartError("");
  }

  if (result && state === "done") {
    const r = result;
    const counts = (["violation", "warning", "info"] as const).map((s) => [s, r.flags.filter((f) => f.severity === s).length] as const).filter(([, n]) => n);
    const lawful = r.lawfulDeposit;
    const over = lawful && lawful.charged > lawful.amount ? lawful.charged - lawful.amount : 0;
    const t = r.terms;
    return (
      <div className="flex flex-col gap-6">
        {/* The file that was checked, in one row, with the way to check another. */}
        <Card className="flex items-center gap-3 px-4 py-3">
          <span className="flex size-8 shrink-0 items-center justify-center rounded-sm bg-surface text-ink-3"><Icon name="doc" className="size-[15px]" /></span>
          <div className="min-w-0 flex-1">
            <p className="truncate text-sm font-medium" title={fileName}>{fileName || "Lease"}</p>
            <p className="truncate text-xs text-ink-3">{t.propertyAddress ?? "Address not found in the lease"}</p>
          </div>
          <StatusChip tone="green" className="max-sm:hidden">Checked</StatusChip>
          <Button variant="link" onClick={reset}>Check another</Button>
        </Card>

        <FactStrip cols={3}>
          <Fact label="Security in the lease" value={<Money value={r.totalSecurity} />}
            sub={t.otherMoveInCharges.length ? `Deposit and ${t.otherMoveInCharges.length} fee${t.otherMoveInCharges.length === 1 ? "" : "s"}` : "Deposit"} />
          <Fact label="Deposit cap"
            info={<InfoTip align="end" title="The deposit cap" cite="Civ. Code 1950.5(c)(1), (c)(5)">
              One month&apos;s rent, or two for an owner who is a natural person (or an LLC of natural persons) with at most 2 rental properties and 4 units. A service member always pays at most one month. Everything charged at move-in except first month&apos;s rent counts.
            </InfoTip>}
            value={lawful ? <Money value={lawful.cap} /> : "Can't tell"}
            sub={r.smallLandlordExempt == null ? "Owner type unknown" : r.smallLandlordExempt ? "Two months' rent" : "One month's rent"} />
          <Fact label="Lawful deposit" big value={lawful ? <Money value={lawful.amount} cents="small" phoneCents="full" /> : "Can't tell"}
            sub={!lawful ? "Confirm the owner first" : over ? `Lease asks ${usd(over)} more` : "Within the cap"} />
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
                const s = SEVERITY[f.severity];
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
              {lawful
                ? `Next: the refund agreement, then a PayPal invoice for ${usd(lawful.amount)}${over ? ", the lawful amount" : ""}.`
                : "Next: the refund agreement. The deposit invoice waits until the cap is known."}
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
            <span className="block h-full w-1/3 animate-pulse rounded-full bg-brand" />
          </span>
        )}
      </label>
      {state === "error" && <Notice className="mt-4">{error}</Notice>}
    </div>
  );
}

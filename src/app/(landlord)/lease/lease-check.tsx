"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { Button } from "@/components/button";
import { Icon } from "@/components/icons";
import { InfoTip } from "@/components/info-tip";
import { Card, CardHead, KV, Notice, StatusChip, type Tone } from "@/components/ui";
import type { Flag, LeaseTerms } from "@/lib/rules";
import { mb, UPLOAD_BUDGET, uploadError } from "@/lib/uploads";

type Result = {
  terms: LeaseTerms; totalSecurity: number; smallLandlordExempt: boolean | null; flags: Flag[];
  leasePath: string | null; lawfulDeposit: { amount: number; cap: number; charged: number } | null;
};

const usd = (n: number | null | undefined) =>
  n == null ? "--" : `$${n.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;

const SEVERITY: Record<Flag["severity"], { label: string; tone: Tone }> = {
  violation: { label: "Violation", tone: "red" },
  warning: { label: "Warning", tone: "amber" },
  info: { label: "Required step", tone: "gray" },
};

export function LeaseCheck() {
  const [state, setState] = useState<"idle" | "reading" | "done" | "error">("idle");
  const [result, setResult] = useState<Result | null>(null);
  const [error, setError] = useState("");
  const [fileName, setFileName] = useState("");
  const [dragging, setDragging] = useState(false);
  const [starting, setStarting] = useState(false);
  const router = useRouter();

  async function startTenancy() {
    if (!result) return;
    setStarting(true);
    const r = await fetch("/api/tenancies", {
      method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ terms: result.terms, leasePath: result.leasePath }),
    });
    const j = await r.json();
    if (!r.ok) { setStarting(false); setError(j.error ?? "Couldn't start the tenancy."); setState("error"); return; }
    router.push(`/tenancy/${j.id}`);
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
    const r = await fetch("/api/lease", { method: "POST", body });
    if (!r.ok) {
      setError(await uploadError(r, "Something went wrong.", "That PDF was too large for the server. Export the lease as a smaller PDF and try again."));
      setState("error");
      return;
    }
    setResult(await r.json());
    setState("done");
  }

  const counts = result
    ? (["violation", "warning", "info"] as const).map((s) => [s, result.flags.filter((f) => f.severity === s).length] as const)
    : [];

  return (
    <div>
      <label
        onDragOver={(e) => { e.preventDefault(); setDragging(true); }}
        onDragLeave={() => setDragging(false)}
        onDrop={(e) => {
          e.preventDefault();
          setDragging(false);
          const f = e.dataTransfer.files?.[0];
          if (f) upload(f);
        }}
        className={`flex cursor-pointer flex-col items-center rounded-lg border border-dashed px-6 py-10 text-center transition-colors hover:border-brand ${
          dragging ? "border-brand bg-brand-50" : "border-line bg-surface"
        }`}
      >
        <input type="file" accept="application/pdf" className="sr-only"
          onChange={(e) => e.target.files?.[0] && upload(e.target.files[0])} />
        <span className="flex size-10 items-center justify-center rounded-full bg-brand-50 text-brand"><Icon name={state === "reading" ? "clock" : "upload"} className="size-[18px]" /></span>
        <p className="mt-3 text-base font-medium">
          {state === "reading" ? `Reading ${fileName}...` : dragging ? "Drop the lease to check it" : "Upload a lease (PDF)"}
        </p>
        <p className="mt-1 text-sm text-ink-3">
          {state === "reading" ? "Checking the deposit terms against the statute" : "Drop it here or click to choose a file"}
        </p>
      </label>

      {state === "error" && <Notice className="mt-4">{error}</Notice>}

      {result && state === "done" && (
        <div className="mt-6 flex flex-col gap-6">
          <Card>
            <CardHead title="What the lease says" />
            <div className="px-5 py-4">
              <KV rows={[
                ["Property", result.terms.propertyAddress ?? "--"],
                ["Landlord", result.terms.landlordName ?? "--"],
                ["Tenants", result.terms.tenants.join(", ") || "--"],
                ["Tenancy starts", result.terms.tenancyStartDate ?? "--"],
                ["Lease ends", result.terms.leaseEndDate ?? "Month to month, or not stated"],
                ["Monthly rent", usd(result.terms.monthlyRent)],
                ["Security deposit", usd(result.terms.securityDeposit)],
                ...result.terms.otherMoveInCharges.map((c) => [c.label, `${usd(c.amount)}${c.refundable === false ? " (labeled nonrefundable)" : ""}`] as [string, string]),
                ["Total security at move-in", <span key="t" className="font-medium">{usd(result.totalSecurity)}</span>],
                ["Small-landlord exemption", result.smallLandlordExempt == null ? "Unknown" : result.smallLandlordExempt ? "Yes (2-month cap)" : "No (1-month cap)"],
              ]} />
            </div>
          </Card>

          <Card>
            <CardHead title="Checked against California law"
              meta={counts.map(([s, n]) => `${n} ${SEVERITY[s].label.toLowerCase()}${n === 1 ? "" : "s"}`).join(", ")} />
            <ul className="flex flex-col">
              {result.flags.map((f, i) => {
                const s = SEVERITY[f.severity];
                return (
                  <li key={i} className="flex items-start gap-3 border-b border-line-2 px-5 py-3.5 last:border-b-0">
                    <StatusChip tone={s.tone} className="mt-px">{s.label}</StatusChip>
                    <div className="min-w-0 flex-1">
                      <div className="flex items-center gap-1.5 text-sm font-medium">
                        {f.title}
                        <InfoTip trigger="why" align="end" title={f.title} cite={f.cite}>{f.detail}</InfoTip>
                      </div>
                      {f.quote && <p className="mt-1 line-clamp-2 text-xs text-ink-3">Lease: &ldquo;{f.quote}&rdquo;</p>}
                    </div>
                  </li>
                );
              })}
            </ul>
          </Card>

          <Card className="flex flex-wrap items-center gap-3 p-5">
            <p className="min-w-0 flex-1 text-sm text-ink-2">
              {result.lawfulDeposit && result.lawfulDeposit.amount < result.lawfulDeposit.charged
                ? `Collects only the lawful ${usd(result.lawfulDeposit.amount)} deposit through PayPal`
                : "Collect the deposit through PayPal and add move-in photos"}
            </p>
            <Button variant="primary" onClick={startTenancy} disabled={starting}>{starting ? "Starting..." : "Start this tenancy"}</Button>
          </Card>
        </div>
      )}
    </div>
  );
}

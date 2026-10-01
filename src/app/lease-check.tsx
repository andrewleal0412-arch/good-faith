"use client";

import { useState } from "react";
import type { Flag, LeaseTerms } from "@/lib/rules";

type Result = { terms: LeaseTerms; totalSecurity: number; smallLandlordExempt: boolean | null; flags: Flag[] };

const usd = (n: number | null | undefined) =>
  n == null ? "--" : `$${n.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;

const SEVERITY = {
  violation: { label: "Violation", fg: "text-danger", bg: "bg-danger-soft", dot: "bg-danger" },
  warning: { label: "Warning", fg: "text-warn", bg: "bg-warn-soft", dot: "bg-warn" },
  info: { label: "Required step", fg: "text-info", bg: "bg-info-soft", dot: "bg-info" },
} as const;

export function LeaseCheck() {
  const [state, setState] = useState<"idle" | "reading" | "done" | "error">("idle");
  const [result, setResult] = useState<Result | null>(null);
  const [error, setError] = useState("");
  const [fileName, setFileName] = useState("");

  async function upload(file: File) {
    setFileName(file.name);
    setState("reading");
    setError("");
    const body = new FormData();
    body.append("file", file);
    const r = await fetch("/api/lease", { method: "POST", body });
    const j = await r.json();
    if (!r.ok) {
      setError(j.error ?? "Something went wrong.");
      setState("error");
      return;
    }
    setResult(j);
    setState("done");
  }

  const counts = result
    ? (["violation", "warning", "info"] as const).map((s) => [s, result.flags.filter((f) => f.severity === s).length] as const)
    : [];

  return (
    <div className="mt-8">
      <label className="block cursor-pointer rounded-2xl border-2 border-dashed border-line bg-surface px-6 py-8 text-center transition hover:border-accent">
        <input type="file" accept="application/pdf" className="sr-only"
          onChange={(e) => e.target.files?.[0] && upload(e.target.files[0])} />
        <p className="text-[15px] font-semibold">{state === "reading" ? `Reading ${fileName}...` : "Upload a lease (PDF)"}</p>
        <p className="mt-1 text-[13px] text-ink-3">
          {state === "reading" ? "Pulling out the deposit terms and checking them against the statute." : "Drop it here or click to choose a file."}
        </p>
      </label>

      {state === "error" && <p className="mt-4 text-[14px] text-danger">{error}</p>}

      {result && state === "done" && (
        <div className="mt-8 space-y-6">
          <section className="rounded-2xl bg-surface p-6 shadow-sm">
            <h2 className="text-[13px] font-semibold uppercase tracking-[0.12em] text-ink-3">What the lease says</h2>
            <dl className="mt-3 grid grid-cols-1 gap-x-8 gap-y-2 sm:grid-cols-2 text-[14px]">
              <Row k="Property" v={result.terms.propertyAddress ?? "--"} />
              <Row k="Landlord" v={result.terms.landlordName ?? "--"} />
              <Row k="Tenants" v={result.terms.tenants.join(", ") || "--"} />
              <Row k="Tenancy starts" v={result.terms.tenancyStartDate ?? "--"} />
              <Row k="Monthly rent" v={usd(result.terms.monthlyRent)} />
              <Row k="Security deposit" v={usd(result.terms.securityDeposit)} />
              {result.terms.otherMoveInCharges.map((c) => (
                <Row key={c.label} k={c.label} v={`${usd(c.amount)}${c.refundable === false ? " (labeled nonrefundable)" : ""}`} />
              ))}
              <Row k="Total security at move-in" v={usd(result.totalSecurity)} strong />
              <Row k="Small-landlord exemption" v={result.smallLandlordExempt == null ? "Unknown" : result.smallLandlordExempt ? "Yes (2-month cap)" : "No (1-month cap)"} />
            </dl>
          </section>

          <section>
            <div className="flex flex-wrap items-baseline justify-between gap-2">
              <h2 className="text-[20px] font-semibold tracking-[-0.01em]">Checked against California law</h2>
              <p className="text-[13px] text-ink-3">
                {counts.map(([s, n]) => `${n} ${SEVERITY[s].label.toLowerCase()}${n === 1 || s === "info" ? "" : "s"}`).join("  ·  ")}
              </p>
            </div>
            <ul className="mt-4 space-y-3">
              {result.flags.map((f, i) => {
                const s = SEVERITY[f.severity];
                return (
                  <li key={i} className="rounded-2xl bg-surface p-5 shadow-sm">
                    <div className="flex items-center gap-2">
                      <span className={`inline-flex items-center gap-1.5 rounded-full px-2.5 py-0.5 text-[12px] font-semibold ${s.bg} ${s.fg}`}>
                        <span className={`h-1.5 w-1.5 rounded-full ${s.dot}`} />{s.label}
                      </span>
                      <span className="text-[12px] text-ink-3">{f.cite}</span>
                    </div>
                    <p className="mt-2 text-[16px] font-semibold">{f.title}</p>
                    <p className="mt-1 text-[14px] leading-relaxed text-ink-2">{f.detail}</p>
                    {f.quote && (
                      <blockquote className="mt-3 border-l-2 border-line pl-3 text-[13px] italic text-ink-2">
                        &ldquo;{f.quote}&rdquo;
                      </blockquote>
                    )}
                  </li>
                );
              })}
            </ul>
          </section>
        </div>
      )}
    </div>
  );
}

function Row({ k, v, strong }: { k: string; v: string; strong?: boolean }) {
  return (
    <div className="flex justify-between gap-4 border-b border-line py-1.5">
      <dt className="text-ink-3">{k}</dt>
      <dd className={`text-right ${strong ? "font-semibold" : ""}`}>{v}</dd>
    </div>
  );
}

"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import type { Flag, LeaseTerms } from "@/lib/rules";
import { mb, UPLOAD_BUDGET, uploadError } from "@/lib/uploads";

type Result = {
  terms: LeaseTerms; totalSecurity: number; smallLandlordExempt: boolean | null; flags: Flag[];
  leasePath: string | null; lawfulDeposit: { amount: number; cap: number; charged: number } | null;
};

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
    <div className="mt-8">
      <label
        onDragOver={(e) => { e.preventDefault(); setDragging(true); }}
        onDragLeave={() => setDragging(false)}
        onDrop={(e) => {
          e.preventDefault();
          setDragging(false);
          const f = e.dataTransfer.files?.[0];
          if (f) upload(f);
        }}
        className={`block cursor-pointer rounded-2xl border-2 border-dashed px-6 py-8 text-center transition hover:border-accent ${
          dragging ? "border-accent bg-accent-soft" : "border-line bg-surface"
        }`}
      >
        <input type="file" accept="application/pdf" className="sr-only"
          onChange={(e) => e.target.files?.[0] && upload(e.target.files[0])} />
        <p className="text-[15px] font-semibold">
          {state === "reading" ? `Reading ${fileName}...` : dragging ? "Drop the lease to check it" : "Upload a lease (PDF)"}
        </p>
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
              <Row k="Lease ends" v={result.terms.leaseEndDate ?? "Month to month, or not stated"} />
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
                {counts.map(([s, n]) => `${n} ${SEVERITY[s].label.toLowerCase()}${n === 1 ? "" : "s"}`).join("  ·  ")}
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

          <section className="flex flex-wrap items-center justify-between gap-3 rounded-2xl bg-ink p-5 text-white">
            <p className="text-[14px] leading-relaxed text-white/80">
              {result.lawfulDeposit && result.lawfulDeposit.amount < result.lawfulDeposit.charged
                ? `Start the tenancy and the agent will collect only the lawful ${"$"}${result.lawfulDeposit.amount.toLocaleString("en-US")} deposit through PayPal.`
                : "Start the tenancy to collect the deposit through PayPal and record move-in photos."}
            </p>
            <button onClick={startTenancy} disabled={starting}
              className="rounded-xl bg-white px-4 py-2 text-[14px] font-semibold text-ink disabled:opacity-50">
              {starting ? "Starting..." : "Start this tenancy"}
            </button>
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

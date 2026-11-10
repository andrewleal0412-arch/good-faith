"use client";

import { useState, type ReactNode } from "react";

/** A dispute's case (the figures, the advocate's summary, the charges, the tenants' message), folded to one line once
 *  the dispute is settled, so the settlement and what sits under the case are not a case's length down the page. Used
 *  by the landlord's Dispute card (tenancy/[id]/dispute.tsx) and by the tenants' own dispute page (t/[token]/dispute),
 *  each with its own line and its own row style. The fold is read once, when it mounts: a page that arrives with the
 *  dispute settled gets the line and Show the case; a page that watched it settle keeps the case open, since that is
 *  what it was reading. */
export function CaseFold({ settled, count, line, id = "dispute-case", className = "px-5 py-3.5", openClassName = "border-b border-line-2", children }: {
  settled: boolean; count: number; line: string; id?: string; className?: string; openClassName?: string; children: ReactNode;
}) {
  const [open, setOpen] = useState(!settled);
  if (!settled) return <>{children}</>;
  return (
    <>
      <div className={["flex flex-wrap items-center gap-x-3 gap-y-1", className, open ? openClassName : ""].filter(Boolean).join(" ")}>
        <p className="min-w-0 flex-1 text-sm text-ink-2" data-case-folded={open ? undefined : count}>{line}</p>
        <button type="button" aria-expanded={open} aria-controls={id} className="inline-flex min-h-6 items-center text-sm font-medium text-brand hover:underline" onClick={() => setOpen((o) => !o)}>
          {open ? "Hide the case" : "Show the case"}
        </button>
      </div>
      {open && <div id={id}>{children}</div>}
    </>
  );
}

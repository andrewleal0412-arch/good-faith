"use client";

import { useState, type ReactNode } from "react";

/** The Dispute card's body (the figures, the advocate's summary, the charges and the tenants' message), folded to one
 *  line once the dispute is settled, so the settlement under it and the photo comparison are not a case's length down
 *  the settled tab. The fold is read once, when the card mounts: a page that arrives with the dispute settled gets the
 *  line and Show the case; a page that watched it settle keeps the case open, since that is what it was reading. */
export function CaseFold({ settled, count, line, children }: { settled: boolean; count: number; line: string; children: ReactNode }) {
  const [open, setOpen] = useState(!settled);
  if (!settled) return <>{children}</>;
  return (
    <>
      <div className={`flex flex-wrap items-center gap-x-3 gap-y-1 px-5 py-3.5${open ? " border-b border-line-2" : ""}`}>
        <p className="min-w-0 flex-1 text-sm text-ink-2" data-case-folded={open ? undefined : count}>{line}</p>
        <button type="button" aria-expanded={open} aria-controls="dispute-case" className="text-sm font-medium text-brand hover:underline" onClick={() => setOpen((o) => !o)}>
          {open ? "Hide the case" : "Show the case"}
        </button>
      </div>
      {open && <div id="dispute-case">{children}</div>}
    </>
  );
}

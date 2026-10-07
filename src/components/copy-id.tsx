"use client";

import { useState } from "react";
import { Icon } from "./icons";

/** A PayPal id with a copy button that turns into a check for a moment, the two crossfading. Used on the refund receipt
 *  and the tenant page. */
export function CopyId({ text, label }: { text: string; label: string }) {
  const [done, setDone] = useState(false);
  const [used, setUsed] = useState(false); // fade only after a click, never on the page's first paint
  async function copy() {
    try {
      await navigator.clipboard.writeText(text);
      setUsed(true);
      setDone(true);
      setTimeout(() => setDone(false), 1500);
    } catch {
      setDone(false);
    }
  }
  return (
    <span className="inline-flex items-center gap-2 tabular-nums">
      <span className="break-all">{text}</span>
      <button type="button" onClick={copy} aria-label={done ? "Copied" : label} title={done ? "Copied" : label}
        className="inline-flex size-6 shrink-0 items-center justify-center rounded-sm text-ink-3 transition-[color,background-color] hover:bg-surface-2 hover:text-ink">
        <Icon key={done ? "check" : "copy"} name={done ? "check" : "copy"} className={`size-3.5 ${used ? "gf-fade-in" : ""}`} />
      </button>
      {/* The check, said: a screen reader hears "Copied" as it happens (WCAG 4.1.3). */}
      <span role="status" className="sr-only">{done ? "Copied" : ""}</span>
    </span>
  );
}

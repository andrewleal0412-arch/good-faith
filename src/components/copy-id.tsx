"use client";

import { useState } from "react";
import { Icon } from "./icons";

/** A PayPal id with a copy button that turns into a check for a moment. Used on the refund receipt and the tenant page. */
export function CopyId({ text, label }: { text: string; label: string }) {
  const [done, setDone] = useState(false);
  async function copy() {
    try {
      await navigator.clipboard.writeText(text);
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
        className="inline-flex size-6 shrink-0 items-center justify-center rounded-sm text-ink-4 outline-none hover:bg-surface-2 hover:text-ink-2 focus-visible:ring-2 focus-visible:ring-brand-100">
        <Icon name={done ? "check" : "copy"} className="size-3.5" />
      </button>
    </span>
  );
}

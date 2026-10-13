"use client";

import { useEffect, useRef, useState } from "react";
import { copyText, selectIn } from "@/lib/clipboard";
import { Icon } from "./icons";

/** What the row says when the id couldn't be copied for the reader. */
const BY_HAND = "Couldn't copy automatically. The ID is selected, so you can copy it by hand.";

/** A PayPal id with a copy button that turns into a check for a moment, the two crossfading. Used on the refund receipt
 *  and the tenant page. When the browser refuses the clipboard (no permission, or a plain http origin) the id is
 *  selected and the older copy command tried (src/lib/clipboard.ts, as the tenant link does); failing that too, the id
 *  stays selected and a line under it says so, so the press never does nothing. With `selected` it starts that way,
 *  for a copy refused somewhere else that opened this row (the Payments row menu's Copy PayPal ID). */
export function CopyId({ text, label, selected }: { text: string; label: string; selected?: boolean }) {
  const [done, setDone] = useState(false);
  const [used, setUsed] = useState(false); // fade only after a click, never on the page's first paint
  const [byHand, setByHand] = useState(false); // not copied: the id is selected and the line under it is shown
  const id = useRef<HTMLSpanElement>(null);
  const copied = () => {
    setByHand(false);
    setUsed(true);
    setDone(true);
    setTimeout(() => setDone(false), 1500);
  };
  async function copy() {
    if (await copyText(text, id.current)) return copied();
    setDone(false);
    setByHand(true);
  }
  // Shown because a copy from elsewhere was refused: the id is selected and the line is there from the first paint, so
  // that press ends with the id ready to copy by hand.
  useEffect(() => {
    if (selected && selectIn(id.current)) setByHand(true);
  }, [selected]);
  return (
    <span className={`inline-flex items-center gap-x-2 tabular-nums ${byHand ? "flex-wrap" : ""}`}>
      <span ref={id} className="break-all">{text}</span>
      <button type="button" onClick={copy} onBlur={() => setByHand(false)} aria-label={done ? "Copied" : label} title={done ? "Copied" : label}
        className="inline-flex size-6 shrink-0 items-center justify-center rounded-sm text-ink-3 transition-[color,background-color] hover:bg-surface-2 hover:text-ink">
        <Icon key={done ? "check" : "copy"} name={done ? "check" : "copy"} className={`size-3.5 ${used ? "gf-fade-in" : ""}`} />
      </button>
      {/* The check, said: a screen reader hears "Copied" as it happens (WCAG 4.1.3). The same place says, and shows on a
          line of its own no wider than the id, that the id is selected to copy by hand. */}
      <span role="status" className={byHand ? "mt-1 w-0 min-w-full basis-full whitespace-normal text-xs font-normal text-ink-3" : "sr-only"}>
        {done ? "Copied" : byHand ? BY_HAND : ""}
      </span>
    </span>
  );
}

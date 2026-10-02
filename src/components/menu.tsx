"use client";

import Link from "next/link";
import { useEffect, useLayoutEffect, useRef, useState, type ReactNode } from "react";
import { Icon, MoreGlyph, type IconName } from "./icons";

// A small popover menu: the row overflow (three dots), the record header's More, the bell and the account button.
// Items are links; a file download (an .ics or a PDF) is a plain <a>. The popover is fixed to the viewport and placed
// from the trigger, so a table's scroll box or a card's overflow never clips it; it flips above the trigger when there
// is no room below.

export type MenuItem = { label: string; href: string; icon?: IconName; plain?: boolean; newTab?: boolean } | { divider: true } | { heading: string };

export function Menu({ items, label = "More", trigger, align = "end", side = "bottom", buttonClass, width = 220, children }: {
  items?: MenuItem[];
  side?: "bottom" | "top";
  label?: string;
  trigger?: ReactNode; // defaults to the three-dot glyph
  align?: "start" | "end";
  buttonClass?: string;
  width?: number;
  children?: ReactNode; // free content under the items (the bell's list, the account card)
}) {
  const [open, setOpen] = useState(false);
  const host = useRef<HTMLDivElement>(null);
  const button = useRef<HTMLButtonElement>(null);
  const pop = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const away = (e: MouseEvent) => { if (!host.current?.contains(e.target as Node)) setOpen(false); };
    const esc = (e: KeyboardEvent) => { if (e.key === "Escape") { setOpen(false); button.current?.focus(); } };
    document.addEventListener("mousedown", away);
    document.addEventListener("keydown", esc);
    return () => { document.removeEventListener("mousedown", away); document.removeEventListener("keydown", esc); };
  }, [open]);

  // Placed before paint and again on any scroll or resize, measured against the layout viewport (clientWidth and
  // clientHeight stay put on a phone even when something overflows; innerWidth does not).
  useLayoutEffect(() => {
    if (!open) return;
    const place = () => {
      const b = button.current?.getBoundingClientRect();
      const m = pop.current;
      if (!b || !m) return;
      const vw = document.documentElement.clientWidth, vh = document.documentElement.clientHeight;
      const w = m.offsetWidth, h = m.offsetHeight;
      const below = b.bottom + 6, above = b.top - 6 - h;
      let top = side === "top" ? above : below;
      if (side === "bottom" && below + h > vh - 8 && above >= 8) top = above;
      if (side === "top" && above < 8) top = below;
      const left = Math.max(12, Math.min(align === "end" ? b.right - w : b.left, vw - 12 - w));
      m.style.top = `${Math.round(top)}px`;
      m.style.left = `${Math.round(left)}px`;
    };
    place();
    window.addEventListener("scroll", place, true);
    window.addEventListener("resize", place);
    return () => { window.removeEventListener("scroll", place, true); window.removeEventListener("resize", place); };
  }, [open, side, align]);

  return (
    <div ref={host} className="relative inline-flex max-w-full">
      <button ref={button} type="button" aria-label={label} aria-haspopup="menu" aria-expanded={open} onClick={() => setOpen((v) => !v)}
        className={buttonClass ?? "inline-flex size-7 items-center justify-center rounded-sm text-ink-4 hover:bg-surface-2 hover:text-ink-2"}>
        {trigger ?? <MoreGlyph className="size-4" />}
      </button>
      {open && (
        <div ref={pop} role="menu" style={{ width }}
          className="fixed left-0 top-0 z-40 max-w-[calc(100vw-24px)] rounded-md border border-line bg-canvas p-1 shadow-md">
          {items?.map((it, i) => {
            if ("divider" in it) return <div key={i} className="my-1 h-px bg-line-2" />;
            if ("heading" in it) return <div key={i} className="px-2.5 pb-1 pt-2 text-xs font-medium text-ink-3">{it.heading}</div>;
            const cls = "flex h-8 items-center gap-2.5 rounded-sm px-2.5 text-sm text-ink-2 hover:bg-surface hover:text-ink";
            const body = <>{it.icon && <Icon name={it.icon} className="size-[15px] text-ink-3" />}<span className="truncate">{it.label}</span></>;
            return it.plain || it.newTab
              ? <a key={i} role="menuitem" href={it.href} className={cls} target={it.newTab ? "_blank" : undefined} rel={it.newTab ? "noreferrer" : undefined} onClick={() => setOpen(false)}>{body}</a>
              : <Link key={i} role="menuitem" href={it.href} className={cls} onClick={() => setOpen(false)}>{body}</Link>;
          })}
          {children}
        </div>
      )}
    </div>
  );
}

"use client";

import Link from "next/link";
import { useEffect, useRef, useState } from "react";
import { Icon } from "./icons";
import type { TabItem } from "./ui";

type Common = { active: string; className?: string; label?: string };

/** Underlined tabs, as links: the page reads the active tab from the URL. With `onSelect` they are buttons instead,
 *  for a filter the page holds itself (the Payments grid's tabs). On a phone the row scrolls sideways, the active tab
 *  is scrolled into view, and a chevron on the right edge shows there are more tabs past it. */
export function Tabs({ items, active, className, label = "Sections", onSelect }: Common & (
  { items: TabItem[]; onSelect?: undefined } | { items: Omit<TabItem, "href">[]; onSelect: (key: string) => void }
)) {
  const nav = useRef<HTMLElement>(null);
  const [more, setMore] = useState(false);

  useEffect(() => {
    const el = nav.current;
    if (!el) return;
    const check = () => setMore(el.scrollLeft + el.clientWidth < el.scrollWidth - 2);
    const on = el.querySelector<HTMLElement>("[data-on]");
    if (on && el.scrollWidth > el.clientWidth) el.scrollLeft = Math.max(0, on.offsetLeft - (el.clientWidth - on.offsetWidth) / 2);
    check();
    el.addEventListener("scroll", check, { passive: true });
    window.addEventListener("resize", check);
    return () => { el.removeEventListener("scroll", check); window.removeEventListener("resize", check); };
  }, [active]);

  return (
    <div className={`relative ${className ?? ""}`}>
      <nav ref={nav} aria-label={label}
        className="-mx-4 flex gap-0.5 overflow-x-auto border-b border-line px-4 [scrollbar-width:none] sm:mx-0 sm:gap-1 sm:px-0 [&::-webkit-scrollbar]:hidden">
        {(items as (Omit<TabItem, "href"> & { href?: string })[]).map((t) => {
          const on = t.key === active;
          const cls = `-mb-px inline-flex h-[38px] shrink-0 items-center gap-1.5 border-b-2 px-2 text-sm sm:px-3 sm:text-base ${
            on ? "border-brand font-medium text-ink" : "border-transparent text-ink-3 hover:text-ink"}`;
          const body = <>{t.label}{t.count != null && <span className="text-xs font-normal text-ink-3">{t.count}</span>}</>;
          return onSelect ? (
            <button key={t.key} type="button" onClick={() => onSelect(t.key)} aria-pressed={on} data-on={on || undefined} className={cls}>{body}</button>
          ) : (
            <Link key={t.key} href={t.href ?? ""} scroll={false} aria-current={on ? "page" : undefined} data-on={on || undefined} className={cls}>{body}</Link>
          );
        })}
      </nav>
      {more && (
        <button type="button" aria-hidden tabIndex={-1} onClick={() => nav.current?.scrollBy({ left: 160, behavior: "smooth" })}
          className="absolute -right-4 bottom-px top-0 flex w-10 items-center justify-center border-l border-line-2 bg-canvas text-ink-3 sm:right-0">
          <Icon name="chev-right" className="size-4" />
        </button>
      )}
    </div>
  );
}

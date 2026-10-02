"use client";

import { useEffect, useId, useLayoutEffect, useRef, useState, type ReactNode } from "react";
import { Icon } from "./icons";

// The one place legal detail lives: a dark tooltip opened from an info icon or a "Why?" link. Hover or focus shows it,
// a click pins it open (for touch), Escape or a click elsewhere closes it. The tip is fixed to the viewport and placed
// from its trigger, so a table's scroll box or a card's overflow never clips it, and it stays 12px inside the screen.

export function InfoTip({ title, children, cite, label = "More information", trigger = "icon", align = "start", className }: {
  title?: ReactNode;
  children?: ReactNode;
  cite?: ReactNode; // the citation line, in the tip's muted footer
  label?: string;
  trigger?: "icon" | "why" | ReactNode;
  align?: "start" | "end";
  className?: string;
}) {
  const [hover, setHover] = useState(false);
  const [pinned, setPinned] = useState(false);
  const host = useRef<HTMLSpanElement>(null);
  const button = useRef<HTMLButtonElement>(null);
  const tip = useRef<HTMLSpanElement>(null);
  const id = useId();
  const open = hover || pinned;

  useEffect(() => {
    if (!pinned) return;
    const away = (e: MouseEvent) => { if (!host.current?.contains(e.target as Node)) setPinned(false); };
    const esc = (e: KeyboardEvent) => { if (e.key === "Escape") { setPinned(false); setHover(false); } };
    document.addEventListener("mousedown", away);
    document.addEventListener("keydown", esc);
    return () => { document.removeEventListener("mousedown", away); document.removeEventListener("keydown", esc); };
  }, [pinned]);

  // Placed before paint and again on scroll or resize. The layout viewport's clientWidth is the measure: on a phone,
  // innerWidth grows with anything that overflows and would let the tip run off screen.
  useLayoutEffect(() => {
    if (!open) return;
    const place = () => {
      const b = button.current?.getBoundingClientRect();
      const el = tip.current;
      if (!b || !el) return;
      const vw = document.documentElement.clientWidth, vh = document.documentElement.clientHeight;
      const w = el.offsetWidth, h = el.offsetHeight;
      const below = b.bottom + 8, above = b.top - 8 - h;
      const top = below + h > vh - 8 && above >= 8 ? above : below;
      const left = Math.max(12, Math.min(align === "end" ? b.right - w : b.left, vw - 12 - w));
      el.style.top = `${Math.round(top)}px`;
      el.style.left = `${Math.round(left)}px`;
    };
    place();
    window.addEventListener("scroll", place, true);
    window.addEventListener("resize", place);
    return () => { window.removeEventListener("scroll", place, true); window.removeEventListener("resize", place); };
  }, [open, align]);

  const face = trigger === "icon"
    ? <Icon name="info" className="size-3.5" />
    : trigger === "why" ? <span className="text-xs font-medium text-brand hover:underline">Why?</span> : trigger;

  return (
    <span ref={host} className={`relative inline-flex align-middle ${className ?? ""}`}
      onMouseEnter={() => setHover(true)} onMouseLeave={() => setHover(false)}>
      <button ref={button} type="button" aria-label={trigger === "icon" ? label : undefined} aria-expanded={open} aria-describedby={open ? id : undefined}
        onClick={(e) => { e.preventDefault(); e.stopPropagation(); setPinned((v) => !v); }}
        onFocus={() => setHover(true)} onBlur={() => setHover(false)}
        className={`inline-flex items-center rounded-xs outline-none focus-visible:ring-2 focus-visible:ring-brand-100 ${trigger === "icon" ? "text-ink-4 hover:text-ink-2" : ""}`}>
        {face}
      </button>
      {open && (
        <span ref={tip} id={id} role="tooltip"
          className="fixed left-0 top-0 z-40 block w-[300px] max-w-[calc(100vw-24px)] rounded-md bg-ink px-3.5 py-3 text-left text-sm font-normal normal-case tracking-normal text-white shadow-md">
          {title && <span className="mb-[3px] block font-medium text-white">{title}</span>}
          {children && <span className="block text-white/90">{children}</span>}
          {cite && <span className="mt-1.5 block text-xs text-white/70">{cite}</span>}
        </span>
      )}
    </span>
  );
}

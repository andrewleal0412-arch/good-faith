"use client";

import { useEffect, useId, useLayoutEffect, useRef, useState, type FocusEvent, type PointerEvent, type ReactNode } from "react";
import { Icon } from "./icons";

// The one place legal detail lives: a dark tooltip opened from an info icon or a "Why?" link. A mouse hovering it or
// keyboard focus shows it, a click or a tap pins it open (a second one closes it), Escape or a click elsewhere closes
// it. WCAG 1.4.13: the pointer can move from the trigger onto the tip without it closing (a short grace covers the gap),
// Escape closes it whatever opened it, without moving focus, and it stays until then. The tip is fixed to the viewport
// and placed from its trigger, so a table's scroll box or a card's overflow never clips it, and it stays 12px inside the
// screen. Every trigger is at least 24 by 24 px to touch (WCAG 2.5.8), the extra room taken by negative margins so the
// line it sits in doesn't move.

const GRACE_MS = 150;

export function InfoTip({ title, children, cite, label = "More information", trigger = "icon", align = "start", className }: {
  title?: ReactNode;
  children?: ReactNode;
  cite?: ReactNode; // the citation line, in the tip's muted footer
  label?: string;
  trigger?: "icon" | "why" | ReactNode;
  align?: "start" | "end";
  className?: string;
}) {
  const [hover, setHover] = useState(false); // a mouse over the trigger or the tip
  const [focused, setFocused] = useState(false); // keyboard focus on the trigger
  const [pinned, setPinned] = useState(false); // a click or a tap
  const [dismissed, setDismissed] = useState(false); // Escape, until the pointer and focus have left
  const host = useRef<HTMLSpanElement>(null);
  const button = useRef<HTMLButtonElement>(null);
  const tip = useRef<HTMLSpanElement>(null);
  const leave = useRef<ReturnType<typeof setTimeout> | null>(null);
  const id = useId();
  const open = (hover || focused || pinned) && !dismissed;

  useEffect(() => {
    if (!open) return;
    const away = (e: MouseEvent) => { if (!host.current?.contains(e.target as Node)) { setPinned(false); setHover(false); } };
    const esc = (e: KeyboardEvent) => {
      if (e.key !== "Escape") return;
      setPinned(false);
      setDismissed(true);
    };
    document.addEventListener("mousedown", away);
    document.addEventListener("keydown", esc);
    return () => { document.removeEventListener("mousedown", away); document.removeEventListener("keydown", esc); };
  }, [open]);
  useEffect(() => () => { if (leave.current) clearTimeout(leave.current); }, []);

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
      const below = b.bottom + 4, above = b.top - 4 - h;
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

  // Only a mouse hovers: a touch's emulated hover would leave the tip open after the tap that meant to close it.
  const enter = (e: PointerEvent) => {
    if (e.pointerType !== "mouse") return;
    if (leave.current) clearTimeout(leave.current);
    // A pointer arriving asks again, after an Escape too.
    if (!hover) setDismissed(false);
    setHover(true);
  };
  const exit = (e: PointerEvent) => {
    if (e.pointerType !== "mouse") return;
    if (leave.current) clearTimeout(leave.current);
    leave.current = setTimeout(() => {
      setHover(false);
      if (!focused) setDismissed(false);
    }, GRACE_MS);
  };
  // Keyboard focus opens it; the focus a tap or a click gives the button doesn't (the click pins it instead).
  const onFocus = (e: FocusEvent<HTMLButtonElement>) => { if (e.currentTarget.matches(":focus-visible")) setFocused(true); };
  const onBlur = () => { setFocused(false); setDismissed(false); };

  const face = trigger === "icon"
    ? <Icon name="info" className="size-3.5" />
    : trigger === "why" ? <span className="text-xs font-medium text-brand hover:underline">Why?</span> : trigger;
  // The icon's 14px in a 24px target; a word's line grows by 4px above and below.
  const room = trigger === "icon" ? "-m-[5px] size-6 justify-center text-ink-3 hover:text-ink" : "-my-1 py-1";
  // Each trigger is named for what it explains, so a screen reader tabbing through a statement's sixteen info icons
  // hears which is which: the icon by its tip's title ("Deposits held, more information"), a Why? by "Why?" and the
  // title (the words it shows first, WCAG 2.5.3). A dotted label is named by its own words. A tooltip trigger is not a
  // disclosure, so it carries no aria-expanded; the tip's text is its description while it is open.
  const about = typeof title === "string" ? title.trim().replace(/[.:]$/, "") : "";
  const name = trigger === "icon" ? (label === "More information" && about ? `${about}, more information` : label)
    : trigger === "why" && about ? `Why? ${about}` : undefined;

  return (
    <span ref={host} className={`relative inline-flex align-middle ${className ?? ""}`} onPointerEnter={enter} onPointerLeave={exit}>
      <button ref={button} type="button" data-tip="" aria-label={name} aria-describedby={open ? id : undefined}
        onClick={(e) => {
          e.preventDefault();
          e.stopPropagation();
          // A click pins it open (over a hover or keyboard focus too, so it stays when they leave); a click on a pinned
          // one closes it.
          if (pinned) { setPinned(false); setHover(false); setDismissed(true); } else { setPinned(true); setDismissed(false); }
        }}
        onFocus={onFocus} onBlur={onBlur}
        className={`inline-flex items-center rounded-xs transition-colors ${room}`}>
        {face}
      </button>
      {open && (
        <span ref={tip} id={id} role="tooltip"
          className="gf-tip fixed left-0 top-0 z-40 block w-[300px] max-w-[calc(100vw-24px)] whitespace-normal rounded-md bg-ink px-3.5 py-3 text-left text-sm font-normal normal-case tracking-normal text-white shadow-md">
          {title && <span className="mb-[3px] block font-medium text-white">{title}</span>}
          {children && <span className="block text-white/90">{children}</span>}
          {cite && <span className="mt-1.5 block text-xs text-white/70">{cite}</span>}
        </span>
      )}
    </span>
  );
}

/** A label that opens its own tip (pass it as `trigger`): a dotted underline in place of an info icon, for lists where
 *  an icon on every row would stack into a column of chrome. */
export function TipLabel({ children }: { children: ReactNode }) {
  return <span className="text-left underline decoration-ink-4 decoration-dotted underline-offset-[3px] hover:decoration-ink-2">{children}</span>;
}

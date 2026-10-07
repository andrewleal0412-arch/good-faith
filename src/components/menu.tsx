"use client";

import Link from "@/components/link";
import { useEffect, useId, useLayoutEffect, useRef, useState, type KeyboardEvent, type ReactNode } from "react";
import { createPortal } from "react-dom";
import { Icon, MoreGlyph, type IconName } from "./icons";
import { DUR, usePresence } from "./motion";

// A small popover menu: the row overflow (three dots), the record header's More, the bell and the account button.
// Items are links (a file download, an .ics or a PDF, is a plain <a>) or actions on the page. The popover is fixed to
// the viewport and placed from the trigger, so a table's scroll box or a card's overflow never clips it; it flips
// above the trigger when there is no room below.
//
// From the keyboard it is the WAI-ARIA menu button: Enter, Space or the arrow keys open it with focus on its first item
// (the last, with ArrowUp), the arrow keys, Home and End move between the items, Escape closes it and puts focus back on
// its button, and Tab closes it and moves on to the next control (a grid row's menu, drawn on the body, closes back on
// its button instead). A popover with free content (the bell's list, the account card) is a small non-modal dialog
// instead of a menu: its links and buttons are in the Tab order, the arrow keys still move between them, and it closes
// when focus leaves it, with focus going on where Tab sent it.

export type MenuItem = { label: string; href: string; icon?: IconName; plain?: boolean; newTab?: boolean }
  // An action on the page, not a link. `checked` makes it a choice that is on or off (a column shown), or with `radio`
  // one of a set (a date range); the check icon then shows for a sighted reader what aria-checked says.
  | { label: string; onSelect: () => void; icon?: IconName; disabled?: boolean; checked?: boolean; radio?: boolean }
  | { divider: true } | { heading: string };

const FOCUSABLE = "[role^=menuitem]:not([aria-disabled=true]), a[href], button:not([disabled])";

/** The items a reader can move between, in order. */
const focusablesIn = (m: HTMLElement | null): HTMLElement[] =>
  m ? [...new Set(m.querySelectorAll<HTMLElement>(FOCUSABLE))].filter((el) => el.getClientRects().length > 0) : [];

export function Menu({ items, label = "More", named = true, trigger, align = "end", side = "bottom", buttonClass, width = 220, portal, children }: {
  items?: MenuItem[];
  side?: "bottom" | "top";
  label?: string; // the popover's name, and the button's unless `named` is false
  named?: boolean; // false: the button is named by the words it shows (the sidebar's account name), not by `label`
  trigger?: ReactNode; // defaults to the three-dot glyph
  align?: "start" | "end";
  buttonClass?: string;
  width?: number;
  portal?: boolean; // render the popover on the body: for a menu inside a grid cell, whose row is transformed
  // Free content under the items (the bell's list, the account card). As a function it gets `close`, for an action in
  // it that opens something of its own (the account card's Start over opens a dialog).
  children?: ReactNode | ((close: () => void) => ReactNode);
}) {
  // Open or not, and, once closed, whether focus goes back to the button: yes for an item chosen, Escape, or Tab out of a
  // menu on the body; no when focus is leaving on its own (Tab past a popover's last link, Shift+Tab from its button)
  // or a click lands elsewhere, so the browser's own focus move goes where the reader sent it.
  const [st, setSt] = useState({ open: false, back: false });
  const open = st.open;
  const setOpen = (v: boolean) => setSt({ open: v, back: false });
  const host = useRef<HTMLDivElement>(null);
  const button = useRef<HTMLButtonElement>(null);
  const pop = useRef<HTMLDivElement>(null);
  const popId = useId();
  // Which item takes focus when it opens: the first, or the last (ArrowUp on the button).
  const startAt = useRef<"first" | "last">("first");
  // A plain list of items is a menu; one with free content is a small dialog.
  const isMenu = children == null;
  // It drops from its trigger (rises, when it opens upward) and fades as it closes.
  const { mounted, state } = usePresence(open, DUR.fast);

  const close = () => setSt({ open: false, back: true });
  const dismiss = () => setSt({ open: false, back: false });

  // Once closed by a choice or Escape, focus goes back to the button if it was in the popover (or fell to the page as
  // the popover went inert), so a keyboard reader carries on from where the menu was; never when focus has already gone
  // somewhere else.
  useLayoutEffect(() => {
    if (open || !st.back) return;
    const a = document.activeElement, m = pop.current;
    if (!a || a === document.body || (m && m.contains(a))) button.current?.focus({ preventScroll: true });
  }, [open, st.back]);

  useEffect(() => {
    if (!open) return;
    // A click elsewhere: focus goes where the click put it. Escape: back on the button.
    const away = (e: MouseEvent) => {
      const t = e.target as Node;
      if (!host.current?.contains(t) && !pop.current?.contains(t)) setSt({ open: false, back: false });
    };
    const esc = (e: globalThis.KeyboardEvent) => { if (e.key === "Escape") setSt({ open: false, back: true }); };
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
      m.dataset.side = top < b.top ? "top" : "bottom";
    };
    place();
    // Then focus goes in, once it is where it will stay (no scroll jump).
    // On its first item (its last, from ArrowUp); a popover with nothing to choose (an empty bell) takes focus itself,
    // so a screen reader reads what it says.
    const xs = focusablesIn(pop.current);
    (startAt.current === "last" ? xs[xs.length - 1] : xs[0] ?? pop.current)?.focus({ preventScroll: true });
    startAt.current = "first";
    window.addEventListener("scroll", place, true);
    window.addEventListener("resize", place);
    return () => { window.removeEventListener("scroll", place, true); window.removeEventListener("resize", place); };
  }, [open, side, align]);

  function onPopKey(e: KeyboardEvent<HTMLDivElement>) {
    const xs = focusablesIn(pop.current);
    const i = xs.indexOf(document.activeElement as HTMLElement);
    const to = e.key === "ArrowDown" ? (i + 1) % xs.length : e.key === "ArrowUp" ? (i <= 0 ? xs.length - 1 : i - 1)
      : e.key === "Home" ? 0 : e.key === "End" ? xs.length - 1 : null;
    if (to != null && xs.length) {
      e.preventDefault();
      xs[to].focus({ preventScroll: true });
      return;
    }
    // A menu is one stop in the Tab order: Tab closes it and goes on from its button (WAI-ARIA's menu button), to the
    // next control on the page, or with Shift to the button itself, since the menu follows it. A menu drawn on the body
    // (a grid row's) has no place in the page's order, so Tab closes it back on its button in the cell, and the next Tab
    // leaves the grid.
    if (e.key === "Tab" && isMenu) {
      if (portal) {
        e.preventDefault();
        close();
      } else {
        dismiss();
      }
    }
  }

  function onButtonKey(e: KeyboardEvent<HTMLButtonElement>) {
    if (e.key !== "ArrowDown" && e.key !== "ArrowUp") return;
    // In a grid's cell the arrow keys are the grid's: they move on from the row's menu button (back on it after Escape)
    // to the next row, and Enter or Space opens the menu.
    if (e.currentTarget.closest(".ag-cell")) return;
    e.preventDefault();
    startAt.current = e.key === "ArrowUp" ? "last" : "first";
    setOpen(true);
  }

  // A dialog popover closes when focus leaves it and its button for somewhere else on the page, and focus goes on there.
  function onBlurOut(e: React.FocusEvent<HTMLDivElement>) {
    const next = e.relatedTarget as Node | null;
    if (!next || host.current?.contains(next) || pop.current?.contains(next)) return;
    dismiss();
  }

  // The list itself, rendered in place or, with `portal`, on the body.
  const popover = () => (
    <div ref={pop} id={popId} role={isMenu ? "menu" : "dialog"} aria-label={label} style={{ width }} data-state={state} inert={!open} tabIndex={-1}
      onKeyDown={onPopKey} onBlur={isMenu ? undefined : onBlurOut}
      className="gf-pop fixed left-0 top-0 z-40 max-w-[calc(100vw-24px)] rounded-md border border-line bg-canvas p-1 shadow-md focus-visible:outline-none">
      {items?.map((it, i) => {
        if ("divider" in it) return <div key={i} role="separator" className="my-1 h-px bg-line-2" />;
        if ("heading" in it) return <div key={i} role="presentation" className="px-2.5 pb-1 pt-2 text-xs font-medium text-ink-3">{it.heading}</div>;
        const cls = "flex h-8 items-center gap-2.5 rounded-sm px-2.5 text-sm text-ink-2 transition-colors hover:bg-surface hover:text-ink focus-visible:bg-surface focus-visible:text-ink focus-visible:-outline-offset-2";
        const body = <>{it.icon && <Icon name={it.icon} className="size-[15px] text-ink-3" />}<span className="truncate">{it.label}</span></>;
        // In a menu the items are reached with the arrow keys (one Tab stop); in a dialog popover, with Tab as well.
        const item = isMenu ? { tabIndex: -1 } : {};
        if ("onSelect" in it) {
          const role = !isMenu ? undefined : it.checked == null ? "menuitem" : it.radio ? "menuitemradio" : "menuitemcheckbox";
          return (
            <button key={i} type="button" role={role} aria-checked={role && it.checked != null ? it.checked : undefined} disabled={it.disabled}
              className={`${cls} w-full text-left disabled:opacity-50`} {...item}
              onClick={() => { close(); it.onSelect(); }}>{body}</button>
          );
        }
        const role = isMenu ? "menuitem" : undefined;
        return it.plain || it.newTab
          ? <a key={i} role={role} href={it.href} className={cls} target={it.newTab ? "_blank" : undefined} rel={it.newTab ? "noreferrer" : undefined} {...item}
            onClick={close}>{body}{it.newTab && <span className="sr-only"> (opens in a new tab)</span>}</a>
          : <Link key={i} role={role} href={it.href} className={cls} {...item} onClick={close}>{body}</Link>;
      })}
      {typeof children === "function" ? children(close) : children}
    </div>
  );

  return (
    <div ref={host} className="relative inline-flex max-w-full" onBlur={isMenu ? undefined : onBlurOut}>
      <button ref={button} type="button" aria-label={named ? label : undefined} aria-haspopup={isMenu ? "menu" : "dialog"} aria-expanded={open}
        aria-controls={mounted ? popId : undefined} onClick={() => setOpen(!open)} onKeyDown={onButtonKey}
        className={buttonClass ?? "inline-flex size-7 items-center justify-center rounded-sm text-ink-3 transition-colors hover:bg-surface-2 hover:text-ink"}>
        {trigger ?? <MoreGlyph className="size-4" />}
      </button>
      {mounted && (portal ? createPortal(popover(), document.body) : popover())}
    </div>
  );
}

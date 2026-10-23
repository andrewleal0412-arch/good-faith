"use client";

import { useEffect, useId, useRef, useState, type ReactNode, type RefObject } from "react";
import { Icon } from "./icons";
import { usePresence } from "./motion";
import { LineMark } from "./ui";

// A side drawer for a form that belongs to one thing on the page (a deduction for a finding, a finding for a room):
// 480px from the right on a computer, the full screen on a phone. It is a modal: focus moves in and stays in, Escape
// or the close button shuts it, the page behind doesn't scroll, and focus goes back to what opened it. Every drawer
// form ends in the same footer, `drawerFooter`: under the form, held to the drawer's foot when the form is longer
// than the screen. Yes-or-no questions use the smaller centered dialog in confirm.tsx instead.

export const drawerFooter = "sticky -bottom-5 -mx-5 -mb-5 mt-6 flex gap-2 border-t border-line-2 bg-canvas px-5 py-3.5";

/** The modal behavior the drawer and the confirm dialog share. Focus starts on a marked control, else the first field,
 *  else Close (never on an action button, so Enter can't confirm by accident); Tab stays inside; Escape closes; the
 *  page behind doesn't scroll; focus returns to what opened it. */
export function useModal(open: boolean, panel: RefObject<HTMLElement | null>, onClose: () => void, body?: RefObject<HTMLElement | null>) {
  const close = useRef(onClose);
  useEffect(() => { close.current = onClose; }, [onClose]);

  useEffect(() => {
    if (!open) return;
    const back = document.activeElement as HTMLElement | null;
    const first = panel.current?.querySelector<HTMLElement>("[data-autofocus]")
      ?? (body ?? panel).current?.querySelector<HTMLElement>("input:not([type=hidden]), select, textarea")
      ?? panel.current?.querySelector<HTMLElement>("button[aria-label=Close]");
    first?.focus();
    const overflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    const key = (e: KeyboardEvent) => {
      if (e.key === "Escape") { e.stopPropagation(); return close.current(); }
      if (e.key !== "Tab" || !panel.current) return;
      const f = [...panel.current.querySelectorAll<HTMLElement>("a[href], button:not([disabled]), input:not([disabled]), select, textarea, [tabindex]:not([tabindex='-1'])")]
        .filter((el) => el.offsetParent !== null);
      if (!f.length) return;
      if (e.shiftKey && document.activeElement === f[0]) { e.preventDefault(); f[f.length - 1].focus(); }
      else if (!e.shiftKey && document.activeElement === f[f.length - 1]) { e.preventDefault(); f[0].focus(); }
    };
    document.addEventListener("keydown", key);
    return () => {
      document.removeEventListener("keydown", key);
      document.body.style.overflow = overflow;
      back?.focus?.();
    };
  }, [open, panel, body]);
}

export function Drawer({ open, onClose, title, sub, children }: {
  open: boolean;
  onClose: () => void;
  title: ReactNode;
  sub?: ReactNode;
  children: ReactNode;
}) {
  const panel = useRef<HTMLDivElement>(null);
  const body = useRef<HTMLDivElement>(null);
  const titleId = useId();
  useModal(open, panel, onClose, body);
  // It slides in from the right over a fading backdrop and leaves the same way (a sheet rising on a phone); while it
  // leaves it shows what it last held, and takes no clicks or focus.
  const { mounted, state } = usePresence(open);
  const [kept, setKept] = useState<{ title: ReactNode; sub: ReactNode; children: ReactNode }>({ title, sub, children });
  if (open && (kept.title !== title || kept.sub !== sub || kept.children !== children)) setKept({ title, sub, children });
  if (!mounted) return null;
  const shown = open ? { title, sub, children } : kept;
  return (
    <div className="fixed inset-0 z-50 print:hidden" role="dialog" aria-modal={open ? "true" : undefined} aria-labelledby={titleId} inert={!open}>
      <button type="button" aria-hidden tabIndex={-1} data-state={state} className="gf-scrim absolute inset-0 cursor-default bg-ink/30" onClick={onClose} />
      <div ref={panel} data-state={state} className="gf-drawer absolute inset-y-0 right-0 flex w-full flex-col bg-canvas shadow-md sm:w-[480px] sm:border-l sm:border-line">
        <div className="flex items-start gap-3 border-b border-line-2 px-5 py-4">
          <div className="min-w-0 flex-1">
            <h2 id={titleId} className="text-lg font-medium">{shown.title}</h2>
            {shown.sub && <p className="mt-0.5 truncate text-sm text-ink-3">{shown.sub}</p>}
          </div>
          <LineMark className="text-lg">
            <button type="button" aria-label="Close" onClick={onClose}
              className="-mr-1.5 inline-flex size-[34px] shrink-0 items-center justify-center rounded-md text-ink-2 transition-colors hover:bg-surface">
              <Icon name="x" />
            </button>
          </LineMark>
        </div>
        {/* A field scrolled to by Tab stops clear of the footer held to the drawer's foot (WCAG 2.4.11). */}
        <div ref={body} className="min-h-0 flex-1 scroll-pb-24 overflow-y-auto px-5 py-5">{shown.children}</div>
      </div>
    </div>
  );
}

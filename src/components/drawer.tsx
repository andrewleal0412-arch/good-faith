"use client";

import { useEffect, useId, useRef, type ReactNode } from "react";
import { Icon } from "./icons";

// A side drawer for a form that belongs to one thing on the page (a deduction for a finding, a finding for a room):
// 480px from the right on a computer, the full screen on a phone. It is a modal: focus moves in and stays in, Escape
// or the close button shuts it, the page behind doesn't scroll, and focus goes back to what opened it.

export function Drawer({ open, onClose, title, sub, children, footer }: {
  open: boolean;
  onClose: () => void;
  title: ReactNode;
  sub?: ReactNode;
  children: ReactNode;
  footer?: ReactNode; // the actions, pinned to the drawer's foot
}) {
  const panel = useRef<HTMLDivElement>(null);
  const close = useRef(onClose);
  const titleId = useId();

  useEffect(() => { close.current = onClose; }, [onClose]);

  useEffect(() => {
    if (!open) return;
    const back = document.activeElement as HTMLElement | null;
    const first = panel.current?.querySelector<HTMLElement>("[data-autofocus], input:not([type=hidden]), select, textarea, button");
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
  }, [open]);

  if (!open) return null;
  return (
    <div className="fixed inset-0 z-50 print:hidden" role="dialog" aria-modal="true" aria-labelledby={titleId}>
      <button type="button" aria-hidden tabIndex={-1} className="absolute inset-0 cursor-default bg-ink/30" onClick={onClose} />
      <div ref={panel} className="absolute inset-y-0 right-0 flex w-full flex-col bg-canvas shadow-md sm:w-[480px] sm:border-l sm:border-line">
        <div className="flex items-start gap-3 border-b border-line-2 px-5 py-4">
          <div className="min-w-0 flex-1">
            <h2 id={titleId} className="text-lg font-medium">{title}</h2>
            {sub && <p className="mt-0.5 truncate text-sm text-ink-3">{sub}</p>}
          </div>
          <button type="button" aria-label="Close" onClick={onClose}
            className="-mr-1.5 -mt-0.5 inline-flex size-[34px] shrink-0 items-center justify-center rounded-md text-ink-2 hover:bg-surface">
            <Icon name="x" />
          </button>
        </div>
        <div className="min-h-0 flex-1 overflow-y-auto px-5 py-5">{children}</div>
        {footer && <div className="flex items-center gap-2 border-t border-line-2 px-5 py-3.5">{footer}</div>}
      </div>
    </div>
  );
}

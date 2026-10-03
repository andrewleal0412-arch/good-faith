"use client";

import { useCallback, useId, useRef, useState, type ReactNode } from "react";
import { Button } from "./button";
import { useModal } from "./drawer";

// The app's yes-or-no question, instead of the browser's own confirm box: a small centered dialog (Mercury and
// Stripe keep side panels for forms), a sheet along the bottom on a phone. A question for a title, one line on what
// happens, the action and Cancel. Focus starts on Cancel, never on the action, so Enter can't confirm by accident.

/** The dialog itself, for a question a component asks on its own ("Compare again?"). */
export function ConfirmDialog({ open, title, body, action, onConfirm, onCancel }: {
  open: boolean; title: ReactNode; body: ReactNode; action: string; onConfirm: () => void; onCancel: () => void;
}) {
  const panel = useRef<HTMLDivElement>(null);
  const titleId = useId();
  useModal(open, panel, onCancel);
  if (!open) return null;
  return (
    <div className="fixed inset-0 z-50 flex items-end justify-center sm:items-center sm:p-6 print:hidden" role="alertdialog" aria-modal="true" aria-labelledby={titleId}>
      <button type="button" aria-hidden tabIndex={-1} className="absolute inset-0 cursor-default bg-ink/30" onClick={onCancel} />
      <div ref={panel} className="relative w-full rounded-t-lg border border-line bg-canvas px-5 pb-5 pt-4 shadow-md sm:max-w-[400px] sm:rounded-lg">
        <h2 id={titleId} className="text-lg font-medium">{title}</h2>
        <div className="mt-1 text-sm text-ink-2">{body}</div>
        <div className="mt-5 flex flex-row-reverse gap-2 max-sm:flex-col">
          <Button variant="primary" onClick={onConfirm} className="max-sm:h-10 max-sm:w-full">{action}</Button>
          <Button data-autofocus onClick={onCancel} className="max-sm:h-10 max-sm:w-full">Cancel</Button>
        </div>
      </div>
    </div>
  );
}

type Ask = { title: string; body: ReactNode; action: string };

/** `const [confirm, dialog] = useConfirm()`: render `dialog` once, then `if (!(await confirm({...}))) return;`. */
export function useConfirm() {
  const [ask, setAsk] = useState<Ask | null>(null);
  const resolver = useRef<((ok: boolean) => void) | null>(null);

  const confirm = useCallback((a: Ask) => new Promise<boolean>((resolve) => {
    // A second question answers the first one no, so no caller is left waiting.
    resolver.current?.(false);
    resolver.current = resolve;
    setAsk(a);
  }), []);

  const done = useCallback((ok: boolean) => {
    resolver.current?.(ok);
    resolver.current = null;
    setAsk(null);
  }, []);

  const dialog = (
    <ConfirmDialog open={!!ask} title={ask?.title} body={ask?.body} action={ask?.action ?? ""}
      onConfirm={() => done(true)} onCancel={() => done(false)} />
  );

  return [confirm, dialog] as const;
}

"use client";

import { cloneElement, isValidElement, useId, type ReactElement, type ReactNode } from "react";

/** A form field whose label names its control. The control gets an id and the label points at it, so an info button
 *  beside the label is never what the label names. `group` is for a set of buttons (a segmented choice), which takes
 *  the label as its group name instead. `note` is a line of help under the control. */
export function FormField({ label, hint, note, group, labelClass, children }: {
  label: ReactNode;
  hint?: ReactNode;
  note?: ReactNode;
  group?: boolean;
  labelClass?: string;
  children: ReactNode;
}) {
  const id = useId();
  const noteId = `${id}-note`;
  const head = labelClass ?? "mb-1.5 flex items-center gap-1.5 text-sm font-medium text-ink";
  const foot = note ? <p id={noteId} className="mt-1 text-xs text-ink-3">{note}</p> : null;
  if (group) {
    return (
      <div role="group" aria-labelledby={id} aria-describedby={note ? noteId : undefined}>
        <div className={head}><span id={id}>{label}</span>{hint}</div>
        {children}
        {foot}
      </div>
    );
  }
  // The control gets the label's id, and the note (if any) as its description, beside one it already has (an error).
  const control = isValidElement(children)
    ? cloneElement(children as ReactElement<{ id?: string; "aria-describedby"?: string }>, {
      id,
      "aria-describedby": [(children as ReactElement<{ "aria-describedby"?: string }>).props["aria-describedby"], note ? noteId : null].filter(Boolean).join(" ") || undefined,
    })
    : children;
  return (
    <div>
      <div className={head}><label htmlFor={id}>{label}</label>{hint}</div>
      {control}
      {foot}
    </div>
  );
}

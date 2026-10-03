"use client";

import { buttonClass } from "./button";
import { Icon, type IconName } from "./icons";

// A file picker in the system's own controls: the browser's input is visually hidden behind a secondary button, and
// what was picked is named beside it in quiet text. A FormField label still names the input through `id`.

export function FilePick({ id, label, icon = "upload", accept, multiple, files, onChange, ariaLabel }: {
  id?: string;
  label: string;
  icon?: IconName;
  accept?: string;
  multiple?: boolean;
  files: File[];
  onChange: (files: File[]) => void;
  ariaLabel?: string;
}) {
  const picked = files.length === 1 ? files[0].name : files.length > 1 ? `${files.length} files` : "";
  return (
    <span className="flex min-w-0 flex-wrap items-center gap-x-3 gap-y-1.5">
      <label className={buttonClass("secondary", "md", "cursor-pointer focus-within:ring-3 focus-within:ring-brand-100")}>
        <Icon name={icon} />{label}
        <input id={id} type="file" className="sr-only" accept={accept} multiple={multiple} aria-label={ariaLabel}
          onChange={(e) => onChange(Array.from(e.currentTarget.files ?? []))} />
      </label>
      {picked && <span className="min-w-0 max-w-full truncate text-sm text-ink-3" title={files.map((f) => f.name).join(", ")}>{picked}</span>}
    </span>
  );
}

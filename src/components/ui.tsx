import Link from "next/link";
import type { ComponentProps, ReactNode } from "react";
import { Icon, type IconName } from "./icons";

// The shared pieces of the Good Faith system: chips, money, cards, tabs, tables, the facts strip, lists and empty
// states. Server-safe (no hooks), so pages and client components both use them.

const cx = (...c: (string | false | null | undefined)[]) => c.filter(Boolean).join(" ");

/** The product's wordmark: the name in the app font, no logomark until a real one exists. */
export function Wordmark() {
  return <span className="text-lg font-semibold tracking-[-0.015em] text-ink">Good Faith</span>;
}

/* ---------- Status chip: one color per status ---------- */

export type Tone = "green" | "amber" | "red" | "gray";
const TONE: Record<Tone, string> = {
  green: "bg-green-bg text-green",
  amber: "bg-amber-bg text-amber",
  red: "bg-red-bg text-red",
  gray: "bg-surface-2 text-ink-3",
};

/** A dot for workflow status, plain (`dot={false}`) for a classification such as Damage or Wear and tear. */
export function StatusChip({ tone, children, dot = true, size = "md", className }: {
  tone: Tone; children: ReactNode; dot?: boolean; size?: "sm" | "md" | "lg"; className?: string;
}) {
  const s = size === "lg" ? "h-[26px] px-2.5 text-sm" : size === "sm" ? "h-[18px] px-1.5 text-xs" : "h-[22px] px-2 text-xs";
  return (
    <span className={cx("inline-flex shrink-0 items-center gap-1.5 whitespace-nowrap rounded-sm font-medium", s, TONE[tone], className)}>
      {dot && <span className="size-1.5 rounded-full bg-current opacity-90" />}
      {children}
    </span>
  );
}

/* ---------- Money ---------- */

const fmt = (n: number) => Math.abs(n).toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 });

/** An amount in tabular figures. `cents="small"` raises the cents at 60%, as Mercury's balance does: used for the one
 *  hero number of a view and the stat tiles. On a phone, where a strip's hero is no bigger than its neighbours,
 *  `phoneCents` says what the cents do, so one strip never mixes precisions: "hide" (the default) when every cell in
 *  the strip is a small-cents figure, "full" when its neighbours print full cents, "raised" for a tile that spans the
 *  screen. Outflows pass `sign="minus"` and get a true minus. */
export function Money({ value, cents = "full", sign, phoneCents = "hide", className }: {
  value: number; cents?: "small" | "full"; sign?: "minus" | "plus"; phoneCents?: "hide" | "full" | "raised"; className?: string;
}) {
  const [whole, frac] = fmt(value).split(".");
  const pre = sign === "minus" || (value < 0 && sign !== "plus") ? "−" : sign === "plus" ? "+" : "";
  const phone = phoneCents === "hide" ? "max-sm:hidden" : phoneCents === "full" ? "max-sm:static max-sm:align-baseline max-sm:text-[1em]" : "";
  return (
    <span className={cx("whitespace-nowrap tabular-nums", className)}>
      {pre}${whole}
      {cents === "small" ? <span className={cx("relative top-[0.18em] align-top text-[0.6em] tracking-normal", phone)}>.{frac}</span> : <>.{frac}</>}
    </span>
  );
}

/* ---------- Cards ---------- */

export function Card({ className, soft, children, ...rest }: { soft?: boolean } & ComponentProps<"div">) {
  return (
    <div className={cx("rounded-lg border", soft ? "border-line-2 bg-surface" : "border-line bg-canvas shadow-sm", className)} {...rest}>
      {children}
    </div>
  );
}

export function CardHead({ title, meta, right, className }: { title: ReactNode; meta?: ReactNode; right?: ReactNode; className?: string }) {
  return (
    <div className={cx("flex min-h-[52px] items-center gap-2.5 border-b border-line-2 px-5 py-3", className)}>
      <h2 className="text-lg font-medium">{title}</h2>
      {meta && <span className="text-xs text-ink-3">{meta}</span>}
      {right && <div className="ml-auto flex items-center gap-2">{right}</div>}
    </div>
  );
}

/* ---------- Page head ---------- */

export function PageHead({ title, actions, sub }: { title: ReactNode; actions?: ReactNode; sub?: ReactNode }) {
  return (
    <div className="mb-5 flex flex-wrap items-center gap-x-4 gap-y-3">
      <div className="min-w-0">
        <h1 className="text-xl font-medium">{title}</h1>
        {sub && <p className="mt-0.5 text-sm text-ink-3">{sub}</p>}
      </div>
      {actions && <div className="ml-auto flex flex-wrap items-center gap-2">{actions}</div>}
    </div>
  );
}

/* ---------- Tabs and segmented filters ---------- */

export type TabItem = { key: string; label: ReactNode; href: string; count?: number };
export { Tabs } from "./tabs";

/** Segmented filters with counts, as links (Zillow's property filters). */
export function Segmented({ items, active, className }: { items: TabItem[]; active: string; className?: string }) {
  return (
    <div className={cx("inline-flex max-w-full gap-0.5 overflow-x-auto rounded-md bg-surface-2 p-[3px]", className)}>
      {items.map((t) => {
        const on = t.key === active;
        return (
          <Link key={t.key} href={t.href} scroll={false} aria-current={on ? "true" : undefined}
            className={cx("inline-flex h-7 shrink-0 items-center gap-[5px] rounded-sm px-2.5 text-sm",
              on ? "bg-canvas font-medium text-ink shadow-sm" : "text-ink-3 hover:text-ink")}>
            {t.label}
            {t.count != null && <span className="font-normal text-ink-3">{t.count}</span>}
          </Link>
        );
      })}
    </div>
  );
}

/* ---------- Facts strip and stat tiles ---------- */

export function FactStrip({ children, cols = 3, className }: { children: ReactNode; cols?: 2 | 3 | 4; className?: string }) {
  const grid = cols === 4 ? "grid-cols-2 lg:grid-cols-4" : cols === 2 ? "grid-cols-2" : "grid-cols-3";
  return (
    <div className={cx("grid overflow-hidden rounded-lg border border-line bg-canvas", grid,
      "[&>*]:border-line-2 [&>*]:border-r [&>*:last-child]:border-r-0",
      cols === 4 && "max-lg:[&>*:nth-child(2)]:border-r-0 max-lg:[&>*:nth-child(-n+2)]:border-b", className)}>
      {children}
    </div>
  );
}

/** One cell of the strip: a label, a value and one sub line. `big` is the view's hero figure. Where the strip wraps to
 *  two rows (below lg) the three share the strip's rows as a subgrid, so when a label or a sub line wraps on a phone
 *  the values beside it still line up; on one row each cell stacks on its own, as the mockup's strip does. */
export function Fact({ label, value, sub, big, info }: { label: ReactNode; value: ReactNode; sub?: ReactNode; big?: boolean; info?: ReactNode }) {
  return (
    <div className="row-span-3 grid min-w-0 grid-cols-1 grid-rows-subgrid content-start px-3 py-2.5 sm:px-5 sm:py-3.5 lg:row-span-1 lg:flex lg:flex-col">
      <div className="text-xs text-ink-3"><FactLabel label={label} info={info} /></div>
      <div className={cx("mt-1 truncate font-medium tabular-nums", big ? "text-base sm:text-xl" : "text-base sm:text-lg")}>{value}</div>
      {sub && <div className="mt-0.5 text-xs text-ink-3 sm:truncate">{sub}</div>}
    </div>
  );
}

/** The label and its tip as one run of text: the icon is tied to the last word, so on a phone it wraps with that word
 *  instead of floating to the cell's edge or onto a line of its own. */
function FactLabel({ label, info }: { label: ReactNode; info?: ReactNode }) {
  if (!info) return <>{label}</>;
  const tip = <span className="ml-[5px] inline-flex align-[-2px]">{info}</span>;
  if (typeof label !== "string" || !label.includes(" ")) return <>{label}{tip}</>;
  const cut = label.lastIndexOf(" ");
  return <>{label.slice(0, cut + 1)}<span className="whitespace-nowrap">{label.slice(cut + 1)}{tip}</span></>;
}

/* ---------- Key-value list ---------- */

export function KV({ rows, align = "left", className }: { rows: [ReactNode, ReactNode][]; align?: "left" | "right"; className?: string }) {
  return (
    <dl className={cx("grid gap-x-4 gap-y-2 text-sm", align === "right" ? "grid-cols-[minmax(0,1fr)_auto]" : "grid-cols-[minmax(110px,max-content)_minmax(0,1fr)]", className)}>
      {rows.map(([k, v], i) => (
        <div key={i} className="contents">
          <dt className={cx("text-ink-3", align === "left" && "whitespace-nowrap")}>{k}</dt>
          <dd className={cx("min-w-0 text-ink", align === "right" ? "whitespace-nowrap text-right tabular-nums" : "break-words")}>{v}</dd>
        </div>
      ))}
    </dl>
  );
}

/* ---------- Lists ---------- */

/** Mercury's list row: a title, one sub line, and something on the right (a date, an amount). */
export function ListRow({ title, sub, right, href, icon, hint }: { title: ReactNode; sub?: ReactNode; right?: ReactNode; href?: string; icon?: ReactNode; hint?: string }) {
  const body = (
    <>
      {icon}
      <div className="min-w-0 flex-1">
        <div className="text-sm font-medium">{title}</div>
        {sub && <div className="mt-px text-xs text-ink-3">{sub}</div>}
      </div>
      {right != null && <span className="ml-auto shrink-0 whitespace-nowrap text-sm tabular-nums text-ink-3">{right}</span>}
    </>
  );
  const cls = "flex items-center gap-3 border-b border-line-2 py-[11px] last:border-b-0";
  return href ? <Link href={href} title={hint} className={cx(cls, "hover:text-ink")}>{body}</Link> : <div title={hint} className={cls}>{body}</div>;
}

/** Zillow's next-step box: a flat brand icon, a title, one sub line, a chevron. */
export function StepBox({ icon, title, sub, href, plain }: { icon: IconName; title: ReactNode; sub?: ReactNode; href: string; plain?: boolean }) {
  const cls = "flex items-center gap-3 rounded-md border border-line bg-canvas px-3.5 py-3 hover:bg-surface";
  const body = (
    <>
      <Icon name={icon} className="size-4 text-brand" />
      <div className="min-w-0 flex-1">
        <div className="text-sm font-medium">{title}</div>
        {sub && <div className="truncate text-xs text-ink-3">{sub}</div>}
      </div>
      <Icon name="chev-right" className="size-3.5 text-ink-4" />
    </>
  );
  return plain ? <a href={href} className={cls}>{body}</a> : <Link href={href} className={cls}>{body}</Link>;
}

/* ---------- Tables ---------- */

/** A table that scrolls sideways inside its card when the screen is narrower than `minWidth`. */
export function Table({ children, className, minWidth }: { children: ReactNode; className?: string; minWidth?: number }) {
  return (
    <div className="overflow-x-auto">
      <table className={cx("w-full border-collapse", className)} style={minWidth ? { minWidth } : undefined}>{children}</table>
    </div>
  );
}

export function Th({ children, align = "left", className, first, last }: { children?: ReactNode; align?: "left" | "right"; className?: string; first?: boolean; last?: boolean }) {
  return (
    <th className={cx("whitespace-nowrap border-b border-line px-2.5 py-2.5 text-xs font-medium text-ink-3",
      align === "right" ? "text-right" : "text-left", first && "pl-5", last && "pr-5", className)}>
      {children}
    </th>
  );
}

export function Td({ children, align = "left", className, first, last, ...rest }: { align?: "left" | "right"; first?: boolean; last?: boolean } & ComponentProps<"td">) {
  return (
    <td className={cx("border-b border-line-2 px-2.5 py-3 align-middle text-sm",
      align === "right" && "text-right tabular-nums whitespace-nowrap", first && "pl-5", last && "pr-5", className)} {...rest}>
      {children}
    </td>
  );
}

/** A body row: no rule under the last one, surface on hover. */
export const trClass = "hover:bg-surface [&:last-child>td]:border-b-0";

/* ---------- Empty state ---------- */

/** An empty list, a missing page or a failed load: one icon, one line, one short sub line and at most one action.
 *  Brand for "nothing here yet", gray for "not found", red only for an error. `heading` makes the title the page's h1. */
export function EmptyState({ icon = "building", title, sub, action, tone = "brand", heading }: {
  icon?: IconName; title: ReactNode; sub?: ReactNode; action?: ReactNode; tone?: "brand" | "gray" | "red"; heading?: boolean;
}) {
  const t = tone === "red" ? "bg-red-bg text-red" : tone === "gray" ? "bg-surface-2 text-ink-3" : "bg-brand-50 text-brand";
  const Title = heading ? "h1" : "p";
  return (
    <div className="flex flex-col items-center px-6 py-12 text-center">
      <span className={cx("flex size-10 items-center justify-center rounded-full", t)}><Icon name={icon} className="size-[18px]" /></span>
      <Title className="mt-3 text-base font-medium">{title}</Title>
      {sub && <p className="mt-1 max-w-sm text-sm text-ink-3">{sub}</p>}
      {action && <div className="mt-4">{action}</div>}
    </div>
  );
}

/* ---------- Notices inside a view ---------- */

/** An error or a heads-up line. Red is for errors only; a plain note is gray. */
export function Notice({ tone = "red", children, className }: { tone?: "red" | "amber" | "gray"; children: ReactNode; className?: string }) {
  const t = tone === "red" ? "bg-red-bg text-red" : tone === "amber" ? "bg-amber-bg text-amber" : "bg-surface text-ink-2";
  return <p role={tone === "red" ? "alert" : undefined} className={cx("rounded-md px-3.5 py-2.5 text-sm", t, className)}>{children}</p>;
}

/* ---------- Form fields ---------- */

/** Inputs: 36px, radius 8, line border; focus is a brand border with a 3px brand-50 ring. */
export const inlineInputClass = "h-9 rounded-md border border-line bg-canvas px-3 text-base text-ink outline-none placeholder:text-ink-4 focus:border-brand focus:ring-3 focus:ring-brand-50 disabled:bg-surface";
export const inputClass = `${inlineInputClass} w-full`;
export const textareaClass = "w-full rounded-md border border-line bg-canvas px-3 py-2 text-base text-ink outline-none placeholder:text-ink-4 focus:border-brand focus:ring-3 focus:ring-brand-50";

/** Round thumbnail-free avatar with initials. */
export function Avatar({ initials, className }: { initials: string; className?: string }) {
  return (
    <span className={cx("inline-flex size-7 shrink-0 items-center justify-center rounded-full bg-brand-100 text-xs font-semibold tracking-[0.02em] text-brand-700", className)}>
      {initials}
    </span>
  );
}

export const initialsOf = (name: string) =>
  name.replace(/\b(LLC|Inc|LP|LLP|Co)\b\.?/gi, "").split(/\s+/).filter(Boolean).slice(0, 2).map((w) => w[0]!.toUpperCase()).join("") || "GF";

/** A property photo, or a quiet placeholder when none has been taken. */
export function Thumb({ src, size = 36, className }: { src: string | null; size?: number; className?: string }) {
  const style = { width: size, height: size };
  if (!src) {
    return (
      <span style={style} className={cx("inline-flex shrink-0 items-center justify-center rounded-sm border border-line bg-surface text-ink-4", className)}>
        <Icon name="building" className="size-4" />
      </span>
    );
  }
  // eslint-disable-next-line @next/next/no-img-element
  return <img src={src} alt="" style={style} className={cx("shrink-0 rounded-sm border border-line object-cover", className)} />;
}

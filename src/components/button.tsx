import Link from "next/link";
import type { ComponentProps } from "react";

// Three button styles and nothing else: primary (the one indigo action on a view), secondary (gray surface, like
// Mercury's Back) and link (in-card actions such as Edit or Add finding).

export type ButtonVariant = "primary" | "secondary" | "link";
export type ButtonSize = "sm" | "md" | "lg" | "icon";

const BASE = "inline-flex items-center justify-center gap-[7px] whitespace-nowrap rounded-md font-medium transition-colors outline-none focus-visible:ring-3 focus-visible:ring-brand-100 disabled:cursor-default disabled:opacity-50 aria-disabled:pointer-events-none aria-disabled:opacity-50";

const VARIANT: Record<ButtonVariant, string> = {
  primary: "bg-brand text-white hover:bg-brand-hover active:bg-brand-active disabled:hover:bg-brand",
  secondary: "bg-surface-2 text-ink hover:bg-surface-3 disabled:hover:bg-surface-2",
  link: "text-brand hover:underline disabled:hover:no-underline",
};

const SIZE: Record<ButtonSize, string> = {
  sm: "h-7 px-2.5 text-xs [&_svg]:size-3.5",
  md: "h-[34px] px-3.5 text-sm [&_svg]:size-[15px]",
  lg: "h-10 px-[18px] text-base [&_svg]:size-4",
  icon: "size-[34px] p-0 [&_svg]:size-4",
};

/** The class string, for the odd element that is neither a button nor a link (a file input's label). */
export function buttonClass(variant: ButtonVariant = "secondary", size: ButtonSize = "md", extra = ""): string {
  const s = variant === "link" ? (size === "sm" ? "text-xs" : size === "lg" ? "text-base" : "text-sm") + " [&_svg]:size-3.5 gap-1" : SIZE[size];
  return `${BASE} ${VARIANT[variant]} ${s} ${extra}`.trim();
}

type Common = { variant?: ButtonVariant; size?: ButtonSize };

export function Button({ variant = "secondary", size = "md", className = "", type = "button", ...rest }: Common & ComponentProps<"button">) {
  return <button type={type} className={buttonClass(variant, size, className)} {...rest} />;
}

/** A link styled as a button. External or file links (an .ics, a PDF) pass `plain` to use a bare <a>. */
export function ButtonLink({ variant = "secondary", size = "md", className = "", plain, href, ...rest }:
  Common & { plain?: boolean; href: string } & Omit<ComponentProps<"a">, "href">) {
  const cls = buttonClass(variant, size, className);
  if (plain) return <a href={href} className={cls} {...rest} />;
  return <Link href={href} className={cls} {...rest} />;
}

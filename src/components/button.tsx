import Link from "@/components/link";
import type { ComponentProps } from "react";

// Three button styles and nothing else: primary (the one indigo action on a view), secondary (gray surface, like
// Mercury's Back) and link (in-card actions such as Edit or Add finding).

export type ButtonVariant = "primary" | "secondary" | "link";
export type ButtonSize = "sm" | "md" | "lg" | "icon";

// Hover and press ease (the fast token, globals.css); a press sinks a button 2% so a click is felt at once. Keyboard
// focus is the app's one indicator, the 2px brand outline 2px outside the button (:focus-visible in globals.css), which
// eases in on its own.
const BASE = "inline-flex items-center justify-center gap-[7px] whitespace-nowrap rounded-md font-medium transition-[color,background-color,box-shadow,scale,opacity] disabled:cursor-default disabled:opacity-50 aria-disabled:pointer-events-none aria-disabled:opacity-50";

const VARIANT: Record<ButtonVariant, string> = {
  primary: "bg-brand text-white hover:bg-brand-hover active:bg-brand-active active:scale-[0.98] disabled:hover:bg-brand disabled:active:scale-100",
  secondary: "bg-surface-2 text-ink hover:bg-surface-3 active:scale-[0.98] disabled:hover:bg-surface-2 disabled:active:scale-100",
  link: "text-brand hover:underline disabled:hover:no-underline",
};

const SIZE: Record<ButtonSize, string> = {
  sm: "h-7 px-2.5 text-xs [&_svg]:size-3.5",
  md: "h-[34px] px-3.5 text-sm [&_svg]:size-[15px]",
  lg: "h-10 px-[18px] text-base [&_svg]:size-4",
  icon: "size-[34px] p-0 [&_svg]:size-4",
};

/** A file input's label drawn as a button: the input is visually hidden inside it, so the label shows the outline while
 *  the input has keyboard focus. */
export const pickerFocus = "cursor-pointer has-[:focus-visible]:outline-2 has-[:focus-visible]:outline-offset-2 has-[:focus-visible]:outline-brand";

/** The class string, for the odd element that is neither a button nor a link (a file input's label). */
export function buttonClass(variant: ButtonVariant = "secondary", size: ButtonSize = "md", extra = ""): string {
  // A link-style button is as tall as its words, so it takes 24px to touch (WCAG 2.5.8) from padding that negative
  // margins give back: the line it sits in doesn't move.
  const s = variant === "link"
    ? (size === "sm" ? "text-xs -my-1 py-1" : size === "lg" ? "text-base -my-0.5 py-0.5" : "text-sm -my-[3px] py-[3px]") + " [&_svg]:size-3.5 gap-1"
    : SIZE[size];
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

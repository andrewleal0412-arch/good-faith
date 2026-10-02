"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";

// The way back to everything, on every page and off the paper: the wordmark, the units list and the lease check.
export function SiteHeader() {
  const path = usePathname();
  // The tenants' private page (/t/<token>) gets the wordmark alone: the units list and the lease check are the landlord's.
  if (path === "/t" || path.startsWith("/t/")) {
    return (
      <header className="border-b border-line bg-surface print:hidden">
        <div className="mx-auto flex w-full max-w-3xl items-center gap-3 px-5 py-3">
          <span className="text-[13px] font-semibold uppercase tracking-[0.14em] text-accent">Deposit Agent</span>
          <span className="ml-auto text-[13px] text-ink-3">Tenant view</span>
        </div>
      </header>
    );
  }
  const onUnits = path === "/units" || path.startsWith("/tenancy");
  const onHome = path === "/";
  const tab = (active: boolean) => `rounded-xl px-3 py-1.5 transition ${active ? "bg-bg text-ink" : "text-ink-2 hover:text-ink"}`;
  return (
    <header className="border-b border-line bg-surface print:hidden">
      <div className="mx-auto flex w-full max-w-5xl items-center gap-3 px-5 py-3">
        <Link href="/" className="text-[13px] font-semibold uppercase tracking-[0.14em] text-accent">Deposit Agent</Link>
        <nav className="ml-auto flex items-center gap-1 text-[14px] font-semibold">
          <Link href="/units" aria-current={onUnits ? "page" : undefined} className={tab(onUnits)}>Your units</Link>
          <Link href="/" aria-current={onHome ? "page" : undefined} className={tab(onHome)}>Check a lease</Link>
        </nav>
      </div>
    </header>
  );
}

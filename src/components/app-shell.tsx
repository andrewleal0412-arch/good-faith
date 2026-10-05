"use client";

import Link from "next/link";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { Suspense, useEffect, useRef, useState, type ReactNode } from "react";
import { ConfirmDialog } from "./confirm";
import { Icon, PayPalMark, type IconName } from "./icons";
import { Menu } from "./menu";
import { Avatar, Notice, Wordmark } from "./ui";

// The landlord's app chrome: a 232px sidebar (Properties, Tenants, Payments, Documents, then the Workflows group),
// PayPal's connection and the account at its foot; a 56px top bar with search, the Test mode switch (the only place
// the sandbox shows), notifications, help and the avatar. At phone width the sidebar becomes a drawer.

export type ShellAlert = { title: string; sub: string; href: string; tone: "red" | "amber" | "green" };
export type ShellData = {
  account: string; // a demo copy's "Harbor View Rentals"; the owner's GOOD_FAITH_ACCOUNT or oldest tenancy's owner (accountName)
  initials: string;
  owners: string[]; // every owner on file, for the account card
  sandbox: boolean;
  alerts: ShellAlert[];
  paypal: ShellAlert[]; // what PayPal reported lately through its webhook: payments, refunds, payouts, disputes
  disclaimer: string;
  rules: { label: string; href: string }[]; // the Help menu's deposit-law guides, one per state the workspace rents in
  signOut: boolean; // the demo access gate is on, so there is a session to end (src/proxy.ts)
  startOver: boolean; // this is a visitor's private copy of the demo, which can be replaced by a fresh one
};

const NAV: ({ href: string; icon: IconName; label: string; match: (p: string) => boolean } | { group: string })[] = [
  { href: "/units", icon: "building", label: "Properties", match: (p) => p === "/" || p.startsWith("/units") || p.startsWith("/tenancy") },
  { href: "/tenants", icon: "users", label: "Tenants", match: (p) => p.startsWith("/tenants") },
  { href: "/ledger", icon: "card", label: "Payments", match: (p) => p.startsWith("/ledger") },
  { href: "/documents", icon: "doc", label: "Documents", match: (p) => p.startsWith("/documents") },
  { group: "Workflows" },
  { href: "/lease", icon: "file-check", label: "Lease check", match: (p) => p.startsWith("/lease") },
  { href: "/move-outs", icon: "key", label: "Move-outs", match: (p) => p.startsWith("/move-outs") },
];

export function AppShell({ data, children }: { data: ShellData; children: ReactNode }) {
  const path = usePathname();
  const [drawer, setDrawer] = useState(false);
  const opener = useRef<HTMLButtonElement>(null);
  const panel = useRef<HTMLElement>(null);

  // The phone drawer is a modal: focus moves into it, Escape closes it, and focus goes back to the menu button.
  useEffect(() => {
    if (!drawer) return;
    const back = opener.current;
    panel.current?.querySelector<HTMLElement>("nav a")?.focus();
    const key = (e: KeyboardEvent) => {
      if (e.key === "Escape") return setDrawer(false);
      if (e.key !== "Tab" || !panel.current) return;
      // Tab stays inside the drawer while it is open.
      const f = [...panel.current.querySelectorAll<HTMLElement>("a[href], button:not([disabled])")];
      if (!f.length) return;
      if (e.shiftKey && document.activeElement === f[0]) { e.preventDefault(); f[f.length - 1].focus(); }
      else if (!e.shiftKey && document.activeElement === f[f.length - 1]) { e.preventDefault(); f[0].focus(); }
    };
    document.addEventListener("keydown", key);
    return () => { document.removeEventListener("keydown", key); back?.focus(); };
  }, [drawer]);

  return (
    <div className="min-h-screen md:grid md:grid-cols-[232px_minmax(0,1fr)] print:block">
      <aside className="sticky top-0 hidden h-screen flex-col border-r border-line bg-canvas px-3 pb-3 pt-4 md:flex print:hidden">
        <Sidebar path={path} data={data} />
      </aside>

      {drawer && (
        <div className="fixed inset-0 z-50 md:hidden print:hidden" role="dialog" aria-modal="true" aria-label="Navigation">
          <button type="button" aria-hidden tabIndex={-1} className="absolute inset-0 bg-ink/30" onClick={() => setDrawer(false)} />
          <aside ref={panel} className="absolute inset-y-0 left-0 flex w-[264px] flex-col border-r border-line bg-canvas px-3 pb-3 pt-4 shadow-md">
            <button type="button" aria-label="Close navigation" onClick={() => setDrawer(false)}
              className="absolute right-2.5 top-3.5 inline-flex size-[34px] items-center justify-center rounded-md text-ink-2 hover:bg-surface">
              <Icon name="x" />
            </button>
            <Sidebar path={path} data={data} onNavigate={() => setDrawer(false)} />
          </aside>
        </div>
      )}

      <div className="flex min-w-0 flex-col">
        <header className="sticky top-0 z-30 flex h-14 items-center gap-2 border-b border-line bg-canvas px-4 md:gap-3 md:px-7 print:hidden">
          <button ref={opener} type="button" aria-label="Open navigation" aria-expanded={drawer} onClick={() => setDrawer(true)}
            className="-ml-1.5 inline-flex size-[34px] items-center justify-center rounded-md text-ink-2 hover:bg-surface md:hidden">
            <Icon name="menu" />
          </button>
          <Link href="/units" className="md:hidden"><Wordmark /></Link>
          <Suspense fallback={<div className="hidden h-9 w-[400px] md:block" />}>
            <Search />
          </Suspense>
          <div className="ml-auto flex items-center gap-1.5">
            <button type="button" aria-label="Search" onClick={() => window.dispatchEvent(new Event("gf:search"))}
              className="inline-flex size-[34px] items-center justify-center rounded-md text-ink-2 hover:bg-surface md:hidden">
              <Icon name="search" />
            </button>
            <span className="mr-2 hidden items-center gap-2 text-sm text-ink-2 lg:inline-flex" title={data.sandbox ? "PayPal sandbox: no real money moves" : "Live PayPal"}>
              Test mode
              <span aria-hidden className={`relative h-4 w-7 rounded-full ${data.sandbox ? "bg-brand" : "bg-line"}`}>
                <span className={`absolute top-0.5 size-3 rounded-full bg-white shadow-sm ${data.sandbox ? "left-3.5" : "left-0.5"}`} />
              </span>
              <span className="sr-only">{data.sandbox ? "on" : "off"}</span>
            </span>
            <Menu label="Notifications" width={320} buttonClass="relative inline-flex size-[34px] items-center justify-center rounded-md text-ink-2 hover:bg-surface"
              trigger={<><Icon name="bell" />{data.alerts.length + data.paypal.length > 0 && <span className="absolute right-[9px] top-2 size-1.5 rounded-full bg-brand ring-2 ring-white" />}</>}>
              <div className="px-2.5 pb-1 pt-2 text-xs font-medium text-ink-3">Needs you</div>
              {data.alerts.length ? data.alerts.map((a, i) => <AlertRow key={i} a={a} />)
                : <p className="px-2.5 pb-2.5 text-sm text-ink-3">Nothing needs you right now.</p>}
              {data.paypal.length > 0 && (
                <>
                  <div className="mt-1 flex items-center gap-1.5 border-t border-line-2 px-2.5 pb-1 pt-2.5 text-xs font-medium text-ink-3"><PayPalMark size={12} />From PayPal</div>
                  {data.paypal.map((a, i) => <AlertRow key={i} a={a} />)}
                </>
              )}
            </Menu>
            <Menu label="Help" width={300} buttonClass="hidden size-[34px] items-center justify-center rounded-md text-ink-2 hover:bg-surface md:inline-flex"
              trigger={<Icon name="help" />}
              items={[
                { label: "Check a lease", href: "/lease", icon: "file-check" },
                ...data.rules.map((r) => ({ label: r.label, href: r.href, icon: "arrow-up-right" as const, newTab: true })),
              ]}>
              <p className="border-t border-line-2 px-2.5 pb-2 pt-2.5 text-xs text-ink-3">{data.disclaimer}</p>
            </Menu>
            <Menu label="Account" width={260} buttonClass="inline-flex rounded-full outline-none focus-visible:ring-3 focus-visible:ring-brand-100"
              trigger={<Avatar initials={data.initials} />}>
              {(close) => <AccountCard data={data} close={close} />}
            </Menu>
          </div>
        </header>
        <main className="w-full max-w-content px-4 pb-12 pt-5 md:px-7 md:pt-7 print:max-w-none print:p-0">{children}</main>
      </div>
      {data.startOver && <StartOver />}
    </div>
  );
}

/** The question behind the account menu's Start over: a fresh copy of the demo for this browser. It lives outside the
 *  menu, which closes when an item is chosen, and opens on the gf:start-over event. */
/** One line in the bell: a status dot, the title, the property under it. */
function AlertRow({ a }: { a: ShellAlert }) {
  return (
    <Link href={a.href} className="flex items-start gap-2.5 rounded-sm px-2.5 py-2 hover:bg-surface">
      <span className={`mt-1.5 size-1.5 shrink-0 rounded-full ${a.tone === "red" ? "bg-red-dot" : a.tone === "green" ? "bg-green-dot" : "bg-amber-dot"}`} />
      <span className="min-w-0">
        <span className="block text-sm font-medium text-ink">{a.title}</span>
        <span className="block truncate text-xs text-ink-3">{a.sub}</span>
      </span>
    </Link>
  );
}

function StartOver() {
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  useEffect(() => {
    const show = () => { setError(""); setOpen(true); };
    window.addEventListener("gf:start-over", show);
    return () => window.removeEventListener("gf:start-over", show);
  }, []);

  async function go() {
    if (busy) return;
    setBusy(true);
    setError("");
    const r = await fetch("/api/access/start-over", { method: "POST" }).catch(() => null);
    const j = r ? await r.json().catch(() => ({})) : {};
    if (r?.ok) {
      // Every page this browser has read so far was the old copy's. A full load drops them all, the router's cache
      // included, and opens the new copy's Properties; the dialog stays on "Starting over..." until it does. (Sign out
      // is a full load too: both change whose data this browser sees.)
      // eslint-disable-next-line @next/next/no-location-assign-relative-destination -- a client navigation would keep the old copy's cached pages
      window.location.assign("/units");
      return;
    }
    setBusy(false);
    setError(j.error ?? "Couldn't start over. Try again in a moment.");
  }

  return (
    <ConfirmDialog open={open} title="Start over?" action={busy ? "Starting over..." : "Start over"}
      body={<>
        You get a fresh copy of the demo, dated today. What you changed in this copy is gone.
        {error && <Notice className="mt-3">{error}</Notice>}
      </>}
      onConfirm={go} onCancel={() => { if (!busy) setOpen(false); }} />
  );
}

function Sidebar({ path, data, onNavigate }: { path: string; data: ShellData; onNavigate?: () => void }) {
  return (
    <>
      <Link href="/units" onClick={onNavigate} className="flex items-center px-2.5 pb-5 pt-1"><Wordmark /></Link>
      <nav className="flex flex-col gap-0.5" aria-label="Main">
        {NAV.map((n, i) => "group" in n ? (
          <div key={i} className="px-2.5 pb-1.5 pt-4 text-xs font-medium text-ink-3">{n.group}</div>
        ) : (
          <Link key={n.href} href={n.href} onClick={onNavigate} aria-current={n.match(path) ? "page" : undefined}
            className={`flex h-9 items-center gap-2.5 rounded-md px-2.5 text-base ${n.match(path)
              ? "bg-brand-50 font-medium text-brand-700 [&_svg]:text-brand" : "text-ink-2 hover:bg-surface hover:text-ink [&_svg]:text-ink-3"}`}>
            <Icon name={n.icon} />
            {n.label}
          </Link>
        ))}
      </nav>
      <div className="mt-auto flex flex-col gap-1">
        <div className="flex items-center gap-2 px-2.5 py-2 text-xs text-ink-3">
          <span className="size-[7px] shrink-0 rounded-full bg-green-dot" />
          PayPal connected
        </div>
        <Menu label="Account" side="top" align="start" width={232}
          buttonClass="flex h-10 w-full items-center gap-2.5 rounded-md px-2 text-left hover:bg-surface"
          trigger={<>
            <Avatar initials={data.initials} />
            <span className="min-w-0 flex-1 truncate text-sm font-medium">{data.account}</span>
            <Icon name="updown" className="size-3.5 text-ink-4" />
          </>}>
          {(close) => <AccountCard data={data} close={close} />}
        </Menu>
      </div>
    </>
  );
}

function AccountCard({ data, close }: { data: ShellData; close: () => void }) {
  return (
    <div className="p-1.5">
      <div className="flex items-center gap-2.5 px-1 py-1.5">
        <Avatar initials={data.initials} />
        <div className="min-w-0">
          <div className="truncate text-sm font-medium">{data.account}</div>
          <div className="text-xs text-ink-3">Landlord</div>
        </div>
      </div>
      <div className="mt-1 flex items-center gap-2 rounded-sm bg-surface px-2.5 py-2 text-xs text-ink-2">
        <PayPalMark size={14} />PayPal {data.sandbox ? "sandbox" : "live"}<span className="ml-auto size-[7px] rounded-full bg-green-dot" />
      </div>
      {data.owners.length > 1 && (
        <div className="mt-2 px-1 text-xs text-ink-3">
          Owners on file: {data.owners.join(", ")}
        </div>
      )}
      {data.signOut && (
        <form method="post" action="/api/access/sign-out" className="mt-1.5 border-t border-line-2 pt-1.5">
          {data.startOver && (
            <button type="button" role="menuitem" onClick={() => { close(); window.dispatchEvent(new Event("gf:start-over")); }}
              className="flex h-8 w-full items-center gap-2.5 rounded-sm px-2.5 text-left text-sm text-ink-2 hover:bg-surface hover:text-ink">
              <Icon name="restart" className="size-[15px] text-ink-3" />Start over
            </button>
          )}
          <button type="submit" role="menuitem"
            className="flex h-8 w-full items-center gap-2.5 rounded-sm px-2.5 text-left text-sm text-ink-2 hover:bg-surface hover:text-ink">
            <Icon name="sign-out" className="size-[15px] text-ink-3" />Sign out
          </button>
        </form>
      )}
    </div>
  );
}

/** Search across properties and tenants: it filters the Properties table, or on Payments the payments grid. Cmd+K or
 *  Ctrl+K focuses it. */
function Search() {
  const router = useRouter();
  const params = useSearchParams();
  const path = usePathname();
  const field = useRef<HTMLInputElement>(null);
  const [mobile, setMobile] = useState(false);
  const onLedger = path === "/ledger";
  const current = path === "/units" || onLedger ? params.get("q") ?? "" : "";

  useEffect(() => {
    const focus = () => { setMobile(true); setTimeout(() => field.current?.focus(), 0); };
    const key = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "k") { e.preventDefault(); focus(); }
    };
    window.addEventListener("keydown", key);
    window.addEventListener("gf:search", focus);
    return () => { window.removeEventListener("keydown", key); window.removeEventListener("gf:search", focus); };
  }, []);

  function submit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const q = String(new FormData(e.currentTarget).get("q") ?? "").trim();
    // On Payments the search stays there (with any property the grid was opened on); everywhere else it opens Properties.
    const base = onLedger ? "/ledger" : "/units";
    const keep = onLedger && params.get("tenancy") ? [`tenancy=${encodeURIComponent(params.get("tenancy")!)}`] : [];
    const qs = [...keep, ...(q ? [`q=${encodeURIComponent(q)}`] : [])].join("&");
    router.push(qs ? `${base}?${qs}` : base);
    setMobile(false);
  }

  return (
    <form role="search" onSubmit={submit} key={current}
        className={`${mobile ? "absolute inset-x-0 top-0 z-10 flex h-14 bg-canvas px-4" : "hidden"} items-center md:static md:flex md:h-auto md:px-0`}>
        <label className="flex h-9 w-full items-center gap-2 rounded-md border border-line bg-surface pl-3 pr-2.5 text-ink-4 focus-within:border-brand focus-within:bg-canvas focus-within:ring-3 focus-within:ring-brand-50 md:w-[400px]">
          <Icon name="search" className="size-[15px]" />
          <input ref={field} name="q" defaultValue={current} placeholder={onLedger ? "Search payments" : "Search properties, tenants"}
            aria-label={onLedger ? "Search payments" : "Search properties and tenants"}
            onBlur={() => setMobile(false)}
            onKeyDown={(e) => { if (e.key === "Escape") { setMobile(false); e.currentTarget.blur(); } }}
            className="h-full min-w-0 flex-1 bg-transparent text-sm text-ink outline-none placeholder:text-ink-4" />
          <kbd className="hidden rounded-xs border border-line bg-canvas px-[5px] font-sans text-xs text-ink-3 md:inline">&#8984;K</kbd>
        </label>
        {/* On a phone the search covers the top bar, so it carries its own way out (Escape works too). */}
        {mobile && (
          <button type="button" onMouseDown={(e) => e.preventDefault()} onClick={() => setMobile(false)}
            className="ml-3 shrink-0 rounded-sm text-sm font-medium text-brand outline-none focus-visible:ring-3 focus-visible:ring-brand-100 md:hidden">
            Cancel
          </button>
        )}
    </form>
  );
}

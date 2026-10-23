"use client";

import Link from "@/components/link";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { Suspense, use, useEffect, useId, useRef, useState, type MouseEvent, type ReactNode, type Ref } from "react";
import { ConfirmDialog } from "./confirm";
import { DemoGuide } from "./demo-guide";
import { DemoWelcome } from "./demo-welcome";
import { Icon, PayPalMark, type IconName } from "./icons";
import { InfoTip } from "./info-tip";
import { Menu } from "./menu";
import { arriveAgain, PresenceList, usePresence } from "./motion";
import { flowSkeletonFor, skeletonFor } from "./skeleton-route";
import { Avatar, LineMark, Notice, Wordmark } from "./ui";
import type { GuideState, GuideStep } from "@/lib/demo-guide";
import type { DemoWelcome as Welcome } from "@/lib/demo-welcome";
import { sectionOf } from "@/lib/tenancy-tabs";

// The landlord's app chrome: a 232px sidebar (Properties, Tenants, Payments, Insights, Documents, then the Workflows group),
// PayPal's connection and the account at its foot; a 56px top bar with search, the Test mode switch (the only place
// the sandbox shows), notifications, help and the avatar. At phone width the sidebar becomes a drawer.

export type ShellAlert = { title: string; sub: string; href: string; tone: "red" | "amber" | "green" };
/** The parts of the chrome that come from the database, streamed in after the frame (src/app/(landlord)/layout.tsx). */
export type ShellChrome = {
  account: string; // a demo copy's "Harbor View Rentals"; the owner's GOOD_FAITH_ACCOUNT or oldest tenancy's owner (accountName)
  initials: string;
  owners: string[]; // every owner on file, for the account card
  alerts: ShellAlert[];
  paypal: ShellAlert[]; // what PayPal reported lately through its webhook: payments, refunds, payouts, disputes
  disclaimer: string;
  rules: { label: string; href: string }[]; // the Help menu's deposit-law guides, one per state the workspace rents in
};
type ShellProps = {
  sandbox: boolean;
  signOut: boolean; // the demo access gate is on, so there is a session to end (src/proxy.ts)
  startOver: boolean; // this is a visitor's private copy of the demo, which can be replaced by a fresh one
  account: { account: string; initials: string } | null; // known before any read (a demo copy, or GOOD_FAITH_ACCOUNT)
  chrome: Promise<ShellChrome>;
  // The demo guide at the top of every page, in a private demo copy only (null in the owner's workspace): what this
  // browser last chose to do with it, and the eight beats of this copy, which stream in with the rest of the chrome.
  guide: { state: GuideState; steps: Promise<GuideStep[] | null> } | null;
  // The welcome card and tour, in a private demo copy only: whether this browser has yet to see it, and its words,
  // which stream in with the rest of the chrome (components/demo-welcome.tsx).
  welcome: { show: boolean; data: Promise<Welcome | null> } | null;
  children: ReactNode;
};

const NAV: ({ href: string; icon: IconName; label: string; match: (p: string) => boolean } | { group: string })[] = [
  { href: "/units", icon: "building", label: "Properties", match: (p) => p === "/" || p.startsWith("/units") || p.startsWith("/tenancy") },
  { href: "/tenants", icon: "users", label: "Tenants", match: (p) => p.startsWith("/tenants") },
  { href: "/ledger", icon: "card", label: "Payments", match: (p) => p.startsWith("/ledger") },
  { href: "/insights", icon: "split", label: "Insights", match: (p) => p.startsWith("/insights") },
  { href: "/documents", icon: "doc", label: "Documents", match: (p) => p.startsWith("/documents") },
  { group: "Workflows" },
  { href: "/lease", icon: "file-check", label: "Lease check", match: (p) => p.startsWith("/lease") },
  { href: "/move-outs", icon: "key", label: "Move-outs", match: (p) => p.startsWith("/move-outs") },
];

export function AppShell({ sandbox, signOut, startOver, account, chrome, guide, welcome, children }: ShellProps) {
  const path = usePathname();
  const [drawer, setDrawer] = useState(false);
  const nav = usePresence(drawer);
  const opener = useRef<HTMLButtonElement>(null);
  const panel = useRef<HTMLElement>(null);
  // The page a click is opening, shown as that page's skeleton in the same frame as the click, until the address
  // changes (src/components/skeletons.tsx). The page then renders in the layout's one Suspense boundary, in a
  // transition, so it replaces the skeleton the moment it is ready. A click that only changes the page's filters
  // (Properties' status filter) dims the page instead.
  const query = useSearchParams().toString();
  const here = `${path}${query ? `?${query}` : ""}`;
  const [pending, setPending] = useState<{ to: string; from: string; same: boolean } | null>(null);
  const [seen, setSeen] = useState(here);
  if (seen !== here) {
    setSeen(here);
    setPending(null);
  }
  const live = pending && pending.from === here ? pending : null;
  const opening = live && !live.same ? skeletonFor(live.to) : null;
  const flow = live && !live.same ? flowSkeletonFor(live.to) : null;

  // Any click on a link to another landlord page: the sidebar, the record header, a table row; and a search. A click
  // that opens a new tab, a file, an API route, or the address already shown leaves things as they are, and so does one
  // between a property's tabs, which the property page opens itself (tenancy/[id]/tab-state.tsx).
  const opens = (href: string) => {
    const url = new URL(href, window.location.href);
    if (url.origin !== window.location.origin) return;
    // Spelled as `here` is (a space as +), so the address already shown is recognized, and the pending state, which
    // ends when the address changes, never waits on one that won't.
    const qs = url.searchParams.toString();
    const to = `${url.pathname}${qs ? `?${qs}` : ""}`;
    if (to === here || (!skeletonFor(to) && !flowSkeletonFor(to))) return;
    const same = url.pathname === path;
    if (same && path.startsWith("/tenancy/")) return;
    setPending({ to, from: here, same });
  };
  const onClickCapture = (e: MouseEvent<HTMLElement>) => {
    if (e.button !== 0 || e.metaKey || e.ctrlKey || e.shiftKey || e.altKey) return;
    const a = (e.target as HTMLElement).closest("a");
    if (!a || (a.target && a.target !== "_self") || a.hasAttribute("download")) return;
    opens(a.href);
  };

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

  // The sidebar marks the page being opened at once, not when it arrives.
  const navPath = opening && pending ? pending.to.split("?")[0] : path;
  const side = { path: navPath, account, chrome, signOut, startOver, sandbox };

  return (
    <div className="min-h-screen md:grid md:grid-cols-[232px_minmax(0,1fr)] print:block" onClickCapture={onClickCapture}>
      {/* The first stop for Tab: straight to the page, past the sidebar and the top bar (WCAG 2.4.1). Seen only when it
          has focus. */}
      <a href="#main" className="sr-only rounded-md border border-line bg-canvas text-sm font-medium text-brand shadow-md focus:not-sr-only focus:fixed focus:left-3 focus:top-3 focus:z-[60] focus:px-3 focus:py-2 print:hidden">
        Skip to content
      </a>
      <aside aria-label="Sidebar" className="sticky top-0 hidden h-screen flex-col border-r border-line bg-canvas px-3 pb-3 pt-4 md:flex print:hidden">
        <Sidebar {...side} />
      </aside>

      {/* The phone's navigation slides in from the left over a fading backdrop, and back out. */}
      {nav.mounted && (
        <div className="fixed inset-0 z-50 md:hidden print:hidden" role="dialog" aria-modal={drawer ? "true" : undefined} aria-label="Navigation" inert={!drawer}>
          <button type="button" aria-hidden tabIndex={-1} data-state={nav.state} className="gf-scrim absolute inset-0 bg-ink/30" onClick={() => setDrawer(false)} />
          <aside ref={panel} data-state={nav.state} className="gf-nav absolute inset-y-0 left-0 flex w-[264px] flex-col border-r border-line bg-canvas px-3 pb-3 pt-4 shadow-md">
            <button type="button" aria-label="Close navigation" onClick={() => setDrawer(false)}
              className="absolute right-2.5 top-3.5 inline-flex size-[34px] items-center justify-center rounded-md text-ink-2 transition-colors hover:bg-surface">
              <Icon name="x" />
            </button>
            <Sidebar {...side} onNavigate={() => setDrawer(false)} />
          </aside>
        </div>
      )}

      <div className="flex min-w-0 flex-col">
        <header data-top-bar="" className="sticky top-0 z-30 flex h-14 items-center gap-2 border-b border-line bg-canvas px-4 md:gap-3 md:px-7 print:hidden">
          <button ref={opener} type="button" aria-label="Open navigation" aria-expanded={drawer} onClick={() => setDrawer(true)}
            className="-ml-1.5 inline-flex size-[34px] items-center justify-center rounded-md text-ink-2 transition-colors hover:bg-surface md:hidden">
            <Icon name="menu" />
          </button>
          <Link href="/units" className="md:hidden"><Wordmark /></Link>
          <Suspense fallback={<div className="hidden h-9 w-[400px] md:block" />}>
            <Search onSearch={opens} />
          </Suspense>
          <div className="ml-auto flex items-center gap-1.5">
            <button type="button" aria-label="Search" onClick={() => window.dispatchEvent(new Event("gf:search"))}
              className="inline-flex size-[34px] items-center justify-center rounded-md text-ink-2 transition-colors hover:bg-surface md:hidden">
              <Icon name="search" />
            </button>
            {/* It is drawn as a switch, so a click, a tap or keyboard focus answers with what it means and why it doesn't
                move (an info tip, as everywhere else), where a native title answered a hover only. */}
            <InfoTip align="end" className="mr-2 max-lg:hidden" title="Test mode"
              trigger={<span className="inline-flex items-center gap-2 text-sm text-ink-2">
                Test mode
                <span aria-hidden className={`relative h-4 w-7 rounded-full ${sandbox ? "bg-brand" : "bg-line"}`}>
                  <span className={`absolute top-0.5 size-3 rounded-full bg-white shadow-sm transition-[left] duration-(--dur-base) ${sandbox ? "left-3.5" : "left-0.5"}`} />
                </span>
                <span className="sr-only">{sandbox ? "on" : "off"}</span>
              </span>}>
              {sandbox ? "PayPal sandbox: no real money moves." : "Live PayPal."} It follows the PayPal account this app is connected to, so it can&apos;t be switched here.
            </InfoTip>
            <Suspense fallback={<span aria-hidden className={`${iconButton} relative`}><Icon name="bell" /></span>}>
              <Bell chrome={chrome} />
            </Suspense>
            <Suspense fallback={<span aria-hidden className={`${iconButton} max-md:hidden`}><Icon name="help" /></span>}>
              <Help chrome={chrome} />
            </Suspense>
            <Menu label="Account" width={260} buttonClass="inline-flex rounded-full focus-visible:rounded-full"
              trigger={<AccountAvatar account={account} chrome={chrome} />}>
              {(close) => <AccountCard {...side} close={close} />}
            </Menu>
          </div>
        </header>
        <main id="main" tabIndex={-1} className="w-full max-w-content px-4 pb-12 pt-5 outline-none md:px-7 md:pt-7 print:max-w-none print:p-0">
          {/* A judge's own copy opens with the eight beats of the demo script, each a link into this copy
              (components/demo-guide.tsx). It sits in the page's flow above the heading, so it covers nothing it points
              at, and stays where it is while the next page arrives. */}
          {guide && <DemoGuide {...guide} />}
          {/* The page stays mounted while the next one is opened, under its skeleton; a filter being applied dims it,
              after a moment, so a quick answer doesn't flicker. A page arriving rises into place (gf-page, globals.css):
              its parts are new, or were hidden under the skeleton, so their arrival plays; a re-render plays nothing. */}
          <div aria-busy={live?.same || undefined} className={`gf-page ${opening ? "hidden" : live?.same ? "block opacity-60 transition-opacity delay-150 duration-(--dur-base)" : "contents"}`}>{children}</div>
          {opening}
        </main>
      </div>
      {startOver && <StartOver />}
      {welcome && <DemoWelcome {...welcome} />}
      {/* A focused flow (the refund review) has no shell: its skeleton covers the page until it arrives. */}
      {flow && <div className="fixed inset-0 z-50 overflow-y-auto bg-canvas">{flow}</div>}
    </div>
  );
}

const iconButton = "inline-flex size-[34px] items-center justify-center rounded-md text-ink-2 transition-colors hover:bg-surface";

/** The bell: what needs the landlord, then what PayPal reported. Choosing a line closes it, as choosing a menu's item
 *  does, and a line for the page already shown is answered by that page (answerHere). */
function Bell({ chrome }: { chrome: Promise<ShellChrome> }) {
  const data = use(chrome);
  return (
    <Menu label="Notifications" width={320} buttonClass={`relative ${iconButton}`}
      trigger={<><Icon name="bell" />{data.alerts.length + data.paypal.length > 0 && <span className="absolute right-[9px] top-2 size-1.5 rounded-full bg-brand ring-2 ring-white" />}</>}>
      {(close) => {
        const pick = (e: MouseEvent<HTMLAnchorElement>) => { close(); answerHere(e); };
        return (
          <>
            <div className="px-2.5 pb-1 pt-2 text-xs font-medium text-ink-3">Needs you</div>
            {/* A line that arrives or goes while the bell is open eases in or out. */}
            {data.alerts.length ? <PresenceList>{lineKeys(data.alerts).map((k, i) => <AlertRow key={k} a={data.alerts[i]} onPick={pick} />)}</PresenceList>
              : <p className="px-2.5 pb-2.5 text-sm text-ink-3">Nothing needs you right now.</p>}
            {data.paypal.length > 0 && (
              <>
                <div className="mt-1 flex items-center gap-1.5 border-t border-line-2 px-2.5 pb-1 pt-2.5 text-xs font-medium text-ink-3"><PayPalMark size={12} />From PayPal</div>
                <PresenceList>{lineKeys(data.paypal).map((k, i) => <AlertRow key={k} a={data.paypal[i]} onPick={pick} />)}</PresenceList>
              </>
            )}
          </>
        );
      }}
    </Menu>
  );
}

/** A click on a link to the page already shown: a step read in the bell on the page it opens (a notice, the
 *  statement), or a section of the tab in view. The router does nothing with the address it is on, so the page answers
 *  it itself: the section the link names is brought to the top, or the page's own top when it names none, and arrives
 *  again, as a section does on a property (tenancy/[id]/tab-state.tsx). A link to any other page or tab, and a click
 *  that opens a new tab, is left to open as it always does. */
function answerHere(e: MouseEvent<HTMLAnchorElement>) {
  if (e.button !== 0 || e.metaKey || e.ctrlKey || e.shiftKey || e.altKey) return;
  const url = new URL(e.currentTarget.href, window.location.href);
  if (url.origin !== window.location.origin || url.pathname !== window.location.pathname || url.search !== window.location.search) return;
  e.preventDefault();
  const named = url.hash ? document.getElementById(sectionOf(url.hash)) : null;
  const section = named?.checkVisibility() ? named : null;
  if (section) section.scrollIntoView({ block: "start" });
  else window.scrollTo(0, 0);
  const part = section ?? document.getElementById("main");
  if (part) arriveAgain(part);
  if (url.hash !== window.location.hash) window.history.replaceState(null, "", `${url.pathname}${url.search}${url.hash}`);
}

/** Help: the lease check, each state's deposit-law guide, the disclaimer. */
function Help({ chrome }: { chrome: Promise<ShellChrome> }) {
  const data = use(chrome);
  return (
    <Menu label="Help" width={300} buttonClass={`hidden ${iconButton.replace("inline-flex ", "")} md:inline-flex`}
      trigger={<Icon name="help" />}
      items={[
        { label: "Check a lease", href: "/lease", icon: "file-check" },
        ...data.rules.map((r) => ({ label: r.label, href: r.href, icon: "arrow-up-right" as const, newTab: true })),
      ]}>
      <p className="border-t border-line-2 px-2.5 pb-2 pt-2.5 text-xs text-ink-3">{data.disclaimer}</p>
    </Menu>
  );
}

/** The account's initials: at once when the account is known before any read, otherwise when the chrome arrives. */
function AccountAvatar({ account, chrome }: { account: ShellProps["account"]; chrome: Promise<ShellChrome> }) {
  if (account) return <Avatar initials={account.initials} />;
  return <Suspense fallback={<Avatar initials="" />}><ChromeAvatar chrome={chrome} /></Suspense>;
}
function ChromeAvatar({ chrome }: { chrome: Promise<ShellChrome> }) {
  return <Avatar initials={use(chrome).initials} />;
}
function ChromeAccountName({ chrome }: { chrome: Promise<ShellChrome> }) {
  return <>{use(chrome).account}</>;
}

/** The question behind the account menu's Start over: a fresh copy of the demo for this browser. It lives outside the
 *  menu, which closes when an item is chosen, and opens on the gf:start-over event. */
/** A key for each of the bell's lines that stays with the line while the list changes: what it says, and a count for a
 *  line that says the same as one before it (two reports of the same kind on one property). */
function lineKeys(xs: ShellAlert[]): string[] {
  const seen = new Map<string, number>();
  return xs.map((a) => {
    const k = `${a.href}|${a.title}|${a.sub}`;
    const n = seen.get(k) ?? 0;
    seen.set(k, n + 1);
    return n ? `${k}|${n}` : k;
  });
}

/** One line in the bell: a status dot, the title, the property under it. */
function AlertRow({ a, ref, onPick }: { a: ShellAlert; ref?: Ref<HTMLAnchorElement>; onPick: (e: MouseEvent<HTMLAnchorElement>) => void }) {
  return (
    <Link ref={ref} href={a.href} onClick={onPick} className="flex items-start gap-2.5 rounded-sm px-2.5 py-2 transition-colors hover:bg-surface">
      <LineMark className="text-sm"><span className={`size-1.5 rounded-full ${a.tone === "red" ? "bg-red-dot" : a.tone === "green" ? "bg-green-dot" : "bg-amber-dot"}`} /></LineMark>
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

type SideProps = { path: string; account: ShellProps["account"]; chrome: Promise<ShellChrome>; signOut: boolean; startOver: boolean; sandbox: boolean };

function Sidebar({ onNavigate, ...p }: SideProps & { onNavigate?: () => void }) {
  return (
    <>
      <Link href="/units" onClick={onNavigate} className="flex items-center px-2.5 pb-5 pt-1"><Wordmark /></Link>
      <nav className="flex flex-col gap-0.5" aria-label="Main">
        {NAV.map((n, i) => "group" in n ? (
          <div key={i} className="px-2.5 pb-1.5 pt-4 text-xs font-medium text-ink-3">{n.group}</div>
        ) : (
          <Link key={n.href} href={n.href} onClick={onNavigate} aria-current={n.match(p.path) ? "page" : undefined}
            className={`flex h-9 items-center gap-2.5 rounded-md px-2.5 text-base transition-colors ${n.match(p.path)
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
        <Menu label="Account" named={false} side="top" align="start" width={232}
          buttonClass="flex h-10 w-full items-center gap-2.5 rounded-md px-2 text-left transition-colors hover:bg-surface"
          trigger={<>
            <AccountAvatar account={p.account} chrome={p.chrome} />
            <span className="min-w-0 flex-1 truncate text-sm font-medium">
              {p.account ? p.account.account : <Suspense fallback={<span className="text-ink-3">Account</span>}><ChromeAccountName chrome={p.chrome} /></Suspense>}
            </span>
            <Icon name="updown" className="size-3.5 text-ink-4" />
          </>}>
          {/* In the phone drawer, an item that shows something on the page (the welcome, the guide, Start over's
              dialog) closes the drawer as well, or it would open under it. */}
          {(close) => <AccountCard {...p} close={() => { close(); onNavigate?.(); }} />}
        </Menu>
      </div>
    </>
  );
}

function AccountCard(p: SideProps & { close: () => void }) {
  return (
    <div className="p-1.5">
      <div className="flex items-center gap-2.5 px-1 py-1.5">
        <AccountAvatar account={p.account} chrome={p.chrome} />
        <div className="min-w-0">
          <div className="truncate text-sm font-medium">
            {p.account ? p.account.account : <Suspense fallback={<span className="text-ink-3">Account</span>}><ChromeAccountName chrome={p.chrome} /></Suspense>}
          </div>
          <div className="text-xs text-ink-3">Landlord</div>
        </div>
      </div>
      <div className="mt-1 flex items-center gap-2 rounded-sm bg-surface px-2.5 py-2 text-xs text-ink-2">
        <PayPalMark size={14} />PayPal {p.sandbox ? "sandbox" : "live"}<span className="ml-auto size-[7px] rounded-full bg-green-dot" />
      </div>
      <Suspense fallback={null}><Owners chrome={p.chrome} /></Suspense>
      {p.signOut && (
        <form method="post" action="/api/access/sign-out" className="mt-1.5 border-t border-line-2 pt-1.5">
          {/* A private copy of the demo: the welcome again (components/demo-welcome.tsx), the way back to a guide this
              browser hid (components/demo-guide.tsx), and a fresh copy. None is in the owner's workspace. */}
          {p.startOver && (
            <>
              <button type="button" onClick={() => { p.close(); window.dispatchEvent(new Event("gf:demo-welcome")); }}
                className="flex h-8 w-full items-center gap-2.5 rounded-sm px-2.5 text-left text-sm text-ink-2 transition-colors hover:bg-surface hover:text-ink">
                <Icon name="info" className="size-[15px] text-ink-3" />Welcome tour
              </button>
              <button type="button" onClick={() => { p.close(); window.dispatchEvent(new Event("gf:demo-guide")); }}
                className="flex h-8 w-full items-center gap-2.5 rounded-sm px-2.5 text-left text-sm text-ink-2 transition-colors hover:bg-surface hover:text-ink">
                <Icon name="check" className="size-[15px] text-ink-3" />Demo guide
              </button>
              <button type="button" onClick={() => { p.close(); window.dispatchEvent(new Event("gf:start-over")); }}
                className="flex h-8 w-full items-center gap-2.5 rounded-sm px-2.5 text-left text-sm text-ink-2 transition-colors hover:bg-surface hover:text-ink">
                <Icon name="restart" className="size-[15px] text-ink-3" />Start over
              </button>
            </>
          )}
          <button type="submit"
            className="flex h-8 w-full items-center gap-2.5 rounded-sm px-2.5 text-left text-sm text-ink-2 transition-colors hover:bg-surface hover:text-ink">
            <Icon name="sign-out" className="size-[15px] text-ink-3" />Sign out
          </button>
        </form>
      )}
    </div>
  );
}

function Owners({ chrome }: { chrome: Promise<ShellChrome> }) {
  const { owners } = use(chrome);
  if (owners.length <= 1) return null;
  return <div className="mt-2 px-1 text-xs text-ink-3">Owners on file: {owners.join(", ")}</div>;
}

/** Search across properties and tenants: it filters the Properties table, or on Payments the payments grid. Cmd+K or
 *  Ctrl+K focuses it. Enter answers at once, as a click does: the results page's skeleton, or the page dimmed while it
 *  filters (onSearch, the shell's pending state). Nothing filters while typing (the list is the server's, and from any
 *  other page the search opens Properties), so the focused field says "Press Enter to search". */
function Search({ onSearch }: { onSearch: (to: string) => void }) {
  const router = useRouter();
  const params = useSearchParams();
  const path = usePathname();
  const field = useRef<HTMLInputElement>(null);
  const hint = useId();
  const [mobile, setMobile] = useState(false);
  const onLedger = path === "/ledger";
  const current = path === "/units" || path === "/" || onLedger ? params.get("q") ?? "" : "";

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
    const to = qs ? `${base}?${qs}` : base;
    onSearch(to);
    router.push(to);
    setMobile(false);
  }

  return (
    <form role="search" onSubmit={submit} key={current}
        className={`${mobile ? "gf-fade-in absolute inset-x-0 top-0 z-10 flex h-14 bg-canvas px-4 md:animate-none" : "hidden"} items-center md:static md:flex md:h-auto md:px-0`}>
        <label className="flex h-9 w-full items-center gap-2 rounded-md border border-line bg-surface pl-3 pr-2.5 text-ink-4 transition-[border-color,background-color,box-shadow] focus-within:border-brand focus-within:bg-canvas focus-within:ring-3 focus-within:ring-brand-50 md:w-[400px]">
          <Icon name="search" className="size-[15px]" />
          {/* The list is filtered on the server, when Enter is pressed, so the field says so while it has focus (in place
              of the shortcut that brought the cursor here); a phone's keyboard shows its Search key. */}
          <input ref={field} name="q" defaultValue={current} placeholder={onLedger ? "Search payments" : "Search properties, tenants"}
            aria-label={onLedger ? "Search payments" : "Search properties and tenants"} aria-describedby={hint} enterKeyHint="search"
            onBlur={() => setMobile(false)}
            onKeyDown={(e) => { if (e.key === "Escape") { setMobile(false); e.currentTarget.blur(); } }}
            className="peer h-full min-w-0 flex-1 bg-transparent text-sm text-ink outline-none placeholder:text-ink-3" />
          <kbd className="hidden rounded-xs border border-line bg-canvas px-[5px] font-sans text-xs text-ink-3 md:inline md:peer-focus:hidden">&#8984;K</kbd>
          <span id={hint} className="hidden shrink-0 whitespace-nowrap text-xs text-ink-3 md:peer-focus:inline">Press Enter to search</span>
        </label>
        {/* On a phone the search covers the top bar, so it carries its own way out (Escape works too). */}
        {mobile && (
          <button type="button" onMouseDown={(e) => e.preventDefault()} onClick={() => setMobile(false)}
            className="ml-3 inline-flex h-9 shrink-0 items-center rounded-sm text-sm font-medium text-brand md:hidden">
            Cancel
          </button>
        )}
    </form>
  );
}

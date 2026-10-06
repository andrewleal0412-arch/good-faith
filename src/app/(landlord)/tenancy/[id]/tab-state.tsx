"use client";

import { useSearchParams } from "next/navigation";
import { Activity, createContext, Suspense, useContext, useEffect, useRef, useState, type MouseEvent, type ReactNode } from "react";
import { TabBodySkeleton } from "@/components/skeletons";
import { Tabs } from "@/components/tabs";
import { TABS, tabHref, tabOf, type TabKey } from "@/lib/tenancy-tabs";

// A property's five tabs, switched in the browser. The server renders every tab in one request (page.tsx): the one the
// address names into the HTML, the others into the page's data only, which React lays out at idle priority while they
// stay hidden (Activity). A click on a tab, or on any link on the page to another of its tabs (a banner, the next step,
// a document's View), shows that tab in the same frame and keeps the address in step, with no request to the server.
// After a change on the page, router.refresh() renders every tab again from the database, as before.
//
// The address changes with history.replaceState, so a property is one entry in the browser's history whatever tab it
// is on: Back leaves the property (as it would leave any page), and coming back opens it on the tab it was left on.
// Not pushState: Next's router copies the page's current tree into each entry pushed that way, and router.refresh()
// renews only the entry it runs in, so after a change on one tab, Back to an entry from before it could bring back a
// page whose data never arrived (the property stayed on its skeleton until a reload).

const Current = createContext<TabKey | null>(null);

/** The tab being shown, for the parts of the page around the tabs that differ by tab. */
export const useTab = (): TabKey => useContext(Current) ?? "overview";

export function TabState({ id, children }: { id: string; children: ReactNode }) {
  const fromUrl = tabOf(useSearchParams().get("tab"));
  // The click sets the tab at once (an urgent update); the address follows in a transition. When the address changes
  // from elsewhere (coming back to the property, Forward), the tab follows it.
  const [tab, setTab] = useState(fromUrl);
  const [seen, setSeen] = useState(fromUrl);
  if (seen !== fromUrl) {
    setSeen(fromUrl);
    setTab(fromUrl);
  }
  // A #section the click asked for, scrolled to once its tab is shown (each click counts, so a second click on the
  // same link scrolls again).
  const target = useRef<string | null>(null);
  const [asked, setAsked] = useState(0);
  useEffect(() => {
    const el = target.current ? document.getElementById(target.current) : null;
    if (el && el.checkVisibility()) {
      el.scrollIntoView({ block: "start" });
      target.current = null;
    }
  }, [asked, tab]);

  const onClickCapture = (e: MouseEvent<HTMLDivElement>) => {
    if (e.defaultPrevented || e.button !== 0 || e.metaKey || e.ctrlKey || e.shiftKey || e.altKey) return;
    const a = (e.target as HTMLElement).closest("a");
    if (!a || (a.target && a.target !== "_self") || a.hasAttribute("download")) return;
    const url = new URL(a.href, window.location.href);
    if (url.origin !== window.location.origin || url.pathname !== `/tenancy/${id}` || [...url.searchParams.keys()].some((k) => k !== "tab")) return;
    e.preventDefault();
    const next = tabOf(url.searchParams.get("tab"));
    const hash = (() => {
      try {
        return decodeURIComponent(url.hash.slice(1));
      } catch {
        return url.hash.slice(1);
      }
    })();
    setTab(next);
    const to = tabHref(id, next, hash);
    if (to !== `${window.location.pathname}${window.location.search}${window.location.hash}`) window.history.replaceState(null, "", to);
    if (hash) {
      target.current = hash;
      setAsked((n) => n + 1);
    }
  };

  // gf-page: the property's parts rise into place when it arrives (globals.css); the tab shown is the one that moves.
  return (
    <Current.Provider value={tab}>
      <div className="gf-page contents" onClickCapture={onClickCapture}>{children}</div>
    </Current.Provider>
  );
}

/** The tab row. */
export function TabBar({ id, className }: { id: string; className?: string }) {
  const tab = useTab();
  return <Tabs className={className} active={tab} items={TABS.map((x) => ({ key: x.key, label: x.label, href: tabHref(id, x.key) }))} />;
}

/** One tab's content: shown while its tab is, hidden (and kept, with its state) otherwise. A tab whose content is still
 *  on its way from the server shows its skeleton. Shown, it rises 5px into place in the frame of the click (gf-tab,
 *  globals.css: a CSS animation, which the browser plays again whenever a hidden element is shown, and never on a
 *  re-render). */
export function TabPanel({ tab, children }: { tab: TabKey; children: ReactNode }) {
  const shown = useTab() === tab;
  return (
    <Activity mode={shown ? "visible" : "hidden"}>
      <div className="gf-tab">
        <Suspense fallback={<TabBodySkeleton tab={tab} />}>{children}</Suspense>
      </div>
    </Activity>
  );
}

/** `on` while the given tab is shown, `children` on every other tab. */
export function OnTab({ tab, on = null, children }: { tab: TabKey; on?: ReactNode; children: ReactNode }) {
  return <>{useTab() === tab ? on : children}</>;
}

"use client";

import { useSearchParams } from "next/navigation";
import { Activity, createContext, Suspense, useContext, useEffect, useRef, useState, type MouseEvent, type ReactNode } from "react";
import { arriveAgain } from "@/components/motion";
import { TabBodySkeleton } from "@/components/skeletons";
import { Tabs } from "@/components/tabs";
import { sectionOf, TABS, tabHref, tabOf, type TabKey } from "@/lib/tenancy-tabs";

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
//
// A #section in a link (a next step, a banner) is brought to the top of the page. From a link on the property that is
// done here, with the tab switch. From another page, or on a reload, the browser and the router each try once as the
// page arrives, and miss a section whose tab is still on its way from the server (every visit to a property after
// the first one in a session); so the property brings up the section its address names itself (bringUp).

const Current = createContext<TabKey | null>(null);

/** How long a section is held at the top after the page last changed height, and how long one that never comes is
 *  waited for. */
const SETTLE_MS = 1200;
const WAIT_MS = 10000;
/** What the viewer does to take the scroll back. */
const TAKEOVER = ["wheel", "touchstart", "keydown", "pointerdown"] as const;

/** Brings a #section to the top of the page and holds it there while the tab around it is still arriving: content
 *  streamed from the server after the page, or a part that draws in the browser (the deductions grid) and isn't at its
 *  height yet, when the page is too short to scroll that far. It lets go once the page has been still for a moment, and
 *  at once when the viewer scrolls, clicks or types. Returns the way to stop it. */
function bringUp(id: string): () => void {
  let still: ReturnType<typeof setTimeout> | undefined;
  const go = () => {
    const el = document.getElementById(id);
    // Not here yet, or on a tab that isn't shown.
    if (!el || !el.checkVisibility()) return;
    el.scrollIntoView({ block: "start" });
    clearTimeout(still);
    // A skeleton inside it is a part still loading, so it isn't at its height yet.
    if (!el.querySelector("[data-skeleton]")) still = setTimeout(stop, SETTLE_MS);
  };
  const watch = new ResizeObserver(go);
  const stop = () => {
    watch.disconnect();
    clearTimeout(still);
    clearTimeout(cap);
    for (const e of TAKEOVER) window.removeEventListener(e, stop, true);
  };
  const cap = setTimeout(stop, WAIT_MS);
  for (const e of TAKEOVER) window.addEventListener(e, stop, { capture: true, passive: true });
  go();
  watch.observe(document.body);
  return stop;
}

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
  // The #section the address names, held at the top while its tab settles: when the property arrives (opened from
  // another page, or loaded whole), and when the address moves to another tab (a link here, the bell).
  useEffect(() => {
    const section = sectionOf(window.location.hash);
    if (section) return bringUp(section);
  }, [id, fromUrl]);

  // A #section the click asked for, scrolled to once its tab is shown (each click counts, so a second click on the
  // same link answers again). From its own tab the section may already be where the scroll would put it, so it also
  // arrives again there (the arrival every part of the page makes, gf-enter in globals.css): the click always answers.
  // From another tab, the tab's own arrival is the answer, and the address, now on that tab, holds the section (above).
  const target = useRef<{ id: string; sameTab: boolean } | null>(null);
  const [asked, setAsked] = useState(0);
  useEffect(() => {
    const t = target.current;
    const el = t ? document.getElementById(t.id) : null;
    if (!t || !el || !el.checkVisibility()) return;
    target.current = null;
    el.scrollIntoView({ block: "start" });
    if (t.sameTab) arriveAgain(el);
  }, [asked, tab]);

  const onClickCapture = (e: MouseEvent<HTMLDivElement>) => {
    if (e.defaultPrevented || e.button !== 0 || e.metaKey || e.ctrlKey || e.shiftKey || e.altKey) return;
    const a = (e.target as HTMLElement).closest("a");
    if (!a || (a.target && a.target !== "_self") || a.hasAttribute("download")) return;
    const url = new URL(a.href, window.location.href);
    if (url.origin !== window.location.origin || url.pathname !== `/tenancy/${id}` || [...url.searchParams.keys()].some((k) => k !== "tab")) return;
    e.preventDefault();
    const next = tabOf(url.searchParams.get("tab"));
    const hash = sectionOf(url.hash);
    setTab(next);
    const to = tabHref(id, next, hash);
    if (to !== `${window.location.pathname}${window.location.search}${window.location.hash}`) window.history.replaceState(null, "", to);
    if (hash) {
      target.current = { id: hash, sameTab: next === tab };
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

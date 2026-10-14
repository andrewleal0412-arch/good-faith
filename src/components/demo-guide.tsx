"use client";

import Link from "@/components/link";
import { usePathname } from "next/navigation";
import { Suspense, use, useEffect, useId, useRef, useState } from "react";
import { Icon } from "./icons";
import { StepMark } from "./steps";
import { Card } from "./ui";
import { BEATS, GUIDE_COOKIE, type GuideState, type GuideStep } from "@/lib/demo-guide";

// The demo guide, at the top of every page of a private demo copy: the eight beats of docs/DEMO_SCRIPT.md in order,
// each a link to where that beat happens in this copy, each ticked off by the copy's own rows (src/lib/demo-guide.ts).
// In the page's own flow above its heading, so it never covers a control it points at.
//
// It is collapsed to its one line, or hidden for good, by the buttons in its head; the choice is kept in this browser
// as a cookie, which the server reads, so a copy whose guide is hidden renders no guide at all rather than one that
// flashes and goes. "Demo guide" in the account menu brings it back.

/** Keeps the choice in this browser for a month: no value is the open state, so choosing it clears the cookie. */
function remember(v: GuideState) {
  const secure = window.location.protocol === "https:" ? "; secure" : "";
  const age = v === "open" ? 0 : 60 * 60 * 24 * 30;
  document.cookie = `${GUIDE_COOKIE}=${v === "open" ? "" : v}; path=/; max-age=${age}; samesite=lax${secure}`;
}

export function DemoGuide({ state, steps }: { state: GuideState; steps: Promise<GuideStep[] | null> }) {
  const [view, setView] = useState<GuideState>(state);
  // The steps as the route last answered with them, kept with the render they answer for: a fresh render of the layout
  // (a full load, or the router.refresh() the landlord's own actions make) brings its own steps, and those win, so an
  // answer that belongs to an earlier render is left behind rather than painted over them.
  const [got, setGot] = useState<{ from: Promise<GuideStep[] | null>; list: GuideStep[] | null } | null>(null);
  const live = got?.from === steps ? got.list : null;
  const list = useId();
  const path = usePathname();
  const seen = useRef<string | null>(null);

  // The account menu's Demo guide brings a hidden one back, open (components/app-shell.tsx, AccountCard).
  useEffect(() => {
    const show = () => { remember("open"); setView("open"); };
    window.addEventListener("gf:demo-guide", show);
    return () => window.removeEventListener("gf:demo-guide", show);
  }, []);

  // Next keeps a layout it has already rendered when a click opens another page under it, so after a click the steps
  // the panel holds are the ones from the last full load. It asks the route for them again when the page under it
  // changes, and when this window is given focus again (beats 5 to 7 happen in the tenants' tab beside it).
  useEffect(() => {
    if (view === "off") { seen.current = ""; return; }
    let alive = true;
    const ask = async () => {
      try {
        const res = await fetch("/api/demo/guide", { cache: "no-store" });
        if (!res.ok) return;
        const body = (await res.json()) as { steps?: GuideStep[] | null };
        if (alive) setGot({ from: steps, list: body.steps ?? null });
      } catch {
        // The panel keeps what it shows: the guide is never the reason a page looks broken.
      }
    };
    // The first run is the page the server has just rendered, whose steps are its own; afterwards a new address means a
    // click moved the page under the panel.
    if (seen.current !== null && seen.current !== path) void ask();
    seen.current = path;
    window.addEventListener("focus", ask);
    return () => { alive = false; window.removeEventListener("focus", ask); };
  }, [path, view, steps]);

  if (view === "off") return null;
  const open = view === "open";
  const pick = (v: GuideState) => {
    remember(v);
    setView(v);
    // Hiding takes the focused button away with the panel, so the keyboard carries on at the page instead of at the
    // document (#main, the skip link's own target).
    if (v === "off") document.getElementById("main")?.focus();
  };

  return (
    <section aria-label="Demo guide" className="mb-5 md:mb-6 print:hidden">
      <Card soft className="px-3 py-1.5">
        <div className="flex items-center gap-2">
          <button type="button" aria-expanded={open} aria-controls={list} onClick={() => pick(open ? "shut" : "open")}
            className="flex min-w-0 flex-1 items-center gap-2 rounded-sm py-1 text-left">
            <Icon name="chev-right" className={`size-3.5 text-ink-4 transition-transform ${open ? "rotate-90" : ""}`} />
            <span className="shrink-0 text-sm font-medium">Demo guide</span>
            <Suspense fallback={null}><Meta steps={steps} live={live} open={open} /></Suspense>
          </button>
          <button type="button" onClick={() => pick("off")}
            className="shrink-0 rounded-sm px-2 py-1.5 text-xs font-medium text-ink-3 transition-colors hover:text-ink">
            Hide
          </button>
        </div>
        {/* In two columns where there is room, filled down the first and then the second (1 to 4, then 5 to 8), so the
            eight read in order either way; one column below that. */}
        {open && (
          <ol id={list} className="mt-1 border-t border-line-2 pt-1 lg:grid lg:auto-cols-fr lg:grid-flow-col lg:grid-rows-4 lg:gap-x-6">
            <Suspense fallback={<Rows list={null} />}><LoadedRows steps={steps} live={live} /></Suspense>
          </ol>
        )}
      </Card>
    </section>
  );
}

/** The head's second line: how far the copy has come when the steps are open, the next beat when they are collapsed. */
function Meta({ steps, live, open }: { steps: Promise<GuideStep[] | null>; live: GuideStep[] | null; open: boolean }) {
  const list = live ?? use(steps);
  if (!list) return null;
  const next = list.find((s) => !s.done);
  const words = open
    ? `${list.filter((s) => s.done).length} of ${list.length} done`
    : next ? `Next: ${next.n}. ${next.title}` : "All done";
  return <span className="truncate text-xs text-ink-3">{words}</span>;
}

function LoadedRows({ steps, live }: { steps: Promise<GuideStep[] | null>; live: GuideStep[] | null }) {
  return <Rows list={live ?? use(steps)} />;
}

/** The eight rows. Until the copy's own rows are in (and in a copy with no tenancy to point at) the beats are still
 *  listed, in the same space, without their links or ticks, so nothing shifts when they arrive. */
function Rows({ list }: { list: GuideStep[] | null }) {
  const next = list?.find((s) => !s.done) ?? null;
  return (
    <>
      {BEATS.map((b) => {
        const s = list?.find((x) => x.n === b.n) ?? null;
        const state = s?.done ? "done" : s && s.n === next?.n ? "now" : "todo";
        const body = (
          <>
            <StepMark small state={state} />
            <span className="min-w-0 flex-1">
              <span className="block text-sm font-medium">{b.n}. {b.title}</span>
              <span className="block text-xs text-ink-3">{b.line}</span>
            </span>
            <span className="mt-px flex shrink-0 items-center gap-1 text-xs text-ink-3">
              <span className="max-sm:hidden">{s?.where ?? b.where}</span>
              <Icon name="chev-right" className="size-3 text-ink-4" />
            </span>
            {/* Last, so a list of links reads the beat's own name first and its state after it. */}
            <span className="sr-only">{state === "done" ? "Done." : state === "now" ? "Next." : "To do."}</span>
          </>
        );
        const cls = "flex items-start gap-2.5 rounded-md px-1 py-2";
        return (
          // data-guide-step and data-guide-state are how scripts/e2e-demo.py reads the guide as a judge sees it.
          <li key={b.n} data-guide-step={b.n} data-guide-state={state}>
            {s ? <Link href={s.href} className={`${cls} transition-colors hover:bg-surface-2`}>{body}</Link> : <span className={cls}>{body}</span>}
          </li>
        );
      })}
    </>
  );
}

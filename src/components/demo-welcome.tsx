"use client";

import { usePathname, useRouter } from "next/navigation";
import { Suspense, use, useEffect, useId, useRef, useState, type CSSProperties } from "react";
import { Button, ButtonLink } from "./button";
import { useModal } from "./drawer";
import { Icon } from "./icons";
import { glideCurve, motionOff, usePresence } from "./motion";
import { WELCOME_COOKIE } from "@/lib/demo-guide";
import type { DemoWelcome as Welcome, TourStop } from "@/lib/demo-welcome";

// The welcome a judge's own copy opens with, once per browser, on Properties: a card on whose shoes they are in and
// what the demo is (src/lib/demo-welcome.ts writes its words from the copy's own units), then, if they want it, a tour
// of four parts of the page: the move-out the demo runs on, the next steps, the unit in a second state, and the demo
// guide's seven steps, where the tour ends. Its last button opens the move-out photos.
//
// Closing the card any way (either button, Escape, a click beside it) keeps a cookie that says this browser has seen
// it, which the server reads, so it never opens on a later visit and never flashes. "Welcome tour" in the account menu
// (components/app-shell.tsx) opens it again, from any page, in words read again from the copy.

/** Keeps "seen" in this browser for a year. A preference, no data. */
function remember() {
  const secure = window.location.protocol === "https:" ? "; secure" : "";
  document.cookie = `${WELCOME_COOKIE}=seen; path=/; max-age=${60 * 60 * 24 * 365}; samesite=lax${secure}`;
}

/** Whether this browser keeps that it has seen the welcome. The server reads the same cookie, so this matters only for
 *  a page the browser shows without asking the server: Back from the refund review (which has its own layout) brings
 *  the landlord layout back from history as it was first drawn, when the card was still to come. */
const seen = () => typeof document !== "undefined" && document.cookie.split("; ").includes(`${WELCOME_COOKIE}=seen`);

const onProperties = (path: string) => path === "/" || path === "/units";

export function DemoWelcome({ show, data }: { show: boolean; data: Promise<Welcome | null> }) {
  return <Suspense fallback={null}><Loaded show={show} data={data} /></Suspense>;
}

function Loaded({ show, data }: { show: boolean; data: Promise<Welcome | null> }) {
  const first = use(data);
  const path = usePathname();
  const router = useRouter();
  const [phase, setPhase] = useState<"card" | "tour" | "off">(() => (show && !seen() ? "card" : "off"));
  // The words as the route last answered with them, kept with the render they answer for, as the guide keeps its steps
  // (components/demo-guide.tsx): a fresh render of the layout brings its own words, and those win.
  const [got, setGot] = useState<{ from: Promise<Welcome | null>; w: Welcome | null } | null>(null);
  const w = got?.from === data ? got.w : first;
  // Both wait for Properties: a copy first opened on another page meets the card when it gets there.
  const here = onProperties(path);
  // A page change under the tour (Back, a swipe) ends it, so Properties opened again doesn't start it over.
  const [was, setWas] = useState(here);
  if (was !== here) {
    setWas(here);
    if (!here && phase === "tour") setPhase("off");
  }

  // The account menu's Welcome tour: the card again, on Properties, in words read again from the copy, since the
  // layout's own are from its last render (src/app/api/demo/welcome/route.ts).
  // A fresh render of the layout while the route answers (a router.refresh() an action makes) is fine: the answer is
  // kept against the words it came for, the newer render's own words win, and the card still opens.
  useEffect(() => {
    const open = async () => {
      if (!onProperties(window.location.pathname)) router.push("/units");
      try {
        const res = await fetch("/api/demo/welcome", { cache: "no-store" });
        if (!res.ok) throw new Error(`the route answered ${res.status}`);
        const body = (await res.json()) as { welcome?: Welcome | null };
        setGot({ from: data, w: body.welcome ?? null });
      } catch (e) {
        // The card opens with the words it has.
        console.warn("Welcome tour: could not read the copy again", e);
      }
      setPhase("card");
    };
    window.addEventListener("gf:demo-welcome", open);
    return () => window.removeEventListener("gf:demo-welcome", open);
  }, [router, data]);

  if (!w) return null;
  const skip = () => { remember(); setPhase("off"); };
  const end = () => {
    setPhase("off");
    // The tour takes the focused button with it, so the keyboard carries on at the page; when the account menu opened
    // it, the tour's dialog then gives focus back to the button that did (useModal, components/drawer.tsx).
    document.getElementById("main")?.focus();
  };
  return (
    <>
      <Card w={w} open={phase === "card" && here} onSkip={skip} onTour={() => { remember(); setPhase("tour"); }} />
      {phase === "tour" && here && <Tour stops={w.stops} start={w.start} onEnd={end} />}
    </>
  );
}

/** The card: whose copy this is, the move-out to close, and the three things worth knowing first. */
function Card({ w, open, onSkip, onTour }: { w: Welcome; open: boolean; onSkip: () => void; onTour: () => void }) {
  const panel = useRef<HTMLDivElement>(null);
  const titleId = useId();
  useModal(open, panel, onSkip);
  // It rises into place over a fading backdrop, as the confirm dialog does (a sheet on a phone).
  const { mounted, state } = usePresence(open);
  if (!mounted) return null;
  return (
    <div className="fixed inset-0 z-50 flex items-end justify-center sm:items-center sm:p-6 print:hidden" role="dialog" aria-modal={open ? "true" : undefined} aria-labelledby={titleId} inert={!open}>
      <button type="button" aria-hidden tabIndex={-1} data-state={state} className="gf-scrim absolute inset-0 cursor-default bg-ink/30" onClick={onSkip} />
      <div ref={panel} data-state={state} data-welcome="" className="gf-dialog relative max-h-full w-full overflow-y-auto rounded-t-lg border border-line bg-canvas px-5 pb-5 pt-5 shadow-md sm:max-w-[520px] sm:rounded-lg sm:p-7">
        <h2 id={titleId} className="text-balance text-xl font-semibold tracking-[-0.015em] sm:text-2xl">{w.title}</h2>
        <p className="mt-2 text-sm text-ink-2">{w.lead}</p>
        <ul className="mt-4 flex list-disc flex-col gap-2 pl-5 text-sm text-ink-2 marker:text-ink-4">
          {w.lines.map((line) => <li key={line}>{line}</li>)}
        </ul>
        <div className="mt-6 flex flex-row-reverse gap-2 border-t border-line-2 pt-5 max-sm:flex-col">
          <Button variant="primary" size="lg" data-autofocus onClick={onTour} className="max-sm:w-full">Show me around</Button>
          <Button size="lg" onClick={onSkip} className="max-sm:w-full">Skip the tour</Button>
        </div>
      </div>
    </div>
  );
}

const PAD = 6; // the ring's space around the part it shows
const GAP = 12; // between the ring and the tour's card
const EDGE = 16; // the tour's card keeps this far from the screen's edges
const GLIDE = 400; // ms the ring and the card take from one stop to the next

/** Where the card is laid out before the first stop places it, so its height can be measured at its real width. */
const UNPLACED: CSSProperties = { top: EDGE, left: EDGE, width: 320 };

type Box = Record<string, number>;
type Spot = { ring: Box; pop: Box };

/** A box `k` of the way from `a` to `b` (0 to 1). */
const mix = (a: Box, b: Box, k: number): Box => Object.fromEntries(Object.entries(b).map(([p, v]) => [p, a[p] + (v - a[p]) * k]));

/** Draws a box on an element: its edges in pixels, written straight to its style, since they change every frame. */
function place(el: HTMLElement | null, box: Box) {
  if (el) for (const [p, v] of Object.entries(box)) el.style.setProperty(p, `${v}px`);
}

/** The first copy of a stop's part that is on screen: a unit is a table row on a computer and a card on a phone. */
const partOf = (s: TourStop) => [...document.querySelectorAll<HTMLElement>(s.anchor)].find((el) => el.checkVisibility()) ?? null;

/** Where the ring and the tour's card go for a part: the card under it, or over it when there is no room under, kept
 *  on screen either way, and over the part itself only when the part is taller than the screen allows. `ahead` is how
 *  far the page has still to scroll, so the spot is where the part will rest. */
function spotFor(el: HTMLElement, pop: HTMLElement | null, ahead = 0): Spot {
  const r = el.getBoundingClientRect();
  const vw = document.documentElement.clientWidth, vh = window.innerHeight;
  const left = Math.max(4, r.left - PAD), right = Math.min(vw - 4, r.right + PAD);
  const top = r.top - ahead - PAD, bottom = r.bottom - ahead + PAD;
  const width = Math.min(320, vw - 2 * EDGE);
  const h = pop?.offsetHeight ?? 180;
  const y = bottom + GAP + h <= vh - EDGE ? bottom + GAP : top - GAP - h >= EDGE ? top - GAP - h : Math.max(EDGE, vh - EDGE - h);
  const x = Math.min(Math.max(left, EDGE), vw - EDGE - width);
  return { ring: { top, left, width: right - left, height: bottom - top }, pop: { top: y, left: x, width } };
}

/** The tour: one part of Properties at a time in a ring, the page dimmed around it and asleep under it, and a small card
 *  beside it with the stop's words, Back, Next and a way out. A stop whose part isn't on the page (a filter hides the
 *  unit, a copy with one state) is left out, and the count counts only the stops shown. */
function Tour({ stops, start, onEnd }: { stops: TourStop[]; start: string; onEnd: () => void }) {
  const [shown, setShown] = useState<TourStop[] | null>(null);

  // The stops whose part is on the page. The page may still be arriving, so it waits for every part for a moment; a
  // guide hidden in this browser is brought back first, since the tour ends on it.
  useEffect(() => {
    if (!document.querySelector('[data-tour="guide"]')) window.dispatchEvent(new Event("gf:demo-guide"));
    let done = false;
    // `last` is the timer's own look, which settles for what is there.
    const look = (last = false) => {
      if (done) return;
      const found = stops.filter((s) => partOf(s));
      if (found.length < stops.length && !last) return;
      done = true;
      watch.disconnect();
      setShown(found);
    };
    const watch = new MutationObserver(() => look());
    watch.observe(document.body, { childList: true, subtree: true });
    const late = setTimeout(() => look(true), 2000);
    look();
    return () => { done = true; watch.disconnect(); clearTimeout(late); };
  }, [stops]);

  useEffect(() => {
    if (shown && !shown.length) onEnd();
  }, [shown, onEnd]);

  // Nothing is drawn or locked while it looks: the page stays as it is until the first stop is ready.
  return shown?.length ? <Stops shown={shown} start={start} onEnd={onEnd} /> : null;
}

/** The stops found on the page, one at a time. */
function Stops({ shown, start, onEnd }: { shown: TourStop[]; start: string; onEnd: () => void }) {
  const panel = useRef<HTMLDivElement>(null);
  const titleId = useId();
  const bodyId = useId();
  const ring = useRef<HTMLDivElement>(null);
  // Where the ring and the card are drawn now, which the next stop's glide starts from.
  const drawn = useRef<Spot | null>(null);
  const [placed, setPlaced] = useState(false);
  const [step, setI] = useState(0);
  useModal(true, panel, onEnd);
  const i = Math.min(step, shown.length - 1); // a list found again shorter keeps the tour on its last stop
  const stop = shown[i];

  // Each stop brings its part to the middle of the screen. The ring and the card glide from where the last stop left
  // them to where the part will rest, and wait there for it while the page's scroll carries it in (aiming at the part
  // itself would chase it up and back); after that they follow it exactly while it scrolls and whenever the window or
  // the part changes size. The first stop, and reduced motion, put them in place at once. Focus goes to the stop's main
  // button.
  useEffect(() => {
    const found = partOf(stop);
    if (!found) return;
    let el: HTMLElement = found;
    // Where the page's scroll will stop: the part's middle in the middle of the screen under any scroll padding (the
    // top bar's), within the page. Unknown (null) once it has stopped. The scroll has stopped 150 ms after its last
    // step (no scrollend: older Safari has none); one that stopped short of the goal leaves them on the part.
    let goal: number | null = null;
    let still = 0;
    const stopped = () => { goal = null; measure(); };
    const wait = () => { clearTimeout(still); still = window.setTimeout(stopped, 150); };
    const bring = () => {
      el.scrollIntoView({ block: "center", behavior: motionOff() ? "instant" : "smooth" });
      const r = el.getBoundingClientRect(), html = document.documentElement, vh = html.clientHeight;
      const pad = parseFloat(getComputedStyle(html).scrollPaddingTop) || 0;
      goal = Math.min(html.scrollHeight - vh, Math.max(0, scrollY + r.top + r.height / 2 - (pad + vh) / 2));
      wait();
    };
    bring();
    const from = motionOff() ? null : drawn.current;
    const began = performance.now();
    let frame = 0;
    const sized = new ResizeObserver(() => measure());
    function draw() {
      // A unit is a table row on a computer and a card on a phone, so a window that crosses between the two (a
      // tablet turned, a window resized) swaps the part on screen: the ring goes to the one shown now.
      const now = partOf(stop);
      if (now && now !== el) { sized.unobserve(el); el = now; sized.observe(el); bring(); }
      if (goal !== null && Math.abs(goal - scrollY) < 1) goal = null;
      const to = spotFor(el, panel.current, goal === null ? 0 : goal - scrollY);
      const k = from ? Math.min(1, (performance.now() - began) / GLIDE) : 1;
      const at = from && k < 1 ? { ring: mix(from.ring, to.ring, glideCurve(k)), pop: mix(from.pop, to.pop, glideCurve(k)) } : to;
      drawn.current = at;
      place(ring.current, at.ring);
      place(panel.current, at.pop);
      setPlaced(true);
      if (k < 1) frame = requestAnimationFrame(draw);
    }
    function measure() {
      cancelAnimationFrame(frame);
      frame = requestAnimationFrame(draw);
    }
    // A new window size lays the page out again (a phone's layout stacks everything), which can carry the part off
    // screen with nothing scrolling: once the resizing stops, the part is brought back to the middle.
    let settle = 0;
    const resized = () => { measure(); clearTimeout(settle); settle = window.setTimeout(() => { bring(); measure(); }, 150); };
    const scrolled = () => { measure(); wait(); };
    measure();
    panel.current?.querySelector<HTMLElement>("[data-autofocus]")?.focus({ preventScroll: true });
    window.addEventListener("scroll", scrolled, true);
    window.addEventListener("resize", resized);
    sized.observe(el);
    if (panel.current) sized.observe(panel.current);
    return () => {
      cancelAnimationFrame(frame);
      clearTimeout(settle);
      clearTimeout(still);
      window.removeEventListener("scroll", scrolled, true);
      window.removeEventListener("resize", resized);
      sized.disconnect();
    };
  }, [stop]);

  const last = i === shown.length - 1;
  return (
    <div className="print:hidden">
      {/* The page under the tour takes no clicks; the ring only draws. Both are placed by the glide above, not here. */}
      <div aria-hidden className="fixed inset-0 z-50" />
      <div ref={ring} aria-hidden data-tour-ring="" className={`pointer-events-none fixed z-50 rounded-lg border-2 border-brand ${placed ? "" : "opacity-0"}`}
        style={{ boxShadow: "0 0 0 9999px color-mix(in srgb, var(--color-ink) 45%, transparent)" }} />
      <div ref={panel} role="dialog" aria-modal="true" aria-labelledby={titleId} aria-describedby={bodyId} data-tour-stop={i + 1}
        className={`fixed z-50 flex flex-col gap-3 rounded-lg border border-line bg-canvas p-4 shadow-md ${placed ? "" : "opacity-0"}`}
        style={UNPLACED}>
        {/* Each stop's words arrive from a faint copy as the card travels to it (.gf-tour-words), rather than swapping
            in where the last stop was. */}
        <div className="flex items-center justify-between">
          <span key={i} className="gf-tour-words text-xs font-medium text-ink-3">{i + 1} of {shown.length}</span>
          <button type="button" aria-label="Close the tour" onClick={onEnd}
            className="-my-0.5 -mr-1.5 inline-flex size-7 items-center justify-center rounded-md text-ink-3 transition-colors hover:bg-surface hover:text-ink">
            <Icon name="x" className="size-3.5" />
          </button>
        </div>
        <div aria-live="polite">
          <div key={i} className="gf-tour-words">
            <h2 id={titleId} className="text-base font-medium">{stop.title}</h2>
            <p id={bodyId} className="mt-1 text-sm text-ink-2">{stop.body}</p>
          </div>
        </div>
        <div className="flex items-center justify-between gap-2">
          <button type="button" onClick={onEnd} className="-ml-1 rounded-sm px-1 py-1.5 text-sm font-medium text-ink-3 transition-colors hover:text-ink">
            {last ? "Close" : "Skip tour"}
          </button>
          <div className="flex gap-2">
            {i > 0 && <Button onClick={() => setI(i - 1)}>Back</Button>}
            {last
              ? <ButtonLink variant="primary" href={start} data-autofocus onClick={onEnd}>Start with the move-out</ButtonLink>
              : <Button variant="primary" data-autofocus onClick={() => setI(i + 1)}>Next</Button>}
          </div>
        </div>
      </div>
    </div>
  );
}

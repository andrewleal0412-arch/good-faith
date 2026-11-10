"use client";

import { usePathname, useRouter } from "next/navigation";
import { Suspense, use, useCallback, useEffect, useLayoutEffect, useRef, useState } from "react";
import { Button } from "./button";
import { Icon } from "./icons";
import { motionOff, WorkingDots } from "./motion";
import { BAR_COOKIE, BEAT_EVENT, SEEN_EVENT, type GuideMove, type GuideSide, type GuideStep } from "@/lib/demo-guide";
import type { DemoSide } from "@/lib/demo-guide-server";

// The next-step bar and the Landlord | Tenants switch of a private demo copy.
//
// The bar is pinned to the foot of every demo page, the landlord's and the tenants' alike, and says the one thing to do
// next: "Step 2 of 7: press Prepare refund". The steps are the demo guide's (src/lib/demo-guide.ts), so the tour, the
// checklist and the bar never disagree; each step carries its moves in order, and the bar says the last of them whose
// control is on this page, else the first. Take me there opens the page the move happens on, scrolls its control to
// the middle of the screen and rings it with a steady brand outline until it is pressed; from then on each next control
// is rung as it appears. A wait (Claude at work) says what is happening and about how long, and the bar reads the
// steps again every few seconds until it is over, so it moves on by itself when a step is done.
//
// It never covers its control: a spacer as tall as the bar ends the page, so the last control can scroll clear of it,
// and the page's scroll padding keeps a control brought into view by the keyboard above it. Hide folds it to a small
// button in the corner that brings it back; the choice is a cookie the server reads (BAR_COOKIE).
//
// The switch is one click between the two sides of the demo. The tenants have nothing to dispute until the statement's
// delivery is recorded, so while it isn't, pressing Tenants records it (handed over in person, today, to the first
// tenant on the lease) and says so while it does, then opens their page. Landlord goes back to the landlord page the
// judge left.

/** The control a move names, when this page shows it. */
const targetOf = (name: string | null): HTMLElement | null => {
  if (!name) return null;
  const el = document.querySelector<HTMLElement>(`[data-guide-target="${name}"]`);
  return el?.checkVisibility() ? el : null;
};

/** Every control a move could name that this page shows now. */
const targetsHere = (): string[] =>
  [...document.querySelectorAll<HTMLElement>("[data-guide-target]")].filter((e) => e.checkVisibility()).map((e) => e.dataset.guideTarget!);

/** The move to say: the last of the step's moves whose control is on this page (the dispute form shows its later ones
 *  as the earlier ones are done), else the first, which says where to go. */
export function moveFor(step: GuideStep | null, here: readonly string[]): GuideMove | null {
  if (!step) return null;
  return [...step.moves].reverse().find((m) => m.target && here.includes(m.target)) ?? step.moves[0] ?? null;
}

// What has to outlive a page change to the other side (another layout, so another bar): the control Take me there is
// on its way to, and that the judge asked to be led. Kept for this tab only.
const PENDING = "gf_guide_pending";
const FOLLOW = "gf_guide_follow";
const BACK = "gf_side_back";
const store = {
  get: (k: string) => { try { return sessionStorage.getItem(k); } catch { return null; } },
  set: (k: string, v: string | null) => {
    try {
      if (v === null) sessionStorage.removeItem(k);
      else sessionStorage.setItem(k, v);
    } catch (e) {
      console.error("next-step bar: couldn't keep", k, e);
    }
  },
};

/** The control the ring is on, by its data-guide-target, until it is pressed: a page that draws that control again
 *  (a part streamed in after the first paint, PayPal's part of the refund review swapping in for its placeholder) gets a
 *  new element with no ring, so the bar puts it back on the new one. */
let rung: string | null = null;

/** The ring: one control at a time, a steady outline in the brand color (globals.css, [data-guide-ring]). */
function ring(el: HTMLElement | null) {
  for (const r of document.querySelectorAll("[data-guide-ring]")) if (r !== el) r.removeAttribute("data-guide-ring");
  el?.setAttribute("data-guide-ring", "");
  rung = el?.dataset.guideTarget ?? null;
}

/** The steps once they are in, as a promise of this window's own (the server's arrives as React's thenable). */
const settled = (steps: Promise<GuideStep[] | null>) => new Promise<GuideStep[] | null>((res, rej) => { steps.then(res, rej); });

export function GuideBar({ steps: from, hidden: hiddenAtFirst, shell = false, column = "max-w-content md:px-7" }: {
  steps: Promise<GuideStep[] | null>;
  hidden: boolean;
  shell?: boolean; // in the landlord's app, beside its 232px sidebar
  column?: string; // the page's own column, which the bar's words line up with
}) {
  const path = usePathname();
  const router = useRouter();
  const [list, setList] = useState<GuideStep[] | null>(null);
  const [here, setHere] = useState<string[]>([]);
  const [hidden, setHidden] = useState(hiddenAtFirst);
  const bar = useRef<HTMLDivElement>(null);
  const [tall, setTall] = useState(0);
  // The newest read wins: the layout's own steps (a full load, or a refresh after an action) and the route's answers
  // each take a number when they start, and an answer older than the one shown is dropped.
  const asked = useRef(0);
  const shown = useRef(0);
  // The control the judge last pressed, which is not rung again while it is still the move (the rows that move the
  // step on arrive a moment after the press).
  const pressed = useRef<string | null>(null);
  const lastTarget = useRef<string | null>(null);
  const take = useCallback((n: number, l: GuideStep[] | null) => {
    if (n < shown.current) return;
    shown.current = n;
    setList(l);
  }, []);

  useEffect(() => {
    const n = ++asked.current;
    // A warning, not an error: a page left mid-load drops its stream, and the bar then shows nothing until the next read.
    settled(from).then((l) => take(n, l), (e) => console.warn("next-step bar: the steps didn't load", e));
  }, [from, take]);

  const ask = useCallback(async () => {
    const n = ++asked.current;
    try {
      const res = await fetch("/api/demo/guide", { cache: "no-store" });
      if (!res.ok) return;
      take(n, ((await res.json()) as { steps?: GuideStep[] | null }).steps ?? null);
    } catch (e) {
      // The bar keeps what it shows: it is never the reason a page looks broken. A warning, since a read cut off by
      // the page being left (a link, a reload) lands here too.
      console.warn("next-step bar: couldn't read the steps", e);
    }
  }, [take]);

  // Read again when the page changes under the bar, when the window comes back, when a look beat is opened (the
  // checklist's cookie now holds it) or the lease check lands, and a few times after any guided control is pressed,
  // since what it starts (a refund, a negotiation) shows in the rows a moment later.
  const first = useRef(true);
  useEffect(() => {
    if (first.current) { first.current = false; return; }
    void ask();
  }, [path, ask]);
  useEffect(() => {
    const later: ReturnType<typeof setTimeout>[] = [];
    const onPress = (e: MouseEvent) => {
      const t = (e.target as Element | null)?.closest?.("[data-guide-target]");
      if (!t) return;
      pressed.current = (t as HTMLElement).dataset.guideTarget ?? null;
      if (t.hasAttribute("data-guide-ring")) t.removeAttribute("data-guide-ring");
      if (rung === pressed.current) rung = null;
      for (const ms of [1200, 3500, 8000]) later.push(setTimeout(() => void ask(), ms));
    };
    const soon = () => void ask();
    const back = () => { setHidden(false); setCookie(""); };
    document.addEventListener("click", onPress, true);
    window.addEventListener("focus", soon);
    window.addEventListener(SEEN_EVENT, soon);
    window.addEventListener(BEAT_EVENT, soon);
    window.addEventListener("gf:demo-guide", back);
    return () => {
      later.forEach(clearTimeout);
      document.removeEventListener("click", onPress, true);
      window.removeEventListener("focus", soon);
      window.removeEventListener(SEEN_EVENT, soon);
      window.removeEventListener(BEAT_EVENT, soon);
      window.removeEventListener("gf:demo-guide", back);
    };
  }, [ask]);

  // Which guided controls this page shows, kept as the page changes (a form's next part, a dialog, a page arriving).
  useEffect(() => {
    let frame = 0;
    const look = () => {
      if (rung && !document.querySelector("[data-guide-ring]")) {
        const el = targetOf(rung);
        if (el) ring(el);
      }
      setHere((was) => {
        const now = targetsHere();
        return now.length === was.length && now.every((t, i) => t === was[i]) ? was : now;
      });
    };
    look();
    const watch = new MutationObserver(() => { cancelAnimationFrame(frame); frame = requestAnimationFrame(look); });
    watch.observe(document.body, { subtree: true, childList: true, attributes: true, attributeFilter: ["data-guide-target", "hidden", "disabled"] });
    return () => { watch.disconnect(); cancelAnimationFrame(frame); };
  }, []);

  const total = list?.length ?? 0;
  const step = list?.find((s) => !s.done) ?? null;
  const move = moveFor(step, here);

  // While Claude is at work, the steps are read again every 4 seconds, so the bar moves on when it is done.
  useEffect(() => {
    if (!move?.wait) return;
    const t = setInterval(() => void ask(), 4000);
    return () => clearInterval(t);
  }, [move?.wait, ask]);

  // The control Take me there was on its way to is rung, and brought to the middle of the screen, when it arrives (the
  // page it is on can take a moment); a judge who asked to be led has each next control rung as it appears, in place.
  useEffect(() => {
    if ((move?.target ?? null) !== lastTarget.current) {
      lastTarget.current = move?.target ?? null;
      pressed.current = null;
    }
    const pending = store.get(PENDING);
    if (pending) {
      const [name, at] = pending.split("|");
      const el = targetOf(name);
      if (el) {
        store.set(PENDING, null);
        ring(el);
        el.scrollIntoView({ block: "center", behavior: motionOff() ? "auto" : "smooth" });
        return;
      }
      if (Date.now() - Number(at) < 15_000) return;
      store.set(PENDING, null);
    }
    if (store.get(FOLLOW) && move && !move.wait) {
      const el = targetOf(move.target);
      if (el && move.target !== pressed.current && !el.hasAttribute("data-guide-ring")) ring(el);
    }
  }, [move, here]);

  // The spacer and the scroll padding follow the bar's own height, which changes with its words and the screen's width.
  useLayoutEffect(() => {
    const el = bar.current;
    if (!el) return;
    const size = () => setTall(el.offsetHeight);
    size();
    const watch = new ResizeObserver(size);
    watch.observe(el);
    return () => watch.disconnect();
  }, [hidden, list]);
  useEffect(() => {
    const html = document.documentElement;
    html.style.scrollPaddingBottom = tall ? `${tall + 16}px` : "";
    return () => { html.style.scrollPaddingBottom = ""; };
  }, [tall]);
  // A ring left on a control once the bar is gone (a page without the demo) is taken off with it.
  useEffect(() => () => ring(null), []);

  function go() {
    if (!move) return;
    store.set(FOLLOW, "1");
    const el = targetOf(move.target);
    if (el) {
      ring(el);
      el.scrollIntoView({ block: "center", behavior: motionOff() ? "auto" : "smooth" });
      if (!move.wait) el.focus({ preventScroll: true });
      return;
    }
    if (!move.href) return;
    if (move.target) store.set(PENDING, `${move.target}|${Date.now()}`);
    router.push(move.href);
  }

  function hide(v: boolean) {
    setHidden(v);
    setCookie(v ? "off" : "");
    if (v) ring(null);
  }

  if (!list) return null;
  const pos = shell ? "md:left-[232px]" : "";
  return (
    <>
      <div aria-hidden className="print:hidden" style={{ height: tall }} />
      {hidden ? (
        <div ref={bar} className={`fixed bottom-0 right-0 z-40 p-3 print:hidden ${pos}`}>
          <Button size="md" onClick={() => hide(false)} className="gf-fade-in shadow-md">
            <Icon name="chev-up" />Next step
          </Button>
        </div>
      ) : (
        <aside ref={bar} aria-label="Next step" data-guide-bar=""
          className={`gf-bar fixed inset-x-0 bottom-0 z-40 border-t border-line bg-canvas shadow-md print:hidden ${pos}`}>
          <div className={`mx-auto flex w-full flex-wrap items-center gap-x-4 gap-y-2 px-4 py-2.5 ${column}`}>
            <p className="flex min-w-0 flex-1 basis-[300px] items-baseline gap-2 text-sm" aria-live="polite">
              {move?.wait && <WorkingDots className="shrink-0 self-center text-brand" />}
              <span className="min-w-0">
                {step && move ? (
                  <><span className="font-medium">Step {step.n} of {total}:</span> <span className="text-ink-2">{move.label}</span></>
                ) : (
                  <span className="font-medium">All {total} steps done.</span>
                )}
              </span>
            </p>
            <div className="ml-auto flex shrink-0 items-center gap-1.5">
              {move && (move.href || (move.target && here.includes(move.target))) && (
                <Button variant={move.wait ? "secondary" : "primary"} size="md" onClick={go}>
                  {move.wait ? "Show me" : "Take me there"}
                </Button>
              )}
              <button type="button" aria-label="Hide the next step" onClick={() => hide(true)}
                className="inline-flex size-[34px] items-center justify-center rounded-md text-ink-3 transition-colors hover:bg-surface hover:text-ink">
                <Icon name="x" />
              </button>
            </div>
          </div>
        </aside>
      )}
    </>
  );
}

function setCookie(v: string) {
  const secure = window.location.protocol === "https:" ? "; secure" : "";
  document.cookie = v ? `${BAR_COOKIE}=${v}; path=/; max-age=${60 * 60 * 24 * 30}; samesite=lax${secure}`
    : `${BAR_COOKIE}=; path=/; max-age=0; samesite=lax${secure}`;
}

/** The Landlord | Tenants switch. `side` is the side this page is on. Nothing is drawn outside a demo copy, or for a
 *  copy whose live unit has no tenants' page. It holds its place while the copy's facts stream in. */
export function SideSwitch(p: { side: GuideSide; demo: Promise<DemoSide | null>; className?: string }) {
  return <Suspense fallback={<span aria-hidden className={`inline-block h-8 w-[156px] shrink-0 ${p.className ?? ""}`} />}><Switch {...p} /></Suspense>;
}
function Switch({ side, demo, className = "" }: { side: GuideSide; demo: Promise<DemoSide | null>; className?: string }) {
  const d = use(demo);
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  if (!d) return null;

  async function tenants() {
    if (busy || !d) return;
    if (side === "landlord") store.set(BACK, `${window.location.pathname}${window.location.search}${window.location.hash}`);
    if (!d.delivered && d.to) {
      setBusy(true);
      const r = await fetch(`/api/tenancies/${d.tenancyId}/statement/delivery`, {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ method: "personal", date: d.today, to: d.to }),
      }).catch((e) => { console.error("Landlord | Tenants: couldn't record the statement's delivery", e); return null; });
      if (!r?.ok) console.error("Landlord | Tenants: the statement's delivery wasn't recorded", r?.status);
    }
    if (side === "tenants") { router.refresh(); setBusy(false); return; }
    router.push(d.tenantPath);
  }
  function landlord() {
    if (side === "landlord") return;
    router.push(store.get(BACK) || d!.landlordHref);
  }

  const seg = "inline-flex h-7 items-center gap-1.5 rounded-sm px-2.5 text-sm transition-[background-color,color,box-shadow] duration-(--dur-base)";
  const on = "bg-canvas font-medium text-ink shadow-sm";
  const off = "text-ink-3 hover:text-ink";
  return (
    <div role="group" aria-label="Which side of the demo" className={`inline-flex h-8 shrink-0 items-center rounded-md bg-surface p-0.5 ${className}`}>
      <button type="button" data-guide-target="side-landlord" aria-pressed={side === "landlord"} onClick={landlord}
        className={`${seg} ${side === "landlord" ? on : off}`}>Landlord</button>
      <button type="button" data-guide-target="side-tenants" aria-pressed={side === "tenants"} onClick={tenants} disabled={busy}
        className={`${seg} ${side === "tenants" ? on : off} disabled:cursor-wait`}>
        {busy ? <><WorkingDots className="text-brand" /><span role="status">Sending the statement</span></> : "Tenants"}
      </button>
    </div>
  );
}

/** The strip a demo copy puts above a page that has no landlord top bar (the tenants' pages, the refund review): whose
 *  shoes the judge is in, and the switch. */
export function DemoStrip({ side, demo }: { side: GuideSide; demo: Promise<DemoSide | null> }) {
  return (
    <div className="border-b border-line bg-surface print:hidden">
      <div className="mx-auto flex h-11 w-full max-w-[600px] items-center gap-3 px-4 sm:px-5">
        <span className="min-w-0 truncate text-xs text-ink-3">Demo copy: you&apos;re the {side === "tenants" ? "tenants" : "landlord"}</span>
        <SideSwitch side={side} demo={demo} className="ml-auto" />
      </div>
    </div>
  );
}

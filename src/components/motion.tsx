"use client";

import {
  Children, isValidElement, useCallback, useEffect, useLayoutEffect, useRef, useState, useSyncExternalStore,
  type ElementType, type ReactElement, type ReactNode, type RefObject,
} from "react";

// Good Faith's motion (docs/DESIGN.md, Motion): the timing tokens, in step with globals.css, and the few pieces every
// moving part shares. Calm and quick, Mercury rather than a landing page: a page eases into place, a list row opens to
// its height, a popover drops from its trigger, an amount counts to its new figure, a check draws itself.
//
// Five rules hold everywhere:
// - Reduced motion turns all of it off: every script asks motionOff() first and shows the final state at once (CSS
//   does the same in globals.css). Print never animates.
// - Nothing waits on an animation: content is readable from its first frame, and a working state shows only while
//   the work is really happening.
// - Only a real change moves: a part that is mounted, or shown again in a hidden tab, starts at rest; a background
//   refresh with the same values moves nothing (useLiveChange).
// - Nothing replays what the server already painted: a part hydrated from the page's HTML is on screen before any
//   script runs, so its first state is only marked seen (usePainted), never played.
// - Money is exact at rest: a rolling amount ends on the exact figure, and a screen reader has that figure from the
//   start (RollMoney).

/** The tokens, in milliseconds and as CSS curves: fast for hover, press and focus; enter for a page or a tab arriving;
 *  base for what opens, changes or arrives; slow for a drawer, a row opening and an amount settling; moment for the
 *  demo moments. */
export const DUR = { fast: 120, enter: 150, base: 200, slow: 320, moment: 560 } as const;
export const EASE = { standard: "cubic-bezier(0, 0, 0.2, 1)", exit: "cubic-bezier(0.4, 0, 1, 1)" } as const;

const REDUCE = "(prefers-reduced-motion: reduce)";

/** True when the viewer asked for reduced motion, or the browser can't say: then nothing moves. */
export function motionOff(): boolean {
  try {
    return window.matchMedia(REDUCE).matches;
  } catch {
    return true;
  }
}

function subscribeReduce(onChange: () => void) {
  let mq: MediaQueryList | null = null;
  try {
    mq = window.matchMedia(REDUCE);
    mq.addEventListener("change", onChange);
  } catch {
    // No matchMedia: motionOff() already says no motion.
  }
  return () => mq?.removeEventListener("change", onChange);
}

/** motionOff() as state, for a prop (AG Grid's cell flash). The server, and the first render, say no motion. */
export function useMotionOff(): boolean {
  return useSyncExternalStore(subscribeReduce, motionOff, () => true);
}

/** The standard curve as a function of time (0 to 1), for an amount counted in a script. */
export const standardCurve = cubicBezier(0, 0, 0.2, 1);

function cubicBezier(x1: number, y1: number, x2: number, y2: number) {
  const cx = 3 * x1, bx = 3 * (x2 - x1) - cx, ax = 1 - cx - bx;
  const cy = 3 * y1, by = 3 * (y2 - y1) - cy, ay = 1 - cy - by;
  const x = (t: number) => ((ax * t + bx) * t + cx) * t;
  const y = (t: number) => ((ay * t + by) * t + cy) * t;
  return (p: number) => {
    if (p <= 0) return 0;
    if (p >= 1) return 1;
    let lo = 0, hi = 1, t = p;
    for (let i = 0; i < 24; i++) {
      const v = x(t);
      if (Math.abs(v - p) < 1e-5) break;
      if (v < p) lo = t;
      else hi = t;
      t = (lo + hi) / 2;
    }
    return y(t);
  };
}

/** How much of a part must be inside the viewport before a moment plays on it. */
const IN_VIEW = 0.35;

/** Whether an element is on screen now: laid out, not in a hidden tab or a closed section, inside the viewport, and the
 *  page itself in view. A change below the fold happens at rest. */
export function onScreen(el: Element | null | undefined): boolean {
  if (!el || document.visibilityState !== "visible") return false;
  if (typeof el.checkVisibility === "function" && !el.checkVisibility()) return false;
  const r = el.getBoundingClientRect();
  return r.bottom > 0 && r.right > 0 && r.top < window.innerHeight && r.left < window.innerWidth;
}

/** Calls `play` once `el` is at least a third inside the viewport (an IntersectionObserver: a part below the fold plays
 *  when it is scrolled to; one in a hidden tab or a closed section waits). Returns a cancel. */
export function whenInView(el: Element, play: () => void): () => void {
  let done = false;
  const io = new IntersectionObserver((entries) => {
    const e = entries[entries.length - 1];
    if (done || !e?.isIntersecting) return;
    // A part taller than a third of the screen counts once a third of the screen is it.
    if (e.intersectionRatio < IN_VIEW && e.intersectionRect.height < window.innerHeight * IN_VIEW) return;
    done = true;
    io.disconnect();
    play();
  }, { threshold: [0, IN_VIEW, 0.7, 1] });
  io.observe(el);
  return () => {
    done = true;
    io.disconnect();
  };
}

/** A part of the page arriving again where it stands (the arrival every part makes, gf-enter in globals.css): the
 *  answer to a click on a link to what is already in place, which would otherwise change nothing. Nothing with reduced
 *  motion. */
export function arriveAgain(el: Element) {
  if (!motionOff()) el.animate([{ opacity: 0.4, transform: "translateY(4px)" }, { opacity: 1, transform: "none" }], { duration: DUR.enter, easing: EASE.standard });
}

/** Calls `cb` before the page is printed (the browser's Print, or Save as PDF): a moment still waiting on its first
 *  frame jumps to its end, so paper never shows a part undrawn. Returns a cancel. */
export function beforePrint(cb: () => void): () => void {
  window.addEventListener("beforeprint", cb);
  return () => window.removeEventListener("beforeprint", cb);
}

/* ---------- What is already on the screen ---------- */

const noSubscribe = () => () => {};

/** True while this part still shows what the server painted: it was hydrated from the page's HTML, which the browser
 *  drew before any script ran. A moment never plays over that (the part would vanish and come back); its first state is
 *  only marked seen. The caller's first layout effect reads it and sets it false, so a later change (a refresh that
 *  completes a step) plays as usual. A part React mounts in the browser (a page opened by a click, a tab laid out while
 *  hidden, a row a refresh added) starts false. */
export function usePainted(): RefObject<boolean> {
  // The server's answer while hydrating, the browser's for anything React renders itself.
  const fromServer = useSyncExternalStore(noSubscribe, () => false, () => true);
  const [painted] = useState(fromServer);
  return useRef(painted);
}

/* ---------- What this viewer has already seen ---------- */

// A demo moment (an inspection's boxes traced, a refund's success) plays the first time this viewer sees the thing it
// marks, never again on a revisit. Kept in this browser only, a per-viewer convenience: when storage can't be read (a
// private window, blocked site data) it is kept for this page's life instead, and the moment plays once per visit.
const SEEN_KEY = "gf:seen";
const seenHere = new Set<string>();

function storedSeen(): string[] {
  try {
    const raw = window.localStorage.getItem(SEEN_KEY);
    const v: unknown = raw ? JSON.parse(raw) : [];
    return Array.isArray(v) ? v.filter((x): x is string => typeof x === "string") : [];
  } catch {
    return [];
  }
}

export const firstSight = {
  seen(key: string): boolean {
    return seenHere.has(key) || storedSeen().includes(key);
  },
  mark(key: string) {
    seenHere.add(key);
    try {
      const all = storedSeen().filter((k) => k !== key);
      all.push(key);
      window.localStorage.setItem(SEEN_KEY, JSON.stringify(all.slice(-300)));
    } catch {
      // Kept for this page's life only.
    }
  },
};

/** The animation of several that ends last. */
export function lastToEnd(anims: Animation[]): Animation | null {
  const end = (a: Animation) => Number(a.effect?.getComputedTiming().endTime ?? 0);
  return anims.reduce<Animation | null>((a, b) => (!a || end(b) > end(a) ? b : a), null);
}

/** A moment that plays the first time this viewer sees `sight` (a refund just sent, a run's steps, a step completed
 *  since the last visit). `arm` starts its animations; they are held on their first frame (the part not yet drawn)
 *  until `target` is a third in view, then played, and `sight` is marked seen once they have played through, so a
 *  moment cut short (a tab hidden mid-way) plays again. Never over what the server painted (usePainted: only marked),
 *  and with reduced motion only marked. */
export function useFirstSight(sight: string | null | undefined, target: RefObject<Element | null>, arm: () => Animation[]) {
  const paintedRef = usePainted();
  useLayoutEffect(() => {
    const fromServer = paintedRef.current;
    paintedRef.current = false;
    if (!sight || firstSight.seen(sight)) return;
    if (fromServer || motionOff()) {
      firstSight.mark(sight);
      return;
    }
    const el = target.current;
    if (!el) return;
    const anims = arm();
    const last = lastToEnd(anims);
    if (!last) return;
    for (const a of anims) a.pause();
    const stop = whenInView(el, () => anims.forEach((a) => a.play()));
    const unprint = beforePrint(() => anims.forEach((a) => a.finish()));
    last.onfinish = () => firstSight.mark(sight);
    return () => {
      stop();
      unprint();
      last.onfinish = null;
      anims.forEach((a) => a.cancel());
    };
  }, [sight, target, arm, paintedRef]);
}

/* ---------- A real change, while it is seen ---------- */

/** Calls `onChange(from, to)` when `value` changes while this part is mounted and shown. A first mount, a tab shown
 *  again (React's Activity re-runs a hidden tab's effects when it comes back) or a re-render with the same value calls
 *  nothing. The callback may return a cleanup, run if the value changes again or the part is hidden mid-way. */
export function useLiveChange<T>(value: T, onChange: (from: T, to: T) => void | (() => void)) {
  const handler = useRef(onChange);
  const last = useRef(value);
  const live = useRef(false);
  useLayoutEffect(() => {
    handler.current = onChange;
  });
  useLayoutEffect(() => {
    const from = last.current;
    last.current = value;
    if (!live.current || Object.is(from, value)) return;
    return handler.current(from, value) ?? undefined;
  }, [value]);
  // Declared after the effect above, so on a mount (or a tab shown again) that effect still sees `live` as false.
  useLayoutEffect(() => {
    live.current = true;
    return () => {
      live.current = false;
    };
  }, []);
}

/* ---------- Presence: enter and exit ---------- */

/** For something that opens and closes (a drawer, a dialog, a menu): mounted while open and for its exit after,
 *  `state` "open" or "closed" for the CSS (globals.css: .gf-drawer, .gf-dialog, .gf-pop, .gf-scrim). */
export function usePresence(open: boolean, exitMs: number = DUR.base): { mounted: boolean; state: "open" | "closed" } {
  const [leaving, setLeaving] = useState(false);
  const [wasOpen, setWasOpen] = useState(open);
  if (open !== wasOpen) {
    setWasOpen(open);
    setLeaving(!open);
  }
  useEffect(() => {
    if (!leaving) return;
    const t = setTimeout(() => setLeaving(false), motionOff() ? 0 : exitMs);
    return () => clearTimeout(t);
  }, [leaving, exitMs]);
  return { mounted: open || leaving, state: open ? "open" : "closed" };
}

type Phase = "rest" | "in" | "out";
type Entry = { key: string; el: ReactElement; phase: Phase };

/** A list whose rows ease in when one is added and ease out when one is removed (height and opacity; a table row by
 *  opacity alone), with no jump. The children are the rows themselves, each with a key; nothing wraps them, so the
 *  list's own CSS (first:, last:, nth-child) still applies. Rows there at mount, or when the list is shown again in a
 *  tab, start at rest. A row component takes `ref` on its root element (React 19). A row marked
 *  `data-leave="at-once"` (a working state) is gone the moment it is removed: only the space it took closes. */
export function PresenceList({ children }: { children: ReactNode }) {
  const rows = Children.toArray(children).filter(isValidElement) as ReactElement[];
  const [entries, setEntries] = useState<Entry[]>(() => rows.map((el) => ({ key: String(el.key), el, phase: "rest" })));
  const [seen, setSeen] = useState(children);
  if (seen !== children) {
    setSeen(children);
    const next = merge(entries, rows);
    if (next !== entries) setEntries(next);
  }
  const live = useRef(false);
  useLayoutEffect(() => {
    live.current = true;
    return () => {
      live.current = false;
    };
  }, []);
  const settle = useCallback((key: string, phase: Phase) => {
    setEntries((xs) => (phase === "out" ? xs.filter((x) => !(x.key === key && x.phase === "out")) : xs.map((x) => (x.key === key && x.phase === "in" ? { ...x, phase: "rest" } : x))));
  }, []);
  return <>{entries.map((e) => <PresenceRow key={e.key} entry={e} live={live} onDone={settle} />)}</>;
}

/** The rows as they should stand: every current row in its order (new ones entering), and the rows just removed kept
 *  where they were until they have left. Returns the same array when nothing changed. */
function merge(prev: Entry[], rows: ReactElement[]): Entry[] {
  const now = new Set(rows.map((el) => String(el.key)));
  const before = new Map(prev.map((e) => [e.key, e]));
  // Each removed row stays after the row it followed (or first, when nothing before it is still there).
  const after = new Map<string | null, Entry[]>();
  let anchor: string | null = null;
  for (const e of prev) {
    if (now.has(e.key)) anchor = e.key;
    else after.set(anchor, [...(after.get(anchor) ?? []), { ...e, phase: "out" }]);
  }
  const out: Entry[] = [...(after.get(null) ?? [])];
  for (const el of rows) {
    const key = String(el.key);
    const was = before.get(key);
    out.push({ key, el, phase: !was || was.phase === "out" ? "in" : was.phase });
    out.push(...(after.get(key) ?? []));
  }
  const same = out.length === prev.length && out.every((e, i) => e.key === prev[i].key && e.el === prev[i].el && e.phase === prev[i].phase);
  return same ? prev : out;
}

function PresenceRow({ entry, live, onDone }: { entry: Entry; live: RefObject<boolean>; onDone: (key: string, phase: Phase) => void }) {
  const node = useRef<HTMLElement | null>(null);
  const { key, phase } = entry;
  // The row itself, drawn with a ref to its root (a row component takes `ref`, React 19); a row's own ref is not kept.
  const Row = entry.el.type as ElementType;
  const props = entry.el.props as Record<string, unknown>;
  useLayoutEffect(() => {
    if (phase === "rest") return;
    const el = node.current;
    // Not on screen (a hidden tab, below the fold), not live (just shown again), or no motion: straight to the end.
    if (!el || !live.current || motionOff() || !onScreen(el)) {
      onDone(key, phase);
      return;
    }
    const a = el.animate(rowFrames(el, phase), {
      duration: phase === "in" ? DUR.slow : DUR.base, easing: phase === "in" ? EASE.standard : EASE.exit, fill: phase === "out" ? "forwards" : "none",
    });
    a.onfinish = () => onDone(key, phase);
    // What the row marks as settling (a negotiation turn's move and the app's check on it) comes in just after it.
    const settling = phase === "in" ? [...el.querySelectorAll<HTMLElement>(".gf-settle")].map((n) => n.animate(
      [{ opacity: 0, transform: "scale(0.9)" }, { opacity: 1, transform: "none" }],
      { duration: DUR.base, delay: DUR.slow - 80, easing: EASE.standard, fill: "backwards" },
    )) : [];
    return () => {
      a.onfinish = null;
      a.cancel();
      settling.forEach((x) => x.cancel());
    };
  }, [phase, key, live, onDone]);
  return <Row {...props} ref={node} />;
}

/** A row opening from nothing to its height (or closing to nothing), its padding, margin and borders with it, so the
 *  rows under it move smoothly. A table row can't change height, so it fades. A row that leaves at once is invisible
 *  from the first frame of its exit, and only its space closes. */
function rowFrames(el: HTMLElement, phase: "in" | "out"): Keyframe[] {
  const gone = phase === "out" && el.dataset.leave === "at-once" ? 0 : 1;
  if (el.tagName === "TR") return phase === "in" ? [{ opacity: 0 }, { opacity: 1 }] : [{ opacity: gone }, { opacity: 0 }];
  const s = getComputedStyle(el);
  const full: Keyframe = {
    height: `${el.offsetHeight}px`, paddingTop: s.paddingTop, paddingBottom: s.paddingBottom, marginTop: s.marginTop, marginBottom: s.marginBottom,
    borderTopWidth: s.borderTopWidth, borderBottomWidth: s.borderBottomWidth, opacity: 1, overflow: "hidden",
  };
  const none: Keyframe = {
    height: "0px", paddingTop: "0px", paddingBottom: "0px", marginTop: "0px", marginBottom: "0px", borderTopWidth: "0px", borderBottomWidth: "0px", opacity: 0, overflow: "hidden",
  };
  return phase === "in" ? [none, full] : [{ ...full, opacity: gone }, none];
}

/* ---------- Small moving parts ---------- */

const CHECK_FRAMES: Keyframe[] = [{ strokeDasharray: "1", strokeDashoffset: 1 }, { strokeDasharray: "1", strokeDashoffset: 0 }];

/** The app's check (icons.tsx), drawn along its stroke: when `done` turns true while it is on screen (a step completing
 *  in front of the viewer), or, given `sight`, the first time this viewer sees it done (a run's steps, a step completed
 *  since the last visit), once it is in view. Drawn by script, so showing a tab again never draws it a second time. */
export function DrawCheck({ done = true, sight, delay = 0, className }: { done?: boolean; sight?: string | null; delay?: number; className?: string }) {
  const svg = useRef<SVGSVGElement>(null);
  const path = useRef<SVGPathElement>(null);
  const draw = useCallback((): Animation[] => {
    const el = path.current;
    return el ? [el.animate(CHECK_FRAMES, { duration: DUR.slow, delay, easing: EASE.standard, fill: "backwards" })] : [];
  }, [delay]);
  useLiveChange(done, (_, to) => {
    if (!to || sight || motionOff() || !onScreen(svg.current)) return;
    const a = draw();
    return () => a.forEach((x) => x.cancel());
  });
  useFirstSight(done ? sight : null, svg, draw);
  return (
    <svg ref={svg} viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth={1.5} strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"
      className={`block shrink-0 ${className ?? "size-4"}`}>
      <path ref={path} d="m3.5 8.5 3 3 6-7" pathLength={1} />
    </svg>
  );
}

/** How long after a refund goes out its receipt still opens on the success moment, for the viewer who hasn't seen it:
 *  long enough for the page that sent it, never for a receipt opened days later. */
const FRESH_MS = 10 * 60_000;

/** A short sequence, played once the first time this viewer sees `sight` (a refund just sent) in the minutes after
 *  `since`: the parts inside marked `data-moment` move in their turn, `data-delay` ms after the start. "pop": a mark
 *  scaling up into place; "draw": the lines inside drawn along their length; "rise": settling up 4px into place;
 *  "grow-y": a line growing down; "fade": fading in. Only after a click in the browser (a receipt hydrated from a full
 *  load shows at rest), never later than `since` allows, never with reduced motion: otherwise it is its content, at
 *  rest. */
export function Moment({ sight, since, className, children }: { sight: string | null; since?: string | null; className?: string; children: ReactNode }) {
  const root = useRef<HTMLDivElement>(null);
  const arm = useCallback((): Animation[] => {
    const el = root.current;
    if (!el || (since && !(Date.now() - Date.parse(since) < FRESH_MS))) return [];
    const anims: Animation[] = [];
    for (const n of el.querySelectorAll<HTMLElement>("[data-moment]")) {
      const delay = Number(n.dataset.delay ?? 0);
      const kind = n.dataset.moment;
      if (kind === "draw") {
        for (const p of n.querySelectorAll("path")) {
          const len = p.getTotalLength();
          anims.push(p.animate([{ strokeDasharray: `${len}`, strokeDashoffset: len }, { strokeDasharray: `${len}`, strokeDashoffset: 0 }],
            { duration: DUR.slow, delay, easing: EASE.standard, fill: "backwards" }));
        }
        continue;
      }
      const frames: Keyframe[] = kind === "pop" ? [{ opacity: 0, transform: "scale(0.88)" }, { opacity: 1, transform: "none" }]
        : kind === "rise" ? [{ opacity: 0, transform: "translateY(4px)" }, { opacity: 1, transform: "none" }]
          : kind === "grow-y" ? [{ transform: "scaleY(0)", transformOrigin: "top" }, { transform: "scaleY(1)", transformOrigin: "top" }]
            : [{ opacity: 0 }, { opacity: 1 }];
      anims.push(n.animate(frames, { duration: kind === "rise" ? DUR.slow : DUR.base, delay, easing: EASE.standard, fill: "backwards" }));
    }
    // The page's own arrival would play under the moment; the moment is the arrival.
    if (anims.length) for (const a of el.getAnimations()) a.cancel();
    return anims;
  }, [since]);
  useFirstSight(sight, root, arm);
  return <div ref={root} className={className}>{children}</div>;
}

/** Three dots that rise in turn: the working state, shown only while the work is happening. */
export function WorkingDots({ className }: { className?: string }) {
  return (
    <span aria-hidden="true" className={`gf-dots inline-flex items-center gap-[3px] ${className ?? ""}`}>
      <span className="size-[5px] rounded-full bg-current" />
      <span className="size-[5px] rounded-full bg-current" />
      <span className="size-[5px] rounded-full bg-current" />
    </span>
  );
}

/** A status chip's face, changing in place: when the status changes while it is seen, the chip eases to its new width
 *  and its words come up from a faint copy over the color's own transition (ui.tsx's StatusChip with `live`). */
export function ChipFace({ k, children }: { k: string; children: ReactNode }) {
  const face = useRef<HTMLSpanElement>(null);
  const width = useRef(0);
  useLiveChange(k, () => {
    const el = face.current, chip = el?.parentElement;
    if (!el || !chip || motionOff() || !onScreen(chip)) return;
    const to = chip.offsetWidth, from = width.current;
    const anims = [el.animate([{ opacity: 0.35 }, { opacity: 1 }], { duration: DUR.base, easing: EASE.standard })];
    if (from && Math.abs(from - to) > 0.5) {
      anims.push(chip.animate([{ width: `${from}px`, overflow: "hidden" }, { width: `${to}px`, overflow: "hidden" }], { duration: DUR.base, easing: EASE.standard }));
    }
    return () => anims.forEach((a) => a.cancel());
  });
  // After the change above (effects run in order): the chip's width as drawn now, where its next change starts from.
  useLayoutEffect(() => {
    const chip = face.current?.parentElement;
    if (chip) width.current = chip.offsetWidth;
  });
  return <span ref={face} className="inline-flex items-center gap-1.5">{children}</span>;
}

/** The figure an amount shows while it counts to a new value: when the value changes while it is seen (a deduction
 *  edited, a filter picked), it counts there over `ms` on the standard curve and lands on the exact value;
 *  null at rest. Never on a first paint, a tab shown again or a refresh with the same value. RollMoney draws it, with
 *  the final figure for a screen reader throughout. */
export function useRoll(value: number, ms: number = DUR.moment): number | null {
  const [shown, setShown] = useState<{ to: number; v: number } | null>(null);
  const frame = useRef(0);
  const at = useRef<number | null>(null); // the figure on screen while counting
  // Hidden (a tab) or unmounted mid-count: the next change starts from the figure at rest, not a stale one.
  useLayoutEffect(() => () => {
    at.current = null;
  }, []);
  useLiveChange(value, (from, to) => {
    if (motionOff() || document.visibilityState !== "visible") {
      at.current = null;
      return;
    }
    const start = performance.now(), origin = at.current ?? from;
    // The old figure in this same frame (a layout effect's update is drawn before the browser paints), so the new
    // one is never glimpsed before the count starts.
    at.current = origin;
    setShown({ to, v: origin });
    const step = (now: number) => {
      const p = Math.min(1, (now - start) / ms);
      if (p >= 1) {
        at.current = null;
        setShown(null);
        return;
      }
      at.current = Math.round((origin + (to - origin) * standardCurve(p)) * 100) / 100;
      setShown({ to, v: at.current });
      frame.current = requestAnimationFrame(step);
    };
    frame.current = requestAnimationFrame(step);
    return () => {
      cancelAnimationFrame(frame.current);
      setShown(null);
    };
  });
  return shown && shown.to === value ? shown.v : null;
}

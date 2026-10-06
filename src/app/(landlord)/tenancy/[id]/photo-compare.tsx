"use client";

import { useCallback, useLayoutEffect, useRef, useState, type CSSProperties, type SyntheticEvent } from "react";
import { Icon } from "@/components/icons";
import { beforePrint, DUR, firstSight, motionOff, usePainted } from "@/components/motion";
import { focusOn, placeBox, type Box } from "@/lib/boxes";
import type { Classification } from "@/lib/findings";

// One room's move-in and move-out photos, side by side or as a drag slider (Zillow's virtual staging), with each
// finding's box drawn over the move-out photo in its color and numbered like the list beside it. The box comes from
// the inspection in fractions of the photo, so it is placed from the photo's own shape whatever the frame's shape, and
// the crop is moved to keep the boxes in view.

export type Marker = { id: string; n: number; kind: Classification; label: string; box: Box | null; moveInBox: Box | null };
export type CompareMode = "side" | "slider";

/** Border and number colors by classification: red damage, amber cleaning, dashed white wear and tear. The outlines
 *  use the bright dot colors; the numbers sit on the darker text colors, so white on them reads at 4.5:1 or better. */
export const BADGE: Record<Classification, string> = { damage: "bg-red", cleaning: "bg-amber", wear_and_tear: "bg-ink-3", unclear: "bg-ink-2" };
const STYLE: Record<Classification, { frame: string; badge: string }> = {
  damage: { frame: "border-red-dot", badge: BADGE.damage },
  cleaning: { frame: "border-amber-dot", badge: BADGE.cleaning },
  wear_and_tear: { frame: "border-dashed border-white/95 shadow-none", badge: BADGE.wear_and_tear },
  unclear: { frame: "border-dashed border-ink-3", badge: BADGE.unclear },
};

const FRAME = 3 / 2; // the side-by-side frames, the shape of a landscape phone photo

/** The color a box's outline is traced in before its own border takes over: the border's own color, solid. */
const TRACE: Record<Classification, string> = { damage: "text-red-dot", cleaning: "text-amber-dot", wear_and_tear: "text-white", unclear: "text-ink-3" };
const STAGGER_MS = 140;

/** A box's outline as a path along the middle of its 1.5px border, with the border's 3px corners, from the top left
 *  clockwise: what the trace draws (globals.css, [data-trace="run"]). */
function outline(w: number, h: number): string {
  const a = 0.75, r = 2.25, x1 = w - a, y1 = h - a;
  return `M${a + r},${a}H${x1 - r}A${r},${r} 0 0 1 ${x1},${a + r}V${y1 - r}A${r},${r} 0 0 1 ${x1 - r},${y1}H${a + r}A${r},${r} 0 0 1 ${a},${y1 - r}V${a + r}A${r},${r} 0 0 1 ${a + r},${a}Z`;
}

/** The inspection's boxes traced onto the move-out photo, the first time this viewer sees this analysis of this room
 *  (`key`: the tenancy, when the comparison ran, the photo pair), so a new comparison traces again and a revisit never
 *  does. Until the photo has loaded and is a third in view the boxes wait unseen; then each outline is drawn in turn,
 *  its border takes over and its number settles in. Set on the DOM directly, not in React state, so nothing
 *  re-renders. Boxes the server already drew (a full load of the Move-out tab) are never hidden to be traced again:
 *  they are only marked seen. */
function useTrace(root: React.RefObject<HTMLDivElement | null>, key: string | null | undefined, mode: CompareMode) {
  const paintedRef = usePainted();
  useLayoutEffect(() => {
    const fromServer = paintedRef.current;
    paintedRef.current = false;
    const el = root.current;
    if (!key || !el || firstSight.seen(key) || !el.querySelector(".gf-mark")) return;
    if (fromServer || motionOff()) {
      firstSight.mark(key);
      return;
    }
    const img = el.querySelector<HTMLImageElement>("img[data-out]");
    let inView = false, done = false, timer = 0;
    el.setAttribute("data-trace", "armed");
    const loaded = () => !img || (img.complete && img.naturalWidth > 0);
    const go = () => {
      if (done || !inView || !loaded()) return;
      done = true;
      io.disconnect();
      firstSight.mark(key);
      const marks = [...el.querySelectorAll<HTMLElement>(".gf-mark")];
      for (const m of marks) m.querySelector(".gf-trace path")?.setAttribute("d", outline(m.offsetWidth, m.offsetHeight));
      el.setAttribute("data-trace", "run");
      timer = window.setTimeout(() => { el.removeAttribute("data-trace"); }, (marks.length - 1) * STAGGER_MS + DUR.moment + DUR.base + 200);
    };
    // A photo that can't load shows its boxes as they are, and so does paper.
    const failed = () => { done = true; el.removeAttribute("data-trace"); };
    const unprint = beforePrint(() => {
      if (!done) firstSight.mark(key);
      failed();
    });
    const io = new IntersectionObserver(([e]) => { inView = !!e && e.isIntersecting && e.intersectionRatio >= 0.35; go(); }, { threshold: [0, 0.35, 0.7] });
    io.observe(img ?? el);
    img?.addEventListener("load", go);
    img?.addEventListener("error", failed);
    return () => {
      io.disconnect();
      unprint();
      img?.removeEventListener("load", go);
      img?.removeEventListener("error", failed);
      clearTimeout(timer);
      el.removeAttribute("data-trace");
    };
  }, [root, key, mode, paintedRef]);
}

/** A photo's width over height once it has loaded (3:2 until then). The ref reads a photo the browser already had. */
function useShape() {
  const [shape, setShape] = useState(FRAME);
  const measure = useCallback((i: HTMLImageElement | null) => {
    if (i?.complete && i.naturalWidth && i.naturalHeight) setShape(i.naturalWidth / i.naturalHeight);
  }, []);
  return { measure, shape, onLoad: (e: SyntheticEvent<HTMLImageElement>) => measure(e.currentTarget) };
}

/** A frame's width over height as it is laid out now, kept current as the column resizes. A callback ref, so it
 *  starts measuring whenever the frame appears (the slider is mounted only in Slider mode). */
function useFrameShape(start: number) {
  const [shape, setShape] = useState(start);
  const observer = useRef<ResizeObserver | null>(null);
  const measure = useCallback((el: HTMLDivElement | null) => {
    observer.current?.disconnect();
    observer.current = null;
    if (!el) return;
    const read = () => { if (el.clientWidth && el.clientHeight) setShape(el.clientWidth / el.clientHeight); };
    read();
    observer.current = new ResizeObserver(read);
    observer.current.observe(el);
  }, []);
  return { measure, shape };
}

/** The move-in photo's outline: the same spot before the tenancy, so it is drawn neutral (dashed white, gray number)
 *  and labeled, never in the finding's damage or cleaning color. */
const REFERENCE = { frame: "border-dashed border-white/95", badge: "bg-ink-2" };

function Marks({ markers, which, shape, frame, focus, hot, onHot }: {
  markers: Marker[]; which: "box" | "moveInBox"; shape: number; frame: number; focus: number; hot: string | null; onHot?: (id: string | null) => void;
}) {
  const reference = which === "moveInBox";
  return (
    <>
      {markers.filter((m) => m[which]).map((m, i) => {
        const b = m[which]!;
        const p = placeBox(b, shape, frame, focus);
        const s = reference ? REFERENCE : STYLE[m.kind];
        const on = hot === m.id;
        const labelAbove = p.top + p.height > 84;
        // The move-out photo's boxes can be traced in (useTrace): each knows its place in the order (--gf-i) and carries
        // the outline the trace draws, hidden until then.
        const trace = !reference;
        return (
          <span key={m.id} aria-hidden title={reference ? `${m.n}. Same spot at move-in` : `${m.n}. ${m.label}`}
            onMouseEnter={onHot ? () => onHot(m.id) : undefined} onMouseLeave={onHot ? () => onHot(null) : undefined}
            className={`absolute rounded-[3px] border-[1.5px] transition-shadow ${trace ? "gf-mark" : ""} ${s.frame} ${on ? "z-[2] shadow-[0_0_0_3px_rgba(255,255,255,.75)]" : "shadow-[0_0_0_1px_rgba(255,255,255,.55)]"}`}
            style={{ left: `${p.left}%`, top: `${p.top}%`, width: `${p.width}%`, height: `${p.height}%`, ...(trace ? { "--gf-i": i } as CSSProperties : {}) }}>
            {trace && (
              <svg className={`gf-trace ${TRACE[m.kind]}`} fill="none" stroke="currentColor" strokeWidth={1.5} strokeLinecap="round" aria-hidden="true">
                <path pathLength={1} />
              </svg>
            )}
            <span className={`gf-badge absolute flex size-[18px] items-center justify-center rounded-[5px] text-xs font-semibold text-white shadow-sm ${s.badge}`}
              style={{ left: p.left < 2.5 ? 2 : -9, top: p.top < 4 ? 2 : -9 }}>
              {m.n}
            </span>
            {reference && (
              <span className="absolute left-1/2 -translate-x-1/2 whitespace-nowrap rounded-[4px] bg-white/95 px-1.5 py-px text-[11px] font-medium text-ink-2 shadow-sm"
                style={labelAbove ? { bottom: "calc(100% + 13px)" } : { top: "calc(100% + 4px)" }}>
                Same spot at move-in
              </span>
            )}
          </span>
        );
      })}
    </>
  );
}

const tagClass = "absolute top-2 z-[3] rounded-[5px] bg-white/95 px-[7px] py-0.5 text-xs font-medium text-ink";

export function PhotoCompare({ room, before, after, markers, mode, hot, onHot, trace }: {
  room: string;
  before: { url: string | null; date: string | null };
  after: { url: string | null; date: string | null };
  markers: Marker[];
  mode: CompareMode;
  hot: string | null;
  onHot: (id: string | null) => void;
  trace?: string | null; // this analysis of this pair, for the boxes' first trace (useTrace)
}) {
  const root = useRef<HTMLDivElement>(null);
  useTrace(root, trace, mode);
  return (
    <div ref={root}>
      <Compare room={room} before={before} after={after} markers={markers} mode={mode} hot={hot} onHot={onHot} />
    </div>
  );
}

function Compare({ room, before, after, markers, mode, hot, onHot }: {
  room: string;
  before: { url: string | null; date: string | null };
  after: { url: string | null; date: string | null };
  markers: Marker[];
  mode: CompareMode;
  hot: string | null;
  onHot: (id: string | null) => void;
}) {
  const { measure: inRef, shape: inShape, onLoad: inLoad } = useShape();
  const { measure: outRef, shape: outShape, onLoad: outLoad } = useShape();
  const [pos, setPos] = useState(50);
  const { measure: frameRef, shape: frameShape } = useFrameShape(2.4);
  const marked = markers.filter((m) => m.box).length;
  const outAlt = `${room} at move-out${marked ? `, ${marked} finding${marked === 1 ? "" : "s"} marked` : ""}`;
  const tag = (label: string, date: string | null) => <>{label}{date && <span className="max-sm:hidden">, {date}</span>}</>;
  // Where to crop when the frame and the photo differ in shape: on every box, or when they spread wider than the frame
  // on what can be charged (damage, cleaning), so a stain at the bottom of the photo isn't cropped away. Both photos
  // share the crop, so the slider lines them up, and every box is placed with it.
  const boxes = markers.flatMap((m) => (m.box ? [m.box] : []));
  const charged = markers.flatMap((m) => (m.box && (m.kind === "damage" || m.kind === "cleaning") ? [m.box] : []));
  const focusFor = (frame: number) => focusOn(boxes, outShape, frame, charged);
  const position = (shape: number, frame: number, focus: number) =>
    (shape > frame ? `${focus * 100}% 50%` : `50% ${focus * 100}%`);

  if (mode === "slider") {
    // The frame fills the column at 320px tall (240px on a phone) and crops both photos to it; the boxes are placed
    // from each photo's shape, the frame's measured shape and the crop, so they stay on the damage.
    const hotMarker = markers.filter((m) => m.id === hot);
    const focus = focusFor(frameShape);
    return (
      <div ref={frameRef} className="relative h-[240px] w-full overflow-hidden rounded-md bg-surface-2 sm:h-[320px]">
        {before.url && (
          // eslint-disable-next-line @next/next/no-img-element
          <img loading="lazy" decoding="async" ref={inRef} onLoad={inLoad} src={before.url} alt={`${room} at move-in`} className="absolute inset-0 size-full object-cover"
            style={{ objectPosition: position(inShape, frameShape, focus) }} />
        )}
        <Marks markers={hotMarker} which="moveInBox" shape={inShape} frame={frameShape} focus={focus} hot={hot} />
        <span className={`${tagClass} left-2`}>{tag("Move-in", before.date)}</span>
        <div className="absolute inset-0" style={{ clipPath: `inset(0 0 0 ${pos}%)` }}>
          {after.url && (
            // eslint-disable-next-line @next/next/no-img-element
            <img loading="lazy" decoding="async" ref={outRef} onLoad={outLoad} src={after.url} alt={outAlt} data-out="" className="absolute inset-0 size-full object-cover"
              style={{ objectPosition: position(outShape, frameShape, focus) }} />
          )}
          <Marks markers={markers} which="box" shape={outShape} frame={frameShape} focus={focus} hot={hot} />
          <span className={`${tagClass} right-2`}>{tag("Move-out", after.date)}</span>
        </div>
        <div aria-hidden className="pointer-events-none absolute inset-y-0 z-[4] -ml-px w-0.5 bg-white shadow-[0_0_0_1px_rgba(0,0,0,.12)]" style={{ left: `${pos}%` }}>
          <span className="absolute left-1/2 top-1/2 flex size-7 -translate-x-1/2 -translate-y-1/2 items-center justify-center rounded-full bg-white text-ink-2 shadow-md">
            <Icon name="split" className="size-3.5" />
          </span>
        </div>
        {/* The slider is a real range input stretched over the photos: drag anywhere, or focus it and use the arrow keys. */}
        <input type="range" min={0} max={100} step={1} value={pos} onChange={(e) => setPos(Number(e.target.value))}
          aria-label={`Compare ${room}: move-in on the left, move-out on the right`} aria-valuetext={`Divider at ${pos}%`}
          className="peer absolute inset-0 z-[5] m-0 size-full cursor-ew-resize appearance-none opacity-0" />
        <span aria-hidden className="pointer-events-none absolute inset-0 z-[6] rounded-md peer-focus-visible:ring-3 peer-focus-visible:ring-brand-100 peer-focus-visible:ring-inset" />
      </div>
    );
  }

  // Side by side: the move-out photo carries every box; the move-in photo outlines the same spot, neutral and labeled,
  // for the finding in focus.
  // On a phone the two stack at full width, so a box stays big enough to see.
  const focus = focusFor(FRAME);
  return (
    <div className="grid gap-2 sm:grid-cols-2 sm:gap-2.5">
      <figure className="relative m-0 aspect-[3/2] overflow-hidden rounded-md bg-surface-2">
        {before.url && (
          // eslint-disable-next-line @next/next/no-img-element
          <img loading="lazy" decoding="async" ref={inRef} onLoad={inLoad} src={before.url} alt={`${room} at move-in`} className="size-full object-cover"
            style={{ objectPosition: position(inShape, FRAME, focus) }} />
        )}
        <Marks markers={markers.filter((m) => m.id === hot)} which="moveInBox" shape={inShape} frame={FRAME} focus={focus} hot={hot} />
        <figcaption className={`${tagClass} left-2`}>{tag("Move-in", before.date)}</figcaption>
      </figure>
      <figure className="relative m-0 aspect-[3/2] overflow-hidden rounded-md bg-surface-2">
        {after.url && (
          // eslint-disable-next-line @next/next/no-img-element
          <img loading="lazy" decoding="async" ref={outRef} onLoad={outLoad} src={after.url} alt={outAlt} data-out="" className="size-full object-cover"
            style={{ objectPosition: position(outShape, FRAME, focus) }} />
        )}
        <Marks markers={markers} which="box" shape={outShape} frame={FRAME} focus={focus} hot={hot} onHot={onHot} />
        <figcaption className={`${tagClass} left-2`}>{tag("Move-out", after.date)}</figcaption>
      </figure>
    </div>
  );
}

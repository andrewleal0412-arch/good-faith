"use client";

import { useLayoutEffect, useRef } from "react";
import { beforePrint, DUR, EASE, firstSight, lastToEnd, motionOff, usePainted, whenInView } from "@/components/motion";

/** One step of the tenants' progress bar. */
export type ProgressStep = { key: string; label: string; done: boolean };

/** Apple's order progress: a green bar with tick marks and a label under each of the four steps. When a step this
 *  browser hasn't seen done is shown done after the page has loaded (the page refreshed after something it did, or a
 *  page opened by a click), the bar fills to it from where it last stood here, and each tick it passes turns green as
 *  it does, once the bar is in view. The page as the server drew it (a full load, which is how the tenants' link
 *  opens) is never replayed: its steps are only marked seen. */
export function TenantProgress({ steps, sight }: { steps: ProgressStep[]; sight: string }) {
  const bar = useRef<HTMLDivElement>(null);
  const paintedRef = usePainted();
  const last = steps.reduce((n, s, i) => (s.done ? i : n), -1);
  const at = (i: number) => `${(i / (steps.length - 1)) * 100}%`;
  const signature = steps.map((s) => `${s.key}:${s.done ? 1 : 0}`).join(",");

  useLayoutEffect(() => {
    const fromServer = paintedRef.current;
    paintedRef.current = false;
    const el = bar.current;
    if (!el) return;
    const done = signature.split(",").map((x, i) => ({ key: x.split(":")[0], i, done: x.endsWith(":1") }));
    const fresh = done.filter((s) => s.done && !firstSight.seen(`${sight}:${s.key}`));
    if (!fresh.length) return;
    const mark = () => fresh.forEach((s) => firstSight.mark(`${sight}:${s.key}`));
    if (fromServer || motionOff()) return mark();
    const top = Math.max(...done.filter((s) => s.done).map((s) => s.i));
    const from = Math.max(0, Math.min(...fresh.map((s) => s.i)) - 1);
    const span = Math.max(1, top - from);
    const n = done.length - 1;
    const length = DUR.moment + 120 * (span - 1);
    const anims: Animation[] = [];
    const fill = el.querySelector<HTMLElement>("[data-fill]");
    if (fill && top > 0) {
      anims.push(fill.animate([{ width: `${(from / n) * 100}%` }, { width: `${(top / n) * 100}%` }], { duration: length, easing: EASE.standard, fill: "backwards" }));
    }
    for (const s of fresh) {
      const tick = el.querySelector<HTMLElement>(`[data-tick="${s.i}"]`);
      const reach = s.i <= from ? 0 : ((s.i - from) / span) * length * 0.6;
      if (tick) anims.push(tick.animate([{ backgroundColor: "var(--color-line)" }, { backgroundColor: "var(--color-green-dot)" }], { duration: DUR.base, delay: reach, easing: EASE.standard, fill: "backwards" }));
    }
    const end = lastToEnd(anims);
    if (!end) return mark();
    for (const a of anims) a.pause();
    const stop = whenInView(el, () => anims.forEach((a) => a.play()));
    const unprint = beforePrint(() => anims.forEach((a) => a.finish()));
    end.onfinish = mark;
    return () => {
      stop();
      unprint();
      end.onfinish = null;
      anims.forEach((a) => a.cancel());
    };
  }, [signature, sight, paintedRef]);

  return (
    <div className="mt-5" role="img" aria-label={`Progress: ${steps.filter((s) => s.done).map((s) => s.label).join(", ") || "not started"}`}>
      <div ref={bar} className="relative mx-[5px] h-1 rounded-full bg-line">
        {last > 0 && <div data-fill="" className="absolute inset-y-0 left-0 rounded-full bg-green-dot" style={{ width: at(last) }} />}
        {steps.map((s, i) => (
          <span key={s.key} data-tick={i} style={{ left: at(i) }}
            className={`absolute top-1/2 size-2.5 -translate-x-1/2 -translate-y-1/2 rounded-full border-2 border-white ${s.done ? "bg-green-dot" : "bg-line"}`} />
        ))}
      </div>
      <div className="relative mt-2.5 h-4 text-xs text-ink-3">
        {steps.map((s, i) => (
          <span key={s.key} style={{ left: at(i) }}
            className={`absolute top-0 whitespace-nowrap ${i === 0 ? "" : i === steps.length - 1 ? "-translate-x-full" : "-translate-x-1/2"} ${i === last ? "font-medium text-ink" : ""}`}>
            {s.label}
          </span>
        ))}
      </div>
    </div>
  );
}

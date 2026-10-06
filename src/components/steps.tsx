"use client";

import { useCallback, useRef } from "react";
import { DrawCheck, DUR, EASE, motionOff, onScreen, useFirstSight, useLiveChange } from "./motion";

// The step timelines' moving parts: the move-in steps, the tenants' timeline, the close-out agent's steps on the refund
// review. A step that completes while it is seen (or, with `sight`, one this viewer hasn't seen completed before, once
// it is in view) draws its check and fills the line from it to the next step. Never over what the server painted. At
// rest they are the plain timeline: a green check, a brand dot, an empty ring, and the line under a completed step in
// green.

/** A step's mark: a green check when done (drawn as it completes), a brand dot for the current step, an empty ring for
 *  one to come. 20px, or 18px in the refund review's lists (`small`). */
export function StepMark({ state, sight, delay = 0, small }: { state: "done" | "now" | "todo"; sight?: string | null; delay?: number; small?: boolean }) {
  return (
    <span aria-hidden className={`relative z-10 flex ${small ? "size-[18px]" : "size-5"} items-center justify-center rounded-full transition-colors duration-(--dur-base) ${state === "done" ? "bg-green-bg text-green"
      : state === "now" ? "bg-brand-50" : "border border-line bg-canvas"}`}>
      {state === "now" && <span className="size-2 rounded-full bg-brand" />}
      {/* Always there, so a step completing while it is seen draws its check (hidden until then). */}
      <span className={state === "done" ? "contents" : "hidden"}>
        <DrawCheck done={state === "done"} sight={sight} delay={delay} className="size-3" />
      </span>
    </span>
  );
}

/** The line from a step down to the next, positioned by `className`: gray, and green under a completed step, the green
 *  growing down from the step when it completes while seen (or the first time this viewer sees it, with `sight`). */
export function StepLine({ done, sight, delay = 0, className }: { done: boolean; sight?: string | null; delay?: number; className: string }) {
  const track = useRef<HTMLSpanElement>(null);
  const fill = useRef<HTMLSpanElement>(null);
  const grow = useCallback((): Animation[] => {
    const el = fill.current;
    return el ? [el.animate([{ transform: "scaleY(0)" }, { transform: "scaleY(1)" }], { duration: DUR.slow, delay, easing: EASE.standard, fill: "backwards" })] : [];
  }, [delay]);
  useLiveChange(done, (_, to) => {
    if (!to || sight || motionOff() || !onScreen(track.current)) return;
    const a = grow();
    return () => a.forEach((x) => x.cancel());
  });
  // The track, not the fill, is watched for the view: the fill is scaled to nothing until it grows.
  useFirstSight(done ? sight : null, track, grow);
  return (
    <span ref={track} aria-hidden className={`${className} bg-line`}>
      {done && <span ref={fill} className="absolute inset-0 origin-top bg-green-dot/45" />}
    </span>
  );
}

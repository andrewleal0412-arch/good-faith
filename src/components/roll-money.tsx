"use client";

import { useRef } from "react";
import { DUR, EASE, motionOff, useLiveChange } from "./motion";
import { Money } from "./ui";

/** An amount that lands on its new figure when it changes while it is seen (a deduction edited, a filter picked): the
 *  exact new figure at once, settling in from a faint copy of itself, a hero (owed back, the deductions, Deposits held)
 *  over the base token and a figure beside it or a tile's total (`quick`) over the enter token. It never counts through
 *  figures that were never true. On a first paint, at rest and with reduced motion it is the plain Money. */
export function RollMoney({ quick, ...p }: Parameters<typeof Money>[0] & { quick?: boolean }) {
  const figure = useRef<HTMLSpanElement>(null);
  useLiveChange(p.value, () => {
    if (motionOff() || document.visibilityState !== "visible") return;
    const a = figure.current?.animate([{ opacity: 0.35 }, { opacity: 1 }], { duration: quick ? DUR.enter : DUR.base, easing: EASE.standard });
    return () => a?.cancel();
  });
  return <Money {...p} ref={figure} />;
}

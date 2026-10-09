"use client";

import { useRouter } from "next/navigation";
import { useEffect, useRef } from "react";

// How a page that waits on the other side of a dispute hears about it without a reload. The landlord's Negotiation
// card waits on the tenants (to accept the settlement, to answer an offer, to withdraw); the tenants' dispute page
// waits on the landlord (the negotiator's answer, an offer, the approval and the payment); both follow the two agents
// turn by turn while they run. The page was rendered with a stamp of where the dispute stood (negotiationStamp,
// src/lib/negotiation.ts) and asks its status route for the stamp as it reads now: a different one refreshes the page
// (router.refresh(), which keeps what is typed and where the page is scrolled).
//
// Kept light. It asks only while the caller says the dispute can still change (never on a page with no dispute, a
// draft, or one that is settled or withdrawn), and one small request at a time: every 3 seconds while the agents run,
// every 4 while it waits on a person, every 15 once nothing has changed for five minutes, and not at all after thirty.
// A hidden tab asks nothing. Looking at the tab again, or clicking into its window, asks at once and starts the pace
// over, and so does a card shown again after its tab was hidden (a property's tabs, tenancy/[id]/tab-state.tsx).

const RUN_MS = 3000;
const WAIT_MS = 4000;
const SLOW_MS = 15_000;
const SLOW_AFTER_MS = 5 * 60_000;
const STOP_AFTER_MS = 30 * 60_000;

/** What a status route answers with, as far as the watch reads it. */
export type WatchAnswer = { stamp?: string | null; negotiationStatus?: string | null };

/** While `on`, asks `url` for the dispute's stamp and refreshes the page when it is no longer `stamp`, the one the page
 *  shows. `running` asks at the agents' pace. `also` sees each answer and may ask for a refresh of its own (the
 *  landlord's card ends the run it was following). */
export function useWatch(o: { on: boolean; url: string; stamp: string; running?: boolean; also?: (j: WatchAnswer) => boolean }) {
  const router = useRouter();
  const latest = useRef(o); // what the page shows now, for an answer that comes back later
  useEffect(() => { latest.current = o; });
  const asked = useRef<string | null>(null); // the stamp the last refresh was for: each one refreshes once
  const last = useRef<number | null>(null); // when it last asked
  const { on, url, running = false } = o;

  useEffect(() => {
    if (!on) return;
    let timer: ReturnType<typeof setTimeout> | undefined;
    let over = false;
    let asking = false;
    let since = Date.now(); // the last change, or the last look at the tab: the pace counts from here
    const next = () => {
      clearTimeout(timer);
      if (over || document.hidden) return;
      const quiet = Date.now() - since;
      if (!running && quiet > STOP_AFTER_MS) return;
      timer = setTimeout(ask, running ? RUN_MS : quiet < SLOW_AFTER_MS ? WAIT_MS : SLOW_MS);
    };
    const ask = async () => {
      if (asking || over) return;
      asking = true;
      last.current = Date.now();
      const r = await fetch(url, { cache: "no-store" }).catch(() => null);
      const j = r?.ok ? ((await r.json().catch(() => null)) as WatchAnswer | null) : null;
      asking = false;
      if (over) return;
      if (j) {
        const shown = latest.current;
        const moved = !!j.stamp && j.stamp !== shown.stamp && j.stamp !== asked.current;
        if (moved) asked.current = j.stamp ?? null;
        const more = shown.also?.(j) ?? false;
        if (moved || more) {
          since = Date.now();
          router.refresh();
        }
      }
      next();
    };
    const look = () => {
      clearTimeout(timer);
      if (document.hidden) return;
      since = Date.now();
      asked.current = null; // a refresh that never arrived may be asked for once more
      void ask();
    };
    // Shown again after a while hidden: ask at once. Otherwise the first question comes one pace from now.
    if (last.current != null && Date.now() - last.current > WAIT_MS) void ask();
    else next();
    document.addEventListener("visibilitychange", look);
    window.addEventListener("focus", look);
    return () => {
      over = true;
      clearTimeout(timer);
      document.removeEventListener("visibilitychange", look);
      window.removeEventListener("focus", look);
    };
  }, [on, url, running, router]);
}

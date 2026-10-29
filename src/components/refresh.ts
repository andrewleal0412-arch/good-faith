"use client";

import { useRouter } from "next/navigation";
import { useCallback, useTransition } from "react";

// router.refresh() for a button that acts and then refreshes the page. Cleared as soon as the request answered, a busy
// state ("Sending...", a disabled button) let the old screen show again, button and all, for the half second the
// refresh took to bring the new one in. `refresh(then)` runs the refresh and `then` (the busy state's clearing, a form
// closing) in one React transition, so React commits them with the refreshed page and not before: the button stays
// busy until the screen that answers it is up. An error path that doesn't refresh clears its busy state itself.
export function useRefresh(): (then?: () => void) => void {
  const router = useRouter();
  const [, start] = useTransition();
  return useCallback((then?: () => void) => start(() => { router.refresh(); then?.(); }), [router, start]);
}

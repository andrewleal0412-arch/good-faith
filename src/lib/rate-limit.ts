// A fixed-window count in memory, for a public route that must not be flooded (the PayPal webhook): so many requests
// a minute from one address, and so many from all of them together. One Render instance keeps one count; a restart
// clears it. The ceiling across addresses keeps a flood from many addresses from making the app ask PayPal to check
// thousands of signatures; PayPal retries anything refused, so a real event refused here arrives later.

export type Window = { perAddress: number; total: number; ms: number };

export function rateLimiter(w: Window) {
  let start = 0;
  let total = 0;
  const counts = new Map<string, number>();
  /** True when this request is over a limit; counts it either way. */
  return function limited(address: string, now = Date.now()): boolean {
    if (now - start >= w.ms) {
      start = now;
      total = 0;
      counts.clear();
    }
    total++;
    const mine = (counts.get(address) ?? 0) + 1;
    if (counts.size < 10_000 || counts.has(address)) counts.set(address, mine);
    return mine > w.perAddress || total > w.total;
  };
}

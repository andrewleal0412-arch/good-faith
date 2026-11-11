// Wrong access codes, counted in memory: about 10 per 10 minutes from one address, and a ceiling across every address
// for a guesser with many addresses. One Render instance holds one count; a restart clears it, which is fine for a
// code that is long and random (docs/DEPLOY.md). A correct code is never counted.

export const WINDOW_MS = 10 * 60 * 1000;
export const PER_ADDRESS = 10;
export const EVERYONE = 200;

const tries = new Map<string, number[]>();
let all: number[] = [];
let pruned = 0;

const recent = (xs: number[], now: number) => xs.filter((t) => now - t < WINDOW_MS);

/** The caller's address, from a header the caller can't choose.
 *  - On Render (which sets RENDER in the environment), Cloudflare sits in front and sets CF-Connecting-IP to the
 *    address that reached it, replacing any value the caller sent. Render's X-Forwarded-For is "<whatever the caller
 *    sent>, <caller>, <Cloudflare edge>": its first entry is the caller's own words, so it is never used.
 *  - GOOD_FAITH_CLIENT_IP_HEADER names the header to trust on another host (for example x-real-ip behind nginx).
 *  - Otherwise the last X-Forwarded-For entry, the one the nearest proxy appended, then X-Real-IP, then "local".
 *  With no proxy in front at all (a bare `next start`), every header is the caller's, so the per-address count only
 *  slows an honest browser; the ceiling across addresses still holds. */
export function clientAddress(headers: Headers, env: Record<string, string | undefined> = process.env): string {
  const named = (env.GOOD_FAITH_CLIENT_IP_HEADER?.trim() || (env.RENDER ? "cf-connecting-ip" : "")).toLowerCase();
  const trusted = named ? headers.get(named)?.split(",")[0]?.trim() : "";
  const hops = (headers.get("x-forwarded-for") ?? "").split(",").map((s) => s.trim()).filter(Boolean);
  return (trusted || hops.at(-1) || headers.get("x-real-ip")?.trim() || "local").slice(0, 64);
}

/** True when this address has used up its wrong tries for now. The ceiling across every address applies only to an
 *  address that has itself been wrong in the window: so a flood of wrong codes from many addresses holds each of them
 *  to one try, but can't lock out a judge who hasn't guessed. */
export function throttled(address: string, now = Date.now()): boolean {
  all = recent(all, now);
  const mine = recent(tries.get(address) ?? [], now);
  if (mine.length) tries.set(address, mine); else tries.delete(address);
  return mine.length >= PER_ADDRESS || (mine.length > 0 && all.length >= EVERYONE);
}

export function recordWrong(address: string, now = Date.now()) {
  const mine = recent(tries.get(address) ?? [], now);
  mine.push(now);
  tries.set(address, mine);
  // The ceiling only needs to know it has been reached, so the list stays at most EVERYONE long.
  all = recent(all, now);
  if (all.length < EVERYONE) all.push(now);
  // Keep the map small: drop addresses whose tries have all expired, at most once a minute. A scan on every wrong code
  // cost each one a pass over every address once more than 5000 were live (one IPv6 /64 holds that many).
  if (tries.size > 5000 && now - pruned >= 60_000) {
    pruned = now;
    for (const [k, v] of tries) if (!recent(v, now).length) tries.delete(k);
  }
}

/** How many addresses the map holds, for the checks. */
export const tracked = () => tries.size;

import "server-only";
import { dateIn, PACIFIC, todayIn } from "./dates";
import { db } from "./db";
import { POOL_FRESH_DAYS } from "./demo-pool";
import { copyLimits, dailyLimits } from "./limits";

// The owner's readout behind /api/health?owner=1 (src/app/api/health/route.ts): what the judging window runs on, read
// from the database alone, so the owner can look from any browser without the laptop. No PayPal read. Nothing secret
// and nothing personal: the copies per address are counts, in descending order, never the addresses or their keyed
// hashes. The day is the Pacific calendar day the limits count on (take_usage, create_demo_workspace).

export type OwnerReadout = {
  ok: true;
  /** The Pacific day the counts are for. */
  day: string;
  pool: {
    /** Deposits a new copy can take: unclaimed, not used by a PayPal dispute or an outside refund, paid within the cutoff. */
    ready: number;
    /** Deposits claimed by copies made today (the end-to-end test's fake one included while it runs). */
    claimedToday: number;
    /** How old the oldest ready deposit is, or null with none ready; past cutoffDays a deposit is skipped. */
    oldestReadyDays: number | null;
    cutoffDays: number;
  };
  copies: {
    /** New demo copies today across every address, and GOOD_FAITH_DAILY_COPIES_TOTAL. */
    today: number;
    limit: number;
    /** Copies today per address, most first, and GOOD_FAITH_DAILY_COPIES. */
    perAddress: { limit: number; today: number[] };
  };
  /** Claude jobs today across every session, the owner's included, and GOOD_FAITH_DAILY_AI_TOTAL. */
  claude: { today: number; limit: number };
};

type PoolRow = { paid_at: string; claimed_by: string | null; claimed_at: string | null; disputed_at: string | null; refunded_outside_at: string | null };

export async function ownerReadout(now = new Date()): Promise<OwnerReadout | { ok: false; error: string }> {
  const day = todayIn(PACIFIC, now);
  const [pool, copies, ai] = await Promise.all([
    db.from("demo_deposit_pool").select("paid_at, claimed_by, claimed_at, disputed_at, refunded_outside_at"),
    db.from("demo_copy_usage").select("ip_key, used").eq("day", day),
    db.from("daily_usage").select("used").eq("day", day).eq("session_id", "*").eq("kind", "ai_total").maybeSingle(),
  ]);
  const failed = [pool.error && "the pool", copies.error && "today's copies", ai.error && "today's Claude jobs"].filter((s): s is string => !!s);
  if (failed.length) {
    console.error("owner readout failed", [pool.error, copies.error, ai.error].filter(Boolean).map((e) => e!.message).join("; "));
    return { ok: false, error: `Couldn't read ${failed.join(", ")}. Try again in a moment.` };
  }

  const cutoff = now.getTime() - POOL_FRESH_DAYS * 86_400_000;
  const rows = (pool.data ?? []) as PoolRow[];
  const used = (r: PoolRow) => !!(r.disputed_at || r.refunded_outside_at);
  const ready = rows.filter((r) => !r.claimed_by && !used(r) && Date.parse(r.paid_at) > cutoff);
  const oldest = ready.reduce((min, r) => Math.min(min, Date.parse(r.paid_at)), Infinity);
  const claimedToday = rows.filter((r) => r.claimed_at && dateIn(r.claimed_at, PACIFIC) === day).length;

  const usage = (copies.data ?? []) as { ip_key: string; used: number }[];
  // create_demo_copy writes an address's row before it checks the limits, so an address refused today sits at 0; left out.
  const perAddress = usage.filter((r) => r.ip_key !== "*" && r.used > 0).map((r) => r.used).sort((a, b) => b - a);
  const limits = copyLimits();

  return {
    ok: true,
    day,
    pool: {
      ready: ready.length,
      claimedToday,
      oldestReadyDays: ready.length ? Math.floor((now.getTime() - oldest) / 86_400_000) : null,
      cutoffDays: POOL_FRESH_DAYS,
    },
    copies: {
      today: usage.find((r) => r.ip_key === "*")?.used ?? 0,
      limit: limits.total,
      perAddress: { limit: limits.perAddress, today: perAddress },
    },
    claude: { today: ai.data?.used ?? 0, limit: dailyLimits().aiTotal },
  };
}

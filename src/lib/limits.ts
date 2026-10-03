import "server-only";
import { APICallError, LoadAPIKeyError, RetryError } from "ai";
import { db } from "./db";
import { ACCESS_MESSAGES } from "./session";
import { currentSession } from "./session-server";

// Daily limits for the hosted demo, so an open URL can't run up the Anthropic bill, flood the PayPal sandbox or fill
// the database and storage. Each Claude job, each sandbox invoice, each new tenancy and each megabyte of stored uploads
// takes its share of today's allowance before it starts (supabase/migrations, take_usage), checked and counted in one
// locked step. A demo session gets so many of each a day; every session together gets a total per family (Claude
// jobs, invoices, tenancies, upload megabytes); the owner has no per-session limit but counts toward the totals. A
// refused job never reaches Claude, PayPal or storage. The numbers can be changed on the host (docs/DEPLOY.md).
//
// A Claude job is one unit however many calls it makes: an inspection is one call per room (up to
// GOOD_FAITH_INSPECT_ROOMS), a close-out run up to twelve agent steps plus the steps after the approval. The totals
// and the Anthropic console's spend limit are the real ceiling; the per-session limits are soft, since a new sign-in
// is a new session.

export type UsageKind = "lease" | "inspect" | "close_out" | "invoice" | "tenancy" | "upload_mb";

/** A whole number from the environment, or the default when it is unset or not a whole number. */
function envInt(name: string, fallback: number): number {
  const raw = process.env[name];
  if (raw == null || raw.trim() === "") return fallback;
  const n = Number(raw);
  return Number.isInteger(n) && n >= 0 ? n : fallback;
}

export function dailyLimits() {
  const aiTotal = envInt("GOOD_FAITH_DAILY_AI_TOTAL", 150);
  return {
    perSession: {
      lease: envInt("GOOD_FAITH_DAILY_LEASE", 5),
      inspect: envInt("GOOD_FAITH_DAILY_INSPECT", 3),
      close_out: envInt("GOOD_FAITH_DAILY_CLOSE_OUT", 4),
      invoice: envInt("GOOD_FAITH_DAILY_INVOICE", 5),
      tenancy: envInt("GOOD_FAITH_DAILY_TENANCY", 10),
      upload_mb: envInt("GOOD_FAITH_DAILY_UPLOAD_MB", 100),
    } satisfies Record<UsageKind, number>,
    total: {
      lease: aiTotal,
      inspect: aiTotal,
      close_out: aiTotal,
      invoice: envInt("GOOD_FAITH_DAILY_INVOICE_TOTAL", 100),
      tenancy: envInt("GOOD_FAITH_DAILY_TENANCY_TOTAL", 50),
      upload_mb: envInt("GOOD_FAITH_DAILY_UPLOAD_MB_TOTAL", 400),
    } satisfies Record<UsageKind, number>,
  };
}

/** The most rooms one inspection compares (one Claude call each), and the most photos per room and phase it sends. */
export const inspectRoomLimit = () => envInt("GOOD_FAITH_INSPECT_ROOMS", 6);
export const inspectPhotoLimit = () => Math.max(1, envInt("GOOD_FAITH_INSPECT_PHOTOS", 6));

/** Upload megabytes a set of files counts for: their bytes rounded up to whole megabytes, at least one. */
export const uploadUnits = (bytes: number) => Math.max(1, Math.ceil(bytes / (1024 * 1024)));

export const LIMIT_REACHED = "Today's demo limit for this is used up. Everything already prepared still works.";

/** What takeAllowance hands back: the response to send instead, or a way to return the units when the job failed
 *  without spending anything. */
export type Allowance = { refused: Response } | { refused: null; giveBack: () => Promise<void> };

/** Takes `units` of this kind for the current session. `refused` is the response to send instead: 401 without a
 *  session, 429 when a limit is used up, 503 when the count can't be read. Otherwise the units are counted, and
 *  `giveBack` returns them to the same day's counts. */
export async function takeAllowance(kind: UsageKind, units = 1): Promise<Allowance> {
  const session = await currentSession();
  if (!session) return { refused: Response.json({ error: ACCESS_MESSAGES.signedOut }, { status: 401 }) };
  const limits = dailyLimits();
  const { data, error } = await db.rpc("take_usage", {
    p_session: session.sid,
    p_kind: kind,
    p_units: units,
    p_session_limit: session.kind === "owner" ? null : limits.perSession[kind],
    p_global_limit: limits.total[kind],
  });
  if (error) {
    console.error("daily limit check failed", error.message);
    return { refused: Response.json({ error: "Couldn't check today's demo limit. Try again in a moment." }, { status: 503 }) };
  }
  const r = data as { allowed?: boolean; reason?: string | null; day?: string } | null;
  if (!r?.allowed) return { refused: Response.json({ error: LIMIT_REACHED, limit: r?.reason ?? null }, { status: 429 }) };
  const giveBack = async () => {
    const { error: e } = await db.rpc("give_back_usage", { p_day: r.day, p_session: session.sid, p_kind: kind, p_units: units });
    if (e) console.error("daily limit give-back failed", e.message);
  };
  return { refused: null, giveBack };
}

/** True when a Claude job failed because Claude never answered: the API refused the call or couldn't be reached (an
 *  overload, a rate limit, a bad or missing key), so nothing was spent and the unit can go back. An answer that came
 *  back and then failed a check keeps its unit. */
export function claudeNeverAnswered(e: unknown): boolean {
  if (RetryError.isInstance(e)) return e.errors.length > 0 && e.errors.every(claudeNeverAnswered);
  return APICallError.isInstance(e) || LoadAPIKeyError.isInstance(e);
}

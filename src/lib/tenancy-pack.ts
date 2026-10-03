import "server-only";
import { db } from "./db";
import type { Notices } from "./notices";
import { packFor } from "./states/server";
import type { StatePack } from "./states/types";

// The state rule pack a tenancy follows: its property's state (properties.state, California for every row made before
// the packs). For routes and server modules that have only the tenancy id.
export async function tenancyPack(tenancyId: string): Promise<StatePack> {
  const { data } = await db.from("tenancies").select("properties(state)").eq("id", tenancyId).maybeSingle();
  return packFor((data?.properties as { state?: string | null } | null)?.state);
}

/** The statement and refund deadline for a move-out date, on the tenancy's own track: what the close-out counts
 *  (closeout.ts), including Florida's claim notice when deductions are on file. Null without a move-out. */
export async function tenancyDue(tenancyId: string, moveOutDate: string): Promise<{ pack: StatePack; due: string | null }> {
  const [{ data: t }, { count }] = await Promise.all([
    db.from("tenancies").select("end_date, planned_move_out, notices, properties(state)").eq("id", tenancyId).maybeSingle(),
    db.from("deductions").select("id", { count: "exact", head: true }).eq("tenancy_id", tenancyId),
  ]);
  const pack = packFor((t?.properties as { state?: string | null } | null)?.state);
  const notices = (t?.notices ?? {}) as Notices;
  return {
    pack,
    due: pack.deadline.due({
      moveOutDate, endDate: (t?.end_date ?? null) as string | null, plannedMoveOut: (t?.planned_move_out ?? null) as string | null,
      claimed: (count ?? 0) > 0, claimNoticeDate: notices.claim_notice?.date ?? null,
    }),
  };
}

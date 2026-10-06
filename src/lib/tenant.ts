import { dateIn, longDate, PACIFIC } from "./dates";

// What the tenants send through their private link (/t/<token>): that they are moving out, the planned date, and
// the forwarding address the itemized statement is mailed to (Civ. Code 1950.5(h)(6)). Pure: the tenant route
// writes it, the landlord's pages and the units list read it.

export type TenantMoveOut = {
  name: string | null; // which adult tenant sent it, when more than one is on the lease
  planned_move_out: string; // YYYY-MM-DD
  forwarding_address: string;
  submitted_at: string; // the first submission; a change keeps it
  updated_at: string;
};

/** A forwarding address is a street address: long enough to be one, short enough for an envelope. */
export const FORWARDING_MIN = 8;
export const FORWARDING_MAX = 240;

/** How far ahead a planned move-out may be: a year, past which it is almost surely a typo. */
export const PLANNED_MOVE_OUT_HORIZON_DAYS = 366;

/** How far back: tenants do report a move-out after the fact, but one months old is a typo'd year. */
export const PLANNED_MOVE_OUT_PAST_DAYS = 60;

/** The date the tenants first sent it, where the property is (`zone`, its pack's; Pacific for California). This is the
 *  day they said they were leaving, which the landlord's notice record starts from; a later change to the forwarding
 *  address does not move it. */
export const tenantMoveOutSentOn = (m: TenantMoveOut, zone = PACIFIC) => dateIn(m.submitted_at, zone);

/** The date of the latest version where the property is, for the forwarding address as it stands. */
export const tenantMoveOutUpdatedOn = (m: TenantMoveOut, zone = PACIFIC) => dateIn(m.updated_at, zone);

/** One line for the landlord: "Maya Torres wrote through the tenant link on October 1, 2026: moving out October 31, 2026",
 *  with the day of the latest change when there was one. */
export function describeTenantMoveOut(m: TenantMoveOut, zone = PACIFIC): string {
  const sent = tenantMoveOutSentOn(m, zone), updated = tenantMoveOutUpdatedOn(m, zone);
  const changed = updated !== sent ? ` (changed ${longDate(updated)})` : "";
  return `${m.name ?? "The tenants"} wrote through the tenant link on ${longDate(sent)}${changed}: moving out ${longDate(m.planned_move_out)}`;
}

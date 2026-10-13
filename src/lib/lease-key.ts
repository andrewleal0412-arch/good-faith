// When two tenancies came from the same lease. A private copy of the demo already holds a tenancy for each of the
// demo leases, so a judge who checks one and presses Start tenancy would get a second tenancy of that same lease, at
// the same address, beside the one the copy came with; pressing it again would add a third. So in a demo copy a start
// that names a lease already on file opens that tenancy instead (src/app/api/tenancies/route.ts), and the property
// says why in one sentence. Pure, so scripts/state-packs-check.mjs and the end-to-end walk can hold it.

/** What identifies a lease across two tenancies: the property it is for and the tenants named on it. The lease PDF is
 *  a fresh upload every time, so it can't be the key, and the dates can't either: a demo copy moves every date in the
 *  tenancy it copies, the stored lease terms included (supabase/migrations/..._demo_copy_functions.sql). */
export type LeaseIdentity = { address: string | null | undefined; tenants: (string | null | undefined)[] };

/** Case, punctuation and runs of spaces don't matter: "1140 E. Juniper Hollow Ln" and "1140 e juniper hollow ln" are
 *  the same address, since Claude's reading of one PDF can differ that much between runs. */
const squash = (s: string | null | undefined) => (s ?? "").toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();

/** The key two tenancies share when they came from one lease, or null when there isn't enough to tell: the address and
 *  the tenants' names, the names in a fixed order so their order on the lease never matters. A lease with no name read
 *  off it keys on its address alone, so it matches only a tenancy with no tenants either; null matches nothing, so a
 *  lease with no address starts a tenancy as before (the route refuses one anyway). */
export function leaseKey(o: LeaseIdentity): string | null {
  const address = squash(o.address);
  if (!address) return null;
  return `${address}::${o.tenants.map(squash).filter(Boolean).sort().join("|")}`;
}

/** The sentence the property shows when a start of a lease already on file opened it instead (?lease=existing). */
export const SAME_LEASE =
  "This lease already has a tenancy in this copy of the demo, so this opens it instead of starting a second one.";

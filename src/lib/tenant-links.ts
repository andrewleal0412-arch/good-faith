import "server-only";
import { createHash, randomBytes } from "node:crypto";
import { db } from "./db";
import { isTemplate } from "./workspace";

// Private tenant links. The token (32 random bytes, base64url) is shown to the landlord once and never stored; the
// table keeps its SHA-256, so a copy of the database opens no tenant page. From outside, an unknown token and a
// revoked one look the same: the page and every tenant route answer 404 with no detail. One link is live per
// tenancy at a time, so a link that got around is replaced rather than joined by a second one.

const TOKEN_RE = /^[A-Za-z0-9_-]{43}$/; // 32 bytes in base64url, unpadded

export const hashToken = (token: string) => createHash("sha256").update(token).digest("hex");

export type TenantLink = { id: string; createdAt: string; lastSeenAt: string | null };

const row = (d: { id: string; created_at: string; last_seen_at: string | null }): TenantLink => ({ id: d.id, createdAt: d.created_at, lastSeenAt: d.last_seen_at });

/** The link that is live for a tenancy, if any. */
export async function activeTenantLink(tenancyId: string): Promise<TenantLink | null> {
  const { data } = await db.from("tenant_links").select("id, created_at, last_seen_at").eq("tenancy_id", tenancyId).is("revoked_at", null)
    .order("created_at", { ascending: false }).limit(1).maybeSingle();
  return data ? row(data) : null;
}

/** Makes a new link and revokes any live one. The token comes back exactly once. The revoke and the insert happen in
 *  one database function that locks the tenancy row, so two creates at once queue up rather than both leaving a link
 *  live; a unique index (tenant_links_one_live_idx) backs that up. */
export async function createTenantLink(tenancyId: string): Promise<{ token: string; link: TenantLink; replaced: string[] }> {
  const token = randomBytes(32).toString("base64url");
  const { data, error } = await db.rpc("create_tenant_link", { p_tenancy: tenancyId, p_token_hash: hashToken(token) });
  if (error || !data) throw new Error(error?.message ?? "Couldn't create the link.");
  const d = data as { id: string; created_at: string; last_seen_at: string | null; replaced: string[] };
  return { token, link: row(d), replaced: d.replaced };
}

/** Revokes every live link of a tenancy. Returns the ids revoked; none when nothing was live. */
export async function revokeTenantLinks(tenancyId: string): Promise<string[]> {
  const { data } = await db.from("tenant_links").update({ revoked_at: new Date().toISOString() }).eq("tenancy_id", tenancyId).is("revoked_at", null).select("id");
  return (data ?? []).map((x) => x.id as string);
}

/** The tenancy a token opens, or null for anything else: malformed, unknown or revoked. Every tenant request goes
 *  through here. A page view stamps last_seen_at so the landlord can see the link is in use; the photo requests
 *  behind a page view don't, since one view would write it a dozen times. */
export async function resolveTenantToken(token: string, opts: { touch?: boolean } = {}): Promise<{ linkId: string; tenancyId: string } | null> {
  if (!TOKEN_RE.test(token)) return null;
  const { data } = await db.from("tenant_links").select("id, tenancy_id").eq("token_hash", hashToken(token)).is("revoked_at", null).maybeSingle();
  if (!data) return null;
  // A template's link isn't stamped: nothing writes to the demo's templates.
  if (opts.touch !== false && !(await isTemplate(data.tenancy_id as string))) {
    await db.from("tenant_links").update({ last_seen_at: new Date().toISOString() }).eq("id", data.id);
  }
  return { linkId: data.id as string, tenancyId: data.tenancy_id as string };
}

/** The one answer every tenant route gives for a token it doesn't accept, and for anything it won't discuss. */
export const tokenNotFound = () => Response.json({ error: "Not found." }, { status: 404 });

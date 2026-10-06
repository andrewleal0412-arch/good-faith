import "server-only";
import { createHash, createHmac, randomBytes } from "node:crypto";
import { db } from "./db";
import { gate } from "./session";
import { isTemplate, type Workspace } from "./workspace";

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
 *  live; a unique index (tenant_links_one_live_idx) backs that up. In a demo copy (`demo`) the link's token is then
 *  re-keyed to its demo token (demoTenantToken), so the copy's own pages can open the tenants' page again. */
export async function createTenantLink(tenancyId: string, opts: { demo?: boolean } = {}): Promise<{ token: string; link: TenantLink; replaced: string[] }> {
  const token = randomBytes(32).toString("base64url");
  const { data, error } = await db.rpc("create_tenant_link", { p_tenancy: tenancyId, p_token_hash: hashToken(token) });
  if (error || !data) throw new Error(error?.message ?? "Couldn't create the link.");
  const d = data as { id: string; created_at: string; last_seen_at: string | null; replaced: string[] };
  const demo = opts.demo ? demoTenantToken(d.id) : null;
  if (demo) {
    // Only while the link is still the one just made with the random token; otherwise the random token stands.
    const { data: keyed } = await db.from("tenant_links").update({ token_hash: hashToken(demo) })
      .eq("id", d.id).eq("token_hash", hashToken(token)).is("revoked_at", null).select("id");
    if (keyed?.length) return { token: demo, link: row(d), replaced: d.replaced };
  }
  return { token, link: row(d), replaced: d.replaced };
}

/* ---------- Demo copies: one person plays both sides ---------- */

// In a demo copy the judge is the landlord and the tenants at once, so the copy's own pages may open its tenants' page
// at any time ("Open the tenant's view"). Its link's token is derived from a server secret and the link's id instead of
// drawn at random: the database still holds only the hash, so a copy of the database opens nothing, and only the
// server, for the session whose copy it is, can make the token again. A real landlord's token is random and shown once.

/** The secret a demo copy's tenant tokens are derived from: the session secret, which only exists while the access
 *  gate is on. With the gate off every session is the owner's and no demo copy is ever opened, so there is no key and
 *  no demo token (a copy's links keep their random tokens). Never sent anywhere. */
function demoLinkKey(): string | null {
  const g = gate();
  return g.mode === "on" ? g.secret : null;
}

/** A demo copy's tenant token for one link: 32 bytes, base64url, like a random one. */
export function demoTenantToken(linkId: string): string | null {
  const key = demoLinkKey();
  return key ? createHmac("sha256", key).update(`gf-demo-tenant-link.${linkId}`).digest("base64url") : null;
}

/** Re-keys the live tenant links of freshly made demo copies to their demo tokens (createDemoCopy, right after the
 *  copy). The copy function gives each a random token nobody holds, so nothing that works stops working. Returns how
 *  many were re-keyed. */
export async function keyDemoTenantLinks(tenancyIds: string[]): Promise<number> {
  if (!tenancyIds.length || !demoLinkKey()) return 0;
  const { data } = await db.from("tenant_links").select("id").in("tenancy_id", tenancyIds).is("revoked_at", null);
  let n = 0;
  for (const l of data ?? []) {
    const token = demoTenantToken(l.id as string);
    if (!token) continue;
    const { data: done } = await db.from("tenant_links").update({ token_hash: hashToken(token) }).eq("id", l.id).is("revoked_at", null).select("id");
    n += done?.length ?? 0;
  }
  return n;
}

/** The tenants' page of a tenancy in a demo copy, when its live link carries the copy's demo token; null for the owner's
 *  workspace, for a tenancy of another workspace, and for a copy made before demo tokens. */
export async function demoTenantPath(ws: Workspace, tenancyId: string): Promise<string | null> {
  if (ws.kind !== "demo") return null;
  const { data } = await db.from("tenant_links").select("id, token_hash, tenancies!inner(workspace_id)").eq("tenancy_id", tenancyId)
    .eq("tenancies.workspace_id", ws.id).is("revoked_at", null).order("created_at", { ascending: false }).limit(1).maybeSingle();
  if (!data) return null;
  const token = demoTenantToken(data.id as string);
  return token && hashToken(token) === data.token_hash ? `/t/${token}` : null;
}

/** activeTenantLink and demoTenantPath in one read, for the tenancy page: the live link, and in a demo copy the
 *  tenants' page it opens. Only for a tenancy in this workspace (both null otherwise). */
export async function tenantLinkView(ws: Workspace, tenancyId: string): Promise<{ link: TenantLink | null; demoPath: string | null }> {
  const { data } = await db.from("tenant_links").select("id, created_at, last_seen_at, token_hash, tenancies!inner(workspace_id)").eq("tenancy_id", tenancyId)
    .eq("tenancies.workspace_id", ws.id).is("revoked_at", null).order("created_at", { ascending: false }).limit(1).maybeSingle();
  if (!data) return { link: null, demoPath: null };
  const token = ws.kind === "demo" ? demoTenantToken(data.id as string) : null;
  return { link: row(data as { id: string; created_at: string; last_seen_at: string | null }), demoPath: token && hashToken(token) === data.token_hash ? `/t/${token}` : null };
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

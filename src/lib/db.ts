import "server-only";
import { createClient } from "@supabase/supabase-js";

// Server-only Supabase client with the secret key. Row level security is on with no policies, so nothing but this
// server can read or write: no lease, photo or payment is reachable with a public key.
export const db = createClient(process.env.SUPABASE_URL!, process.env.SUPABASE_SECRET_KEY!, {
  auth: { persistSession: false, autoRefreshToken: false },
});

export type Actor = "agent" | "landlord" | "tenant" | "system";

/** Every action, by whom, with what. The agent never moves money without an entry here. */
export async function audit(tenancyId: string | null, actor: Actor, action: string, detail?: unknown) {
  const { error } = await db.from("audit_log").insert({ tenancy_id: tenancyId, actor, action, detail: detail ?? null });
  if (error) console.error("audit log write failed", error.message);
}

// Links handed out recently, reused while they have at least half their life left: the same photo then keeps the same
// address from one tab to the next, so the browser shows it from its cache instead of downloading it again, and no
// signing request is needed. A link is only ever given to a page that already lists that file. The cache is keyed by
// path alone and shared by every session, so pages call it through signedUrlsFor (src/lib/workspace.ts), which drops
// any path the session's workspace may not see before it gets here.
const SIGN_SECONDS = 3600;
const REUSE_MS = (SIGN_SECONDS / 2) * 1000;
const recentLinks = new Map<string, { url: string; until: number }>();

/** One-hour links to many private files, by path, in at most one request. A path that couldn't be signed maps to null. */
export async function signedUrls(bucket: "leases" | "photos" | "receipts", paths: string[]): Promise<Map<string, string | null>> {
  const now = Date.now();
  const out = new Map<string, string | null>();
  const missing: string[] = [];
  for (const p of new Set(paths.filter(Boolean))) {
    const hit = recentLinks.get(`${bucket}/${p}`);
    if (hit && hit.until - now > REUSE_MS) out.set(p, hit.url);
    else { out.set(p, null); missing.push(p); }
  }
  if (!missing.length) return out;
  const { data } = await db.storage.from(bucket).createSignedUrls(missing, SIGN_SECONDS);
  if (recentLinks.size > 5000) recentLinks.clear();
  for (const d of data ?? []) {
    if (!d.path || d.error || !d.signedUrl) continue;
    out.set(d.path, d.signedUrl);
    recentLinks.set(`${bucket}/${d.path}`, { url: d.signedUrl, until: now + SIGN_SECONDS * 1000 });
  }
  return out;
}

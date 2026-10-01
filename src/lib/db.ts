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

/** Short-lived link to a private file (leases and photos are in private buckets). */
export async function signedUrl(bucket: "leases" | "photos" | "receipts", path: string, seconds = 3600) {
  const { data } = await db.storage.from(bucket).createSignedUrl(path, seconds);
  return data?.signedUrl ?? null;
}

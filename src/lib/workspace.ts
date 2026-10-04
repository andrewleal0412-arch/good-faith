import "server-only";
import { createHmac } from "node:crypto";
import { notFound } from "next/navigation";
import { cache } from "react";
import { db, signedUrls } from "./db";
import { copyLimits } from "./limits";
import { ACCESS_MESSAGES, gate, type Session } from "./session";
import { currentSession } from "./session-server";
import { keyDemoTenantLinks } from "./tenant-links";

// Workspaces: the owner's data, and one private copy of the demo landlord per visitor who enters the access code
// (supabase/migrations/..._workspaces.sql). Properties and tenancies carry a workspace; everything else hangs off a
// tenancy. The server reads with the secret key, which bypasses row level security, so the scoping lives here: every
// list filters by the session's workspace, and every page and route that names a tenancy goes through pageTenancy or
// routeTenancy first, which answer 404 for a tenancy in another workspace exactly as for one that doesn't exist.

export type Workspace = { id: string; kind: "owner" | "demo"; label: string | null };

/** The account every demo copy shows: the demo landlord's business, without "LLC". */
export const DEMO_ACCOUNT = "Harbor View Rentals";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
export const isUuid = (s: unknown): s is string => typeof s === "string" && UUID.test(s);

let ownerId: string | null = null;

/** The one owner workspace, which holds everything made before workspaces existed. */
export async function ownerWorkspaceId(): Promise<string> {
  if (ownerId) return ownerId;
  const { data, error } = await db.from("workspaces").select("id").eq("kind", "owner").maybeSingle();
  if (error || !data) throw new Error(`No owner workspace (${error?.message ?? "run supabase/migrations in order"}).`);
  ownerId = data.id as string;
  return ownerId;
}

// Demo workspaces confirmed recently, so a page's several reads don't each ask whether the copy still exists, and
// last_seen_at written at most every ten minutes.
const SEEN_MS = 60_000;
const TOUCH_MS = 10 * 60_000;
const seen = new Map<string, { label: string | null; until: number; touched: number }>();

async function demoWorkspace(id: string): Promise<Workspace | null> {
  const now = Date.now();
  let hit = seen.get(id);
  if (!hit || hit.until <= now) {
    const { data } = await db.from("workspaces").select("id, kind, label").eq("id", id).maybeSingle();
    if (!data || data.kind !== "demo") {
      seen.delete(id);
      return null;
    }
    if (seen.size > 5000) seen.clear();
    hit = { label: (data.label as string | null) ?? null, until: now + SEEN_MS, touched: hit?.touched ?? 0 };
    seen.set(id, hit);
  }
  if (now - hit.touched > TOUCH_MS) {
    hit.touched = now;
    void db.from("workspaces").update({ last_seen_at: new Date(now).toISOString() }).eq("id", id).then(({ error }) => {
      if (error) console.error("workspace last_seen_at update failed", error.message);
    });
  }
  return { id, kind: "demo", label: hit.label };
}

/** The workspace a session sees: the owner's for the owner (and for local dev with the gate off), the browser's own
 *  copy for a demo session. Null when that copy is gone (swept), which the shell treats as signed out. */
export async function workspaceOf(s: Session): Promise<Workspace | null> {
  if (s.kind === "owner") return { id: await ownerWorkspaceId(), kind: "owner", label: null };
  return isUuid(s.ws) ? demoWorkspace(s.ws.toLowerCase()) : null;
}

/** The current request's workspace, read once per request. */
export const currentWorkspace = cache(async (): Promise<Workspace | null> => {
  const s = await currentSession();
  return s ? workspaceOf(s) : null;
});

/** True when the tenancy exists and belongs to this workspace. */
export async function inWorkspace(ws: Workspace, tenancyId: string): Promise<boolean> {
  if (!isUuid(tenancyId)) return false;
  const { data } = await db.from("tenancies").select("id").eq("id", tenancyId).eq("workspace_id", ws.id).maybeSingle();
  return !!data;
}

/** The session's workspace when the tenancy is in it, else null. For page metadata, which must not say anything about
 *  a tenancy in another workspace. */
export const ownedTenancy = cache(async (id: string): Promise<Workspace | null> => {
  const ws = await currentWorkspace();
  return ws && (await inWorkspace(ws, id)) ? ws : null;
});

/** For a page under /tenancy/[id]: the session's workspace when the tenancy is in it, otherwise the not-found page. */
export async function pageTenancy(id: string): Promise<Workspace> {
  const ws = await ownedTenancy(id);
  if (!ws) notFound();
  return ws;
}

/** The template tenancies every demo copy is made from are read only, in the owner's workspace too. */
export const TEMPLATE_READ_ONLY = "This property is the template every demo copy is made from, so it doesn't change. Make changes in a copy, or in a tenancy of your own.";

/** For a route that names a tenancy: the session's workspace when the tenancy is in it, otherwise the response to send
 *  instead (401 without a session; 404 for a tenancy that doesn't exist or is another workspace's, the same answer,
 *  so another copy's ids can't be told from made-up ones). Every id the route then reads (a photo, a deduction, a run,
 *  a payment) is looked up under this tenancy. With `write`, a template tenancy gets a 409: nothing writes to one. */
export async function routeTenancy(id: string, opts: { write?: boolean } = {}): Promise<Workspace | Response> {
  const ws = await currentWorkspace();
  if (!ws) return Response.json({ error: ACCESS_MESSAGES.signedOut }, { status: 401 });
  if (!(await inWorkspace(ws, id))) return Response.json({ error: "No such tenancy." }, { status: 404 });
  if (opts.write && (await isTemplate(id))) return Response.json({ error: TEMPLATE_READ_ONLY }, { status: 409 });
  return ws;
}

/** True for a template tenancy (demo_templates). */
export async function isTemplate(tenancyId: string): Promise<boolean> {
  return (await templateFiles()).ids.has(tenancyId.toLowerCase());
}

/* ---------- Stored files ---------- */

/** Where this workspace's uploads go in every bucket: leases, photos and receipts. */
export const uploadPrefix = (ws: Workspace) => `ws/${ws.id}/`;

// The template tenancies' own files (their photos, receipts and leases), which every demo copy points at and none may
// change. Read from demo_templates, which doesn't change while the app runs; kept ten minutes. A template seeded before
// workspaces keeps its files under <tenancy>/; one seeded since (the Texas unit) under its workspace's prefix,
// ws/<owner workspace>/<tenancy>/.
type TemplateFiles = { ids: Set<string>; folders: Set<string>; leases: Set<string> };
let templates: (TemplateFiles & { until: number }) | null = null;

export async function templateFiles(): Promise<TemplateFiles> {
  if (templates && templates.until > Date.now()) return templates;
  const { data } = await db.from("demo_templates").select("tenancy_id, tenancies(lease_pdf_path, workspace_id)");
  const rows = (data ?? []) as unknown as { tenancy_id: string; tenancies: { lease_pdf_path: string | null; workspace_id: string | null } | null }[];
  templates = {
    ids: new Set(rows.map((r) => r.tenancy_id)),
    folders: new Set(rows.flatMap((r) => [`${r.tenancy_id}/`, ...(r.tenancies?.workspace_id ? [`ws/${r.tenancies.workspace_id}/${r.tenancy_id}/`] : [])])),
    leases: new Set(rows.map((r) => r.tenancies?.lease_pdf_path).filter((x): x is string => !!x)),
    until: Date.now() + 10 * 60_000,
  };
  return templates;
}

const isTemplateFile = (t: TemplateFiles, path: string) => t.leases.has(path) || [...t.folders].some((f) => path.startsWith(f));

/** Whether a page in this workspace may get a link to a stored file: one this workspace uploaded (under its ws/<id>/
 *  prefix), one of the read-only template files every copy points at, or, for the owner, a file stored before
 *  workspaces existed (no ws/ prefix). Never one under another workspace's prefix, except a template's own folder. */
export async function maySign(ws: Workspace, path: string): Promise<boolean> {
  if (!path || path.includes("..")) return false;
  if (path.startsWith(uploadPrefix(ws))) return true;
  if (ws.kind === "owner" && !path.startsWith("ws/")) return true;
  return isTemplateFile(await templateFiles(), path);
}

/** One-hour links to stored files, for the paths this workspace may see; any other path maps to null. */
export async function signedUrlsFor(ws: Workspace, bucket: "leases" | "photos" | "receipts", paths: string[]): Promise<Map<string, string | null>> {
  const unique = [...new Set(paths.filter(Boolean))];
  const allowed = (await Promise.all(unique.map(async (p) => ((await maySign(ws, p)) ? p : null)))).filter((p): p is string => !!p);
  const out = new Map<string, string | null>(unique.map((p) => [p, null]));
  if (allowed.length) for (const [p, url] of await signedUrls(bucket, allowed)) out.set(p, url);
  return out;
}

/** Whether a route may remove a stored file of this tenancy: only one this workspace uploaded for it, or, for the
 *  owner, one stored under the tenancy's own folder before workspaces existed. Template files never, in either storage
 *  layout: a template seeded since workspaces (the Texas unit) keeps its files under the owner's own ws/ prefix, so
 *  the template check comes before every yes, not only the older layout's. */
export async function mayRemove(ws: Workspace, tenancyId: string, path: string | null | undefined): Promise<boolean> {
  if (!path || path.includes("..")) return false;
  const own = path.startsWith(`${uploadPrefix(ws)}${tenancyId}/`);
  const older = ws.kind === "owner" && path.startsWith(`${tenancyId}/`);
  if (!own && !older) return false;
  return !isTemplateFile(await templateFiles(), path);
}

/* ---------- Demo copies ---------- */

/** A caller's address as the copy limit counts it: a keyed hash, so no address is stored. */
function addressKey(address: string): string {
  const g = gate();
  const key = g.mode === "on" ? g.secret : "local-dev";
  return `ip:${createHmac("sha256", key).update(`gf-copy.${address}`).digest("hex").slice(0, 40)}`;
}

export type NewCopy = { ok: true; ws: string; pool: "claimed" | "empty" } | { ok: false; message: string; status: number };

/** A new private copy of the demo for one browser: today's copy allowance for its address and in total, then every
 *  template tenancy (the two California units and the Texas one) copied with its dates moved to today and, when the
 *  pool has one, a pre-paid sandbox deposit for the California move-out unit (one transaction in Postgres,
 *  create_demo_copy_with_history; the Texas unit never takes one). The closed unit's copy comes with its template's
 *  settled dispute as history (demo_template_history, scripts/demo-history.mjs), in the same transaction. Then the
 *  copies' tenant links are re-keyed to demo tokens, so "Open the tenant's view" works (tenant-links.ts). With
 *  `replace`, the browser's previous copy gives back a deposit it never used; its rows stay until the sweep
 *  (scripts/demo-sweep.mjs). */
export async function createDemoCopy(address: string, replace?: string): Promise<NewCopy> {
  const limits = copyLimits();
  const { data, error } = await db.rpc("create_demo_copy_with_history", {
    p_ip_key: addressKey(address),
    p_ip_limit: limits.perAddress,
    p_total_limit: limits.total,
    p_replace: replace && isUuid(replace) ? replace : null,
    p_label: DEMO_ACCOUNT,
  });
  if (error || !data) {
    console.error("demo copy failed", error?.message ?? "no answer");
    return { ok: false, message: ACCESS_MESSAGES.copyFailed, status: 503 };
  }
  const r = data as {
    allowed: boolean; reason?: string; workspace?: string; pool?: "claimed" | "empty"; released?: number; copies?: { role: string; tenancy: string }[];
    history?: number; history_expected?: number; history_failed?: { role: string; error: string }[];
  };
  if (!r.allowed || !r.workspace) {
    return r.reason === "global"
      ? { ok: false, message: ACCESS_MESSAGES.copiesTotal, status: 429 }
      : { ok: false, message: ACCESS_MESSAGES.copiesAddress, status: 429 };
  }
  if (r.pool === "empty") {
    console.warn(`demo copy ${r.workspace} was made without a sandbox deposit: the pool is empty, so its refund can't be sent (npm run demo:pool -- --fill N)`);
  }
  // A template's settled history that didn't go in leaves the copy working, without that dispute (the database rolls
  // back only the history); the stored row needs a look (npm run demo:history).
  const missed = (r.history_expected ?? 0) - (r.history ?? 0);
  if (missed > 0) {
    const why = r.history_failed?.length ? r.history_failed.map((f) => `${f.role}: ${f.error}`).join("; ") : "a charge it names isn't on the copy";
    console.warn(`demo copy ${r.workspace} was made without its settled history (${why}): check the stored row with npm run demo:history`);
  }
  // A link that keeps its random token still works as before; it just can't be opened from the copy's pages.
  await keyDemoTenantLinks((r.copies ?? []).map((c) => c.tenancy).filter(isUuid))
    .catch((e) => console.error(`demo copy ${r.workspace}: tenant links not re-keyed`, e));
  seen.set(r.workspace, { label: DEMO_ACCOUNT, until: Date.now() + SEEN_MS, touched: Date.now() });
  return { ok: true, ws: r.workspace, pool: r.pool ?? "empty" };
}

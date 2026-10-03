// Removes the hosted demo's old private copies: every demo workspace made more than 14 days ago (a session lasts 7, so
// nobody is still in one), with its rows (properties and tenancies, and through them photos, payments, deductions,
// the audit log, agent runs and tenant links) and its own uploads (everything under ws/<id>/ in the leases, photos and
// receipts buckets). Also removes upload folders whose workspace no longer exists. A dry run unless --apply.
//
//   npm run demo:sweep                    list what would be removed
//   npm run demo:sweep -- --apply         remove it
//   npm run demo:sweep -- --days 30       a different age (at least 8 days, longer than a session)
//   npm run demo:sweep -- --workspace <id> --apply   remove one demo copy now, whatever its age (a test copy)
//
// Never touched: the owner's workspace, any workspace holding a template tenancy, the templates' own files (a copy's
// photos, receipts and lease point at them; they are not under ws/), and the pool's unclaimed sandbox deposits. A
// deposit a removed copy claimed and never used goes back to the pool (release_demo_deposit); one it refunded stays
// marked as used. On Render this can run daily as a cron job (docs/DEPLOY.md).
import { dbClient, fail, loadEnv, ownerWorkspaceId, templateIds } from "./demo-common.mjs";

const BUCKETS = ["leases", "photos", "receipts"];
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;

const args = parseArgs(process.argv.slice(2));
const db = dbClient(loadEnv());

function parseArgs(argv) {
  const usage = "Usage: npm run demo:sweep -- [--apply] [--days N | --workspace <id>]";
  const a = { apply: false, days: 14, workspace: null };
  for (let i = 0; i < argv.length; i++) {
    const k = argv[i], v = argv[i + 1];
    if (k === "--apply") a.apply = true;
    else if (k === "--days") { a.days = Number(v); i++; }
    else if (k === "--workspace") { a.workspace = (v ?? "").toLowerCase(); i++; }
    else if (k === "--help" || k === "-h") { console.log(usage); process.exit(0); }
    else fail(`Unknown option ${k}. ${usage}`);
  }
  // A copy younger than a session (7 days) may still be open in someone's browser.
  if (!Number.isInteger(a.days) || a.days < 8) fail("--days needs a whole number of at least 8: a session lasts 7 days.");
  if (a.workspace !== null && !UUID.test(a.workspace)) fail("--workspace needs a demo workspace's id.");
  return a;
}

const [owner, templates] = await Promise.all([ownerWorkspaceId(db), templateIds(db)]);
const cutoff = new Date(Date.now() - args.days * 86_400_000).toISOString();

const pick = db.from("workspaces").select("id, kind, created_at, last_seen_at").eq("kind", "demo");
const { data: old, error } = await (args.workspace ? pick.eq("id", args.workspace) : pick.lt("created_at", cutoff)).order("created_at");
if (error) fail(`Couldn't read the workspaces: ${error.message}`);
const { data: live, error: e2 } = await db.from("workspaces").select("id");
if (e2) fail(`Couldn't read the workspaces: ${e2.message}`);
const exists = new Set((live ?? []).map((w) => w.id));

// Workspaces holding a template are never removed, whatever their age or kind.
const { data: holding } = await db.from("tenancies").select("workspace_id").in("id", [...templates.keys()]);
const protectedWs = new Set([owner, ...(holding ?? []).map((t) => t.workspace_id)]);
const targets = (old ?? []).filter((w) => w.kind === "demo" && UUID.test(w.id) && !protectedWs.has(w.id));

if (args.workspace && !targets.length) fail(`${args.workspace} is not a demo copy that can be removed (the owner's workspace and any workspace holding a template never are).`);
console.log(`${args.apply ? "Removing" : "Dry run:"} ${args.workspace ? `demo copy ${args.workspace}` : `demo copies made before ${cutoff.slice(0, 10)} (${args.days} days)`}`);
const totals = { workspaces: 0, tenancies: 0, files: 0, released: 0, orphanFiles: 0 };

for (const w of targets) {
  const { count } = await db.from("tenancies").select("id", { count: "exact", head: true }).eq("workspace_id", w.id);
  const files = {};
  for (const b of BUCKETS) files[b] = (await listAll(b, `ws/${w.id}`)).filter((p) => p.startsWith(`ws/${w.id}/`));
  const n = Object.values(files).reduce((s, xs) => s + xs.length, 0);
  console.log(`  ${w.id}  made ${w.created_at.slice(0, 10)}, last seen ${w.last_seen_at?.slice(0, 10) ?? "never"}: ${count ?? 0} tenancies, ${n} uploaded files`);
  totals.workspaces++; totals.tenancies += count ?? 0; totals.files += n;
  if (!args.apply) continue;

  // Its deposit back in the pool when it never used it; then its files, then its rows, then the workspace.
  const { data: released, error: re } = await db.rpc("release_demo_deposit", { p_ws: w.id });
  if (re) { console.error(`    couldn't check its sandbox deposit (${re.message}); skipped`); continue; }
  totals.released += released ?? 0;
  for (const b of BUCKETS) await remove(b, files[b]);
  const steps = [
    db.from("tenancies").delete().eq("workspace_id", w.id),
    db.from("properties").delete().eq("workspace_id", w.id),
  ];
  for (const step of steps) {
    const { error: de } = await step;
    if (de) fail(`Couldn't remove the rows of ${w.id}: ${de.message}. Run the sweep again.`);
  }
  const { error: we } = await db.from("workspaces").delete().eq("id", w.id).eq("kind", "demo");
  if (we) fail(`Couldn't remove workspace ${w.id}: ${we.message}. Run the sweep again.`);
}

// Upload folders whose workspace is gone (removed by an earlier sweep that stopped halfway, or by hand).
for (const b of args.workspace ? [] : BUCKETS) {
  const folders = await listFolders(b, "ws");
  for (const id of folders.filter((f) => UUID.test(f) && !exists.has(f) && !protectedWs.has(f))) {
    // Asked again right before anything goes: a copy made while the sweep ran (and already uploading) isn't in the
    // list read at the start, and its files must stay.
    const { data: now, error: ce } = await db.from("workspaces").select("id").eq("id", id).maybeSingle();
    if (ce || now) continue;
    const paths = (await listAll(b, `ws/${id}`)).filter((p) => p.startsWith(`ws/${id}/`));
    if (!paths.length) continue;
    console.log(`  ${b}/ws/${id}: ${paths.length} files with no workspace`);
    totals.orphanFiles += paths.length;
    if (args.apply) await remove(b, paths);
  }
}

console.log(`${args.apply ? "Removed" : "Would remove"} ${totals.workspaces} demo copies (${totals.tenancies} tenancies, ${totals.files} files) and ${totals.orphanFiles} files with no workspace.` +
  (args.apply ? ` ${totals.released} unused sandbox deposits went back to the pool.` : " Run with --apply to remove them."));

/** Every file under a folder, at any depth, as full paths. */
async function listAll(bucket, prefix) {
  const out = [];
  for (let offset = 0; ; offset += 1000) {
    const { data, error: le } = await db.storage.from(bucket).list(prefix, { limit: 1000, offset });
    if (le) { console.error(`  couldn't list ${bucket}/${prefix}: ${le.message}`); return out; }
    for (const o of data ?? []) {
      if (o.id) out.push(`${prefix}/${o.name}`);
      else out.push(...(await listAll(bucket, `${prefix}/${o.name}`)));
    }
    if ((data ?? []).length < 1000) return out;
  }
}

/** The folder names directly under a folder, a page of 1000 at a time. */
async function listFolders(bucket, prefix) {
  const out = [];
  for (let offset = 0; ; offset += 1000) {
    const { data, error: le } = await db.storage.from(bucket).list(prefix, { limit: 1000, offset });
    if (le) { console.error(`  couldn't list ${bucket}/${prefix}: ${le.message}`); return out; }
    out.push(...(data ?? []).filter((o) => !o.id).map((o) => o.name));
    if ((data ?? []).length < 1000) return out;
  }
}

/** Removes files in batches. Only paths under ws/ ever get here, never a template's own file. */
async function remove(bucket, paths) {
  const safe = paths.filter((p) => p.startsWith("ws/") && !templates.has(p.split("/")[0]));
  for (let i = 0; i < safe.length; i += 100) {
    const { error: re } = await db.storage.from(bucket).remove(safe.slice(i, i + 100));
    if (re) console.error(`  couldn't remove from ${bucket}: ${re.message}`);
  }
}

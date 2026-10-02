// Removes one tenancy made by demo:seed (or any throwaway one): its photos, receipts and lease PDF in storage, then
// the row, which cascades to payments, photos, deductions, audit_log, agent_runs and tenant_links, and the property
// when no other tenancy is on it. Refuses the original demo tenancy. PayPal sandbox records are left as they are.
//
//   npm run demo:reset -- <tenancyId>
import { ORIGINAL_DEMO_TENANCY, UUID, dbClient, fail, loadEnv } from "./demo-common.mjs";

// Postgres compares uuids without regard to case, but the guard below and the storage paths are plain strings, so the
// id is lowercased once and the guard, the path filter and the folder listings all see the same value.
const id = (process.argv[2] ?? "").toLowerCase();
if (!id || !UUID.test(id)) fail("Usage: npm run demo:reset -- <tenancyId>   (the UUID in the tenancy's URL)");
if (id === ORIGINAL_DEMO_TENANCY) fail("That is the original demo tenancy (482 N. Glassell St, Unit B, Orange). It stays.");

const db = dbClient(loadEnv());
const { data: t, error } = await db.from("tenancies").select("id, property_id, lease_pdf_path, properties(address)").eq("id", id).maybeSingle();
if (error) fail(`Couldn't read the tenancy: ${error.message}`);
if (!t) fail(`No tenancy ${id}. Nothing removed.`);
console.log(`Removing tenancy ${id} (${t.properties?.address ?? "address not recorded"})`);

// Storage paths from the rows, plus a listing of the tenancy's folders for anything the rows no longer point at.
const [{ data: photos }, { data: deductions }] = await Promise.all([
  db.from("photos").select("storage_path").eq("tenancy_id", id),
  db.from("deductions").select("receipt_path, after_photo_paths").eq("tenancy_id", id),
]);
const photoPaths = new Set((photos ?? []).map((p) => p.storage_path));
const receiptPaths = new Set();
for (const d of deductions ?? []) {
  for (const p of d.after_photo_paths ?? []) photoPaths.add(p);
  if (d.receipt_path) receiptPaths.add(d.receipt_path);
}
for (const phase of ["move_in", "move_out_before", "move_out_after"]) {
  for (const name of await listFiles("photos", `${id}/${phase}`)) photoPaths.add(`${id}/${phase}/${name}`);
}
for (const name of await listFiles("receipts", id)) receiptPaths.add(`${id}/${name}`);

// Only this tenancy's folders are touched; a path from a row that points elsewhere is left alone.
const own = (paths) => [...paths].filter((p) => p.startsWith(`${id}/`));
const removed = {
  photos: await remove("photos", own(photoPaths)),
  receipts: await remove("receipts", own(receiptPaths)),
  leases: 0,
};
// The lease PDF, unless another tenancy was started from the same upload.
if (t.lease_pdf_path) {
  const { count } = await db.from("tenancies").select("id", { count: "exact", head: true }).eq("lease_pdf_path", t.lease_pdf_path).neq("id", id);
  if (!count) removed.leases = await remove("leases", [t.lease_pdf_path]);
}

const rows = {};
for (const table of ["payments", "photos", "deductions", "audit_log", "agent_runs", "tenant_links"]) {
  const { count } = await db.from(table).select("id", { count: "exact", head: true }).eq("tenancy_id", id);
  rows[table] = count ?? 0;
}
const del = await db.from("tenancies").delete().eq("id", id);
if (del.error) fail(`Couldn't delete the tenancy: ${del.error.message}`);

// The property goes too when nothing else is on it.
let property = "kept (another tenancy is on it)";
if (t.property_id) {
  const { count } = await db.from("tenancies").select("id", { count: "exact", head: true }).eq("property_id", t.property_id);
  if (!count) {
    const p = await db.from("properties").delete().eq("id", t.property_id);
    property = p.error ? `not removed (${p.error.message})` : "removed";
  }
}

console.log(`  rows: tenancy 1, ${Object.entries(rows).map(([k, v]) => `${k} ${v}`).join(", ")}; property ${property}`);
console.log(`  storage: photos ${removed.photos}, receipts ${removed.receipts}, lease PDF ${removed.leases}`);
console.log("Done. PayPal sandbox invoices and payments for it are untouched.");

async function listFiles(bucket, prefix) {
  const { data, error } = await db.storage.from(bucket).list(prefix, { limit: 1000 });
  if (error) { console.error(`  couldn't list ${bucket}/${prefix}: ${error.message}`); return []; }
  return (data ?? []).filter((o) => o.id).map((o) => o.name); // folders come back without an id
}

async function remove(bucket, paths) {
  if (!paths.length) return 0;
  const { data, error } = await db.storage.from(bucket).remove(paths);
  if (error) { console.error(`  couldn't remove from ${bucket}: ${error.message}`); return 0; }
  return data?.length ?? 0;
}

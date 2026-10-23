// The move-out template's lease and receipts in storage, replaced with the renamed PDFs in demo/ (Luke Jones, Lane
// Forti, Teddy Buettner; see 2026-10-23-roommate-names.sql). Every demo copy points at these same files, so this changes
// what old copies show too. A file is replaced only while it still matches the PDF it replaces byte for byte (main's
// at 8279e30 going forward, this branch's with --revert), so a file someone changed since is left alone and named.
// Dry run by default: it prints what it would do. --apply writes.
//
//   node supabase/manual/2026-10-23-roommate-files.mjs [--revert] [--apply]
import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { ROOT, dbClient, fail, loadEnv } from "../../scripts/demo-common.mjs";

const apply = process.argv.includes("--apply");
const revert = process.argv.includes("--revert");
const OLD = "8279e30";
// [bucket, path, repo file]. The last lease is the same lease uploaded in one demo copy's own workspace.
const FILES = [
  ["leases", "10ee79b5-aac2-443e-8da2-7085323db777.pdf", "demo/lease-single-owner.pdf"],
  ["receipts", "e06de0e7-70e2-4c8a-bb6c-1db47531e5ee/0d47f0dc-efc4-4636-9fdc-1a8afc788e44.pdf", "demo/receipts/carpet_invoice.pdf"],
  ["receipts", "e06de0e7-70e2-4c8a-bb6c-1db47531e5ee/c8bd975b-3198-422e-84f3-60adc8349d40.pdf", "demo/receipts/handyman_invoice.pdf"],
  ["leases", "ws/9e2e6684-247d-4119-aaf1-3926c19c818f/45a12da1-a84f-4118-8f37-9061765a7fd9.pdf", "demo/lease-single-owner.pdf"],
];
const sha = (buf) => createHash("sha256").update(buf).digest("hex");
const atOld = (file) => execFileSync("git", ["-C", ROOT, "show", `${OLD}:${file}`], { maxBuffer: 32 << 20 });
const renamed = (file) => readFileSync(join(ROOT, file));

const db = dbClient(loadEnv());
let skipped = 0;
for (const [bucket, path, file] of FILES) {
  const [from, to] = revert ? [renamed(file), atOld(file)] : [atOld(file), renamed(file)];
  const { data, error } = await db.storage.from(bucket).download(path);
  if (error) fail(`Couldn't read ${bucket}/${path}: ${error.message}`);
  const now = Buffer.from(await data.arrayBuffer());
  if (sha(now) === sha(to)) { console.log(`already done  ${bucket}/${path}`); continue; }
  if (sha(now) !== sha(from)) { skipped++; console.log(`LEFT ALONE    ${bucket}/${path}: it is neither the old nor the new ${file}`); continue; }
  if (!apply) { console.log(`would replace ${bucket}/${path} with ${revert ? `${file} at ${OLD}` : file}`); continue; }
  const { error: upErr } = await db.storage.from(bucket).upload(path, to, { contentType: "application/pdf", upsert: true });
  if (upErr) fail(`Couldn't replace ${bucket}/${path}: ${upErr.message}`);
  console.log(`replaced      ${bucket}/${path}`);
}
if (!apply) console.log("Dry run. Nothing written. Run again with --apply to write.");
process.exit(skipped ? 1 : 0);

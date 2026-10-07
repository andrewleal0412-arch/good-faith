#!/usr/bin/env node
// The demo templates' photo thumbnails, made ahead and kept in the repo (data/template-thumbs), so the hosted demo
// serves the photos every demo copy shows without spending its small CPU on them (src/lib/thumbs.ts). Each is made by
// the app's own makeThumb from the photo in the private bucket. Read only on the database and storage: nothing is
// written there, the templates' folders least of all; only the files under data/template-thumbs change.
//
//   node scripts/template-thumbs.mjs           make them: every template photo's thumbnail and index.json (a file no
//                                              longer listed is removed)
//   node scripts/template-thumbs.mjs --check   compare with the bucket, writing nothing: every template photo listed,
//                                              made from the same bytes (the source's SHA-256), and its file there;
//                                              exit 1 otherwise (scripts/thumbs-check.mjs --db runs this)
//
// Run it again after a template's photos change (the templates are read only, so that is a deliberate act). A photo
// the index doesn't list is made on first request instead, as any other photo is, so a stale index costs CPU, never a
// wrong picture: a listed path's file is only ever the thumbnail of the bytes at that path when it was made.

import { createHash } from "node:crypto";
import { existsSync, mkdirSync, readdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { createJiti } from "jiti";
import { dbClient, fail, loadEnv, ROOT, templateIds } from "./demo-common.mjs";

const CHECK = process.argv.includes("--check");
const DIR = join(ROOT, "data", "template-thumbs");
const env = loadEnv();
for (const [k, v] of Object.entries(env)) if (!process.env[k]) process.env[k] = v;
const db = dbClient(env);
const jiti = createJiti(import.meta.url, { alias: { "@": join(ROOT, "src"), "server-only": join(ROOT, "node_modules/server-only/empty.js") } });
const { makeThumb, THUMB_PX } = await jiti.import(join(ROOT, "src/lib/thumbs.ts"));

const sha = (b) => createHash("sha256").update(b).digest("hex");
const fileFor = (path) => `${sha(path).slice(0, 24)}.webp`;

/** Every photo path a template shows: its photos, its findings' pairs and its deductions' after-repair photos. */
async function templatePaths() {
  const ids = [...(await templateIds(db)).keys()];
  const [{ data: photos, error: e1 }, { data: tenancies, error: e2 }, { data: deductions, error: e3 }] = await Promise.all([
    db.from("photos").select("storage_path").in("tenancy_id", ids),
    db.from("tenancies").select("move_out_findings").in("id", ids),
    db.from("deductions").select("after_photo_paths, finding").in("tenancy_id", ids),
  ]);
  const err = e1 ?? e2 ?? e3;
  if (err) fail(`Couldn't read the templates' photos: ${err.message}`);
  return [...new Set([
    ...(photos ?? []).map((p) => p.storage_path),
    ...(tenancies ?? []).flatMap((t) => (t.move_out_findings ?? []).flatMap((f) => [f.moveInPath, f.moveOutPath])),
    ...(deductions ?? []).flatMap((d) => [...(d.after_photo_paths ?? []), d.finding?.moveInPath, d.finding?.moveOutPath]),
  ].filter((p) => typeof p === "string" && p))].sort();
}

const paths = await templatePaths();
const index = existsSync(join(DIR, "index.json")) ? JSON.parse(readFileSync(join(DIR, "index.json"), "utf8")) : { entries: {} };
const entries = {};
let bad = 0;
for (const path of paths) {
  const { data, error } = await db.storage.from("photos").download(path);
  if (error || !data) {
    console.log(`  ${CHECK ? "FAIL" : "skip"} ${path}: not in the bucket (${error?.message ?? "no data"})`);
    bad += CHECK ? 1 : 0;
    continue;
  }
  const bytes = new Uint8Array(await data.arrayBuffer());
  const source = sha(bytes);
  const file = fileFor(path);
  if (CHECK) {
    const e = index.entries?.[path];
    const ok = e && e.file === file && e.source === source && existsSync(join(DIR, file));
    if (!ok) { bad++; console.log(`  FAIL ${path}: ${!e ? "not listed" : e.source !== source ? "made from other bytes" : "file missing"}`); }
    continue;
  }
  mkdirSync(DIR, { recursive: true });
  writeFileSync(join(DIR, file), await makeThumb(bytes));
  entries[path] = { file, source };
  console.log(`  ${path} -> ${file}`);
}
if (CHECK) {
  const extra = Object.keys(index.entries ?? {}).filter((p) => !paths.includes(p));
  for (const p of extra) console.log(`  note ${p}: listed, no longer a template photo (harmless; run the script to drop it)`);
  console.log(`template-thumbs --check: ${paths.length} template photos, ${bad} not matching`);
  process.exit(bad ? 1 : 0);
}
writeFileSync(join(DIR, "index.json"), `${JSON.stringify({ px: THUMB_PX, made: new Date().toISOString().slice(0, 10), entries }, null, 1)}\n`);
const keepFiles = new Set(["index.json", ...Object.values(entries).map((e) => e.file)]);
for (const f of readdirSync(DIR)) if (!keepFiles.has(f)) rmSync(join(DIR, f));
console.log(`made ${Object.keys(entries).length} template thumbnails in data/template-thumbs`);
process.exit(0);

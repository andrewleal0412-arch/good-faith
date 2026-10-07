#!/usr/bin/env node
// The photo thumbnails (src/lib/thumbs.ts, src/app/api/thumbs): the templates' thumbnails made ahead in
// data/template-thumbs are what the app would make (WebP, at most 480 px on the long side, one file per listed path,
// named from the path), nothing else is in the folder, and the module reads only that folder's listed files. With
// --db it also asks the bucket whether every template photo is listed and made from the bytes there
// (scripts/template-thumbs.mjs --check, read only). Offline by default: no database, no PayPal, no Claude.
//
//   node scripts/thumbs-check.mjs [--db]

import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { existsSync, readdirSync, readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const DIR = join(ROOT, "data", "template-thumbs");
const sharp = createRequire(join(ROOT, "package.json"))("sharp");

let pass = 0, fail = 0;
const failures = [];
function check(name, ok, detail = "") {
  if (ok) pass++;
  else { fail++; failures.push(`${name}${detail ? `: ${detail}` : ""}`); }
}

const src = readFileSync(join(ROOT, "src/lib/thumbs.ts"), "utf8");
const px = Number(src.match(/export const THUMB_PX = (\d+);/)?.[1]);
check("thumbs.ts names its size", px > 0);
check("thumbs.ts reads the templates' thumbnails from data/template-thumbs", /join\(process\.cwd\(\), "data", "template-thumbs"\)/.test(src));
check("thumbs.ts reads only a listed file named as the script names them", /\^\[0-9a-f\]\{24\}\\\.webp\$/.test(src));
check("thumbs.ts uses a file made ahead before anything else", /const ahead = given \? null : await madeAhead\(path\)/.test(src));

check("data/template-thumbs/index.json exists", existsSync(join(DIR, "index.json")));
const index = existsSync(join(DIR, "index.json")) ? JSON.parse(readFileSync(join(DIR, "index.json"), "utf8")) : { entries: {} };
check("the index is for this size", index.px === px, `index ${index.px}, thumbs.ts ${px}`);
const entries = Object.entries(index.entries ?? {});
check("the index lists the templates' photos", entries.length >= 20, `${entries.length} listed`);
const TEMPLATE_PATH = /^(?:[0-9a-f-]{36}|ws\/[0-9a-f-]{36}\/[0-9a-f-]{36})\/(move_in|move_out_before|move_out_after)\/[0-9a-f-]{36}\.(jpe?g|png|webp)$/;
for (const [path, e] of entries) {
  check(`a template photo's path: ${path}`, TEMPLATE_PATH.test(path));
  const want = `${createHash("sha256").update(path).digest("hex").slice(0, 24)}.webp`;
  check(`named from its path: ${path}`, e.file === want, `${e.file}, want ${want}`);
  check(`made from known bytes: ${path}`, /^[0-9a-f]{64}$/.test(e.source ?? ""));
  const f = join(DIR, e.file);
  if (!existsSync(f)) { check(`file there: ${e.file}`, false); continue; }
  const b = readFileSync(f);
  check(`WebP: ${e.file}`, b.subarray(0, 4).toString() === "RIFF" && b.subarray(8, 12).toString() === "WEBP");
  const m = await sharp(b).metadata();
  check(`at most ${px} px: ${e.file}`, m.format === "webp" && Math.max(m.width ?? 0, m.height ?? 0) <= px && Math.max(m.width ?? 0, m.height ?? 0) >= px / 2, `${m.width}x${m.height}`);
  check(`small: ${e.file}`, b.length < 40 * 1024, `${b.length} bytes`);
}
const listed = new Set(["index.json", ...entries.map(([, e]) => e.file)]);
for (const f of readdirSync(DIR)) check(`nothing unlisted in data/template-thumbs: ${f}`, listed.has(f));

if (process.argv.includes("--db")) {
  const r = spawnSync("node", [join(ROOT, "scripts/template-thumbs.mjs"), "--check"], { encoding: "utf8" });
  check("every template photo listed and made from the bytes in the bucket (template-thumbs --check)", r.status === 0, (r.stdout + r.stderr).trim().split("\n").slice(-6).join(" | "));
}

console.log(`thumbs-check: ${pass} passed, ${fail} failed`);
for (const f of failures) console.log(`  FAIL ${f}`);
process.exit(fail ? 1 : 0);

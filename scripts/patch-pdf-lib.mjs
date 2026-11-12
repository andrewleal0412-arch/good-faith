#!/usr/bin/env node
// Bound the work pdf-lib may do while it loads a PDF (docs/AUDIT.md, "Second security pass"). Loading a file decodes
// every object stream and cross-reference stream in it, and a filter chain of a few hundred bytes can inflate to
// hundreds of megabytes: a 199 KB receipt peaked at 513 MB in PDFDocument.load, on a host with 512 MB. The parse itself
// also grows with what the file claims: a cross-reference stream whose /W is [0 0 0] makes one reference per entry of
// its /Index without reading a byte, and an object stream of a few megabytes names hundreds of thousands of objects.
//
// So three places in pdf-lib call back to src/lib/pdf-guard.ts, which charges the load in progress and stops it past
// its limits: DecodeStream.ensureBuffer, where every filter (Flate, LZW, ASCII85, ASCIIHex, RunLength) grows its output
// whatever the filters, their order or how they are named; PDFRef.of, which every reference passes through (the
// cross-reference table and streams, object streams, every "n 0 R"); and PDFObjectParser.parseObject, once per number,
// name, string, array or dictionary read. PDFRef.of also keeps the references a load makes in that load's own map
// rather than pdf-lib's pool, which lives as long as the process: otherwise every file with new object numbers would add
// to it for good, refused or not. With no callback installed (a script that loads pdf-lib on its own) pdf-lib works as
// before, except that one stream may decode to 16 MB, no more.
//
// Run by npm after every install (package.json "postinstall"), on Render's build too. It patches both builds a bundler
// may pick (cjs and es), leaves a patched file as it is, and stops the install if pdf-lib's code no longer matches, so a
// pdf-lib upgrade can't quietly drop the limits. Each patched file also sets a flag, which pdf-guard.ts checks before it
// lets a PDF load.
//
//   node scripts/patch-pdf-lib.mjs [--check]

import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const MARK = "/* good-faith: load limits */";
const SITES = [
  {
    file: "core/streams/DecodeStream.js", flag: "decode",
    from: `        var buffer2 = new Uint8Array(size);
        buffer2.set(buffer);
        return (this.buffer = buffer2);`,
    to: `        ${MARK}
        var gfDecode = globalThis.__goodFaithPdfDecode;
        if (typeof gfDecode === "function") gfDecode(size, size - buffer.byteLength);
        else if (size > 16777216) throw new Error("A stream in this PDF decodes to more than 16 MB.");
        var buffer2 = new Uint8Array(size);
        buffer2.set(buffer);
        return (this.buffer = buffer2);`,
  },
  {
    file: "core/objects/PDFRef.js", flag: "ref",
    from: `    PDFRef.of = function (objectNumber, generationNumber) {
        if (generationNumber === void 0) { generationNumber = 0; }
        var tag = objectNumber + " " + generationNumber + " R";
        var instance = pool.get(tag);
        if (!instance) {
            instance = new PDFRef(ENFORCER, objectNumber, generationNumber);
            pool.set(tag, instance);
        }`,
    to: `    PDFRef.of = function (objectNumber, generationNumber) {
        ${MARK}
        var gfRefs = typeof globalThis.__goodFaithPdfWork === "function" ? globalThis.__goodFaithPdfWork() : undefined;
        var refs = gfRefs || pool;
        if (generationNumber === void 0) { generationNumber = 0; }
        var tag = objectNumber + " " + generationNumber + " R";
        var instance = refs.get(tag);
        if (!instance) {
            instance = new PDFRef(ENFORCER, objectNumber, generationNumber);
            refs.set(tag, instance);
        }`,
  },
  {
    file: "core/parser/PDFObjectParser.js", flag: "parse",
    from: `    PDFObjectParser.prototype.parseObject = function () {
        this.skipWhitespaceAndComments();`,
    to: `    PDFObjectParser.prototype.parseObject = function () {
        ${MARK}
        if (typeof globalThis.__goodFaithPdfWork === "function") globalThis.__goodFaithPdfWork();
        this.skipWhitespaceAndComments();`,
  },
];

const check = process.argv.includes("--check");
let bad = 0;
for (const build of ["cjs", "es"]) {
  for (const site of SITES) {
    const name = `${build}/${site.file}`;
    const file = join(ROOT, "node_modules/pdf-lib", build, site.file);
    if (!existsSync(file)) { console.error(`patch-pdf-lib: ${name} is missing`); bad++; continue; }
    let code = readFileSync(file, "utf8");
    if (code.includes(MARK)) { console.log(`patch-pdf-lib: ${name} already patched`); continue; }
    if (check) { console.error(`patch-pdf-lib: ${name} is not patched`); bad++; continue; }
    if (code.split(site.from).length !== 2) { console.error(`patch-pdf-lib: ${name} doesn't match; pdf-lib changed, so check the limits by hand`); bad++; continue; }
    code = code.replace(site.from, site.to);
    // The flag goes after the file's own header ("use strict" and the cjs exports line stay first).
    const flag = `${MARK} (globalThis.__goodFaithPdfPatched = globalThis.__goodFaithPdfPatched || {}).${site.flag} = true;\n`;
    const at = build === "cjs" ? code.indexOf("\n", code.indexOf("Object.defineProperty(exports")) + 1 : 0;
    code = code.slice(0, at) + flag + code.slice(at);
    writeFileSync(file, code);
    console.log(`patch-pdf-lib: ${name} patched`);
  }
}
process.exit(bad ? 1 : 0);

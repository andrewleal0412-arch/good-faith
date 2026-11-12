#!/usr/bin/env node
// What a visitor poking at the hosted demo could do to the server, from the 2026-11-10 review (docs/AUDIT.md,
// "Security pass"): no one request may freeze it or run it out of memory, no reply may carry an internal error, and
// the small edges the review found stay closed. Offline: no database, no PayPal, no Claude.
//
//   node scripts/security-check.mjs

import { spawnSync } from "node:child_process";
import { readdirSync, readFileSync, statSync } from "node:fs";
import { createRequire } from "node:module";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { setFlagsFromString } from "node:v8";
import { runInNewContext } from "node:vm";
import { crc32, deflateSync } from "node:zlib";
import { createJiti } from "jiti";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const jiti = createJiti(import.meta.url, { alias: { "@": join(ROOT, "src"), "server-only": join(ROOT, "node_modules/server-only/empty.js") } });
const lib = (n) => jiti.import(join(ROOT, "src/lib", `${n}.ts`));
const src = (p) => readFileSync(join(ROOT, p), "utf8");

let pass = 0, fail = 0;
const failures = [];
function check(name, ok, detail = "") {
  if (ok) pass++;
  else { fail++; failures.push(`${name}${detail ? `: ${detail}` : ""}`); }
}
const ms = async (f) => { const t = performance.now(); const v = await f(); return [v, performance.now() - t]; };

/* ---------- Request bodies: read with a size cap before anything parses them ---------- */
{
  const body = await lib("body");
  const post = (b) => new Request("http://local/x", { method: "POST", body: b });
  const [big, bigMs] = await ms(() => body.readJson(post("[" + "1,".repeat(2_250_000) + "1]"), 64_000));
  check("readJson: a 4.5 MB body is refused, not parsed", big === null, JSON.stringify(big)?.slice(0, 40));
  check("readJson: and refused quickly", bigMs < 500, `${bigMs.toFixed(0)} ms`);
  const ok = await body.readJson(post(JSON.stringify({ a: 1 })), 64_000);
  check("readJson: a small body is read", ok?.a === 1, JSON.stringify(ok));
  check("readJson: a malformed body is null", (await body.readJson(post("{nope"), 64_000)) === null);
  check("readJson: an empty body is null", (await body.readJson(post(""), 64_000)) === null);

  check("isEmail: a plain address passes", body.isEmail("tenant@example.com"));
  check("isEmail: a non-string fails", !body.isEmail(42) && !body.isEmail(null) && !body.isEmail(["a@b.co"]));
  const [slow, slowMs] = await ms(() => body.isEmail("x@" + ".".repeat(4_000_000) + " "));
  check("isEmail: the 4 MB backtracking string is refused quickly", slow === false && slowMs < 50, `${slow}, ${slowMs.toFixed(0)} ms`);
  check("isEmail: longer than 254 characters fails", !body.isEmail("a".repeat(250) + "@b.co"));

  const names = body.stringList(["Luke Jones", "Lane Forti"], 20, 200);
  check("stringList: a list of names is read", JSON.stringify(names) === '["Luke Jones","Lane Forti"]', JSON.stringify(names));
  check("stringList: one string naming everyone is not a list", body.stringList("Luke Jones and Lane Forti", 20, 200) === null);
  check("stringList: too many entries is not a list", body.stringList(Array(21).fill("a"), 20, 200) === null);
  check("stringList: an entry too long is not a list", body.stringList(["a".repeat(201)], 20, 200) === null);
  check("stringList: a non-string entry is not a list", body.stringList(["a", 1], 20, 200) === null);

  const agreement = src("src/app/api/tenancies/[id]/agreement/route.ts");
  check("the agreement route reads its body with readJson", /readJson\(req, /.test(agreement) && !/req\.json\(\)/.test(agreement));
  check("the agreement route checks the email with isEmail", /isEmail\(/.test(agreement) && !/\[\^@\\s\]\+@/.test(agreement));
  check("the agreement route reads the signers as a capped list", /stringList\(/.test(agreement));
  const tenancies = src("src/app/api/tenancies/route.ts");
  check("starting a tenancy reads its body with readJson before zod", /bodySchema\.safeParse\(await readJson\(req, /.test(tenancies) && !/req\.json\(\)/.test(tenancies));

  // The tenant link's JSON routes held a whole 4.5 MB body across their database calls (96 MB of heap for one of
  // `{}`s; about five at once reach the host's 512 MB). Their honest bodies are a name, a date, an address of at most
  // 240 characters or a message cut at 600.
  for (const r of ["moving-out", "dispute/offer", "dispute/accept", "dispute/withdraw", "dispute/send"]) {
    const t = src(`src/app/api/t/[token]/${r}/route.ts`);
    check(`the tenant route ${r} reads its body with readJson(req, 16_000)`, /readJson\(req, 16_000\)/.test(t) && !/req\.json\(\)/.test(t));
  }
  const [cut, cutMs] = await ms(() => body.readJson(post(JSON.stringify({ name: "Luke Jones", message: "x".repeat(16_001) })), 16_000));
  check("readJson: a body just over 16 KB is refused quickly", cut === null && cutMs < 50, `${JSON.stringify(cut)?.slice(0, 40)}, ${cutMs.toFixed(0)} ms`);
}

/* ---------- Photos: a small file that decodes to a huge image is refused ---------- */
{
  const images = await lib("images");
  const { MAX_PIXELS } = await lib("uploads");
  const chunk = (type, data) => {
    const len = Buffer.alloc(4); len.writeUInt32BE(data.length);
    const td = Buffer.concat([Buffer.from(type, "ascii"), data]);
    const crc = Buffer.alloc(4); crc.writeUInt32BE(crc32(td));
    return Buffer.concat([len, td, crc]);
  };
  const png = (w, h) => {
    const ihdr = Buffer.alloc(13); ihdr.writeUInt32BE(w, 0); ihdr.writeUInt32BE(h, 4); ihdr[8] = 8; ihdr[9] = 2;
    const row = Buffer.alloc(1 + 3 * Math.min(w, 64));
    return new Uint8Array(Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), chunk("IHDR", ihdr), chunk("IDAT", deflateSync(row)), chunk("IEND", Buffer.alloc(0))]));
  };
  check("images: the pixel limit is 16 million", MAX_PIXELS === 16_000_000, String(MAX_PIXELS));
  check("images: a 16000 x 16000 PNG of a few hundred bytes is refused", (await images.imageType(png(16000, 16000))) === null);
  check("images: 8000 x 5001 is refused", (await images.imageType(png(8000, 5001))) === null);
  check("images: 4001 x 4000 is refused", (await images.imageType(png(4001, 4000))) === null);
  check("images: a 4032 x 3024 phone-sized PNG header is accepted", (await images.imageType(png(4032, 3024))) === "image/png");
  check("images: a 64 x 64 PNG is accepted", (await images.imageType(png(64, 64))) === "image/png");

  // Pixels alone don't bound the memory a decode takes: a 1.7 MB 6300 x 6300 PNG at 16 bits a channel, interlaced,
  // peaked at 638 MB in one decode (the host has 512 MB). So a PNG or GIF must be 8 bits a channel and not interlaced.
  // The fixtures are made here, small, so no large file is kept in the repo.
  const sharp = createRequire(join(ROOT, "package.json"))("sharp");
  const flat = () => sharp({ create: { width: 64, height: 64, channels: 3, background: { r: 200, g: 120, b: 60 } } });
  const made = async (f) => new Uint8Array(await f.toBuffer());
  check("images: a 16-bit PNG is refused", (await images.imageType(await made(flat().toColourspace("rgb16").png()))) === null);
  check("images: an interlaced PNG is refused", (await images.imageType(await made(flat().png({ progressive: true })))) === null);
  check("images: a 16-bit interlaced PNG is refused", (await images.imageType(await made(flat().toColourspace("rgb16").png({ progressive: true })))) === null);
  check("images: an interlaced GIF is refused", (await images.imageType(await made(flat().gif({ progressive: true })))) === null);
  check("images: a plain 8-bit PNG is accepted", (await images.imageType(await made(flat().png()))) === "image/png");
  check("images: a plain GIF is accepted", (await images.imageType(await made(flat().gif()))) === "image/gif");
  check("images: a progressive JPEG (as some cameras save) is accepted", (await images.imageType(await made(flat().jpeg({ progressive: true })))) === "image/jpeg");

  // The tenant link's own photo routes decode a stored file on every request, so a file stored before the upload
  // check refused these shapes is checked again before it is decoded; a refused one goes out as stored.
  for (const p of ["src/app/api/t/[token]/dispute/evidence/[evidenceId]/route.ts", "src/app/api/t/[token]/photos/[photoId]/route.ts"]) {
    check(`a stored photo is checked before it is decoded: ${p}`, /if \(await imageType\(original\)\) try \{/.test(src(p)));
  }
  check("a stored photo is checked before its thumbnail is made", /if \(!given && !\(await imageType\(original\)\)\) throw /.test(src("src/lib/thumbs.ts")));

  // Every place the server opens a stored image does it with the same limit, so a file stored before the upload
  // check (or put in the bucket by hand) still can't take the server's memory.
  const files = [];
  const walk = (d) => { for (const n of readdirSync(d)) { const p = join(d, n); if (statSync(p).isDirectory()) walk(p); else if (/\.tsx?$/.test(n)) files.push(p); } };
  walk(join(ROOT, "src"));
  // The arguments are read to their matching parenthesis, so a call like sharp(new Uint8Array(await x())) counts too.
  const args = (text, open) => { let depth = 0; for (let i = open; i < text.length; i++) { if (text[i] === "(") depth++; else if (text[i] === ")" && --depth === 0) return text.slice(open + 1, i); } return ""; };
  let calls = 0;
  for (const f of files) {
    const text = readFileSync(f, "utf8");
    for (const m of text.matchAll(/\bsharp\(/g)) {
      calls++;
      const a = args(text, m.index + m[0].length - 1);
      check(`sharp() opens with the pixel limit: ${f.slice(ROOT.length + 1)}: ${a.slice(0, 60)}`, /limitInputPixels: MAX_PIXELS/.test(a));
    }
  }
  check("images: the sharp() calls were found", calls >= 10, `${calls} calls`);
}

/* ---------- Statement packets: at most two built at once ---------- */
{
  const { slots } = await lib("slots");
  const run = slots(2, 3);
  let now = 0, most = 0;
  const job = () => run(async () => { now++; most = Math.max(most, now); await new Promise((r) => setTimeout(r, 20)); now--; return "built"; });
  const got = await Promise.all(Array.from({ length: 7 }, job));
  check("slots: never more than two at once", most === 2, `${most} at once`);
  check("slots: two run, three wait their turn, the rest are refused", got.filter((g) => g === "built").length === 5 && got.filter((g) => g === null).length === 2, JSON.stringify(got));
  const again = await job();
  check("slots: a slot frees up once the jobs finish", again === "built" && now === 0, JSON.stringify(again));
  const failing = slots(1, 1);
  await failing(async () => { throw new Error("x"); }).catch(() => {});
  check("slots: a job that throws gives its slot back", (await failing(async () => "ok")) === "ok");
  for (const p of ["src/app/api/tenancies/[id]/statement/pdf/route.ts", "src/app/api/t/[token]/statement.pdf/route.ts"]) {
    check(`the packet is built in a slot: ${p}`, /packetSlot\(\(\) => buildStatementPdf\(/.test(src(p)));
  }
}

/* ---------- Receipt PDFs: a small file can't make pdf-lib take the server's memory ---------- */
{
  // Loading a PDF decodes its object and cross-reference streams and reads every object they name. Before the limits
  // a 199 KB receipt (one Flate stream of 200 MB of zeros) peaked at 526 MB, one with two Flate filters at 1.1 GB from
  // 1 KB, a 462-byte cross-reference stream with /W [0 0 0] ran a 1.2 GB heap out, and every load of a file with new
  // object numbers added to pdf-lib's pool for good (22 MB a load). The fixtures are made here, small.
  const pdf = (objs) => {
    const parts = [Buffer.from("%PDF-1.5\n", "latin1")];
    const offs = [];
    let pos = parts[0].length;
    for (const b of [
      "1 0 obj\n<< /Type /Catalog /Pages 2 0 R >>\nendobj\n",
      "2 0 obj\n<< /Type /Pages /Kids [3 0 R] /Count 1 >>\nendobj\n",
      "3 0 obj\n<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] >>\nendobj\n",
    ].map((s) => Buffer.from(s, "latin1")).concat(objs)) { offs.push(pos); parts.push(b); pos += b.length; }
    const xref = `xref\n0 ${offs.length + 1}\n0000000000 65535 f \n${offs.map((o) => `${String(o).padStart(10, "0")} 00000 n \n`).join("")}`;
    parts.push(Buffer.from(`${xref}trailer\n<< /Size ${offs.length + 1} /Root 1 0 R >>\nstartxref\n${pos}\n%%EOF\n`, "latin1"));
    return new Uint8Array(Buffer.concat(parts));
  };
  const stream = (n, dict, data) => Buffer.concat([Buffer.from(`${n} 0 obj\n<< ${dict} /Length ${data.length} >>\nstream\n`, "latin1"), data, Buffer.from("\nendstream\nendobj\n", "latin1")]);
  const objStm = (n, decoded, filters = 1, count = 1, first = 6) => {
    let d = decoded;
    for (let i = 0; i < filters; i++) d = deflateSync(d);
    return stream(n, `/Type /ObjStm /N ${count} /First ${first} /Filter [${" /FlateDecode".repeat(filters)} ]`, d);
  };
  const zeros = (mb, n) => Buffer.concat([Buffer.from(`${n} 0 0 `), Buffer.alloc(mb * 1048576)]);
  const xrefZero = (start) => pdf([stream(4, `/Type /XRef /W [0 0 0] /Index [${start} 150000] /Size ${start + 150000}`, Buffer.alloc(0))]);
  const flood = (count) => {
    const head = Buffer.from(Array.from({ length: count }, (_, i) => `${1000 + i} 0`).join(" ") + " ", "latin1");
    return pdf([objStm(4, Buffer.concat([head, Buffer.from("0 ")]), 1, count, head.length)]);
  };

  // pdf-lib warns as it reads past an object it couldn't parse, which each refused file here does once or twice.
  const warn = console.warn;
  console.warn = () => {};
  check("pdf-lib is patched in both builds (npm's postinstall)", spawnSync(process.execPath, [join(ROOT, "scripts/patch-pdf-lib.mjs"), "--check"]).status === 0);
  check("package.json patches pdf-lib after every install", JSON.parse(src("package.json")).scripts?.postinstall === "node scripts/patch-pdf-lib.mjs");
  const guard = await lib("pdf-guard").catch(() => null);
  check("pdf-guard loads", !!guard);
  if (guard) {
    check("pdf-guard sees the patched pdf-lib", guard.loadLimited());
    const refused = async (name, bytes, why) => {
      const [r, took] = await ms(() => guard.loadPdf(bytes).then(() => "loaded", (e) => e));
      check(`receipt PDF: ${name} is refused`, r instanceof guard.PdfTooBig && why.test(r.message), r?.message ?? r);
      check(`receipt PDF: ${name} is refused quickly`, took < 2500, `${took.toFixed(0)} ms`);
    };
    await refused("one Flate stream of 64 MB (64 KB)", pdf([objStm(4, zeros(64, 5))]), /decodes to more than 4 MB/);
    await refused("two Flate filters, 256 MB (1 KB)", pdf([objStm(4, zeros(256, 5), 2)]), /decodes to more than 4 MB/);
    await refused("three streams of 3.5 MB each", pdf([0, 1, 2].map((i) => objStm(4 + i, Buffer.concat([Buffer.from(`${10 + i} 0 0 `), Buffer.alloc(3.5 * 1048576)])))), /decodes to more than 8 MB/);
    await refused("a cross-reference stream with /W [0 0 0] and 20 million entries (462 bytes)", pdf([stream(4, "/Type /XRef /W [0 0 0] /Index [0 20000000] /Size 20000000", Buffer.alloc(0))]), /more in it than a receipt/);
    await refused("an object stream naming 350,000 objects", flood(350_000), /more in it than a receipt/);
    await refused("a 3.8 MB array of zeros", pdf([Buffer.from(`4 0 obj\n[${"0 ".repeat(1_900_000)}]\nendobj\n`, "latin1")]), /more in it than a receipt/);
    await refused("25,000 objects", pdf([Buffer.from(Array.from({ length: 25_000 }, (_, i) => `${4 + i} 0 obj 0 endobj\n`).join(""), "latin1")]), /more than 20,000 objects/);

    // References a load makes go with its document: 150,000 entries with new numbers each time, loaded six times.
    setFlagsFromString("--expose-gc");
    const gc = runInNewContext("gc");
    const heap = () => { gc(); gc(); return process.memoryUsage().heapUsed / 1048576; };
    const before = heap();
    for (let i = 1; i <= 6; i++) await guard.loadPdf(xrefZero(i * 1_000_000)).catch(() => null);
    const grew = heap() - before;
    check("receipt PDF: loads don't add to pdf-lib's pool for good", grew < 10, `${grew.toFixed(1)} MB kept after 6 loads`);

    const { PDFDocument } = createRequire(join(ROOT, "package.json"))("pdf-lib");
    const out = await PDFDocument.create();
    let copied = 0;
    for (const f of ["demo/receipts/carpet_invoice.pdf", "demo/receipts/handyman_invoice.pdf", "demo/lease-texas.pdf"]) {
      const doc = await guard.loadPdf(new Uint8Array(readFileSync(join(ROOT, f)))).catch(() => null);
      if (doc) for (const p of await out.copyPages(doc, doc.getPageIndices())) { out.addPage(p); copied++; }
    }
    const back = await PDFDocument.load(await out.save());
    check("receipt PDF: the demo's invoices and a lease still load and copy into a packet", copied === 4 && back.getPageCount() === 4, `${copied} pages copied`);
  }
  console.warn = warn;

  const statement = src("src/lib/statement-pdf.ts");
  check("the packet loads each invoice with loadPdf", /await loadPdf\(f\.bytes\)/.test(statement) && !/PDFDocument\.load\(/.test(statement));
  check("the chargeback evidence builds its packet in the slot", /m\.packetSlot\(\(\) => m\.buildStatementPdf\(st\)\)/.test(src("src/lib/chargeback-store.ts")));
  const deductions = src("src/app/api/tenancies/[id]/deductions/route.ts");
  check("a PDF receipt is loaded with loadPdf before it is stored", /await loadPdf\(receiptBytes\)/.test(deductions));
  const loads = [];
  const walk = (d) => { for (const n of readdirSync(d)) { const p = join(d, n); if (statSync(p).isDirectory()) walk(p); else if (/\.tsx?$/.test(n) && !p.endsWith("pdf-guard.ts") && /PDFDocument\.load\(/.test(readFileSync(p, "utf8"))) loads.push(p.slice(ROOT.length + 1)); } };
  walk(join(ROOT, "src"));
  check("no other code loads a PDF without the limits", loads.length === 0, loads.join(", "));
}

/* ---------- The landlord's own copy can't be turned against its tenants ---------- */
{
  // Once the statement is out its lines can't be added or removed (PATCH already holds each to its delivered amount).
  // The law's removal of every line (New York after day 14, Florida once the claim notice's time ran out) still goes.
  const out = src("src/lib/disputes.ts").match(/export async function statementOut[\s\S]*?\n}\n/)?.[0] ?? "";
  check("statementOut reads the delivery as PATCH does", /statement_delivered_at/.test(out) && /statement_delivery/.test(out) && /status: 409/.test(out));
  const add = src("src/app/api/tenancies/[id]/deductions/route.ts");
  const post = add.slice(add.indexOf("export async function POST"), add.indexOf("export async function DELETE"));
  const bulk = add.slice(add.indexOf("export async function DELETE"));
  check("adding a deduction is refused once the statement is out", /const out = await statementOut\(id\);\s*if \(out\) return out;/.test(post));
  check("the law's removal of every line still goes after the statement", !/statementOut\(/.test(bulk));
  const one = src("src/app/api/tenancies/[id]/deductions/[did]/route.ts");
  const del = one.slice(one.indexOf("export async function DELETE"), one.indexOf("export async function PATCH"));
  check("removing one deduction is refused once the statement is out", /const out = await statementOut\(id\);\s*if \(out\) return out;/.test(del));
}

/* ---------- Replies carry no internal error text ---------- */
{
  const agent = src("src/lib/agent.ts");
  const runCatch = agent.match(/console\.error\("close-out run failed", e\);[\s\S]{0,400}/)?.[0] ?? "";
  check("a failed close-out run stores a plain sentence, not the error's message", runCatch.length > 0 && !/e\.message/.test(runCatch), runCatch.slice(0, 200));
  const pdf = src("src/app/api/tenancies/[id]/statement/pdf/route.ts");
  check("the packet route answers a failure with a plain sentence", !/e\.message/.test(pdf));
  const advocate = src("src/app/api/t/[token]/dispute/advocate/route.ts");
  // `\be` so a database error that is only logged (`ce.message`) doesn't count.
  check("a failed advocate run keeps no error message for the tenants' page", !/\be\.message/.test(advocate) && /release\([^)]*"The advocate didn't finish\."\)/.test(advocate));
}

/* ---------- Sign-in ---------- */
{
  const { safeNext } = await lib("session");
  check("safeNext: a path outside plain ASCII goes home (it can't be a Location header)", safeNext("/中") === "/" && safeNext("/a b") === "/" && safeNext("/a\u007f") === "/");
  check("safeNext: a normal path with a query is kept", safeNext("/tenancy/abc?tab=move-out") === "/tenancy/abc?tab=move-out");
  check("safeNext: another site is still refused", safeNext("//example.com") === "/" && safeNext("/\\example.com") === "/");
  // Wrong codes from many addresses: once more than 5000 were live in the window, every wrong code scanned the whole
  // map again (one IPv6 /64 holds that many). Now the map is pruned at most once a minute, and still pruned.
  const throttle = await lib("access-throttle");
  const T = 1_000_000_000_000;
  for (let i = 0; i < 6000; i++) throttle.recordWrong(`fill-${i}`, T + i);
  const [, scanMs] = await ms(() => { for (let i = 0; i < 3000; i++) throttle.recordWrong(`more-${i}`, T + 6000 + i); });
  check("throttle: 3000 wrong codes with 6000 addresses live don't each scan the map", scanMs < 150, `${scanMs.toFixed(0)} ms`);
  throttle.recordWrong("later", T + throttle.WINDOW_MS + 61_000);
  check("throttle: expired addresses are still dropped from the map", throttle.tracked?.() === 1, String(throttle.tracked?.()));
  check("throttle: an address with 10 wrong codes is still held", (() => { for (let i = 0; i < 10; i++) throttle.recordWrong("held", T + 700_000 + i); return throttle.throttled("held", T + 700_010); })());

  const access = src("src/app/api/access/route.ts");
  check("the judges' code entered again keeps this browser's copy and its session", /const prior = await currentSession\(\);/.test(access) && /sid = prior\.sid/.test(access) && /issueSession\(kind, g\.secret, \{ ws, sid \}\)/.test(access));
}

/* ---------- Calendar ---------- */
{
  const { buildIcs } = await lib("ics");
  const out = buildIcs([{ kind: "move_out", uid: "u1", date: "2026-11-30", label: "Move-out", summary: "Move-out\rBEGIN:VEVENT", description: "a\rb" }], { name: "Unit\rX-INJECTED:1" });
  check("ics: a lone carriage return is escaped like a newline", !out.replace(/\r\n/g, "").includes("\r"), JSON.stringify(out.slice(0, 120)));
  check("ics: no injected line", !/^X-INJECTED/m.test(out) && (out.match(/^BEGIN:VEVENT/gm) ?? []).length === 1);
}

console.log(`${pass} passed, ${fail} failed`);
for (const f of failures) console.log(`  FAIL ${f}`);
process.exit(fail || failures.length ? 1 : 0);

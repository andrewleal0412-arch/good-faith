#!/usr/bin/env node
// What a visitor poking at the hosted demo could do to the server, from the 2026-11-10 review (docs/AUDIT.md,
// "Security pass"): no one request may freeze it or run it out of memory, no reply may carry an internal error, and
// the small edges the review found stay closed. Offline: no database, no PayPal, no Claude.
//
//   node scripts/security-check.mjs

import { readdirSync, readFileSync, statSync } from "node:fs";
import { createRequire } from "node:module";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
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

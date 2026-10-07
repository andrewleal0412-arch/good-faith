#!/usr/bin/env node
// Two workspaces never see each other's data through a cache, and a page shows a change the moment it is made.
//
// Offline (always): the code keeps nothing between requests that one workspace could read from another. No Next.js
// data or page cache is used anywhere ("use cache", unstable_cache, fetch caching, revalidate, staleTimes, Cache
// Components, Partial Prefetching); every landlord, flow and tenant page renders per request (force-dynamic); React's
// cache() is per request by design; and every value a server module keeps between requests is on the list below, with
// the reason it can't carry one workspace's data to another. A new one fails the check until it is reviewed and listed.
//
// Live (--live <base>): against a running production build (next start) whose GOOD_FAITH_SESSION_SECRET is also set
// in this shell. Makes two throwaway demo copies, A and B (the three template units each, no pool deposit, so nothing
// can be refunded), and a signed session for each, then:
//   1. requests every landlord page and its RSC payload, each tenancy tab, statement, notice and refund review, for A
//      and B at once, interleaved over several rounds: no response for one copy names the other's workspace or any of
//      its tenancies, payments, photos or deductions, and each names its own;
//   2. asks for B's tenancies with A's session: 404, as for an id that doesn't exist;
//   3. changes one of A's deductions (its useful life, through the app's own edit route) and reads A's property page,
//      Payments and Properties right after: the new amount is there at once, and B's copy still shows the old one;
//      then puts it back and checks again;
//   4. in a real browser, on A's move-out unit (scripts/tabs-check.py): tab switches ask the server nothing and add no
//      history entry, and after a change on Move-out every way back to it (another tab, Payments then Back, Back to
//      Properties then Forward) shows the new figures, the grid agreeing with the facts above it.
// Both copies are removed at the end (npm run demo:sweep -- --workspace <id> --apply), also after a failure.
//
//   node scripts/cache-check.mjs
//   GOOD_FAITH_SESSION_SECRET=... PLAYWRIGHT_PYTHON=... node scripts/cache-check.mjs --live http://localhost:3211
//
// The live run needs Playwright for Python with Chromium (PLAYWRIGHT_PYTHON, or the project's .venv, or python3, as
// for the demo seed). No Claude call, no PayPal write. It reads PayPal once per property page view, as the page always
// does. Exit 1 if any check fails.

import { spawnSync } from "node:child_process";
import { readdirSync, readFileSync, statSync } from "node:fs";
import { dirname, join, relative } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const SRC = join(ROOT, "src");

let pass = 0, failed = 0;
const failures = [];
function check(name, ok, detail = "") {
  if (ok) pass++;
  else { failed++; failures.push(`${name}${detail ? `: ${detail}` : ""}`); }
}

/* ---------- 1. Offline: the code ---------- */

const files = [];
(function walk(dir) {
  for (const n of readdirSync(dir)) {
    const p = join(dir, n);
    if (statSync(p).isDirectory()) walk(p);
    else if (/\.(ts|tsx)$/.test(n)) files.push(p);
  }
})(SRC);
const read = (p) => readFileSync(p, "utf8");
const rel = (p) => relative(ROOT, p);
const isClient = (text) => /^\s*["']use client["']/.test(text);

// Next.js caching: none of it, anywhere.
const NEXT_CACHE = [
  [/["']use cache(: \w+)?["']/, "a \"use cache\" directive"],
  [/\bunstable_cache\b/, "unstable_cache"],
  [/\bcacheLife\s*\(/, "cacheLife()"],
  [/\bcacheTag\s*\(/, "cacheTag()"],
  [/force-cache/, "fetch with cache: \"force-cache\""],
  [/next:\s*\{\s*revalidate/, "fetch with next.revalidate"],
  [/export\s+const\s+revalidate\b/, "a route's revalidate"],
  [/export\s+const\s+fetchCache\b/, "a route's fetchCache"],
];
for (const f of files) {
  const text = read(f);
  const uses = NEXT_CACHE.filter(([re]) => re.test(text)).map(([, what]) => what);
  check(`no Next.js cache: ${rel(f)}`, !uses.length, `uses ${uses.join(", ")}`);
}
const config = read(join(ROOT, "next.config.ts"));
for (const key of ["staleTimes", "cacheComponents", "partialPrefetching", "ppr", "dynamicIO", "useCache"]) {
  check(`next.config.ts sets no ${key}`, !new RegExp(`\\b${key}\\b`).test(config));
}

// Every page a session opens renders per request: the landlord layout (which covers every landlord page), the focused
// flows and the tenants' pages.
const mustBeDynamic = files.filter((f) => /[/\\]app[/\\](\(flow\)|t)[/\\].*page\.tsx$/.test(f) || /[/\\]app[/\\]\(landlord\)[/\\]layout\.tsx$/.test(f));
check("the landlord layout, the flows and the tenants' pages were found", mustBeDynamic.length >= 4, `${mustBeDynamic.length} files`);
for (const f of mustBeDynamic) check(`force-dynamic: ${rel(f)}`, /export const dynamic = "force-dynamic"/.test(read(f)));

// What a server module keeps between requests, and why no workspace's data can cross through it. Anything else at
// the top level of a server module that can change (a let, a Map, a Set) fails until it is listed here.
const KEPT = {
  "src/lib/workspace.ts ownerId": "the owner workspace's id: one row, the same for every session",
  "src/lib/workspace.ts seen": "demo workspaces confirmed to exist, keyed by the id in the signed session cookie: its label and when it was last seen, nothing from inside it",
  "src/lib/workspace.ts templates": "the demo's template tenancies and their file folders: the same list for every workspace, and read-only",
  "src/lib/paypal-webhook-store.ts templates": "the template tenancy ids, the same for every workspace",
  "src/lib/outside-refunds.ts templates": "the template tenancy ids, the same for every workspace, so a refund on one is never noted or recorded",
  "src/lib/db.ts recentLinks": "signed links to stored files, keyed by path; only signedUrlsFor (workspace.ts) asks for them, after dropping every path the session's workspace may not see (checked below)",
  "src/lib/paypal.ts cached": "the app's own PayPal OAuth token, not a workspace's data",
  "src/lib/chargeback-store.ts lastCheck": "when Check PayPal last ran per tenancy, a throttle: a time, no data",
  "src/lib/access-throttle.ts tries": "wrong access codes per address, a throttle",
  "src/lib/access-throttle.ts all": "wrong access codes in all, a throttle",
  "src/app/api/paypal/webhook/route.ts toldAddress": "whether the rate limit's address header was logged once",
  "src/proxy.ts PUBLIC_EXACT": "a fixed list of public paths, never changed",
  "src/lib/dates.ts ZONES": "date formatters, one set per time zone name (a state pack's zone): no data, only Intl formatters",
  "src/lib/jev.ts shared": "the app's TypeSafe client (the key and the transport): it keeps no request or answer between calls",
  "src/lib/jev.ts EVERYDAY": "a fixed list of everyday English words the redactor reads as words in lower case, never changed",
  "src/lib/e2e-paypal.ts fakeRefunds": "the judges'-path test's fake PayPal (only with GOOD_FAITH_E2E_STUBS=1, never on Render): refunds it made of the test's own fake captures, which no visitor's workspace holds",
  "src/lib/e2e-paypal.ts fakeRefundKeys": "the same fake refunds by their PayPal-Request-Id, a key made from the test copy's own records",
};
const TOP = /^(?:export\s+)?(?:let\s+([A-Za-z_$][\w$]*)|var\s+([A-Za-z_$][\w$]*)|const\s+([A-Za-z_$][\w$]*)\s*(?::[^=]+)?=\s*new\s+(?:Map|Set|WeakMap|WeakSet)\b)/;
const found = new Set();
for (const f of files) {
  const text = read(f);
  if (isClient(text)) continue; // a browser module: one viewer's own state
  for (const line of text.split("\n")) {
    const m = line.match(TOP);
    if (!m) continue;
    const key = `${rel(f)} ${m[1] ?? m[2] ?? m[3]}`;
    found.add(key);
    check(`kept between requests and listed: ${key}`, key in KEPT, "a server module keeps this between requests: say in KEPT why no workspace's data can cross through it");
  }
}
for (const key of Object.keys(KEPT)) check(`listed and still there: ${key}`, found.has(key), "remove it from KEPT");

// The shared signed-link cache is reached only through the workspace check.
for (const f of files) {
  if (rel(f) === "src/lib/db.ts") continue;
  for (const m of read(f).matchAll(/\bsignedUrls\s*\(/g)) {
    check(`signedUrls is called only by signedUrlsFor: ${rel(f)}`, rel(f) === "src/lib/workspace.ts", `at offset ${m.index}`);
  }
}
check("signedUrlsFor drops paths the workspace may not see before signing", /signedUrlsFor[\s\S]*?maySign\(ws, p\)[\s\S]*?signedUrls\(bucket, allowed\)/.test(read(join(SRC, "lib/workspace.ts"))));

// React's cache() memoizes for one request only. List its uses, so a reader sees what is shared within a request.
const perRequest = files.filter((f) => /\bcache\s*\(/.test(read(f)) && /from "react"/.test(read(f)) && !isClient(read(f))).map(rel);
check("React cache() is used (per request)", perRequest.length > 0);

/* ---------- 2. Live: two copies on a running server ---------- */

const liveAt = process.argv.indexOf("--live");
if (liveAt > 0) await live(process.argv[liveAt + 1]);

console.log(`cache-check: ${pass} passed, ${failed} failed${liveAt > 0 ? " (with --live)" : ""}`);
console.log(`  per request (React cache): ${perRequest.join(", ")}`);
if (failed) {
  for (const f of failures) console.log(`  FAIL ${f}`);
  process.exit(1);
}

async function live(base) {
  if (!base || !/^https?:\/\//.test(base)) throw new Error("--live needs the server's address, e.g. http://localhost:3211");
  base = base.replace(/\/$/, "");
  const secret = process.env.GOOD_FAITH_SESSION_SECRET;
  if (!secret) throw new Error("Set GOOD_FAITH_SESSION_SECRET to the running server's secret: the check signs its two sessions with it.");
  const { createJiti } = await import("jiti");
  const { dbClient, loadEnv, pythonBin } = await import("./demo-common.mjs");
  const jiti = createJiti(import.meta.url, { alias: { "@": SRC, "server-only": join(ROOT, "node_modules/server-only/empty.js") } });
  const session = await jiti.import(join(SRC, "lib/session.ts"));
  const env = loadEnv();
  const db = dbClient(env);
  // Found before any copy is made, so a missing Playwright stops the run with nothing to clean up.
  const python = pythonBin(env);

  const copies = [];
  try {
    // Two copies of the demo, made as a visitor's copy is, without a pool deposit.
    const { data: tpls, error: te } = await db.from("demo_templates").select("tenancy_id, role");
    if (te || !tpls?.length) throw new Error(`demo_templates: ${te?.message ?? "empty"}`);
    for (const name of ["A", "B"]) {
      const { data: ws, error } = await db.from("workspaces").insert({ kind: "demo", label: "Harbor View Rentals" }).select("id").single();
      if (error) throw new Error(`workspace ${name}: ${error.message}`);
      const copy = { name, ws: ws.id, units: {} };
      copies.push(copy);
      const now = new Date().toISOString();
      for (const t of tpls) {
        const { data, error: ce } = await db.rpc("copy_demo_template", { p_ws: ws.id, p_template: t.tenancy_id, p_now: now, p_pool: null });
        if (ce) throw new Error(`copy ${name} ${t.role}: ${ce.message}`);
        copy.units[t.role] = data;
      }
      const { value } = session.issueSession("demo", secret, { ws: ws.id });
      copy.cookie = `${session.SESSION_COOKIE}=${value}`;
      // Everything of the copy's own that a page could name: the workspace, its tenancies and the rows under them.
      const ids = Object.values(copy.units);
      const [p, d, ph] = await Promise.all([
        db.from("payments").select("id").in("tenancy_id", ids),
        db.from("deductions").select("id, tenancy_id, useful_life_years, amount").in("tenancy_id", ids),
        db.from("photos").select("id").in("tenancy_id", ids),
      ]);
      copy.deductions = d.data ?? [];
      copy.marks = [ws.id, ...ids, ...(p.data ?? []).map((x) => x.id), ...copy.deductions.map((x) => x.id), ...(ph.data ?? []).map((x) => x.id)];
    }
    const [A, B] = copies;
    check("two copies, three units each", Object.keys(A.units).length >= 3 && Object.keys(B.units).length >= 3);

    // An RSC request without the browser's router headers is sent on to its ?_rsc address, as Next asks.
    const get = (copy, path, headers = {}) => fetch(base + path, { headers: { cookie: copy.cookie, ...headers }, redirect: headers.rsc ? "follow" : "manual" })
      .then(async (r) => ({ status: r.status, text: await r.text() }));
    const pagesOf = (c) => {
      const out = ["/", "/units", "/tenants", "/ledger", "/insights", "/documents", "/move-outs", "/lease"];
      for (const [role, id] of Object.entries(c.units)) {
        out.push(`/tenancy/${id}`, ...["move-out", "payments", "documents", "tenants"].map((t) => `/tenancy/${id}?tab=${t}`), `/tenancy/${id}/statement`);
        // California's inspection notice (the Texas unit's state has none, and answers 404 for it).
        if (role !== "notice") out.push(`/tenancy/${id}/notices/inspection`);
      }
      if (c.units.move_out) out.push(`/tenancy/${c.units.move_out}/refund`);
      return out;
    };

    // 1. Every page for both copies at once, as HTML and as an RSC payload, three rounds, shuffled.
    const jobs = [];
    for (let round = 0; round < 3; round++) {
      for (const c of copies) for (const path of pagesOf(c)) {
        jobs.push({ c, path, rsc: false }, { c, path, rsc: true });
      }
    }
    for (let i = jobs.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1));
      [jobs[i], jobs[j]] = [jobs[j], jobs[i]];
    }
    let next = 0, served = 0;
    const leaks = [], missing = [], errors = [];
    await Promise.all(Array.from({ length: 6 }, async () => {
      while (next < jobs.length) {
        const { c, path, rsc } = jobs[next++];
        const other = c === A ? B : A;
        const r = await get(c, path, rsc ? { rsc: "1" } : {});
        if (r.status !== 200) { errors.push(`${c.name} ${rsc ? "RSC " : ""}${path}: ${r.status}`); continue; }
        served++;
        const leak = other.marks.find((m) => r.text.includes(m));
        if (leak) leaks.push(`${c.name} ${rsc ? "RSC " : ""}${path} names ${other.name}'s ${leak}`);
        if (/^\/tenancy\/|^\/units|^\/$|^\/ledger|^\/tenants/.test(path) && !c.marks.some((m) => r.text.includes(m))) missing.push(`${c.name} ${path}`);
      }
    }));
    check(`every page answered for both copies (${jobs.length} requests)`, errors.length === 0, errors.slice(0, 5).join("; "));
    check(`no page for one copy names the other's records (${served} pages)`, leaks.length === 0, leaks.slice(0, 5).join("; "));
    check("every page names its own copy's records", missing.length === 0, missing.slice(0, 5).join("; "));

    // 2. The other copy's tenancies, with this copy's session: not found.
    for (const [c, other] of [[A, B], [B, A]]) {
      for (const id of Object.values(other.units)) {
        const r = await get(c, `/tenancy/${id}?tab=payments`);
        check(`${c.name} can't open ${other.name}'s tenancy ${id}`, r.status === 404, `status ${r.status}`);
        const api = await get(c, `/api/tenancies/${id}/calendar`);
        check(`${c.name} can't read ${other.name}'s calendar ${id}`, api.status === 404, `status ${api.status}`);
      }
    }

    // 3. A change shows at once, in that copy only. Amounts travel in the page's data as numbers ("amount":720), in
    // the HTML's inline payload with its quotes escaped.
    const unit = A.units.move_out;
    const target = A.deductions.find((d) => d.tenancy_id === unit && d.useful_life_years != null);
    check("A's move-out unit has a deduction with a useful life", !!target);
    if (target) {
      const has = (text, n) => new RegExp(String.raw`\\?"amount\\?":` + String(Number(n)).replace(".", "\\.") + "[,}]").test(text);
      const before = Number(target.amount);
      const life = Number(target.useful_life_years);
      const edit = (years) => fetch(`${base}/api/tenancies/${unit}/deductions/${target.id}`, {
        method: "PATCH", headers: { cookie: A.cookie, "content-type": "application/json", origin: base }, body: JSON.stringify({ changes: { usefulLifeYears: years } }),
      }).then(async (r) => ({ status: r.status, body: await r.json().catch(() => null) }));
      const view = (c, id) => Promise.all([get(c, `/tenancy/${id}?tab=move-out`), get(c, `/tenancy/${id}?tab=move-out`, { rsc: "1" }), get(c, "/ledger"), get(c, "/insights")]);
      const changed = await edit(life - 2);
      check("A's deduction edit was accepted", changed.status === 200, `${changed.status} ${JSON.stringify(changed.body)?.slice(0, 200)}`);
      const { data: row } = await db.from("deductions").select("amount").eq("id", target.id).single();
      const after = Number(row?.amount);
      check("the edit changed the amount", Number.isFinite(after) && after !== before, `${before} -> ${after}`);
      const othersA = A.deductions.filter((d) => d.id !== target.id).map((d) => Number(d.amount));
      const amountsB = B.deductions.map((d) => Number(d.amount));
      const [aNow, bNow] = await Promise.all([view(A, unit), view(B, B.units.move_out)]);
      check("A's property page, its RSC payload, Payments and Insights show the new amount at once", aNow.every((p) => p.status === 200 && has(p.text, after)),
        aNow.map((p) => `${p.status}:${has(p.text, after)}`).join(" "));
      check("B's same pages still show the amount it had", bNow.every((p) => p.status === 200 && has(p.text, before)), bNow.map((p) => `${p.status}:${has(p.text, before)}`).join(" "));
      if (!amountsB.includes(after)) check("B's pages don't show A's new amount", bNow.every((p) => !has(p.text, after)));
      const back = await edit(life);
      check("A's deduction put back", back.status === 200, `${back.status} ${JSON.stringify(back.body)?.slice(0, 200)}`);
      const aBack = await view(A, unit);
      check("A's pages show the amount put back at once", aBack.every((p) => p.status === 200 && has(p.text, before)), aBack.map((p) => `${p.status}:${has(p.text, before)}`).join(" "));
      if (!othersA.includes(after)) check("and no longer the changed one", aBack.every((p) => !has(p.text, after)));
    }

    // 4. The same unit in a browser: its tabs, a change, and every way back to it (scripts/tabs-check.py).
    const tabs = spawnSync(python, [join(ROOT, "scripts/tabs-check.py")], {
      encoding: "utf8", timeout: 5 * 60_000, env: { ...process.env, GF_BASE: base, GF_COOKIE: A.cookie, GF_UNIT: unit },
    });
    const lines = (tabs.stdout ?? "").split("\n").map((l) => l.match(/^(PASS|FAIL) (.*?)(?:: (.*))?$/)).filter(Boolean);
    for (const [, verdict, name, detail] of lines) check(`browser: ${name}`, verdict === "PASS", detail ?? "");
    check("the browser check ran to the end", lines.length > 0 && (tabs.status === 0 || lines.some(([, v]) => v === "FAIL")),
      `exit ${tabs.status}${tabs.error ? ` ${tabs.error.message}` : ""} ${(tabs.stderr ?? "").slice(-400)}`);
  } finally {
    // The two throwaway copies go, rows and any uploads, by the sweep's own code.
    for (const c of copies) {
      const r = spawnSync(process.execPath, [join(ROOT, "scripts/demo-sweep.mjs"), "--workspace", c.ws, "--apply"], { encoding: "utf8" });
      check(`copy ${c.name} (${c.ws}) removed`, r.status === 0, (r.stderr || r.stdout).slice(-300));
    }
  }
}

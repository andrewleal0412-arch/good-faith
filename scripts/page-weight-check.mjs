#!/usr/bin/env node
// What a page makes the server load the first time it is asked for. Nothing a page renders needs the model SDKs, the
// PayPal Agent Toolkit, the MCP SDK, the PDF writer or the image library: a page reads the database and the state's
// rules, and the jobs that use those packages all run from API routes. So each of them is loaded on the path that
// needs it (`await import(...)` at the one place it is used), and this check holds that line: a static import that
// puts one of them back on a page's graph costs every visitor's first page the time to evaluate it, which on Render's
// small CPU was most of the first page's wait (docs/PERFORMANCE.md).
//
// It reads the imports in src, as the bundler does: `import type` is erased, and a dynamic `import()` is a boundary,
// not an edge. For each package it checks both directions, so neither a new static import nor a deleted dynamic one
// passes: nothing the server renders or runs for a request reaches it, and the module that owns it still does.
//
// It is stricter than the bundler in one place, on purpose: `import { type A } from "x"` counts as a load here, where
// TypeScript would erase it. Write `import type { A } from "x"` and the check agrees with the bundler.
//
//   node scripts/page-weight-check.mjs
//
// No network, no database. Exit 1 if any check fails.

import { readdirSync, readFileSync, statSync } from "node:fs";
import { dirname, join, relative, resolve, sep } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const SRC = join(ROOT, "src");

let pass = 0, failed = 0;
const failures = [];
function check(name, ok, detail = "") {
  if (ok) pass++;
  else { failed++; failures.push(`${name}${detail ? `: ${detail}` : ""}`); }
}

/** Each package a page must not load, and the module that owns it and still must. */
const HEAVY = [
  { pkg: "@paypal/agent-toolkit", owner: "src/lib/agent.ts", what: "PayPal's Agent Toolkit" },
  { pkg: "@modelcontextprotocol/sdk", owner: "src/lib/agent.ts", what: "the MCP SDK" },
  { pkg: "@ai-sdk/mcp", owner: "src/lib/agent.ts", what: "the AI SDK's MCP client" },
  { pkg: "@ai-sdk/anthropic", owner: "src/lib/model.ts", what: "the Anthropic SDK" },
  { pkg: "pdf-lib", owner: "src/lib/statement-pdf.ts", what: "the PDF writer" },
  { pkg: "sharp", owner: "src/lib/images.ts", what: "the image library" },
];

const EXTS = [".ts", ".tsx"];
const resolveSpec = (spec, from) => {
  const base = spec.startsWith("@/") ? join(SRC, spec.slice(2)) : spec.startsWith(".") ? resolve(dirname(from), spec) : null;
  if (!base) return null;
  for (const e of ["", ...EXTS, ...EXTS.map((x) => `/index${x}`)]) {
    const c = base + e;
    try { if (statSync(c).isFile()) return c; } catch { /* keep looking */ }
  }
  return null;
};

/** The modules one file loads when it is evaluated: `import type` erased, dynamic `import()` left out. */
const edges = new Map();
function importsOf(file) {
  let list = edges.get(file);
  if (list) return list;
  const text = readFileSync(file, "utf8");
  list = [...text.matchAll(/(?:^|\n)\s*(?:import|export)\s+(?!type\s)(?:[^'"]*?\s+from\s+)?["']([^"']+)["']/g)].map((m) => m[1]);
  edges.set(file, list);
  return list;
}

/** Every module and package `entry` loads when it is evaluated, with how it got there. */
function graph(entry) {
  const seen = new Map([[entry, [entry]]]);
  const pkgs = new Map();
  const queue = [entry];
  while (queue.length) {
    const file = queue.shift();
    const chain = seen.get(file);
    for (const spec of importsOf(file)) {
      const f = resolveSpec(spec, file);
      if (f) {
        if (!seen.has(f)) { seen.set(f, [...chain, f]); queue.push(f); }
      } else if (!pkgs.has(spec)) {
        pkgs.set(spec, chain);
      }
    }
  }
  return { pkgs, files: seen };
}

const loads = (g, pkg) => [...g.pkgs].find(([s]) => s === pkg || s.startsWith(`${pkg}/`));
const rel = (p) => relative(ROOT, p);

// Everything the server evaluates to answer a request: every page, layout, error, not-found, loading, template and
// default of the app, plus the proxy, which runs on every request, and instrumentation, which runs at boot.
const entries = [join(SRC, "proxy.ts"), join(SRC, "instrumentation.ts")].filter((p) => { try { return statSync(p).isFile(); } catch { return false; } });
(function walk(dir) {
  for (const n of readdirSync(dir)) {
    const p = join(dir, n);
    if (statSync(p).isDirectory()) walk(p);
    else if (/^(page|layout|error|not-found|loading|template|default)\.tsx$/.test(n)) entries.push(p);
  }
})(join(SRC, "app"));
check("the app has pages to check", entries.length >= 15, `found ${entries.length}`);
check("the proxy and instrumentation are checked", entries.filter((p) => !p.includes(`${sep}app${sep}`)).length === 2, `found ${entries.filter((p) => !p.includes(`${sep}app${sep}`)).length}`);

for (const entry of entries) {
  const g = graph(entry);
  for (const { pkg, what } of HEAVY) {
    const hit = loads(g, pkg);
    check(`${rel(entry)} does not load ${what}`, !hit,
      hit ? `${hit[1].map(rel).join(" -> ")} -> ${pkg}. Load it where it is used (await import), not at the top of the file.` : "");
  }
}

// The other direction: each package is still wired up where it is used, so a dynamic import can't be dropped by
// mistake and leave the feature broken.
for (const { pkg, owner, what } of HEAVY) {
  const file = join(ROOT, owner);
  const own = readFileSync(file, "utf8");
  const g = graph(file);
  const direct = new RegExp(`(?:from\\s*|import\\(\\s*)["']${pkg.replace(/[/\\^$*+?.()|[\]{}]/g, "\\$&")}(?:/[^"']*)?["']`).test(own);
  check(`${owner} still loads ${what}`, direct || !!loads(g, pkg));
}

console.log(`page-weight-check: ${pass} passed, ${failed} failed`);
for (const f of failures) console.log(`  FAIL ${f}`);
process.exit(failed ? 1 : 0);

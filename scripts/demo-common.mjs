// Shared by demo-seed.mjs and demo-reset.mjs: .env.local, the server-side Supabase client, dates, the Python that
// runs Playwright, and the one tenancy these scripts never touch. .env.local is read the way scripts/pay_invoice.py
// reads it, and nothing from it is ever printed.
import { existsSync, readFileSync } from "node:fs";
import { spawnSync } from "node:child_process";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { createClient } from "@supabase/supabase-js";

export const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");

/** Where the app is running. The dev server for this project listens on 3210. */
export const BASE = (process.env.DEMO_BASE_URL ?? "http://localhost:3210").replace(/\/$/, "");

/** The original demo tenancy (482 N. Glassell St, Unit B, Orange), closed out end to end. Never deleted or changed. */
export const ORIGINAL_DEMO_TENANCY = "94ee6bca-7a26-4671-96b6-75498112155a";

/** A lowercase uuid, the way the app writes ids into storage paths. Callers lowercase the argument first. */
export const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;

export function fail(message) {
  console.error(`\n${message}`);
  process.exit(1);
}

export function loadEnv() {
  const file = join(ROOT, ".env.local");
  if (!existsSync(file)) fail("No .env.local in the project root. Run the scripts/setup-*.sh scripts first (see README.md).");
  const env = {};
  for (const line of readFileSync(file, "utf8").split("\n")) {
    const t = line.trim();
    if (!t || t.startsWith("#") || !t.includes("=")) continue;
    const i = t.indexOf("=");
    env[t.slice(0, i).trim()] = t.slice(i + 1).trim().replace(/^"(.*)"$/, "$1");
  }
  return env;
}

/** Stops with the setup step to run when a key is missing. Never echoes a value. */
export function need(env, keys, hint) {
  for (const k of keys) if (!env[k]) fail(`${k} is missing from .env.local. ${hint}`);
}

/** The same server-only client the app uses (src/lib/db.ts): RLS is on with no policies, so only the secret key reads. */
export function dbClient(env) {
  need(env, ["SUPABASE_URL", "SUPABASE_SECRET_KEY"], "Run scripts/setup-supabase.sh.");
  return createClient(env.SUPABASE_URL, env.SUPABASE_SECRET_KEY, { auth: { persistSession: false, autoRefreshToken: false } });
}

// The probe asks Playwright where its Chromium is and checks that the file exists: "pip install playwright" alone
// passes an import test but has no browser, and that would only surface after the paid lease extraction.
const BROWSER_PROBE = [
  "from playwright.sync_api import sync_playwright",
  "import os, sys",
  "p = sync_playwright().start()",
  "ok = os.path.exists(p.chromium.executable_path)",
  "p.stop()",
  "sys.exit(0 if ok else 1)",
].join("\n");

/** A Python with Playwright and its Chromium, for paying the sandbox invoice and rendering PDFs. PLAYWRIGHT_PYTHON
 *  (in the shell or .env.local) wins; then the project's own .venv; then python3. */
export function pythonBin(env = {}) {
  const candidates = [process.env.PLAYWRIGHT_PYTHON, env.PLAYWRIGHT_PYTHON, join(ROOT, ".venv/bin/python"), "python3"].filter(Boolean);
  for (const py of candidates) {
    if (py.includes("/") && !existsSync(py)) continue;
    const r = spawnSync(py, ["-c", BROWSER_PROBE], { stdio: "ignore", timeout: 60_000 });
    if (r.status === 0) return py;
  }
  fail("No Python with Playwright and Chromium found. Install it (pip install playwright && playwright install chromium) and, if it lives in a virtualenv, set PLAYWRIGHT_PYTHON to that interpreter in .env.local or the shell.");
}

export const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// Dates are YYYY-MM-DD at noon UTC, as in src/lib/dates.ts, so a calendar day never slips.
export const pacificToday = () => new Date().toLocaleDateString("en-CA", { timeZone: "America/Los_Angeles" });
/** The Pacific calendar date of a timestamp. */
export const pacificDate = (ts) => new Date(ts).toLocaleDateString("en-CA", { timeZone: "America/Los_Angeles" });
export function addDays(iso, n) {
  const d = new Date(`${iso}T12:00:00Z`);
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
}
export const longDate = (iso) =>
  new Date(`${iso.slice(0, 10)}T12:00:00Z`).toLocaleDateString("en-US", { month: "long", day: "numeric", year: "numeric", timeZone: "UTC" });
export const usd = (n) => `$${Number(n).toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;

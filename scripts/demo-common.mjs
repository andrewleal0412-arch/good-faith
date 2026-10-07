// Shared by the demo scripts (demo-seed, demo-reset, demo-pool, demo-sweep): .env.local, the server-side Supabase
// client, dates, the Python that runs Playwright, PayPal's sandbox REST API, and the template tenancies these scripts
// never touch. .env.local is read the way scripts/pay_invoice.py reads it, and nothing from it is ever printed.
import { createHash } from "node:crypto";
import { existsSync, readFileSync } from "node:fs";
import { spawnSync } from "node:child_process";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { createClient } from "@supabase/supabase-js";

export const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");

/** Where the app is running. The dev server for this project listens on 3210. */
export const BASE = (process.env.DEMO_BASE_URL ?? "http://localhost:3210").replace(/\/$/, "");

/** The original demo tenancy (482 N. Glassell St, Unit B, Orange), closed out end to end. Never deleted or changed.
 *  It is one of the templates every demo copy is made from (demo_templates); templateIds() lists them all. */
export const ORIGINAL_DEMO_TENANCY = "94ee6bca-7a26-4671-96b6-75498112155a";

/** The template tenancies every demo copy is made from (the demo_templates table), with the original demo tenancy
 *  always among them. Read only: no script deletes or changes them. */
export async function templateIds(db) {
  const { data, error } = await db.from("demo_templates").select("tenancy_id, role");
  if (error) fail(`Couldn't read the demo templates: ${error.message}`);
  return new Map([[ORIGINAL_DEMO_TENANCY, "closed"], ...(data ?? []).map((r) => [r.tenancy_id, r.role])]);
}

/** The owner's workspace: everything made before workspaces existed, the templates, and what the owner code opens. */
export async function ownerWorkspaceId(db) {
  const { data, error } = await db.from("workspaces").select("id").eq("kind", "owner").maybeSingle();
  if (error || !data) fail(`Couldn't find the owner workspace${error ? `: ${error.message}` : ""}. Run supabase/migrations in order.`);
  return data.id;
}

/** A lowercase uuid, the way the app writes ids into storage paths. Callers lowercase the argument first. */
export const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;

export function fail(message) {
  console.error(`\n${message}`);
  process.exit(1);
}

export function loadEnv() {
  const file = join(ROOT, ".env.local");
  // On a host (a Render cron job running the sweep) the variables are in the environment, not in a file.
  if (!existsSync(file) && process.env.SUPABASE_URL && process.env.SUPABASE_SECRET_KEY) return { ...process.env };
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

/** PayPal's REST API in the sandbox, with the app's own credentials from .env.local (never printed). Refuses LIVE. */
export function paypalSandbox(env) {
  if ((env.PAYPAL_ENVIRONMENT ?? "").trim().toUpperCase() === "LIVE") {
    fail("PAYPAL_ENVIRONMENT is LIVE in .env.local. The demo scripts only run against the PayPal sandbox.");
  }
  need(env, ["PAYPAL_CLIENT_ID", "PAYPAL_CLIENT_SECRET"], "Run scripts/setup-sandbox.sh.");
  const base = "https://api-m.sandbox.paypal.com";
  let token = null;
  async function auth() {
    if (token && Date.now() < token.until) return token.value;
    const r = await fetch(`${base}/v1/oauth2/token`, {
      method: "POST",
      headers: {
        Authorization: "Basic " + Buffer.from(`${env.PAYPAL_CLIENT_ID}:${env.PAYPAL_CLIENT_SECRET}`).toString("base64"),
        "Content-Type": "application/x-www-form-urlencoded",
      },
      body: "grant_type=client_credentials",
      signal: AbortSignal.timeout(30_000),
    });
    if (!r.ok) throw new Error(`PayPal sign-in failed (HTTP ${r.status}). Check the sandbox app's credentials (scripts/setup-sandbox.sh).`);
    const j = await r.json();
    token = { value: j.access_token, until: Date.now() + (j.expires_in - 60) * 1000 };
    return token.value;
  }
  // A write passes `requestId`, sent as PayPal-Request-Id, always from the script's own record, never random. A
  // refusal carries PayPal's status and body (err.status, err.body), so a caller can tell a duplicate from a failure.
  return async function call(method, path, body, o = {}) {
    const r = await fetch(`${base}${path}`, {
      method,
      headers: { Authorization: `Bearer ${await auth()}`, "Content-Type": "application/json", ...(o.requestId ? { "PayPal-Request-Id": o.requestId } : {}) },
      body: body === undefined ? undefined : JSON.stringify(body),
      signal: AbortSignal.timeout(60_000),
    });
    const text = await r.text();
    if (!r.ok) throw Object.assign(new Error(`PayPal ${method} ${path} -> ${r.status}: ${text.slice(0, 300)}`), { status: r.status, body: text.slice(0, 4000) });
    return text ? JSON.parse(text) : {};
  };
}

/** An invoice number made from the script's own record and what the invoice says, as the app makes the deposit
 *  invoice's (src/lib/paypal.ts depositInvoiceNumber): "GF-" and 20 hex digits of a hash, inside PayPal's 25
 *  characters. PayPal refuses a second invoice with a number it already has (DUPLICATE_INVOICE_NUMBER). */
export const invoiceNumberFor = (key, content) => `GF-${createHash("sha256").update(`${key}\n${JSON.stringify(content)}`).digest("hex").slice(0, 20)}`;

const duplicateNumber = (e) => e?.status === 422 && String(e.body ?? "").includes("DUPLICATE_INVOICE_NUMBER");

/** The deposit invoice the app sends (src/lib/paypal.ts sendDepositInvoice): created, then sent to the tenant, made
 *  once at PayPal by its invoice number, as the app's own is. `key` names the record it is for (the pool's slot), so a
 *  rerun after a lost answer, a crash between the create and the send, or a payment the pool never recorded finds the
 *  first invoice by its number (`adopted`, with PayPal's status) instead of making a second one; it is sent only while
 *  it is still a draft. Both calls carry a PayPal-Request-Id from the same record (PayPal's Invoicing API ignores the
 *  header, tried on 2026-10-05, which is why the number is the guard). */
export async function sendSandboxDepositInvoice(paypal, { tenantEmail, amount, landlordName, address, note, key }) {
  if (!key) throw new Error("sendSandboxDepositInvoice needs the key of the record the invoice is for.");
  const content = {
    detail: {
      currency_code: "USD",
      note,
      terms_and_conditions: "Security deposit held and returned under California Civil Code 1950.5.",
      payment_term: { term_type: "DUE_ON_RECEIPT" },
    },
    invoicer: { business_name: landlordName },
    primary_recipients: [{ billing_info: { email_address: tenantEmail } }],
    items: [{ name: `Security deposit: ${address}`, quantity: "1", unit_amount: { currency_code: "USD", value: Number(amount).toFixed(2) } }],
  };
  const invoiceNumber = invoiceNumberFor(key, content);
  let id, status = "DRAFT", adopted = false;
  try {
    const created = await paypal("POST", "/v2/invoicing/invoices", { ...content, detail: { ...content.detail, invoice_number: invoiceNumber } }, { requestId: invoiceNumber });
    id = created.id ?? created.href?.split("/").pop();
  } catch (e) {
    if (!duplicateNumber(e)) throw e;
    // An earlier run made this invoice: the same one, found by its number.
    const r = await paypal("POST", "/v2/invoicing/search-invoices?page=1&page_size=5", { invoice_number: invoiceNumber });
    const hit = (r.items ?? []).find((i) => i.detail?.invoice_number === invoiceNumber && i.id);
    if (!hit) throw new Error(`PayPal has invoice ${invoiceNumber} but didn't return it.`);
    ({ id } = hit);
    status = hit.status ?? "DRAFT";
    adopted = true;
  }
  if (!id) throw new Error("PayPal didn't return an invoice id.");
  if (status === "DRAFT") {
    try {
      await paypal("POST", `/v2/invoicing/invoices/${id}/send`, { send_to_invoicer: false }, { requestId: `gf-invoice-send-${id}` });
      status = "SENT";
    } catch (e) {
      // Sent meanwhile (an earlier run's send whose answer was lost): no longer a draft, so it went.
      const now = await paypal("GET", `/v2/invoicing/invoices/${id}`).catch(() => null);
      if (!now || now.status === "DRAFT") throw e;
      status = now.status;
    }
  }
  return { id, payLink: `https://www.sandbox.paypal.com/invoice/p/#${id}`, invoiceNumber, status, ...(adopted ? { adopted: true } : {}) };
}

/** Pays a sandbox invoice as the sandbox tenant with scripts/pay_invoice.py (Playwright). True when it finished. */
export function payAsSandboxTenant(py, env, invoiceId) {
  need(env, ["PAYPAL_SANDBOX_BUYER_EMAIL", "PAYPAL_SANDBOX_BUYER_PASSWORD"], "Run scripts/setup-sandbox-tenant.sh to store the sandbox test tenant's login.");
  const r = spawnSync(py, [join(ROOT, "scripts/pay_invoice.py"), invoiceId], {
    stdio: "inherit", timeout: 300_000,
    env: { ...process.env, PAYPAL_SANDBOX_BUYER_EMAIL: env.PAYPAL_SANDBOX_BUYER_EMAIL, PAYPAL_SANDBOX_BUYER_PASSWORD: env.PAYPAL_SANDBOX_BUYER_PASSWORD },
  });
  return r.status === 0;
}

#!/usr/bin/env node
// The PayPal sandbox webhook the hosted demo listens on (src/app/api/paypal/webhook/route.ts, docs/DEPLOY.md section
// 2). Lists the sandbox app's webhooks, and registers the demo's URL for the events the app handles
// (WEBHOOK_EVENT_TYPES in src/lib/paypal-webhook.ts), or brings an existing one's events up to date. Prints the
// webhook id, which goes on Render as PAYPAL_WEBHOOK_ID: the route checks every delivery's signature with PayPal
// against it. Sandbox only (it refuses PAYPAL_ENVIRONMENT=LIVE); the client secret is read from .env.local and never
// printed.
//
//   node scripts/paypal-webhook.mjs                       list the sandbox app's webhooks and their events
//   node scripts/paypal-webhook.mjs --types               which of the app's events PayPal offers this app
//   node scripts/paypal-webhook.mjs --register            register https://good-faith.onrender.com/api/paypal/webhook
//   node scripts/paypal-webhook.mjs --register --url <u>  register another https URL (a webhook URL is unique per app)

import { join } from "node:path";
import { createJiti } from "jiti";
import { fail, loadEnv, paypalSandbox, ROOT } from "./demo-common.mjs";

const DEFAULT_URL = "https://good-faith.onrender.com/api/paypal/webhook";
const args = process.argv.slice(2);
const flag = (n) => args.includes(n);
const value = (n) => (args.includes(n) ? args[args.indexOf(n) + 1] : null);

const jiti = createJiti(import.meta.url, { alias: { "@": join(ROOT, "src"), "server-only": join(ROOT, "node_modules/server-only/empty.js") } });
const { WEBHOOK_EVENT_TYPES } = await jiti.import(join(ROOT, "src/lib/paypal-webhook.ts"));

const env = loadEnv();
const paypal = paypalSandbox(env);

/** The event types PayPal offers this app: an unknown name makes the whole registration fail, so only these are sent. */
async function offered() {
  const r = await paypal("GET", "/v1/notifications/webhooks-event-types");
  return new Set((r.event_types ?? []).map((t) => t.name));
}

async function list() {
  const r = await paypal("GET", "/v1/notifications/webhooks");
  const hooks = r.webhooks ?? [];
  if (!hooks.length) {
    console.log("No webhooks on the sandbox app yet. Register one with --register.");
    return hooks;
  }
  for (const h of hooks) {
    const names = (h.event_types ?? []).map((t) => t.name);
    const missing = WEBHOOK_EVENT_TYPES.filter((t) => !names.includes(t) && !names.includes("*"));
    console.log(`${h.id}  ${h.url}`);
    console.log(`  ${names.length} event types${names.includes("*") ? " (all)" : ""}${missing.length ? `; not subscribed: ${missing.join(", ")}` : "; every event the app handles"}`);
  }
  return hooks;
}

if (flag("--types")) {
  const have = await offered();
  for (const t of WEBHOOK_EVENT_TYPES) console.log(`${have.has(t) ? "offered    " : "not offered"}  ${t}`);
} else if (flag("--register")) {
  const url = value("--url") ?? DEFAULT_URL;
  let u;
  try { u = new URL(url); } catch { fail(`Not a URL: ${url}`); }
  if (u.protocol !== "https:") fail("PayPal delivers webhooks to https URLs only.");
  if (!u.pathname.endsWith("/api/paypal/webhook")) fail("The app listens at /api/paypal/webhook.");
  const have = await offered();
  const types = WEBHOOK_EVENT_TYPES.filter((t) => have.has(t));
  const skipped = WEBHOOK_EVENT_TYPES.filter((t) => !have.has(t));
  if (skipped.length) console.log(`Not offered to this app, so left out: ${skipped.join(", ")}`);
  const event_types = types.map((name) => ({ name }));
  const existing = ((await paypal("GET", "/v1/notifications/webhooks")).webhooks ?? []).find((h) => h.url === url);
  let id;
  if (existing) {
    const now = (existing.event_types ?? []).map((t) => t.name).sort();
    if (JSON.stringify(now) === JSON.stringify([...types].sort())) {
      console.log(`Already registered with every event: ${existing.id}`);
    } else {
      await paypal("PATCH", `/v1/notifications/webhooks/${existing.id}`, [{ op: "replace", path: "/event_types", value: event_types }]);
      console.log(`Updated the events of ${existing.id} (${types.length}).`);
    }
    id = existing.id;
  } else {
    const created = await paypal("POST", "/v1/notifications/webhooks", { url, event_types });
    id = created.id;
    console.log(`Registered ${url} for ${types.length} events.`);
  }
  console.log(`\nPAYPAL_WEBHOOK_ID=${id}\n\nSet it on the Render service (Environment), then deploy. Until it is set, the route answers 503 and PayPal keeps\nretrying each event for three days, so nothing sent meanwhile is lost.`);
} else {
  await list();
}

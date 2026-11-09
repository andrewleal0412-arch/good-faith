#!/usr/bin/env node
// The database side of the judges'-path end-to-end test (scripts/e2e-demo.py): it makes the test's own demo copy and
// its session, reads back what the app recorded, and removes everything it made. Never run by hand against a copy
// someone is using; it only ever touches a workspace it made (one that claims a fake e2e deposit).
//
//   node scripts/e2e-demo-db.mjs setup            a fresh demo copy, as a visitor's is made, with a fake deposit of its
//                                                 own, and a signed demo session for it (needs GOOD_FAITH_SESSION_SECRET
//                                                 and GOOD_FAITH_ACCESS_CODE: the test server's own)
//   node scripts/e2e-demo-db.mjs facts <ws>       what the app recorded in that copy, as JSON
//   node scripts/e2e-demo-db.mjs cleanup <ws> <sid>   give back the copy's daily-limit units, remove the copy (rows and
//                                                 files) with the sweep's own code, then the fake deposit, last, once
//                                                 nothing else is left (so a clean-up that stops halfway can be rerun)
//   node scripts/e2e-demo-db.mjs leftovers [--apply]  copies an earlier run left (each claims a fake e2e deposit), and
//                                                 with --apply removes them the same way
//
// The copy is made the way create_demo_copy_with_history makes a visitor's (copy_demo_template for each template, in
// role order, then copy_demo_history), except two things, so the test spends nothing the hosted demo needs: no
// demo_copy_usage row (the day's 60 copies stay untouched) and no real pool deposit. The move-out unit's deposit is a
// fake one inserted into demo_deposit_pool already claimed by the test's workspace and marked used (disputed_at), so
// no visitor's copy can ever claim it (claims take unclaimed rows only, and release_demo_deposit never frees a row
// marked used); its invoice id starts INV2-E2E and its capture E2E, which only the e2e fake PayPal answers for
// (src/lib/e2e-paypal.ts). The templates are only read. Prints JSON on stdout, never a secret.

import { randomBytes } from "node:crypto";
import { spawnSync } from "node:child_process";
import { join } from "node:path";
import { createJiti } from "jiti";
import { dbClient, loadEnv, ownerWorkspaceId, ROOT, templateIds } from "./demo-common.mjs";

const E2E_INVOICE_PREFIX = "INV2-E2E";
const E2E_PAYER = "e2e-tenant@example.com";
const BUCKETS = ["leases", "photos", "receipts"];
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;

const env = loadEnv();
for (const k of ["SUPABASE_URL", "SUPABASE_SECRET_KEY"]) process.env[k] ??= env[k];
const db = dbClient(env);
const [cmd, ...rest] = process.argv.slice(2);

const out = (x) => process.stdout.write(`${JSON.stringify(x)}\n`);
const die = (message) => { out({ ok: false, error: message }); process.exit(1); };
const must = (what, r) => { if (r.error) throw new Error(`${what}: ${r.error.message}`); return r.data; };
const upper = (n) => randomBytes(n).toString("hex").toUpperCase().slice(0, n);
const pacificDay = (d) => d.toLocaleDateString("en-CA", { timeZone: "America/Los_Angeles" });

const jiti = createJiti(import.meta.url, { alias: { "@": join(ROOT, "src"), "server-only": join(ROOT, "node_modules/server-only/empty.js") } });
const lib = (n) => jiti.import(join(ROOT, "src/lib", `${n}.ts`));

try {
  if (cmd === "setup") out(await setup());
  else if (cmd === "facts") out(await facts(rest[0]));
  else if (cmd === "cleanup") out(await cleanup(rest[0], rest[1] ?? null));
  else if (cmd === "leftovers") out(await leftovers(rest.includes("--apply")));
  else die("Usage: node scripts/e2e-demo-db.mjs setup | facts <ws> | cleanup <ws> [sid] | leftovers [--apply]");
} catch (e) {
  die(e instanceof Error ? e.message : String(e));
}

async function setup() {
  const secret = process.env.GOOD_FAITH_SESSION_SECRET ?? "";
  if (secret.length < 32 || !process.env.GOOD_FAITH_ACCESS_CODE) throw new Error("Set GOOD_FAITH_SESSION_SECRET and GOOD_FAITH_ACCESS_CODE to the test server's: the session and the tenant links are signed with them.");
  const tpls = must("demo_templates", await db.from("demo_templates").select("tenancy_id, role").order("role"));
  const moveOut = tpls.find((t) => t.role === "move_out");
  if (!moveOut) throw new Error("No move-out template is registered (docs/DEPLOY.md, section 9).");
  const tplTenancy = must("move-out template", await db.from("tenancies").select("deposit_amount").eq("id", moveOut.tenancy_id).single());

  const now = new Date();
  const ws = must("workspace", await db.from("workspaces").insert({ kind: "demo", label: "Harbor View Rentals" }).select("id").single()).id;
  const state = { ws, pool: null, units: {} };
  try {
    // The fake deposit, paid three days ago as a pool deposit is, claimed by this workspace and marked used.
    const paid = new Date(now.getTime() - 3 * 86_400_000);
    const invoice = `${E2E_INVOICE_PREFIX}-${upper(4)}-${upper(4)}-${upper(4)}`;
    const capture = `E2E${upper(14)}`;
    const amount = Number(tplTenancy.deposit_amount);
    const raw = {
      id: invoice, e2e: true, payLink: "e2e-fake:no-such-invoice-at-paypal",
      transactions: [{ type: "PAYPAL", amount: { value: amount.toFixed(2), currency_code: "USD" }, method: "PAYPAL", payment_id: capture,
        payment_date: pacificDay(paid), transaction_type: "SALE", payment_date_time: paid.toISOString().replace(/\.\d+Z$/, "Z"), transaction_status: "SUCCESS" }],
    };
    const pool = must("fake deposit", await db.from("demo_deposit_pool").insert({
      invoice_id: invoice, capture_id: capture, amount, payer_email: E2E_PAYER, paid_at: paid.toISOString(), raw,
      claimed_by: ws, claimed_at: now.toISOString(), disputed_at: now.toISOString(),
    }).select("id").single());
    state.pool = { id: pool.id, invoice, capture, amount };

    // Each template, in the order clone_demo_templates copies them, then the closed unit's settled history.
    for (const t of tpls) {
      state.units[t.role] = must(`copy ${t.role}`, await db.rpc("copy_demo_template", { p_ws: ws, p_template: t.tenancy_id, p_now: now.toISOString(), p_pool: t.role === "move_out" ? pool.id : null }));
    }
    const hist = must("history", await db.from("demo_template_history").select("tenancy_id"));
    state.history = 0;
    for (const t of tpls.filter((x) => hist.some((h) => h.tenancy_id === x.tenancy_id))) {
      if (must(`history ${t.role}`, await db.rpc("copy_demo_history", { p_copy: state.units[t.role], p_template: t.tenancy_id, p_now: now.toISOString() }))) state.history++;
    }

    // The tenant links re-keyed to demo tokens and the session, by the app's own code.
    const [links, session] = await Promise.all([lib("tenant-links"), lib("session")]);
    state.keyed = await links.keyDemoTenantLinks(Object.values(state.units));
    const { data: link } = await db.from("tenant_links").select("id").eq("tenancy_id", state.units.move_out).is("revoked_at", null).maybeSingle();
    const token = link ? links.demoTenantToken(link.id) : null;
    const issued = session.issueSession("demo", secret, { ws });
    // The move-out unit's photos by phase, so the walk can ask the tenants' photo route for a move-out photo before the
    // statement goes out (refused) and after (served, under its charge with the box).
    const { data: photoRows } = await db.from("photos").select("id, phase").eq("tenancy_id", state.units.move_out).order("created_at");
    state.photos = Object.fromEntries(["move_in", "move_out_before", "move_out_after"].map((ph) => [ph, (photoRows ?? []).filter((p) => p.phase === ph).map((p) => p.id)]));
    return { ok: true, ...state, tenantPath: token ? `/t/${token}` : null, sid: issued.session.sid, cookie: { name: session.SESSION_COOKIE, value: issued.value } };
  } catch (e) {
    const r = await removeCopy(ws, null).catch((x) => ({ ok: false, error: x instanceof Error ? x.message : String(x) }));
    if (!r.ok) throw new Error(`${e instanceof Error ? e.message : String(e)}. The half-made copy ${ws} wasn't fully removed: python scripts/e2e-demo.py --leftovers --apply, or npm run demo:sweep -- --workspace ${ws} --apply`);
    throw e;
  }
}

async function facts(ws) {
  if (!UUID.test(ws ?? "")) throw new Error("facts needs the copy's workspace id.");
  const tens = must("tenancies", await db.from("tenancies").select("id, deposit_amount, monthly_rent, move_out_date, statement_delivered_at, status, properties(address, state)").eq("workspace_id", ws));
  const ids = tens.map((t) => t.id);
  const [ded, pay, disp, turns, sets, runs, links] = await Promise.all([
    db.from("deductions").select("id, tenancy_id, item, room, category, work, performer, billed, hours, hourly_rate, item_age_years, useful_life_years, proration, amount, math").in("tenancy_id", ids).order("created_at"),
    db.from("payments").select("id, tenancy_id, kind, paypal_id, amount, status, raw, created_at").in("tenancy_id", ids).order("created_at"),
    db.from("disputes").select("id, tenancy_id, status, deduction_ids, advocate_status, negotiation_outcome").in("tenancy_id", ids),
    db.from("negotiation_turns").select("dispute_id, n, side, actor, move, amount_back, total_keep").in("tenancy_id", ids).order("n"),
    db.from("settlements").select("id, tenancy_id, dispute_id, amount, status, rail, paypal_id, paypal_status").in("tenancy_id", ids),
    db.from("agent_runs").select("id, tenancy_id, kind, status").in("tenancy_id", ids),
    db.from("tenant_links").select("id, tenancy_id").in("tenancy_id", ids).is("revoked_at", null),
  ]);
  for (const [what, r] of Object.entries({ ded, pay, disp, turns, sets, runs, links })) if (r.error) throw new Error(`${what}: ${r.error.message}`);
  return { ok: true, tenancies: tens, deductions: ded.data, payments: pay.data, disputes: disp.data, turns: turns.data, settlements: sets.data, runs: runs.data };
}

/** Whether a workspace is one this script made: a demo copy claiming a fake e2e deposit, holding no template. */
async function isTestCopy(ws) {
  const w = must("workspace", await db.from("workspaces").select("id, kind").eq("id", ws).maybeSingle());
  if (!w) return { exists: false, ours: false };
  if (w.kind !== "demo") return { exists: true, ours: false };
  const [templates, owner] = await Promise.all([templateIds(db), ownerWorkspaceId(db)]);
  if (ws === owner) return { exists: true, ours: false };
  const holding = must("templates", await db.from("tenancies").select("id").eq("workspace_id", ws).in("id", [...templates.keys()]));
  if (holding.length) return { exists: true, ours: false };
  const fake = must("pool", await db.from("demo_deposit_pool").select("id").eq("claimed_by", ws).like("invoice_id", `${E2E_INVOICE_PREFIX}%`));
  return { exists: true, ours: fake.length > 0 };
}

async function cleanup(ws, sid) {
  if (!UUID.test(ws ?? "")) throw new Error("cleanup needs the copy's workspace id.");
  const who = await isTestCopy(ws);
  if (who.exists && !who.ours) throw new Error(`${ws} isn't a copy this test made (no fake e2e deposit), so nothing was removed.`);
  return removeCopy(ws, sid);
}

async function removeCopy(ws, sid) {
  const report = { ok: true, ws, usageGivenBack: [], usageRowsRemoved: 0, sweep: null, filesRemoved: 0, poolRowsRemoved: 0, left: {} };
  const ids = must("tenancies", await db.from("tenancies").select("id").eq("workspace_id", ws)).map((t) => t.id);
  // 1. The daily-limit units the test took (its session's and, for the tenants' advocate, each tenancy's), given back
  //    to the day's totals the hosted demo shares, then its own rows removed.
  const counters = [...(sid ? [sid] : []), ...ids.map((id) => `tn:${id}`)];
  if (counters.length) {
    const rows = must("daily_usage", await db.from("daily_usage").select("day, session_id, kind, used").in("session_id", counters));
    for (const r of rows.filter((x) => x.used > 0)) {
      must(`give back ${r.kind}`, await db.rpc("give_back_usage", { p_day: r.day, p_session: r.session_id, p_kind: r.kind, p_units: r.used }));
      report.usageGivenBack.push({ day: r.day, kind: r.kind, units: r.used });
    }
    const gone = must("daily_usage rows", await db.from("daily_usage").delete().in("session_id", counters).select("session_id"));
    report.usageRowsRemoved = gone.length;
  }
  // 2. The copy, its rows and its files, by the sweep's own code. The fake deposit stays until they are gone: it is how
  //    isTestCopy and leftovers know this copy for the test's, so a sweep that stops halfway leaves a copy the next
  //    cleanup or --leftovers --apply still finds. Nothing can take it meanwhile: the sweep's release_demo_deposit
  //    never frees a row marked used (disputed_at), and a visitor's claim takes unclaimed rows only.
  const exists = must("workspace", await db.from("workspaces").select("id").eq("id", ws).maybeSingle());
  if (exists) {
    const r = spawnSync(process.execPath, [join(ROOT, "scripts/demo-sweep.mjs"), "--workspace", ws, "--apply"], { encoding: "utf8" });
    report.sweep = { status: r.status, out: (r.stdout || "").trim().split("\n").slice(-2).join(" ").slice(0, 400), err: (r.stderr || "").trim().slice(-400) };
    if (r.status !== 0) report.ok = false;
  }
  // 3. Files the sweep couldn't remove (it reports a failed removal and goes on to the rows), once the workspace is
  //    gone: everything under ws/<this copy>/ is its own upload (the templates' files live under <tenancy>/ and the
  //    owner's ws/<id>/, never here).
  let left = await whatIsLeft(ws, counters);
  if (!left.workspace && Object.values(left.files).some(Boolean)) {
    for (const b of BUCKETS) {
      const paths = (await listAll(b, `ws/${ws}`)).filter((x) => x.startsWith(`ws/${ws}/`));
      for (let i = 0; i < paths.length; i += 100) {
        const { error } = await db.storage.from(b).remove(paths.slice(i, i + 100));
        if (!error) report.filesRemoved += paths.slice(i, i + 100).length;
      }
    }
    left = await whatIsLeft(ws, counters);
  }
  // 4. The fake deposit, last, and only once nothing else of the copy is left.
  if (!left.workspace && !left.tenancies && !Object.values(left.files).some(Boolean)) {
    const pool = must("fake deposit", await db.from("demo_deposit_pool").delete().eq("claimed_by", ws).like("invoice_id", `${E2E_INVOICE_PREFIX}%`).select("id"));
    report.poolRowsRemoved = pool.length;
    left = await whatIsLeft(ws, counters);
  } else {
    report.kept = "the fake deposit stays until the copy is gone, so the next cleanup or --leftovers --apply finds it again";
  }
  report.left = left;
  if (left.workspace || left.tenancies || left.poolRows || left.usageRows || Object.values(left.files).some(Boolean)) report.ok = false;
  return report;
}

/** What is still there of a copy: its workspace, tenancies, pool rows, daily-limit rows and top-level upload entries. */
async function whatIsLeft(ws, counters) {
  const [w, t, p, u] = await Promise.all([
    db.from("workspaces").select("id", { count: "exact", head: true }).eq("id", ws),
    db.from("tenancies").select("id", { count: "exact", head: true }).eq("workspace_id", ws),
    db.from("demo_deposit_pool").select("id", { count: "exact", head: true }).eq("claimed_by", ws),
    counters.length ? db.from("daily_usage").select("day", { count: "exact", head: true }).in("session_id", counters) : Promise.resolve({ count: 0 }),
  ]);
  for (const [what, r] of Object.entries({ w, t, p, u })) if (r.error) throw new Error(`counting what is left (${what}): ${r.error.message}`);
  const files = {};
  for (const b of BUCKETS) {
    const { data, error } = await db.storage.from(b).list(`ws/${ws}`, { limit: 100 });
    if (error) throw new Error(`listing ${b}/ws/${ws}: ${error.message}`);
    files[b] = (data ?? []).length;
  }
  return { workspace: w.count ?? 0, tenancies: t.count ?? 0, poolRows: p.count ?? 0, usageRows: u.count ?? 0, files };
}

/** Every file under a folder, at any depth, as full paths (as the sweep lists them). */
async function listAll(bucket, prefix) {
  const found = [];
  for (let offset = 0; ; offset += 1000) {
    const { data, error } = await db.storage.from(bucket).list(prefix, { limit: 1000, offset });
    if (error) throw new Error(`listing ${bucket}/${prefix}: ${error.message}`);
    for (const o of data ?? []) {
      if (o.id) found.push(`${prefix}/${o.name}`);
      else found.push(...(await listAll(bucket, `${prefix}/${o.name}`)));
    }
    if ((data ?? []).length < 1000) return found;
  }
}

async function leftovers(apply) {
  const rows = must("fake deposits", await db.from("demo_deposit_pool").select("id, invoice_id, claimed_by, created_at").like("invoice_id", `${E2E_INVOICE_PREFIX}%`));
  const found = [];
  for (const r of rows) {
    const who = r.claimed_by ? await isTestCopy(r.claimed_by) : { exists: false, ours: false };
    const item = { invoice: r.invoice_id, ws: r.claimed_by, made: r.created_at, copyExists: who.exists };
    if (apply) {
      if (r.claimed_by && (who.ours || !who.exists)) item.removed = await removeCopy(r.claimed_by, null);
      else item.removed = must("fake deposit", await db.from("demo_deposit_pool").delete().eq("id", r.id).select("id")).length;
    }
    found.push(item);
  }
  return { ok: true, found };
}

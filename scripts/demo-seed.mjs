// Builds the demo tenancy for the video and the judges by driving the app's own HTTP APIs, so the real flow runs:
// the lease check, the tenancy, the AB 414 refund agreement, the PayPal deposit invoice paid by the sandbox tenant,
// move-in photos, the tenants' notice with the written notice it calls for, the move-out date, move-out photos,
// Claude's inspection, the deductions with their receipts and after-repair photos, and the private tenant link. It
// stops before the close-out so the agent and the approval happen live.
//
// Re-running continues an unfinished demo tenancy at the same address (a step already done is skipped), so a run
// that stopped halfway picks up where it left off. --fresh starts another one.
//
//   npm run demo:seed                            build or continue the demo tenancy
//   npm run demo:seed -- --fresh                 start a new one even if an unfinished one exists
//   npm run demo:seed -- --tenancy <id>          continue that tenancy
//   npm run demo:seed -- --until inspect         stop before a step: lease, agreement, invoice, pay, move_in_photos,
//                                                notice, move_out_date, move_out_photos, inspect, deductions, tenant_link
//   npm run demo:seed -- --move-out 2026-09-28   the move-out date (default: today, so the 21-day clock starts now)
//
// Dates: the records the seed makes are dated the day they belong to (the move-in steps on the lease start, the
// notice on the day it was given, the move-out steps on the move-out date), so the page reads like a tenancy that
// ran for a year. PayPal dates the sandbox payment the day it is paid, and that date stays PayPal's.
//
// Costs: two Claude steps (the lease extraction, then the inspection with one call per room) and one PayPal sandbox
// payment from the test tenant's fake balance. Needs the dev server (npx next dev -p 3210) and a Python with
// Playwright and Chromium for the PayPal checkout, checked before any Claude call (see demo-common.mjs, pythonBin).
import { spawnSync } from "node:child_process";
import { existsSync, mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { basename, join } from "node:path";
import {
  BASE, ORIGINAL_DEMO_TENANCY, ROOT, UUID, addDays, dbClient, fail, loadEnv, longDate, need, pacificDate, pacificToday, pythonBin, sleep, usd,
} from "./demo-common.mjs";

const STEPS = ["lease", "agreement", "invoice", "pay", "move_in_photos", "notice", "move_out_date", "move_out_photos", "inspect", "deductions", "tenant_link"];

const TITLE = {
  agreement: "Refund agreement (Civ. Code 1950.5(h)(1)(A))",
  invoice: "Deposit invoice through PayPal (Civ. Code 1950.5(c))",
  pay: "Tenant pays the deposit",
  move_in_photos: "Move-in photos (Civ. Code 1950.5(g)(1))",
  notice: "Tenant gave notice (Civ. Code 1950.5(f)(1), (h)(1)(A)(ii)(II))",
  move_out_date: "Move-out date: the 21-day clock (Civ. Code 1950.5(h)(1))",
  move_out_photos: "Move-out photos (Civ. Code 1950.5(g)(2))",
  inspect: "Inspection: Claude compares the rooms",
  deductions: "Deductions with receipts and after-repair photos (Civ. Code 1950.5(h)(2))",
  tenant_link: "Private tenant link",
};

// PayPal statuses that mean the deposit was paid (src/lib/invoice-status.ts).
const PAID = ["PAID", "MARKED_AS_PAID", "PARTIALLY_REFUNDED", "REFUNDED"];

const DEMO = {
  lease: join(ROOT, "demo/lease-single-owner.pdf"),
  addressMatch: "Juniper Hollow", // how the seed recognizes a tenancy it made
  // Room name in the app, photo file in demo/photos/<move_in|move_out|after_repair>/.
  rooms: [["Bedroom 1", "bedroom.jpg"], ["Living room", "living_room.jpg"], ["Kitchen", "kitchen.jpg"]],
  // The lease's ownership clause: one person, one property, one unit. Used only if the extraction leaves it out.
  owner: { ownerType: "natural_person", ownerPropertyCount: 1, ownerUnitCount: 1 },
  receiptDate: "October 1, 2026", // the date printed in demo/receipts/*.html; re-dated to follow the move-out
  noticeDays: 30, // the tenants' notice names a move-out this many days out
  inspectionNoticeAfterDays: 2, // the landlord mailed the initial-inspection notice this many days after the notice
};

// One deduction per receipt or labor record, matched to an inspection finding in the same room. The finding has to be
// of the planned kind (never unclear or wear and tear) with a remedy the planned work fits, and is picked by wording:
// the item's first words, then the whole item, then the observation. Amounts and vendors are the ones on the receipts;
// the app computes the chargeable amount (src/lib/deductions.ts).
const DEDUCTIONS = [
  {
    name: "bedroom carpet", room: "Bedroom 1", kinds: ["damage"], remedies: ["replace", "repair", "clean"],
    item: /carpet|rug/i, match: /carpet|stain|rug|floor/i,
    form: { work: "replace", performer: "vendor", invoiceTotal: 1800, proration: "useful_life", itemAgeYears: 6, usefulLifeYears: 10,
      vendorName: "Lantern Floor Covering", vendorAddress: "2210 E. Chapman Ave, Orange, CA 92869", vendorPhone: "(714) 555-0186" },
    // The inspection may say to try cleaning first. The record then says why the carpet was replaced, and that line
    // goes on the statement with the cost (Civ. Code 1950.5(h)(2)(D)).
    note: (dates) => `Spot cleaning on ${longDate(dates.cleaned)} did not lift the stain, so the carpet and pad were replaced.`,
    receipt: "carpet_invoice", after: "bedroom.jpg",
  },
  {
    name: "living room wall", room: "Living room", kinds: ["damage"], remedies: ["repair", "replace"],
    item: /wall|drywall/i, match: /wall|hole|drywall|gouge|patch|impact/i,
    form: { work: "repair", performer: "vendor", invoiceTotal: 140, proration: "none",
      vendorName: "Cedar Street Handyman", vendorAddress: "915 W. Cedar St, Santa Ana, CA 92707", vendorPhone: "(714) 555-0122" },
    receipt: "handyman_invoice", after: "living_room.jpg",
  },
  {
    name: "kitchen range", room: "Kitchen", kinds: ["cleaning", "damage"], remedies: ["clean"],
    item: /\brange\b|cooktop|stove|oven|burner/i, match: /\brange\b|cooktop|stove|oven|burner|grease|grime|burnt|hob/i,
    form: { work: "clean", performer: "own_labor", hours: 3, hourlyRate: 50, proration: "none",
      laborDescription: "Degreased the cooktop, control panel and oven door back to move-in condition" },
    receipt: null, after: "kitchen.jpg",
  },
];

const args = parseArgs(process.argv.slice(2));
const env = loadEnv();
// The demo pays with a sandbox test account, so it only ever runs against the PayPal sandbox.
if ((env.PAYPAL_ENVIRONMENT ?? "").trim().toUpperCase() === "LIVE") {
  fail("PAYPAL_ENVIRONMENT is LIVE in .env.local. The demo pays with a sandbox test account and only runs against the PayPal sandbox. Set PAYPAL_ENVIRONMENT=SANDBOX (scripts/setup-sandbox.sh).");
}
const db = dbClient(env);
const log = (s) => console.log(s);
const skip = (s) => console.log(`  already done: ${s}`);
const caveats = []; // what the presenter should know, printed with the summary
let tenantPath = null; // the tenant link made this run; the token is shown once and never stored
let PY = null; // the Python that runs Playwright

await main();

async function main() {
  await requireServer();
  await signIn();
  PY = pythonBin(env); // before any Claude call: the payment and the receipt exhibits need the browser

  let id = args.tenancy ?? null;
  if (id) {
    if (id === ORIGINAL_DEMO_TENANCY) fail("That is the original demo tenancy (482 N. Glassell St, Unit B). It is kept as it is; run without --tenancy to build the new demo.");
    const st = await state(id);
    if (closedOut(st)) fail(`Tenancy ${id} is already closed out (the statement went out or the deposit was returned). Run with --fresh for a new demo tenancy.`);
    log(`Continuing tenancy ${id} (${st.t.properties?.address ?? "address not recorded"})`);
  } else if (!args.fresh) {
    id = await findOpenDemoTenancy();
    if (id) log(`Continuing the unfinished demo tenancy ${id}. Use --fresh to start another one.`);
  }
  // The lease step is the one that makes the tenancy, so with a tenancy in hand there is nothing to stop before.
  if (id && args.until === "lease") {
    log(`\nThe lease step is already done for tenancy ${id}, so there is nothing to stop before. Nothing was run.`);
    await summary(id, "So far");
    process.exit(0);
  }

  try {
    if (!id) {
      await stopIfAsked("lease", null);
      id = await startTenancy();
    }
    const steps = {
      agreement: agreementStep, invoice: invoiceStep, pay: payStep,
      move_in_photos: (id, st) => photosStep(id, st, "move_in", "move_in"),
      notice: noticeStep,
      move_out_date: moveOutDateStep,
      move_out_photos: (id, st) => photosStep(id, st, "move_out_before", "move_out"),
      inspect: inspectStep, deductions: deductionsStep, tenant_link: tenantLinkStep,
    };
    for (const [step, run] of Object.entries(steps)) {
      await stopIfAsked(step, id);
      log(`\n${TITLE[step]}`);
      await run(id, await state(id));
    }
    await backdateRecords(id);
    await summary(id, "Demo tenancy ready");
    log("  Next, live: open the page and run the close-out agent. It proposes the PayPal refund for your approval.");
    log(`  Remove this tenancy later with: npm run demo:reset -- ${id}`);
  } catch (e) {
    console.error(`\nSeed stopped: ${e.message}`);
    if (id) {
      await backdateRecords(id).catch(() => {});
      console.error(`Fix the cause and continue with: npm run demo:seed -- --tenancy ${id}\n${BASE}/tenancy/${id}`);
    }
    process.exit(1);
  }
}

function parseArgs(argv) {
  const a = { fresh: false, tenancy: null, until: null, moveOut: null };
  for (let i = 0; i < argv.length; i++) {
    const k = argv[i], v = argv[i + 1];
    if (k === "--fresh") a.fresh = true;
    // Postgres compares uuids without regard to case, but storage paths and the guards here are plain strings, so the
    // id is lowercased once and every check sees the same value.
    else if (k === "--tenancy") { a.tenancy = v?.toLowerCase() ?? null; i++; }
    else if (k === "--until") { a.until = v; i++; }
    else if (k === "--move-out") { a.moveOut = v; i++; }
    else if (k === "--help" || k === "-h") { console.log(`${usageText()}\nSteps for --until: ${STEPS.join(", ")}`); process.exit(0); }
    else fail(`Unknown option ${k}.\n${usageText()}`);
  }
  if (a.tenancy && !UUID.test(a.tenancy)) fail("--tenancy needs the tenancy's id (the UUID in its URL).");
  if (a.until && !STEPS.includes(a.until)) fail(`--until needs one of: ${STEPS.join(", ")}`);
  if (a.moveOut && !/^\d{4}-\d{2}-\d{2}$/.test(a.moveOut)) fail("--move-out needs a date as YYYY-MM-DD.");
  if (a.moveOut && a.moveOut > pacificToday()) fail("--move-out can't be in the future: the tenants have to have moved out for the 21-day clock to run.");
  if (a.fresh && a.tenancy) fail("--fresh and --tenancy don't go together.");
  return a;
}

function usageText() {
  return "Usage: npm run demo:seed -- [--fresh | --tenancy <id>] [--until <step>] [--move-out YYYY-MM-DD]";
}

async function stopIfAsked(step, id) {
  if (args.until !== step) return;
  log(`\nStopped before "${step}" as asked.`);
  if (id) {
    await backdateRecords(id).catch(() => {});
    await summary(id, "So far");
    log(`  Continue with: npm run demo:seed -- --tenancy ${id}`);
  }
  process.exit(0);
}

async function requireServer() {
  try {
    const r = await fetch(`${BASE}/api/health`, { signal: AbortSignal.timeout(90_000) });
    if (!r.ok) throw new Error(`HTTP ${r.status}`);
  } catch (e) {
    const why = e.cause?.code ?? e.name ?? e.message;
    fail(`The dev server isn't answering at ${BASE} (${why}).\nStart it in another terminal with: npx next dev -p 3210\nOr set DEMO_BASE_URL to the server you're using.`);
  }
}

// A hosted copy sits behind the demo access gate (src/proxy.ts). With DEMO_ACCESS_CODE set, in the shell or
// .env.local, the seed enters it first and sends the session cookie with every request. Use the owner code: the owner
// has no per-session daily limits (src/lib/limits.ts). Local dev with no codes set needs none of this.
let COOKIE = null;
async function signIn() {
  const code = process.env.DEMO_ACCESS_CODE ?? env.DEMO_ACCESS_CODE;
  if (!code) return;
  const r = await fetch(`${BASE}/api/access`, {
    method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ code }), signal: AbortSignal.timeout(60_000),
  }).catch((e) => fail(`Couldn't reach ${BASE}/api/access (${e.cause?.code ?? e.name}).`));
  if (!r.ok) fail(`The access code didn't open ${BASE} (HTTP ${r.status}). Check DEMO_ACCESS_CODE.`);
  // No cookie back means the gate is off there, and no session is needed.
  COOKIE = r.headers.getSetCookie().map((c) => c.split(";")[0]).find((c) => c.startsWith("gf_session=")) ?? null;
}
const withSession = (headers = {}) => (COOKIE ? { ...headers, Cookie: COOKIE } : headers);

/** One request to the app. Server errors come back as the plain-English message the page would show. */
async function api(method, path, { json, form, timeout = 60_000 } = {}) {
  let r;
  try {
    r = await fetch(`${BASE}${path}`, {
      method, body: form ?? (json === undefined ? undefined : JSON.stringify(json)),
      headers: withSession(json === undefined ? {} : { "Content-Type": "application/json" }),
      signal: AbortSignal.timeout(timeout),
    });
  } catch (e) {
    throw new Error(`${method} ${path} didn't get a response (${e.cause?.code ?? e.name}). Is the dev server still running at ${BASE}?`);
  }
  const text = await r.text();
  let data;
  try { data = text ? JSON.parse(text) : {}; } catch { data = { error: text.slice(0, 200) }; }
  if (!r.ok) throw new Error(`${method} ${path} -> ${r.status}: ${data.error ?? "unknown error"}`);
  return data;
}

async function state(id) {
  const [{ data: t, error }, { data: payments }, { data: photos }, { data: deductions }] = await Promise.all([
    db.from("tenancies").select("id, tenants, start_date, end_date, move_out_date, notice_given_on, planned_move_out, notices, refund_agreement, lease_flags, move_out_findings, move_out_inspected_at, statement_delivered_at, properties(address)").eq("id", id).maybeSingle(),
    db.from("payments").select("id, kind, paypal_id, amount, status, raw").eq("tenancy_id", id).order("created_at"),
    db.from("photos").select("phase, room").eq("tenancy_id", id),
    db.from("deductions").select("id, item, room, amount, note, finding").eq("tenancy_id", id).order("created_at"),
  ]);
  if (error) fail(`Couldn't read the tenancy: ${error.message}`);
  if (!t) fail(`No tenancy ${id}.`);
  return { t, payments: payments ?? [], photos: photos ?? [], deductions: deductions ?? [] };
}

function closedOut(st) {
  return !!st.t.statement_delivered_at || st.payments.some((p) => p.kind === "refund" || p.kind === "payout");
}

/** The newest unfinished tenancy at the demo address, if any. */
async function findOpenDemoTenancy() {
  const { data } = await db.from("tenancies").select("id, created_at, properties!inner(address)")
    .ilike("properties.address", `%${DEMO.addressMatch}%`).is("statement_delivered_at", null).neq("id", ORIGINAL_DEMO_TENANCY)
    .order("created_at", { ascending: false });
  for (const row of data ?? []) {
    const { data: sent } = await db.from("payments").select("id").eq("tenancy_id", row.id).in("kind", ["refund", "payout"]).limit(1);
    if (!sent?.length) return row.id;
  }
  return null;
}

async function startTenancy() {
  if (!existsSync(DEMO.lease)) {
    fail(`${DEMO.lease} is missing. Render it with: python scripts/render_pdf.py demo/lease-single-owner.html demo/lease-single-owner.pdf`);
  }
  log("\nLease check: Claude reads the lease, the rules engine checks it (one API call, about half a minute)");
  const fd = new FormData();
  fd.append("file", new Blob([readFileSync(DEMO.lease)], { type: "application/pdf" }), basename(DEMO.lease));
  const r = await api("POST", "/api/lease", { form: fd, timeout: 180_000 });
  const terms = r.terms;
  // The owner's type and portfolio decide which cap applies (D4). When the extraction leaves them out, the landlord
  // confirms them from the lease's ownership clause, as the page asks; the route recomputes the flags from the terms.
  if (terms.ownerType === "unknown" || terms.ownerPropertyCount == null || terms.ownerUnitCount == null) {
    Object.assign(terms, DEMO.owner);
    log("  the extraction left the owner's portfolio out; confirmed from the lease: one person, one property, one unit");
  }
  log(`  ${terms.propertyAddress ?? "address not found"}; landlord ${terms.landlordName ?? "?"}; tenants ${terms.tenants.join(" and ")}`);
  log(`  rent ${usd(terms.monthlyRent ?? 0)}; security asked at move-in ${usd(r.totalSecurity)}`);
  const s = await api("POST", "/api/tenancies", { json: { terms, leasePath: r.leasePath } });
  const st = await state(s.id);
  for (const f of st.t.lease_flags ?? []) if (f.severity !== "info") log(`  ${f.severity} ${f.id}: ${f.title}`);
  log(`  started tenancy ${s.id}`);
  return s.id;
}

async function agreementStep(id, st) {
  if (st.t.refund_agreement) return skip(`signed by ${st.t.refund_agreement.signed_by.join(" and ")}`);
  need(env, ["PAYPAL_SANDBOX_BUYER_EMAIL"], "Run scripts/setup-sandbox-tenant.sh to store the sandbox test tenant.");
  const signers = st.t.tenants.map((x) => x.name);
  await api("POST", `/api/tenancies/${id}/agreement`, { json: { paypalEmail: env.PAYPAL_SANDBOX_BUYER_EMAIL, signers } });
  log(`  ${signers.join(" and ")} agreed in writing to a PayPal refund to the sandbox test tenant's account`);
}

async function invoiceStep(id, st) {
  const inv = st.payments.find((p) => p.kind === "deposit_invoice");
  if (inv) return skip(`invoice ${inv.paypal_id} for ${usd(inv.amount)}, ${inv.status.toLowerCase().replace(/_/g, " ")}`);
  const r = await api("POST", `/api/tenancies/${id}/deposit-invoice`);
  log(`  sent invoice ${r.invoiceId} for ${usd(r.amount)}${r.reduced ? " (the lease asked for more; the agent invoiced the legal cap)" : ""}`);
}

/** The deposit invoice with PayPal's current status: opening the tenancy page refreshes the stored row. */
async function refreshedInvoice(id) {
  await fetch(`${BASE}/tenancy/${id}`, { headers: withSession(), signal: AbortSignal.timeout(90_000) }).catch(() => {});
  const { data } = await db.from("payments").select("id, paypal_id, amount, status, raw").eq("tenancy_id", id).eq("kind", "deposit_invoice")
    .order("created_at").limit(1).maybeSingle();
  return data;
}

async function payStep(id) {
  let inv = await refreshedInvoice(id);
  if (!inv) throw new Error("there is no deposit invoice to pay.");
  if (PAID.includes(inv.status)) return skip(`PayPal reports the ${usd(inv.amount)} invoice as ${inv.status.toLowerCase().replace(/_/g, " ")}`);
  need(env, ["PAYPAL_SANDBOX_BUYER_EMAIL", "PAYPAL_SANDBOX_BUYER_PASSWORD"], "Run scripts/setup-sandbox-tenant.sh to store the sandbox test tenant's login.");
  log(`  paying invoice ${inv.paypal_id} (${usd(inv.amount)}) as the sandbox test tenant through PayPal's checkout (about a minute)`);
  // The login goes to the checkout script through its environment, read once here, so both sides see the same value.
  const r = spawnSync(PY, [join(ROOT, "scripts/pay_invoice.py"), inv.paypal_id], {
    stdio: "inherit", timeout: 300_000,
    env: { ...process.env, PAYPAL_SANDBOX_BUYER_EMAIL: env.PAYPAL_SANDBOX_BUYER_EMAIL, PAYPAL_SANDBOX_BUYER_PASSWORD: env.PAYPAL_SANDBOX_BUYER_PASSWORD },
  });
  if (r.status !== 0) {
    throw new Error(`the sandbox payment didn't finish. Pay it by hand as the test tenant at ${inv.raw?.payLink ?? "the PayPal invoice link"}, then re-run.`);
  }
  for (let i = 0; i < 12 && !PAID.includes(inv.status); i++) {
    await sleep(5000);
    inv = await refreshedInvoice(id);
  }
  if (!PAID.includes(inv.status)) throw new Error(`PayPal still reports the invoice as ${inv.status}. Wait a minute and re-run; the seed continues from here.`);
  log(`  paid: PayPal reports ${inv.status}`);
}

async function photosStep(id, st, phase, folder) {
  const have = new Set(st.photos.filter((p) => p.phase === phase).map((p) => p.room));
  for (const [room, file] of DEMO.rooms) {
    if (have.has(room)) { skip(room); continue; }
    const fd = new FormData();
    fd.append("phase", phase);
    fd.append("room", room);
    fd.append("files", new Blob([readFileSync(join(ROOT, "demo/photos", folder, file))], { type: "image/jpeg" }), file);
    await api("POST", `/api/tenancies/${id}/photos`, { form: fd });
    log(`  ${room}: ${file}`);
  }
}

/** The move-out date this run uses: --move-out, else today, never before the tenancy began. Today keeps the 21-day
 *  clock live, and keeps the deposit, which PayPal dates the day it is paid, from reading as paid after the move-out. */
function moveOutFor(st) {
  let date = args.moveOut ?? pacificToday();
  if (st.t.start_date && date < st.t.start_date) date = st.t.start_date;
  return date;
}

/** A day n days after the move-out, but never after today: the repairs and their receipts follow the move-out. */
function afterMoveOut(moveOut, n) {
  const d = addDays(moveOut, n), today = pacificToday();
  return d > today ? today : d;
}

/** The Pacific date PayPal recorded the deposit payment on, once paid. */
function depositPaidOn(st) {
  const inv = st.payments.find((p) => p.kind === "deposit_invoice");
  const ts = inv?.raw?.transactions?.[0]?.payment_date_time;
  return ts ? pacificDate(ts) : null;
}

async function noticeStep(id, st) {
  const today = pacificToday();
  const tenants = st.t.tenants.map((x) => x.name);
  let given = st.t.notice_given_on;
  if (given) skip(`notice given ${longDate(given)}, planned move-out ${longDate(st.t.planned_move_out)}`);
  else if (st.t.move_out_date) return log("  the move-out date is already set, so the notice stage is past; nothing to record");
  else {
    const planned = moveOutFor(st);
    given = addDays(planned, -DEMO.noticeDays);
    if (st.t.start_date && given < st.t.start_date) given = st.t.start_date;
    if (given > today) given = today;
    const r = await api("POST", `/api/tenancies/${id}/notice`, { json: { noticeGivenOn: given, plannedMoveOut: planned } });
    log(`  notice given ${longDate(given)} for a move-out on ${longDate(planned)}; the inspection window opens ${longDate(r.inspectionWindowOpens)}`);
  }
  // The initial-inspection notice (Civ. Code 1950.5(f)(1)) went out by first-class mail soon after. The electronic-
  // refund notice ((h)(1)(A)(ii)(II)) is not owed: the refund agreement signed at move-in already settles the method.
  if (st.t.notices?.inspection) return skip("initial-inspection notice recorded as given");
  let sent = addDays(given, DEMO.inspectionNoticeAfterDays);
  if (sent > today) sent = today;
  await api("POST", `/api/tenancies/${id}/notices/inspection`, { json: { date: sent, method: "mail", to: tenants[0] } });
  log(`  initial-inspection notice given by first-class mail to ${tenants[0]} on ${longDate(sent)}; the electronic-refund notice isn't owed (agreement on file)`);
}

async function moveOutDateStep(id, st) {
  if (st.t.move_out_date) return skip(`moved out ${longDate(st.t.move_out_date)}`);
  const date = moveOutFor(st);
  const paidOn = depositPaidOn(st);
  if (paidOn && date < paidOn) {
    caveats.push(`The move-out date ${longDate(date)} is before ${longDate(paidOn)}, the day PayPal dates the sandbox payment, so the statement shows the deposit paid after the tenants left. Leave --move-out off, or seed on the move-out day, for a clean record.`);
  }
  const r = await api("PATCH", `/api/tenancies/${id}`, { json: { moveOutDate: date } });
  log(`  moved out ${longDate(date)}; the itemized statement and refund are due by ${longDate(r.statementDue)}`);
}

async function inspectStep(id, st) {
  const findings = st.t.move_out_findings ?? [];
  if (st.t.move_out_inspected_at && findings.length) return skip(`${findings.length} findings on file`);
  log("  comparing move-in and move-out photos with Claude (one API call per room, about a minute)");
  const r = await api("POST", `/api/tenancies/${id}/inspect`, { timeout: 300_000 });
  for (const f of r.findings) log(`  ${f.room}: ${f.item} (${f.classification.replace(/_/g, " ")}, remedy ${f.remedy})`);
}

async function deductionsStep(id, st) {
  const findings = st.t.move_out_findings ?? [];
  if (!findings.length) throw new Error("no inspection findings to deduct from.");
  const moveOut = st.t.move_out_date ?? pacificToday();
  const dates = { cleaned: afterMoveOut(moveOut, 1), receipts: afterMoveOut(moveOut, 3) };
  const used = new Set(); // a finding serves one planned deduction; on a re-run the same one is picked and then skipped
  let receipts = null; // rendered the first time a deduction needs one, so a re-run that adds nothing opens no browser
  try {
    for (const plan of DEDUCTIONS) {
      const f = pickFinding(findings, plan, used);
      if (!f) { log(`  no ${plan.name} deduction: ${whyNoFinding(findings, plan, used)}. Add one by hand from the page if the facts support it.`); continue; }
      used.add(f.id);
      const note = plan.note?.(dates) ?? null;
      if (note && f.remedy !== plan.form.work) {
        caveats.push(`The inspection's remedy for "${f.item}" is ${f.remedy}, not ${plan.form.work}. The deduction records why the work went further: "${note}" That line is on the statement with the cost.`);
      }
      const done = st.deductions.find((d) => d.finding?.id === f.id);
      if (done) {
        // A deduction made before the note existed gets it on the re-run, so the statement carries the reason.
        if (note && !done.note) {
          const { error } = await db.from("deductions").update({ note }).eq("id", done.id);
          if (!error) log(`  ${f.room}: ${f.item}: added the note on why the work was done`);
        }
        skip(`${f.room}: ${f.item}, ${usd(done.amount)}`);
        continue;
      }
      const fd = new FormData();
      fd.append("findingId", f.id);
      fd.append("isEstimate", "false");
      if (note) fd.append("note", note);
      for (const [k, v] of Object.entries(plan.form)) fd.append(k, String(v));
      if (plan.receipt) {
        receipts ??= renderedReceipts(dates.receipts);
        fd.append("receipt", new Blob([readFileSync(receipts[plan.receipt])], { type: "application/pdf" }), `${plan.receipt}.pdf`);
      }
      fd.append("after", new Blob([readFileSync(join(ROOT, "demo/photos/after_repair", plan.after))], { type: "image/jpeg" }), plan.after);
      const r = await api("POST", `/api/tenancies/${id}/deductions`, { form: fd });
      log(`  ${f.room}: ${f.item}: ${usd(r.amount)} (${r.math})`);
    }
  } finally {
    receipts?.cleanup();
  }
}

/** The finding a planned deduction belongs to: same room, the planned kind (never unclear or wear and tear), a remedy
 *  the planned work fits, then the best match by wording: the item's first words, the whole item, the observation. */
function pickFinding(findings, plan, used) {
  const fits = findings.filter((f) => f.room === plan.room && f.id && !used.has(f.id) && plan.kinds.includes(f.classification) && plan.remedies.includes(f.remedy));
  const lead = (f) => f.item.split(/\s+/).slice(0, 3).join(" ");
  const score = (f) => (plan.item.test(lead(f)) ? 3 : plan.item.test(f.item) ? 2 : plan.match.test(`${f.item} ${f.observation ?? ""}`) ? 1 : 0);
  let best = null, bestScore = 0;
  for (const f of fits) {
    const s = score(f);
    if (s > bestScore) { best = f; bestScore = s; }
  }
  return best;
}

/** Why no finding fit a plan, from what the inspection did say about the room. */
function whyNoFinding(findings, plan, used) {
  const near = findings.filter((f) => f.room === plan.room && !used.has(f.id) && (plan.item.test(f.item) || plan.match.test(`${f.item} ${f.observation ?? ""}`)));
  if (!near.length) return `the inspection made no such finding in ${plan.room}`;
  return near.map((f) => `the inspection's "${f.item}" is ${f.classification.replace(/_/g, " ")} with remedy ${f.remedy}`).join("; ");
}

/** The receipt PDFs dated the given day, so the exhibits follow the move-out. Falls back to the committed PDFs if the
 *  render fails. */
function renderedReceipts(isoDate) {
  const date = longDate(isoDate);
  const dir = mkdtempSync(join(tmpdir(), "demo-receipts-"));
  const out = { cleanup: () => rmSync(dir, { recursive: true, force: true }) };
  for (const name of ["carpet_invoice", "handyman_invoice"]) {
    const committed = join(ROOT, "demo/receipts", `${name}.pdf`);
    const dst = join(dir, `${name}.pdf`);
    const r = spawnSync(PY, [join(ROOT, "scripts/render_pdf.py"), join(ROOT, "demo/receipts", `${name}.html`), dst, "--replace", `${DEMO.receiptDate}=${date}`],
      { stdio: "ignore", timeout: 120_000 });
    if (r.status === 0 && existsSync(dst)) out[name] = dst;
    else { log(`  couldn't re-date ${name}.pdf; using the committed copy (dated ${DEMO.receiptDate})`); out[name] = committed; }
  }
  return out;
}

async function tenantLinkStep(id) {
  const { data: live } = await db.from("tenant_links").select("id, created_at").eq("tenancy_id", id).is("revoked_at", null).limit(1).maybeSingle();
  if (live) return skip(`a tenant link has been active since ${longDate(pacificDate(live.created_at))}; its URL was shown when it was made`);
  const r = await api("POST", `/api/tenancies/${id}/tenant-link`);
  tenantPath = r.path;
  log(`  tenant's page: ${BASE}${r.path} (shown once; the app keeps only a hash of the token)`);
}

/** Dates the records the seed owns to the days they belong to, so the page reads like a tenancy that ran for a year:
 *  the move-in steps on the lease start, the notice on the day it was given, the move-out steps on the move-out date,
 *  each at a daytime hour and in the order it happened. A row only ever moves earlier, never into the future. The
 *  deductions and the receipts keep the day they were made, and PayPal's payment date is PayPal's. */
async function backdateRecords(id) {
  const st = await state(id);
  const { start_date: start, move_out_date: moveOut, notice_given_on: noticeOn } = st.t;
  if (!start) return;
  const [{ data: rows }, { data: photos }] = await Promise.all([
    db.from("audit_log").select("id, action, detail, created_at").eq("tenancy_id", id).order("created_at"),
    db.from("photos").select("id, phase, created_at").eq("tenancy_id", id).order("created_at"),
  ]);
  const when = (date, minute) => new Date(Date.parse(`${date}T17:00:00Z`) + minute * 60_000).toISOString(); // 10:00 Pacific daylight time
  const earlier = (ts, current) => Date.parse(ts) < Date.parse(current);
  const updates = [];
  const place = (list, date, minute, extra = () => ({})) => {
    list.forEach((r, i) => {
      const ts = when(date, minute + i);
      if (earlier(ts, r.created_at)) updates.push({ table: r.table, id: r.id, set: { created_at: ts, ...extra(ts) } });
    });
  };
  const logRows = (pred) => (rows ?? []).filter(pred).map((r) => ({ ...r, table: "audit_log" }));
  const actions = (...names) => logRows((r) => names.includes(r.action));
  const photoRows = (phase) => (photos ?? []).filter((p) => p.phase === phase).map((p) => ({ ...p, table: "photos" }));
  const taken = (ts) => ({ taken_at: ts });

  // Move-in day: the lease check, the tenancy, the agreement, the invoice, then the photos.
  place(actions("lease_checked"), start, 0);
  place(actions("tenancy_started"), start, 1);
  place(actions("refund_method_agreed"), start, 5);
  place(actions("deposit_invoice_sent", "deposit_invoice_failed"), start, 6);
  place(logRows((r) => r.action === "photos_added" && r.detail?.phase === "move_in"), start, 20);
  place(photoRows("move_in"), start, 20, taken);
  // The notice on the day it was given; each written notice on the day it went out.
  if (noticeOn) {
    place(actions("notice_recorded", "notice_changed"), noticeOn, 0);
    for (const r of logRows((r) => r.action === "notice_given" && r.detail?.date)) place([r], r.detail.date, 30);
  }
  // Move-out day: the photos, the date, the comparison. Deductions and the statement keep their own day.
  if (moveOut) {
    place(logRows((r) => r.action === "photos_added" && r.detail?.phase === "move_out_before"), moveOut, 0);
    place(photoRows("move_out_before"), moveOut, 0, taken);
    place(actions("move_out_date_set"), moveOut, 10);
    place(actions("move_out_inspected"), moveOut, 30);
  }
  for (const u of updates) {
    const { error } = await db.from(u.table).update(u.set).eq("id", u.id);
    if (error) throw new Error(`couldn't date a ${u.table} record: ${error.message}`);
  }

  // The same days on the tenancy row: the agreement's signature, the inspection's time, each notice's record.
  const patch = {};
  const ag = st.t.refund_agreement;
  if (ag?.signed_at && earlier(when(start, 5), ag.signed_at)) patch.refund_agreement = { ...ag, signed_at: when(start, 5) };
  if (moveOut && st.t.move_out_inspected_at && earlier(when(moveOut, 30), st.t.move_out_inspected_at)) patch.move_out_inspected_at = when(moveOut, 30);
  if (st.t.notices) {
    let changed = false;
    const notices = { ...st.t.notices };
    for (const [kind, n] of Object.entries(notices)) {
      if (n?.date && n.recorded_at && earlier(when(n.date, 30), n.recorded_at)) { notices[kind] = { ...n, recorded_at: when(n.date, 30) }; changed = true; }
    }
    if (changed) patch.notices = notices;
  }
  if (Object.keys(patch).length) {
    const { error } = await db.from("tenancies").update(patch).eq("id", id);
    if (error) throw new Error(`couldn't date the tenancy's records: ${error.message}`);
  }
  const n = updates.length + Object.keys(patch).length;
  if (n) log(`\nDated ${n} record${n === 1 ? "" : "s"} to the days they belong to: move-in ${longDate(start)}${noticeOn ? `, notice ${longDate(noticeOn)}` : ""}${moveOut ? `, move-out ${longDate(moveOut)}` : ""}.`);
}

async function summary(id, title) {
  const st = await state(id);
  const inv = st.payments.find((p) => p.kind === "deposit_invoice");
  const total = st.deductions.reduce((s, d) => s + Number(d.amount), 0);
  log(`\n${title}: ${BASE}/tenancy/${id}`);
  if (tenantPath) log(`  Tenant's page: ${BASE}${tenantPath}`);
  else {
    const { data: live } = await db.from("tenant_links").select("id").eq("tenancy_id", id).is("revoked_at", null).limit(1).maybeSingle();
    if (live) log("  Tenant's page: a link is active; its URL was shown when it was made. Make a new link on the tenancy page to get one again.");
  }
  if (inv && PAID.includes(inv.status)) {
    log(`  deposit held ${usd(inv.amount)}; deductions ${usd(total)} (${st.deductions.length}); ${usd(Math.max(0, Number(inv.amount) - total))} to return` +
      (st.t.move_out_date ? `; due by ${longDate(addDays(st.t.move_out_date, 21))}` : ""));
    const paidOn = depositPaidOn(st);
    if (paidOn) log(`  PayPal dates the sandbox payment the day it was paid, so the statement says the deposit was paid on ${longDate(paidOn)}. The other records are dated the days they belong to.`);
  }
  for (const c of caveats) log(`  Note: ${c}`);
}

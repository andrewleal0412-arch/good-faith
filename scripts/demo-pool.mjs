// The pre-paid PayPal sandbox deposits behind the hosted demo's private copies (the demo_deposit_pool table). Each
// visitor's copy of the move-out unit takes one when it is made, so its Send refund returns a real sandbox payment of
// its own; a copy made when the pool is empty still works, and its refund page says the pre-paid sandbox deposits are
// used up. A deposit is the same invoice the demo seed sends (the move-out template's amount, landlord and address,
// to the sandbox tenant), paid by the sandbox tenant through PayPal's checkout with scripts/pay_invoice.py.
//
//   npm run demo:pool -- --status          what the pool holds: ready, claimed, and too old to refund
//   npm run demo:pool -- --fill 4          top the ready deposits up to 4 (about a minute and one sandbox payment each)
//   npm run demo:pool -- --min 30          the same only when fewer than 30 are ready, then one line and exit 0: for a
//                                         daily launchd or cron job (docs/DEPLOY.md, section 9)
//   npm run demo:pool -- --adopt <INV2-…>  add an invoice already paid by hand as the sandbox tenant
//
// Sandbox only: the app's PayPal credentials from .env.local, with PAYPAL_ENVIRONMENT=SANDBOX; it refuses LIVE. Each
// deposit spends the sandbox tenant's fake balance (the refund a copy sends gives most of it back). Needs a Python
// with Playwright and Chromium (PLAYWRIGHT_PYTHON), as the demo seed does. Never prints a credential.
import {
  dbClient, fail, loadEnv, longDate, need, pacificDate, payAsSandboxTenant, paypalSandbox, pythonBin, sendSandboxDepositInvoice, sleep, usd,
} from "./demo-common.mjs";

/** PayPal refunds a payment against itself for 180 days; the app claims only deposits younger than 170. */
const FRESH_DAYS = 170;
/** The most ready deposits one run fills to: each is $4,800 of the sandbox tenant's fake balance. */
const MOST = 50;
const PAID = ["PAID", "MARKED_AS_PAID"];

const args = parseArgs(process.argv.slice(2));
const env = loadEnv();
const paypal = paypalSandbox(env);
const db = dbClient(env);

if (args.status) await status();
else if (args.adopt) await adopt(args.adopt);
else if (args.fill != null) await fill(args.fill);
else if (args.min != null) await min(args.min);

function parseArgs(argv) {
  const a = { status: false, fill: null, min: null, adopt: null };
  for (let i = 0; i < argv.length; i++) {
    const k = argv[i], v = argv[i + 1];
    if (k === "--status") a.status = true;
    else if (k === "--fill") { a.fill = Number(v); i++; }
    else if (k === "--min") { a.min = Number(v); i++; }
    else if (k === "--adopt") { a.adopt = v ?? null; i++; }
    else if (k === "--help" || k === "-h") { console.log(usage()); process.exit(0); }
    else fail(`Unknown option ${k}.\n${usage()}`);
  }
  if (a.fill != null && (!Number.isInteger(a.fill) || a.fill < 1 || a.fill > MOST)) fail(`--fill needs a number of deposits from 1 to ${MOST}.`);
  if (a.min != null && (!Number.isInteger(a.min) || a.min < 1 || a.min > MOST)) fail(`--min needs a number of deposits from 1 to ${MOST}.`);
  if (a.adopt != null && !/^INV2-[A-Z0-9-]{10,40}$/.test(a.adopt)) fail("--adopt needs a PayPal invoice id (INV2-...).");
  if ([a.status, a.fill != null, a.min != null, a.adopt != null].filter(Boolean).length !== 1) fail(usage());
  return a;
}

function usage() {
  return "Usage: npm run demo:pool -- --status | --fill <N> | --min <N> | --adopt <invoice id>";
}

/** The move-out template the copies are made from, and the deposit invoice it was sent: the pool's deposits match it. */
async function moveOutTemplate() {
  const { data: tpl, error } = await db.from("demo_templates").select("tenancy_id").eq("role", "move_out").maybeSingle();
  if (error) fail(`Couldn't read the demo templates: ${error.message}`);
  if (!tpl) fail("No move-out template is registered (demo_templates), so no copy needs a deposit. See docs/DEPLOY.md.");
  const id = tpl.tenancy_id;
  const [{ data: t }, { data: inv }, { data: sent }] = await Promise.all([
    db.from("tenancies").select("refund_agreement, properties(address, owner_name)").eq("id", id).single(),
    db.from("payments").select("amount").eq("tenancy_id", id).eq("kind", "deposit_invoice").order("created_at").limit(1).maybeSingle(),
    db.from("audit_log").select("detail").eq("tenancy_id", id).eq("action", "deposit_invoice_sent").order("created_at", { ascending: false }).limit(1).maybeSingle(),
  ]);
  if (!t || !inv) fail(`The move-out template ${id} has no deposit invoice to match.`);
  const amount = Number(inv.amount);
  // The note the app writes on the invoice (src/app/api/tenancies/[id]/deposit-invoice/route.ts).
  const charged = Number(sent?.detail?.charged_by_lease ?? amount);
  const note = amount < charged
    ? `Security deposit capped at the California limit (Civ. Code 1950.5(c)). The lease lists $${charged.toFixed(2)} in move-in charges; $${amount.toFixed(2)} is the lawful maximum.`
    : "Security deposit, held and returned under California Civil Code 1950.5.";
  return {
    id, amount, note,
    landlordName: t.properties?.owner_name ?? "Landlord",
    address: t.properties?.address ?? "the demo unit",
    agreementEmail: t.refund_agreement?.paypal_email ?? null,
  };
}

async function rows() {
  const { data, error } = await db.from("demo_deposit_pool").select("invoice_id, amount, paid_at, claimed_by, claimed_at, disputed_at, refunded_outside_at, created_at").order("paid_at");
  if (error) fail(`Couldn't read the pool: ${error.message}`);
  const cutoff = Date.now() - FRESH_DAYS * 86_400_000;
  const all = data ?? [];
  // A deposit the tenants disputed with PayPal (disputed_at), or one refunded in PayPal outside the app
  // (refunded_outside_at), is used for good, claimed or not.
  const used = (r) => r.disputed_at || r.refunded_outside_at;
  return {
    all,
    ready: all.filter((r) => !r.claimed_by && !used(r) && Date.parse(r.paid_at) > cutoff),
    stale: all.filter((r) => !r.claimed_by && !used(r) && Date.parse(r.paid_at) <= cutoff),
    claimed: all.filter((r) => r.claimed_by),
  };
}

async function status() {
  const p = await rows();
  // Claims held by a copy that no longer exists: used deposits the sweep kept (a refund or a PayPal dispute went
  // against them), never given to another copy.
  const ids = [...new Set(p.claimed.map((r) => r.claimed_by))];
  const { data: live, error } = ids.length ? await db.from("workspaces").select("id").in("id", ids) : { data: [] };
  if (error) fail(`Couldn't read the workspaces: ${error.message}`);
  const exists = new Set((live ?? []).map((w) => w.id));
  const orphaned = p.claimed.filter((r) => !exists.has(r.claimed_by));
  console.log(`Demo deposit pool: ${p.ready.length} ready, ${p.claimed.length} claimed by demo copies (${orphaned.length} of them by copies that no longer exist), ${p.stale.length} too old to refund (over ${FRESH_DAYS} days).`);
  for (const r of p.all) {
    const state = r.claimed_by ? `claimed ${longDate(pacificDate(r.claimed_at))}${exists.has(r.claimed_by) ? "" : " by a copy that no longer exists (used)"}`
      : r.disputed_at ? "disputed with PayPal (used)"
        : r.refunded_outside_at ? "refunded in PayPal outside the app (used)"
        : Date.parse(r.paid_at) > Date.now() - FRESH_DAYS * 86_400_000 ? "ready" : "too old";
    console.log(`  ${r.invoice_id}  ${usd(r.amount)}  paid ${longDate(pacificDate(r.paid_at))}  ${state}${r.disputed_at && r.claimed_by ? ", disputed with PayPal" : ""}`);
  }
  if (!p.ready.length) console.log("  The next demo copy will have no deposit of its own. Fill it with: npm run demo:pool -- --fill 4");
}

/** The paid invoice as the pool keeps it, or the reason it can't go in. */
async function paidInvoice(invoiceId, template, payer) {
  const inv = await paypal("GET", `/v2/invoicing/invoices/${invoiceId}`);
  if (!PAID.includes(inv.status)) return { error: `PayPal reports ${invoiceId} as ${String(inv.status).toLowerCase().replace(/_/g, " ")}, not paid` };
  const txn = inv.payments?.transactions?.[0];
  const billed = inv.primary_recipients?.[0]?.billing_info?.email_address ?? null;
  if (!txn?.payment_id || !txn.payment_date_time) return { error: `PayPal has no payment record on ${invoiceId}` };
  if (Number(inv.amount?.value ?? txn.amount?.value) !== template.amount) return { error: `${invoiceId} is for ${usd(inv.amount?.value)}, not the template's ${usd(template.amount)}` };
  if (!billed || billed.toLowerCase() !== payer.toLowerCase()) return { error: `${invoiceId} was billed to another account, not the sandbox tenant` };
  return {
    row: {
      invoice_id: inv.id, capture_id: txn.payment_id, amount: template.amount, payer_email: billed, paid_at: txn.payment_date_time,
      raw: { id: inv.id, payLink: `https://www.sandbox.paypal.com/invoice/p/#${inv.id}`, transactions: inv.payments.transactions },
    },
  };
}

async function insert(row) {
  const { error } = await db.from("demo_deposit_pool").insert(row);
  if (error) fail(`PayPal has the deposit ${row.invoice_id}, but the pool couldn't record it: ${error.message}. Add it with: npm run demo:pool -- --adopt ${row.invoice_id}`);
}

/** The sandbox tenant's account, which must be the one the move-out template's refund agreement names: the refund
 *  goes back against the payment only when the deposit was billed to the account the tenants designated. */
function payerFor(template) {
  need(env, ["PAYPAL_SANDBOX_BUYER_EMAIL"], "Run scripts/setup-sandbox-tenant.sh to store the sandbox test tenant.");
  const payer = env.PAYPAL_SANDBOX_BUYER_EMAIL;
  if (template.agreementEmail && template.agreementEmail.toLowerCase() !== payer.toLowerCase()) {
    console.log("  Note: the sandbox tenant in .env.local isn't the account the template's refund agreement names. Each copy's agreement is set to the account that paid its deposit.");
  }
  return payer;
}

async function adopt(invoiceId) {
  const template = await moveOutTemplate();
  const payer = payerFor(template);
  const { data: had } = await db.from("demo_deposit_pool").select("invoice_id").eq("invoice_id", invoiceId).maybeSingle();
  if (had) fail(`${invoiceId} is already in the pool.`);
  const r = await paidInvoice(invoiceId, template, payer);
  if (r.error) fail(`${r.error}. Nothing was added.`);
  await insert(r.row);
  console.log(`Added ${invoiceId} (${usd(r.row.amount)}, paid ${longDate(pacificDate(r.row.paid_at))}).`);
  await status();
}

/** For a daily job: fills to `target` only when fewer are ready, and ends with one line either way. Exit 0 when the
 *  pool holds at least `target`; a payment that didn't go through stops it with exit 1, as --fill does, so the job's
 *  log shows which invoice to pay by hand. Nothing is sent, and no Python is looked for, when there is nothing to do. */
async function min(target) {
  const p = await rows();
  if (p.ready.length >= target) {
    console.log(`Demo deposit pool: ${p.ready.length} ready, at least ${target} wanted. Nothing to do.`);
    return;
  }
  const had = p.ready.length;
  const now = await fill(target, { summary: false });
  console.log(`Demo deposit pool: ${now} ready, at least ${target} wanted; ${now - had} added.`);
}

async function fill(target, { summary = true } = {}) {
  const template = await moveOutTemplate();
  const payer = payerFor(template);
  const py = pythonBin(env);
  let p = await rows();
  console.log(`Filling the pool to ${target} ready deposits of ${usd(template.amount)} (${template.address}); ${p.ready.length} ready now.`);
  // Each deposit's invoice is made once at PayPal by its number (sendSandboxDepositInvoice), from the pool's next slot:
  // one more than the deposits the pool has ever held (the end-to-end test's fake ones aside, which it removes). A
  // rerun after a crash, a lost answer or a payment never recorded finds that slot's invoice again, so it can't
  // invoice twice; a slot whose invoice is in the pool already (rows removed by hand) moves on to the next.
  let slot = p.all.filter((r) => !String(r.invoice_id).startsWith("INV2-E2E")).length + 1;
  while (p.ready.length < target) {
    const n = p.ready.length + 1;
    console.log(`\nDeposit ${n} of ${target}: sending the invoice`);
    let inv;
    const pooled = new Set(p.all.map((r) => r.invoice_id));
    try {
      for (let tries = 0; ; tries++) {
        inv = await sendSandboxDepositInvoice(paypal, {
          tenantEmail: payer, amount: template.amount, landlordName: template.landlordName, address: template.address, note: template.note,
          key: `demo-pool:${template.id}:${slot}`,
        });
        if (!(inv.adopted && pooled.has(inv.id))) break;
        if (tries >= 50) throw new Error("every slot tried already has its invoice in the pool");
        slot++;
      }
    } catch (e) {
      fail(`PayPal didn't create the invoice: ${e.message}\nStopped with ${p.ready.length} ready.`);
    }
    if (inv.adopted) console.log(`  invoice ${inv.id} (${inv.invoiceNumber}) from an earlier run, ${String(inv.status).toLowerCase().replace(/_/g, " ")}: picked up, not made again`);
    const paidAlready = PAID.includes(inv.status);
    if (!paidAlready) console.log(`  invoice ${inv.id}; paying it as the sandbox tenant (about a minute)`);
    if (!paidAlready && !payAsSandboxTenant(py, env, inv.id)) {
      fail(`The sandbox payment for ${inv.id} didn't go through (see the checkout's output above: a login page that changed, or a balance PayPal refused). Nothing was added for it, and filling stopped with ${p.ready.length} ready.\nPay it by hand as the sandbox tenant at ${inv.payLink}, then add it with: npm run demo:pool -- --adopt ${inv.id}`);
    }
    let r = { error: "PayPal hasn't recorded the payment yet" };
    for (let i = 0; i < 12 && r.error; i++) {
      await sleep(5000);
      r = await paidInvoice(inv.id, template, payer).catch((e) => ({ error: e.message }));
    }
    if (r.error) fail(`${r.error}. Filling stopped with ${p.ready.length} ready. When PayPal shows it paid, add it with: npm run demo:pool -- --adopt ${inv.id}`);
    await insert(r.row);
    console.log(`  paid ${longDate(pacificDate(r.row.paid_at))}; in the pool`);
    slot++;
    p = await rows();
  }
  console.log("");
  if (summary) await status();
  return p.ready.length;
}

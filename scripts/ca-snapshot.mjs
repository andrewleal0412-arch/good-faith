#!/usr/bin/env node
// California must behave exactly as it did before the state rule packs (src/lib/states/). This script computes what
// the rules engine, the close-out, the statement (and the text of its PDF), the tenant page's model, the next steps,
// the calendar, the ledger and the agent's prompt say for California, and compares it with the baseline in
// scripts/fixtures/ca-snapshot.json, recorded from the code before the refactor.
//
//   node scripts/ca-snapshot.mjs           compare with the baseline; exit 1 and list the differences if any
//   node scripts/ca-snapshot.mjs --write   record a new baseline (only when a California change is intended)
//   node scripts/ca-snapshot.mjs --out f   also write this run's snapshot to f, to diff by hand
//
// Read-only: it reads the two template tenancies (and their storage files, for the PDF) with the server's own modules
// and asks the PayPal sandbox for their deposit invoices. Nothing is written to the database, storage or PayPal, and
// no Claude call is made. The clock is frozen at FROZEN so "today", the countdowns and the statement date never move.
// Emails are replaced by a short hash before anything is compared or stored. Needs .env.local (Supabase and PayPal).

import { createHash } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { createRequire } from "node:module";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { createJiti } from "jiti";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const FIXTURE = join(ROOT, "scripts/fixtures/ca-snapshot.json");
const TEMPLATES = ["94ee6bca-7a26-4671-96b6-75498112155a", "e06de0e7-70e2-4c8a-bb6c-1db47531e5ee"];
const FROZEN = "2026-10-03T19:00:00.000Z"; // noon in California
const args = process.argv.slice(2);
const WRITE = args.includes("--write");
const OUT = args.includes("--out") ? args[args.indexOf("--out") + 1] : null;

// .env.local into the environment, never printed. Variables already set win.
const envFile = join(ROOT, ".env.local");
if (existsSync(envFile)) {
  for (const line of readFileSync(envFile, "utf8").split("\n")) {
    const t = line.trim();
    if (!t || t.startsWith("#") || !t.includes("=")) continue;
    const i = t.indexOf("=");
    const k = t.slice(0, i).trim();
    if (!(k in process.env)) process.env[k] = t.slice(i + 1).trim().replace(/^"(.*)"$/, "$1");
  }
}
for (const k of ["SUPABASE_URL", "SUPABASE_SECRET_KEY", "PAYPAL_CLIENT_ID", "PAYPAL_CLIENT_SECRET"]) {
  if (!process.env[k]) { console.error(`${k} is not set (.env.local).`); process.exit(2); }
}
if (process.env.PAYPAL_ENVIRONMENT === "LIVE") { console.error("Refusing to run against LIVE PayPal."); process.exit(2); }

// The clock, frozen: new Date() and Date.now() answer FROZEN; dates built from a value are untouched.
const RealDate = Date;
class FrozenDate extends RealDate {
  constructor(...a) { if (a.length) super(...a); else super(FROZEN); }
  static now() { return RealDate.parse(FROZEN); }
}
globalThis.Date = FrozenDate;

// The text the PDF writes, page by page, captured from pdf-lib's drawText.
const drawn = [];
const req = createRequire(join(ROOT, "package.json"));
const patchPdfLib = (lib) => {
  if (!lib?.PDFPage || lib.PDFPage.prototype.__gfPatched) return;
  const orig = lib.PDFPage.prototype.drawText;
  lib.PDFPage.prototype.drawText = function (text, opts) { drawn.push(String(text)); return orig.call(this, text, opts); };
  lib.PDFPage.prototype.__gfPatched = true;
};
patchPdfLib(req("pdf-lib"));

const jiti = createJiti(import.meta.url, {
  alias: { "@": join(ROOT, "src"), "server-only": join(ROOT, "node_modules/server-only/empty.js") },
  moduleCache: true,
});
patchPdfLib(await jiti.import("pdf-lib"));
const lib = (name) => jiti.import(join(ROOT, "src/lib", `${name}.ts`));

const [rules, deductions, closeout, statement, statementPdf, tenantView, units, nextStep, ics, notices, ledger, refundView, copy, findings, inspect, agent, db, propertyView] =
  await Promise.all(["rules", "deductions", "closeout", "statement", "statement-pdf", "tenant-view", "units", "next-step", "ics", "notices", "ledger", "refund-view", "copy", "findings", "inspect", "agent", "db", "property-view"].map(lib));
// The whole pack (states/server.ts joins each pack's client and server halves); states/index.ts before the split; none
// before the packs existed.
const states = await lib("states/server").catch(() => lib("states/index")).catch(() => null);

// The California pack, once src/lib/states/ exists; before it, the functions took no pack. Each call below goes
// through `ca`, so the same script runs against the code before and after the refactor.
const CA = states ? states.packFor("CA") : null;
const ca = {
  evaluateLease: (t) => (CA ? rules.evaluateLease(t, CA) : rules.evaluateLease(t)),
  lawfulDeposit: (t) => (CA ? rules.lawfulDeposit(t, CA) : rules.lawfulDeposit(t)),
  smallLandlordExempt: (t) => rules.smallLandlordExempt(t),
  statementDue: (d) => (CA ? deductions.statementDue(d, CA) : deductions.statementDue(d)),
  missingDocs: (d, req) => (CA ? deductions.missingDocs(d, req, CA) : deductions.missingDocs(d, req)),
  settle: (h, ds) => (CA ? deductions.settle(h, ds, CA) : deductions.settle(h, ds)),
  rules: () => (CA ? closeout.rulesFor(CA) : closeout.RULES),
  disclaimers: () => (CA ? CA.copy.disclaimers : copy.DISCLAIMERS),
  tags: () => (CA ? CA.tags : copy.TAGS),
  kinds: () => (CA ? findings.kindsFor(CA) : findings.KIND),
  guide: () => (CA ? CA.ai.inspectionGuide : inspect.GUIDE),
  system: () => (CA ? agent.systemPrompt(CA) : agent.SYSTEM),
  receiptThreshold: () => (CA ? CA.documents.threshold : deductions.RECEIPT_THRESHOLD),
  photosFrom: () => (CA ? CA.moveIn.photosFrom : rules.MOVE_IN_PHOTOS_FROM),
  noticeInfo: () => (CA ? notices.noticeInfoFor(CA) : notices.NOTICE_INFO),
  noticeKinds: () => (CA ? notices.noticeKindsFor(CA) : notices.NOTICE_KINDS),
  refundNoticeStatus: (a, e) => (CA ? notices.refundNoticeStatus(a, e, CA) : notices.refundNoticeStatus(a, e)),
  inspectionWindowOpens: (d) => (CA ? notices.inspectionWindowOpens(d, CA) : notices.inspectionWindowOpens(d)),
  nextStep: (s, today) => nextStep.nextStep(s, today),
  events: (s) => ics.tenancyEvents(s),
};

const { db: client } = db;
const today = new Date().toLocaleDateString("en-CA", { timeZone: "America/Los_Angeles" });
const snap = { frozenAt: FROZEN, today };

// 1. The lease: each template's stored extraction (demo/lease-single-owner.pdf), and variants that walk every flag.
const { data: ts, error: tErr } = await client.from("tenancies").select("id, lease_terms").in("id", TEMPLATES);
if (tErr || ts?.length !== 2) { console.error("Couldn't read the two template tenancies:", tErr?.message ?? `${ts?.length ?? 0} found`); process.exit(2); }
const termsOf = Object.fromEntries(ts.map((t) => [t.id, t.lease_terms]));
const leaseOut = (t) => ({ flags: ca.evaluateLease(t), lawful: ca.lawfulDeposit(t), exempt: ca.smallLandlordExempt(t), totalSecurity: rules.totalSecurity(t) });
const base = termsOf[TEMPLATES[1]];
const variants = {
  stored: base,
  ownerUnknown: { ...base, ownerType: "unknown" },
  serviceMember: { ...base, tenantIsServiceMember: true },
  corporation: { ...base, ownerType: "corporation", ownerPropertyCount: 5, ownerUnitCount: 20 },
  llcBig: { ...base, ownerType: "llc_natural_persons", ownerPropertyCount: 3, ownerUnitCount: 4 },
  portfolioUnknown: { ...base, ownerPropertyCount: null },
  noRent: { ...base, monthlyRent: null },
  plain: { ...base, tenants: base.tenants.slice(0, 1), electronicPaymentMethods: [], lateFee: null, mandatoryCleaningClause: null,
    nonrefundableLanguage: [], otherMoveInCharges: [], securityDeposit: 2000, tenancyStartDate: "2025-01-01" },
  lateFeePercent: { ...base, lateFee: { amount: null, percentOfRent: 5, deductibleFromDeposit: false, quote: "5% of the monthly rent" } },
  noDepositLine: { ...base, securityDeposit: null },
  underCap: { ...base, ownerType: "llc_natural_persons", ownerPropertyCount: 2, ownerUnitCount: 4, securityDeposit: 1000, otherMoveInCharges: [] },
};
snap.lease = {
  templates: Object.fromEntries(TEMPLATES.map((id) => [id, { terms: termsOf[id], ...leaseOut(termsOf[id]) }])),
  variants: Object.fromEntries(Object.entries(variants).map(([k, t]) => [k, leaseOut(t)])),
};

// 2. Deadlines, documents and the refund math.
const days = ["2026-10-01", "2026-09-30", "2026-02-10", "2026-02-28", "2024-02-20", "2026-12-20", "2027-01-01"];
snap.deadlines = {
  statementDue: Object.fromEntries(days.map((d) => [d, ca.statementDue(d)])),
  inspectionWindowOpens: Object.fromEntries(days.map((d) => [d, ca.inspectionWindowOpens(d)])),
};
const { data: drows } = await client.from("deductions").select("*").in("tenancy_id", TEMPLATES).order("created_at");
const { data: pays } = await client.from("payments").select("*").in("tenancy_id", TEMPLATES).order("created_at");
const depositOf = (id) => Number((pays ?? []).find((p) => p.tenancy_id === id && p.kind === "deposit_invoice")?.amount ?? 0);
const dedsOf = (id) => (drows ?? []).filter((d) => d.tenancy_id === id).map((d) => ({ ...d, amount: Number(d.amount) }));
snap.deductions = Object.fromEntries(TEMPLATES.map((id) => {
  const ds = dedsOf(id);
  return [id, {
    rows: ds.map((d) => ({
      id: d.id, item: d.item, amount: d.amount, missingRequired: ca.missingDocs(d, true), missingNotRequired: ca.missingDocs(d, false),
      basisOf: deductions.basisOf(d), chargeTitle: deductions.chargeTitle(d.item, d.work),
    })),
    settle: ca.settle(depositOf(id), ds),
    settleNone: ca.settle(depositOf(id), []),
    settleOver: ca.settle(100, ds),
  }];
}));
snap.deductions.thresholds = [100, 125, 125.01, 126].map((n) => ca.settle(1000, [{ category: "damage", amount: n }]));
snap.deductions.chargeable = [
  { category: "damage", work: "repair", performer: "vendor", invoiceTotal: 140, proration: "none" },
  { category: "cleaning", work: "clean", performer: "own_labor", hours: 3, hourlyRate: 50, proration: "none" },
  { category: "damage", work: "replace", performer: "vendor", invoiceTotal: 1800, proration: "useful_life", itemAgeYears: 6, usefulLifeYears: 10 },
  ...[0.25, 0.75, 1.5, 3].map((age) => ({ category: "damage", work: "repair", performer: "vendor", invoiceTotal: 300, proration: "paint_schedule", itemAgeYears: age })),
  { category: "damage", work: "repair", performer: "vendor", proration: "none" },
].map((d) => deductions.chargeable(d));

// 3. The close-out facts and plan, the statement and its checklist, the PDF's text, the tenant view, the refund page.
snap.closeOut = {};
snap.statement = {};
snap.checklist = {};
snap.pdf = {};
snap.tenantView = {};
snap.refundView = {};
for (const id of TEMPLATES) {
  snap.closeOut[id] = await closeout.closeOutFacts(id);
  const s = await statement.buildStatement(id);
  snap.statement[id] = s;
  snap.checklist[id] = await statement.statementChecklist(id);
  drawn.length = 0;
  const pdf = await statementPdf.buildStatementPdf(s);
  snap.pdf[id] = { pages: pdf.pages, filename: pdf.filename, text: [...drawn] };
  snap.tenantView[id] = await tenantView.loadTenantView(id);
  snap.refundView[id] = await refundView.loadRefundView(id);
}

// 4. Next steps, the status chip, the calendar: each template as stored, and its summary walked through every stage.
const summaries = {};
for (const id of TEMPLATES) summaries[id] = await units.loadUnit(id);
const s0 = summaries[TEMPLATES[1]];
const stage = {
  stored0: summaries[TEMPLATES[0]],
  stored1: s0,
  notMovedOut: { ...s0, moveOutDate: null, moveOutPhotos: 0, moveOutInspectedAt: null },
  noticeNoNotices: { ...s0, moveOutDate: null, notices: {} },
  noticeNoRefundNotice: { ...s0, moveOutDate: null, agreement: false, notices: { inspection: s0.notices?.inspection ?? { date: "2026-09-02", method: "mail", to: null, recorded_at: FROZEN } },
    refundNotice: ca.refundNoticeStatus(null, { kind: "paid", text: "The security was paid electronically through PayPal invoice INV2-TEST" }) },
  noticeNoDates: { ...s0, moveOutDate: null, plannedMoveOut: null, endDate: null },
  tenantSaidMovingOut: { ...s0, moveOutDate: null, noticeGivenOn: null, tenantMoveOut: { name: "A tenant", plannedMoveOut: "2026-11-30", forwardingAddress: "1 Main St, Irvine, CA 92618", sentOn: "2026-10-01" } },
  movedOutNoPhotos: { ...s0, moveOutPhotos: 0, moveOutInspectedAt: null },
  movedOutNotInspected: { ...s0, moveOutInspectedAt: null },
  refundedNotDelivered: { ...s0, returned: { amount: 3790, kind: "refund" } },
  deliveredNotRefunded: { ...s0, statementDeliveredAt: "2026-10-02T18:00:00.000Z" },
  noAgreement: { ...s0, moveOutDate: null, noticeGivenOn: null, plannedMoveOut: null, tenantMoveOut: null, agreement: false },
  noInvoice: { ...s0, moveOutDate: null, noticeGivenOn: null, plannedMoveOut: null, tenantMoveOut: null, deposit: null },
  unpaid: { ...s0, moveOutDate: null, noticeGivenOn: null, plannedMoveOut: null, tenantMoveOut: null, deposit: { amount: 4800, status: "SENT", paypalId: "INV2-TEST" } },
  noMoveInPhotos: { ...s0, moveOutDate: null, noticeGivenOn: null, plannedMoveOut: null, tenantMoveOut: null, moveInPhotos: 0 },
  oldNoMoveInPhotos: { ...s0, moveOutDate: null, noticeGivenOn: null, plannedMoveOut: null, tenantMoveOut: null, moveInPhotos: 0, startDate: "2025-01-01" },
  futureNoPhotos: { ...s0, moveOutDate: null, noticeGivenOn: null, plannedMoveOut: null, tenantMoveOut: null, moveInPhotos: 0, startDate: "2026-11-01" },
  leaseEndingSoon: { ...s0, moveOutDate: null, noticeGivenOn: null, plannedMoveOut: null, tenantMoveOut: null, endDate: "2026-11-15" },
  leaseEndingLater: { ...s0, moveOutDate: null, noticeGivenOn: null, plannedMoveOut: null, tenantMoveOut: null, endDate: "2027-06-30" },
  leaseEnded: { ...s0, moveOutDate: null, noticeGivenOn: null, plannedMoveOut: null, tenantMoveOut: null, endDate: "2026-09-01" },
  monthToMonth: { ...s0, moveOutDate: null, noticeGivenOn: null, plannedMoveOut: null, tenantMoveOut: null, endDate: null },
};
snap.nextSteps = Object.fromEntries(Object.entries(stage).map(([k, s]) => {
  const n = ca.nextStep(s, today);
  return [k, { next: n, status: propertyView.propertyStatus(s, n), link: propertyView.stepLink(s, n), events: ca.events(s) }];
}));
snap.summaries = summaries;

// 5. The ledger rows and totals.
const { data: lts } = await client.from("tenancies").select("id, tenants, monthly_rent, move_out_date, statement_delivered_at, lease_terms, properties(address, city)").in("id", TEMPLATES).order("created_at");
const lrows = (lts ?? []).flatMap((t) => ledger.ledgerRows(t, (pays ?? []).filter((p) => p.tenancy_id === t.id), (drows ?? []).filter((d) => d.tenancy_id === t.id)));
snap.ledger = { rows: lrows, totals: ledger.ledgerTotals(lrows) };

// 6. Notices, the citations the agent may use, the copy and the prompts.
snap.notices = {
  kinds: ca.noticeKinds(),
  info: ca.noticeInfo(),
  abandonedProperty: notices.ABANDONED_PROPERTY_TEXT,
  refundNoticeStatus: [
    ca.refundNoticeStatus({ paypalEmail: "tenant@example.com", signedBy: ["A", "B"], signedAt: "2025-10-01T17:00:00Z" }, null),
    ca.refundNoticeStatus(null, { kind: "paid", text: "The security was paid electronically through PayPal invoice INV2-TEST" }),
    ca.refundNoticeStatus(null, { kind: "lease", text: "The lease provides for electronic payment (PayPal)" }),
    ca.refundNoticeStatus(null, null),
  ],
};
snap.constants = {
  rules: ca.rules(), disclaimers: ca.disclaimers(), tags: ca.tags(), kinds: ca.kinds(), receiptThreshold: ca.receiptThreshold(),
  moveInPhotosFrom: ca.photosFrom(), refundWindowDays: closeout.REFUND_WINDOW_DAYS,
};
snap.prompts = { closeOut: ca.system(), inspectionGuide: ca.guide() };

// The fields the refactor adds to California models on purpose: which state's law they follow ("CA") on three of them,
// and below, three more on the unit summary. They are dropped here and counted, so every other byte must match.
const ADDED = [];
for (const [section, models] of [["statement", snap.statement], ["tenantView", snap.tenantView], ["summaries", snap.summaries]]) {
  for (const [id, m] of Object.entries(models ?? {})) {
    if (m && typeof m === "object" && "state" in m) {
      if (m.state !== "CA") { console.error(`${section}.${id}.state is ${m.state}, not CA.`); process.exit(1); }
      delete m.state;
      ADDED.push(`${section}.${id}.state`);
    }
  }
}
// The summary also carries, for every state, who gave the notice to end the tenancy and the unit counts from the lease
// (New York's and Florida's rules read them; California's read none). Dropped and counted the same way.
const SUMMARY_ADDED = ["noticeGivenBy", "landlordUnits", "buildingUnits"];
for (const [id, m] of Object.entries(snap.summaries ?? {})) {
  for (const k of SUMMARY_ADDED) if (m && typeof m === "object" && k in m) { delete m[k]; ADDED.push(`summaries.${id}.${k}`); }
}

// Emails become a short hash; keys are sorted so the file diffs cleanly.
const EMAIL = /[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}/g;
const redact = (s) => s.replace(EMAIL, (m) => `email#${createHash("sha256").update(m.toLowerCase()).digest("hex").slice(0, 10)}`);
const norm = (v) => {
  if (v instanceof RealDate) return v.toISOString();
  if (typeof v === "string") return redact(v);
  if (Array.isArray(v)) return v.map(norm);
  if (v && typeof v === "object") return Object.fromEntries(Object.keys(v).sort().filter((k) => v[k] !== undefined).map((k) => [k, norm(v[k])]));
  return v;
};
const out = norm(JSON.parse(JSON.stringify(snap)));
const text = `${JSON.stringify(out, null, 2)}\n`;
if (OUT) writeFileSync(OUT, text);

if (WRITE) {
  mkdirSync(dirname(FIXTURE), { recursive: true });
  writeFileSync(FIXTURE, text);
  console.log(`Wrote the California baseline: ${FIXTURE.replace(`${ROOT}/`, "")} (${text.length} bytes).`);
  process.exit(0);
}
if (!existsSync(FIXTURE)) { console.error("No baseline yet. Run with --write on the code to compare against."); process.exit(2); }
const want = JSON.parse(readFileSync(FIXTURE, "utf8"));
const diffs = [];
const walk = (a, b, path) => {
  if (diffs.length > 60) return;
  if (JSON.stringify(a) === JSON.stringify(b)) return;
  if (a && b && typeof a === "object" && typeof b === "object" && Array.isArray(a) === Array.isArray(b)) {
    for (const k of new Set([...Object.keys(a), ...Object.keys(b)])) walk(a[k], b[k], `${path}.${k}`);
    return;
  }
  diffs.push(`${path}\n    was: ${JSON.stringify(a)?.slice(0, 400)}\n    now: ${JSON.stringify(b)?.slice(0, 400)}`);
};
walk(want, out, "snapshot");
const sections = Object.keys(want).filter((k) => JSON.stringify(want[k]) === JSON.stringify(out[k]));
if (!diffs.length) {
  console.log(`California snapshot identical: ${sections.length} sections (${sections.join(", ")}), ${text.length} bytes.`);
  if (ADDED.length) console.log(`Intended additions left out of the comparison (state = "CA", and the summary's notice giver and unit counts): ${ADDED.join(", ")}.`);
  process.exit(0);
}
console.log(`California snapshot DIFFERS in ${diffs.length}${diffs.length > 60 ? "+" : ""} place(s):\n`);
if (diffs.every((d) => d.startsWith("snapshot.pdf."))) console.log("  (Only the PDF's text differs: a storage download can fail now and then. Run it again before reading more into it.)\n");
for (const d of diffs) console.log(`  ${d}`);
process.exit(1);

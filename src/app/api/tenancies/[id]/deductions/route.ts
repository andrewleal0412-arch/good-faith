import { todayIn } from "@/lib/dates";
import { audit, db } from "@/lib/db";
import { checkAdd, rangeBreach } from "@/lib/deduction-edit";
import { deductionsLocked, disputeFacts } from "@/lib/disputes";
import { type Performer, type Proration, type Work } from "@/lib/deductions";
import { lawfulRanges, type RangeDeduction } from "@/lib/lawful-range";
import { loadPdf, PdfTooBig } from "@/lib/pdf-guard";
import { imageType, notAPhotoServer, readForm, sniff, UNREADABLE } from "@/lib/images";
import { takeAllowance, uploadUnits } from "@/lib/limits";
import { nextStep } from "@/lib/next-step";
import { packFor } from "@/lib/states";
import { loadUnit } from "@/lib/units";
import { AFTER_PHOTOS_MAX, mb, UPLOAD_BUDGET } from "@/lib/uploads";
import { mayRemove, routeTenancy, uploadPrefix } from "@/lib/workspace";

export const runtime = "nodejs";
export const maxDuration = 60;

// Text fields accept text only (a file sent under a text name is ignored) and lose control characters, which
// Postgres refuses inside jsonb.
const str = (v: FormDataEntryValue | null) => (typeof v === "string" ? v.replace(/[\u0000-\u001f]/g, " ").trim() : "");

// One deduction from one inspection finding (damage or cleaning; California Civ. Code 1950.5(b)(2), (b)(3)). The landlord supplies
// the facts (invoice or labor, the item's age, receipt, after-repair photos); the amount is computed here from them,
// so the statement's numbers always match its explanation. Ordinary wear and tear can't be deducted at all. The
// inputs are held as the grid's edits are (src/lib/deduction-edit.ts): each within its bounds, the amount chargeable()'s
// own, a carpet's life no longer than the guidance's, then the lawful range run again with the new line in place, so
// a line the grid would refuse can't be added by the form, another tab or a hand-made request either.
export async function POST(req: Request, ctx: RouteContext<"/api/tenancies/[id]/deductions">) {
  const { id } = await ctx.params;
  const ws = await routeTenancy(id, { write: true });
  if (ws instanceof Response) return ws;
  const form = await readForm(req);
  if (!form) return Response.json({ error: UNREADABLE }, { status: 400 });
  // The files first, by count and size, before anything is read from the database. The messages are the browser's
  // own (src/app/(landlord)/tenancy/[id]/deduction-form.tsx).
  const receipts = form.getAll("receipt").filter((f): f is File => f instanceof File && f.size > 0);
  const afters = form.getAll("after").filter((f): f is File => f instanceof File && f.size > 0);
  if (receipts.length > 1) return Response.json({ error: "Add one receipt per deduction." }, { status: 400 });
  if (afters.length > AFTER_PHOTOS_MAX) return Response.json({ error: `Add at most ${AFTER_PHOTOS_MAX} after-repair photos.` }, { status: 400 });
  const bytes = [...receipts, ...afters].reduce((n, f) => n + f.size, 0);
  if (bytes > UPLOAD_BUDGET) {
    return Response.json({ error: `The receipt and photos total ${mb(bytes)}; one deduction can carry ${mb(UPLOAD_BUDGET)}. Add fewer after-repair photos, or a smaller receipt.` }, { status: 413 });
  }
  const receipt = receipts[0] ?? null;
  const findingId = str(form.get("findingId"));

  const { data: t } = await db.from("tenancies").select("move_out_findings, properties(state)").eq("id", id).single();
  if (!t) return Response.json({ error: "No such tenancy." }, { status: 404 });
  const finding = ((t.move_out_findings ?? []) as { id?: string; room: string; item: string; classification: string;
    moveInPath: string; moveOutPath: string; status?: string | null }[]).find((f) => f.id === findingId);
  if (!finding) return Response.json({ error: "That finding is from an older comparison. Refresh the page." }, { status: 400 });
  const locked = await deductionsLocked(id);
  if (locked) return locked;
  if (finding.status === "dismissed") return Response.json({ error: "That finding was dismissed. Reopen it first." }, { status: 400 });
  if (finding.classification === "wear_and_tear") {
    return Response.json({ error: packFor((t.properties as { state?: string | null } | null)?.state).copy.wearRefused }, { status: 400 });
  }

  const work = str(form.get("work")) as Work, performer = str(form.get("performer")) as Performer;
  const proration = (str(form.get("proration")) || "none") as Proration;
  if (!["repair", "replace", "clean", "other"].includes(work)) return Response.json({ error: "Say what was done." }, { status: 400 });
  if (!["vendor", "own_labor"].includes(performer)) return Response.json({ error: "Say who did the work." }, { status: 400 });
  if (!["none", "useful_life", "paint_schedule"].includes(proration)) return Response.json({ error: "Say how the cost is prorated." }, { status: 400 });
  const facts = await disputeFacts(id);
  if (!facts) return Response.json({ error: "No such tenancy." }, { status: 404 });
  if (facts.deductions.some((d) => d.finding?.id === findingId)) {
    return Response.json({ error: "This finding already has a deduction. Change that one in the grid, or remove it first." }, { status: 409 });
  }
  const a = checkAdd(finding.item, {
    category: finding.classification === "cleaning" ? "cleaning" : "damage", work, performer, proration,
    invoiceTotal: str(form.get("invoiceTotal")), hours: str(form.get("hours")), hourlyRate: str(form.get("hourlyRate")),
    itemAgeYears: str(form.get("itemAgeYears")), usefulLifeYears: str(form.get("usefulLifeYears")),
  }, facts.pack.copy.guidanceCite);
  if (!a.ok) return Response.json({ error: a.reason, cite: a.cite, field: a.field }, { status: a.cite ? 422 : 400 });
  const { input } = a;
  const vendor = input.performer === "vendor"
    ? { name: str(form.get("vendorName")) || undefined, address: str(form.get("vendorAddress")) || undefined, phone: str(form.get("vendorPhone")) || undefined }
    : null;
  // Why the work was done, in the landlord's words: it goes on the statement with the cost as part of the written
  // explanation ((h)(2)(D)), e.g. that cleaning was tried before the carpet was replaced.
  const note = str(form.get("note")).slice(0, 600) || null;
  // The lawful range with this line on the statement: a bar (a late statement that forfeits every charge, a state's
  // own) or a cap the new amount would break refuses it with the range's reason, as an edit is refused.
  const line: RangeDeduction = {
    id: "new", category: input.category, room: finding.room, item: finding.item, work: input.work, performer: input.performer,
    amount: a.amount, math: a.math, proration: input.proration, is_estimate: form.get("isEstimate") === "true",
    receipt_path: receipt ? "pending" : null, after_photo_paths: afters.map(() => "pending"), vendor,
    labor_description: input.performer === "own_labor" ? str(form.get("laborDescription")) || null : null, note, finding,
    billed: input.performer === "vendor" ? input.invoiceTotal ?? null : (input.hours ?? 0) * (input.hourlyRate ?? 0),
    hours: input.performer === "own_labor" ? input.hours ?? null : null, hourly_rate: input.performer === "own_labor" ? input.hourlyRate ?? null : null,
    item_age_years: input.itemAgeYears ?? null, useful_life_years: input.usefulLifeYears ?? null,
  };
  const after = lawfulRanges({ ...facts.rangeInput, deductions: [...facts.rangeInput.deductions, line] }, facts.pack);
  const breach = rangeBreach(after.lines.find((l) => l.id === line.id) ?? { flags: [], amount: 0 });
  if (breach) return Response.json({ error: breach.reason, cite: breach.cite, field: null }, { status: 422 });

  // Receipt (vendor bill or materials) and after-repair photos (AB 2801, (g)(2)) go to private buckets. Every file is
  // checked against its bytes before anything is stored (src/lib/images.ts), so a refused file leaves nothing behind:
  // the receipt is a PDF or a photo, by its signature, whatever the browser declared.
  let receiptBytes: Uint8Array | null = null, receiptType = "application/pdf";
  if (receipt) {
    receiptBytes = new Uint8Array(await receipt.arrayBuffer());
    const signed = sniff(receiptBytes);
    if (signed === "application/pdf") {
      // The packet loads it again on every download, so a PDF pdf-lib can't load within its limits isn't kept.
      receiptType = signed;
      const why = await loadPdf(receiptBytes).then(() => null, (e) => (e instanceof PdfTooBig ? e.message : "It couldn't be read."));
      if (why) return Response.json({ error: `${receipt.name} can't be used as the receipt. ${why} Save it again as a PDF, or add a photo of it.` }, { status: 400 });
    } else if (signed) {
      const type = await imageType(receiptBytes);
      if (!type) return Response.json({ error: notAPhotoServer(receipt.name) }, { status: 400 });
      receiptType = type;
    } else {
      return Response.json({ error: `${receipt.name} isn't a PDF or a photo. Add the receipt as a PDF or a photo.` }, { status: 400 });
    }
  }
  const afterFiles: { bytes: Uint8Array; type: string }[] = [];
  for (const f of afters) {
    const bytes = new Uint8Array(await f.arrayBuffer());
    const type = await imageType(bytes);
    if (!type) return Response.json({ error: notAPhotoServer(f.name) }, { status: 400 });
    afterFiles.push({ bytes, type });
  }
  // Today's allowance of stored upload megabytes, as for photos (src/lib/limits.ts).
  const stored = (receiptBytes?.length ?? 0) + afterFiles.reduce((n, f) => n + f.bytes.length, 0);
  if (stored) {
    const run = await takeAllowance("upload_mb", uploadUnits(stored));
    if (run.refused) return run.refused;
  }
  let receiptPath: string | null = null;
  if (receipt && receiptBytes) {
    const ext = receiptType.slice(receiptType.indexOf("/") + 1);
    receiptPath = `${uploadPrefix(ws)}${id}/${crypto.randomUUID()}.${ext}`;
    const up = await db.storage.from("receipts").upload(receiptPath, receiptBytes, { contentType: receiptType });
    if (up.error) {
      console.error("receipt upload failed", up.error.message);
      return Response.json({ error: "Couldn't store the receipt. Try again." }, { status: 500 });
    }
  }
  const afterPaths: string[] = [];
  for (const { bytes, type } of afterFiles) {
    const path = `${uploadPrefix(ws)}${id}/move_out_after/${crypto.randomUUID()}.${type.slice("image/".length)}`;
    const up = await db.storage.from("photos").upload(path, bytes, { contentType: type });
    if (up.error) {
      console.error("after-repair photo upload failed", up.error.message);
      return Response.json({ error: "Couldn't store the after-repair photo. Try again." }, { status: 500 });
    }
    afterPaths.push(path);
  }
  if (afterPaths.length) {
    await db.from("photos").insert(afterPaths.map((p) => ({ tenancy_id: id, phase: "move_out_after", room: finding.room, storage_path: p, caption: finding.item })));
  }

  const { data: row, error } = await db.from("deductions").insert({
    tenancy_id: id, category: input.category, room: finding.room, item: finding.item, finding,
    work: input.work, performer: input.performer, billed: input.performer === "vendor" ? input.invoiceTotal : (input.hours ?? 0) * (input.hourlyRate ?? 0),
    hours: input.performer === "own_labor" ? input.hours : null, hourly_rate: input.performer === "own_labor" ? input.hourlyRate : null,
    labor_description: input.performer === "own_labor" ? str(form.get("laborDescription")) || null : null,
    note,
    vendor, proration: input.proration, item_age_years: input.itemAgeYears, useful_life_years: input.usefulLifeYears,
    amount: a.amount, math: a.math, is_estimate: form.get("isEstimate") === "true",
    receipt_path: receiptPath, after_photo_paths: afterPaths,
  }).select("id").single();
  if (error) {
    console.error("deduction insert failed", error.message);
    return Response.json({ error: "Couldn't save the deduction. Try again." }, { status: 500 });
  }

  await audit(id, "landlord", "deduction_added", { item: finding.item, room: finding.room, category: input.category, amount: a.amount, math: a.math, guidance: a.guidance });
  return Response.json({ id: row.id, amount: a.amount, math: a.math });
}

// Remove every deduction at once: only while the tenancy's next step asks for it (New York after day 14, or Florida once
// the 30 days for the claim notice ran out, in both with no dispute open and none of them to be kept; the step's
// removeDeductions, next-step.ts), which is the only time the Move-out
// tab offers it. Each line goes exactly as its own Remove takes it (DELETE .../deductions/[did]): refused for a template
// and once the deductions are final or while a dispute the tenants sent is open (deductionsLocked), its receipt removed
// only when this workspace stored it, the after-repair photos kept, and one deduction_removed entry per line.
export async function DELETE(_req: Request, ctx: RouteContext<"/api/tenancies/[id]/deductions">) {
  const { id } = await ctx.params;
  const ws = await routeTenancy(id, { write: true });
  if (ws instanceof Response) return ws;
  const { data } = await db.from("deductions").select("id, item, amount, receipt_path").eq("tenancy_id", id).order("created_at");
  const rows = (data ?? []) as { id: string; item: string; amount: number | string; receipt_path: string | null }[];
  if (!rows.length) return Response.json({ error: "There are no deductions to remove." }, { status: 404 });
  const locked = await deductionsLocked(id);
  if (locked) return locked;
  const unit = await loadUnit(id);
  if (!unit || !nextStep(unit, todayIn(packFor(unit.state).timeZone.id)).removeDeductions) {
    return Response.json({ error: "The deductions come off all at once only when none of them may be kept. To remove one, use its row's menu." }, { status: 409 });
  }
  // Only the lines read above; a receipt and an entry only for a line that did go.
  const { data: gone, error } = await db.from("deductions").delete().eq("tenancy_id", id).in("id", rows.map((d) => d.id)).select("id");
  if (error) {
    console.error("deductions delete failed", error.message);
    return Response.json({ error: "Couldn't remove the deductions. Try again." }, { status: 500 });
  }
  const removed = rows.filter((d) => (gone ?? []).some((g) => g.id === d.id));
  const receipts: string[] = [];
  for (const d of removed) if (d.receipt_path && (await mayRemove(ws, id, d.receipt_path))) receipts.push(d.receipt_path);
  if (receipts.length) await db.storage.from("receipts").remove(receipts);
  for (const d of removed) await audit(id, "landlord", "deduction_removed", { item: d.item, amount: Number(d.amount) });
  return Response.json({ ok: true, removed: removed.length });
}

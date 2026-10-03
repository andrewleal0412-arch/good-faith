import { audit, db } from "@/lib/db";
import { chargeable, type DeductionInput, type Performer, type Proration, type Work } from "@/lib/deductions";
import { imageType, notAPhotoServer } from "@/lib/images";

export const runtime = "nodejs";
export const maxDuration = 60;

// Text fields accept text only (a file sent under a text name is ignored) and lose control characters, which
// Postgres refuses inside jsonb.
const str = (v: FormDataEntryValue | null) => (typeof v === "string" ? v.replace(/[\u0000-\u001f]/g, " ").trim() : "");
const num = (v: FormDataEntryValue | null) => (str(v) === "" ? null : Number(str(v)));

// One deduction from one inspection finding (Civ. Code 1950.5(b)(2) damage, (b)(3) cleaning). The landlord supplies
// the facts (invoice or labor, the item's age, receipt, after-repair photos); the amount is computed here from them,
// so the statement's numbers always match its explanation. Ordinary wear and tear can't be deducted at all.
export async function POST(req: Request, ctx: RouteContext<"/api/tenancies/[id]/deductions">) {
  const { id } = await ctx.params;
  const form = await req.formData();
  const findingId = str(form.get("findingId"));

  const { data: t } = await db.from("tenancies").select("move_out_findings").eq("id", id).single();
  if (!t) return Response.json({ error: "No such tenancy." }, { status: 404 });
  const finding = ((t.move_out_findings ?? []) as { id?: string; room: string; item: string; classification: string;
    moveInPath: string; moveOutPath: string; status?: string | null }[]).find((f) => f.id === findingId);
  if (!finding) return Response.json({ error: "That finding is from an older inspection. Refresh the page." }, { status: 400 });
  const { data: sent } = await db.from("payments").select("id").eq("tenancy_id", id).in("kind", ["refund", "payout"]).limit(1);
  if (sent?.length) return Response.json({ error: "The deposit has already been returned, so the deductions are final." }, { status: 409 });
  if (finding.status === "dismissed") return Response.json({ error: "That finding was dismissed. Reopen it first." }, { status: 400 });
  if (finding.classification === "wear_and_tear") {
    return Response.json({ error: "Ordinary wear and tear can't be deducted (Civ. Code 1950.5(b)(2), (e)(1)-(2))." }, { status: 400 });
  }

  const input: DeductionInput = {
    category: finding.classification === "cleaning" ? "cleaning" : "damage",
    work: str(form.get("work")) as Work,
    performer: str(form.get("performer")) as Performer,
    invoiceTotal: num(form.get("invoiceTotal")),
    hours: num(form.get("hours")),
    hourlyRate: num(form.get("hourlyRate")),
    proration: (str(form.get("proration")) || "none") as Proration,
    itemAgeYears: num(form.get("itemAgeYears")),
    usefulLifeYears: num(form.get("usefulLifeYears")),
  };
  if (!["repair", "replace", "clean", "other"].includes(input.work)) return Response.json({ error: "Say what was done." }, { status: 400 });
  if (!["vendor", "own_labor"].includes(input.performer)) return Response.json({ error: "Say who did the work." }, { status: 400 });
  const c = chargeable(input);
  if ("error" in c) return Response.json({ error: c.error }, { status: 400 });

  // Receipt (vendor bill or materials) and after-repair photos (AB 2801, (g)(2)) go to private buckets. Every image is
  // checked against its bytes before anything is stored (src/lib/images.ts), so a refused file leaves nothing behind.
  const receipt = form.get("receipt");
  let receiptBytes: Uint8Array | null = null, receiptType = "application/pdf";
  if (receipt instanceof File && receipt.size) {
    receiptBytes = new Uint8Array(await receipt.arrayBuffer());
    if (receipt.type.startsWith("image/")) {
      const type = await imageType(receiptBytes);
      if (!type) return Response.json({ error: notAPhotoServer(receipt.name) }, { status: 400 });
      receiptType = type;
    } else if (receipt.type) {
      receiptType = receipt.type;
    }
  }
  const afterFiles: { bytes: Uint8Array; type: string }[] = [];
  for (const f of form.getAll("after").filter((f): f is File => f instanceof File && f.type.startsWith("image/"))) {
    const bytes = new Uint8Array(await f.arrayBuffer());
    const type = await imageType(bytes);
    if (!type) return Response.json({ error: notAPhotoServer(f.name) }, { status: 400 });
    afterFiles.push({ bytes, type });
  }
  let receiptPath: string | null = null;
  if (receipt instanceof File && receiptBytes) {
    const ext = receiptType.startsWith("image/") ? receiptType.slice("image/".length) : (receipt.name.split(".").pop() || "pdf").toLowerCase();
    receiptPath = `${id}/${crypto.randomUUID()}.${ext}`;
    const up = await db.storage.from("receipts").upload(receiptPath, receiptBytes, { contentType: receiptType });
    if (up.error) return Response.json({ error: up.error.message }, { status: 500 });
  }
  const afterPaths: string[] = [];
  for (const { bytes, type } of afterFiles) {
    const path = `${id}/move_out_after/${crypto.randomUUID()}.${type.slice("image/".length)}`;
    const up = await db.storage.from("photos").upload(path, bytes, { contentType: type });
    if (up.error) return Response.json({ error: up.error.message }, { status: 500 });
    afterPaths.push(path);
  }
  if (afterPaths.length) {
    await db.from("photos").insert(afterPaths.map((p) => ({ tenancy_id: id, phase: "move_out_after", room: finding.room, storage_path: p, caption: finding.item })));
  }

  const vendor = input.performer === "vendor"
    ? { name: str(form.get("vendorName")) || undefined, address: str(form.get("vendorAddress")) || undefined, phone: str(form.get("vendorPhone")) || undefined }
    : null;
  // Why the work was done, in the landlord's words: it goes on the statement with the cost as part of the written
  // explanation ((h)(2)(D)), e.g. that cleaning was tried before the carpet was replaced.
  const note = str(form.get("note")).slice(0, 600) || null;
  const { data: row, error } = await db.from("deductions").insert({
    tenancy_id: id, category: input.category, room: finding.room, item: finding.item, finding,
    work: input.work, performer: input.performer, billed: input.performer === "vendor" ? input.invoiceTotal : (input.hours ?? 0) * (input.hourlyRate ?? 0),
    hours: input.performer === "own_labor" ? input.hours : null, hourly_rate: input.performer === "own_labor" ? input.hourlyRate : null,
    labor_description: input.performer === "own_labor" ? str(form.get("laborDescription")) || null : null,
    note,
    vendor, proration: input.proration, item_age_years: input.itemAgeYears, useful_life_years: input.usefulLifeYears,
    amount: c.amount, math: c.math, is_estimate: form.get("isEstimate") === "true",
    receipt_path: receiptPath, after_photo_paths: afterPaths,
  }).select("id").single();
  if (error) return Response.json({ error: error.message }, { status: 500 });

  await audit(id, "landlord", "deduction_added", { item: finding.item, room: finding.room, category: input.category, amount: c.amount, math: c.math, guidance: c.guidance });
  return Response.json({ id: row.id, amount: c.amount, math: c.math });
}

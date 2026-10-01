import { audit, db } from "@/lib/db";
import { chargeable, type DeductionInput, type Performer, type Proration, type Work } from "@/lib/deductions";

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
    moveInPath: string; moveOutPath: string }[]).find((f) => f.id === findingId);
  if (!finding) return Response.json({ error: "That finding is from an older inspection. Refresh the page." }, { status: 400 });
  if (finding.classification === "wear_and_tear") {
    return Response.json({ error: "Ordinary wear and tear can't be deducted (Civ. Code 1950.5(b)(2), (e))." }, { status: 400 });
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

  // Receipt (vendor bill or materials) and after-repair photos (AB 2801, (g)(2)) go to private buckets.
  const receipt = form.get("receipt");
  let receiptPath: string | null = null;
  if (receipt instanceof File && receipt.size) {
    const ext = (receipt.name.split(".").pop() || "pdf").toLowerCase();
    receiptPath = `${id}/${crypto.randomUUID()}.${ext}`;
    const up = await db.storage.from("receipts").upload(receiptPath, new Uint8Array(await receipt.arrayBuffer()), { contentType: receipt.type || "application/pdf" });
    if (up.error) return Response.json({ error: up.error.message }, { status: 500 });
  }
  const afterPaths: string[] = [];
  for (const f of form.getAll("after").filter((f): f is File => f instanceof File && f.type.startsWith("image/"))) {
    const ext = (f.name.split(".").pop() || "jpg").toLowerCase();
    const path = `${id}/move_out_after/${crypto.randomUUID()}.${ext}`;
    const up = await db.storage.from("photos").upload(path, new Uint8Array(await f.arrayBuffer()), { contentType: f.type });
    if (up.error) return Response.json({ error: up.error.message }, { status: 500 });
    afterPaths.push(path);
  }
  if (afterPaths.length) {
    await db.from("photos").insert(afterPaths.map((p) => ({ tenancy_id: id, phase: "move_out_after", room: finding.room, storage_path: p, caption: finding.item })));
  }

  const vendor = input.performer === "vendor"
    ? { name: str(form.get("vendorName")) || undefined, address: str(form.get("vendorAddress")) || undefined, phone: str(form.get("vendorPhone")) || undefined }
    : null;
  const { data: row, error } = await db.from("deductions").insert({
    tenancy_id: id, category: input.category, room: finding.room, item: finding.item, finding,
    work: input.work, performer: input.performer, billed: input.performer === "vendor" ? input.invoiceTotal : (input.hours ?? 0) * (input.hourlyRate ?? 0),
    hours: input.performer === "own_labor" ? input.hours : null, hourly_rate: input.performer === "own_labor" ? input.hourlyRate : null,
    labor_description: input.performer === "own_labor" ? str(form.get("laborDescription")) || null : null,
    vendor, proration: input.proration, item_age_years: input.itemAgeYears, useful_life_years: input.usefulLifeYears,
    amount: c.amount, math: c.math, is_estimate: form.get("isEstimate") === "true",
    receipt_path: receiptPath, after_photo_paths: afterPaths,
  }).select("id").single();
  if (error) return Response.json({ error: error.message }, { status: 500 });

  await audit(id, "landlord", "deduction_added", { item: finding.item, room: finding.room, category: input.category, amount: c.amount, math: c.math, guidance: c.guidance });
  return Response.json({ id: row.id, amount: c.amount, math: c.math });
}

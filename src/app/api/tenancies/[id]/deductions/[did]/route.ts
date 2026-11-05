import { audit, db } from "@/lib/db";
import { checkEdit, EDIT_FIELDS, editRowOf, FIELD_LABEL, inputWords, limitsFor, rangeBreach, storedColumns, type Changes, type EditField } from "@/lib/deduction-edit";
import { deductionsLocked, disputeFacts } from "@/lib/disputes";
import { lawfulRanges } from "@/lib/lawful-range";
import { mayRemove, routeTenancy } from "@/lib/workspace";

export const runtime = "nodejs";

// Remove a deduction before the statement goes out. Its receipt goes too (when this workspace stored it); after-repair
// photos stay as evidence. Refused while a dispute the tenants sent is open (the negotiation is over these lines) and
// once the deductions are final (deductionsLocked).
export async function DELETE(_req: Request, ctx: RouteContext<"/api/tenancies/[id]/deductions/[did]">) {
  const { id, did } = await ctx.params;
  const ws = await routeTenancy(id, { write: true });
  if (ws instanceof Response) return ws;
  const { data: d } = await db.from("deductions").select("item, amount, receipt_path").eq("id", did).eq("tenancy_id", id).single();
  if (!d) return Response.json({ error: "No such deduction." }, { status: 404 });
  const locked = await deductionsLocked(id);
  if (locked) return locked;
  // Only a receipt this workspace uploaded for this tenancy is removed. A demo copy's deductions point at the template's
  // receipts, which every copy shares and none may delete.
  if (d.receipt_path && (await mayRemove(ws, id, d.receipt_path))) await db.storage.from("receipts").remove([d.receipt_path]);
  await db.from("deductions").delete().eq("id", did);
  await audit(id, "landlord", "deduction_removed", { item: d.item, amount: Number(d.amount) });
  return Response.json({ ok: true });
}

// Change the inputs of a deduction (one cell of the Move-out tab's deductions grid, or a few from its Edit drawer): the
// vendor's invoice, the landlord's hours or rate, the item's age or useful life. The amount is never sent; it is
// worked out here from the inputs, with the same code the grid ran (src/lib/deduction-edit.ts), and the line is held to
// its lawful range twice: by the limits the grid saw, then by the range engine run again with the edit in place, so a
// change the grid let through (another tab, a stale page, a hand-made request) still can't put a charge over what the
// law and the record allow. Refused, as the add and remove routes are, once the deductions are final (the deposit went
// back, the tenants' dispute was settled) or while a dispute the tenants sent is open (deductionsLocked), and for the
// demo's templates (routeTenancy).
export async function PATCH(req: Request, ctx: RouteContext<"/api/tenancies/[id]/deductions/[did]">) {
  const { id, did } = await ctx.params;
  const ws = await routeTenancy(id, { write: true });
  if (ws instanceof Response) return ws;
  const body = (await req.json().catch(() => null)) as { changes?: unknown; math?: unknown } | null;
  const raw = body?.changes && typeof body.changes === "object" && !Array.isArray(body.changes) ? body.changes as Record<string, unknown> : null;
  const changes: Changes = raw ? Object.fromEntries(Object.entries(raw).filter(([k]) => EDIT_FIELDS.includes(k as EditField))) : {};
  if (!raw || !Object.keys(changes).length || Object.keys(changes).length !== Object.keys(raw).length) {
    return Response.json({ error: "Say which inputs to change." }, { status: 400 });
  }

  const locked = await deductionsLocked(id);
  if (locked) return locked;

  const facts = await disputeFacts(id);
  const d = facts?.deductions.find((x) => x.id === did);
  if (!facts || !d) return Response.json({ error: "No such deduction." }, { status: 404 });
  // The page the edit came from showed this math: a deduction changed since (another tab) is refused, not overwritten.
  if (typeof body?.math === "string" && body.math !== d.math) {
    return Response.json({ error: "This deduction changed since the page loaded. Refresh to see it." }, { status: 409 });
  }
  const before = editRowOf(d);
  const line = facts.ranges.lines.find((l) => l.id === did);
  const delivered = !!facts.deliveredAt && !!facts.delivery;
  const limits = limitsFor(line, { delivered, amount: d.amount, guidanceCite: facts.pack.copy.guidanceCite });
  const r = checkEdit(before, changes, limits);
  if (!r.ok) return Response.json({ error: r.reason, cite: r.cite, field: r.field }, { status: 422 });

  // The whole range again, with the edit in place: a late statement, a bar or a cap the new amount would break. A bar
  // the edit itself brings on (New York: a charge lowered on a statement that used the whole deposit leaves a refund
  // owed, already past day 14) is worded as the change's, since the grid's own check saw no bar before it.
  const cols = storedColumns(r.row);
  const after = lawfulRanges({ ...facts.rangeInput, deductions: facts.deductions.map((x) => (x.id === did ? { ...x, ...cols } : x)) }, facts.pack);
  const now = after.lines.find((l) => l.id === did);
  const breach = now ? rangeBreach(now, { barredBefore: !!limits.bar }) : null;
  if (breach) return Response.json({ error: breach.reason, cite: breach.cite, field: null }, { status: 422 });

  // Stored only if the row is still the one checked (its math names every input): two tabs can't both land.
  const { data: saved, error } = await db.from("deductions").update(cols).eq("id", did).eq("tenancy_id", id).eq("math", d.math).select("id");
  if (error) {
    console.error("deduction edit failed", error.message);
    return Response.json({ error: "Couldn't save the change. Try again." }, { status: 500 });
  }
  if (!saved?.length) return Response.json({ error: "This deduction changed since the page loaded. Refresh to see it." }, { status: 409 });

  const changed = (Object.keys(changes) as EditField[]).filter((f) => before[f] !== r.row[f]);
  for (const f of changed.length ? changed : (Object.keys(changes) as EditField[]).slice(0, 1)) {
    await audit(id, "landlord", "deduction_edited", {
      item: d.item, room: d.room, field: f, label: FIELD_LABEL[f], from: before[f], to: r.row[f], money: f === "invoiceTotal" || f === "hourlyRate",
      amount_from: d.amount, amount: r.row.amount, math: r.row.math,
    });
  }
  return Response.json({
    id: did, amount: r.row.amount, math: r.row.math, guidance: r.guidance,
    changes: changed.map((f) => `${FIELD_LABEL[f]} ${inputWords(f, before[f])} to ${inputWords(f, r.row[f])}`),
  });
}

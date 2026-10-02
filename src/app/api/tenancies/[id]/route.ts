import { longDate, realDate } from "@/lib/dates";
import { audit, db } from "@/lib/db";
import { statementDue } from "@/lib/deductions";

export const runtime = "nodejs";

// Two dates the landlord sets by hand, one per request. The move-out date starts the 21-day clock for the itemized
// statement and refund (Civ. Code 1950.5(h)(1)). The lease end date drives the reminders (the 60-day check-in and the
// two-week inspection window, (f)(1)); null means month to month.
export async function PATCH(req: Request, ctx: RouteContext<"/api/tenancies/[id]">) {
  const { id } = await ctx.params;
  const body: unknown = await req.json().catch(() => null);
  if (!body || typeof body !== "object" || Array.isArray(body)) return Response.json({ error: "Send the date to set." }, { status: 400 });
  const b = body as { moveOutDate?: unknown; endDate?: unknown };
  const hasEnd = "endDate" in b, hasMoveOut = "moveOutDate" in b;
  if (hasEnd && hasMoveOut) return Response.json({ error: "Set one date at a time." }, { status: 400 });
  if (!hasEnd && !hasMoveOut) return Response.json({ error: "Send the lease end date or the move-out date." }, { status: 400 });

  const { data: t } = await db.from("tenancies").select("start_date, end_date, move_out_date").eq("id", id).single();
  if (!t) return Response.json({ error: "No such tenancy." }, { status: 404 });
  const start = t.start_date as string | null;

  if (hasEnd) {
    const endDate = b.endDate;
    if (endDate !== null && !realDate(endDate)) return Response.json({ error: "Pick a real lease end date, or clear it for month to month." }, { status: 400 });
    if (endDate && start && endDate < start) return Response.json({ error: `The lease end comes after the tenancy started on ${longDate(start)}.` }, { status: 400 });
    const { error } = await db.from("tenancies").update({ end_date: endDate }).eq("id", id);
    if (error) {
      console.error("lease end update failed", error.message);
      return Response.json({ error: "Couldn't save. Try again." }, { status: 500 });
    }
    await audit(id, "landlord", "lease_end_set", { end_date: endDate, previous: t.end_date ?? null });
    return Response.json({ ok: true, endDate });
  }

  const moveOutDate = b.moveOutDate;
  if (!realDate(moveOutDate)) return Response.json({ error: "Pick the move-out date." }, { status: 400 });
  if (start && moveOutDate < start) return Response.json({ error: `The move-out date comes after the tenancy started on ${longDate(start)}.` }, { status: 400 });
  const { error } = await db.from("tenancies").update({ move_out_date: moveOutDate }).eq("id", id);
  if (error) {
    console.error("move-out date update failed", error.message);
    return Response.json({ error: "Couldn't save. Try again." }, { status: 500 });
  }
  await audit(id, "landlord", "move_out_date_set", { move_out_date: moveOutDate, statement_due: statementDue(moveOutDate), previous: t.move_out_date ?? null });
  return Response.json({ ok: true, statementDue: statementDue(moveOutDate) });
}

import { addDays, longDate, realDate, todayIn } from "@/lib/dates";
import { audit, db } from "@/lib/db";
import { zoneOf } from "@/lib/states";
import { PLANNED_MOVE_OUT_HORIZON_DAYS } from "@/lib/tenant";
import { tenancyDue } from "@/lib/tenancy-pack";
import { routeTenancy } from "@/lib/workspace";

export const runtime = "nodejs";

// Two dates the landlord sets by hand, one per request. The move-out date starts the state's clock for the itemized
// statement and refund (California: 21 days, Civ. Code 1950.5(h)(1)), so it is fixed once the statement is out and held
// to the tenants' own horizon. The lease end date drives the reminders (the 60-day check-in and, where the state has
// one, the two-week inspection window); null means month to month.
export async function PATCH(req: Request, ctx: RouteContext<"/api/tenancies/[id]">) {
  const { id } = await ctx.params;
  const ws = await routeTenancy(id, { write: true });
  if (ws instanceof Response) return ws;
  const body: unknown = await req.json().catch(() => null);
  if (!body || typeof body !== "object" || Array.isArray(body)) return Response.json({ error: "Send the date to set." }, { status: 400 });
  const b = body as { moveOutDate?: unknown; endDate?: unknown };
  const hasEnd = "endDate" in b, hasMoveOut = "moveOutDate" in b;
  if (hasEnd && hasMoveOut) return Response.json({ error: "Set one date at a time." }, { status: 400 });
  if (!hasEnd && !hasMoveOut) return Response.json({ error: "Send the lease end date or the move-out date." }, { status: 400 });

  const { data: t } = await db.from("tenancies").select("start_date, end_date, move_out_date, statement_delivered_at, statement_delivery, properties(state)").eq("id", id).single();
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
  // The statement's clock runs from this date, so once the statement is out it stays as the statement gives it.
  if (t.statement_delivered_at && t.statement_delivery && moveOutDate !== t.move_out_date) {
    return Response.json({ error: "The statement went out, so the move-out date it counts from can't change now." }, { status: 409 });
  }
  if (start && moveOutDate < start) return Response.json({ error: `The move-out date comes after the tenancy started on ${longDate(start)}.` }, { status: 400 });
  // As far ahead as the tenants may give theirs (src/app/api/t/[token]/moving-out/route.ts).
  const today = todayIn(zoneOf((t.properties as { state?: string | null } | null)?.state));
  if (moveOutDate > addDays(today, PLANNED_MOVE_OUT_HORIZON_DAYS)) return Response.json({ error: "That date is more than a year away. Check the year." }, { status: 400 });
  const { error } = await db.from("tenancies").update({ move_out_date: moveOutDate }).eq("id", id);
  if (error) {
    console.error("move-out date update failed", error.message);
    return Response.json({ error: "Couldn't save. Try again." }, { status: 500 });
  }
  // The deadline on the tenancy's track (Florida: 30 days from the end once a claim is on file, not 15).
  const { due } = await tenancyDue(id, moveOutDate);
  await audit(id, "landlord", "move_out_date_set", { move_out_date: moveOutDate, statement_due: due, previous: t.move_out_date ?? null });
  return Response.json({ ok: true, statementDue: due });
}

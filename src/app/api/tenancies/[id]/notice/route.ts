import { longDate, pacificToday, realDate } from "@/lib/dates";
import { audit, db } from "@/lib/db";
import { statementDue } from "@/lib/deductions";
import { inspectionWindowOpens } from "@/lib/notices";
import { routeTenancy } from "@/lib/workspace";

export const runtime = "nodejs";

// Either side gave notice to end the tenancy. The date it was given and the move-out date it names turn on the two
// written notices the landlord owes (Civ. Code 1950.5(f)(1) and (h)(1)(A)(ii)(II)) and the dates that follow: the
// inspection window two weeks before the end ((f)(1)) and, once possession is returned, the 21-day clock ((h)(1)).
export async function POST(req: Request, ctx: RouteContext<"/api/tenancies/[id]/notice">) {
  const { id } = await ctx.params;
  const ws = await routeTenancy(id, { write: true });
  if (ws instanceof Response) return ws;
  const body: unknown = await req.json().catch(() => null);
  if (!body || typeof body !== "object" || Array.isArray(body)) return Response.json({ error: "Send the notice date and the planned move-out date." }, { status: 400 });
  const b = body as { noticeGivenOn?: unknown; plannedMoveOut?: unknown };
  const today = pacificToday();
  if (!realDate(b.noticeGivenOn)) return Response.json({ error: "Pick the date the notice was given." }, { status: 400 });
  if (b.noticeGivenOn > today) return Response.json({ error: "The notice date can't be in the future." }, { status: 400 });
  if (!realDate(b.plannedMoveOut)) return Response.json({ error: "Pick the planned move-out date." }, { status: 400 });
  if (b.plannedMoveOut < b.noticeGivenOn) return Response.json({ error: "The move-out date comes after the notice date." }, { status: 400 });

  const { data: t } = await db.from("tenancies").select("status, start_date, notice_given_on, planned_move_out, move_out_date").eq("id", id).single();
  if (!t) return Response.json({ error: "No such tenancy." }, { status: 404 });
  if (t.move_out_date) return Response.json({ error: "The tenants have already moved out; the move-out date is set below." }, { status: 409 });
  // Notice to end a tenancy can't come before the tenancy began.
  if (t.start_date && b.noticeGivenOn < t.start_date) return Response.json({ error: `The notice date comes after the tenancy started on ${longDate(t.start_date)}.` }, { status: 400 });
  if (t.start_date && b.plannedMoveOut < t.start_date) return Response.json({ error: `The move-out date comes after the tenancy started on ${longDate(t.start_date)}.` }, { status: 400 });

  // A tenancy that was moving in or active is now moving out; later stages keep their status.
  const status = t.status === "move_in" || t.status === "active" ? "moving_out" : t.status;
  const { error } = await db.from("tenancies").update({ notice_given_on: b.noticeGivenOn, planned_move_out: b.plannedMoveOut, status }).eq("id", id);
  if (error) {
    console.error("notice update failed", error.message);
    return Response.json({ error: "Couldn't save the notice. Try again." }, { status: 500 });
  }
  const windowOpens = inspectionWindowOpens(b.plannedMoveOut);
  const due = statementDue(b.plannedMoveOut);
  const previous = t.notice_given_on ? { notice_given_on: t.notice_given_on, planned_move_out: t.planned_move_out } : null;
  await audit(id, "landlord", previous ? "notice_changed" : "notice_recorded", {
    notice_given_on: b.noticeGivenOn, planned_move_out: b.plannedMoveOut, inspection_window_opens: windowOpens, statement_due_if_on_time: due, previous,
  });
  return Response.json({ ok: true, inspectionWindowOpens: windowOpens, statementDue: due });
}

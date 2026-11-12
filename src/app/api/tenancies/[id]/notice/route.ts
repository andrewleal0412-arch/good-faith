import { readJson } from "@/lib/body";
import { longDate, realDate, todayIn } from "@/lib/dates";
import { audit, db } from "@/lib/db";
import { inspectionWindowOpens } from "@/lib/notices";
import { tenancyPack } from "@/lib/tenancy-pack";
import { routeTenancy } from "@/lib/workspace";

export const runtime = "nodejs";

// Either side gave notice to end the tenancy. The date it was given and the move-out date it names turn on the written
// notices the state's pack names (California: Civ. Code 1950.5(f)(1) and (h)(1)(A)(ii)(II)) and the dates that follow:
// the inspection window two weeks before the end, where the state has one, and, once possession is returned, the
// state's clock (California: 21 days, (h)(1)). Who gave the notice is recorded where the state's rule turns on it
// (New York: the inspection-rights notice is not owed only after a tenant's notice of less than two weeks).
export async function POST(req: Request, ctx: RouteContext<"/api/tenancies/[id]/notice">) {
  const { id } = await ctx.params;
  const ws = await routeTenancy(id, { write: true });
  if (ws instanceof Response) return ws;
  const body: unknown = await readJson(req, 16_000);
  if (!body || typeof body !== "object" || Array.isArray(body)) return Response.json({ error: "Send the notice date and the planned move-out date." }, { status: 400 });
  const b = body as { noticeGivenOn?: unknown; plannedMoveOut?: unknown; givenBy?: unknown };
  // Today where the property is: its pack's zone, which its deadlines are counted in.
  const pack = await tenancyPack(id);
  const today = todayIn(pack.timeZone.id);
  if (!realDate(b.noticeGivenOn)) return Response.json({ error: "Pick the date the notice was given." }, { status: 400 });
  if (b.noticeGivenOn > today) return Response.json({ error: "The notice date can't be in the future." }, { status: 400 });
  if (!realDate(b.plannedMoveOut)) return Response.json({ error: "Pick the planned move-out date." }, { status: 400 });
  if (b.plannedMoveOut < b.noticeGivenOn) return Response.json({ error: "The move-out date comes after the notice date." }, { status: 400 });
  if (b.givenBy != null && b.givenBy !== "tenant" && b.givenBy !== "landlord") return Response.json({ error: "Pick who gave the notice." }, { status: 400 });
  const givenBy = (b.givenBy ?? null) as "tenant" | "landlord" | null;

  const { data: t } = await db.from("tenancies").select("status, start_date, end_date, notice_given_on, notice_given_by, planned_move_out, move_out_date").eq("id", id).single();
  if (!t) return Response.json({ error: "No such tenancy." }, { status: 404 });
  if (t.move_out_date) return Response.json({ error: "The tenants have already moved out; the move-out date is set below." }, { status: 409 });
  // Notice to end a tenancy can't come before the tenancy began.
  if (t.start_date && b.noticeGivenOn < t.start_date) return Response.json({ error: `The notice date comes after the tenancy started on ${longDate(t.start_date)}.` }, { status: 400 });
  if (t.start_date && b.plannedMoveOut < t.start_date) return Response.json({ error: `The move-out date comes after the tenancy started on ${longDate(t.start_date)}.` }, { status: 400 });

  // A tenancy that was moving in or active is now moving out; later stages keep their status.
  const status = t.status === "move_in" || t.status === "active" ? "moving_out" : t.status;
  const { error } = await db.from("tenancies").update({
    notice_given_on: b.noticeGivenOn, planned_move_out: b.plannedMoveOut, status, ...(b.givenBy !== undefined ? { notice_given_by: givenBy } : {}),
  }).eq("id", id);
  if (error) {
    console.error("notice update failed", error.message);
    return Response.json({ error: "Couldn't save the notice. Try again." }, { status: 500 });
  }
  const windowOpens = inspectionWindowOpens(b.plannedMoveOut, pack);
  // The deadline if the tenants leave as planned and nothing is claimed (Florida's claim track starts only with a claim).
  const due = pack.deadline.due({ moveOutDate: b.plannedMoveOut, endDate: t.end_date, plannedMoveOut: b.plannedMoveOut });
  const previous = t.notice_given_on ? { notice_given_on: t.notice_given_on, planned_move_out: t.planned_move_out, ...(t.notice_given_by ? { given_by: t.notice_given_by } : {}) } : null;
  await audit(id, "landlord", previous ? "notice_changed" : "notice_recorded", {
    notice_given_on: b.noticeGivenOn, planned_move_out: b.plannedMoveOut, ...(givenBy ? { given_by: givenBy } : {}),
    inspection_window_opens: windowOpens, statement_due_if_on_time: due, previous,
  });
  return Response.json({ ok: true, inspectionWindowOpens: windowOpens, statementDue: due });
}

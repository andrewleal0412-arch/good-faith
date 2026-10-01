import { audit, db } from "@/lib/db";
import { statementDue } from "@/lib/deductions";

export const runtime = "nodejs";

// The move-out date starts the 21-day clock for the itemized statement and refund (Civ. Code 1950.5(h)(1)).
export async function PATCH(req: Request, ctx: RouteContext<"/api/tenancies/[id]">) {
  const { id } = await ctx.params;
  const { moveOutDate } = (await req.json()) as { moveOutDate?: string };
  if (!moveOutDate || !/^\d{4}-\d{2}-\d{2}$/.test(moveOutDate)) return Response.json({ error: "Pick the move-out date." }, { status: 400 });
  const { error } = await db.from("tenancies").update({ move_out_date: moveOutDate }).eq("id", id);
  if (error) return Response.json({ error: error.message }, { status: 500 });
  await audit(id, "landlord", "move_out_date_set", { move_out_date: moveOutDate, statement_due: statementDue(moveOutDate) });
  return Response.json({ ok: true, statementDue: statementDue(moveOutDate) });
}

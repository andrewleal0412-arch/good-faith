import { buildIcs, tenancyEvents } from "@/lib/ics";
import { closedOut } from "@/lib/next-step";
import { loadUnit } from "@/lib/units";

export const runtime = "nodejs";

// The tenancy's dates as an .ics file (RFC 5545) to add to any calendar: the 60-day check-in before the lease ends,
// the day the inspection window opens (Civ. Code 1950.5(f)(1)), the move-out, and the 21-day statement and refund
// deadline ((h)(1)). Reminders without an email service.
export async function GET(req: Request, ctx: RouteContext<"/api/tenancies/[id]/calendar">) {
  const { id } = await ctx.params;
  const t = await loadUnit(id);
  if (!t) return Response.json({ error: "No such tenancy." }, { status: 404 });
  const events = tenancyEvents(t);
  if (!events.length) {
    const error = closedOut(t)
      ? "This tenancy is closed out: the statement went out and nothing is left to return, so there are no dates to add."
      : "No dates yet. Set the lease end date or record the tenants' notice first.";
    return Response.json({ error }, { status: 409 });
  }
  const origin = new URL(req.url).origin;
  const body = buildIcs(events, { name: `Deposit Agent: ${t.address}`, url: `${origin}/tenancy/${id}` });
  const slug = t.address.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "").slice(0, 60) || "unit";
  return new Response(body, {
    headers: {
      "Content-Type": "text/calendar; charset=utf-8",
      "Content-Disposition": `attachment; filename="deposit-dates-${slug}.ics"`,
      "Cache-Control": "no-store",
    },
  });
}

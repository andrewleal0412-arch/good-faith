import { addDays, longDate, pacificToday, realDate } from "@/lib/dates";
import { audit, db } from "@/lib/db";
import { FORWARDING_MAX, FORWARDING_MIN, PLANNED_MOVE_OUT_HORIZON_DAYS, PLANNED_MOVE_OUT_PAST_DAYS, type TenantMoveOut } from "@/lib/tenant";
import { resolveTenantToken, tokenNotFound } from "@/lib/tenant-links";
import { isTemplate } from "@/lib/workspace";

export const runtime = "nodejs";

/** One line of text: control characters and line breaks become spaces, so an address pasted from a letter still
 *  fits the one-line field on the statement's delivery record. */
const line = (v: unknown) => (typeof v === "string" ? v.replace(/[\u0000-\u001f]+/g, " ").replace(/\s{2,}/g, " ").trim() : "");

const bad = (error: string, status = 400) => Response.json({ error }, { status });

// The tenants say they are moving out: the planned date and the forwarding address. The address decides where the
// itemized statement is mailed (Civ. Code 1950.5(h)(6)); without one it goes to the vacated unit. Authorized by the
// link token alone, audited as the tenant, and stored once per tenancy: sending it again updates it.
export async function POST(req: Request, ctx: RouteContext<"/api/t/[token]/moving-out">) {
  const { token } = await ctx.params;
  const link = await resolveTenantToken(token);
  if (!link) return tokenNotFound();
  // The demo's template tenancies don't change, through their own tenant link either.
  if (await isTemplate(link.tenancyId)) return bad("This is a demo page, so it can't be changed. Your landlord's copy of the demo can.", 409);

  const body: unknown = await req.json().catch(() => null);
  if (!body || typeof body !== "object" || Array.isArray(body)) return bad("Send your move-out date and a forwarding address.");
  const b = body as { name?: unknown; plannedMoveOut?: unknown; forwardingAddress?: unknown };
  const address = line(b.forwardingAddress);
  if (address.length < FORWARDING_MIN) return bad("Enter the full address the statement should be mailed to.");
  if (address.length > FORWARDING_MAX) return bad(`Keep the address under ${FORWARDING_MAX} characters.`);

  const { data: t } = await db.from("tenancies").select("tenants, start_date, move_out_date, statement_delivered_at, tenant_move_out").eq("id", link.tenancyId).single();
  if (!t) return tokenNotFound();
  // Once the statement is out, where to mail it is settled; a change would have nowhere to go.
  if (t.statement_delivered_at) return bad("The itemized statement has already been sent, so the move-out details can't be changed here. Contact your landlord directly.", 409);

  const existing = (t.tenant_move_out ?? null) as TenantMoveOut | null;
  let planned: string;
  if (t.move_out_date) {
    // The landlord has recorded the actual move-out, so the date is settled; only the forwarding address can change.
    planned = existing?.planned_move_out ?? t.move_out_date;
    if (b.plannedMoveOut != null && b.plannedMoveOut !== "" && b.plannedMoveOut !== planned) {
      return bad(`Your landlord recorded the move-out on ${longDate(t.move_out_date)}, so the date can't be changed here. The forwarding address can.`);
    }
  } else {
    const today = pacificToday();
    if (!realDate(b.plannedMoveOut)) return bad("Pick your move-out date.");
    if (b.plannedMoveOut > addDays(today, PLANNED_MOVE_OUT_HORIZON_DAYS)) return bad("That date is more than a year away. Check the year.");
    if (b.plannedMoveOut < addDays(today, -PLANNED_MOVE_OUT_PAST_DAYS)) return bad(`That date is more than ${PLANNED_MOVE_OUT_PAST_DAYS} days in the past. Check the year.`);
    if (t.start_date && b.plannedMoveOut < t.start_date) return bad(`Pick a date after the tenancy started on ${longDate(t.start_date)}.`);
    planned = b.plannedMoveOut;
  }

  const adults = ((t.tenants ?? []) as { name: string }[]).map((x) => x.name);
  const name = line(b.name) || (adults.length === 1 ? adults[0] : "");
  if (!name || !adults.includes(name)) return bad("Pick your name as it appears on the lease.");

  const now = new Date().toISOString();
  const record: TenantMoveOut = { name, planned_move_out: planned, forwarding_address: address, submitted_at: now, updated_at: now };
  // The database function locks the row and keeps the first submission's time (see the migration).
  const { data, error } = await db.rpc("set_tenant_move_out", { p_tenancy: link.tenancyId, p_record: record });
  if (error) {
    console.error("tenant move-out write failed", error.message);
    return bad("Couldn't send that. Try again.", 500);
  }
  const change = data as { previous: TenantMoveOut | null; record: TenantMoveOut } | null;
  if (!change) return tokenNotFound();
  await audit(link.tenancyId, "tenant", change.previous ? "tenant_moving_out_changed" : "tenant_moving_out", { ...change.record, previous: change.previous, link_id: link.linkId });
  return Response.json({ ok: true, moveOut: change.record });
}

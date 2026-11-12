import { readJson } from "@/lib/body";
import { realDate, todayIn } from "@/lib/dates";
import { audit, db } from "@/lib/db";
import { DELIVERY_LABEL, recordedAtFor, type DeliveryRecord } from "@/lib/delivery";
import { packFor } from "@/lib/states";
import { routeTenancy } from "@/lib/workspace";

export const runtime = "nodejs";

const MAX_LEN = 200;
const str = (v: unknown) => (typeof v === "string" ? v.replace(/[\u0000-\u001f]/g, " ").trim() : "");

// Records how and when the itemized statement was delivered, under the tenancy's state pack. California: personal
// delivery, first-class mail to the address the tenant provided or to the vacated unit when there is none (Civ. Code
// 1950.5(h)(1)(B), (h)(6)), or email, which is allowed only when both sides agreed to it in writing ((h)(1)(B)); the
// statement may go to any one adult tenant ((h)(1)(C)). Other states: email as the record only where their rule allows
// it (Washington never; Texas and Florida on a condition the landlord confirms), and Texas never mails to the vacated
// unit in place of a written forwarding address. Recording it moves the tenancy to statement_sent.
export async function POST(req: Request, ctx: RouteContext<"/api/tenancies/[id]/statement/delivery">) {
  const { id } = await ctx.params;
  const ws = await routeTenancy(id, { write: true });
  if (ws instanceof Response) return ws;
  const body: unknown = await readJson(req, 16_000);
  if (!body || typeof body !== "object" || Array.isArray(body)) return Response.json({ error: "Send how and when the statement was delivered." }, { status: 400 });
  const b = body as Partial<DeliveryRecord>;
  const method = b.method;
  if (method !== "personal" && method !== "mail" && method !== "email") return Response.json({ error: "Pick how the statement was delivered." }, { status: 400 });
  const date = str(b.date);
  if (!realDate(date)) return Response.json({ error: "Pick a real delivery date." }, { status: 400 });
  const to = str(b.to), address = str(b.address), email = str(b.email);
  if ([to, address, email].some((v) => v.length > MAX_LEN)) return Response.json({ error: `That's too long: keep each field under ${MAX_LEN} characters.` }, { status: 400 });

  const { data: t } = await db.from("tenancies").select("tenants, move_out_date, statement_delivery, statement_delivery_recorded_at, properties(address, state)").eq("id", id).single();
  if (!t) return Response.json({ error: "No such tenancy." }, { status: 404 });
  // The statement follows the move-out ((h)(1)) and goes to an adult on the lease ((h)(1)(C)); without either there is nothing to deliver.
  if (!t.move_out_date) return Response.json({ error: "Set the move-out date first: the statement follows the move-out." }, { status: 409 });
  const adults = (t.tenants as { name: string }[]).map((x) => x.name);
  if (!adults.length) return Response.json({ error: "Add the tenants first: the statement goes to an adult tenant on the lease." }, { status: 409 });
  const toName = to || adults[0];
  if (!adults.includes(toName)) return Response.json({ error: "The statement goes to one of the adult tenants on the lease." }, { status: 400 });

  const pack = packFor((t.properties as unknown as { state?: string | null }).state);
  // Today where the property is (its pack's zone), which the state's deadline is counted in: at 9:30 PM in California
  // it is already tomorrow in New York, and a statement handed over there then is dated tomorrow.
  const today = todayIn(pack.timeZone.id);
  if (date > today) return Response.json({ error: "The delivery date can't be in the future." }, { status: 400 });
  if (method === "email") {
    if (pack.delivery.emailRule === "courtesy" || (pack.delivery.emailRule === "agreement" && b.by_agreement !== true)) {
      return Response.json({ error: pack.delivery.emailRefused }, { status: 400 });
    }
    if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) return Response.json({ error: "Enter the email address the statement went to." }, { status: 400 });
  }

  // Mail goes to the forwarding address the tenant gave; with none, to the vacated unit, and the record says which ((h)(6)).
  const unit = (t.properties as unknown as { address: string }).address;
  const forwarding = method === "mail" && !!address && address.toLowerCase() !== unit.toLowerCase();
  if (method === "mail" && !forwarding && !pack.delivery.unitFallback) return Response.json({ error: pack.delivery.noForwarding }, { status: 400 });
  const record: DeliveryRecord = {
    method, date, to: toName,
    address: method === "mail" ? (forwarding ? address : unit) : null,
    address_kind: method === "mail" ? (forwarding ? "forwarding" : "unit") : null,
    email: method === "email" ? email : null,
    by_agreement: method === "email" && pack.delivery.emailRule === "agreement",
    // The rule an email went under, in the pack's words, when it is not the written agreement the default label names.
    ...(method === "email" && pack.delivery.emailWord !== DELIVERY_LABEL.email ? { basis: pack.delivery.emailWord } : {}),
  };
  // Today's delivery keeps the exact time; a back-dated one is stored at noon UTC like every other date in the app. The
  // moment its date was recorded is kept apart, so a delivery recorded days after it happened says so (recordedLater).
  // A correction that keeps the date keeps that moment (recordedAtFor): fixing an address days later doesn't make an
  // on-time delivery read as recorded late.
  const now = new Date().toISOString();
  const previous = (t.statement_delivery ?? null) as DeliveryRecord | null;
  const deliveredAt = date === today ? now : `${date}T12:00:00.000Z`;
  const recordedAt = recordedAtFor(previous, date, (t.statement_delivery_recorded_at as string | null) ?? null, now);
  const { error } = await db.from("tenancies").update({
    statement_delivered_at: deliveredAt, statement_delivery: record, statement_delivery_recorded_at: recordedAt, status: "statement_sent",
  }).eq("id", id);
  if (error) {
    console.error("statement delivery update failed", error.message);
    return Response.json({ error: "Couldn't save the delivery record. Try again." }, { status: 500 });
  }
  // A correction is one event in the log, not a second delivery of a legal notice.
  if (previous) await audit(id, "landlord", "statement_delivery_changed", { previous, next: record });
  else await audit(id, "landlord", "statement_delivered", record);
  return Response.json({ ok: true, delivery: record });
}

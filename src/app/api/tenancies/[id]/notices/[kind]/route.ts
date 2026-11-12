import { readJson } from "@/lib/body";
import { realDate, todayIn } from "@/lib/dates";
import { audit, db } from "@/lib/db";
import { CA_NOTICE_KINDS, kindFromSlug, recordFor, type NoticeGiven, type NoticeMethod, type Notices } from "@/lib/notices";
import { tenancyPack } from "@/lib/tenancy-pack";
import { routeTenancy } from "@/lib/workspace";

export const runtime = "nodejs";

const str = (v: unknown) => (typeof v === "string" ? v.replace(/[\u0000-\u001f]/g, " ").trim() : "");

/** What the set_notice and remove_notice database functions return: the record the change replaced and the result. */
type NoticeChange = { previous: NoticeGiven | null; notices: Notices };

// The landlord records that a notice went out, or a record the tenancy's state asks for was made: California's
// initial-inspection notice (Civ. Code 1950.5(f)(1)) and electronic-refund notice ((h)(1)(A)(ii)(II)), and the other
// packs' records (src/lib/states/: a Washington checklist signed, the account a deposit is held in, a Florida claim
// notice by certified mail, a Texas forwarding address received in writing), each with the date, the way it was given
// and what it names. The record is kept in tenancies.notices by kind and every change is audited; the drafts
// themselves are rendered from the tenancy. The write goes through a database function that locks the row and merges
// one kind (set_notice for California's two, set_state_notice for the rest), so two records made at the same time (a
// double click, two tabs) both land instead of one overwriting the other.
export async function POST(req: Request, ctx: RouteContext<"/api/tenancies/[id]/notices/[kind]">) {
  const { id, kind: slug } = await ctx.params;
  const ws = await routeTenancy(id, { write: true });
  if (ws instanceof Response) return ws;
  const pack = await tenancyPack(id);
  const kind = kindFromSlug(slug, pack);
  const def = kind ? recordFor(pack, kind) : null;
  if (!kind || !def) return Response.json({ error: "No such notice." }, { status: 404 });
  const body: unknown = await readJson(req, 16_000);
  if (!body || typeof body !== "object" || Array.isArray(body)) return Response.json({ error: "Send the date, the method and the tenant." }, { status: 400 });
  const b = body as { date?: unknown; method?: unknown; to?: unknown; detail?: unknown; received?: unknown };
  // Today where the property is: its pack's zone, which its deadlines are counted in.
  const today = todayIn(pack.timeZone.id);
  if (!realDate(b.date)) return Response.json({ error: "Pick the date the notice was given." }, { status: 400 });
  if (b.date > today) return Response.json({ error: "The date can't be in the future." }, { status: 400 });
  const method = def.methods.find(([m]) => m === b.method)?.[0] as NoticeMethod | undefined;
  if (!method) return Response.json({ error: "Pick how the notice was given." }, { status: 400 });
  const detail = str(b.detail).slice(0, 240) || null;
  if (def.detail?.required && !detail) return Response.json({ error: `Enter the ${def.detail.label.toLowerCase()}.` }, { status: 400 });
  let received: string | null = null;
  if (def.received && b.received != null && b.received !== "") {
    if (!realDate(b.received) || b.received > today || b.received < b.date) return Response.json({ error: "The day it was received comes after the day it was sent, and not in the future." }, { status: 400 });
    received = b.received;
  }

  const { data: t } = await db.from("tenancies").select("tenants").eq("id", id).single();
  if (!t) return Response.json({ error: "No such tenancy." }, { status: 404 });
  const adults = (t.tenants as { name: string }[]).map((x) => x.name);
  const to = str(b.to) || null;
  if (to && !adults.includes(to)) return Response.json({ error: "The notice goes to one of the adult tenants on the lease." }, { status: 400 });

  // California's two records keep exactly their old shape; the others carry what they name.
  const record: NoticeGiven = CA_NOTICE_KINDS.includes(kind)
    ? { date: b.date, method, to, recorded_at: new Date().toISOString() }
    : { date: b.date, method, to, recorded_at: new Date().toISOString(), detail, received };
  const { data, error } = await db.rpc(CA_NOTICE_KINDS.includes(kind) ? "set_notice" : "set_state_notice", { p_tenancy: id, p_kind: kind, p_record: record });
  if (error) {
    console.error("notice record failed", error.message);
    return Response.json({ error: "Couldn't record the notice. Try again." }, { status: 500 });
  }
  const change = data as NoticeChange | null;
  if (!change) return Response.json({ error: "No such tenancy." }, { status: 404 });
  // The record's name and verb from the pack ("forwarding address", "Received"), so the activity log reads it as made.
  await audit(id, "landlord", "notice_given", { kind, short: def.short, verb: def.verb, ...record, previous: change.previous });
  return Response.json({ ok: true, notice: record });
}

/** Undo a record made by mistake. The audit log keeps both entries. */
export async function DELETE(_req: Request, ctx: RouteContext<"/api/tenancies/[id]/notices/[kind]">) {
  const { id, kind: slug } = await ctx.params;
  const ws = await routeTenancy(id, { write: true });
  if (ws instanceof Response) return ws;
  const pack = await tenancyPack(id);
  const kind = kindFromSlug(slug, pack);
  if (!kind) return Response.json({ error: "No such notice." }, { status: 404 });
  const { data, error } = await db.rpc("remove_notice", { p_tenancy: id, p_kind: kind });
  if (error) {
    console.error("notice record removal failed", error.message);
    return Response.json({ error: "Couldn't change the record. Try again." }, { status: 500 });
  }
  const change = data as NoticeChange | null;
  if (!change) return Response.json({ error: "No such tenancy." }, { status: 404 });
  if (!change.previous) return Response.json({ error: "That notice isn't recorded as given." }, { status: 409 });
  const def = recordFor(pack, kind);
  await audit(id, "landlord", "notice_given_removed", { kind, short: def?.short, verb: def?.verb, previous: change.previous });
  return Response.json({ ok: true });
}

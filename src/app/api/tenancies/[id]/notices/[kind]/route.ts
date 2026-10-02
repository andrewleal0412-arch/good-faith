import { pacificToday, realDate } from "@/lib/dates";
import { audit, db } from "@/lib/db";
import { kindFromSlug, NOTICE_METHODS, type NoticeGiven, type NoticeMethod, type Notices } from "@/lib/notices";

export const runtime = "nodejs";

const str = (v: unknown) => (typeof v === "string" ? v.replace(/[\u0000-\u001f]/g, " ").trim() : "");

/** What the set_notice and remove_notice database functions return: the record the change replaced and the result. */
type NoticeChange = { previous: NoticeGiven | null; notices: Notices };

// The landlord records that a notice went out: the initial-inspection notice (Civ. Code 1950.5(f)(1)) or the
// electronic-refund notice ((h)(1)(A)(ii)(II)), with the date and the way it was given. The record is kept in
// tenancies.notices by kind and every change is audited; the drafts themselves are rendered from the tenancy.
// The write goes through a database function that locks the row and merges one kind, so two records made at the
// same time (a double click, two tabs) both land instead of one overwriting the other.
export async function POST(req: Request, ctx: RouteContext<"/api/tenancies/[id]/notices/[kind]">) {
  const { id, kind: slug } = await ctx.params;
  const kind = kindFromSlug(slug);
  if (!kind) return Response.json({ error: "No such notice." }, { status: 404 });
  const body: unknown = await req.json().catch(() => null);
  if (!body || typeof body !== "object" || Array.isArray(body)) return Response.json({ error: "Send the date, the method and the tenant." }, { status: 400 });
  const b = body as { date?: unknown; method?: unknown; to?: unknown };
  const today = pacificToday();
  if (!realDate(b.date)) return Response.json({ error: "Pick the date the notice was given." }, { status: 400 });
  if (b.date > today) return Response.json({ error: "The date can't be in the future." }, { status: 400 });
  const method = NOTICE_METHODS.find(([m]) => m === b.method)?.[0] as NoticeMethod | undefined;
  if (!method) return Response.json({ error: "Pick how the notice was given." }, { status: 400 });

  const { data: t } = await db.from("tenancies").select("tenants").eq("id", id).single();
  if (!t) return Response.json({ error: "No such tenancy." }, { status: 404 });
  const adults = (t.tenants as { name: string }[]).map((x) => x.name);
  const to = str(b.to) || null;
  if (to && !adults.includes(to)) return Response.json({ error: "The notice goes to one of the adult tenants on the lease." }, { status: 400 });

  const record: NoticeGiven = { date: b.date, method, to, recorded_at: new Date().toISOString() };
  const { data, error } = await db.rpc("set_notice", { p_tenancy: id, p_kind: kind, p_record: record });
  if (error) {
    console.error("notice record failed", error.message);
    return Response.json({ error: "Couldn't record the notice. Try again." }, { status: 500 });
  }
  const change = data as NoticeChange | null;
  if (!change) return Response.json({ error: "No such tenancy." }, { status: 404 });
  await audit(id, "landlord", "notice_given", { kind, ...record, previous: change.previous });
  return Response.json({ ok: true, notice: record });
}

/** Undo a record made by mistake. The audit log keeps both entries. */
export async function DELETE(_req: Request, ctx: RouteContext<"/api/tenancies/[id]/notices/[kind]">) {
  const { id, kind: slug } = await ctx.params;
  const kind = kindFromSlug(slug);
  if (!kind) return Response.json({ error: "No such notice." }, { status: 404 });
  const { data, error } = await db.rpc("remove_notice", { p_tenancy: id, p_kind: kind });
  if (error) {
    console.error("notice record removal failed", error.message);
    return Response.json({ error: "Couldn't change the record. Try again." }, { status: 500 });
  }
  const change = data as NoticeChange | null;
  if (!change) return Response.json({ error: "No such tenancy." }, { status: 404 });
  if (!change.previous) return Response.json({ error: "That notice isn't recorded as given." }, { status: 409 });
  await audit(id, "landlord", "notice_given_removed", { kind, previous: change.previous });
  return Response.json({ ok: true });
}

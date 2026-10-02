import { audit, db } from "@/lib/db";
import { createTenantLink, revokeTenantLinks } from "@/lib/tenant-links";

export const runtime = "nodejs";

// The landlord's side of the private tenant link. POST makes one (and retires the current one, so there is ever one
// live link); the token is in this one response and nowhere else. DELETE revokes it. Both are audited.
export async function POST(_req: Request, ctx: RouteContext<"/api/tenancies/[id]/tenant-link">) {
  const { id } = await ctx.params;
  const { data: t } = await db.from("tenancies").select("id").eq("id", id).maybeSingle();
  if (!t) return Response.json({ error: "No such tenancy." }, { status: 404 });
  try {
    const { token, link, replaced } = await createTenantLink(id);
    await audit(id, "landlord", "tenant_link_created", { link_id: link.id, replaced });
    return Response.json({ ok: true, path: `/t/${token}`, link });
  } catch (e) {
    console.error("tenant link create failed", e);
    return Response.json({ error: "Couldn't create the link. Try again." }, { status: 500 });
  }
}

export async function DELETE(_req: Request, ctx: RouteContext<"/api/tenancies/[id]/tenant-link">) {
  const { id } = await ctx.params;
  const { data: t } = await db.from("tenancies").select("id").eq("id", id).maybeSingle();
  if (!t) return Response.json({ error: "No such tenancy." }, { status: 404 });
  const revoked = await revokeTenantLinks(id);
  if (!revoked.length) return Response.json({ error: "No tenant link is active." }, { status: 409 });
  await audit(id, "landlord", "tenant_link_revoked", { link_ids: revoked });
  return Response.json({ ok: true });
}

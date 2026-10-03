import { audit, db } from "@/lib/db";
import { tenancyPack } from "@/lib/tenancy-pack";
import { routeTenancy } from "@/lib/workspace";

export const runtime = "nodejs";

// The tenants' written agreement to a PayPal refund and where it should go. California's AB 414 (Civ. Code
// 1950.5(h)(1)(A), from 2026): a deposit paid electronically comes back electronically, and by PayPal only if the tenant
// agrees in writing; roommates (h)(1)(C): one refund to all adults unless every adult signs an allocation, so all must
// sign here. Elsewhere it is the tenants' written designation of the account (the state pack's text says which).
export async function POST(req: Request, ctx: RouteContext<"/api/tenancies/[id]/agreement">) {
  const { id } = await ctx.params;
  const ws = await routeTenancy(id, { write: true });
  if (ws instanceof Response) return ws;
  const { paypalEmail, signers } = (await req.json()) as { paypalEmail: string; signers: string[] };
  if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(paypalEmail ?? "")) {
    return Response.json({ error: "Enter the PayPal email the refund should go to." }, { status: 400 });
  }
  const { data: t } = await db.from("tenancies").select("tenants").eq("id", id).single();
  if (!t) return Response.json({ error: "No such tenancy." }, { status: 404 });
  const adults = (t.tenants as { name: string }[]).map((x) => x.name);
  const missing = adults.filter((n) => !signers?.includes(n));
  if (missing.length) return Response.json({ error: `Every adult tenant must agree: ${missing.join(", ")} hasn't.` }, { status: 400 });

  const pack = await tenancyPack(id);
  const agreement = {
    method: "paypal", paypal_email: paypalEmail, signed_by: signers, signed_at: new Date().toISOString(),
    text: pack.refund.agreementText,
  };
  await db.from("tenancies").update({
    refund_agreement: agreement,
    tenants: (t.tenants as { name: string }[]).map((x, i) => ({ ...x, email: i === 0 ? paypalEmail : null })),
  }).eq("id", id);
  // Where the state asks for no agreement, the entry says it is the tenants' designation of the account, so the activity
  // never calls it a refund agreement.
  await audit(id, "tenant", "refund_method_agreed", { method: "paypal", signed_by: signers, ...(pack.refund.agreementRequired ? {} : { designated: true }) });
  return Response.json({ ok: true });
}

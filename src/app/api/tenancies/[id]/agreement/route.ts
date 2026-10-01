import { audit, db } from "@/lib/db";

export const runtime = "nodejs";

// AB 414 (Civ. Code 1950.5(h)(1)(A), from 2026): a deposit paid electronically comes back electronically, and by
// PayPal only if the tenant agrees in writing. This records that agreement and where the refund should go.
// Roommates (h)(1)(C): one refund to all adults unless every adult signs an allocation, so all must sign here.
export async function POST(req: Request, ctx: RouteContext<"/api/tenancies/[id]/agreement">) {
  const { id } = await ctx.params;
  const { paypalEmail, signers } = (await req.json()) as { paypalEmail: string; signers: string[] };
  if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(paypalEmail ?? "")) {
    return Response.json({ error: "Enter the PayPal email the refund should go to." }, { status: 400 });
  }
  const { data: t } = await db.from("tenancies").select("tenants").eq("id", id).single();
  if (!t) return Response.json({ error: "No such tenancy." }, { status: 404 });
  const adults = (t.tenants as { name: string }[]).map((x) => x.name);
  const missing = adults.filter((n) => !signers?.includes(n));
  if (missing.length) return Response.json({ error: `Every adult tenant must agree: ${missing.join(", ")} hasn't.` }, { status: 400 });

  const agreement = {
    method: "paypal", paypal_email: paypalEmail, signed_by: signers, signed_at: new Date().toISOString(),
    text: "I agree that my security deposit, less any lawful deductions, may be returned to me electronically by PayPal at the email above (Cal. Civ. Code 1950.5(h)(1)(A)).",
  };
  await db.from("tenancies").update({
    refund_agreement: agreement,
    tenants: (t.tenants as { name: string }[]).map((x, i) => ({ ...x, email: i === 0 ? paypalEmail : null })),
  }).eq("id", id);
  await audit(id, "tenant", "refund_method_agreed", { method: "paypal", signed_by: signers });
  return Response.json({ ok: true });
}

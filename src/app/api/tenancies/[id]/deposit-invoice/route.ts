import { audit, db } from "@/lib/db";
import { takeAllowance } from "@/lib/limits";
import { InvoiceNotCreated, sendDepositInvoice } from "@/lib/paypal";
import { lawfulDeposit, type LeaseTerms } from "@/lib/rules";

export const runtime = "nodejs";

// The agent invoices the deposit through PayPal, but only the lawful amount: if the lease asks for more than the
// cap (D3/D4), it invoices the cap and logs why. The refund agreement must exist first so the money's way back
// is settled before it comes in.
export async function POST(_req: Request, ctx: RouteContext<"/api/tenancies/[id]/deposit-invoice">) {
  const { id } = await ctx.params;
  const { data: t } = await db.from("tenancies").select("lease_terms, refund_agreement, properties(address, owner_name)").eq("id", id).single();
  if (!t) return Response.json({ error: "No such tenancy." }, { status: 404 });
  const agreement = t.refund_agreement as { paypal_email: string } | null;
  if (!agreement) return Response.json({ error: "Record the tenant's refund agreement first." }, { status: 400 });
  const terms = t.lease_terms as LeaseTerms;
  const lawful = lawfulDeposit(terms);
  if (!lawful) return Response.json({ error: "Can't tell the legal cap yet; confirm the owner type and portfolio." }, { status: 400 });
  const prop = t.properties as unknown as { address: string; owner_name: string | null };

  const reduced = lawful.amount < lawful.charged;
  const note = reduced
    ? `Security deposit capped at the California limit (Civ. Code 1950.5(c)). The lease lists $${lawful.charged.toFixed(2)} in move-in charges; $${lawful.amount.toFixed(2)} is the lawful maximum.`
    : "Security deposit, held and returned under California Civil Code 1950.5.";
  // Today's allowance of sandbox invoices, checked before PayPal is called.
  const run = await takeAllowance("invoice");
  if (run.refused) return run.refused;
  try {
    const inv = await sendDepositInvoice({
      tenantEmail: agreement.paypal_email, amount: lawful.amount,
      landlordName: prop.owner_name ?? "Landlord", address: prop.address, note,
    });
    await db.from("payments").insert({ tenancy_id: id, kind: "deposit_invoice", paypal_id: inv.id, amount: lawful.amount, status: "SENT", raw: inv });
    await audit(id, "agent", "deposit_invoice_sent", {
      paypal_invoice: inv.id, amount: lawful.amount, charged_by_lease: lawful.charged, cap: lawful.cap,
      reason: reduced ? "lease over the legal cap; invoiced the cap" : "lease within the cap",
    });
    return Response.json({ ok: true, invoiceId: inv.id, payLink: inv.payLink, amount: lawful.amount, reduced });
  } catch (e) {
    // PayPal refused to create the invoice, so nothing exists in the sandbox and the unit goes back. One created but
    // not sent keeps it.
    if (e instanceof InvoiceNotCreated) await run.giveBack();
    await audit(id, "agent", "deposit_invoice_failed", { error: String(e).slice(0, 300) });
    return Response.json({ error: "PayPal didn't accept the invoice. Try again." }, { status: 502 });
  }
}

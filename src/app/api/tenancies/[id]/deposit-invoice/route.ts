import { audit, db } from "@/lib/db";
import { takeAllowance } from "@/lib/limits";
import { InvoiceNotCreated, sendDepositInvoice } from "@/lib/paypal";
import { lawfulDeposit, type LeaseTerms } from "@/lib/rules";
import { packFor } from "@/lib/states";
import { routeTenancy } from "@/lib/workspace";

export const runtime = "nodejs";

// The agent invoices the deposit through PayPal, but only the lawful amount under the tenancy's state pack: if the
// lease asks for more than the cap (California D3/D4, New York's one month), it invoices the cap and logs why. The
// refund agreement (or, where the state needs none, the tenants' PayPal designation) must exist first so the money's
// way back is settled before it comes in, and it names the email the invoice goes to. Washington: no deposit may be
// collected before the signed move-in checklist (RCW 59.18.260(2)).
export async function POST(_req: Request, ctx: RouteContext<"/api/tenancies/[id]/deposit-invoice">) {
  const { id } = await ctx.params;
  const ws = await routeTenancy(id, { write: true });
  if (ws instanceof Response) return ws;
  const { data: t } = await db.from("tenancies").select("lease_terms, refund_agreement, notices, properties(address, owner_name, state)").eq("id", id).single();
  if (!t) return Response.json({ error: "No such tenancy." }, { status: 404 });
  const agreement = t.refund_agreement as { paypal_email: string } | null;
  const prop = t.properties as unknown as { address: string; owner_name: string | null; state?: string | null };
  const pack = packFor(prop.state);
  if (!agreement) return Response.json({ error: pack.refund.invoiceFirst }, { status: 400 });
  const before = pack.records.find((r) => r.beforeInvoice);
  if (before && !(t.notices as Record<string, unknown> | null)?.[before.kind]) {
    return Response.json({ error: `Record the signed ${before.short} first: no deposit may be collected without it (${before.cite}).` }, { status: 400 });
  }
  const terms = t.lease_terms as LeaseTerms;
  const lawful = lawfulDeposit(terms, pack);
  if (!lawful) return Response.json({ error: pack.lease.capUnknown }, { status: 400 });

  const reduced = lawful.amount < lawful.charged;
  const note = pack.lease.invoiceNote(lawful);
  // Today's allowance of sandbox invoices, checked before PayPal is called.
  const run = await takeAllowance("invoice");
  if (run.refused) return run.refused;
  try {
    const inv = await sendDepositInvoice({
      tenantEmail: agreement.paypal_email, amount: lawful.amount,
      landlordName: prop.owner_name ?? "Landlord", address: prop.address, note, terms: pack.lease.invoiceTerms,
    });
    await db.from("payments").insert({ tenancy_id: id, kind: "deposit_invoice", paypal_id: inv.id, amount: lawful.amount, status: "SENT", raw: inv });
    await audit(id, "agent", "deposit_invoice_sent", {
      paypal_invoice: inv.id, amount: lawful.amount, charged_by_lease: lawful.charged, cap: lawful.cap,
      reason: reduced ? "lease over the legal cap; invoiced the cap" : lawful.cap == null ? "no statewide cap" : "lease within the cap",
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

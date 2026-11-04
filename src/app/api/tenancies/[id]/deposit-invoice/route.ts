import { audit, db } from "@/lib/db";
import { takeAllowance } from "@/lib/limits";
import { InvoiceNotCreated, SANDBOX, sendDepositInvoice } from "@/lib/paypal";
import { lawfulDeposit, type LeaseTerms } from "@/lib/rules";
import { packFor } from "@/lib/states";
import { routeTenancy } from "@/lib/workspace";

export const runtime = "nodejs";

// The agent invoices the deposit through PayPal, but only the lawful amount under the tenancy's state pack: if the
// lease asks for more than the cap (California D3/D4, New York's one month), it invoices the cap and logs why. The
// refund agreement (or, where the state needs none, the tenants' PayPal designation) must exist first so the money's
// way back is settled before it comes in, and it names the email the invoice goes to. Washington: no deposit may be
// collected before the signed move-in checklist (RCW 59.18.260(2)). One invoice per tenancy: here the database allows
// one deposit_invoice row per tenancy, and at PayPal the invoice is made once by its invoice number, from the tenancy
// and the invoice (paypal.ts, depositInvoiceNumber), which PayPal refuses to repeat. A second request (a double click,
// a second tab, a retry after a lost answer or a row that wasn't saved) finds that invoice instead of making another.
export async function POST(_req: Request, ctx: RouteContext<"/api/tenancies/[id]/deposit-invoice">) {
  // Money in is held to the same rule as money out (agent.ts, refuseLiveWithoutSignIn): until the landlord pages have
  // a real sign-in, a LIVE PayPal environment is refused here, before the session or the database is read.
  if (!SANDBOX) return Response.json({ error: "This build has no landlord sign-in, so it won't send a live PayPal invoice. Set PAYPAL_ENVIRONMENT=SANDBOX (docs/DEPLOY.md)." }, { status: 409 });
  const { id } = await ctx.params;
  const ws = await routeTenancy(id, { write: true });
  if (ws instanceof Response) return ws;
  const [{ data: t }, { data: existing }] = await Promise.all([
    db.from("tenancies").select("lease_terms, refund_agreement, notices, properties(address, owner_name, state)").eq("id", id).single(),
    db.from("payments").select("id").eq("tenancy_id", id).eq("kind", "deposit_invoice").limit(1),
  ]);
  if (!t) return Response.json({ error: "No such tenancy." }, { status: 404 });
  // One deposit invoice per tenancy (a second click, a second tab): the database holds to it as well.
  if (existing?.length) return Response.json({ error: "The deposit invoice was already sent. Reload the page to see it." }, { status: 409 });
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
      tenancyId: id, tenantEmail: agreement.paypal_email, amount: lawful.amount,
      landlordName: prop.owner_name ?? "Landlord", address: prop.address, note, terms: pack.lease.invoiceTerms,
    });
    // An invoice an earlier try made (found by its number) is no new sandbox invoice, so today's unit goes back.
    if (inv.adopted) await run.giveBack();
    const { error: stored } = await db.from("payments").insert({ tenancy_id: id, kind: "deposit_invoice", paypal_id: inv.id, amount: lawful.amount, status: "SENT", raw: inv });
    // Another request recorded this tenancy's invoice first (the same invoice: PayPal won't repeat its number), or the
    // database couldn't take the row; a retry then finds the same invoice at PayPal by its number and records it.
    if (stored) {
      console.error("deposit invoice not recorded", stored.message);
      if (stored.code === "23505") return Response.json({ error: "The deposit invoice was already sent. Reload the page to see it." }, { status: 409 });
      await audit(id, "agent", "deposit_invoice_unsaved", { paypal_invoice: inv.id, invoice_number: inv.invoiceNumber, amount: lawful.amount });
      return Response.json({ error: "PayPal has the invoice, but it couldn't be saved here. Try again: it picks up the same invoice, not a second one." }, { status: 500 });
    }
    await audit(id, "agent", "deposit_invoice_sent", {
      paypal_invoice: inv.id, invoice_number: inv.invoiceNumber, amount: lawful.amount, charged_by_lease: lawful.charged, cap: lawful.cap,
      reason: reduced ? "lease over the legal cap; invoiced the cap" : lawful.cap == null ? "no statewide cap" : "lease within the cap",
      ...(inv.adopted ? { adopted: true } : {}),
    });
    return Response.json({ ok: true, invoiceId: inv.id, payLink: inv.payLink, amount: lawful.amount, reduced });
  } catch (e) {
    // PayPal refused to create the invoice, so nothing exists in the sandbox and the unit goes back. One created but
    // not sent, or whose answer was lost, keeps it: the retry finds that invoice by its number.
    const refused = e instanceof InvoiceNotCreated;
    if (refused) await run.giveBack();
    await audit(id, "agent", "deposit_invoice_failed", { error: String(e).slice(0, 300), ...(refused ? {} : { unconfirmed: true }) });
    return Response.json({ error: refused ? "PayPal didn't accept the invoice. Try again." : "PayPal didn't confirm the invoice. Try again: it picks up the same invoice, not a second one." }, { status: 502 });
  }
}

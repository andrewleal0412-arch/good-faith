import Link from "next/link";
import { notFound } from "next/navigation";
import { db, signedUrl } from "@/lib/db";
import { getInvoice } from "@/lib/paypal";
import { lawfulDeposit, type Flag, type LeaseTerms } from "@/lib/rules";
import { MoveInSteps } from "./move-in-steps";
import { MoveOut, type FindingView } from "./move-out";

export const dynamic = "force-dynamic";

const usd = (n: number | null | undefined) =>
  n == null ? "--" : `$${Number(n).toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;

export default async function TenancyPage({ params }: PageProps<"/tenancy/[id]">) {
  const { id } = await params;
  const { data: t } = await db.from("tenancies").select("*, properties(*)").eq("id", id).single();
  if (!t) notFound();
  const [{ data: payments }, { data: photos }, { data: log }] = await Promise.all([
    db.from("payments").select("*").eq("tenancy_id", id).order("created_at"),
    db.from("photos").select("*").eq("tenancy_id", id).order("created_at"),
    db.from("audit_log").select("*").eq("tenancy_id", id).order("created_at", { ascending: false }).limit(30),
  ]);

  // Live invoice status from PayPal, so "Paid" shows the moment the tenant pays.
  const invoice = (payments ?? []).find((p) => p.kind === "deposit_invoice");
  let invoiceStatus: string | null = invoice?.status ?? null;
  if (invoice?.paypal_id) {
    try {
      const live = await getInvoice(invoice.paypal_id);
      invoiceStatus = live.status;
      if (live.status !== invoice.status) {
        // Keep PayPal's transaction ids: the move-out refund goes back against the original payment.
        await db.from("payments").update({
          status: live.status,
          raw: { ...(invoice.raw ?? {}), transactions: live.payments?.transactions ?? [] },
        }).eq("id", invoice.id);
      }
    } catch { /* keep the stored status */ }
  }

  const photoViews = await Promise.all((photos ?? []).map(async (p) => ({
    id: p.id as string, phase: p.phase as string, room: p.room as string, url: await signedUrl("photos", p.storage_path),
  })));
  // Move-out findings with signed before/after URLs for the side-by-side view.
  const findings: FindingView[] = await Promise.all(((t.move_out_findings ?? []) as (Omit<FindingView, "beforeUrl" | "afterUrl"> & {
    moveInPath: string; moveOutPath: string;
  })[]).map(async (f) => ({ ...f, beforeUrl: await signedUrl("photos", f.moveInPath), afterUrl: await signedUrl("photos", f.moveOutPath) })));
  const terms = t.lease_terms as LeaseTerms;
  const flags = (t.lease_flags ?? []) as Flag[];
  const prop = t.properties as { address: string; owner_name: string | null };

  return (
    <main className="mx-auto w-full max-w-3xl px-5 py-10">
      <Link href="/" className="text-[13px] font-semibold uppercase tracking-[0.14em] text-accent">Deposit Agent</Link>
      <h1 className="mt-2 text-[30px] font-semibold leading-tight tracking-[-0.02em]">{prop.address}</h1>
      <p className="mt-1 text-[15px] text-ink-2">
        {(t.tenants as { name: string }[]).map((x) => x.name).join(" and ")} · since {t.start_date ?? "--"} · rent {usd(t.monthly_rent)}
      </p>

      <MoveInSteps
        tenancyId={id}
        tenants={(t.tenants as { name: string }[]).map((x) => x.name)}
        flagCounts={{
          violations: flags.filter((f) => f.severity === "violation").length,
          warnings: flags.filter((f) => f.severity === "warning").length,
        }}
        agreement={t.refund_agreement as { paypal_email: string; signed_by: string[]; signed_at: string } | null}
        lawful={lawfulDeposit(terms)}
        invoice={invoice ? { id: invoice.paypal_id, amount: Number(invoice.amount), status: invoiceStatus ?? "SENT",
          payLink: (invoice.raw as { payLink?: string } | null)?.payLink ?? null } : null}
        photos={photoViews}
      />

      <MoveOut
        tenancyId={id}
        rooms={[...new Set(photoViews.filter((x) => x.phase === "move_in").map((x) => x.room))]}
        moveOutPhotos={photoViews.filter((x) => x.phase === "move_out_before")}
        findings={findings}
        inspectedAt={t.move_out_inspected_at}
      />

      <section className="mt-10">
        <h2 className="text-[13px] font-semibold uppercase tracking-[0.12em] text-ink-3">Activity</h2>
        <ul className="mt-3 space-y-2">
          {(log ?? []).map((e) => (
            <li key={e.id} className="flex gap-3 text-[13px]">
              <span className="w-[112px] shrink-0 whitespace-nowrap tabular-nums text-ink-3">
                {new Date(e.created_at).toLocaleString("en-US", { month: "short", day: "numeric", hour: "numeric", minute: "2-digit" })}
              </span>
              <span className={`w-[72px] shrink-0 font-semibold ${e.actor === "agent" ? "text-accent" : e.actor === "tenant" ? "text-info" : "text-ink-2"}`}>
                {e.actor}
              </span>
              <span className="text-ink-2">{describe(e.action, e.detail)}</span>
            </li>
          ))}
        </ul>
      </section>
    </main>
  );
}

function describe(action: string, d: Record<string, unknown> | null): string {
  switch (action) {
    case "lease_checked": {
      const v = (d?.violations as string[])?.length ?? 0, w = (d?.warnings as string[])?.length ?? 0;
      return `Checked the lease: ${v} violation${v === 1 ? "" : "s"}, ${w} warning${w === 1 ? "" : "s"}`;
    }
    case "tenancy_started": return "Started this tenancy";
    case "refund_method_agreed": return `Agreed in writing to a PayPal refund (${(d?.signed_by as string[])?.join(", ")})`;
    case "deposit_invoice_sent": return `Sent a PayPal deposit invoice for ${usd(d?.amount as number)}${d?.reason === "lease over the legal cap; invoiced the cap" ? `, not the ${usd(d?.charged_by_lease as number)} the lease asks for (legal cap)` : ""}`;
    case "deposit_invoice_failed": return "PayPal rejected the deposit invoice";
    case "move_out_inspected": return `Compared move-in and move-out photos (${(d?.rooms as string[])?.join(", ")}): ${d?.damage} damage, ${d?.cleaning} cleaning, ${d?.wear_and_tear} wear and tear (not chargeable)${(d?.unclear as number) ? `, ${d?.unclear} unclear` : ""}`;
    case "photos_added": return `Added ${d?.count} ${String(d?.phase).replace(/_/g, " ")} photo${d?.count === 1 ? "" : "s"}: ${d?.room}`;
    default: return action.replace(/_/g, " ");
  }
}

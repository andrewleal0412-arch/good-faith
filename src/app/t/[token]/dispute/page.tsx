import type { Metadata } from "next";
import Link from "@/components/link";
import { notFound } from "next/navigation";
import { Icon } from "@/components/icons";
import { NOT_LEGAL_ADVICE } from "@/lib/agent-words";
import { displayName } from "@/lib/copy";
import { loadTenantDispute } from "@/lib/disputes";
import { loadNegotiation } from "@/lib/negotiation";
import { streetLine } from "@/lib/ledger";
import { SANDBOX } from "@/lib/paypal";
import { keepUnit } from "@/lib/property-view";
import { packFor } from "@/lib/states/server";
import { resolveTenantToken } from "@/lib/tenant-links";
import { DisputeFlow } from "./dispute-flow";

export const dynamic = "force-dynamic";

export const metadata: Metadata = { title: "Dispute a deduction", robots: { index: false, follow: false }, referrer: "no-referrer" };

// The tenants' dispute, on their own link: pick the deductions, say why, add photos, ask their advocate, send it. A
// focused page in the tenant page's column, phone first. Everything on it comes from loadTenantDispute, which hands
// over line numbers, deduction ids and photo ids, never a storage path or the tenancy id.
export default async function DisputePage({ params }: PageProps<"/t/[token]/dispute">) {
  const { token } = await params;
  const link = await resolveTenantToken(token);
  if (!link) notFound();
  const [v, negotiation] = await Promise.all([loadTenantDispute(link.tenancyId), loadNegotiation(link.tenancyId, "tenant")]);
  if (!v) notFound();
  const pack = packFor(v.state);
  const landlord = v.landlord ? displayName(v.landlord) : "Your landlord";
  // A withdrawn dispute reads like none: the page is where the tenants dispute the statement again.
  const sent = !!v.dispute && v.dispute.status !== "draft" && v.dispute.status !== "withdrawn";

  return (
    <div className="min-h-screen bg-canvas">
      <header className="border-b border-line">
        <div className="mx-auto flex h-[52px] w-full max-w-[600px] items-center gap-3 px-4 sm:px-5">
          <Link href={`/t/${token}`} aria-label="Back to your deposit" className="-ml-1 inline-flex size-8 shrink-0 items-center justify-center rounded-full text-ink-2 transition-colors hover:bg-surface">
            <Icon name="arrow-left" className="size-[15px]" />
          </Link>
          <span className="min-w-0 truncate text-base font-medium">{landlord}</span>
          {SANDBOX && <span title="PayPal sandbox: no real money moves" className="ml-auto shrink-0 text-xs text-ink-3">Sandbox</span>}
        </div>
      </header>

      <main className="gf-page mx-auto w-full max-w-[600px] px-4 pb-12 pt-6 sm:px-5 sm:pt-10">
        <h1 className="text-xl font-medium">{sent ? "Your dispute" : "Dispute a deduction"}</h1>
        <p className="mt-0.5 text-sm text-ink-3">{keepUnit(streetLine(v.address))}</p>

        {!v.sent ? (
          <p className="mt-6 text-ink-2">A dispute opens once {landlord} has sent the itemized statement.</p>
        ) : !v.lines.length ? (
          <p className="mt-6 text-ink-2">Nothing was deducted, so there&apos;s nothing to dispute.</p>
        ) : (
          <DisputeFlow token={token} landlord={landlord} view={v} stateName={pack.name} notLegalAdvice={NOT_LEGAL_ADVICE} negotiation={negotiation} zone={pack.timeZone.id} />
        )}

        <footer className="mt-10 text-center text-xs text-ink-3">
          Prepared with <span className="font-medium text-ink-2">Good Faith</span>. Not legal advice.
        </footer>
      </main>
    </div>
  );
}

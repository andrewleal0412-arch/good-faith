import Link from "@/components/link";
import { ButtonLink } from "@/components/button";
import { Icon } from "@/components/icons";
import { InfoTip } from "@/components/info-tip";
import { Card, CardHead, Money, StatusChip } from "@/components/ui";
import { TENANT_VIEW_TIP } from "@/lib/copy";
import { shortDate } from "@/lib/dates";
import { usd } from "@/lib/deductions";

// The refund on the Move-out tab: one line saying where it stands, and the way into the focused review page
// (/tenancy/<id>/refund), where the agent prepares it and the landlord sends it. The approval itself lives there only.

export function CloseOut(p: {
  tenancyId: string;
  tenants: string[];
  due: number; // the refund the deductions leave, by the rules engine's math
  run: { status: string; error: string | null; at: string | null; pendingAmount: number | null } | null;
  returned: { amount: number; kind: string; id: string | null; on: string } | null; // what PayPal sent back, once it has
  // What PayPal returned through the tenants' PayPal dispute (`due` is already less it), and the deductions it covered
  // past the refund owed.
  viaDispute?: { amount: number; id: string | null; notKept: number } | null;
  // Refunds made in PayPal that the landlord recorded as this deposit's refund (`due` is already less them), and the
  // ones still waiting for the landlord's decision, which hold the refund.
  outside?: { amount: number; count: number } | null;
  waiting?: { count: number; amount: number } | null;
  // A demo copy's tenants' page (one person plays both sides), shown once the refund went: whether the statement is
  // out, which the tenants need before they can dispute it, and whether they already did.
  tenantView?: { href: string; delivered: boolean; disputed: boolean } | null;
}) {
  const href = `/tenancy/${p.tenancyId}/refund`;
  const word = p.returned?.kind === "payout" ? "Payout" : "Refund";
  const viaDispute = p.returned?.kind === "dispute_refund";
  // Refunds made in PayPal and recorded here cover what is owed: they stand for the refund.
  const inPayPal = p.returned?.kind === "outside_refund";
  const payments = `/tenancy/${p.tenancyId}?tab=payments`;
  const awaiting = p.run?.status === "awaiting_approval" && p.run.pendingAmount != null;

  let body: React.ReactNode;
  if (p.returned) {
    body = (
      <>
        <span className="flex size-6 shrink-0 items-center justify-center rounded-full bg-green-bg text-green"><Icon name="check" className="size-3.5" /></span>
        <div className="min-w-0 flex-[1_1_14rem]">
          <p className="text-sm font-medium">{viaDispute ? <><Money value={p.returned.amount} /> returned through the PayPal dispute {shortDate(p.returned.on)}</>
            : inPayPal ? <><Money value={p.returned.amount} /> refunded in PayPal {shortDate(p.returned.on)}</>
              : <>{word} of <Money value={p.returned.amount} /> sent {shortDate(p.returned.on)}</>}</p>
          {p.returned.id && <p className="break-all text-xs text-ink-3">{inPayPal ? `Recorded as this deposit's refund, PayPal refund ${p.returned.id}${(p.outside?.count ?? 1) > 1 ? ` and ${(p.outside?.count ?? 1) - 1} more` : ""}` : `PayPal ${viaDispute ? "dispute" : p.returned.kind === "payout" ? "payout" : "refund"} ${p.returned.id}`}{viaDispute && p.viaDispute?.notKept ? `. More than the refund owed, so ${usd(p.viaDispute.notKept)} of the deductions is not kept.` : ""}</p>}
          {!viaDispute && p.viaDispute && <p className="text-xs text-ink-3">Also {usd(p.viaDispute.amount)} through the PayPal dispute</p>}
          {!inPayPal && p.outside && <p className="text-xs text-ink-3">Also {usd(p.outside.amount)} refunded in PayPal</p>}
        </div>
        <div className="ml-auto flex items-center gap-3">
          <Link href={`/tenancy/${p.tenancyId}/statement`} className="text-sm font-medium text-brand hover:underline">Itemized statement</Link>
          <ButtonLink href={viaDispute ? `/tenancy/${p.tenancyId}?tab=payments#paypal-dispute` : inPayPal ? payments : href}>{viaDispute ? "View dispute" : inPayPal ? "View payments" : "View receipt"}</ButtonLink>
        </div>
      </>
    );
  } else {
    const [line, sub] = awaiting
      ? [<><Money value={p.run!.pendingAmount!} /> ready to send</>, `Prepared by the agent${p.run!.at ? ` ${shortDate(p.run!.at)}` : ""}. Nothing moves until you send it.`]
      : p.run?.status === "running" ? ["The agent is preparing the refund", "It reads the file and checks the deposit with PayPal."]
        : p.run?.status === "failed" ? ["The last close-out run stopped", p.run.error ?? "No reason was recorded."]
          : p.waiting ? [<><Money value={p.waiting.amount} /> refunded in PayPal, not from here</>, "Record it as this deposit's refund, or mark it not this deposit, on Payments. The refund waits until then."]
          : [<><Money value={p.due} /> to {p.tenants.length ? p.tenants.join(" and ") : "the tenants"}</>,
            p.viaDispute && !p.outside ? `What is left after ${usd(p.viaDispute.amount)} PayPal returned through the tenants' PayPal dispute. Nothing moves until you approve it.`
              : p.outside ? `What is left after ${usd(p.outside.amount + (p.viaDispute?.amount ?? 0))} already refunded. Nothing moves until you approve it.` : "Nothing moves until you approve it."];
    body = (
      <>
        <span className="flex size-6 shrink-0 items-center justify-center rounded-full bg-brand-50 text-brand"><Icon name="send" className="size-3.5" /></span>
        <div className="min-w-0 flex-[1_1_14rem]">
          <p className="text-sm font-medium">{line}</p>
          <p className="truncate text-xs text-ink-3" title={typeof sub === "string" ? sub : undefined}>{sub}</p>
        </div>
        {p.waiting ? <ButtonLink href={`${payments}#outside-refunds`} className="ml-auto">Review in Payments</ButtonLink>
          : <ButtonLink href={href} className="ml-auto">Review refund</ButtonLink>}
      </>
    );
  }

  return (
    <Card>
      <CardHead title="Refund" right={awaiting ? <StatusChip live tone="amber">Waiting for you</StatusChip> : undefined} />
      {/* The words take the line; on a phone the actions drop under them instead of squeezing them a word wide. */}
      <div className="flex flex-wrap items-center gap-x-3 gap-y-3 px-5 py-4">{body}</div>
      {p.returned && p.tenantView && (
        <div className="flex flex-wrap items-center gap-x-3 gap-y-1 border-t border-line-2 px-5 py-3 text-sm">
          <a href={p.tenantView.href} target="_blank" rel="noopener noreferrer" className="inline-flex items-center gap-1 font-medium text-brand hover:underline">
            Open the tenant&apos;s view<Icon name="arrow-up-right" className="size-3.5" />
          </a>
          <span className="min-w-0 flex-[1_1_12rem] text-ink-3">
            {p.tenantView.disputed ? "Their side of the dispute"
              : p.tenantView.delivered ? "Dispute a charge as the tenants"
                : <>Record the <Link href={`/tenancy/${p.tenancyId}/statement`} className="text-brand hover:underline">statement&apos;s delivery</Link> first, so the tenants can dispute it</>}
          </span>
          <InfoTip align="end" title="The tenants' side">{TENANT_VIEW_TIP}</InfoTip>
        </div>
      )}
    </Card>
  );
}

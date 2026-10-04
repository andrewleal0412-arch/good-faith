import Link from "next/link";
import { ButtonLink } from "@/components/button";
import { Icon } from "@/components/icons";
import { InfoTip } from "@/components/info-tip";
import { Card, CardHead, Money, StatusChip } from "@/components/ui";
import { TENANT_VIEW_TIP } from "@/lib/copy";
import { shortDate } from "@/lib/dates";

// The refund on the Move-out tab: one line saying where it stands, and the way into the focused review page
// (/tenancy/<id>/refund), where the agent prepares it and the landlord sends it. The approval itself lives there only.

export function CloseOut(p: {
  tenancyId: string;
  tenants: string[];
  due: number; // the refund the deductions leave, by the rules engine's math
  run: { status: string; error: string | null; at: string | null; pendingAmount: number | null } | null;
  returned: { amount: number; kind: string; id: string | null; on: string } | null; // what PayPal sent back, once it has
  // A demo copy's tenants' page (one person plays both sides), shown once the refund went: whether the statement is
  // out, which the tenants need before they can dispute it, and whether they already did.
  tenantView?: { href: string; delivered: boolean; disputed: boolean } | null;
}) {
  const href = `/tenancy/${p.tenancyId}/refund`;
  const word = p.returned?.kind === "payout" ? "Payout" : "Refund";
  const awaiting = p.run?.status === "awaiting_approval" && p.run.pendingAmount != null;

  let body: React.ReactNode;
  if (p.returned) {
    body = (
      <>
        <span className="flex size-6 shrink-0 items-center justify-center rounded-full bg-green-bg text-green"><Icon name="check" className="size-3.5" /></span>
        <div className="min-w-0 flex-[1_1_14rem]">
          <p className="text-sm font-medium">{word} of <Money value={p.returned.amount} /> sent {shortDate(p.returned.on)}</p>
          {p.returned.id && <p className="break-all text-xs text-ink-3">PayPal {p.returned.kind === "payout" ? "payout" : "refund"} {p.returned.id}</p>}
        </div>
        <div className="ml-auto flex items-center gap-3">
          <Link href={`/tenancy/${p.tenancyId}/statement`} className="text-sm font-medium text-brand hover:underline">Itemized statement</Link>
          <ButtonLink href={href}>View receipt</ButtonLink>
        </div>
      </>
    );
  } else {
    const [line, sub] = awaiting
      ? [<><Money value={p.run!.pendingAmount!} /> ready to send</>, `Prepared by the agent${p.run!.at ? ` ${shortDate(p.run!.at)}` : ""}. Nothing moves until you send it.`]
      : p.run?.status === "running" ? ["The agent is preparing the refund", "It reads the file and checks the deposit with PayPal."]
        : p.run?.status === "failed" ? ["The last close-out run stopped", p.run.error ?? "No reason was recorded."]
          : [<><Money value={p.due} /> to {p.tenants.length ? p.tenants.join(" and ") : "the tenants"}</>, "Nothing moves until you approve it."];
    body = (
      <>
        <span className="flex size-6 shrink-0 items-center justify-center rounded-full bg-brand-50 text-brand"><Icon name="send" className="size-3.5" /></span>
        <div className="min-w-0 flex-[1_1_14rem]">
          <p className="text-sm font-medium">{line}</p>
          <p className="truncate text-xs text-ink-3" title={typeof sub === "string" ? sub : undefined}>{sub}</p>
        </div>
        <ButtonLink href={href} className="ml-auto">Review refund</ButtonLink>
      </>
    );
  }

  return (
    <Card>
      <CardHead title="Refund" right={awaiting ? <StatusChip tone="amber">Waiting for you</StatusChip> : undefined} />
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

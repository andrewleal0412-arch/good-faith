import Link from "next/link";
import { notFound } from "next/navigation";
import type { Pending } from "@/lib/agent";
import { timeline } from "@/lib/agent-timeline";
import { guardRefund } from "@/lib/closeout";
import { wasPaid } from "@/lib/invoice-status";
import { db, signedUrl } from "@/lib/db";
import type { StoredDeduction } from "@/lib/deductions";
import { refreshDepositInvoice } from "@/lib/deposit";
import { longDate, pacificToday } from "@/lib/dates";
import { tenancyEvents } from "@/lib/ics";
import { closedOut } from "@/lib/next-step";
import { NOTICE_INFO, NOTICE_METHOD_LABEL, type NoticeKind, type NoticeMethod } from "@/lib/notices";
import { lawfulDeposit, type Flag, type LeaseTerms } from "@/lib/rules";
import { describeDelivery, type DeliveryRecord } from "@/lib/statement";
import type { TenantMoveOut } from "@/lib/tenant";
import { activeTenantLink } from "@/lib/tenant-links";
import { summarizeTenancy } from "@/lib/units";
import { MoveInSteps } from "./move-in-steps";
import { MoveOut, type FindingView } from "./move-out";
import { CloseOut, type PendingView } from "./close-out";
import { NoticeSection } from "./notice";
import { Settlement } from "./settlement";
import { TenantLinkPanel } from "./tenant-link";

export const dynamic = "force-dynamic";

const usd = (n: number | null | undefined) =>
  n == null ? "--" : `$${Number(n).toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;

export default async function TenancyPage({ params }: PageProps<"/tenancy/[id]">) {
  const { id } = await params;
  const { data: t } = await db.from("tenancies").select("*, properties(*)").eq("id", id).single();
  if (!t) notFound();
  const [{ data: payments }, { data: photos }, { data: deductionRows }, { data: log }, { data: runs }, tenantLink] = await Promise.all([
    db.from("payments").select("*").eq("tenancy_id", id).order("created_at"),
    db.from("photos").select("*").eq("tenancy_id", id).order("created_at"),
    db.from("deductions").select("*").eq("tenancy_id", id).order("created_at"),
    db.from("audit_log").select("*").eq("tenancy_id", id).order("created_at", { ascending: false }).limit(40),
    db.from("agent_runs").select("*").eq("tenancy_id", id).eq("kind", "close_out").order("created_at", { ascending: false }).limit(1),
    activeTenantLink(id),
  ]);

  // Live invoice status from PayPal, so "Paid" shows the moment the tenant pays. The refreshed row takes the stored
  // one's place in the list the summary reads, so it sees what PayPal just said rather than the stale copy.
  const storedInvoice = (payments ?? []).find((p) => p.kind === "deposit_invoice");
  const invoice = storedInvoice ? await refreshDepositInvoice(storedInvoice) : null;
  const invoiceStatus: string | null = invoice?.status ?? null;
  const paymentRows = (payments ?? []).map((p) => (invoice && p.id === invoice.id ? invoice : p));

  const photoViews = await Promise.all((photos ?? []).map(async (p) => ({
    id: p.id as string, phase: p.phase as string, room: p.room as string, url: await signedUrl("photos", p.storage_path),
  })));
  const deductions = (deductionRows ?? []).map((d) => ({ ...d, amount: Number(d.amount) })) as StoredDeduction[];
  // Move-out findings with signed before/after URLs for the side-by-side view, and the deduction made from each.
  const findings: FindingView[] = await Promise.all(((t.move_out_findings ?? []) as (Omit<FindingView, "beforeUrl" | "afterUrl" | "deduction"> & {
    moveInPath: string; moveOutPath: string;
  })[]).map(async (f) => {
    const d = deductions.find((x) => f.id && x.finding?.id === f.id);
    return {
      ...f, beforeUrl: await signedUrl("photos", f.moveInPath), afterUrl: await signedUrl("photos", f.moveOutPath),
      deduction: d ? { id: d.id, amount: d.amount, math: d.math, note: d.note ?? null } : null,
    };
  }));
  const paid = wasPaid(invoiceStatus);
  const returned = (payments ?? []).find((x) => x.kind === "refund" || x.kind === "payout");

  // The latest close-out run, with any pending money movement re-checked against the rules right now.
  const run = runs?.[0];
  let pendingView: PendingView | null = null;
  if (run?.status === "awaiting_approval" && run.pending) {
    const pd = run.pending as Pending;
    const refund = pd.toolName === "create_refund";
    const amount = refund ? (pd.input.amount as { value?: string })?.value ?? "" : String(pd.input.amount ?? "");
    pendingView = {
      tool: pd.toolName, amount: Number(amount),
      to: refund ? `The tenants' original PayPal payment (${pd.input.capture_id})` : `PayPal account ${pd.input.email}`,
      note: (refund ? pd.input.note_to_payer : pd.input.note) as string | null ?? null,
      check: await guardRefund(id, refund
        ? { rail: "refund_original_payment", amount, captureId: pd.input.capture_id as string }
        : { rail: "payout", amount, email: pd.input.email as string }),
    };
  }
  const agreement = t.refund_agreement as { paypal_email: string; signed_by: string[]; signed_at: string } | null;
  const terms = t.lease_terms as LeaseTerms;
  const flags = (t.lease_flags ?? []) as Flag[];
  const prop = t.properties as { address: string; owner_name: string | null };
  // The same summary the units page reads: the notice state and the dates for the calendar.
  const summary = summarizeTenancy(t, paymentRows, photos ?? [], deductions);
  const today = pacificToday();
  const tenantMoveOut = (t.tenant_move_out ?? null) as TenantMoveOut | null;

  return (
    <main className="mx-auto w-full max-w-3xl px-5 py-10">
      <Link href="/units" className="text-[13px] font-semibold uppercase tracking-[0.14em] text-accent">Your units</Link>
      <h1 className="mt-2 text-[30px] font-semibold leading-tight tracking-[-0.02em]">{prop.address}</h1>
      {/* Separate spans rather than one line with dots between, so a line that wraps on a phone never starts with a dot. */}
      <p className="mt-1 flex flex-wrap gap-x-3 text-[15px] text-ink-2">
        <span>{(t.tenants as { name: string }[]).map((x) => x.name).join(" and ")}</span>
        <span>since {t.start_date ? longDate(t.start_date) : "--"}</span>
        <span>rent {usd(t.monthly_rent)}</span>
      </p>

      <MoveInSteps
        tenancyId={id}
        tenants={(t.tenants as { name: string }[]).map((x) => x.name)}
        flagCounts={{
          violations: flags.filter((f) => f.severity === "violation").length,
          warnings: flags.filter((f) => f.severity === "warning").length,
        }}
        agreement={agreement}
        lawful={lawfulDeposit(terms)}
        invoice={invoice ? { id: invoice.paypal_id, amount: Number(invoice.amount), status: invoiceStatus ?? "SENT",
          payLink: (invoice.raw as { payLink?: string } | null)?.payLink ?? null } : null}
        photos={photoViews}
      />

      <TenantLinkPanel tenancyId={id} address={prop.address} contacts={(t.tenants ?? []) as { name: string; email: string | null }[]} active={tenantLink} />

      <NoticeSection
        tenancyId={id}
        today={today}
        tenants={summary.tenants}
        endDate={summary.endDate}
        noticeGivenOn={summary.noticeGivenOn}
        plannedMoveOut={summary.plannedMoveOut}
        moveOutDate={summary.moveOutDate}
        notices={summary.notices}
        refundNotice={summary.refundNotice}
        events={tenancyEvents(summary).map((e) => ({ kind: e.kind, date: e.date, label: e.label }))}
        closed={closedOut(summary)}
        tenantMoveOut={tenantMoveOut}
      />

      <MoveOut
        tenancyId={id}
        rooms={[...new Set(photoViews.filter((x) => x.phase === "move_in").map((x) => x.room))]}
        moveOutPhotos={photoViews.filter((x) => x.phase === "move_out_before")}
        findings={findings}
        inspectedAt={t.move_out_inspected_at}
        locked={!!returned}
      />

      {t.move_out_inspected_at && (
        <Settlement
          tenancyId={id}
          today={today}
          moveOutDate={t.move_out_date}
          depositHeld={paid && invoice ? Number(invoice.amount) : null}
          refundTo={agreement?.paypal_email ?? null}
          deductions={deductions}
          returned={returned ? { amount: Number(returned.amount), kind: returned.kind, id: returned.paypal_id, at: returned.created_at } : null}
          statement={{ href: `/tenancy/${id}/statement`, delivered: t.statement_delivery ? describeDelivery(t.statement_delivery as DeliveryRecord) : null }}
        />
      )}

      {t.move_out_inspected_at && (
        <CloseOut
          tenancyId={id}
          refunded={!!returned}
          run={run ? { id: run.id, status: run.status, error: run.error, items: timeline(run.messages), pending: pendingView } : null}
        />
      )}

      <section className="mt-10">
        <h2 className="text-[13px] font-semibold uppercase tracking-[0.12em] text-ink-3">Activity</h2>
        <ul className="mt-3 space-y-2">
          {(log ?? []).map((e) => (
            <li key={e.id} className="flex gap-3 text-[13px]">
              {/* The day with its year over the time: a tenancy's log spans a year or more, so "Oct 1" alone is ambiguous. */}
              <span className="w-[112px] shrink-0 whitespace-nowrap tabular-nums text-ink-3">
                <span className="block">{new Date(e.created_at).toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric", timeZone: "America/Los_Angeles" })}</span>
                <span className="block text-[12px]">{new Date(e.created_at).toLocaleTimeString("en-US", { hour: "numeric", minute: "2-digit", timeZone: "America/Los_Angeles" })}</span>
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

/** A YYYY-MM-DD from the log spelled out, the way every other surface shows dates; anything else as it is. */
const day = (v: unknown) => (typeof v === "string" && /^\d{4}-\d{2}-\d{2}$/.test(v) ? longDate(v) : String(v ?? "--"));

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
    case "deduction_added": return `Deducted ${usd(d?.amount as number)} for ${String(d?.item).toLowerCase()}: ${d?.math}`;
    case "deduction_removed": return `Removed the ${usd(d?.amount as number)} deduction for ${String(d?.item).toLowerCase()}`;
    case "move_out_date_set": return `Tenant moved out ${day(d?.move_out_date)}; statement and refund due by ${day(d?.statement_due)}`;
    case "close_out_started": return "Started the close-out";
    case "refund_proposed": return `Asked you to approve a ${usd(d?.amount as number)} refund`;
    case "refund_approved": return `Approved the ${usd(d?.amount as number)} refund`;
    case "refund_declined": return `Declined the ${usd(d?.amount as number)} refund`;
    case "refund_blocked": return `Stopped a refund that didn't match the rules: ${d?.reason}`;
    case "refund_sent": return `Returned ${usd(d?.amount as number)} through PayPal (${d?.refund_id ? `refund ${d.refund_id}` : `payout ${d?.payout_batch_id}`}, ${String(d?.status).toLowerCase()})`;
    case "refund_failed": return `PayPal didn't accept the ${usd(d?.amount as number)} refund`;
    case "close_out_finished": return "Finished the close-out";
    case "photos_added": return `Added ${d?.count} ${String(d?.phase).replace(/_/g, " ")} photo${d?.count === 1 ? "" : "s"}: ${d?.room}`;
    case "statement_delivered": return `Delivered the itemized statement by ${describeDelivery(d as unknown as DeliveryRecord)}`;
    case "statement_delivery_changed": return `Corrected the delivery record: ${describeDelivery(d?.next as DeliveryRecord)}`;
    case "statement_packet_built": return `Built the statement PDF packet (${d?.pages} page${d?.pages === 1 ? "" : "s"})`;
    case "lease_end_set": return d?.end_date ? `Set the lease end to ${day(d.end_date)}` : "Set the lease to month to month";
    case "notice_recorded":
    case "notice_changed":
      return `${action === "notice_changed" ? "Changed" : "Recorded"} the notice to end the tenancy: given ${day(d?.notice_given_on)}, planned move-out ${day(d?.planned_move_out)}; inspection window opens ${day(d?.inspection_window_opens)}`;
    case "notice_given": {
      const kind = d?.kind as NoticeKind, method = d?.method as NoticeMethod;
      return `Gave the ${NOTICE_INFO[kind]?.short ?? "notice"} by ${NOTICE_METHOD_LABEL[method] ?? method}${d?.to ? ` to ${d.to}` : ""} on ${day(d?.date)}`;
    }
    case "notice_given_removed": return `Removed the record that the ${NOTICE_INFO[d?.kind as NoticeKind]?.short ?? "notice"} was given`;
    case "tenant_link_created": return (d?.replaced as string[])?.length ? "Made a new tenant link; the old one stopped working" : "Made the tenant link";
    case "tenant_link_revoked": return "Turned the tenant link off";
    case "tenant_moving_out": return `${d?.name ?? "The tenants"} sent through the tenant link: moving out ${day(d?.planned_move_out)}; forwarding address ${d?.forwarding_address}`;
    case "tenant_moving_out_changed": return `${d?.name ?? "The tenants"} changed their move-out details through the tenant link: moving out ${day(d?.planned_move_out)}; forwarding address ${d?.forwarding_address}`;
    case "tenant_opened_statement": return "Opened the itemized statement through the tenant link";
    default: return action.replace(/_/g, " ");
  }
}

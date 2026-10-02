import "server-only";
import { longDate } from "./dates";
import { NOTICE_INFO, NOTICE_METHOD_LABEL, type NoticeKind, type NoticeMethod } from "./notices";
import { describeDelivery, type DeliveryRecord } from "./statement";

// The audit log in words: the full sentence the tenancy's activity list shows, and the short title the Properties
// page's Recent activity shows (Mercury's list: one title, the address under it, the date on the right).

const usd = (n: number | null | undefined) =>
  n == null ? "--" : `$${Number(n).toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;

/** A YYYY-MM-DD from the log spelled out, the way every other surface shows dates; anything else as it is. */
const day = (v: unknown) => (typeof v === "string" && /^\d{4}-\d{2}-\d{2}$/.test(v) ? longDate(v) : String(v ?? "--"));

export function describe(action: string, d: Record<string, unknown> | null): string {
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
    // A big selection arrives in several requests, each logged; "of N" is the whole selection.
    case "photos_added": return `Added ${d?.count}${d?.total ? ` of ${d.total}` : ""} ${String(d?.phase).replace(/_/g, " ")} photo${d?.count === 1 && !d?.total ? "" : "s"}: ${d?.room}`;
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

/** Actions too small for the Properties page's Recent activity (each PDF build, each lease check before a tenancy). */
export const QUIET_ACTIONS = ["statement_packet_built", "close_out_started", "close_out_finished", "lease_checked", "tenant_opened_statement", "refund_proposed", "refund_approved"];

/** The same for one tenancy's own Activity, which keeps the lease check and the tenants opening their statement. */
export const QUIET_ON_RECORD = QUIET_ACTIONS.filter((a) => a !== "lease_checked" && a !== "tenant_opened_statement");

type Entry = { tenancyId: string; action: string; detail: Record<string, unknown> | null };
const FOLDS = ["deduction_added", "photos_added"];

/** Activity rows with a run of the same action on one unit folded into one line (three deductions in a row, photos for
 *  several rooms), each with its short title. */
export function foldActivity<T extends Entry>(log: T[], tenantsOf: (tenancyId: string) => string[], max: number): { entry: T; title: string; count: number }[] {
  const out: { entry: T; title: string; count: number }[] = [];
  for (let i = 0; i < log.length && out.length < max; i++) {
    const e = log[i];
    let n = 1;
    if (FOLDS.includes(e.action)) while (log[i + n] && log[i + n].action === e.action && log[i + n].tenancyId === e.tenancyId) n++;
    const title = n > 1 && e.action === "deduction_added" ? `${n} deductions added`
      : n > 1 && e.action === "photos_added" ? `${String(e.detail?.phase).startsWith("move_out") ? "Move-out" : String(e.detail?.phase) === "after_repair" ? "After-repair" : "Move-in"} photos added for ${n} rooms`
        : activityTitle(e.action, e.detail, tenantsOf(e.tenancyId));
    out.push({ entry: e, title, count: n });
    i += n - 1;
  }
  return out;
}

/** One short line for Recent activity: what happened, with the amount when money moved. */
export function activityTitle(action: string, d: Record<string, unknown> | null, tenants: string[]): string {
  const who = tenants.join(" and ") || "the tenants";
  switch (action) {
    case "tenancy_started": return "Tenancy started";
    case "refund_method_agreed": return "Refund agreement signed";
    case "deposit_invoice_sent": return `Deposit of ${usd(d?.amount as number)} requested by PayPal`;
    case "move_out_inspected": return "Move-out photos compared";
    case "deduction_added": return `Deduction of ${usd(d?.amount as number)} added`;
    case "deduction_removed": return "Deduction removed";
    case "move_out_date_set": return "Move-out recorded";
    case "refund_proposed": return `Refund of ${usd(d?.amount as number)} waiting for approval`;
    case "refund_approved": return `Refund of ${usd(d?.amount as number)} approved`;
    case "refund_declined": return "Refund declined";
    case "refund_blocked": return "Refund stopped by the rules check";
    case "refund_sent": return `Refund of ${usd(d?.amount as number)} sent by PayPal`;
    case "refund_failed": return "PayPal did not accept the refund";
    case "photos_added": return `${String(d?.phase).startsWith("move_out") ? "Move-out" : String(d?.phase) === "after_repair" ? "After-repair" : "Move-in"} photos added, ${String(d?.room ?? "").toLowerCase() || "one room"}`;
    case "statement_delivered": {
      const m = (d as { method?: string } | null)?.method;
      return `Statement ${m === "mail" ? "mailed" : m === "email" ? "emailed" : "delivered"} to ${who}`;
    }
    case "statement_delivery_changed": return "Delivery record corrected";
    case "lease_end_set": return "Lease end updated";
    case "notice_recorded": return "Notice to move out recorded";
    case "notice_changed": return "Notice dates changed";
    case "notice_given": return `${(NOTICE_INFO[d?.kind as NoticeKind]?.short ?? "notice").replace(/^./, (c) => c.toUpperCase())} given`;
    case "notice_given_removed": return "Notice record removed";
    case "tenant_link_created": return "Tenant link created";
    case "tenant_link_revoked": return "Tenant link turned off";
    case "tenant_moving_out": return `${d?.name ?? "Tenant"} sent a move-out date`;
    case "tenant_moving_out_changed": return `${d?.name ?? "Tenant"} changed the move-out date`;
    default: {
      const s = describe(action, d);
      return s.length > 60 ? `${s.slice(0, 57).replace(/\s+\S*$/, "")}...` : s;
    }
  }
}

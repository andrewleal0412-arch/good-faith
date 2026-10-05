import "server-only";
import { longDate } from "./dates";
import { NOTICE_METHOD_LABEL, RECORD_SHORT, type NoticeKind, type NoticeMethod } from "./notices";

import { describeDelivery, type DeliveryRecord } from "./statement";

/** A notice's name as its audit entry gave it (the tenancy's pack's), else the kind's general name. */
const shortOf = (d: Record<string, unknown> | null | undefined) =>
  (typeof d?.short === "string" ? d.short : RECORD_SHORT[d?.kind as NoticeKind]) as string | undefined;

/** How the record was made, as its pack words it ("Signed", "Received", "Offered", "Recorded", "Sent"); "Given" for
 *  California's two notices and entries made before the verb was logged. */
const verbOf = (d: Record<string, unknown> | null | undefined) => (typeof d?.verb === "string" ? d.verb : "Given");

/** The full sentence for a record: "Gave the initial-inspection notice by first-class mail to Maya Torres on ...",
 *  "Received the forwarding address by email from ...", "Signed the move-in checklist electronically with ...". */
function recordSentence(d: Record<string, unknown> | null): string {
  const method = d?.method as NoticeMethod;
  const how = NOTICE_METHOD_LABEL[method] ?? method;
  const what = shortOf(d) ?? "notice";
  const on = ` on ${day(d?.date)}`;
  switch (verbOf(d)) {
    case "Received": return `Received the ${what} by ${how}${d?.to ? ` from ${d.to}` : ""}${on}`;
    case "Signed": return `Signed the ${what} ${method === "email" ? "electronically" : "in person"}${d?.to ? ` with ${d.to}` : ""}${on}`;
    case "Offered": return `Offered the ${what.replace(/ offer$/, "")} by ${how}${d?.to ? ` to ${d.to}` : ""}${on}`;
    case "Sent": return `Sent the ${what} by ${how}${d?.to ? ` to ${d.to}` : ""}${on}`;
    case "Recorded": return `Recorded the ${what}: ${how}${on}`;
    case "Acknowledged": return `Recorded the ${what}${on}`;
    default: return `Gave the ${what} by ${how}${d?.to ? ` to ${d.to}` : ""}${on}`;
  }
}

/** The short title for a record: "Initial-inspection notice given", "Forwarding address received". */
function recordTitle(d: Record<string, unknown> | null): string {
  const what = (shortOf(d) ?? "notice").replace(/^./, (c) => c.toUpperCase());
  const verb = verbOf(d);
  if (verb === "Offered") return `${what.replace(/ offer$/, "")} offered`;
  if (verb === "Recorded" || verb === "Acknowledged") return `${what} recorded`;
  return `${what} ${verb.toLowerCase()}`;
}

// The audit log in words: the full sentence the tenancy's activity list shows, and the short title the Properties
// page's Recent activity shows (Mercury's list: one title, the address under it, the date on the right).

const usd = (n: number | null | undefined) =>
  n == null ? "an amount not recorded" : `$${Number(n).toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;

/** A YYYY-MM-DD from the log spelled out, the way every other surface shows dates; anything else as it is. */
const day = (v: unknown) => (typeof v === "string" && /^\d{4}-\d{2}-\d{2}$/.test(v) ? longDate(v) : String(v ?? "a date not recorded"));

export function describe(action: string, d: Record<string, unknown> | null): string {
  switch (action) {
    case "lease_checked": {
      const v = (d?.violations as string[])?.length ?? 0, w = (d?.warnings as string[])?.length ?? 0;
      return `Checked the lease: ${v} violation${v === 1 ? "" : "s"}, ${w} warning${w === 1 ? "" : "s"}`;
    }
    case "tenancy_started": return "Started this tenancy";
    // `designated`: a state that asks for no agreement (Texas, New York, Florida), where the tenants named the account.
    case "refund_method_agreed": return d?.designated
      ? `Named in writing the PayPal account for the deposit invoice and its refund (${(d?.signed_by as string[])?.join(", ")})`
      : `Agreed in writing to a PayPal refund (${(d?.signed_by as string[])?.join(", ")})`;
    case "deposit_invoice_sent": return `Sent a PayPal deposit invoice for ${usd(d?.amount as number)}${d?.reason === "lease over the legal cap; invoiced the cap" ? `, not the ${usd(d?.charged_by_lease as number)} the lease asks for (legal cap)` : ""}`;
    case "deposit_invoice_failed": return d?.unconfirmed
      ? "PayPal didn't confirm the deposit invoice; sending it again picks up the same invoice, not a second one"
      : "PayPal rejected the deposit invoice";
    case "deposit_invoice_unsaved": return `PayPal made the deposit invoice ${d?.paypal_invoice} for ${usd(d?.amount as number)}, but it couldn't be saved here; sending it again picks up that invoice`;
    case "move_out_inspected": return `Compared move-in and move-out photos (${(d?.rooms as string[])?.join(", ")}): ${d?.damage} damage, ${d?.cleaning} cleaning, ${d?.wear_and_tear} wear and tear (not chargeable)${(d?.unclear as number) ? `, ${d?.unclear} unclear` : ""}`;
    case "finding_added": return `Added a finding by hand: ${String(d?.item).toLowerCase()} (${String(d?.classification).replace(/_/g, " ")}), ${d?.room}`;
    case "finding_reviewed": return d?.status === "accepted" ? `Accepted ${String(d?.item).toLowerCase()} as ordinary wear and tear, not charged`
      : d?.status === "dismissed" ? `Dismissed the suggested finding: ${String(d?.item).toLowerCase()}` : `Reopened the finding: ${String(d?.item).toLowerCase()}`;
    case "finding_removed": return `Removed the finding added by hand: ${String(d?.item).toLowerCase()}`;
    case "deduction_added": return `Deducted ${usd(d?.amount as number)} for ${String(d?.item).toLowerCase()}: ${d?.math}`;
    case "deduction_removed": return `Removed the ${usd(d?.amount as number)} deduction for ${String(d?.item).toLowerCase()}`;
    case "move_out_date_set": return `Tenant moved out ${day(d?.move_out_date)}; statement and refund due by ${day(d?.statement_due)}`;
    case "close_out_started": return "Started the close-out";
    case "refund_proposed": return `Asked you to approve a ${usd(d?.amount as number)} refund`;
    case "refund_approved": return `Approved the ${usd(d?.amount as number)} refund`;
    case "refund_declined": return `Declined the ${usd(d?.amount as number)} refund`;
    case "refund_blocked": return `Stopped a refund that didn't match the rules: ${d?.reason}`;
    case "refund_sent": return `Returned ${usd(d?.amount as number)} through PayPal (${d?.refund_id ? `refund ${d.refund_id}` : `payout ${d?.payout_batch_id}`}, ${String(d?.status).toLowerCase()})`;
    case "refund_failed": return d?.unconfirmed
      ? `PayPal didn't answer about the ${usd(d?.amount as number)} ${d?.payout ? "Payout" : "refund"}, so it may have gone; the same request sent again can't pay twice`
      : `PayPal didn't accept the ${usd(d?.amount as number)} ${d?.payout ? "Payout" : "refund"}`;
    case "close_out_finished": return "Finished the close-out";
    // PayPal's own reports, from its webhook (src/lib/paypal-webhook.ts).
    case "deposit_paid": return `PayPal reported the ${d?.kind === "damage_invoice" ? "balance invoice" : "deposit"} paid: ${usd(d?.amount as number)}${d?.method ? ` by ${String(d.method).toLowerCase().replace(/_/g, " ")}` : ""}${d?.capture_id ? ` (payment ${d.capture_id})` : ""}`;
    case "refund_status": return `PayPal reported the ${d?.kind === "settlement_refund" ? "settlement's refund" : "refund"} ${d?.refund_id} as ${statusWords(d?.status)}${d?.previous ? `, after ${statusWords(d.previous)}` : ""}`;
    case "payout_status": return `PayPal reported the ${d?.kind === "settlement_payout" ? "settlement's Payout" : "Payout"} ${d?.payout_batch_id} as ${statusWords(d?.status)}${d?.previous ? `, after ${statusWords(d.previous)}` : ""}`;
    case "paypal_refund_unrecorded": return `PayPal reported a ${usd(d?.amount as number)} refund of the deposit payment${d?.refund_id ? ` (refund ${d.refund_id})` : ""} that wasn't sent from here, or whose answer never came back; the close-out waits until it is checked in PayPal`;
    case "deposit_reversed": return `PayPal reversed the deposit payment${d?.capture_id ? ` ${d.capture_id}` : ""} (${usd(d?.amount as number)}), a chargeback or a bank reversal; nothing goes back through PayPal against it`;
    case "paypal_dispute": return `PayPal dispute ${d?.dispute_id} ${d?.event === "created" ? "opened" : d?.event === "resolved" ? "resolved" : "updated"} on the deposit payment${d?.reason ? `: ${String(d.reason).toLowerCase().replace(/_/g, " ")}` : ""}${d?.status ? `, ${String(d.status).toLowerCase().replace(/_/g, " ")}` : ""}${d?.outcome ? `, ${String(d.outcome).toLowerCase().replace(/_/g, " ")}` : ""}`;
    // A big selection arrives in several requests, each logged; "of N" is the whole selection.
    case "photos_added": return `Added ${d?.count}${d?.total ? ` of ${d.total}` : ""} ${String(d?.phase).replace(/_/g, " ")} photo${d?.count === 1 && !d?.total ? "" : "s"}: ${d?.room}`;
    case "statement_delivered": return `Delivered the itemized statement by ${describeDelivery(d as unknown as DeliveryRecord)}`;
    case "statement_delivery_changed": return `Corrected the delivery record: ${describeDelivery(d?.next as DeliveryRecord)}`;
    case "statement_packet_built": return `Built the statement PDF packet (${d?.pages} page${d?.pages === 1 ? "" : "s"})`;
    case "lease_end_set": return d?.end_date ? `Set the lease end to ${day(d.end_date)}` : "Set the lease to month to month";
    case "notice_recorded":
    case "notice_changed":
      return `${action === "notice_changed" ? "Changed" : "Recorded"} the notice to end the tenancy: given ${day(d?.notice_given_on)}${d?.given_by ? ` by the ${d.given_by === "tenant" ? "tenants" : "landlord"}` : ""}, planned move-out ${day(d?.planned_move_out)}${d?.inspection_window_opens === null ? "" : `; inspection window opens ${day(d?.inspection_window_opens)}`}`;
    case "notice_given": return recordSentence(d);
    case "notice_given_removed": return `Removed the record that the ${shortOf(d) ?? "notice"} was ${verbOf(d).toLowerCase()}`;
    case "tenant_link_created": return (d?.replaced as string[])?.length ? "Made a new tenant link; the old one stopped working" : "Made the tenant link";
    case "tenant_link_revoked": return "Turned the tenant link off";
    case "tenant_moving_out": return `${d?.name ?? "The tenants"} sent through the tenant link: moving out ${day(d?.planned_move_out)}; forwarding address ${d?.forwarding_address}`;
    case "tenant_moving_out_changed": return `${d?.name ?? "The tenants"} changed their move-out details through the tenant link: moving out ${day(d?.planned_move_out)}; forwarding address ${d?.forwarding_address}`;
    case "tenant_opened_statement": return "Opened the itemized statement through the tenant link";
    case "dispute_opened": return `${d?.name ?? "The tenants"} disputed ${d?.lines} deduction${d?.lines === 1 ? "" : "s"} through the tenant link and asked for ${usd(d?.amount_back as number)} back${d?.by_advocate ? ", with the case their advocate wrote" : ""}`;
    case "dispute_drafted": return "The tenants started a dispute through the tenant link";
    case "dispute_reopened": return "The tenants started a new dispute through the tenant link, after withdrawing the last one";
    case "dispute_withdrawn": return `${d?.name ?? "The tenants"} withdrew their dispute through the tenant link; the statement stands as sent`;
    case "dispute_draft_changed": return "The tenants changed their draft dispute";
    case "dispute_evidence_added": return `The tenants added ${d?.count} photo${d?.count === 1 ? "" : "s"} to their draft dispute`;
    case "dispute_evidence_removed": return "The tenants removed a photo from their draft dispute";
    case "advocate_case_written": return `The tenants' advocate wrote their case: ${usd(d?.amount_back as number)} back proposed${(d?.adjustments as number) ? `, ${d?.adjustments} answer${d?.adjustments === 1 ? "" : "s"} corrected to fit the rules` : ""}`;
    // The negotiation and the settlement (src/lib/negotiation.ts, src/lib/settlement.ts).
    case "negotiation_started": {
      const limit = (d?.policy as { limit?: number | null } | undefined)?.limit;
      return `Let the negotiator answer the tenants' dispute${limit != null ? `, asking first before giving back more than ${usd(limit)}` : ""}`;
    }
    case "negotiation_turn": return `${d?.side === "landlord" ? "The negotiator" : "The tenants' advocate"} ${MOVE_WORD[String(d?.move)] ?? "answered"}: ${usd(d?.amount_back as number)} back`;
    case "negotiation_ended": return ENDED[String(d?.reason)]?.(d) ?? "The negotiation stopped";
    case "negotiation_failed": return `The negotiation stopped partway: ${String(d?.error ?? "no reason recorded")}`;
    case "negotiation_offer": return d?.accept ? `${d?.name ?? "You"} accepted the other side's offer of ${usd(d?.amount_back as number)} back` : `${d?.name ?? "You"} offered ${usd(d?.amount_back as number)} back`;
    case "settlement_agreed": return `Settlement agreed: ${usd(d?.amount as number)} back to the tenants on top of the statement's refund`;
    case "settlement_accepted": return `${d?.name ?? "The tenants"} accepted the settlement of ${usd(d?.amount as number)} back through the tenant link`;
    case "settlement_approved": return `Approved the settlement of ${usd(d?.amount as number)}`;
    case "settlement_paid": return d?.demo_example ? `Settled the dispute: ${usd(d?.amount as number)} back to the tenants, the demo's recorded example (no PayPal money moved)`
      : Number(d?.amount) > 0
      ? `Sent the settlement of ${usd(d?.amount as number)} through PayPal (${d?.refund_id ? `refund ${d.refund_id}` : `payout ${d?.payout_batch_id}`}, ${String(d?.status).toLowerCase()})`
      : "Settled the dispute with no money moving: the deposit was used in full";
    case "settlement_failed": return `PayPal didn't accept the settlement of ${usd(d?.amount as number)}`;
    case "settlement_blocked": return `Stopped a settlement payment that didn't match the rules: ${d?.reason}`;
    case "settlement_unconfirmed": return `PayPal didn't confirm the settlement of ${usd(d?.amount as number)}, so it may have gone; checking again sends the same request`;
    case "settlement_rechecked": return `Checked the settlement of ${usd(d?.amount as number)} with PayPal, with the same request as before`;
    default: return action.replace(/_/g, " ");
  }
}

/** A PayPal status in words: "partially refunded", and a payout item PayPal holds ("ONHOLD") as "on hold". */
const statusWords = (s: unknown) => (s === "ONHOLD" ? "on hold" : String(s).toLowerCase().replace(/_/g, " "));

const MOVE_WORD: Record<string, string> = { concede: "conceded", accept: "accepted", hold: "held", counter: "countered" };
const ENDED: Record<string, (d: Record<string, unknown> | null) => string> = {
  agreed: (d) => `The agents agreed: ${usd(d?.landlord_back as number)} back`,
  no_movement: (d) => `The agents stopped without agreeing: neither side moved (last offer ${usd(d?.landlord_back as number)}, last ask ${usd(d?.tenant_back as number)})`,
  exhausted: (d) => `The agents used their three exchanges without agreeing (last offer ${usd(d?.landlord_back as number)}, last ask ${usd(d?.tenant_back as number)})`,
  limit: () => "The negotiator stopped to ask before giving back more than your limit",
  stopped: () => "The negotiation moved on before the agents finished",
};

/** Actions too small for the Properties page's Recent activity (each PDF build, each lease check before a tenancy,
 *  the tenant link's bookkeeping). */
export const QUIET_ACTIONS = ["statement_packet_built", "close_out_started", "close_out_finished", "lease_checked", "tenant_opened_statement", "refund_proposed", "refund_approved", "finding_reviewed", "tenant_link_created", "tenant_link_revoked",
  // The tenants' dispute while it is still their draft: theirs until they send it.
  "dispute_drafted", "dispute_reopened", "dispute_draft_changed", "dispute_evidence_added", "dispute_evidence_removed", "advocate_case_written",
  // The negotiation's own steps: its outcome and the settlement are what the list shows.
  "negotiation_started", "negotiation_turn", "settlement_approved", "settlement_rechecked"];

/** The same for one tenancy's own Activity, which keeps the lease check, the tenant link and the tenants opening
 *  their statement. */
const ON_RECORD = ["lease_checked", "tenant_opened_statement", "tenant_link_created", "tenant_link_revoked"];
export const QUIET_ON_RECORD = QUIET_ACTIONS.filter((a) => !ON_RECORD.includes(a));

type Entry = { tenancyId: string; action: string; detail: Record<string, unknown> | null };
const FOLDS = ["deduction_added", "photos_added", "tenant_link_created"];

/** Activity rows with a run of the same action on one unit folded into one line (three deductions in a row, photos for
 *  several rooms, a link made twice), each with its short title. */
export function foldActivity<T extends Entry>(log: T[], tenantsOf: (tenancyId: string) => string[], max: number): { entry: T; title: string; count: number }[] {
  const out: { entry: T; title: string; count: number }[] = [];
  for (let i = 0; i < log.length && out.length < max; i++) {
    const e = log[i];
    let n = 1;
    // Photo uploads fold only within one phase: move-in and move-out photos of the same rooms are two steps.
    if (FOLDS.includes(e.action)) {
      while (log[i + n] && log[i + n].action === e.action && log[i + n].tenancyId === e.tenancyId
        && (e.action !== "photos_added" || log[i + n].detail?.phase === e.detail?.phase)) n++;
    }
    const title = n > 1 && e.action === "tenant_link_created" ? "Tenant link remade"
      : n > 1 && e.action === "deduction_added" ? `${n} deductions added`
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
    case "refund_method_agreed": return d?.designated ? "Refund account designated" : "Refund agreement signed";
    case "deposit_invoice_sent": return `Deposit of ${usd(d?.amount as number)} requested by PayPal`;
    case "move_out_inspected": return "Move-out photos compared";
    case "finding_added": return "Finding added";
    case "finding_reviewed": return d?.status === "accepted" ? "Finding accepted" : d?.status === "dismissed" ? "Finding dismissed" : "Finding reopened";
    case "finding_removed": return "Finding removed";
    case "deduction_added": return `Deduction of ${usd(d?.amount as number)} added`;
    case "deduction_removed": return "Deduction removed";
    case "move_out_date_set": return "Move-out recorded";
    case "refund_proposed": return `Refund of ${usd(d?.amount as number)} waiting for approval`;
    case "refund_approved": return `Refund of ${usd(d?.amount as number)} approved`;
    case "refund_declined": return "Refund declined";
    case "refund_blocked": return "Refund stopped by the rules check";
    case "refund_sent": return `Refund of ${usd(d?.amount as number)} sent by PayPal`;
    case "refund_failed": return d?.unconfirmed ? "PayPal did not confirm the refund" : "PayPal did not accept the refund";
    case "deposit_paid": return `${d?.kind === "damage_invoice" ? "Balance" : "Deposit"} of ${usd(d?.amount as number)} paid`;
    case "deposit_invoice_failed": return d?.unconfirmed ? "PayPal did not confirm the deposit invoice" : "PayPal rejected the deposit invoice";
    case "deposit_invoice_unsaved": return "Deposit invoice not saved";
    case "refund_status": return `Refund ${statusWords(d?.status)} in PayPal`;
    case "payout_status": return `Payout ${statusWords(d?.status)} in PayPal`;
    case "paypal_refund_unrecorded": return "Refund made outside Good Faith";
    case "deposit_reversed": return "Deposit payment reversed";
    case "paypal_dispute": return d?.event === "created" ? "PayPal dispute opened" : d?.event === "resolved" ? "PayPal dispute resolved" : "PayPal dispute updated";
    case "photos_added": return `${String(d?.phase).startsWith("move_out") ? "Move-out" : String(d?.phase) === "after_repair" ? "After-repair" : "Move-in"} photos added, ${String(d?.room ?? "").toLowerCase() || "one room"}`;
    case "statement_delivered": {
      const m = (d as { method?: string } | null)?.method;
      return `Statement ${m === "mail" ? "mailed" : m === "email" ? "emailed" : "delivered"} to ${who}`;
    }
    case "statement_delivery_changed": return "Delivery record corrected";
    case "lease_end_set": return "Lease end updated";
    case "notice_recorded": return "Notice to move out recorded";
    case "notice_changed": return "Notice dates changed";
    case "notice_given": return recordTitle(d);
    case "notice_given_removed": return "Notice record removed";
    case "tenant_link_created": return "Tenant link created";
    case "tenant_link_revoked": return "Tenant link turned off";
    case "tenant_moving_out": return `${d?.name ?? "Tenant"} sent a move-out date`;
    case "tenant_moving_out_changed": return `${d?.name ?? "Tenant"} changed the move-out date`;
    case "dispute_opened": return `${d?.name ?? "Tenant"} disputed ${d?.lines} deduction${d?.lines === 1 ? "" : "s"}`;
    case "dispute_withdrawn": return `${d?.name ?? "Tenant"} withdrew the dispute`;
    case "negotiation_turn": return d?.side === "landlord" ? "Negotiator answered" : "Tenants' advocate answered";
    case "negotiation_ended": return d?.reason === "agreed" ? "Agents agreed" : d?.reason === "limit" ? "Negotiator asks for your OK" : d?.reason === "no_movement" || d?.reason === "exhausted" ? "No agreement" : "Negotiation stopped";
    case "negotiation_offer": return d?.accept ? "Offer accepted" : `Offer of ${usd(d?.amount_back as number)} made`;
    case "settlement_agreed": return `Settlement of ${usd(d?.amount as number)} agreed`;
    case "settlement_accepted": return `${d?.name ?? "Tenant"} accepted the settlement`;
    case "settlement_paid": return d?.demo_example ? `Settlement of ${usd(d?.amount as number)} recorded` : Number(d?.amount) > 0 ? `Settlement of ${usd(d?.amount as number)} sent by PayPal` : "Dispute settled";
    case "settlement_failed": return "PayPal did not accept the settlement";
    case "settlement_blocked": return "Settlement payment on hold";
    case "settlement_unconfirmed": return "PayPal did not confirm the settlement";
    case "settlement_rechecked": return "Settlement checked with PayPal";
    default: {
      const s = describe(action, d);
      return s.length > 60 ? `${s.slice(0, 57).replace(/\s+\S*$/, "")}...` : s;
    }
  }
}

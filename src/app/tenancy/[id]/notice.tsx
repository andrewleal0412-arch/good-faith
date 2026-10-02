"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { longDate, shortDate } from "@/lib/dates";
import { statementDue } from "@/lib/deductions";
import type { EventKind } from "@/lib/ics";
import { inspectionWindowOpens, NOTICE_INFO, NOTICE_SLUG, type NoticeKind, type Notices, type RefundNoticeStatus } from "@/lib/notices";
import { describeTenantMoveOut, tenantMoveOutSentOn, type TenantMoveOut } from "@/lib/tenant";
import { NoticeGivenForm } from "./notice-given-form";

const input = "rounded-xl border border-line bg-bg px-3 py-1.5 text-[14px] outline-none focus:border-accent";

export type EventView = { kind: EventKind; date: string; label: string };

// Lease end and notice: the dates the rest of the move-out hangs on. Setting them once drafts the two written notices
// (Civ. Code 1950.5(f)(1) and (h)(1)(A)(ii)(II)) and puts every later date in the landlord's calendar.
export function NoticeSection(p: {
  tenancyId: string;
  today: string;
  tenants: string[];
  endDate: string | null;
  noticeGivenOn: string | null;
  plannedMoveOut: string | null;
  moveOutDate: string | null;
  notices: Notices;
  refundNotice: RefundNoticeStatus;
  events: EventView[];
  closed: boolean; // closed out: the statement went out and nothing is left to return
  tenantMoveOut: TenantMoveOut | null; // what the tenants sent through their link, if anything
}) {
  const router = useRouter();
  const [end, setEnd] = useState(p.endDate ?? "");
  const [editing, setEditing] = useState(false);
  // Until a notice is recorded, the form starts from what the tenants sent through their link: the day they sent it
  // and the move-out date they named. The landlord still records it.
  const [given, setGiven] = useState(p.noticeGivenOn ?? (p.tenantMoveOut ? tenantMoveOutSentOn(p.tenantMoveOut) : p.today));
  const [planned, setPlanned] = useState(p.plannedMoveOut ?? p.tenantMoveOut?.planned_move_out ?? p.endDate ?? "");
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState("");

  async function call(name: string, url: string, init: RequestInit) {
    setBusy(name);
    setError("");
    const r = await fetch(url, init);
    const j = await r.json().catch(() => ({}));
    setBusy(null);
    if (!r.ok) return setError(j.error ?? "Something went wrong.");
    setEditing(false);
    router.refresh();
  }
  const saveEnd = (endDate: string | null) => call("end", `/api/tenancies/${p.tenancyId}`, {
    method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ endDate }),
  });
  const saveNotice = () => call("notice", `/api/tenancies/${p.tenancyId}/notice`, {
    method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ noticeGivenOn: given, plannedMoveOut: planned }),
  });

  const ends = p.plannedMoveOut ?? p.endDate;
  const windowOpens = ends ? inspectionWindowOpens(ends) : null;
  const showForm = !p.noticeGivenOn || editing;

  return (
    <section className="mt-10">
      <h2 className="text-[22px] font-semibold tracking-[-0.01em]">Lease end and notice</h2>
      <p className="mt-1 text-[14px] text-ink-2">
        Set the lease end once and record the day either side gives notice. The notices the law asks for, and every date after them,
        follow from that. Add them to your calendar so nothing waits on memory.
      </p>
      {error && <p className="mt-3 rounded-xl bg-danger-soft px-4 py-3 text-[14px] text-danger">{error}</p>}

      <div className="mt-4 rounded-2xl bg-surface p-5 shadow-sm">
        {/* The lease end drives the 60-day check-in; without one the tenancy is treated as month to month. */}
        <div className="flex flex-wrap items-center gap-2">
          <span className="text-[14px] text-ink-2">Lease ends</span>
          <input type="date" value={end} onChange={(e) => setEnd(e.target.value)} className={input} aria-label="Lease end date" />
          {end && end !== (p.endDate ?? "") && (
            <button onClick={() => saveEnd(end)} disabled={busy === "end"} className="rounded-xl bg-ink px-3 py-1.5 text-[13px] font-semibold text-white disabled:opacity-40">
              {busy === "end" ? "Saving..." : "Save"}
            </button>
          )}
          {p.endDate ? (
            <button onClick={() => { setEnd(""); saveEnd(null); }} disabled={busy === "end"} className="text-[13px] text-ink-3 underline underline-offset-2 hover:text-ink disabled:opacity-40">
              Month to month instead
            </button>
          ) : (
            <span className="text-[13px] text-ink-3">Not set: treated as month to month.</span>
          )}
        </div>

        {/* The notice: who gave it is not recorded, since (f)(1) and (h)(1)(A)(ii)(II) run from "either party's" notice. */}
        <div className="mt-4 border-t border-line pt-4">
          {p.tenantMoveOut && (
            <div className="mb-4 rounded-xl bg-info-soft px-4 py-3 text-[13px] leading-relaxed text-ink-2">
              <b className="text-ink">From the tenant link.</b> {describeTenantMoveOut(p.tenantMoveOut)}. Forwarding address for the statement:{" "}
              <b className="text-ink">{p.tenantMoveOut.forwarding_address}</b>.
              {showForm && !p.moveOutDate && " The form below is filled in from it."}
            </div>
          )}
          {showForm ? (
            <div>
              <p className="text-[14px] font-semibold">Tenant gave notice</p>
              <p className="mt-1 text-[13px] text-ink-2">The date the notice was given, and the move-out date it names.</p>
              <div className="mt-3 flex flex-wrap items-end gap-3">
                <label className="block">
                  <span className="mb-1.5 block text-[12px] font-semibold uppercase tracking-[0.08em] text-ink-3">Notice given on</span>
                  <input type="date" className={input} value={given} max={p.today} onChange={(e) => setGiven(e.target.value)} />
                </label>
                <label className="block">
                  <span className="mb-1.5 block text-[12px] font-semibold uppercase tracking-[0.08em] text-ink-3">Planned move-out</span>
                  <input type="date" className={input} value={planned} min={given} onChange={(e) => setPlanned(e.target.value)} />
                </label>
                <button onClick={saveNotice} disabled={busy === "notice" || !given || !planned || !!p.moveOutDate}
                  className="rounded-xl bg-accent px-4 py-2 text-[14px] font-semibold text-white disabled:opacity-40">
                  {busy === "notice" ? "Saving..." : "Record the notice"}
                </button>
                {editing && <button onClick={() => setEditing(false)} className="rounded-xl px-3 py-2 text-[14px] text-ink-2">Cancel</button>}
              </div>
              {p.moveOutDate && <p className="mt-2 text-[12px] text-ink-3">The move-out date is already set below, so the notice stage is past.</p>}
            </div>
          ) : (
            <p className="text-[14px] leading-relaxed text-ink-2">
              Notice given <b className="text-ink">{longDate(p.noticeGivenOn!)}</b>; planned move-out <b className="text-ink">{longDate(p.plannedMoveOut!)}</b>.
              {windowOpens && <> The inspection window opens {longDate(windowOpens)} (two weeks before, Civ. Code 1950.5(f)(1)).</>}
              {p.plannedMoveOut && !p.moveOutDate && p.plannedMoveOut >= p.today && <> If they leave as planned, the statement and refund are due {longDate(statementDue(p.plannedMoveOut))} (21 days, (h)(1)).</>}
              {p.plannedMoveOut && !p.moveOutDate && p.plannedMoveOut < p.today && <> The planned move-out has passed. Once possession is returned, record the actual move-out date below; the 21-day clock runs from that day ((h)(1)).</>}
              {!p.moveOutDate && (
                <> <button onClick={() => setEditing(true)} className="text-ink-3 underline underline-offset-2 hover:text-ink">Change</button></>
              )}
            </p>
          )}
        </div>

        {p.noticeGivenOn && (
          <ul className="mt-4 space-y-3 border-t border-line pt-4">
            <NoticeRow kind="inspection" tenancyId={p.tenancyId} tenants={p.tenants} today={p.today} notices={p.notices}
              note="In writing, within a reasonable time after the notice: the tenants' option to request an initial inspection and to be present. The draft carries the paragraph the statute requires." />
            <NoticeRow kind="electronic_refund" tenancyId={p.tenancyId} tenants={p.tenants} today={p.today} notices={p.notices}
              status={p.refundNotice} />
          </ul>
        )}

        <div className="mt-4 flex flex-col gap-3 border-t border-line pt-4 sm:flex-row sm:items-start">
          {p.events.length ? (
            <>
              <a href={`/api/tenancies/${p.tenancyId}/calendar`} className="shrink-0 rounded-xl bg-ink px-4 py-2 text-[14px] font-semibold text-white hover:opacity-90">
                Add to calendar
              </a>
              <div className="min-w-0 text-[13px] text-ink-2">
                <p>An .ics file for Apple, Google or Outlook, all-day events with a morning reminder:</p>
                <ul className="mt-1 space-y-0.5">
                  {p.events.map((e) => (
                    <li key={e.kind} className="flex gap-3">
                      <span className="w-[96px] shrink-0 tabular-nums text-ink-3">{shortDate(e.date)}</span>
                      <span>{e.label}</span>
                    </li>
                  ))}
                </ul>
              </div>
            </>
          ) : p.closed ? (
            <p className="text-[13px] text-ink-3">Closed out: the statement went out and nothing is left to return, so there are no dates left to add to a calendar.</p>
          ) : (
            <p className="text-[13px] text-ink-3">
              Set the lease end or record a notice and four dates appear here to add to your calendar: the 60-day check-in, the day the
              inspection window opens, the move-out, and the 21-day statement and refund deadline.
            </p>
          )}
        </div>
      </div>
    </section>
  );
}

function NoticeRow(p: { kind: NoticeKind; tenancyId: string; tenants: string[]; today: string; notices: Notices; status?: RefundNoticeStatus; note?: string }) {
  const info = NOTICE_INFO[p.kind];
  const given = p.notices[p.kind] ?? null;
  const covered = p.status?.needed === false;
  const dot = given ? "bg-accent" : covered ? "bg-ink-3" : "bg-warn";
  return (
    <li className="rounded-xl bg-bg px-4 py-3">
      <div className="flex flex-wrap items-center gap-2">
        <span className={`h-2 w-2 shrink-0 rounded-full ${dot}`} />
        <p className="text-[14px] font-semibold">{info.short.charAt(0).toUpperCase() + info.short.slice(1)}</p>
        <span className="text-[12px] text-ink-3">{info.cite}</span>
        <Link href={`/tenancy/${p.tenancyId}/notices/${NOTICE_SLUG[p.kind]}`} className="ml-auto text-[13px] font-semibold text-info underline underline-offset-2">
          {given ? "Open the notice" : covered ? "Open the draft anyway" : "Open the draft"}
        </Link>
      </div>
      {!given && (
        <p className="mt-1.5 text-[13px] leading-relaxed text-ink-2">
          {p.status ? <>{p.status.needed === false ? <b className="text-ink">Not needed. </b> : p.status.needed === null ? <b className="text-ink">Check: </b> : null}{p.status.reason}</> : p.note}
        </p>
      )}
      <div className="mt-2">
        <NoticeGivenForm tenancyId={p.tenancyId} kind={p.kind} tenants={p.tenants} today={p.today} given={given} />
      </div>
    </li>
  );
}

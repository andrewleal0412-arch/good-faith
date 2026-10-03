"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { longDate, shortDate } from "@/lib/dates";
import { statementDue } from "@/lib/deductions";
import type { EventKind } from "@/lib/ics";
import { inspectionWindowOpens, NOTICE_INFO, NOTICE_SLUG, type NoticeKind, type Notices, type RefundNoticeStatus } from "@/lib/notices";
import { describeTenantMoveOut, tenantMoveOutSentOn, type TenantMoveOut } from "@/lib/tenant";
import { Button, ButtonLink } from "@/components/button";
import { Icon } from "@/components/icons";
import { InfoTip } from "@/components/info-tip";
import { Card, CardHead, KV, Notice, inlineInputClass } from "@/components/ui";
import { MoveOutDate } from "./move-out-date";
import { NoticeGivenForm } from "./notice-given-form";

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
  moveOutLocked: boolean; // the deposit has gone back, so the move-out date is part of the record
  notices: Notices;
  refundNotice: RefundNoticeStatus;
  events: EventView[];
  closed: boolean; // closed out: the statement went out and nothing is left to return
  tenantMoveOut: TenantMoveOut | null; // what the tenants sent through their link, if anything
  quiet?: boolean; // the record header holds the view's primary button, so Record notice shows as secondary
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
  // The citation for the card as a whole sits beside the line it explains (the notice form, or "Not recorded"), not as
  // a lone icon in the card head; once a notice is given, each notice row carries its own.
  const why = (
    <InfoTip title="The dates the move-out hangs on" cite="Civ. Code 1950.5(f)(1), (h)(1)(A)(ii)(II)">
      Set the lease end once and record the day either side gives notice. The two written notices the law asks for, and every
      date after them, follow from that.
    </InfoTip>
  );

  // Once the tenants have moved out the notice stage is over: the dates read as facts, with no form to fill in. The two
  // notice rows stay, since whether each notice was given is still part of the record.
  if (p.moveOutDate || p.closed) {
    return (
      <Card>
        <CardHead title="Notice and dates" />
        <div className="flex flex-col divide-y divide-line-2">
          <KV className="px-5 py-3.5" rows={[
            ["Lease ends", p.endDate ? longDate(p.endDate) : "Month to month"],
            ["Notice", p.noticeGivenOn ? `Given ${longDate(p.noticeGivenOn)}${p.plannedMoveOut ? `, move-out planned ${longDate(p.plannedMoveOut)}` : ""}`
              : <span key="n" className="inline-flex items-center gap-1.5">Not recorded{why}</span>],
            ["Moved out", <MoveOutDate key="m" tenancyId={p.tenancyId} value={p.moveOutDate} locked={p.moveOutLocked || p.closed} />],
          ]} />
          {p.noticeGivenOn && (
            <ul className="flex flex-col divide-y divide-line-2">
              <NoticeRow kind="inspection" tenancyId={p.tenancyId} tenants={p.tenants} today={p.today} notices={p.notices}
                note="In writing, within a reasonable time after the notice: the tenants' option to request an initial inspection and to be present. The draft carries the paragraph the statute requires." />
              <NoticeRow kind="electronic_refund" tenancyId={p.tenancyId} tenants={p.tenants} today={p.today} notices={p.notices}
                status={p.refundNotice} />
            </ul>
          )}
          {!p.closed && p.events.length > 0 && (
            <div className="flex flex-col gap-3 px-5 py-3.5 sm:flex-row sm:items-start">
              <ul className="flex min-w-0 flex-1 flex-col gap-1 text-sm">
                {p.events.map((e) => (
                  <li key={e.kind} className="flex gap-3">
                    <span className="w-[120px] shrink-0 tabular-nums text-ink-3">{shortDate(e.date)}</span>
                    <span>{e.label}</span>
                  </li>
                ))}
              </ul>
              <ButtonLink plain href={`/api/tenancies/${p.tenancyId}/calendar`}><Icon name="calendar" />Add to calendar</ButtonLink>
            </div>
          )}
        </div>
      </Card>
    );
  }

  return (
    <Card>
      <CardHead title="Notice and dates" />
      <div className="flex flex-col divide-y divide-line-2">
        {error && <div className="px-5 py-3"><Notice>{error}</Notice></div>}

        {/* The lease end drives the 60-day check-in; without one the tenancy is treated as month to month. */}
        <div className="flex flex-wrap items-center gap-2 px-5 py-3.5 text-sm">
          <span className="w-[120px] text-ink-3">Lease ends</span>
          <input type="date" value={end} onChange={(e) => setEnd(e.target.value)} className={`${inlineInputClass} h-8`} aria-label="Lease end date" />
          {end && end !== (p.endDate ?? "") && (
            <Button size="sm" variant="primary" onClick={() => saveEnd(end)} disabled={busy === "end"}>{busy === "end" ? "Saving..." : "Save"}</Button>
          )}
          {p.endDate ? (
            <Button variant="link" onClick={() => { setEnd(""); saveEnd(null); }} disabled={busy === "end"}>Month to month instead</Button>
          ) : (
            <span className="text-ink-3">Not set, month to month</span>
          )}
        </div>

        {/* The notice: who gave it is not recorded, since (f)(1) and (h)(1)(A)(ii)(II) run from "either party's" notice. */}
        <div className="px-5 py-3.5">
          {p.tenantMoveOut && (
            <div className="mb-3.5 flex items-start gap-2.5 rounded-md bg-surface px-3.5 py-2.5 text-sm">
              <Icon name="mail" className="mt-0.5 size-[15px] text-ink-3" />
              <div className="min-w-0">
                <div className="font-medium">From the tenant link</div>
                <div className="text-xs text-ink-3">{describeTenantMoveOut(p.tenantMoveOut)}. Forwarding address: {p.tenantMoveOut.forwarding_address}</div>
              </div>
            </div>
          )}
          {showForm ? (
            <div>
              <p className="flex items-center gap-1.5 text-sm font-medium">Tenant gave notice{!p.noticeGivenOn && why}</p>
              <div className="mt-2.5 flex flex-wrap items-end gap-3">
                <label className="block">
                  <span className="mb-1.5 block text-xs text-ink-3">Notice given on</span>
                  <input type="date" className={inlineInputClass} value={given} max={p.today} onChange={(e) => setGiven(e.target.value)} />
                </label>
                <label className="block">
                  <span className="mb-1.5 block text-xs text-ink-3">Planned move-out</span>
                  <input type="date" className={inlineInputClass} value={planned} min={given} onChange={(e) => setPlanned(e.target.value)} />
                </label>
                <Button variant={p.quiet ? "secondary" : "primary"} onClick={saveNotice} disabled={busy === "notice" || !given || !planned}>
                  {busy === "notice" ? "Saving..." : "Record notice"}
                </Button>
                {editing && <Button onClick={() => setEditing(false)}>Cancel</Button>}
              </div>
            </div>
          ) : (
            <div className="flex flex-wrap items-center gap-x-2 gap-y-1 text-sm">
              <span className="w-[120px] text-ink-3">Notice given</span>
              <span>{longDate(p.noticeGivenOn!)}<span className="text-ink-3">, move-out {longDate(p.plannedMoveOut!)}</span></span>
              {(windowOpens || p.plannedMoveOut) && (
                <InfoTip title="What follows from the notice" cite="Civ. Code 1950.5(f)(1), (h)(1)">
                  {windowOpens && <>The inspection window opens {longDate(windowOpens)}, two weeks before the move-out. </>}
                  {p.plannedMoveOut && !p.moveOutDate && p.plannedMoveOut >= p.today && <>If they leave as planned, the statement and refund are due {longDate(statementDue(p.plannedMoveOut))}, 21 days later.</>}
                  {p.plannedMoveOut && !p.moveOutDate && p.plannedMoveOut < p.today && <>The planned move-out has passed. Record the actual move-out date once possession is returned; the 21-day clock runs from that day.</>}
                </InfoTip>
              )}
              <Button variant="link" className="ml-1" onClick={() => setEditing(true)}>Change</Button>
            </div>
          )}
        </div>

        {p.noticeGivenOn && (
          <ul className="flex flex-col divide-y divide-line-2">
            <NoticeRow kind="inspection" tenancyId={p.tenancyId} tenants={p.tenants} today={p.today} notices={p.notices}
              note="In writing, within a reasonable time after the notice: the tenants' option to request an initial inspection and to be present. The draft carries the paragraph the statute requires." />
            <NoticeRow kind="electronic_refund" tenancyId={p.tenancyId} tenants={p.tenants} today={p.today} notices={p.notices}
              status={p.refundNotice} />
          </ul>
        )}

        <div className="px-5 py-3.5">
          {p.events.length ? (
            <div className="flex flex-col gap-3 sm:flex-row sm:items-start">
              <ul className="flex min-w-0 flex-1 flex-col gap-1 text-sm">
                {p.events.map((e) => (
                  <li key={e.kind} className="flex gap-3">
                    <span className="w-[120px] shrink-0 tabular-nums text-ink-3">{shortDate(e.date)}</span>
                    <span>{e.label}</span>
                  </li>
                ))}
              </ul>
              <ButtonLink plain href={`/api/tenancies/${p.tenancyId}/calendar`}><Icon name="calendar" />Add to calendar</ButtonLink>
            </div>
          ) : (
            <p className="flex items-center gap-1.5 text-sm text-ink-3">
              Set the lease end or record a notice to get the dates
              <InfoTip title="Four dates">The 60-day check-in, the day the inspection window opens, the move-out, and the 21-day statement and refund deadline, as an .ics file for Apple, Google or Outlook.</InfoTip>
            </p>
          )}
        </div>
      </div>
    </Card>
  );
}

function NoticeRow(p: { kind: NoticeKind; tenancyId: string; tenants: string[]; today: string; notices: Notices; status?: RefundNoticeStatus; note?: string }) {
  const info = NOTICE_INFO[p.kind];
  const given = p.notices[p.kind] ?? null;
  const covered = p.status?.needed === false;
  return (
    <li className="px-5 py-3.5">
      <div className="flex flex-wrap items-center gap-2">
        <span className={`size-2 shrink-0 rounded-full ${given ? "bg-green-dot" : covered ? "bg-ink-4" : "bg-amber-dot"}`} />
        <p className="text-sm font-medium">{info.short.charAt(0).toUpperCase() + info.short.slice(1)}</p>
        <InfoTip title={info.title} cite={info.cite}>
          {p.status ? <>{p.status.needed === false ? "Not needed. " : p.status.needed === null ? "Check: " : null}{p.status.reason}</> : p.note}
        </InfoTip>
        {!given && covered && <span className="text-xs text-ink-3">Not needed</span>}
        <Link href={`/tenancy/${p.tenancyId}/notices/${NOTICE_SLUG[p.kind]}`} className="ml-auto text-sm font-medium text-brand hover:underline">
          {given ? "Open notice" : "Open draft"}
        </Link>
      </div>
      <div className="mt-2 pl-4">
        <NoticeGivenForm tenancyId={p.tenancyId} kind={p.kind} tenants={p.tenants} today={p.today} given={given} />
      </div>
    </li>
  );
}

"use client";

import Link from "@/components/link";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { daysBetween, shortDate } from "@/lib/dates";
import type { EventKind } from "@/lib/ics";
import { inspectionWindowOpens, listedRecords, noticeKindsFor, NOTICE_SLUG, recordFor, type NoticeKind, type Notices, type RefundNoticeStatus } from "@/lib/notices";
import { packFor } from "@/lib/states";
import { describeTenantMoveOut, tenantMoveOutSentOn, type TenantMoveOut } from "@/lib/tenant";
import { Button, ButtonLink } from "@/components/button";
import { Icon } from "@/components/icons";
import { InfoTip } from "@/components/info-tip";
import { Card, CardHead, KV, LineMark, Notice, inlineInputClass } from "@/components/ui";
import { MoveOutDate } from "./move-out-date";
import { NoticeGivenForm } from "./notice-given-form";

export type EventView = { kind: EventKind; date: string; label: string };

// Lease end and notice: the dates the rest of the move-out hangs on. Setting them once drafts the written notices the
// state's pack names (California: Civ. Code 1950.5(f)(1) and (h)(1)(A)(ii)(II)) and puts every later date in the
// landlord's calendar.
export function NoticeSection(p: {
  tenancyId: string;
  state: string;
  today: string;
  tenants: string[];
  endDate: string | null;
  noticeGivenOn: string | null;
  noticeGivenBy: "tenant" | "landlord" | null;
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
  const [given, setGiven] = useState(p.noticeGivenOn ?? (p.tenantMoveOut ? tenantMoveOutSentOn(p.tenantMoveOut, packFor(p.state).timeZone.id) : p.today));
  const [planned, setPlanned] = useState(p.plannedMoveOut ?? p.tenantMoveOut?.planned_move_out ?? p.endDate ?? "");
  // Who gave it, where the state's rule turns on it (New York); a notice sent through the tenant link is the tenants'.
  const [by, setBy] = useState<"" | "tenant" | "landlord">(p.noticeGivenBy ?? (p.tenantMoveOut ? "tenant" : ""));
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
    method: "POST", headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ noticeGivenOn: given, plannedMoveOut: planned, ...(askWho ? { givenBy: by || null } : {}) }),
  });

  const pack = packFor(p.state);
  const askWho = !!pack.notices.inspection?.skipIfShortNotice;
  const kinds = noticeKindsFor(pack);
  const ends = p.plannedMoveOut ?? p.endDate;
  // New York: the tenants ended the tenancy with less than two weeks' notice, so the rights notice is not owed (the same
  // test as inspectionExcused in next-step.ts, which this client module can't import).
  const skip = pack.notices.inspection?.skipIfShortNotice;
  const excused = !!skip && !!p.noticeGivenOn && p.noticeGivenBy === "tenant" && !!ends && daysBetween(p.noticeGivenOn, ends) < skip;
  const windowOpens = ends ? inspectionWindowOpens(ends, pack) : null;
  const showForm = !p.noticeGivenOn || editing;
  // The citation for the card as a whole sits beside the line it explains (the notice form, or "Not recorded"), not as
  // a lone icon in the card head; once a notice is given, each notice row carries its own.
  const why = (
    <InfoTip title={pack.notices.sectionTip.title} cite={pack.notices.sectionTip.cite}>{pack.notices.sectionTip.text}</InfoTip>
  );
  // The state's records once the tenancy is ending: a Texas forwarding address in writing, a Florida claim notice and
  // the tenants' objection to it. California has none, so its rows are its two notices only.
  const ending = !!(p.noticeGivenOn || p.moveOutDate);
  const rows = [
    ...(p.noticeGivenOn ? kinds : []).map((k) => (
      <NoticeRow key={k} kind={k} state={pack.code} tenancyId={p.tenancyId} tenants={p.tenants} today={p.today} notices={p.notices}
        {...(k === "electronic_refund" ? { status: p.refundNotice }
          : excused ? { status: { needed: false, reason: `The tenants gave notice on ${shortDate(p.noticeGivenOn!)} to end the tenancy ${shortDate(ends!)}, less than two weeks ahead, so this notice is not owed.` } }
            : { note: pack.notices.inspectionNote })} />
    )),
    ...(ending ? listedRecords(pack, "move_out", p.notices).map((r) => (
      <NoticeRow key={r.kind} kind={r.kind} state={pack.code} tenancyId={p.tenancyId} tenants={p.tenants} today={p.today} notices={p.notices} note={r.tip} />
    )) : []),
  ];

  // Once the tenants have moved out the notice stage is over: the dates read as facts, with no form to fill in. The two
  // notice rows stay, since whether each notice was given is still part of the record.
  if (p.moveOutDate || p.closed) {
    return (
      <Card>
        <CardHead title="Notice and dates" />
        <div className="flex flex-col divide-y divide-line-2">
          <KV className="px-5 py-3.5" rows={[
            ["Lease ends", p.endDate ? shortDate(p.endDate) : "Month to month"],
            ["Notice", p.noticeGivenOn ? `Given ${shortDate(p.noticeGivenOn)}${p.plannedMoveOut ? `, move-out planned ${shortDate(p.plannedMoveOut)}` : ""}`
              : <span key="n" className="inline-flex items-center gap-1.5">Not recorded{why}</span>],
            ["Moved out", <MoveOutDate key="m" tenancyId={p.tenancyId} value={p.moveOutDate} locked={p.moveOutLocked || p.closed} />],
          ]} />
          {rows.length > 0 && (
            <ul className="flex flex-col divide-y divide-line-2">{rows}</ul>
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

        {/* The notice. California's (f)(1) and (h)(1)(A)(ii)(II) run from either party's notice, so who gave it is not
            asked there; New York's 7-108(1-a)(d) excuses the rights notice only after a tenant's short notice, so it is. */}
        <div className="px-5 py-3.5">
          {p.tenantMoveOut && (
            <div className="mb-3.5 flex items-start gap-2.5 rounded-md bg-surface px-3.5 py-2.5 text-sm">
              <LineMark><Icon name="mail" className="size-[15px] text-ink-3" /></LineMark>
              <div className="min-w-0">
                <div className="font-medium">From the tenant link</div>
                <div className="text-xs text-ink-3">{describeTenantMoveOut(p.tenantMoveOut, pack.timeZone.id)}. Forwarding address: {p.tenantMoveOut.forwarding_address}</div>
              </div>
            </div>
          )}
          {showForm ? (
            <div>
              <p className="flex items-center gap-1.5 text-sm font-medium">{askWho ? "Notice to end the tenancy" : "Tenant gave notice"}{!p.noticeGivenOn && why}</p>
              <div className="mt-2.5 flex flex-wrap items-end gap-3">
                <label className="block">
                  <span className="mb-1.5 block text-xs text-ink-3">Notice given on</span>
                  <input type="date" className={inlineInputClass} value={given} max={p.today} onChange={(e) => setGiven(e.target.value)} />
                </label>
                <label className="block">
                  <span className="mb-1.5 block text-xs text-ink-3">Planned move-out</span>
                  <input type="date" className={inlineInputClass} value={planned} min={given} onChange={(e) => setPlanned(e.target.value)} />
                </label>
                {askWho && (
                  <label className="block">
                    <span className="mb-1.5 block text-xs text-ink-3">Given by</span>
                    <select value={by} onChange={(e) => setBy(e.target.value as typeof by)} className={`${inlineInputClass} h-9 pr-8`}>
                      <option value="">Not recorded</option>
                      <option value="tenant">The tenants</option>
                      <option value="landlord">The landlord</option>
                    </select>
                  </label>
                )}
                <Button variant={p.quiet ? "secondary" : "primary"} onClick={saveNotice} disabled={busy === "notice" || !given || !planned}>
                  {busy === "notice" ? "Saving..." : "Record notice"}
                </Button>
                {editing && <Button onClick={() => setEditing(false)}>Cancel</Button>}
              </div>
            </div>
          ) : (
            <div className="flex flex-wrap items-center gap-x-2 gap-y-1 text-sm">
              <span className="w-[120px] text-ink-3">Notice given</span>
              <span>{shortDate(p.noticeGivenOn!)}<span className="text-ink-3">, move-out {shortDate(p.plannedMoveOut!)}{askWho && p.noticeGivenBy ? `, by the ${p.noticeGivenBy === "tenant" ? "tenants" : "landlord"}` : ""}</span></span>
              {(windowOpens || p.plannedMoveOut) && (
                <InfoTip title="What follows from the notice" cite={pack.notices.followCite}>
                  {pack.notices.followTip(windowOpens,
                    p.plannedMoveOut && !p.moveOutDate && p.plannedMoveOut >= p.today
                      ? pack.deadline.due({ moveOutDate: p.plannedMoveOut, endDate: p.endDate, plannedMoveOut: p.plannedMoveOut }) : null,
                    !!p.plannedMoveOut && !p.moveOutDate && p.plannedMoveOut < p.today)}
                </InfoTip>
              )}
              <Button variant="link" className="ml-1" onClick={() => setEditing(true)}>Change</Button>
            </div>
          )}
        </div>

        {rows.length > 0 && (
          <ul className="flex flex-col divide-y divide-line-2">{rows}</ul>
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
              <InfoTip title={pack.notices.inspection ? "Four dates" : "Three dates"}>{pack.notices.datesTip}</InfoTip>
            </p>
          )}
        </div>
      </div>
    </Card>
  );
}

function NoticeRow(p: { kind: NoticeKind; state: string; tenancyId: string; tenants: string[]; today: string; notices: Notices; status?: RefundNoticeStatus; note?: string }) {
  const info = recordFor(packFor(p.state), p.kind)!;
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
          {!info.draft ? "Details" : given ? "Open notice" : "Open draft"}
        </Link>
      </div>
      <div className="mt-2 pl-4">
        <NoticeGivenForm tenancyId={p.tenancyId} state={p.state} kind={p.kind} tenants={p.tenants} today={p.today} given={given} />
      </div>
    </li>
  );
}

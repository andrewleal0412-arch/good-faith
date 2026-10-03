"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { Button, buttonClass } from "@/components/button";
import { Icon } from "@/components/icons";
import { FormField } from "@/components/field";
import { InfoTip } from "@/components/info-tip";
import { Money, Notice, StatusChip, inputClass, inlineInputClass } from "@/components/ui";
import { shortDate } from "@/lib/dates";
import { wasPaid } from "@/lib/invoice-status";
import { NOTICE_SLUG, recordsFor, type Notices } from "@/lib/notices";
import { packFor } from "@/lib/states";
import type { LawfulDeposit, RecordDef } from "@/lib/states/types";
import { uploadPhotos } from "@/lib/uploads";
import { NoticeGivenForm } from "./notice-given-form";

type Props = {
  tenancyId: string;
  state: string; // the state whose pack the steps follow
  notices: Notices; // the state's move-in records, kept with the notices
  tenants: string[];
  flagCounts: { violations: number; warnings: number };
  agreement: { paypal_email: string; signed_by: string[]; signed_at: string } | null;
  lawful: LawfulDeposit | null;
  invoice: { id: string; amount: number; status: string; payLink: string | null } | null;
  photos: { id: string; phase: string; room: string; url: string | null }[];
  quiet?: boolean; // the record header holds the view's primary button, so the steps' buttons are secondary
  locked?: boolean; // the tenants have moved out: the move-in record is what it was, so no more photos are added
};

/** Today in California, where the app keeps its calendar (as src/lib/dates.ts pacificToday). */
const todayIso = () => new Date().toLocaleDateString("en-CA", { timeZone: "America/Los_Angeles" });

const usd = (n: number) => `$${n.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
const ROOMS = ["Living room", "Kitchen", "Bedroom 1", "Bedroom 2", "Bathroom", "Hallway"];

// Move-in on one timeline: the lease check, the tenants' written refund agreement (California's AB 414; elsewhere the
// account the refund goes to), the lawful deposit through a PayPal invoice, and the move-in photos (California's
// AB 2801), with the state's own records where its pack puts them (a Washington checklist before the deposit, the
// account the deposit is held in after it). The law behind each step is in its info tip.
export function MoveInSteps(p: Props) {
  const router = useRouter();
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState("");
  const [email, setEmail] = useState("");
  const [signed, setSigned] = useState<string[]>([]);
  const [room, setRoom] = useState("Living room");

  async function act(name: string, url: string, init: RequestInit) {
    setBusy(name);
    setError("");
    const r = await fetch(url, init).catch(() => null);
    const j = r ? await r.json().catch(() => ({})) : {};
    setBusy(null);
    if (!r?.ok) return setError(j.error ?? "Something went wrong. Try again.");
    router.refresh();
  }

  // Photos are shrunk in the browser and sent in requests under the host's body limit (src/lib/uploads.ts). The input is
  // cleared first, so choosing the same files again after a failure fires a change event.
  async function addPhotos(input: HTMLInputElement) {
    const files = Array.from(input.files ?? []);
    input.value = "";
    if (!files.length) return;
    setBusy("photos");
    setError("");
    const res = await uploadPhotos(`/api/tenancies/${p.tenancyId}/photos`, { phase: "move_in", room }, files);
    setBusy(null);
    if (!res.ok) setError(res.error);
    router.refresh();
  }

  const pack = packFor(p.state);
  const moveIn = p.photos.filter((x) => x.phase === "move_in");
  const paid = wasPaid(p.invoice?.status);
  const records = recordsFor(pack, "move_in");
  const pre = records.filter((r) => r.beforeInvoice), post = records.filter((r) => !r.beforeInvoice);
  const preOpen = pre.find((r) => !p.notices[r.kind]);
  const postOpen = post.find((r) => !p.notices[r.kind]);
  // The current step: 2 the agreement, "pre" a record before the invoice, 3 the deposit, "post" a record after it, 4 photos.
  const firstOpen: number | string = !p.agreement ? 2 : preOpen ? `pre:${preOpen.kind}` : !paid ? 3 : postOpen ? `post:${postOpen.kind}` : !moveIn.length ? 4 : 0;
  const record = (r: RecordDef, where: "pre" | "post") => {
    const given = p.notices[r.kind] ?? null;
    return (
      <Step key={r.kind} state={given ? "done" : firstOpen === `${where}:${r.kind}` ? "now" : "todo"} title={r.short.charAt(0).toUpperCase() + r.short.slice(1)}
        info={<InfoTip title={r.title} cite={r.cite}>{r.tip}</InfoTip>}>
        <div className="flex flex-wrap items-center gap-x-3 gap-y-2">
          {given ? <p className="text-sm text-ink-3">{r.verb} {shortDate(given.date)}{given.detail ? `, ${given.detail}` : ""}</p>
            : !p.locked && <NoticeGivenForm tenancyId={p.tenancyId} state={pack.code} kind={r.kind} tenants={p.tenants} today={todayIso()} given={null} />}
          <a href={`/tenancy/${p.tenancyId}/notices/${NOTICE_SLUG[r.kind]}`} className="text-sm text-brand hover:underline">{r.draft ? "Open draft" : "Details"}</a>
        </div>
      </Step>
    );
  };

  return (
    <div className="px-5 py-4">
      {error && <Notice className="mb-4">{error}</Notice>}
      <ol className="flex flex-col">
        <Step state="done" title="Lease checked"
          info={<InfoTip title={pack.moveIn.lawCheckTip.title} cite={pack.moveIn.lawCheckTip.cite}>{pack.moveIn.lawCheckTip.text}</InfoTip>}>
          <p className="text-sm text-ink-3">
            {p.flagCounts.violations} violation{p.flagCounts.violations === 1 ? "" : "s"}, {p.flagCounts.warnings} warning{p.flagCounts.warnings === 1 ? "" : "s"}
          </p>
        </Step>

        <Step state={p.agreement ? "done" : firstOpen === 2 ? "now" : "todo"} title={pack.refund.agreementRequired ? "Refund agreement" : "Refund account"}
          info={<InfoTip title={pack.refund.agreementTip.title} cite={pack.refund.agreementTip.cite}>{pack.refund.agreementTip.text}</InfoTip>}>
          {p.agreement ? (
            <p className="text-sm text-ink-3">{p.agreement.signed_by.join(" and ")}, PayPal to <span className="text-ink">{p.agreement.paypal_email}</span></p>
          ) : (
            <div className="mt-1 flex max-w-md flex-col gap-3">
              <FormField label="Tenant's PayPal email">
                <input type="email" value={email} onChange={(e) => setEmail(e.target.value)} placeholder="name@example.com" autoComplete="off" className={inputClass} />
              </FormField>
              <div className="flex flex-wrap gap-x-4 gap-y-2">
                {p.tenants.map((t) => (
                  <label key={t} className="flex items-center gap-2 text-sm">
                    <input type="checkbox" className="size-[15px]" checked={signed.includes(t)}
                      onChange={(e) => setSigned(e.target.checked ? [...signed, t] : signed.filter((x) => x !== t))} />
                    {t} agrees
                  </label>
                ))}
              </div>
              <div>
                <Button variant={p.quiet ? "secondary" : "primary"} disabled={busy === "agree"} onClick={() => act("agree", `/api/tenancies/${p.tenancyId}/agreement`, {
                  method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ paypalEmail: email, signers: signed }),
                })}>{busy === "agree" ? "Saving..." : "Record agreement"}</Button>
              </div>
            </div>
          )}
        </Step>

        {pre.map((r) => record(r, "pre"))}

        <Step state={paid ? "done" : firstOpen === 3 ? "now" : "todo"} title="Deposit through PayPal"
          info={<InfoTip title={pack.moveIn.depositTip.title} cite={pack.moveIn.depositTip.cite}>{pack.moveIn.depositTip.text}</InfoTip>}>
          {p.invoice ? (
            <div className="flex flex-col gap-1.5">
              <div className="flex flex-wrap items-center gap-2 text-sm">
                <Money value={p.invoice.amount} className="font-medium" />
                <StatusChip tone={paid ? "green" : "gray"}>{paid ? "Paid" : p.invoice.status.charAt(0) + p.invoice.status.slice(1).toLowerCase().replace(/_/g, " ")}</StatusChip>
                {p.invoice.id && <span className="text-xs text-ink-3">Invoice {p.invoice.id}</span>}
              </div>
              {!paid && p.invoice.payLink && (
                <a className="inline-flex items-center gap-1 text-sm text-brand hover:underline" href={p.invoice.payLink} target="_blank" rel="noreferrer">
                  Tenant&apos;s pay link<Icon name="arrow-up-right" className="size-3.5" />
                </a>
              )}
            </div>
          ) : p.lawful ? (
            <div className="flex flex-col gap-2.5">
              {p.lawful.cap != null && p.lawful.amount < p.lawful.charged ? (
                <p className="text-sm text-ink-3">
                  Lease asks <s>{usd(p.lawful.charged)}</s>, cap is <span className="text-ink">{usd(p.lawful.cap)}</span>
                </p>
              ) : (
                <p className="text-sm text-ink-3">{usd(p.lawful.amount)}, {p.lawful.cap == null ? `no ${pack.name} cap` : "within the cap"}</p>
              )}
              <div className="flex flex-wrap items-center gap-3">
                <Button variant={p.quiet ? "secondary" : "primary"} disabled={!p.agreement || !!preOpen || busy === "invoice"}
                  onClick={() => act("invoice", `/api/tenancies/${p.tenancyId}/deposit-invoice`, { method: "POST" })}>
                  <Icon name="receive" />{busy === "invoice" ? "Sending..." : `Request ${usd(p.lawful.amount)}`}
                </Button>
                {!p.agreement ? <span className="text-xs text-ink-3">Record the {pack.refund.agreementRequired ? "agreement" : "refund account"} first</span>
                  : preOpen && <span className="text-xs text-ink-3">Record the {preOpen.short} first</span>}
              </div>
            </div>
          ) : (
            <p className="text-sm text-ink-3">{pack.moveIn.capUnknownLine}</p>
          )}
        </Step>

        {post.map((r) => record(r, "post"))}

        <Step last state={moveIn.length ? "done" : firstOpen === 4 ? "now" : "todo"} title="Move-in photos"
          info={<InfoTip title={pack.moveIn.photosTip.title} cite={pack.moveIn.photosTip.cite}>{pack.moveIn.photosTip.text}</InfoTip>}>
          {!p.locked && <div className="flex flex-wrap items-center gap-2">
            <select value={room} onChange={(e) => setRoom(e.target.value)} aria-label="Room" className={`${inlineInputClass} pr-8`}>
              {ROOMS.map((r) => <option key={r}>{r}</option>)}
            </select>
            <label className={buttonClass("secondary", "md", "cursor-pointer focus-within:ring-3 focus-within:ring-brand-100")}>
              <Icon name="camera" />{busy === "photos" ? "Uploading..." : "Add photos"}
              <input type="file" accept="image/*" multiple className="sr-only" onChange={(e) => addPhotos(e.currentTarget)} />
            </label>
            {moveIn.length > 0 && <span className="text-xs text-ink-3">{moveIn.length} photo{moveIn.length === 1 ? "" : "s"}</span>}
          </div>}
          {p.locked && <p className="text-sm text-ink-3">{moveIn.length ? `${moveIn.length} photo${moveIn.length === 1 ? "" : "s"}` : "None taken"}</p>}
          {moveIn.length > 0 && (
            <div className={`${p.locked ? "mt-2" : "mt-3"} grid grid-cols-[repeat(auto-fill,minmax(104px,1fr))] gap-2`}>
              {moveIn.map((x) => x.url && (
                <figure key={x.id} className="relative">
                  {/* eslint-disable-next-line @next/next/no-img-element */}
                  <img src={x.url} alt={x.room} className="aspect-[4/3] w-full rounded-md object-cover" />
                  <figcaption className="absolute left-1.5 top-1.5 max-w-[calc(100%-12px)] truncate rounded-xs bg-white/95 px-1.5 text-xs font-medium text-ink">{x.room}</figcaption>
                </figure>
              ))}
            </div>
          )}
        </Step>
      </ol>
    </div>
  );
}

/** One step on the timeline: a green check when done, a brand dot for the current one, an empty ring after. */
function Step({ state, title, info, last, children }: { state: "done" | "now" | "todo"; title: string; info?: React.ReactNode; last?: boolean; children: React.ReactNode }) {
  return (
    <li className={`relative grid grid-cols-[20px_minmax(0,1fr)] gap-x-3 ${last ? "" : "pb-5"}`}>
      {!last && <span className="absolute bottom-0 left-[9.5px] top-6 w-px bg-line" />}
      <span className={`relative z-10 flex size-5 items-center justify-center rounded-full ${state === "done" ? "bg-green-bg text-green"
        : state === "now" ? "bg-brand-50" : "border border-line bg-canvas"}`}>
        {state === "done" ? <Icon name="check" className="size-3" /> : state === "now" ? <span className="size-2 rounded-full bg-brand" /> : null}
      </span>
      <div className="min-w-0">
        <div className="flex items-center gap-1.5 text-base font-medium">{title}{info}</div>
        <div className="mt-1">{children}</div>
      </div>
    </li>
  );
}

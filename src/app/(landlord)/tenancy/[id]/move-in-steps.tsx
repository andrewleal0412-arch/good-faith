"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { Button, buttonClass } from "@/components/button";
import { Icon } from "@/components/icons";
import { InfoTip } from "@/components/info-tip";
import { Money, Notice, StatusChip, inputClass, inlineInputClass } from "@/components/ui";
import { wasPaid } from "@/lib/invoice-status";
import { uploadPhotos } from "@/lib/uploads";

type Props = {
  tenancyId: string;
  tenants: string[];
  flagCounts: { violations: number; warnings: number };
  agreement: { paypal_email: string; signed_by: string[]; signed_at: string } | null;
  lawful: { amount: number; cap: number; charged: number } | null;
  invoice: { id: string; amount: number; status: string; payLink: string | null } | null;
  photos: { id: string; phase: string; room: string; url: string | null }[];
};

const usd = (n: number) => `$${n.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
const ROOMS = ["Living room", "Kitchen", "Bedroom 1", "Bedroom 2", "Bathroom", "Hallway"];

// Move-in, four steps on one timeline: the lease check, the tenants' written refund agreement (AB 414), the lawful
// deposit through a PayPal invoice, and the move-in photos (AB 2801). The law behind each step is in its info tip.
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
    const r = await fetch(url, init);
    const j = await r.json().catch(() => ({}));
    setBusy(null);
    if (!r.ok) return setError(j.error ?? "Something went wrong.");
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

  const moveIn = p.photos.filter((x) => x.phase === "move_in");
  const paid = wasPaid(p.invoice?.status);
  const firstOpen = !p.agreement ? 2 : !paid ? 3 : !moveIn.length ? 4 : 0;

  return (
    <div className="px-5 py-4">
      {error && <Notice className="mb-4">{error}</Notice>}
      <ol className="flex flex-col">
        <Step state="done" title="Lease checked"
          info={<InfoTip title="Checked against Civ. Code 1950.5">The agent never collects more than the law allows. The flags stay on the lease check.</InfoTip>}>
          <p className="text-sm text-ink-3">
            {p.flagCounts.violations} violation{p.flagCounts.violations === 1 ? "" : "s"}, {p.flagCounts.warnings} warning{p.flagCounts.warnings === 1 ? "" : "s"}
          </p>
        </Step>

        <Step state={p.agreement ? "done" : firstOpen === 2 ? "now" : "todo"} title="Refund agreement"
          info={<InfoTip title="Refund by PayPal, in writing" cite="Civ. Code 1950.5(h)(1)(A), (h)(1)(C)">
            When the deposit or the rent is paid electronically, the deposit comes back electronically, and by PayPal only with the
            written agreement of every adult tenant.
          </InfoTip>}>
          {p.agreement ? (
            <p className="text-sm text-ink-3">{p.agreement.signed_by.join(" and ")}, PayPal to <span className="text-ink">{p.agreement.paypal_email}</span></p>
          ) : (
            <div className="mt-1 flex max-w-md flex-col gap-3">
              <input value={email} onChange={(e) => setEmail(e.target.value)} placeholder="Tenant's PayPal email" aria-label="Tenant's PayPal email" className={inputClass} />
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
                <Button variant="primary" disabled={busy === "agree"} onClick={() => act("agree", `/api/tenancies/${p.tenancyId}/agreement`, {
                  method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ paypalEmail: email, signers: signed }),
                })}>{busy === "agree" ? "Saving..." : "Record agreement"}</Button>
              </div>
            </div>
          )}
        </Step>

        <Step state={paid ? "done" : firstOpen === 3 ? "now" : "todo"} title="Deposit through PayPal"
          info={<InfoTip title="The lawful deposit" cite="Civ. Code 1950.5(c)">
            Security is capped at one month&apos;s rent, or two for a small landlord. The invoice is never more than the cap.
          </InfoTip>}>
          {p.invoice ? (
            <div className="flex flex-col gap-1.5">
              <div className="flex flex-wrap items-center gap-2 text-sm">
                <Money value={p.invoice.amount} className="font-medium" />
                <StatusChip tone={paid ? "green" : "gray"}>{paid ? "Paid" : p.invoice.status.charAt(0) + p.invoice.status.slice(1).toLowerCase().replace(/_/g, " ")}</StatusChip>
                <span className="text-xs text-ink-3">Invoice {p.invoice.id}</span>
              </div>
              {!paid && p.invoice.payLink && (
                <a className="inline-flex items-center gap-1 text-sm text-brand hover:underline" href={p.invoice.payLink} target="_blank" rel="noreferrer">
                  Tenant&apos;s pay link<Icon name="arrow-up-right" className="size-3.5" />
                </a>
              )}
            </div>
          ) : p.lawful ? (
            <div className="flex flex-col gap-2.5">
              {p.lawful.amount < p.lawful.charged ? (
                <p className="flex flex-wrap items-center gap-1.5 text-sm text-ink-3">
                  Lease asks <s>{usd(p.lawful.charged)}</s>, cap is <span className="text-ink">{usd(p.lawful.cap)}</span>
                </p>
              ) : (
                <p className="text-sm text-ink-3">{usd(p.lawful.amount)}, within the cap</p>
              )}
              <div className="flex flex-wrap items-center gap-3">
                <Button variant="primary" disabled={!p.agreement || busy === "invoice"}
                  onClick={() => act("invoice", `/api/tenancies/${p.tenancyId}/deposit-invoice`, { method: "POST" })}>
                  <Icon name="receive" />{busy === "invoice" ? "Sending..." : `Request ${usd(p.lawful.amount)}`}
                </Button>
                {!p.agreement && <span className="text-xs text-ink-3">Record the agreement first</span>}
              </div>
            </div>
          ) : (
            <p className="text-sm text-ink-3">Confirm the owner type and portfolio size to set the cap</p>
          )}
        </Step>

        <Step last state={moveIn.length ? "done" : firstOpen === 4 ? "now" : "todo"} title="Move-in photos"
          info={<InfoTip title="Every room, before move-in" cite="Civ. Code 1950.5(g)(1), AB 2801">
            Required for tenancies that began on or after July 1, 2025. They are the evidence for anything charged at move-out.
          </InfoTip>}>
          <div className="flex flex-wrap items-center gap-2">
            <select value={room} onChange={(e) => setRoom(e.target.value)} aria-label="Room" className={`${inlineInputClass} pr-8`}>
              {ROOMS.map((r) => <option key={r}>{r}</option>)}
            </select>
            <label className={buttonClass("secondary", "md", "cursor-pointer")}>
              <Icon name="camera" />{busy === "photos" ? "Uploading..." : "Add photos"}
              <input type="file" accept="image/*" multiple className="sr-only" onChange={(e) => addPhotos(e.currentTarget)} />
            </label>
            {moveIn.length > 0 && <span className="text-xs text-ink-3">{moveIn.length} photo{moveIn.length === 1 ? "" : "s"}</span>}
          </div>
          {moveIn.length > 0 && (
            <div className="mt-3 grid grid-cols-3 gap-2 sm:grid-cols-5">
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

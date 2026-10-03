"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { addDays, shortDate } from "@/lib/dates";
import { FORWARDING_MAX, PLANNED_MOVE_OUT_HORIZON_DAYS, PLANNED_MOVE_OUT_PAST_DAYS, tenantMoveOutSentOn, type TenantMoveOut } from "@/lib/tenant";
import { buttonClass } from "@/components/button";
import { FormField } from "@/components/field";
import { Notice, inputClass } from "@/components/ui";

const input = inputClass;

/** A forwarding address as the tenants would write one, in the unit's own state. */
const EXAMPLE: Record<string, string> = {
  CA: "123 Main St, Apt 4, Orange, CA 92866",
  TX: "123 Main St, Apt 4, Austin, TX 78701",
  NY: "123 Main St, Apt 4, Brooklyn, NY 11201",
  FL: "123 Main St, Apt 4, Tampa, FL 33602",
  WA: "123 Main St, Apt 4, Tacoma, WA 98402",
};

// "I'm moving out": the planned date and the forwarding address the statement is mailed to (Civ. Code 1950.5(h)(6)).
// Sending it again changes the one record rather than adding another; the landlord sees the latest. Once the
// landlord has recorded the actual move-out (moveOutDate), the date is settled and only the address is asked for.
export function MovingOutForm(p: { token: string; tenants: string[]; today: string; moveOutDate: string | null; existing: TenantMoveOut | null; quiet?: boolean; state?: string }) {
  const router = useRouter();
  const dateLocked = !!p.moveOutDate;
  const [saved, setSaved] = useState(p.existing); // the record as the server last returned it, so a change shows at once
  const [open, setOpen] = useState(!p.existing);
  const [name, setName] = useState(p.existing?.name ?? (p.tenants.length === 1 ? p.tenants[0] : ""));
  const [date, setDate] = useState(p.existing?.planned_move_out ?? "");
  const [address, setAddress] = useState(p.existing?.forwarding_address ?? "");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [justSent, setJustSent] = useState(false);

  async function send() {
    setBusy(true);
    setError("");
    const r = await fetch(`/api/t/${p.token}/moving-out`, {
      method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ name, plannedMoveOut: dateLocked ? undefined : date, forwardingAddress: address }),
    });
    const j = await r.json().catch(() => ({}));
    setBusy(false);
    if (!r.ok) return setError(j.error ?? "Couldn't send that. Try again.");
    if (j.moveOut) setSaved(j.moveOut as TenantMoveOut);
    setJustSent(true);
    setOpen(false);
    router.refresh();
  }

  if (!open && saved) {
    const m = saved;
    return (
      <div className="flex items-start gap-3 rounded-lg border border-line-2 bg-surface px-4 py-3.5" role={justSent ? "status" : undefined}>
        <div className="min-w-0 flex-1">
          <p className="font-medium">{justSent ? "Sent to your landlord" : `Sent ${shortDate(tenantMoveOutSentOn(m))}`}</p>
          <dl className="mt-2 grid grid-cols-[auto_minmax(0,1fr)] gap-x-4 gap-y-1 text-sm">
            {m.name && <><dt className="text-ink-3">From</dt><dd className="min-w-0">{m.name}</dd></>}
            {!dateLocked && <><dt className="text-ink-3">Moving out</dt><dd className="min-w-0">{shortDate(m.planned_move_out)}</dd></>}
            <dt className="text-ink-3">Mail to</dt><dd className="min-w-0 break-words">{m.forwarding_address}</dd>
          </dl>
        </div>
        <button type="button" onClick={() => setOpen(true)} className={buttonClass("link", "md")}>Change</button>
      </div>
    );
  }

  return (
    <div>
      <div className="grid gap-4 sm:grid-cols-2">
        {p.tenants.length > 1 && (
          <Field label="Your name">
            <select className={input} value={name} onChange={(e) => setName(e.target.value)}>
              <option value="">Pick your name</option>
              {p.tenants.map((t) => <option key={t}>{t}</option>)}
            </select>
          </Field>
        )}
        {!dateLocked && (
          <Field label="Move-out date" hint="The day you plan to hand back the keys.">
            <input type="date" className={input} value={date} min={addDays(p.today, -PLANNED_MOVE_OUT_PAST_DAYS)} max={addDays(p.today, PLANNED_MOVE_OUT_HORIZON_DAYS)}
              onChange={(e) => setDate(e.target.value)} />
          </Field>
        )}
        <div className="sm:col-span-2">
          <Field label="Forwarding address" hint="Street, city, state and ZIP.">
            <input className={input} value={address} maxLength={FORWARDING_MAX} autoComplete="street-address" onChange={(e) => setAddress(e.target.value)} placeholder={EXAMPLE[p.state ?? "CA"] ?? EXAMPLE.CA} />
          </Field>
        </div>
      </div>
      {error && <Notice className="mt-3">{error}</Notice>}
      <div className="mt-4 flex gap-2">
        <button type="button" onClick={send} disabled={busy || (!dateLocked && !date) || !address || !name} className={buttonClass(p.quiet ? "secondary" : "primary", "md")}>
          {busy ? "Sending..." : p.existing ? "Send the change" : "Send to your landlord"}
        </button>
        {p.existing && <button type="button" onClick={() => setOpen(false)} className={buttonClass("secondary", "md")}>Cancel</button>}
      </div>
    </div>
  );
}

function Field({ label, hint, children }: { label: string; hint?: string; children: React.ReactNode }) {
  return <FormField label={label} note={hint}>{children}</FormField>;
}

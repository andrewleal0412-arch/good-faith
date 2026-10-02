"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { addDays, longDate } from "@/lib/dates";
import { FORWARDING_MAX, PLANNED_MOVE_OUT_HORIZON_DAYS, PLANNED_MOVE_OUT_PAST_DAYS, tenantMoveOutSentOn, type TenantMoveOut } from "@/lib/tenant";
import { buttonClass } from "@/components/button";
import { FormField } from "@/components/field";
import { Notice, inputClass } from "@/components/ui";

const input = inputClass;

// "I'm moving out": the planned date and the forwarding address the statement is mailed to (Civ. Code 1950.5(h)(6)).
// Sending it again changes the one record rather than adding another; the landlord sees the latest. Once the
// landlord has recorded the actual move-out (moveOutDate), the date is settled and only the address is asked for.
export function MovingOutForm(p: { token: string; tenants: string[]; today: string; moveOutDate: string | null; existing: TenantMoveOut | null }) {
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
      <div className="mt-4 rounded-md bg-surface px-4 py-3 text-base text-ink-2">
        <b className="text-ink">{justSent ? "Sent to your landlord." : `Sent ${longDate(tenantMoveOutSentOn(m))}.`}</b>{" "}
        {m.name ? `${m.name}: ` : ""}{!dateLocked && <>moving out <b className="text-ink">{longDate(m.planned_move_out)}</b>; </>}mail the statement to <b className="text-ink">{m.forwarding_address}</b>.{" "}
        <button onClick={() => setOpen(true)} className="font-medium text-brand hover:underline">Change</button>
      </div>
    );
  }

  return (
    <div className="mt-4 rounded-md border border-line p-4">
      <p className="text-base font-medium">{dateLocked ? "Where to mail the statement" : "I'm moving out"}</p>
      <div className="mt-3 grid gap-3 sm:grid-cols-2">
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
          <Field label="Forwarding address for the statement" hint="Street, city, state and ZIP. The itemized statement and anything mailed with it go here.">
            <input className={input} value={address} maxLength={FORWARDING_MAX} onChange={(e) => setAddress(e.target.value)} placeholder="123 Main St, Apt 4, Orange, CA 92866" />
          </Field>
        </div>
      </div>
      {error && <Notice className="mt-3">{error}</Notice>}
      <div className="mt-4 flex gap-2">
        <button onClick={send} disabled={busy || (!dateLocked && !date) || !address || !name} className={buttonClass("primary", "md")}>
          {busy ? "Sending..." : p.existing ? "Send the change" : "Send to the landlord"}
        </button>
        {p.existing && <button onClick={() => setOpen(false)} className={buttonClass("secondary", "md")}>Cancel</button>}
      </div>
    </div>
  );
}

function Field({ label, hint, children }: { label: string; hint?: string; children: React.ReactNode }) {
  return <FormField label={label} note={hint} labelClass="mb-1.5 block text-xs font-medium text-ink-3">{children}</FormField>;
}

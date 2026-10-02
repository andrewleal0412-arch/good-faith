"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { longDate } from "@/lib/dates";
import type { DeliveryRecord } from "@/lib/statement";
import { Button } from "@/components/button";
import { InfoTip } from "@/components/info-tip";
import { FormField } from "@/components/field";
import { Notice, inputClass } from "@/components/ui";

const input = inputClass;

const METHODS: [DeliveryRecord["method"], string][] = [["personal", "Personal delivery"], ["mail", "First-class mail"], ["email", "Email, by written agreement"]];

// How and when the statement went out (Civ. Code 1950.5(h)(1)(B), (h)(6)). Email stays behind a confirmation that the
// tenant agreed to it in writing; the server refuses it otherwise.
export function DeliveryForm(p: {
  tenancyId: string;
  tenants: { name: string; email: string | null }[];
  unitAddress: string;
  today: string;
  existing: DeliveryRecord | null;
  forwarding: { address: string; name: string | null; date: string } | null; // what the tenants gave through their link
}) {
  const router = useRouter();
  const emailOf = (name: string) => p.tenants.find((t) => t.name === name)?.email ?? "";
  // A mailing to the vacated unit was the fallback, so the forwarding field starts empty for it. Records from
  // before the kind was stored count as forwarding only when the address differs from the unit's.
  const mailedForwarding = p.existing?.method === "mail" && !!p.existing.address && p.existing.address_kind !== "unit"
    && (p.existing.address_kind === "forwarding" || p.existing.address !== p.unitAddress);
  const [open, setOpen] = useState(!p.existing);
  const [method, setMethod] = useState<DeliveryRecord["method"]>(p.existing?.method ?? "mail");
  const [date, setDate] = useState(p.existing?.date ?? p.today);
  const [to, setTo] = useState(p.existing?.to ?? p.tenants[0]?.name ?? "");
  // With no record yet, the field starts from the forwarding address the tenants gave through their link ((h)(6)).
  const [address, setAddress] = useState(mailedForwarding ? p.existing!.address! : p.existing ? "" : p.forwarding?.address ?? "");
  const mailHint = p.forwarding
    ? `${p.forwarding.name ?? "The tenants"} gave this forwarding address through the tenant link on ${longDate(p.forwarding.date)}. Leave it blank to use the vacated unit, ${p.unitAddress} (Civ. Code 1950.5(h)(6)).`
    : `The forwarding address the tenant gave. Leave it blank to use the vacated unit, ${p.unitAddress} (Civ. Code 1950.5(h)(6)).`;
  const [email, setEmail] = useState(p.existing?.email ?? emailOf(p.existing?.to ?? p.tenants[0]?.name ?? ""));
  const [agreed, setAgreed] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  /** The email field follows the chosen tenant's address on file unless the landlord typed another. */
  function pickTenant(name: string) {
    const was = emailOf(to);
    setTo(name);
    setEmail((cur) => (!cur || cur === was ? emailOf(name) : cur));
  }

  async function save() {
    setBusy(true);
    setError("");
    const r = await fetch(`/api/tenancies/${p.tenancyId}/statement/delivery`, {
      method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ method, date, to, address, email, by_agreement: method === "email" ? agreed : false }),
    });
    setBusy(false);
    if (!r.ok) return setError((await r.json().catch(() => ({}))).error ?? "Couldn't record that.");
    setOpen(false);
    router.refresh();
  }

  if (!open) {
    return (
      <button onClick={() => setOpen(true)} className="mt-3 text-sm font-medium text-brand hover:underline">
        Change the delivery record
      </button>
    );
  }

  return (
    <div className="mt-4 rounded-md border border-line p-4">
      <p className="flex items-center gap-1.5 text-base font-medium">
        Record the delivery
        <InfoTip title="How the statement goes out" cite="Civ. Code 1950.5(h)(1)(B)">
          Personal delivery or first-class mail. Email only if you and the tenant agreed to it in writing.
        </InfoTip>
      </p>

      <div className="mt-3 inline-flex flex-wrap gap-0.5 rounded-md bg-surface-2 p-[3px]">
        {METHODS.map(([k, label]) => (
          <button key={k} type="button" onClick={() => setMethod(k)}
            className={`h-7 rounded-sm px-2.5 text-sm ${method === k ? "bg-canvas font-medium text-ink shadow-sm" : "text-ink-3 hover:text-ink"}`}>
            {label}
          </button>
        ))}
      </div>

      <div className="mt-3 grid gap-3 sm:grid-cols-2">
        {method === "mail" && (
          <div className="sm:col-span-2">
            <Field label="Mailed to" hint={mailHint}>
              <input className={input} value={address} onChange={(e) => setAddress(e.target.value)} placeholder="Forwarding address" />
            </Field>
          </div>
        )}
        {method === "email" && (
          <div className="sm:col-span-2">
            <Field label="Emailed to">
              <input className={input} inputMode="email" value={email} onChange={(e) => setEmail(e.target.value)} placeholder="tenant@example.com" />
            </Field>
          </div>
        )}
        <Field label="Addressed to" hint={p.tenants.length > 1 ? "With more than one adult tenant, the statement may go to any one of them (Civ. Code 1950.5(h)(1)(C))." : undefined}>
          <select className={input} value={to} onChange={(e) => pickTenant(e.target.value)}>
            {p.tenants.map((t) => <option key={t.name}>{t.name}</option>)}
          </select>
        </Field>
        <Field label="Date delivered">
          <input type="date" className={input} value={date} max={p.today} onChange={(e) => setDate(e.target.value)} />
        </Field>
      </div>

      {method === "email" && (
        <label className="mt-3 flex items-start gap-2 text-sm text-ink-2">
          <input type="checkbox" className="mt-0.5 size-[15px]" checked={agreed} onChange={(e) => setAgreed(e.target.checked)} />
          {to || "The tenant"} and I agreed in writing that the itemized statement may be sent by email.
        </label>
      )}
      {error && <Notice className="mt-3">{error}</Notice>}

      <div className="mt-4 flex gap-2">
        <Button variant="primary" onClick={save} disabled={busy || (method === "email" && !agreed)}>{busy ? "Saving..." : "Record delivery"}</Button>
        {p.existing && <Button onClick={() => setOpen(false)}>Cancel</Button>}
      </div>
    </div>
  );
}

function Field({ label, hint, children }: { label: string; hint?: string; children: React.ReactNode }) {
  return <FormField label={label} hint={hint && <InfoTip title={label}>{hint}</InfoTip>}>{children}</FormField>;
}

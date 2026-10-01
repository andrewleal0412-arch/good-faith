"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import type { DeliveryRecord } from "@/lib/statement";

const input = "w-full rounded-xl border border-line bg-bg px-3 py-2 text-[14px] outline-none focus:border-accent";

const METHODS: [DeliveryRecord["method"], string][] = [["personal", "Personal delivery"], ["mail", "First-class mail"], ["email", "Email, by written agreement"]];

// How and when the statement went out (Civ. Code 1950.5(h)(1)(B), (h)(6)). Email stays behind a confirmation that the
// tenant agreed to it in writing; the server refuses it otherwise.
export function DeliveryForm(p: {
  tenancyId: string;
  tenants: { name: string; email: string | null }[];
  unitAddress: string;
  today: string;
  existing: DeliveryRecord | null;
}) {
  const router = useRouter();
  const emailOf = (name: string) => p.tenants.find((t) => t.name === name)?.email ?? "";
  // A mailing to the vacated unit was the fallback, so the forwarding field starts empty for it. Records from
  // before the kind was stored count as forwarding only when the address differs from the unit's.
  const forwarding = p.existing?.method === "mail" && !!p.existing.address && p.existing.address_kind !== "unit"
    && (p.existing.address_kind === "forwarding" || p.existing.address !== p.unitAddress);
  const [open, setOpen] = useState(!p.existing);
  const [method, setMethod] = useState<DeliveryRecord["method"]>(p.existing?.method ?? "mail");
  const [date, setDate] = useState(p.existing?.date ?? p.today);
  const [to, setTo] = useState(p.existing?.to ?? p.tenants[0]?.name ?? "");
  const [address, setAddress] = useState(forwarding ? p.existing!.address! : "");
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
      <button onClick={() => setOpen(true)} className="mt-3 text-[13px] font-semibold text-ink-2 underline underline-offset-2 hover:text-ink">
        Change the delivery record
      </button>
    );
  }

  return (
    <div className="mt-4 rounded-xl border border-line p-4">
      <p className="text-[14px] font-semibold">Record the delivery</p>
      <p className="mt-1 text-[13px] text-ink-2">
        The statement goes by personal delivery or first-class mail. Email is allowed only if you and the tenant agreed to it in writing (Civ. Code 1950.5(h)(1)(B)).
      </p>

      <div className="mt-3 inline-flex flex-wrap gap-1 rounded-xl bg-bg p-1">
        {METHODS.map(([k, label]) => (
          <button key={k} type="button" onClick={() => setMethod(k)}
            className={`rounded-lg px-3 py-1.5 text-[13px] font-semibold ${method === k ? "bg-surface text-ink shadow-sm" : "text-ink-3"}`}>
            {label}
          </button>
        ))}
      </div>

      <div className="mt-3 grid gap-3 sm:grid-cols-2">
        {method === "mail" && (
          <div className="sm:col-span-2">
            <Field label="Mailed to" hint={`The forwarding address the tenant gave. Leave it blank to use the vacated unit, ${p.unitAddress} (Civ. Code 1950.5(h)(6)).`}>
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
        <label className="mt-3 flex items-start gap-2 text-[13px] text-ink-2">
          <input type="checkbox" className="mt-0.5" checked={agreed} onChange={(e) => setAgreed(e.target.checked)} />
          {to || "The tenant"} and I agreed in writing that the itemized statement may be sent by email.
        </label>
      )}
      {error && <p className="mt-3 rounded-xl bg-danger-soft px-4 py-3 text-[13px] text-danger">{error}</p>}

      <div className="mt-4 flex gap-2">
        <button onClick={save} disabled={busy || (method === "email" && !agreed)}
          className="rounded-xl bg-ink px-4 py-2 text-[14px] font-semibold text-white disabled:opacity-40">
          {busy ? "Saving..." : "Record delivery"}
        </button>
        {p.existing && <button onClick={() => setOpen(false)} className="rounded-xl px-4 py-2 text-[14px] text-ink-2">Cancel</button>}
      </div>
    </div>
  );
}

function Field({ label, hint, children }: { label: string; hint?: string; children: React.ReactNode }) {
  return (
    <div>
      <p className="mb-1.5 text-[12px] font-semibold uppercase tracking-[0.08em] text-ink-3">{label}</p>
      {children}
      {hint && <p className="mt-1 text-[12px] text-ink-3">{hint}</p>}
    </div>
  );
}

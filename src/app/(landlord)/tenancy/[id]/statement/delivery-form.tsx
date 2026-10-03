"use client";

import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import { longDate, shortDate } from "@/lib/dates";
import type { DeliveryRecord } from "@/lib/statement";
import { Button } from "@/components/button";
import { Drawer } from "@/components/drawer";
import { InfoTip } from "@/components/info-tip";
import { FormField } from "@/components/field";
import { Card, CardHead, Notice, StatusChip, inputClass } from "@/components/ui";

const input = inputClass;

const METHODS: [DeliveryRecord["method"], string][] = [["personal", "In person"], ["mail", "First-class mail"], ["email", "Email"]];
const METHOD_WORD: Record<DeliveryRecord["method"], string> = { personal: "In person", mail: "First-class mail", email: "Email, by agreement" };

// How and when the statement went out (Civ. Code 1950.5(h)(1)(B), (h)(6)): a card beside the statement with what is
// on record, and a drawer to record or change it. Email stays behind a confirmation that the tenant agreed to it in
// writing; the server refuses it otherwise. A link to #delivery opens the drawer straight away.
export function DeliveryPanel(p: {
  tenancyId: string;
  tenants: { name: string; email: string | null }[];
  unitAddress: string;
  today: string;
  due: string | null;
  existing: DeliveryRecord | null;
  forwarding: { address: string; name: string | null; date: string } | null; // what the tenants gave through their link
}) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const d = p.existing;

  useEffect(() => {
    // A link to #delivery (the "Record delivery" next step) opens the form, on arrival or later, while nothing is recorded.
    const check = () => { if (window.location.hash === "#delivery" && !p.existing) setOpen(true); };
    const t = setTimeout(check, 0);
    window.addEventListener("hashchange", check);
    return () => { clearTimeout(t); window.removeEventListener("hashchange", check); };
  }, [p.existing]);

  const where = !d ? null : d.method === "mail"
    ? (d.address_kind === "unit" ? "The vacated unit" : d.address ?? "Not recorded")
    : d.method === "email" ? d.email ?? "Not recorded" : d.to ?? "Not recorded";

  return (
    <Card id="delivery" className="scroll-mt-24">
      <CardHead title="Delivery" right={d ? <StatusChip tone="green">Delivered</StatusChip> : <StatusChip tone="amber">Not recorded</StatusChip>} />
      <div className="px-5 py-4">
        {d ? (
          <dl className="grid grid-cols-[72px_minmax(0,1fr)] gap-x-3 gap-y-2 text-sm">
            <dt className="text-ink-3">Method</dt><dd>{METHOD_WORD[d.method]}</dd>
            <dt className="text-ink-3">To</dt><dd className="truncate" title={where ?? undefined}>{d.method === "mail" ? where : d.to ?? where}</dd>
            <dt className="text-ink-3">Date</dt><dd className="tabular-nums">{shortDate(d.date)}</dd>
          </dl>
        ) : (
          <p className="text-sm text-ink-3">{p.due ? `Due ${shortDate(p.due)}, with the refund` : "Due with the refund"}</p>
        )}
        <Button className="mt-4 w-full" onClick={() => setOpen(true)}>{d ? "Change" : "Record delivery"}</Button>
      </div>
      {open && <DeliveryDrawer {...p} onClose={() => setOpen(false)} onSaved={() => { setOpen(false); router.refresh(); }} />}
    </Card>
  );
}

function DeliveryDrawer(p: Parameters<typeof DeliveryPanel>[0] & { onClose: () => void; onSaved: () => void }) {
  const emailOf = (name: string) => p.tenants.find((t) => t.name === name)?.email ?? "";
  // A mailing to the vacated unit was the fallback, so the forwarding field starts empty for it. Records from
  // before the kind was stored count as forwarding only when the address differs from the unit's.
  const mailedForwarding = p.existing?.method === "mail" && !!p.existing.address && p.existing.address_kind !== "unit"
    && (p.existing.address_kind === "forwarding" || p.existing.address !== p.unitAddress);
  const [method, setMethod] = useState<DeliveryRecord["method"]>(p.existing?.method ?? "mail");
  const [date, setDate] = useState(p.existing?.date ?? p.today);
  const [to, setTo] = useState(p.existing?.to ?? p.tenants[0]?.name ?? "");
  // With no record yet, the field starts from the forwarding address the tenants gave through their link ((h)(6)).
  const [address, setAddress] = useState(mailedForwarding ? p.existing!.address! : p.existing ? "" : p.forwarding?.address ?? "");
  const mailHint = p.forwarding
    ? `${p.forwarding.name ?? "The tenants"} gave this forwarding address through the tenant link on ${longDate(p.forwarding.date)}. Leave it blank to use the vacated unit, ${p.unitAddress}.`
    : `The forwarding address the tenant gave. Leave it blank to use the vacated unit, ${p.unitAddress}.`;
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
    }).catch(() => null);
    setBusy(false);
    if (!r?.ok) return setError((r && (await r.json().catch(() => ({}))).error) ?? "Couldn't record that.");
    p.onSaved();
  }

  return (
    <Drawer open onClose={p.onClose} title={p.existing ? "Change the delivery record" : "Record delivery"} sub="How the itemized statement went out"
      footer={<>
        <Button variant="primary" onClick={save} disabled={busy || (method === "email" && !agreed)}>{busy ? "Saving..." : "Record delivery"}</Button>
        <Button onClick={p.onClose}>Cancel</Button>
      </>}>
      <div className="flex flex-col gap-5">
        <FormField group label="Method" hint={
          <InfoTip title="How the statement goes out" cite="Civ. Code 1950.5(h)(1)(B), (h)(6)">
            Personal delivery or first-class mail to the address the tenant gave, or the vacated unit if none. Email only if you and the tenant agreed to it in writing.
          </InfoTip>}>
          <div className="inline-flex flex-wrap gap-0.5 rounded-md bg-surface-2 p-[3px]">
            {METHODS.map(([k, label]) => (
              <button key={k} type="button" onClick={() => setMethod(k)} aria-pressed={method === k} data-autofocus={method === k || undefined}
                className={`h-7 rounded-sm px-2.5 text-sm ${method === k ? "bg-canvas font-medium text-ink shadow-sm" : "text-ink-3 hover:text-ink"}`}>
                {label}
              </button>
            ))}
          </div>
        </FormField>

        {method === "mail" && (
          <Field label="Mailed to" hint={mailHint} cite="Civ. Code 1950.5(h)(6)">
            <input className={input} value={address} onChange={(e) => setAddress(e.target.value)} placeholder="Forwarding address" />
          </Field>
        )}
        {method === "email" && (
          <Field label="Emailed to">
            <input className={input} inputMode="email" value={email} onChange={(e) => setEmail(e.target.value)} placeholder="tenant@example.com" />
          </Field>
        )}
        <Field label="Addressed to" cite="Civ. Code 1950.5(h)(1)(C)"
          hint={p.tenants.length > 1 ? "With more than one adult tenant, the statement may go to any one of them." : undefined}>
          <select className={input} value={to} onChange={(e) => pickTenant(e.target.value)}>
            {p.tenants.map((t) => <option key={t.name}>{t.name}</option>)}
          </select>
        </Field>
        <Field label="Date delivered">
          <input type="date" className={input} value={date} max={p.today} onChange={(e) => setDate(e.target.value)} />
        </Field>

        {method === "email" && (
          <label className="flex items-start gap-2 text-sm text-ink-2">
            <input type="checkbox" className="mt-0.5 size-[15px]" checked={agreed} onChange={(e) => setAgreed(e.target.checked)} />
            {to || "The tenant"} and I agreed in writing that the itemized statement may be sent by email.
          </label>
        )}
        {error && <Notice>{error}</Notice>}
      </div>
    </Drawer>
  );
}

function Field({ label, hint, cite, children }: { label: string; hint?: string; cite?: string; children: React.ReactNode }) {
  return <FormField label={label} hint={hint && <InfoTip title={label} cite={cite}>{hint}</InfoTip>}>{children}</FormField>;
}

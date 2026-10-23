"use client";

import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import { shortDate } from "@/lib/dates";
import type { DeliveryRecord } from "@/lib/delivery";
import { packFor } from "@/lib/states";
import { Button } from "@/components/button";
import { Drawer, drawerFooter } from "@/components/drawer";
import { InfoTip } from "@/components/info-tip";
import { FormField } from "@/components/field";
import { Card, CardHead, LineMark, Notice, StatusChip, inputClass } from "@/components/ui";

const input = inputClass;

const METHODS: [DeliveryRecord["method"], string][] = [["personal", "In person"], ["mail", "First-class mail"], ["email", "Email"]];
const METHOD_WORD: Record<"personal" | "mail", string> = { personal: "In person", mail: "First-class mail" };

// How and when the statement went out, under the tenancy's state pack (California: Civ. Code 1950.5(h)(1)(B), (h)(6)):
// a card beside the statement with what is on record, and a drawer to record or change it. Email stays behind a
// confirmation where the state's rule needs one (California: the tenant agreed in writing) and is not offered where
// the state's safe harbor leaves it out (Washington); the server refuses it otherwise. A link to #delivery opens the
// drawer straight away.
export function DeliveryPanel(p: {
  tenancyId: string;
  state: string;
  tenants: { name: string; email: string | null }[];
  unitAddress: string;
  today: string;
  due: string | null;
  existing: DeliveryRecord | null;
  recordedOn?: string | null; // the day the record was made, when later than the delivery date it names
  forwarding: { address: string; name: string | null; date: string } | null; // what the tenants gave through their link
  waiting?: boolean; // PayPal's live answer for the statement is not in yet: the button waits for it
}) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const d = p.existing;

  useEffect(() => {
    // A link to #delivery (the "Record delivery" next step) opens the form, on arrival or later, while nothing is
    // recorded; once the statement's PayPal answer is in (the panel drawn while it waits never opens it).
    if (p.waiting) return;
    const check = () => { if (window.location.hash === "#delivery" && !p.existing) setOpen(true); };
    const t = setTimeout(check, 0);
    window.addEventListener("hashchange", check);
    return () => { clearTimeout(t); window.removeEventListener("hashchange", check); };
  }, [p.existing, p.waiting]);

  const where = !d ? null : d.method === "mail"
    ? (d.address_kind === "unit" ? "The vacated unit" : d.address ?? "Not recorded")
    : d.method === "email" ? d.email ?? "Not recorded" : d.to ?? "Not recorded";

  return (
    <Card id="delivery" className="scroll-mt-8">
      <CardHead title="Delivery" right={d ? <StatusChip tone="green">Delivered</StatusChip> : <StatusChip tone="amber">Not recorded</StatusChip>} />
      <div className="px-5 py-4">
        {d ? (
          <dl className="grid grid-cols-[72px_minmax(0,1fr)] gap-x-3 gap-y-2 text-sm">
            <dt className="text-ink-3">Method</dt><dd>{d.method === "email" ? packFor(p.state).delivery.emailShort : METHOD_WORD[d.method]}</dd>
            <dt className="text-ink-3">To</dt><dd className="truncate" title={where ?? undefined}>{d.method === "mail" ? where : d.to ?? where}</dd>
            <dt className="text-ink-3">Date</dt><dd className="tabular-nums">{shortDate(d.date)}</dd>
            {p.recordedOn && <><dt className="text-ink-3">Recorded</dt><dd className="tabular-nums">{shortDate(p.recordedOn)}</dd></>}
          </dl>
        ) : (
          <p className="text-sm text-ink-3">{p.due ? `Due ${shortDate(p.due)}, with the refund` : "Due with the refund"}</p>
        )}
        <Button className="mt-4 w-full" onClick={() => setOpen(true)} disabled={p.waiting} title={p.waiting ? "Checking the deposit with PayPal" : undefined}>{d ? "Change" : "Record delivery"}</Button>
      </div>
      {open && !p.waiting && <DeliveryDrawer {...p} onClose={() => setOpen(false)} onSaved={() => { setOpen(false); router.refresh(); }} />}
    </Card>
  );
}

function DeliveryDrawer(p: Parameters<typeof DeliveryPanel>[0] & { onClose: () => void; onSaved: () => void }) {
  const rules = packFor(p.state).delivery;
  const methods = METHODS.filter(([k]) => k !== "email" || rules.emailRule !== "courtesy");
  const needsAgreement = rules.emailRule === "agreement";
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
  const mailHint = rules.mailHint(p.unitAddress, p.forwarding ? { name: p.forwarding.name, date: p.forwarding.date } : null);
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
      body: JSON.stringify({ method, date, to, address, email, by_agreement: method === "email" ? agreed || !needsAgreement : false }),
    }).catch(() => null);
    setBusy(false);
    if (!r?.ok) return setError((r && (await r.json().catch(() => ({}))).error) ?? "Couldn't record that.");
    p.onSaved();
  }

  return (
    <Drawer open onClose={p.onClose} title={p.existing ? "Change the delivery record" : "Record delivery"} sub="How the itemized statement went out">
      <div className="flex flex-col gap-5">
        <FormField group label="Method" hint={
          <InfoTip title={rules.tip.title} cite={rules.tip.cite}>{rules.tip.text}</InfoTip>}>
          <div className="inline-flex flex-wrap gap-0.5 rounded-md bg-surface-2 p-[3px]">
            {methods.map(([k, label]) => (
              <button key={k} type="button" onClick={() => setMethod(k)} aria-pressed={method === k} data-autofocus={method === k || undefined}
                className={`h-7 rounded-sm px-2.5 text-sm ${method === k ? "bg-canvas font-medium text-ink shadow-sm" : "text-ink-3 hover:text-ink"}`}>
                {label}
              </button>
            ))}
          </div>
        </FormField>

        {method === "mail" && (
          <Field label="Mailed to" hint={mailHint} cite={rules.addressedCite}>
            <input className={input} value={address} onChange={(e) => setAddress(e.target.value)} placeholder="Forwarding address" />
          </Field>
        )}
        {method === "email" && (
          <Field label="Emailed to">
            <input className={input} inputMode="email" value={email} onChange={(e) => setEmail(e.target.value)} placeholder="tenant@example.com" />
          </Field>
        )}
        <Field label="Addressed to" cite={rules.toCite}
          hint={p.tenants.length > 1 ? rules.multipleTo : undefined}>
          <select className={input} value={to} onChange={(e) => pickTenant(e.target.value)}>
            {p.tenants.map((t) => <option key={t.name}>{t.name}</option>)}
          </select>
        </Field>
        <Field label="Date delivered">
          <input type="date" className={input} value={date} max={p.today} onChange={(e) => setDate(e.target.value)} />
        </Field>

        {method === "email" && needsAgreement && (
          <label className="flex items-start gap-2 text-sm text-ink-2">
            <LineMark><input type="checkbox" className="size-[15px]" checked={agreed} onChange={(e) => setAgreed(e.target.checked)} /></LineMark>
            {to || "The tenant"} {rules.emailLabel}
          </label>
        )}
        {error && <Notice>{error}</Notice>}
      </div>
      <div className={drawerFooter}>
        <Button variant="primary" onClick={save} disabled={busy || (method === "email" && needsAgreement && !agreed)}>{busy ? "Saving..." : "Record delivery"}</Button>
        <Button onClick={p.onClose}>Cancel</Button>
      </div>
    </Drawer>
  );
}

function Field({ label, hint, cite, children }: { label: string; hint?: string; cite?: string; children: React.ReactNode }) {
  return <FormField label={label} hint={hint && <InfoTip title={label} cite={cite}>{hint}</InfoTip>}>{children}</FormField>;
}

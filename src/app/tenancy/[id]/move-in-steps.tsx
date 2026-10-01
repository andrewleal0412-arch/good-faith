"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { wasPaid } from "@/lib/invoice-status";

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

  const moveIn = p.photos.filter((x) => x.phase === "move_in");
  const rooms = [...new Set(moveIn.map((x) => x.room))];
  const paid = wasPaid(p.invoice?.status);

  return (
    <div className="mt-8 space-y-4">
      {error && <p className="rounded-xl bg-danger-soft px-4 py-3 text-[14px] text-danger">{error}</p>}

      <Step n={1} title="Lease checked" done>
        <p className="text-[14px] text-ink-2">
          {p.flagCounts.violations} violation{p.flagCounts.violations === 1 ? "" : "s"} and {p.flagCounts.warnings} warning
          {p.flagCounts.warnings === 1 ? "" : "s"} against Civil Code 1950.5. The agent won&apos;t collect more than the law allows.
        </p>
      </Step>

      <Step n={2} title="Tenant's refund agreement" done={!!p.agreement} cite="Civ. Code 1950.5(h)(1)(A), (h)(1)(C)">
        {p.agreement ? (
          <p className="text-[14px] text-ink-2">
            {p.agreement.signed_by.join(" and ")} agreed in writing that the deposit comes back by PayPal to{" "}
            <b className="text-ink">{p.agreement.paypal_email}</b>.
          </p>
        ) : (
          <div className="space-y-3">
            <p className="text-[14px] text-ink-2">
              Since 2026, a deposit paid electronically must come back electronically, and by PayPal only with the tenant&apos;s
              written agreement. With more than one adult, every one of them signs.
            </p>
            <input value={email} onChange={(e) => setEmail(e.target.value)} placeholder="Tenant's PayPal email"
              className="w-full rounded-xl border border-line bg-bg px-3 py-2 text-[14px] outline-none focus:border-accent" />
            <div className="flex flex-wrap gap-4">
              {p.tenants.map((t) => (
                <label key={t} className="flex items-center gap-2 text-[14px]">
                  <input type="checkbox" checked={signed.includes(t)}
                    onChange={(e) => setSigned(e.target.checked ? [...signed, t] : signed.filter((x) => x !== t))} />
                  {t} agrees
                </label>
              ))}
            </div>
            <Button busy={busy === "agree"} onClick={() => act("agree", `/api/tenancies/${p.tenancyId}/agreement`, {
              method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ paypalEmail: email, signers: signed }),
            })}>Record the agreement</Button>
          </div>
        )}
      </Step>

      <Step n={3} title="Deposit, collected through PayPal" done={paid} cite="Civ. Code 1950.5(c)">
        {p.invoice ? (
          <div className="space-y-2 text-[14px] text-ink-2">
            <p>
              Invoice <span className="font-mono text-[13px]">{p.invoice.id}</span> for <b className="text-ink">{usd(p.invoice.amount)}</b>:{" "}
              <span className={paid ? "font-semibold text-accent" : "font-semibold text-warn"}>{paid ? "Paid" : p.invoice.status.toLowerCase()}</span>
            </p>
            {!paid && p.invoice.payLink && (
              <p>
                Tenant&apos;s pay link: <a className="text-info underline" href={p.invoice.payLink} target="_blank" rel="noreferrer">open in PayPal</a>
                {" "}(sandbox). Refresh this page after paying.
              </p>
            )}
          </div>
        ) : p.lawful ? (
          <div className="space-y-3">
            {p.lawful.amount < p.lawful.charged ? (
              <p className="text-[14px] text-ink-2">
                The lease asks for <s>{usd(p.lawful.charged)}</s> at move-in. California caps security at {usd(p.lawful.cap)} here,
                so the agent will invoice <b className="text-ink">{usd(p.lawful.amount)}</b>.
              </p>
            ) : (
              <p className="text-[14px] text-ink-2">The agent will invoice the {usd(p.lawful.amount)} deposit through PayPal.</p>
            )}
            <Button disabled={!p.agreement} busy={busy === "invoice"}
              onClick={() => act("invoice", `/api/tenancies/${p.tenancyId}/deposit-invoice`, { method: "POST" })}>
              Send PayPal invoice for {usd(p.lawful.amount)}
            </Button>
            {!p.agreement && <p className="text-[12px] text-ink-3">Record the refund agreement first.</p>}
          </div>
        ) : (
          <p className="text-[14px] text-ink-2">Confirm the owner type and portfolio size so the agent knows the legal cap.</p>
        )}
      </Step>

      <Step n={4} title="Move-in photos" done={moveIn.length > 0} cite="Civ. Code 1950.5(g)(1) (AB 2801)">
        <p className="text-[14px] text-ink-2">Every room, before the tenant moves in. These are the evidence for anything charged at move-out.</p>
        <div className="mt-3 flex flex-wrap items-center gap-2">
          <select value={room} onChange={(e) => setRoom(e.target.value)}
            className="rounded-xl border border-line bg-bg px-3 py-2 text-[14px]">
            {["Living room", "Kitchen", "Bedroom 1", "Bedroom 2", "Bathroom", "Hallway"].map((r) => <option key={r}>{r}</option>)}
          </select>
          <label className="cursor-pointer rounded-xl bg-ink px-4 py-2 text-[14px] font-semibold text-white">
            {busy === "photos" ? "Uploading..." : "Add photos"}
            <input type="file" accept="image/*" multiple className="sr-only" onChange={(e) => {
              const files = e.target.files;
              if (!files?.length) return;
              const fd = new FormData();
              fd.append("phase", "move_in");
              fd.append("room", room);
              for (const f of Array.from(files)) fd.append("files", f);
              act("photos", `/api/tenancies/${p.tenancyId}/photos`, { method: "POST", body: fd });
            }} />
          </label>
        </div>
        {rooms.map((r) => (
          <div key={r} className="mt-4">
            <p className="text-[12px] font-semibold uppercase tracking-[0.1em] text-ink-3">{r}</p>
            <div className="mt-2 grid grid-cols-3 gap-2 sm:grid-cols-4">
              {moveIn.filter((x) => x.room === r).map((x) => x.url && (
                // eslint-disable-next-line @next/next/no-img-element
                <img key={x.id} src={x.url} alt={r} className="aspect-square w-full rounded-lg object-cover" />
              ))}
            </div>
          </div>
        ))}
      </Step>
    </div>
  );
}

function Step({ n, title, done, cite, children }: { n: number; title: string; done?: boolean; cite?: string; children: React.ReactNode }) {
  return (
    <section className="rounded-2xl bg-surface p-5 shadow-sm">
      <div className="flex items-center gap-3">
        <span className={`flex h-7 w-7 items-center justify-center rounded-full text-[13px] font-semibold ${done ? "bg-accent text-white" : "bg-bg text-ink-3"}`}>
          {done ? "✓" : n}
        </span>
        <h2 className="text-[16px] font-semibold">{title}</h2>
        {cite && <span className="ml-auto hidden text-[12px] text-ink-3 sm:block">{cite}</span>}
      </div>
      <div className="mt-3 pl-10">{children}</div>
    </section>
  );
}

function Button({ children, onClick, busy, disabled }: { children: React.ReactNode; onClick: () => void; busy?: boolean; disabled?: boolean }) {
  return (
    <button onClick={onClick} disabled={busy || disabled}
      className="rounded-xl bg-accent px-4 py-2 text-[14px] font-semibold text-white transition hover:opacity-90 disabled:opacity-40">
      {busy ? "Working..." : children}
    </button>
  );
}

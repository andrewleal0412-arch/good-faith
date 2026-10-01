"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { usd } from "@/lib/deductions";
import { DeductionForm } from "./deduction-form";

export type FindingView = {
  id?: string;
  room: string;
  item: string;
  observation: string;
  classification: "wear_and_tear" | "damage" | "cleaning" | "unclear";
  reason: string;
  remedy: string;
  severity: string;
  confidence: number;
  beforeUrl: string | null;
  afterUrl: string | null;
  deduction: { id: string; amount: number; math: string } | null;
};

const KIND = {
  damage: { label: "Damage", fg: "text-danger", bg: "bg-danger-soft", note: "May be deducted (repair cost, prorated by age)" },
  cleaning: { label: "Cleaning", fg: "text-warn", bg: "bg-warn-soft", note: "May be deducted, only back to move-in cleanliness" },
  wear_and_tear: { label: "Wear and tear", fg: "text-accent", bg: "bg-accent-soft", note: "Not chargeable under California law" },
  unclear: { label: "Unclear", fg: "text-ink-2", bg: "bg-bg", note: "Needs a better photo before anything is charged" },
} as const;

export function MoveOut(p: {
  tenancyId: string;
  rooms: string[];
  moveOutPhotos: { id: string; room: string; url: string | null }[];
  findings: FindingView[];
  inspectedAt: string | null;
}) {
  const router = useRouter();
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState("");
  const [room, setRoom] = useState(p.rooms[0] ?? "Living room");
  const [open, setOpen] = useState<string | null>(null);

  async function upload(files: FileList) {
    setBusy("photos");
    setError("");
    const fd = new FormData();
    fd.append("phase", "move_out_before");
    fd.append("room", room);
    for (const f of Array.from(files)) fd.append("files", f);
    const r = await fetch(`/api/tenancies/${p.tenancyId}/photos`, { method: "POST", body: fd });
    setBusy(null);
    if (!r.ok) setError((await r.json()).error ?? "Upload failed.");
    router.refresh();
  }

  async function removeDeduction(id: string) {
    setBusy(`remove-${id}`);
    await fetch(`/api/tenancies/${p.tenancyId}/deductions/${id}`, { method: "DELETE" });
    setBusy(null);
    router.refresh();
  }

  async function inspect() {
    if (p.findings.some((f) => f.deduction) &&
      !confirm("Comparing again replaces these findings. Your deductions stay in the list below but won't show on the new cards. Continue?")) return;
    setBusy("inspect");
    setError("");
    const r = await fetch(`/api/tenancies/${p.tenancyId}/inspect`, { method: "POST" });
    setBusy(null);
    if (!r.ok) setError((await r.json()).error ?? "Inspection failed.");
    router.refresh();
  }

  const counts = (["damage", "cleaning", "wear_and_tear", "unclear"] as const)
    .map((k) => [k, p.findings.filter((f) => f.classification === k).length] as const).filter(([, n]) => n);

  return (
    <section className="mt-10">
      <h2 className="text-[22px] font-semibold tracking-[-0.01em]">Move-out</h2>
      <p className="mt-1 text-[14px] text-ink-2">
        Photograph each room after the tenant leaves, before any cleaning or repair (Civ. Code 1950.5(g)(2)). The agent compares
        them with move-in, room by room.
      </p>
      {error && <p className="mt-3 rounded-xl bg-danger-soft px-4 py-3 text-[14px] text-danger">{error}</p>}

      <div className="mt-4 rounded-2xl bg-surface p-5 shadow-sm">
        <div className="flex flex-wrap items-center gap-2">
          <select value={room} onChange={(e) => setRoom(e.target.value)} className="rounded-xl border border-line bg-bg px-3 py-2 text-[14px]">
            {p.rooms.map((r) => <option key={r}>{r}</option>)}
          </select>
          <label className="cursor-pointer rounded-xl bg-ink px-4 py-2 text-[14px] font-semibold text-white">
            {busy === "photos" ? "Uploading..." : "Add move-out photos"}
            <input type="file" accept="image/*" multiple className="sr-only" onChange={(e) => e.target.files?.length && upload(e.target.files)} />
          </label>
          <button onClick={inspect} disabled={!p.moveOutPhotos.length || busy === "inspect"}
            className="ml-auto rounded-xl bg-accent px-4 py-2 text-[14px] font-semibold text-white disabled:opacity-40">
            {busy === "inspect" ? "Comparing every room..." : p.inspectedAt ? "Compare again" : "Compare with move-in"}
          </button>
        </div>
        <p className="mt-2 text-[12px] text-ink-3">
          {p.moveOutPhotos.length} move-out photo{p.moveOutPhotos.length === 1 ? "" : "s"} in{" "}
          {[...new Set(p.moveOutPhotos.map((x) => x.room))].join(", ") || "no rooms yet"}
        </p>
      </div>

      {p.findings.length > 0 && (
        <div className="mt-5">
          <p className="text-[13px] text-ink-3">{counts.map(([k, n]) => `${n} ${KIND[k].label.toLowerCase()}`).join("  ·  ")}</p>
          <ul className="mt-3 space-y-3">
            {p.findings.map((f, i) => {
              const k = KIND[f.classification];
              return (
                <li key={f.id ?? i} className="rounded-2xl bg-surface p-5 shadow-sm">
                  <div className="flex flex-wrap items-center gap-2">
                    <span className={`rounded-full px-2.5 py-0.5 text-[12px] font-semibold ${k.bg} ${k.fg}`}>{k.label}</span>
                    <span className="text-[12px] text-ink-3">{f.room} · {k.note}</span>
                    {f.confidence < 0.7 && <span className="text-[12px] text-warn">· low confidence, check the photo</span>}
                  </div>
                  <p className="mt-2 text-[16px] font-semibold">{f.item}</p>
                  <div className="mt-3 grid grid-cols-2 gap-2">
                    {[["Move-in", f.beforeUrl], ["Move-out", f.afterUrl]].map(([label, url]) => (
                      <figure key={label as string}>
                        {url && (
                          // eslint-disable-next-line @next/next/no-img-element
                          <img src={url as string} alt={`${f.item}, ${label}`} className="aspect-[4/3] w-full rounded-lg object-cover" />
                        )}
                        <figcaption className="mt-1 text-[11px] font-semibold uppercase tracking-[0.1em] text-ink-3">{label}</figcaption>
                      </figure>
                    ))}
                  </div>
                  <p className="mt-3 text-[14px] leading-relaxed text-ink-2">{f.observation}</p>
                  <p className="mt-1 text-[13px] leading-relaxed text-ink-3">{f.reason}</p>
                  {f.deduction ? (
                    <div className="mt-4 flex flex-wrap items-center gap-x-3 gap-y-1 rounded-xl bg-bg px-4 py-3">
                      <p className="text-[14px] font-semibold">Deducting {usd(f.deduction.amount)}</p>
                      <p className="text-[13px] text-ink-2">{f.deduction.math}</p>
                      <button onClick={() => removeDeduction(f.deduction!.id)} disabled={busy === `remove-${f.deduction.id}`}
                        className="ml-auto text-[13px] font-semibold text-danger disabled:opacity-40">Remove</button>
                    </div>
                  ) : f.classification === "wear_and_tear" ? null : f.id && open === f.id ? (
                    <DeductionForm tenancyId={p.tenancyId} finding={{ ...f, id: f.id }}
                      onCancel={() => setOpen(null)} onDone={() => { setOpen(null); router.refresh(); }} />
                  ) : f.id ? (
                    <button onClick={() => setOpen(f.id!)} className="mt-4 rounded-xl border border-line px-4 py-2 text-[14px] font-semibold">
                      {f.classification === "unclear" ? "Add a deduction anyway" : "Add a deduction"}
                    </button>
                  ) : null}
                </li>
              );
            })}
          </ul>
        </div>
      )}
    </section>
  );
}

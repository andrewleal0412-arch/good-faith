"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { Button, buttonClass } from "@/components/button";
import { Icon } from "@/components/icons";
import { InfoTip } from "@/components/info-tip";
import { Card, CardHead, Money, Notice, StatusChip, inlineInputClass, type Tone } from "@/components/ui";
import { pacificDate, shortDate } from "@/lib/dates";
import { uploadPhotos } from "@/lib/uploads";
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
  pair: string; // the room and its two photos: findings that share them share one card
  beforeUrl: string | null;
  afterUrl: string | null;
  deduction: { id: string; amount: number; math: string; note: string | null } | null;
};

/** The Why? tip carries the model's first sentence, not its whole paragraph; the card's title attribute keeps the rest. */
function gist(reason: string): string {
  const first = reason.match(/^.*?[.!?](?=\s|$)/)?.[0] ?? reason;
  return first.length > 160 ? `${first.slice(0, 157).replace(/\s+\S*$/, "")}...` : first;
}

const KIND: Record<FindingView["classification"], { label: string; tone: Tone; note: string }> = {
  damage: { label: "Damage", tone: "red", note: "May be deducted: the repair cost, prorated by age." },
  cleaning: { label: "Cleaning", tone: "amber", note: "May be deducted, only back to move-in cleanliness." },
  wear_and_tear: { label: "Wear and tear", tone: "gray", note: "Not chargeable under California law." },
  unclear: { label: "Unclear", tone: "gray", note: "Needs a better photo before anything is charged." },
};

export function MoveOut(p: {
  tenancyId: string;
  rooms: string[];
  moveOutPhotos: { id: string; room: string; url: string | null }[];
  findings: FindingView[];
  inspectedAt: string | null;
  locked: boolean; // the deposit has been returned, so the deductions are final
}) {
  const router = useRouter();
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState("");
  const [room, setRoom] = useState(p.rooms[0] ?? "Living room");
  const [open, setOpen] = useState<string | null>(null);

  // Photos are shrunk in the browser and sent in requests under the host's body limit (src/lib/uploads.ts). The input is
  // cleared first, so choosing the same files again after a failure fires a change event.
  async function upload(input: HTMLInputElement) {
    const files = Array.from(input.files ?? []);
    input.value = "";
    if (!files.length) return;
    setBusy("photos");
    setError("");
    const res = await uploadPhotos(`/api/tenancies/${p.tenancyId}/photos`, { phase: "move_out_before", room }, files);
    setBusy(null);
    if (!res.ok) setError(res.error);
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
  const outRooms = [...new Set(p.moveOutPhotos.map((x) => x.room))];
  const photoMeta = `${p.moveOutPhotos.length} photo${p.moveOutPhotos.length === 1 ? "" : "s"}${outRooms.length ? `, ${outRooms.length} room${outRooms.length === 1 ? "" : "s"}` : ""}`;

  // One card per room and photo pair, findings numbered in order down the page (the statement uses the same order).
  const groups: { key: string; room: string; before: string | null; after: string | null; items: { f: FindingView; n: number }[] }[] = [];
  p.findings.forEach((f, i) => {
    let g = groups.find((x) => x.key === f.pair);
    if (!g) groups.push(g = { key: f.pair, room: f.room, before: f.beforeUrl, after: f.afterUrl, items: [] });
    g.items.push({ f, n: i + 1 });
  });

  return (
    <div className="flex flex-col gap-4">
      <Card>
        <CardHead title="Move-out photos"
          meta={p.locked && p.inspectedAt ? `${photoMeta}, compared ${shortDate(pacificDate(p.inspectedAt))}` : photoMeta}
          right={<InfoTip align="end" title="Before any cleaning or repair" cite="Civ. Code 1950.5(g)(2)">
            Photograph each room after the tenants leave and before any work that will be deducted, then again after it.
          </InfoTip>} />
        {!p.locked && (
          <div className="flex flex-wrap items-center gap-2 px-5 py-4">
            <select value={room} onChange={(e) => setRoom(e.target.value)} aria-label="Room" className={`${inlineInputClass} pr-8`}>
              {p.rooms.map((r) => <option key={r}>{r}</option>)}
            </select>
            <label className={buttonClass("secondary", "md", "cursor-pointer")}>
              <Icon name="camera" />{busy === "photos" ? "Uploading..." : "Add photos"}
              <input type="file" accept="image/*" multiple className="sr-only" onChange={(e) => upload(e.currentTarget)} />
            </label>
            <Button variant={p.inspectedAt ? "secondary" : "primary"} className="sm:ml-auto" onClick={inspect} disabled={!p.moveOutPhotos.length || busy === "inspect"}>
              <Icon name="image" />{busy === "inspect" ? "Comparing every room..." : p.inspectedAt ? "Compare again" : "Compare with move-in"}
            </Button>
          </div>
        )}
        {error && <Notice className="mx-5 mb-4">{error}</Notice>}
      </Card>

      {groups.length > 0 && (
        <>
          <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
            <h2 className="text-lg font-medium">Photo comparison</h2>
            <span className="text-xs text-ink-3">{counts.map(([k, n]) => `${n} ${KIND[k].label.toLowerCase()}`).join(", ")}</span>
            <span className="ml-auto inline-flex items-center gap-1.5 text-xs text-ink-3">
              <Icon name="image" className="size-3.5 text-ink-4" />Suggested findings. Review before accepting.
            </span>
          </div>
          <ul className="flex flex-col gap-4">
            {groups.map((g) => {
              const chargeable = g.items.filter(({ f }) => f.classification !== "wear_and_tear").length;
              const accepted = g.items.filter(({ f }) => f.deduction).length;
              const unsure = g.items.some(({ f }) => f.confidence < 0.7);
              const formFor = g.items.find(({ f }) => f.id && open === f.id && !f.deduction)?.f;
              return (
                <li key={g.key}>
                  <Card>
                    <div className="flex flex-wrap items-center gap-x-2.5 gap-y-1 border-b border-line-2 px-4 py-2.5">
                      <h3 className="text-base font-medium">{g.room}</h3>
                      <span className="text-xs text-ink-3">{g.items.length} finding{g.items.length === 1 ? "" : "s"}</span>
                      {unsure && (
                        <span className="ml-auto inline-flex items-center gap-1 text-xs text-ink-3">
                          Check photo
                          <InfoTip align="end" title="Less certain">The comparison was less sure about this room. Look at both photos before accepting a deduction.</InfoTip>
                        </span>
                      )}
                    </div>
                    <div className="grid md:grid-cols-[minmax(0,1fr)_332px]">
                      <div className="grid grid-cols-2 content-start gap-2.5 p-3.5 md:border-r md:border-line-2">
                        {[["Move-in", g.before], ["Move-out", g.after]].map(([label, url]) => (
                          <figure key={label as string} className="relative aspect-[3/2] overflow-hidden rounded-md bg-surface-2">
                            {url && (
                              // eslint-disable-next-line @next/next/no-img-element
                              <img src={url as string} alt={`${g.room}, ${label}`} className="size-full object-cover" />
                            )}
                            <figcaption className="absolute left-2 top-2 rounded-[5px] bg-white/95 px-[7px] py-0.5 text-xs font-medium text-ink">{label}</figcaption>
                          </figure>
                        ))}
                      </div>
                      <div className="flex flex-col">
                        <div className="flex items-center gap-1.5 border-b border-line-2 px-4 py-2 text-xs text-ink-3 max-md:border-t">
                          <Icon name="image" className="size-3.5 text-ink-4" /><span className="font-medium text-ink-2">Suggested</span>
                          {chargeable > 0 && <span className="ml-auto">{accepted} of {chargeable} accepted</span>}
                        </div>
                        {g.items.map(({ f, n }) => {
                          const k = KIND[f.classification];
                          return (
                            <div key={f.id ?? n} className="border-b border-line-2 px-4 py-3 last:border-b-0">
                              <div className="flex items-start gap-3">
                                <span className="mt-px flex size-5 shrink-0 items-center justify-center rounded-full bg-surface-2 text-xs font-medium text-ink-2">{n}</span>
                                <div className="min-w-0 flex-1">
                                  <div className="text-sm font-medium">{f.item}</div>
                                  <StatusChip tone={k.tone} dot={false} size="sm" className="mt-1">{k.label}</StatusChip>
                                  <p className="mt-1 line-clamp-2 text-xs text-ink-3" title={`${f.observation}\n\n${f.reason}`}>{f.observation}</p>
                                  <InfoTip trigger="why" align="end" className="mt-0.5" title={k.label} cite="Civ. Code 1950.5(b)(2)-(3), (e)(2)(A)">
                                    {gist(f.reason)} {k.note}
                                  </InfoTip>
                                </div>
                                {f.deduction ? (
                                  <div className="shrink-0 text-right">
                                    <Money value={f.deduction.amount} className="block text-sm font-medium" />
                                    <div className="mt-1 inline-flex items-center gap-1 text-xs text-green"><Icon name="check" className="size-[11px]" />Accepted</div>
                                  </div>
                                ) : f.classification === "wear_and_tear" ? (
                                  <div className="shrink-0 text-right"><Money value={0} className="text-sm font-medium text-ink-3" /></div>
                                ) : null}
                              </div>

                              {f.deduction && (
                                <div className="ml-8 mt-2.5 rounded-md bg-surface px-3 py-2.5 text-xs text-ink-2">
                                  <div className="flex items-start gap-2">
                                    <span className="min-w-0 flex-1">{f.deduction.math}</span>
                                    {!p.locked && (
                                      <button onClick={() => removeDeduction(f.deduction!.id)} disabled={busy === `remove-${f.deduction.id}`}
                                        className="shrink-0 font-medium text-brand hover:underline disabled:opacity-50">Remove</button>
                                    )}
                                  </div>
                                  {/* The landlord's reason for the work, which the statement carries with the cost ((h)(2)(D)). */}
                                  {f.deduction.note && <div className="mt-1 text-ink-3">Why this work: {f.deduction.note}</div>}
                                </div>
                              )}

                              {!f.deduction && f.classification !== "wear_and_tear" && !p.locked && f.id && open !== f.id && (
                                <div className="ml-8 mt-1.5">
                                  <Button variant="link" onClick={() => setOpen(f.id!)}>
                                    <Icon name="plus" />{f.classification === "unclear" ? "Add a deduction anyway" : "Add deduction"}
                                  </Button>
                                </div>
                              )}
                            </div>
                          );
                        })}
                      </div>
                    </div>
                    {formFor && (
                      <div className="border-t border-line-2 p-4">
                        <p className="mb-3 text-sm font-medium">Deduction for {formFor.item.charAt(0).toLowerCase() + formFor.item.slice(1)}</p>
                        <DeductionForm tenancyId={p.tenancyId} finding={{ ...formFor, id: formFor.id! }}
                          onCancel={() => setOpen(null)} onDone={() => { setOpen(null); router.refresh(); }} />
                      </div>
                    )}
                  </Card>
                </li>
              );
            })}
          </ul>
        </>
      )}
    </div>
  );
}

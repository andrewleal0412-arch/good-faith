"use client";

import { useRouter } from "next/navigation";
import { useState, type Ref } from "react";
import { Button, buttonClass, pickerFocus } from "@/components/button";
import { ConfirmDialog } from "@/components/confirm";
import { Drawer, drawerFooter } from "@/components/drawer";
import { Icon } from "@/components/icons";
import { InfoTip } from "@/components/info-tip";
import { Menu } from "@/components/menu";
import { PresenceList } from "@/components/motion";
import { FilePick } from "@/components/file-pick";
import { Card, CardHead, LineMark, Money, Notice, StatusChip, Thumb, inlineInputClass } from "@/components/ui";
import type { Box } from "@/lib/boxes";
import { basisOf, type StoredDeduction } from "@/lib/deductions";
import { findingLine, findingTitle, gist, kindsFor, type Classification, type FindingStatus } from "@/lib/findings";
import { packFor } from "@/lib/states";
import type { ClientPack } from "@/lib/states/types";
import { uploadPhotos } from "@/lib/uploads";
import { DeductionForm } from "./deduction-form";
import { FindingForm } from "./finding-form";
import { MoveOutDate } from "./move-out-date";
import { BADGE, PhotoCompare, type CompareMode, type Marker } from "./photo-compare";

export type FindingView = {
  id?: string;
  n: number; // the number down the page, on the photo marker and in the Deductions table
  pair: string; // the room and its two photos: findings that share them share one card
  room: string;
  item: string;
  label: string | null;
  summary: string | null;
  observation: string;
  classification: Classification;
  reason: string;
  remedy: string;
  severity: string;
  confidence: number;
  source: "inspection" | "landlord";
  status: FindingStatus | null;
  box: Box | null;
  moveInBox: Box | null;
  beforeUrl: string | null;
  afterUrl: string | null;
  beforeDate: string | null;
  afterDate: string | null;
  deduction: (Pick<StoredDeduction, "id" | "amount" | "math" | "proration" | "performer" | "work" | "category"> & { note: string | null }) | null;
};

/** A room that was compared and showed no change: its photos, with room to add a finding by hand. */
export type QuietRoom = { room: string; beforeUrl: string | null; afterUrl: string | null; beforeDate: string | null; afterDate: string | null };

type DrawerState = { kind: "deduction"; f: FindingView & { id: string } } | { kind: "finding"; room: string; like: string | null } | { kind: "photos" } | { kind: "compare" };

const LEGEND: [Classification, string][] = [["damage", "border-red-dot"], ["cleaning", "border-amber-dot"], ["wear_and_tear", "border-dashed border-ink-4"]];

// The move-out photos and what the comparison found. Before the comparison: the photos by room, the move-out date and
// the Compare button. After it: Mercury-calm room cards (Zillow's slider, Lime's numbered damage report), each with
// the photos, numbered boxes over the move-out photo, and the suggested findings beside them, each accepted by making
// its deduction (or, for wear and tear, by agreeing it isn't charged). Forms open in a side drawer.
export function MoveOut(p: {
  tenancyId: string;
  state: string; // the state whose pack the tips and the classifications follow
  rooms: string[];
  moveOutPhotos: { id: string; room: string; url: string | null }[];
  findings: FindingView[];
  quietRooms: QuietRoom[];
  inspectedAt: string | null;
  moveOutDate: string | null;
  locked: boolean; // the deposit has been returned, so the findings and deductions are final
  quiet?: boolean; // the record header holds the view's primary button, so Compare shows as secondary
  reads?: boolean; // a TypeSafe key is set: the Add finding form reads the words as they are typed (src/lib/jev.ts)
}) {
  const router = useRouter();
  const pack = packFor(p.state);
  const KIND = kindsFor(pack);
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState("");
  const [drawer, setDrawer] = useState<DrawerState | null>(null);
  const [room, setRoom] = useState(p.rooms[0] ?? "Living room");
  const [files, setFiles] = useState<File[]>([]);

  // Photos are shrunk in the browser and sent in requests under the host's body limit (src/lib/uploads.ts).
  async function upload(list: File[], afterDone?: () => void) {
    if (!list.length) return;
    setBusy("photos");
    setError("");
    const res = await uploadPhotos(`/api/tenancies/${p.tenancyId}/photos`, { phase: "move_out_before", room }, list);
    setBusy(null);
    if (!res.ok) setError(res.error);
    else afterDone?.();
    router.refresh();
  }

  // Comparing again replaces the suggested findings; once a deduction exists, a dialog asks first.
  async function inspect(confirmed = false) {
    if (!confirmed && p.findings.some((f) => f.deduction)) return setDrawer({ kind: "compare" });
    setDrawer(null);
    setBusy("inspect");
    setError("");
    const r = await fetch(`/api/tenancies/${p.tenancyId}/inspect`, { method: "POST" });
    setBusy(null);
    if (!r.ok) setError((await r.json().catch(() => ({}))).error ?? "The comparison didn't finish. Try again.");
    router.refresh();
  }

  async function act(key: string, url: string, init: RequestInit) {
    setBusy(key);
    setError("");
    const r = await fetch(url, init);
    setBusy(null);
    if (!r.ok) setError((await r.json().catch(() => ({}))).error ?? "Couldn't save. Try again.");
    router.refresh();
  }
  const review = (f: FindingView, status: FindingStatus | null) => act(`review-${f.id}`, `/api/tenancies/${p.tenancyId}/findings/${f.id}`, {
    method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ status }),
  });
  const remove = (f: FindingView) => act(`review-${f.id}`, `/api/tenancies/${p.tenancyId}/findings/${f.id}`, { method: "DELETE" });

  const outRooms = [...new Set(p.moveOutPhotos.map((x) => x.room))];
  const photoMeta = `${p.moveOutPhotos.length} photo${p.moveOutPhotos.length === 1 ? "" : "s"}${outRooms.length ? `, ${outRooms.length} room${outRooms.length === 1 ? "" : "s"}` : ""}`;

  // One card per room and photo pair, in page order (the findings arrive numbered down the page).
  const groups: { key: string; room: string; before: { url: string | null; date: string | null }; after: { url: string | null; date: string | null }; items: FindingView[] }[] = [];
  for (const f of p.findings) {
    let g = groups.find((x) => x.key === f.pair);
    if (!g) groups.push(g = { key: f.pair, room: f.room, before: { url: f.beforeUrl, date: f.beforeDate }, after: { url: f.afterUrl, date: f.afterDate }, items: [] });
    g.items.push(f);
  }
  const compared = groups.length + p.quietRooms.length;

  const roomPicker = (
    <select value={room} onChange={(e) => setRoom(e.target.value)} aria-label="Room" className={`${inlineInputClass} pr-8`}>
      {p.rooms.map((r) => <option key={r}>{r}</option>)}
    </select>
  );

  const drawers = (
    <>
      <Drawer open={drawer?.kind === "deduction"} onClose={() => setDrawer(null)} title="Add deduction"
        sub={drawer?.kind === "deduction" ? `${drawer.f.n}. ${findingTitle(drawer.f)}, ${drawer.f.room}` : undefined}>
        {drawer?.kind === "deduction" && (
          <DeductionForm tenancyId={p.tenancyId} state={pack.code} finding={drawer.f}
            onCancel={() => setDrawer(null)} onDone={() => { setDrawer(null); router.refresh(); }} />
        )}
      </Drawer>
      <Drawer open={drawer?.kind === "finding"} onClose={() => setDrawer(null)} title="Add finding" sub={drawer?.kind === "finding" ? drawer.room : undefined}>
        {drawer?.kind === "finding" && (
          <FindingForm tenancyId={p.tenancyId} state={pack.code} room={drawer.room} like={drawer.like} reads={p.reads}
            onCancel={() => setDrawer(null)} onDone={() => { setDrawer(null); router.refresh(); }} />
        )}
      </Drawer>
      <Drawer open={drawer?.kind === "photos"} onClose={() => setDrawer(null)} title="Add move-out photos" sub="Compare again afterwards to include them">
        <div className="space-y-4">
          <div>
            <p className="mb-1.5 text-sm font-medium">Room</p>
            {roomPicker}
          </div>
          <div>
            <p className="mb-1.5 text-sm font-medium">Photos</p>
            <FilePick label="Choose photos" icon="camera" accept="image/*" multiple ariaLabel="Move-out photos" files={files} onChange={setFiles} />
          </div>
          {error && <Notice>{error}</Notice>}
          <div className={drawerFooter}>
            <Button variant="primary" disabled={!files.length || busy === "photos"}
              onClick={() => upload(files, () => { setFiles([]); setDrawer(null); })}>
              {busy === "photos" ? "Uploading..." : "Upload"}
            </Button>
            <Button onClick={() => setDrawer(null)}>Cancel</Button>
          </div>
        </div>
      </Drawer>
      <ConfirmDialog open={drawer?.kind === "compare"} title="Compare again?" body="Suggested findings are replaced. Your deductions stay."
        action="Compare again" onConfirm={() => inspect(true)} onCancel={() => setDrawer(null)} />
    </>
  );

  // Before the comparison: the photos by room, the move-out date, and the button that compares them.
  if (!compared) {
    return (
      <>
        <Card>
          <CardHead title="Move-out photos" meta={photoMeta}
            right={<InfoTip align="end" title={pack.moveOut.photosTip.title} cite={pack.moveOut.photosTip.cite}>{pack.moveOut.photosTip.text}</InfoTip>} />
          {!p.locked && !p.moveOutDate && (
            <div className="flex flex-wrap items-center gap-x-3 gap-y-2 border-b border-line-2 px-5 py-3 text-sm">
              <span className="text-ink-3">Moved out</span>
              <MoveOutDate tenancyId={p.tenancyId} value={null} locked={false} />
              <InfoTip align="end" title={pack.deadline.clockWord.replace(/^the /, "The ")} cite={pack.deadline.tip.cite}>{pack.deadline.tip.text}</InfoTip>
            </div>
          )}
          {outRooms.length > 0 && (
            <div className="flex flex-wrap gap-x-6 gap-y-3 border-b border-line-2 px-5 py-4">
              {outRooms.map((r) => (
                <div key={r}>
                  <p className="mb-1.5 text-xs text-ink-3">{r}</p>
                  <div className="flex gap-1.5">
                    {p.moveOutPhotos.filter((x) => x.room === r).slice(0, 4).map((x) => <Thumb key={x.id} src={x.url} size={56} className="rounded-sm" />)}
                  </div>
                </div>
              ))}
            </div>
          )}
          {!p.locked && (
            <div className="flex flex-wrap items-center gap-2 px-5 py-4">
              {roomPicker}
              <label className={buttonClass("secondary", "md", pickerFocus)}>
                <Icon name="camera" />{busy === "photos" ? "Uploading..." : "Add photos"}
                <input type="file" accept="image/*" multiple className="sr-only" onChange={(e) => { const l = Array.from(e.currentTarget.files ?? []); e.currentTarget.value = ""; upload(l); }} />
              </label>
              {/* With no move-out photo yet there is nothing to compare, so the row says what it needs first. */}
              <div className="flex flex-wrap items-center gap-2 sm:ml-auto">
                {!p.moveOutPhotos.length && <span className="text-sm text-ink-3">Add move-out photos first.</span>}
                <Button variant={p.quiet ? "secondary" : "primary"} onClick={() => inspect()} disabled={!p.moveOutPhotos.length || busy === "inspect"}>
                  <Icon name="image" />{busy === "inspect" ? "Comparing every room..." : p.inspectedAt ? "Compare again" : "Compare with move-in"}
                </Button>
              </div>
            </div>
          )}
          {error && <Notice className="mx-5 mb-4">{error}</Notice>}
        </Card>
        {drawers}
      </>
    );
  }

  const kinds = new Set(p.findings.filter((f) => f.status !== "dismissed").map((f) => f.classification));
  return (
    <>
      <div className="mb-3 flex flex-wrap items-center gap-x-3 gap-y-2">
        <h2 className="text-lg font-medium">Photo comparison</h2>
        <span className="text-xs text-ink-3">{compared} room{compared === 1 ? "" : "s"}</span>
        <div className="flex flex-wrap items-center gap-x-3.5 gap-y-1 text-xs text-ink-3 sm:ml-auto">
          {!p.locked && <span className="max-lg:hidden">Suggested findings. Review before accepting.</span>}
          {!p.locked && <span aria-hidden className="text-line max-lg:hidden">|</span>}
          {LEGEND.map(([k, cls]) => (
            <span key={k} className="inline-flex items-center gap-1.5"><i className={`size-2.5 rounded-[3px] border-[1.5px] ${cls}`} />{KIND[k].label}</span>
          ))}
          {kinds.has("unclear") && <span className="inline-flex items-center gap-1.5"><i className="size-2.5 rounded-[3px] border-[1.5px] border-dashed border-ink-3" />Unclear</span>}
          {!p.locked && (
            <Menu label="Photo actions" width={200} items={[
              { label: "Add photos", icon: "camera", onSelect: () => setDrawer({ kind: "photos" }) },
              { label: busy === "inspect" ? "Comparing..." : "Compare again", icon: "image", disabled: busy === "inspect", onSelect: () => inspect() },
            ]} />
          )}
        </div>
      </div>
      {/* The comparison can run before the move-out date is in; the date starts the state's clock, so it is asked for
          here until it is recorded (the "Record move-out" step links to this section). */}
      {!p.moveOutDate && !p.locked && (
        <div className="mb-3 flex flex-wrap items-center gap-x-3 gap-y-2 rounded-lg border border-line bg-canvas px-4 py-3 text-sm">
          <span className="size-2 shrink-0 rounded-full bg-amber-dot" aria-hidden />
          <span className="font-medium">Moved out</span>
          <MoveOutDate tenancyId={p.tenancyId} value={null} locked={false} />
          <span className="text-xs text-ink-3">Starts {pack.deadline.clockWord}</span>
        </div>
      )}
      {busy === "inspect" && <Notice tone="gray" className="mb-3">Comparing every room. This takes about half a minute.</Notice>}
      {error && !drawer && <Notice className="mb-3">{error}</Notice>}

      <div className="flex flex-col gap-4">
        {groups.map((g) => (
          <RoomCard key={g.key} pack={pack} room={g.room} before={g.before} after={g.after} items={g.items} locked={p.locked} busy={busy}
            trace={p.inspectedAt ? `trace:${p.tenancyId}:${p.inspectedAt}:${g.key}` : null}
            onDeduct={(f) => f.id && setDrawer({ kind: "deduction", f: { ...f, id: f.id } })}
            onReview={review} onRemove={remove}
            onAddFinding={() => setDrawer({ kind: "finding", room: g.room, like: g.items.find((f) => f.id)?.id ?? null })} />
        ))}
        {p.quietRooms.map((q) => (
          <RoomCard key={`quiet-${q.room}`} pack={pack} room={q.room} before={{ url: q.beforeUrl, date: q.beforeDate }} after={{ url: q.afterUrl, date: q.afterDate }}
            items={[]} locked={p.locked} busy={busy} onDeduct={() => {}} onReview={review} onRemove={remove}
            onAddFinding={() => setDrawer({ kind: "finding", room: q.room, like: null })} />
        ))}
      </div>
      {drawers}
    </>
  );
}

function RoomCard({ pack, room, before, after, items, locked, busy, trace, onDeduct, onReview, onRemove, onAddFinding }: {
  pack: ClientPack;
  trace?: string | null; // this comparison of this pair: its boxes are traced in the first time this viewer sees them
  room: string;
  before: { url: string | null; date: string | null };
  after: { url: string | null; date: string | null };
  items: FindingView[];
  locked: boolean;
  busy: string | null;
  onDeduct: (f: FindingView) => void;
  onReview: (f: FindingView, status: FindingStatus | null) => void;
  onRemove: (f: FindingView) => void;
  onAddFinding: () => void;
}) {
  const [mode, setMode] = useState<CompareMode>("side");
  const [hot, setHot] = useState<string | null>(null);
  const active = items.filter((f) => f.status !== "dismissed");
  const accepted = active.filter((f) => f.deduction || f.status === "accepted").length;
  const charged = active.filter((f) => f.deduction).length;
  const unsure = !locked && active.some((f) => f.source !== "landlord" && f.confidence < 0.7);
  const markers: Marker[] = active.map((f) => ({ id: f.id ?? String(f.n), n: f.n, kind: f.classification, label: findingTitle(f), box: f.box, moveInBox: f.moveInBox }));

  return (
    <section className="@container rounded-lg border border-line bg-canvas shadow-sm" aria-label={room}>
      <div className="flex flex-wrap items-center gap-x-2.5 gap-y-1.5 border-b border-line-2 px-4 py-2.5">
        <h3 className="text-base font-medium">{room}</h3>
        <span className="text-xs text-ink-3">{items.length ? `${items.length} finding${items.length === 1 ? "" : "s"}` : "No changes found"}</span>
        {unsure && (
          <InfoTip trigger={<span className="text-xs text-ink-3 underline decoration-dotted underline-offset-2 hover:text-ink">Less certain</span>}>
            The comparison was less sure about this room. Look at both photos before accepting a deduction.
          </InfoTip>
        )}
        <div role="group" aria-label="Photo view" className="ml-auto inline-flex gap-0.5 rounded-sm bg-surface-2 p-[3px]">
          {([["side", "Side by side"], ["slider", "Slider"]] as const).map(([k, label]) => (
            <button key={k} type="button" aria-pressed={mode === k} onClick={() => setMode(k)}
              className={`h-6 rounded-xs px-2 text-xs transition-[color,background-color,box-shadow] ${mode === k ? "bg-canvas font-medium text-ink shadow-sm" : "text-ink-3 hover:text-ink"}`}>
              {label}
            </button>
          ))}
        </div>
      </div>
      {/* Photos and findings side by side once the card is wide enough for both (a container query: the sidebar
          takes 232px, so the viewport alone can't say); stacked below that. */}
      <div className="grid @3xl:grid-cols-[minmax(0,1fr)_332px]">
        <div className="min-w-0 p-3 sm:p-3.5 @3xl:border-r @3xl:border-line-2">
          <PhotoCompare room={room} before={before} after={after} markers={markers} mode={mode} hot={hot} onHot={setHot} trace={trace} />
        </div>
        <div className="flex flex-col @max-3xl:border-t @max-3xl:border-line-2">
          <div className="flex items-center gap-1.5 px-4 pb-1.5 pt-3 text-xs">
            <Icon name="image" className="size-3.5 text-ink-4" /><span className="font-medium text-ink-3">Suggested</span>
            {active.length > 0 && <span className="ml-auto text-ink-3">{locked ? `${charged} of ${active.length} charged` : `${accepted} of ${active.length} accepted`}</span>}
          </div>
          {/* A finding added or removed while the room is seen opens or closes in place. */}
          {items.length ? <PresenceList>{items.map((f) => (
            <FindingRow key={f.id ?? f.n} pack={pack} f={f} locked={locked} busy={busy === `review-${f.id}`} hot={hot === (f.id ?? String(f.n))}
              onHot={(on) => setHot(on ? f.id ?? String(f.n) : null)}
              onDeduct={() => onDeduct(f)} onReview={(s) => onReview(f, s)} onRemove={() => onRemove(f)} />
          ))}</PresenceList> : (
            <p className="px-4 pb-3 pt-1 text-xs text-ink-3">Nothing changed between the move-in and move-out photos.</p>
          )}
          {!locked && (
            <div className="mt-auto border-t border-line-2 px-4 pb-3 pt-2.5">
              <Button variant="link" size="sm" onClick={onAddFinding}><Icon name="plus" />Add finding</Button>
            </div>
          )}
        </div>
      </div>
    </section>
  );
}

/** One finding, as the mockup's rows read: its number in the box color, the title, the classification chip and one
 *  line of what changed with "Why?" at its end; on the right, the amount and its state, or until it is reviewed the one
 *  action that accepts it (a deduction, or for wear and tear agreeing it isn't charged) over a quiet Dismiss. */
function FindingRow({ pack, f, locked, busy, hot, onHot, onDeduct, onReview, onRemove, ref }: {
  pack: ClientPack; f: FindingView; locked: boolean; busy: boolean; hot: boolean; onHot: (on: boolean) => void;
  onDeduct: () => void; onReview: (s: FindingStatus | null) => void; onRemove: () => void; ref?: Ref<HTMLDivElement>;
}) {
  const k = kindsFor(pack)[f.classification];
  const dismissed = f.status === "dismissed";
  const wear = f.classification === "wear_and_tear";
  const open = !locked && !f.deduction && !f.status && !!f.id;
  const why = f.deduction ? (() => {
    const b = basisOf(f.deduction);
    return (
      <InfoTip trigger="why" title={b.title} cite={f.deduction.proration !== "none" ? `${k.cite}; ${pack.copy.guidanceCite}` : k.cite}>
        {f.deduction.math}.{f.deduction.note ? ` ${f.deduction.note}` : ""}
      </InfoTip>
    );
  })() : (
    <InfoTip trigger="why" title={k.rule} cite={k.cite}>
      {f.source === "landlord" ? "Added by you." : gist(f.reason)} {k.note}
    </InfoTip>
  );
  const quiet = "text-xs text-ink-3 hover:text-ink disabled:opacity-50";
  const line = f.source === "landlord"
    ? (f.observation === "Added by the landlord." ? "Added by you." : `Added by you. ${findingLine(f)}`)
    : findingLine(f);

  return (
    <div ref={ref} onMouseEnter={() => onHot(true)} onMouseLeave={() => onHot(false)} onFocus={() => onHot(true)} onBlur={() => onHot(false)}
      className={`flex gap-2.5 border-t border-line-2 px-4 pb-3 pt-2.5 transition-colors [&:nth-child(2)]:border-t-0 ${hot ? "bg-surface" : ""}`}>
      <LineMark className="text-sm">
        <span className={`flex size-5 shrink-0 items-center justify-center rounded-[5px] text-xs font-semibold ${dismissed ? "bg-surface-3 text-ink-3" : `${BADGE[f.classification]} text-white`}`}>{f.n}</span>
      </LineMark>
      <div className={`min-w-0 flex-1 ${dismissed ? "opacity-60" : ""}`}>
        <div className="text-sm font-medium" title={f.item}>{findingTitle(f)}</div>
        <StatusChip tone={k.tone} dot={false} size="sm" className="mt-1">{k.label}</StatusChip>
        <p className="mt-[5px] text-xs text-ink-3">
          <span title={`${f.observation}\n\n${f.reason}`}>{line}</span> {why}
        </p>
        {!locked && f.status && (
          <button type="button" className={`mt-1 ${quiet}`} disabled={busy} onClick={() => onReview(null)}>Undo</button>
        )}
      </div>
      <div className="flex min-w-16 shrink-0 flex-col items-end text-right">
        {open ? (
          <>
            {wear
              ? <Button size="sm" disabled={busy} onClick={() => onReview("accepted")}>Accept</Button>
              : <Button size="sm" disabled={busy} onClick={onDeduct}>Add deduction</Button>}
            {f.source === "landlord"
              ? <button type="button" className={`mt-1.5 ${quiet}`} disabled={busy} onClick={onRemove}>Remove</button>
              : <button type="button" className={`mt-1.5 ${quiet}`} disabled={busy} onClick={() => onReview("dismissed")}>Dismiss</button>}
          </>
        ) : (
          <>
            {(f.deduction || wear || locked || f.status) && (
              <Money value={f.deduction ? f.deduction.amount : 0} className={`block text-sm font-medium ${f.deduction ? "" : "text-ink-3"}`} />
            )}
            {f.deduction || f.status === "accepted" ? (
              <div className="mt-1 inline-flex items-center gap-[3px] text-xs text-green"><Icon name="check" className="size-[11px]" />Accepted</div>
            ) : dismissed ? (
              <div className="mt-1 text-xs text-ink-3">Dismissed</div>
            ) : locked ? (
              <div className="mt-1 text-xs text-ink-3">Not charged</div>
            ) : null}
          </>
        )}
      </div>
    </div>
  );
}

"use client";

import { useEffect, useRef, useState } from "react";
import { Button } from "@/components/button";
import { drawerFooter } from "@/components/drawer";
import { FormField } from "@/components/field";
import { InfoTip } from "@/components/info-tip";
import { Notice, inputClass, textareaClass } from "@/components/ui";
import { kindsFor, type Classification } from "@/lib/findings";
import type { FindingRead } from "@/lib/jev";
import { packFor } from "@/lib/states";

// A finding the comparison missed, added by the landlord for one room's photos. It is recorded as theirs; a deduction
// can then be made from it like any other, except wear and tear, which is recorded and never charged.
//
// With `reads` (a TypeSafe key on the server), the words are read as they are typed: about 400 ms after the last
// keystroke, Jev reads what changed and what the photo shows as damage, cleaning or wear and tear under the state's
// rules (POST findings/classify, src/lib/jev.ts), and a quiet chip under Type says what it read and how likely. A read
// counts only for the words it was made for: once they change, it is set aside until the next one comes. It picks
// the Type only when the read is sure and the landlord hasn't picked one; the landlord's pick always stands. With
// reads on there is no default Type: until the landlord picks one or a sure read does, saving asks for it, so a Type
// never changes on its own to one nobody chose. A slow or failed read shows nothing and never holds up typing. Without
// reads the form is as it always was, with Damage picked to start.

const KINDS: Classification[] = ["damage", "cleaning", "wear_and_tear"];
const WAIT_MS = 400;
const GIVE_UP_MS = 2500; // the server gives Jev 1.5 s; this covers the round trip around it

type Read = Pick<FindingRead, "kind" | "p" | "preselect" | "existedAtMoveIn" | "there" | "cite"> & { seal?: string };

const pct = (p: number) => `${Math.round(p * 100)}%`;
const enough = (item: string, observation: string) => `${item} ${observation}`.replace(/[^\p{L}]/gu, "").length >= 4;
/** The words a read is for, as both routes trim them. */
const wordsKey = (item: string, observation: string) => JSON.stringify([item.trim(), observation.trim()]);

export function FindingForm({ tenancyId, state, room, like, reads = false, onDone, onCancel }: {
  tenancyId: string; state: string; room: string; like: string | null; reads?: boolean; onDone: () => void; onCancel: () => void;
}) {
  const pack = packFor(state);
  const KIND = kindsFor(pack);
  const [item, setItem] = useState("");
  const [picked, setPicked] = useState<Classification | null>(null);
  const [observation, setObservation] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  // The latest read, with the words it was made for.
  const [read, setRead] = useState<{ key: string; read: Read | null } | null>(null);
  const asked = useRef(0);
  const it = item.trim(), ob = observation.trim();
  const key = wordsKey(it, ob);

  // The read follows the words: each change waits WAIT_MS, then asks; a newer change cancels the older request, and
  // only the latest answer counts. Words that only gained a space at an end ask nothing new.
  useEffect(() => {
    if (!reads || !enough(it, ob)) return;
    const n = ++asked.current;
    const ctrl = new AbortController();
    const wait = setTimeout(async () => {
      const giveUp = setTimeout(() => ctrl.abort(), GIVE_UP_MS);
      try {
        const r = await fetch(`/api/tenancies/${tenancyId}/findings/classify`, {
          method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ item: it, observation: ob }), signal: ctrl.signal,
        });
        const j = r.ok ? ((await r.json().catch(() => null)) as { read?: Read | null } | null) : null;
        if (n === asked.current) setRead({ key: wordsKey(it, ob), read: j?.read ?? null });
      } catch {
        if (n === asked.current) setRead(null);
      } finally {
        clearTimeout(giveUp);
      }
    }, WAIT_MS);
    return () => { clearTimeout(wait); ctrl.abort(); };
  }, [reads, tenancyId, it, ob]);

  // A read only for the words as they are now.
  const shown = reads && enough(it, ob) && read?.key === key ? read.read : null;
  const kind: Classification | null = picked ?? shown?.preselect ?? (reads ? null : "damage");

  async function save() {
    if (!kind) return setError("Pick the type: damage, cleaning or wear and tear.");
    setBusy(true);
    setError("");
    const r = await fetch(`/api/tenancies/${tenancyId}/findings`, {
      method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ room, like, item, classification: kind, observation, read: shown ? { kind: shown.kind, p: shown.p, seal: shown.seal } : null }),
    });
    setBusy(false);
    if (!r.ok) return setError((await r.json().catch(() => ({}))).error ?? "Couldn't save it.");
    onDone();
  }

  const label = shown ? KIND[shown.kind].label.toLowerCase() : "";
  // The citation's parts never break inside ("1950.5(b)" then "(2)" on the next line).
  const cite = shown?.cite.split(/,\s+/).map((part, i, all) => (
    <span key={i} className="whitespace-nowrap">{part}{i < all.length - 1 ? ", " : ""}</span>
  ));
  // "Pick the type" only while nothing is picked.
  const ask = picked ? "" : "Pick the type. ";
  const chip = !shown ? null
    : shown.preselect ? <>Reads as {label}, {pct(shown.p)}, under {cite}</>
      : shown.kind === "unclear" ? `${ask}The words don't say enough to tell`
        : `${ask}Closest read: ${label}, ${pct(shown.p)}`;

  return (
    <form className="space-y-4" onSubmit={(e) => { e.preventDefault(); if (item.trim() && !busy) save(); }}>
      <FormField label="What changed">
        <input className={inputClass} value={item} maxLength={120} placeholder="Closet door, broken track" onChange={(e) => setItem(e.target.value)} data-autofocus />
      </FormField>
      <FormField label="Type" group hint={kind ? <InfoTip title={KIND[kind].rule} cite={KIND[kind].cite}>{KIND[kind].note}</InfoTip> : undefined}>
        <div className="inline-flex flex-wrap gap-0.5 rounded-md bg-surface-2 p-[3px]">
          {KINDS.map((k) => (
            <button key={k} type="button" aria-pressed={kind === k} onClick={() => { setPicked(k); setError(""); }}
              className={`h-7 rounded-sm px-2.5 text-sm ${kind === k ? "bg-canvas font-medium text-ink shadow-sm" : "text-ink-3 hover:text-ink"}`}>
              {KIND[k].label}
            </button>
          ))}
        </div>
        {reads && (
          <div aria-live="polite" className="mt-2 flex min-h-5 items-start gap-1.5">
            {chip && (
              <>
                <div className="flex min-w-0 flex-wrap gap-1">
                  <span data-testid="finding-read" className="rounded-sm bg-surface-2 px-1.5 py-0.5 text-xs text-ink-2">{chip}</span>
                  {shown?.there && shown.existedAtMoveIn != null && (
                    <span className="rounded-sm bg-surface-2 px-1.5 py-0.5 text-xs text-ink-2">Reads as there at move-in, {pct(shown.existedAtMoveIn)}</span>
                  )}
                </div>
                <InfoTip title="A quick read of your words" label="About this read" className="mt-0.5 shrink-0">
                  As you type, a fast model (TypeSafe&apos;s Jev) reads what you wrote against {pack.name}&apos;s rules and gives the closest type with how likely it is. It picks the Type only when it is sure, and your pick always stands. Only these words and the state&apos;s rules are sent, with names and addresses taken out.
                </InfoTip>
              </>
            )}
          </div>
        )}
      </FormField>
      <FormField label="What the move-out photo shows (optional)">
        <textarea className={textareaClass} rows={3} maxLength={600} placeholder="The track is bent and the door no longer slides; it worked at move-in."
          value={observation} onChange={(e) => setObservation(e.target.value)} />
      </FormField>
      {error && <Notice>{error}</Notice>}
      <div className={drawerFooter}>
        <Button type="submit" variant="primary" disabled={busy || !item.trim()}>{busy ? "Saving..." : "Add finding"}</Button>
        <Button onClick={onCancel}>Cancel</Button>
      </div>
    </form>
  );
}

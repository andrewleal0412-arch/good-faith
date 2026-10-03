"use client";

import { useState } from "react";
import { Button } from "@/components/button";
import { drawerFooter } from "@/components/drawer";
import { FormField } from "@/components/field";
import { InfoTip } from "@/components/info-tip";
import { Notice, inputClass, textareaClass } from "@/components/ui";
import { kindsFor, type Classification } from "@/lib/findings";
import { packFor } from "@/lib/states";

// A finding the comparison missed, added by the landlord for one room's photos. It is recorded as theirs; a deduction
// can then be made from it like any other, except wear and tear, which is recorded and never charged.

const KINDS: Classification[] = ["damage", "cleaning", "wear_and_tear"];

export function FindingForm({ tenancyId, state, room, like, onDone, onCancel }: {
  tenancyId: string; state: string; room: string; like: string | null; onDone: () => void; onCancel: () => void;
}) {
  const KIND = kindsFor(packFor(state));
  const [item, setItem] = useState("");
  const [kind, setKind] = useState<Classification>("damage");
  const [observation, setObservation] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  async function save() {
    setBusy(true);
    setError("");
    const r = await fetch(`/api/tenancies/${tenancyId}/findings`, {
      method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ room, like, item, classification: kind, observation }),
    });
    setBusy(false);
    if (!r.ok) return setError((await r.json().catch(() => ({}))).error ?? "Couldn't save it.");
    onDone();
  }

  return (
    <form className="space-y-4" onSubmit={(e) => { e.preventDefault(); if (item.trim() && !busy) save(); }}>
      <FormField label="What changed">
        <input className={inputClass} value={item} maxLength={120} placeholder="Closet door, broken track" onChange={(e) => setItem(e.target.value)} data-autofocus />
      </FormField>
      <FormField label="Type" group hint={<InfoTip title={KIND[kind].rule} cite={KIND[kind].cite}>{KIND[kind].note}</InfoTip>}>
        <div className="inline-flex flex-wrap gap-0.5 rounded-md bg-surface-2 p-[3px]">
          {KINDS.map((k) => (
            <button key={k} type="button" aria-pressed={kind === k} onClick={() => setKind(k)}
              className={`h-7 rounded-sm px-2.5 text-sm ${kind === k ? "bg-canvas font-medium text-ink shadow-sm" : "text-ink-3 hover:text-ink"}`}>
              {KIND[k].label}
            </button>
          ))}
        </div>
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

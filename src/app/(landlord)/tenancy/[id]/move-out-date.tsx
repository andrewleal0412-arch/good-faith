"use client";

import { useState } from "react";
import { Button } from "@/components/button";
import { useRefresh } from "@/components/refresh";
import { inlineInputClass } from "@/components/ui";
import { shortDate } from "@/lib/dates";

// The day the tenants returned possession: it starts the 21-day clock (Civ. Code 1950.5(h)(1)). Set from the move-out
// photos before the comparison, and changed from the Notice and dates card after it, until the deposit goes back.

export function MoveOutDate({ tenancyId, value, locked, className = "" }: {
  tenancyId: string; value: string | null; locked: boolean; className?: string;
}) {
  const refresh = useRefresh();
  const [editing, setEditing] = useState(!value);
  const [date, setDate] = useState(value ?? "");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  async function save() {
    setBusy(true);
    setError("");
    const r = await fetch(`/api/tenancies/${tenancyId}`, {
      method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ moveOutDate: date }),
    });
    if (!r.ok) { setBusy(false); return setError((await r.json().catch(() => ({}))).error ?? "Couldn't save the date."); }
    refresh(() => { setBusy(false); setEditing(false); });
  }

  if (locked || (value && !editing)) {
    return (
      <span className={`inline-flex flex-wrap items-center gap-x-2 ${className}`}>
        {value ? shortDate(value) : "Not recorded"}
        {!locked && <Button variant="link" onClick={() => setEditing(true)}>Change</Button>}
      </span>
    );
  }
  return (
    <span className={`inline-flex flex-wrap items-center gap-2 ${className}`}>
      <input type="date" value={date} onChange={(e) => setDate(e.target.value)} aria-label="Move-out date" className={`${inlineInputClass} h-8`} />
      {date && date !== value && <Button size="sm" variant="primary" onClick={save} disabled={busy}>{busy ? "Saving..." : "Save"}</Button>}
      {value && <Button size="sm" onClick={() => { setDate(value); setEditing(false); }}>Cancel</Button>}
      {error && <span role="alert" className="w-full text-xs text-red">{error}</span>}
    </span>
  );
}

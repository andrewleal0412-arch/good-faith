"use client";

import { useRouter } from "next/navigation";
import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { AgGridProvider, AgGridReact, type CustomCellRendererProps } from "ag-grid-react";
import type {
  CellEditingStartedEvent, CellEditRequestEvent, CellFocusedEvent, CellKeyDownEvent, ColDef, ColSpanParams, GetRowIdParams, GridApi, ICellEditorParams, IErrorValidationParams, ITooltipParams,
  RowClassParams, RowHeightParams, ValueFormatterParams, ValueGetterParams,
} from "ag-grid-community";
import { ColumnApiModule, HighlightChangesModule, NumberEditorModule, PinnedRowModule, RenderApiModule, RowApiModule } from "ag-grid-community";
import { Button } from "@/components/button";
import { useConfirm } from "@/components/confirm";
import { Drawer } from "@/components/drawer";
import { FormField } from "@/components/field";
import { GridTip, gridModules, gridTheme } from "@/components/grid";
import { Icon } from "@/components/icons";
import { InfoTip } from "@/components/info-tip";
import { Menu, type MenuItem } from "@/components/menu";
import { useMotionOff } from "@/components/motion";
import { RollMoney } from "@/components/roll-money";
import { Money, Notice, inputClass } from "@/components/ui";
import { checkEdit, editableFields, editRowOf, FIELD_LABEL, inputWords, type Changes, type EditField, type EditLimits, type EditRow } from "@/lib/deduction-edit";
import { basisWords, evidenceGaps, missingDocs, settle, usd, type StoredDeduction } from "@/lib/deductions";
import { findingTitle } from "@/lib/findings";
import type { ClientPack } from "@/lib/states/types";

// The Move-out tab's deductions as an AG Grid (Community): one row per charge, grouped under its room, with the inputs
// its amount is computed from editable in place. A cell is checked as it is typed by checkEdit (src/lib/deduction-edit.ts):
// a number the input can't take, or an amount over the line's lawful range (a state bar, a late statement that
// forfeits, the guidance's useful life), keeps the editor open with the reason in its tooltip. A good value is saved
// through PATCH /api/tenancies/[id]/deductions/[did], which runs the same check and then the whole range engine again
// before it stores anything; the amount and the pinned totals are worked out by the same code the server uses
// (chargeable, settle), the moment the cell is committed. Wear and tear stays in its room at $0.00, never charged.
// On a phone the grid keeps the item and the amount, and Edit (the row's menu) opens the same inputs in a drawer.

export type GridDeduction = StoredDeduction & {
  billed?: number | string | null; hours?: number | string | null; hourly_rate?: number | string | null;
  item_age_years?: number | string | null; useful_life_years?: number | string | null;
};

/** A line of the totals under the grid: label, amount and how it reads. `strong` is the bottom line. */
export type TotalLine = { key: string; label: string; amount: number | null; sign?: "minus" | "plus"; strong?: boolean; tip?: { title: string; text: string } };

/** What this grid draws with, beyond what every grid shares (gridModules): the number editors, the pinned totals, an
 *  amount's flash when the code works it out again, the columns read for the editors' keyboard paths, the rows by
 *  index, and the cells drawn again after an edit. */
const MODULES = gridModules(NumberEditorModule, PinnedRowModule, HighlightChangesModule, ColumnApiModule, RowApiModule, RenderApiModule);

type Kind = "room" | "deduction" | "wear" | "total";
type Row = {
  id: string;
  kind: Kind;
  room: string;
  n: number | null;
  title: string;
  full: string;
  d: GridDeduction | null;
  edit: EditRow | null;
  count?: number;
  amount: number | null;
  total?: TotalLine;
};
type Layout = "narrow" | "medium" | "wide";
type Ctx = {
  layout: Layout; allowed: boolean; pack: ClientPack; documentsRequired: boolean; saving: string | null;
  onEdit: (row: Row) => void; onRemove: (row: Row) => void; locked: boolean;
};

// Each input's column: its width on a wide card, then on a medium one (where the basis folds under the item).
const INPUTS: { field: EditField; header: string; width: [number, number]; tip: string }[] = [
  { field: "invoiceTotal", header: "Invoice", width: [116, 104], tip: "The vendor's invoice total" },
  { field: "hours", header: "Hours", width: [84, 72], tip: "Your own or your staff's hours" },
  { field: "hourlyRate", header: "Rate", width: [100, 88], tip: "The hourly rate for your own labor" },
  { field: "itemAgeYears", header: "Age", width: [80, 70], tip: "The item's age in years when it was damaged, or since it was painted" },
  { field: "usefulLifeYears", header: "Life", width: [80, 70], tip: "The item's useful life in years" },
];

// Every cell centers its content on the row's line; numbers sit on the right.
const CENTER = { display: "flex", alignItems: "center" };
const RIGHT = { ...CENTER, justifyContent: "flex-end" };

const isMoney = (f: EditField) => f === "invoiceTotal" || f === "hourlyRate";
const fmt = (f: EditField, v: number | null | undefined) =>
  v == null ? "" : isMoney(f) ? usd(v) : f === "hours" ? `${v} h` : `${v} yr${v === 1 ? "" : "s"}`;

/* ---------- Cells ---------- */

function ItemCell(p: CustomCellRendererProps<Row>) {
  const r = p.data;
  if (!r) return null;
  const ctx = p.context as Ctx;
  if (r.kind === "total") {
    const t = r.total!;
    return (
      <div className={`flex w-full items-center justify-end gap-1.5 ${t.strong ? "text-sm font-medium text-ink" : "text-ink-3"}`}>
        {t.label}
        {t.tip && <InfoTip align="end" title={t.tip.title}>{t.tip.text}</InfoTip>}
      </div>
    );
  }
  if (r.kind === "room") {
    return (
      <div className="flex min-w-0 items-center gap-2">
        <span className="truncate font-medium">{r.room}</span>
        <span className="shrink-0 text-xs text-ink-3">{r.count} item{r.count === 1 ? "" : "s"}</span>
      </div>
    );
  }
  if (r.kind === "wear") {
    return (
      <div className="flex min-w-0 flex-1 flex-col leading-tight">
        <span className="truncate text-ink-3" title={r.full}>{r.title}</span>
        <span className="mt-1 truncate text-xs text-ink-3">
          {ctx.layout === "narrow" ? "Wear and tear, not charged" : `${r.n ? `Finding ${r.n}, ` : ""}ordinary wear and tear, not deductible`}
        </span>
      </div>
    );
  }
  const d = r.d!;
  const missing = missingDocs(d, ctx.documentsRequired, ctx.pack);
  const gaps = missing.length ? [] : evidenceGaps(d, ctx.pack);
  const basis = r.edit ? basisLine(r.edit, d) : null;
  return (
    <div className="flex min-w-0 flex-1 flex-col leading-tight">
      <span className="truncate font-medium" title={d.item}>{r.title}</span>
      <span className="mt-1 truncate text-xs text-ink-3">
        {ctx.layout === "narrow" ? basis ?? (d.category === "rent" ? "Rent" : "")
          : [r.n ? `Finding ${r.n}` : d.category === "rent" ? "Rent" : null, ctx.layout === "medium" ? basis : null].filter(Boolean).join(", ")}
        {d.is_estimate && <span className="text-amber">, estimate</span>}
      </span>
      {missing.length > 0 && <span className="mt-0.5 truncate text-xs text-amber" title={`Needs ${missing.join(", ")}`}>Needs {missing.join(", ")}</span>}
      {gaps.length > 0 && <span className="mt-0.5 truncate text-xs text-amber" title="Not required by statute; the landlord carries the burden of proving the deduction reasonable">Unsupported: no {gaps.join(" or ")}</span>}
    </div>
  );
}

/** How the amount is reached, in a few words, from the live inputs ("Prorated, 4 of 10 years left"). */
function basisLine(e: EditRow, d: GridDeduction) {
  return basisWords({ category: d.category, performer: e.performer, proration: e.proration, hours: e.hours, hourlyRate: e.hourlyRate, itemAgeYears: e.itemAgeYears, usefulLifeYears: e.usefulLifeYears });
}

function BasisCell(p: CustomCellRendererProps<Row>) {
  const r = p.data;
  if (!r || r.kind === "total" || r.kind === "room") return null;
  if (r.kind === "wear") return <div className="flex min-w-0 flex-1 flex-col leading-tight text-ink-3"><span>Ordinary wear and tear</span><span className="mt-1 text-xs">Not deductible</span></div>;
  const d = r.d!;
  const photos = (d.finding?.moveInPath ? 1 : 0) + (d.finding?.moveOutPath ? 1 : 0) + (d.after_photo_paths?.length ?? 0);
  const paper = d.category === "rent" ? "Lease and rent ledger" : `${photos} photo${photos === 1 ? "" : "s"}${d.performer === "vendor"
    ? d.receipt_path ? ", vendor invoice" : d.is_estimate ? ", estimate" : ""
    : d.labor_description ? ", labor record" : ""}`;
  return (
    <div className="flex min-w-0 flex-1 flex-col leading-tight">
      <span className="truncate">{r.edit ? basisLine(r.edit, d) : d.item}</span>
      <span className="mt-1 truncate text-xs text-ink-3">{paper}</span>
    </div>
  );
}

/** An input the landlord can change, drawn as a small field so it reads as editable; plain text when the grid is read
 *  only, and nothing where the method doesn't use the input. */
function InputCell(p: CustomCellRendererProps<Row, number | null> & { field: EditField }) {
  const r = p.data;
  const ctx = p.context as Ctx;
  if (!r?.edit || !editableFields(r.edit).includes(p.field)) return null;
  const text = p.value == null ? "Not set" : fmt(p.field, p.value);
  if (!ctx.allowed) return <span className={`tabular-nums ${p.value == null ? "text-ink-3" : "text-ink-2"}`}>{text}</span>;
  return (
    <span className={`gf-input inline-flex h-7 min-w-[44px] max-w-full items-center justify-end rounded-sm border border-line bg-canvas px-2 tabular-nums ${p.value == null ? "text-ink-3" : ""} ${ctx.saving === r.id ? "opacity-60" : ""}`}>
      {text}
    </span>
  );
}

function AmountCell(p: CustomCellRendererProps<Row>) {
  const r = p.data;
  if (!r) return null;
  if (r.kind === "total") {
    const t = r.total!;
    if (t.amount == null) return <span className="text-ink-3">Not paid</span>;
    // The totals count to their new figures when an input changes them (an edit in place, a row added or removed).
    return <RollMoney value={t.amount} sign={t.sign} className={t.strong ? "text-lg font-medium" : ""} />;
  }
  if (r.kind === "wear") return <Money value={0} className="text-ink-3" />;
  if (r.kind === "room") return <Money value={r.amount ?? 0} className="text-ink-2" />;
  return <Money value={r.amount ?? 0} className="font-medium" />;
}

function RowMenu(p: CustomCellRendererProps<Row>) {
  const r = p.data;
  const ctx = p.context as Ctx;
  if (!r || r.kind !== "deduction" || ctx.locked) return null;
  const items: MenuItem[] = [
    ...(ctx.allowed && r.edit && editableFields(r.edit).length ? [{ label: "Edit", icon: "pen" as const, onSelect: () => ctx.onEdit(r) }] : []),
    ...(ctx.allowed ? [{ label: "Remove", icon: "x" as const, onSelect: () => ctx.onRemove(r) }] : []),
  ];
  if (!items.length) return null;
  return <Menu label={`More for ${r.title}`} items={items} portal width={180} />;
}

/* ---------- The grid ---------- */

/** Its children while this part of the page is shown, and nothing while it is hidden, so they are mounted anew, from
 *  the props they have then, each time it is shown again. React keeps a hidden tab (Activity) mounted and detaches its
 *  refs and effects; AG Grid's React component destroys its grid then, and builds it again on the way back from the
 *  props it had when it first mounted, which after an edit and a trip to another tab showed the old rows under the new
 *  totals. The first render is empty too; the layout effect fills it before anything is painted. */
function WhileShown({ children }: { children: ReactNode }) {
  const [shown, setShown] = useState(false);
  useLayoutEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect -- the point: mount the child only once this is on screen
    setShown(true);
    return () => setShown(false);
  }, []);
  return shown ? children : null;
}

export function DeductionsGrid(p: {
  tenancyId: string;
  pack: ClientPack;
  deductions: GridDeduction[]; // in the page's order (by finding number)
  numbers: Record<string, number>; // finding id to its number on the page
  wear: { id: string; n: number; item: string; full: string; room: string }[];
  depositHeld: number | null;
  allowed: boolean; // the inputs may change: not returned, not frozen by a dispute, not a template
  reason: string | null; // why not, when they may not
  locked: boolean; // the deposit went back: no Remove either
  limits: Record<string, EditLimits>;
  totals: (live: { total: number; refund: number; balanceClaimed: number }) => TotalLine[];
}) {
  const router = useRouter();
  const apiRef = useRef<GridApi<Row> | null>(null);
  const [confirm, confirmDialog] = useConfirm();
  // A recomputed amount flashes and a row added while the grid is seen fades in, unless the viewer asked for less motion.
  // (AG Grid's own row animation can't run: ensureDomOrder, which keeps the rows in reading order for a screen reader,
  // turns it off.) `known` is every row the grid has shown at rest, so a row is new only when it wasn't among them.
  const still = useMotionOff();
  const known = useRef<Set<string> | null>(null);
  const [edits, setEdits] = useState<Record<string, EditRow>>(() => Object.fromEntries(p.deductions.map((d) => [d.id, editRowOf(d)])));
  const [saving, setSaving] = useState<string | null>(null);
  const [message, setMessage] = useState<{ tone: "red" | "gray"; text: string } | null>(null);
  const [drawer, setDrawer] = useState<Row | null>(null);
  // The reason a cell being typed in can't be saved, shown in a tip under it at once (no hover needed), and kept
  // until the value is good or the edit is cancelled. `keep` is the saved value, which Escape puts back.
  const [invalid, setInvalid] = useState<{ rowId: string; field: EditField; reason: string; cite: string | null; keep: string } | null>(null);
  const invalidRef = useRef(invalid);
  const showInvalid = useCallback((next: typeof invalid) => {
    const was = invalidRef.current;
    if (was?.rowId === next?.rowId && was?.field === next?.field && was?.reason === next?.reason) return;
    invalidRef.current = next;
    queueMicrotask(() => setInvalid(next));
  }, []);

  // Fresh rows from the server (after a save, router.refresh) replace the ones edited here.
  const sig = p.deductions.map((d) => `${d.id}:${d.math}:${d.amount}`).join("|");
  const [seen, setSeen] = useState(sig);
  if (sig !== seen) {
    setSeen(sig);
    setEdits(Object.fromEntries(p.deductions.map((d) => [d.id, editRowOf(d)])));
  }

  // The columns follow the card's own width: wide shows every input and the basis, medium folds the basis under the
  // item, a phone (or a card too narrow for five inputs) keeps the item and the amount, with Edit in the row's menu.
  const card = useRef<HTMLDivElement>(null);
  const [layout, setLayout] = useState<Layout>("wide");
  useEffect(() => {
    const el = card.current;
    if (!el) return;
    // Medium needs 714px (a 150px item, the five inputs, the amount and the menu), so a 1024px window, whose card is
    // 736px beside the sidebar, still edits in its cells.
    const ro = new ResizeObserver(([e]) => {
      const w = e.contentRect.width;
      // 0 while the tab is hidden: keep the layout it had.
      if (!w) return;
      setLayout(w < 720 ? "narrow" : w < 1010 ? "medium" : "wide");
    });
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  // The amounts as they stand, edits included: the settle() the server runs, for the totals and the document rule.
  const live = useMemo(() => p.deductions.map((d) => ({ category: d.category, amount: edits[d.id]?.amount ?? Number(d.amount) })), [p.deductions, edits]);
  const s = settle(p.depositHeld ?? 0, live, p.pack);

  const rows = useMemo<Row[]>(() => {
    const byRoom = new Map<string, Row[]>();
    const items: Row[] = [
      ...p.deductions.map((d): Row => {
        const n = d.finding?.id ? p.numbers[d.finding.id] ?? null : null;
        const e = edits[d.id] ?? editRowOf(d);
        return {
          id: d.id, kind: "deduction", room: d.room ?? (d.category === "rent" ? "Rent" : "Other"), n, d, edit: e, amount: e.amount, full: d.item,
          title: d.finding ? findingTitle({ item: d.item, label: (d.finding as { label?: string | null }).label }) : d.item,
        };
      }),
      ...p.wear.map((w): Row => ({ id: `w-${w.id}`, kind: "wear", room: w.room, n: w.n, d: null, edit: null, amount: 0, title: w.item, full: w.full })),
    ].sort((a, b) => (a.n ?? 1e6) - (b.n ?? 1e6));
    for (const r of items) byRoom.set(r.room, [...(byRoom.get(r.room) ?? []), r]);
    const out: Row[] = [];
    for (const [room, xs] of byRoom) {
      const charged = xs.filter((x) => x.kind === "deduction");
      out.push({ id: `room-${room}`, kind: "room", room, n: null, title: room, full: room, d: null, edit: null, count: xs.length, amount: charged.reduce((t, x) => t + (x.amount ?? 0), 0) });
      out.push(...xs);
    }
    return out;
  }, [p.deductions, p.wear, p.numbers, edits]);

  // After the grid has drawn these rows, they are the ones it has shown.
  useEffect(() => {
    known.current = new Set(rows.map((r) => r.id));
  }, [rows]);

  const pinned = useMemo<Row[]>(() => p.totals({ total: s.total, refund: s.refund, balanceClaimed: s.balanceClaimed }).map((t) => ({
    id: `total-${t.key}`, kind: "total", room: "", n: null, title: t.label, full: t.label, d: null, edit: null, amount: t.amount, total: t,
  })), [p, s.total, s.refund, s.balanceClaimed]);

  /** Save inputs: checked here, shown at once, then sent; the server's answer (or its refusal) is what stays. */
  const save = useCallback(async (row: Row, changes: Changes): Promise<string | null> => {
    if (!row.edit || !row.d) return "Nothing to save.";
    const before = row.edit;
    const r = checkEdit(before, changes, p.limits[row.id] ?? { bar: null, ceiling: null, guidanceCite: p.pack.copy.guidanceCite });
    if (!r.ok) {
      setMessage({ tone: "red", text: r.reason });
      return r.reason;
    }
    setEdits((e) => ({ ...e, [row.id]: r.row }));
    setSaving(row.id);
    setMessage(null);
    const resp = await fetch(`/api/tenancies/${p.tenancyId}/deductions/${row.id}`, {
      method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ changes, math: before.math }),
    }).catch(() => null);
    setSaving(null);
    const j = resp ? await resp.json().catch(() => ({})) as { error?: string; amount?: number; math?: string; changes?: string[] } : {};
    if (!resp || !resp.ok) {
      setEdits((e) => ({ ...e, [row.id]: before }));
      const why = j.error ?? "Couldn't save it. Check the connection and try again.";
      setMessage({ tone: "red", text: why });
      return why;
    }
    setEdits((e) => ({ ...e, [row.id]: { ...r.row, amount: j.amount ?? r.row.amount, math: j.math ?? r.row.math } }));
    setMessage({ tone: "gray", text: `Saved. ${row.title}: ${(j.changes ?? []).join(", ").toLowerCase() || "no change"}. It comes to ${usd(j.amount ?? r.row.amount)}.` });
    router.refresh();
    return null;
  }, [p.limits, p.pack, p.tenancyId, router]);

  const remove = useCallback(async (row: Row) => {
    if (!(await confirm({ title: "Remove this deduction?", body: `${row.title}, ${usd(row.amount ?? 0)}. Its receipt goes too; the after-repair photos stay on file.`, action: "Remove" }))) return;
    setSaving(row.id);
    const r = await fetch(`/api/tenancies/${p.tenancyId}/deductions/${row.id}`, { method: "DELETE" });
    setSaving(null);
    if (!r.ok) setMessage({ tone: "red", text: (await r.json().catch(() => ({}))).error ?? "Couldn't remove it." });
    else setMessage({ tone: "gray", text: `Removed ${row.title}.` });
    router.refresh();
  }, [confirm, p.tenancyId, router]);

  const context = useMemo<Ctx>(() => ({
    layout, allowed: p.allowed, pack: p.pack, documentsRequired: s.documentsRequired, saving, locked: p.locked,
    onEdit: (r) => setDrawer(r), onRemove: (r) => { void remove(r); },
  }), [layout, p.allowed, p.pack, s.documentsRequired, saving, p.locked, remove]);

  // The grid is destroyed whenever its tab is hidden (WhileShown), and this effect runs again when the tab comes back,
  // before the new grid is ready: only a live grid is asked.
  useEffect(() => {
    const api = apiRef.current;
    if (api && !api.isDestroyed()) api.refreshCells({ force: true });
  }, [context]);
  // A refused value's tip belongs to an editor the hidden tab no longer has.
  useLayoutEffect(() => () => {
    invalidRef.current = null;
    setInvalid(null);
  }, []);

  const columnDefs = useMemo<ColDef<Row>[]>(() => {
    // The item cell of a room's line and of a totals row spans every column up to the amount, so the room's name (or
    // the total's label) and its figure share one line, in real cells a screen reader reads as a row.
    const span = (params: ColSpanParams<Row>) => (params.data?.kind === "total" || params.data?.kind === "room" ? params.api.getAllDisplayedColumns().findIndex((c) => c.getColId() === "amount") : 1);
    const item: ColDef<Row> = {
      colId: "item", headerName: "Item", flex: 1.6, minWidth: layout === "wide" ? 210 : 150, cellRenderer: ItemCell, colSpan: span,
      cellClass: "gf-first", headerClass: "gf-first",
      tooltipValueGetter: (t: ITooltipParams<Row>) => (t.data?.kind === "deduction" || t.data?.kind === "wear" ? t.data.full : null),
    };
    const amount: ColDef<Row> = {
      colId: "amount", headerName: "Amount", width: layout === "wide" ? 124 : 112, type: "rightAligned", cellRenderer: AmountCell, cellStyle: RIGHT,
      valueGetter: (v: ValueGetterParams<Row>) => v.data?.amount ?? null, enableCellChangeFlash: !still,
      tooltipValueGetter: (t: ITooltipParams<Row>) => (t.data?.kind === "deduction" ? `${t.data.edit?.math ?? t.data.d?.math}.` : null),
    };
    // Named for a screen reader, not shown.
    const menu: ColDef<Row> = { colId: "menu", headerName: "Actions", headerClass: "gf-header-sr", width: 48, resizable: false, cellRenderer: RowMenu, cellStyle: { ...RIGHT, paddingLeft: 0 } };
    if (layout === "narrow") return [item, amount, menu];
    const inputs = INPUTS.map(({ field, header, width, tip }): ColDef<Row> => ({
      colId: field, headerName: header, headerTooltip: tip, width: width[layout === "wide" ? 0 : 1], type: "rightAligned", cellStyle: RIGHT,
      valueGetter: (v: ValueGetterParams<Row>) => (v.data?.edit && editableFields(v.data.edit).includes(field) ? v.data.edit[field] : null),
      valueFormatter: (v: ValueFormatterParams<Row, number | null>) => fmt(field, v.value),
      cellRenderer: InputCell, cellRendererParams: { field },
      editable: (e) => p.allowed && e.data?.kind === "deduction" && !!e.data.edit && editableFields(e.data.edit).includes(field),
      cellEditor: "agNumberCellEditor",
      cellEditorParams: {
        precision: 2, showStepperButtons: false, preventStepping: true,
        // Checked on every keystroke by the code the server runs: the reason shows in the editor's tooltip, and
        // Enter or Tab can't commit it.
        getValidationErrors: (v: IErrorValidationParams<Row, number>) => {
          const row = (v.cellEditorParams as ICellEditorParams<Row>).data;
          if (!row?.edit) return null;
          const r = v.value == null
            ? { ok: false as const, reason: `Enter the ${FIELD_LABEL[field].toLowerCase()}.`, cite: null }
            : checkEdit(row.edit, { [field]: v.value }, p.limits[row.id] ?? { bar: null, ceiling: null, guidanceCite: p.pack.copy.guidanceCite });
          showInvalid(r.ok ? null : { rowId: row.id, field, reason: r.reason, cite: r.cite, keep: row.edit[field] == null ? "it as it was" : inputWords(field, row.edit[field]) });
          return r.ok ? null : [r.reason];
        },
      },
      tooltipValueGetter: (t: ITooltipParams<Row>) => (t.data?.edit && editableFields(t.data.edit).includes(field) && p.allowed ? `${tip}. Click or press Enter to change it.` : null),
    }));
    const basis: ColDef<Row> = {
      colId: "basis", headerName: "Basis", flex: 1, minWidth: 160, cellRenderer: BasisCell,
      tooltipValueGetter: (t: ITooltipParams<Row>) => (t.data?.kind === "deduction" ? `${t.data.edit?.math ?? t.data.d?.math}.` : null),
    };
    return [item, ...(layout === "wide" ? [basis] : []), ...inputs, amount, menu];
  }, [layout, p.allowed, p.limits, p.pack, showInvalid, still]);

  const defaultColDef = useMemo<ColDef<Row>>(() => ({
    sortable: false, resizable: false, suppressHeaderMenuButton: true, tooltipComponent: GridTip, suppressMovable: true, cellStyle: CENTER,
  }), []);

  const onEditRequest = useCallback((e: CellEditRequestEvent<Row>) => {
    const field = e.column.getColId() as EditField;
    if (e.data?.kind !== "deduction" || e.newValue === e.oldValue) return;
    void save(e.data, { [field]: e.newValue });
  }, [save]);

  // The editor AG Grid opens is labelled "Input Editor"; a screen reader hears what is being changed instead, and the
  // reason a value is refused (the tip under the cell) as its description.
  const onEditingStarted = useCallback((e: CellEditingStartedEvent<Row>) => {
    const field = e.column.getColId() as EditField;
    const title = e.data?.title ?? "";
    requestAnimationFrame(() => {
      const input = document.querySelector<HTMLInputElement>(`.gf-deductions .ag-row[row-id="${CSS.escape(e.data?.id ?? "")}"] .ag-cell[col-id="${field}"] input`);
      if (!input) return;
      input.setAttribute("aria-label", `${FIELD_LABEL[field] ?? "Value"}, ${title}`);
      input.setAttribute("aria-describedby", EDIT_TIP_ID);
    });
  }, []);

  // A refused value keeps its editor open (Enter and Tab can't commit it), but never traps the grid: focus moving to
  // another cell, or out of the grid, cancels the edit and puts the saved value back, as Escape does.
  const onCellFocused = useCallback((e: CellFocusedEvent<Row>) => {
    const bad = invalidRef.current;
    if (!bad) return;
    const col = typeof e.column === "string" ? e.column : e.column?.getColId();
    const node = e.rowIndex != null && !e.rowPinned ? e.api.getDisplayedRowAtIndex(e.rowIndex) : null;
    if (node?.data?.id === bad.rowId && col === bad.field) return;
    e.api.stopEditing(true);
    // The click that moved focus would have opened the cell it landed on (singleClickEdit), had the refused editor not
    // been in the way: open it now.
    const column = col ? e.api.getColumn(col) : null;
    if (node && column?.isCellEditable(node) && e.rowIndex != null) {
      const rowIndex = e.rowIndex;
      requestAnimationFrame(() => e.api.startEditingCell({ rowIndex, colKey: column }));
    }
  }, []);
  const onBlur = useCallback((e: React.FocusEvent<HTMLDivElement>) => {
    if (!invalidRef.current) return;
    const to = e.relatedTarget;
    if (to instanceof Node && e.currentTarget.contains(to)) return;
    apiRef.current?.stopEditing(true);
  }, []);

  // Enter on a row's item or amount opens its inputs in the drawer, for a keyboard or a screen reader.
  const onKey = useCallback((e: CellKeyDownEvent<Row>) => {
    const k = (e.event as KeyboardEvent | undefined)?.key;
    if (k === "Enter" && e.data?.kind === "deduction" && p.allowed && !INPUTS.some((x) => x.field === e.column.getColId())) setDrawer(e.data);
  }, [p.allowed]);

  return (
    <div ref={card} className="gf-grid gf-deductions" onBlur={onBlur}>
      <WhileShown>
      <AgGridProvider modules={MODULES}>
        <AgGridReact<Row>
          theme={gridTheme}
          rowData={rows}
          pinnedBottomRowData={pinned}
          columnDefs={columnDefs}
          defaultColDef={defaultColDef}
          context={context}
          getRowId={(r: GetRowIdParams<Row>) => r.data.id}
          getRowHeight={(r: RowHeightParams<Row>) => (r.data?.kind === "room" ? 36 : r.data?.kind === "total" ? (r.data.total?.strong ? 48 : 34) : layout === "narrow" ? 64 : 56)}
          getRowClass={(r: RowClassParams<Row>) => [
            r.data?.kind === "total" ? `gf-total${r.data.total?.strong ? " gf-total-strong" : ""}` : r.data?.kind === "room" ? "gf-room" : r.data?.kind === "wear" ? "gf-wear" : "",
            r.data && r.data.kind !== "total" && !still && known.current && !known.current.has(r.data.id) ? "gf-row-new" : "",
          ].filter(Boolean).join(" ") || undefined}
          readOnlyEdit
          onCellEditRequest={onEditRequest}
          invalidEditValueMode="block"
          singleClickEdit
          stopEditingWhenCellsLoseFocus
          onCellKeyDown={onKey}
          onCellFocused={onCellFocused}
          onCellEditingStarted={onEditingStarted}
          onCellEditingStopped={() => showInvalid(null)}
          domLayout="autoHeight"
          ensureDomOrder
          suppressColumnVirtualisation
          animateRows={false}
          enableCellTextSelection
          tooltipShowDelay={300}
          onGridReady={(e) => { apiRef.current = e.api; }}
          onGridPreDestroyed={(e) => { if (apiRef.current === e.api) apiRef.current = null; }}
          overlayComponentParams={{ noRows: { overlayText: "No deductions yet. Add them from the findings above." } }}
        />
      </AgGridProvider>
      </WhileShown>
      {invalid && <EditTip {...invalid} />}
      <div aria-live="polite" className="empty:hidden">
        {message && <Notice tone={message.tone} className="mx-5 my-3">{message.text}</Notice>}
      </div>
      {!p.allowed && p.reason && !p.locked && (
        <p className="flex items-center gap-1.5 border-t border-line-2 px-5 py-2.5 text-xs text-ink-3"><Icon name="info" className="size-3.5 text-ink-4" />{p.reason}</p>
      )}
      <Drawer open={!!drawer} onClose={() => setDrawer(null)} title="Edit deduction" sub={drawer ? `${drawer.title}${drawer.room ? `, ${drawer.room}` : ""}` : undefined}>
        {drawer?.edit && (
          <EditForm key={drawer.id} row={{ ...drawer, edit: edits[drawer.id] ?? drawer.edit }} limits={p.limits[drawer.id]} pack={p.pack}
            onCancel={() => setDrawer(null)}
            onSave={async (changes) => {
              const why = await save({ ...drawer, edit: edits[drawer.id] ?? drawer.edit }, changes);
              if (!why) setDrawer(null);
              return why;
            }} />
        )}
      </Drawer>
      {confirmDialog}
    </div>
  );
}

const EDIT_TIP_ID = "gf-edit-tip";

/** Why the value being typed can't be saved: the app's dark tip, fixed under the cell (above it when there's no room),
 *  and announced, with the way out. It follows the cell when the page scrolls; a click on it keeps the editor's focus. */
function EditTip({ rowId, field, reason, cite, keep }: { rowId: string; field: EditField; reason: string; cite: string | null; keep: string }) {
  const tip = useRef<HTMLDivElement>(null);
  useLayoutEffect(() => {
    const place = () => {
      const cell = document.querySelector(`.gf-deductions .ag-row[row-id="${CSS.escape(rowId)}"] .ag-cell[col-id="${field}"]`);
      const el = tip.current;
      if (!cell || !el) return;
      const b = cell.getBoundingClientRect();
      const vw = document.documentElement.clientWidth, vh = document.documentElement.clientHeight;
      const w = el.offsetWidth, h = el.offsetHeight;
      const top = b.bottom + 6 + h > vh - 8 && b.top - 6 - h >= 8 ? b.top - 6 - h : b.bottom + 6;
      el.style.top = `${Math.round(top)}px`;
      el.style.left = `${Math.round(Math.max(12, Math.min(b.right - w, vw - 12 - w)))}px`;
    };
    place();
    window.addEventListener("scroll", place, true);
    window.addEventListener("resize", place);
    return () => { window.removeEventListener("scroll", place, true); window.removeEventListener("resize", place); };
  }, [rowId, field, reason]);
  return (
    <div ref={tip} id={EDIT_TIP_ID} role="alert" onMouseDown={(e) => e.preventDefault()}
      className="gf-tip fixed left-0 top-0 z-40 w-[300px] max-w-[calc(100vw-24px)] rounded-md bg-ink px-3.5 py-3 text-sm text-white shadow-md">
      <span className="mb-[3px] block font-medium">Not saved</span>
      <span className="block text-white/90">{reason}</span>
      {cite && <span className="mt-1.5 block text-xs text-white/70">{cite}</span>}
      <span className="mt-1.5 block text-xs text-white/70">Press Escape, or click outside the cell, to keep {keep}.</span>
    </div>
  );
}

/** The same inputs as the grid's cells, in the drawer: for a phone, and for a keyboard that would rather fill a form.
 *  The amount under the fields is worked out as they are typed, by the same check. */
function EditForm({ row, limits, pack, onSave, onCancel }: {
  row: Row; limits: EditLimits | undefined; pack: ClientPack;
  onSave: (changes: Changes) => Promise<string | null>; onCancel: () => void;
}) {
  const e = row.edit!;
  const fields = editableFields(e);
  const [v, setV] = useState<Record<string, string>>(() => Object.fromEntries(fields.map((f) => [f, e[f] == null ? "" : String(e[f])])));
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const changes: Changes = Object.fromEntries(fields.filter((f) => v[f] !== (e[f] == null ? "" : String(e[f]))).map((f) => [f, v[f]]));
  const check = Object.keys(changes).length ? checkEdit(e, changes, limits ?? { bar: null, ceiling: null, guidanceCite: pack.copy.guidanceCite }) : null;
  const label: Record<EditField, string> = {
    invoiceTotal: "Invoice total", hours: "Hours", hourlyRate: "Hourly rate",
    itemAgeYears: e.proration === "paint_schedule" ? "Years since it was last painted" : "Age when damaged (years)", usefulLifeYears: "Useful life (years)",
  };
  return (
    <form className="space-y-4" onSubmit={async (ev) => {
      ev.preventDefault();
      if (!check?.ok || busy) return;
      setBusy(true);
      setError("");
      const why = await onSave(changes);
      setBusy(false);
      if (why) setError(why);
    }}>
      <div className="grid gap-3 sm:grid-cols-2">
        {fields.map((f) => (
          <FormField key={f} label={label[f]} note={!check?.ok && check?.field === f ? <span className="text-red">{check.reason}</span> : undefined}>
            <input className={inputClass} inputMode="decimal" value={v[f]} aria-invalid={!check?.ok && check?.field === f ? true : undefined}
              onChange={(x) => setV({ ...v, [f]: x.target.value })} />
          </FormField>
        ))}
      </div>
      {check && !check.ok && check.field == null && <Notice>{check.reason}</Notice>}
      {error && <Notice>{error}</Notice>}
      <div className="sticky -bottom-5 -mx-5 -mb-5 mt-6 border-t border-line-2 bg-canvas px-5 pb-4 pt-3.5">
        <div aria-live="polite" className="mb-3 min-h-[38px]">
          {check?.ok ? (
            <>
              <p className="text-lg font-medium">Comes to <Money value={check.row.amount} /></p>
              <p className="text-xs text-ink-3">{check.row.math}</p>
            </>
          ) : (
            <>
              <p className="text-lg font-medium">Now <Money value={e.amount} /></p>
              <p className="text-xs text-ink-3">{fields.map((f) => `${FIELD_LABEL[f]} ${inputWords(f, e[f])}`).join(", ")}</p>
            </>
          )}
        </div>
        <div className="flex gap-2">
          <Button type="submit" variant="primary" disabled={busy || !check?.ok}>{busy ? "Saving..." : "Save"}</Button>
          <Button onClick={onCancel}>Cancel</Button>
        </div>
      </div>
    </form>
  );
}

"use client";

import Link from "@/components/link";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { AgGridProvider, AgGridReact, type CustomCellRendererProps } from "ag-grid-react";
import type {
  CellClickedEvent, CellKeyDownEvent, ColDef, ColumnMovedEvent, ColumnResizedEvent, ColumnState, DisplayedColumnsChangedEvent, GridApi, GridReadyEvent, IRowNode, ITooltipParams,
  ProcessCellForExportParams, ProcessHeaderForExportParams, RowSelectionOptions, SelectionColumnDef, SortChangedEvent, ValueFormatterParams, ValueGetterParams,
} from "ag-grid-community";
import { ColumnApiModule, CsvExportModule, ExternalFilterModule, QuickFilterModule, RowApiModule, RowSelectionModule } from "ag-grid-community";
import { atTextIn, dayLabel, longDate, PACIFIC, shortDate } from "@/lib/dates";
import { zoneOf } from "@/lib/states";
import { Button, ButtonLink } from "@/components/button";
import { CopyId } from "@/components/copy-id";
import { Drawer } from "@/components/drawer";
import { browserStore, csvSafe, GridTip, gridModules, gridTab, gridTheme, pressCellControl } from "@/components/grid";
import { Icon, PayPalMark } from "@/components/icons";
import { InfoTip } from "@/components/info-tip";
import { Menu, type MenuItem } from "@/components/menu";
import { Tabs } from "@/components/tabs";
import { RollMoney } from "@/components/roll-money";
import { KV, Money, StatusChip, inlineInputClass } from "@/components/ui";
import { BACK_KINDS, ledgerTotals, owedBack, tagCite, type LedgerKind, type LedgerRow } from "@/lib/ledger";
import type { LedgerDetail, LedgerUnit } from "@/lib/ledger-load";

// Payments, as Mercury's and Stripe's transaction tables read: the page title with Views, Export and Request deposit,
// two tiles (what is held, what is due back next), the views as tabs, filter chips and a quick filter, then one 48px
// line per money event in AG Grid Community. Each view is a saved layout: its rows, its columns and its sort, and the
// columns a landlord resizes, moves, sorts, hides or shows are remembered per view in this browser. A row opens its
// details (every PayPal id with a copy button, where its status came from, PayPal's webhook deliveries) on a click or
// Enter; the arrow keys move between cells. Past a screenful the grid renders only the rows in view, so a few hundred
// rows scroll as fast as ten. No license key and nothing from Enterprise; the modules go in through the provider so
// nothing runs on the server.

/** What this grid draws with, beyond what every grid shares (gridModules): the quick filter, the views' and the chips'
 *  filter, the row checkboxes, the CSV, saved column layouts, and the shown and selected counts. */
const MODULES = gridModules(QuickFilterModule, ExternalFilterModule, RowSelectionModule, CsvExportModule, ColumnApiModule, RowApiModule);

/* ---------- Views and what each row is ---------- */

type View = "all" | "deposits" | "refunds" | "settlements" | "deductions" | "requests" | "paypal";
type ColId = "date" | "tenants" | "type" | "unit" | "method" | "detail" | "paypalId" | "source" | "tag" | "status" | "amount";

const BACK: LedgerKind[] = BACK_KINDS;
/** The views: which rows each shows and the columns it opens with (a wide card; narrower cards drop the extras). All
 *  is money that moved: deposits in, refunds, payouts and settlements out. PayPal events is every row PayPal holds a
 *  record of, with where each status came from. */
const VIEWS: { key: View; label: string; has: (r: LedgerRow) => boolean; cols: ColId[] }[] = [
  { key: "all", label: "All", has: (r) => r.kind === "payment" || BACK.includes(r.kind) || r.kind === "settlement", cols: ["date", "tenants", "type", "unit", "method", "status", "amount"] },
  { key: "deposits", label: "Deposits", has: (r) => r.kind === "payment", cols: ["date", "tenants", "unit", "method", "paypalId", "status", "amount"] },
  { key: "refunds", label: "Refunds", has: (r) => BACK.includes(r.kind), cols: ["date", "tenants", "type", "unit", "detail", "status", "amount"] },
  { key: "settlements", label: "Settlements", has: (r) => r.kind === "settlement", cols: ["date", "tenants", "unit", "detail", "status", "amount"] },
  { key: "deductions", label: "Deductions", has: (r) => r.kind === "deduction", cols: ["date", "tenants", "unit", "detail", "tag", "status", "amount"] },
  { key: "requests", label: "Requests", has: (r) => r.kind === "deposit_invoice" || r.kind === "damage_invoice", cols: ["date", "tenants", "type", "unit", "paypalId", "status", "amount"] },
  { key: "paypal", label: "PayPal events", has: (r) => r.kind !== "deduction" && !r.example && (!!r.paypalId || !!r.fromPayPal), cols: ["date", "type", "unit", "paypalId", "source", "status", "amount"] },
];
/** What a narrower card drops first, in order. */
const DROP: ColId[] = ["method", "tag", "source", "detail", "paypalId", "type"];
/** The columns a landlord may show or hide (the rest every view keeps). */
const OPTIONAL: { id: ColId; label: string }[] = [
  { id: "type", label: "Type" }, { id: "unit", label: "Property" }, { id: "method", label: "Method" }, { id: "detail", label: "Detail" },
  { id: "paypalId", label: "PayPal ID" }, { id: "source", label: "Status from" }, { id: "tag", label: "Rule" }, { id: "status", label: "Status" },
];

/** The word the table shows for each kind (the deposit received reads "Deposit"; an invoice is a request). */
const TYPE: Record<LedgerKind, string> = {
  payment: "Deposit", refund: "Refund", payout: "Payout", deposit_invoice: "Deposit request", damage_invoice: "Balance request", deduction: "Deduction", settlement: "Settlement",
  dispute_refund: "PayPal dispute", outside_refund: "Refund",
};

type Range = { key: string; label: string; from?: string; to?: string };
type Band = { key: string; label: string; min?: number; max?: number };
const BANDS: Band[] = [
  { key: "any", label: "Any amount" },
  { key: "lt500", label: "Under $500", max: 500 },
  { key: "500-2500", label: "$500 to $2,500", min: 500, max: 2500 },
  { key: "gt2500", label: "Over $2,500", min: 2500 },
];

function ranges(today: string): Range[] {
  const y = Number(today.slice(0, 4));
  const back = (days: number) => { const d = new Date(`${today}T12:00:00Z`); d.setUTCDate(d.getUTCDate() - days); return d.toISOString().slice(0, 10); };
  return [
    { key: "all", label: "All time" },
    { key: "30", label: "Last 30 days", from: back(30), to: today },
    { key: "month", label: "This month", from: `${today.slice(0, 7)}-01`, to: today },
    { key: "year", label: "This year", from: `${y}-01-01`, to: today },
    { key: "last-year", label: "Last year", from: `${y - 1}-01-01`, to: `${y - 1}-12-31` },
  ];
}

const cap = (s: string) => s.charAt(0).toUpperCase() + s.slice(1);

/** Status in a word or two. A deposit is Held until a refund or payout went back, then Returned (the statement
 *  accounts for the rest; "Settled" would read as a dispute's settlement, which has rows of its own); an invoice is
 *  Paid or Unpaid; a deduction keeps its statement status. */
function statusOf(r: LedgerRow, back: Map<string, Back>): string {
  switch (r.kind) {
    case "payment": {
      if (r.effect === "failed") return "Reversed";
      const b = back.get(r.tenancyId);
      return b === "returned" ? "Returned" : b === "partly" ? "Partly returned" : b === "pending" ? "Refund pending" : "Held";
    }
    case "refund":
    case "payout":
    case "dispute_refund":
    case "outside_refund":
    case "settlement": return r.example ? "Demo example" : r.effect === "returned" ? "Completed" : r.effect === "failed" ? "Failed" : "Pending";
    case "deposit_invoice":
    case "damage_invoice": return /^(paid|marked as paid)/.test(r.status) ? "Paid" : r.status === "sent, not paid" ? "Unpaid" : cap(r.status);
    // A deduction New York's day 14 forfeited: one word here; the row's tip and the CSV say after which day.
    default: return r.kind === "deduction" && r.effect === "forfeited" ? "Forfeited" : cap(r.status);
  }
}

/** Where a row's status came from, in a few words: PayPal's webhook, or the record as the app last read it. */
const sourceOf = (r: LedgerRow) => (r.kind === "deduction" ? "Your records" : r.example ? "Demo example" : r.fromPayPal ? "PayPal webhook" : "As last read");

/* ---------- Cells ---------- */

type Layout = "narrow" | "medium" | "compact" | "wide";
/** How a tenancy's deposit stands once money went back: all of what is owed, part of it (a refund made in PayPal or
 *  through a PayPal dispute before the rest), or still on its way. */
type Back = "returned" | "partly" | "pending";
type Ctx = { back: Map<string, Back>; today: string; layout: Layout; onlyProperty: (id: string) => void; open: (r: LedgerRow) => void };

function PropertyCell(p: CustomCellRendererProps<LedgerRow, string>) {
  if (!p.data) return null;
  return <Link href={`/tenancy/${p.data.tenancyId}?tab=payments`} className="truncate text-ink hover:underline">{p.value}</Link>;
}

function MethodCell(p: CustomCellRendererProps<LedgerRow, string | null>) {
  if (!p.value) return <span className="text-ink-3">None</span>;
  return <span className="inline-flex items-center gap-[7px]"><PayPalMark size={14} />{p.value === "PayPal" ? "PayPal" : `${p.value}, PayPal`}</span>;
}

/** The status, with "From PayPal" under it when PayPal's webhook reported it (the moment is in the row's tooltip). */
function StatusCell(p: CustomCellRendererProps<LedgerRow, string>) {
  const status = p.value === "Failed" || p.value === "Reversed" ? <StatusChip tone="red">{p.value}</StatusChip> : <span className="text-ink-3">{p.value}</span>;
  if (!p.data?.fromPayPal) return status;
  return (
    <div className="flex h-full flex-col justify-center gap-0.5 leading-tight">
      <span>{status}</span>
      <span className="truncate text-xs text-ink-3">From PayPal</span>
    </div>
  );
}

/** Money in is green, money out ink with a minus; a request or a deduction moved nothing and stays plain. */
function AmountCell(p: CustomCellRendererProps<LedgerRow, number>) {
  const r = p.data;
  if (!r) return null;
  return <div className="text-right"><RowMoney r={r} /></div>;
}

function RowMoney({ r, className = "" }: { r: LedgerRow; className?: string }) {
  return r.effect === "failed" ? <Money value={r.amount} className={`text-ink-3 line-through ${className}`} />
    : r.kind === "payment" ? <Money value={r.amount} className={`text-green ${className}`} />
      : BACK.includes(r.kind) || r.kind === "settlement" ? <Money value={r.amount} sign="minus" className={className} />
        : <Money value={r.amount} className={`text-ink-2 ${className}`} />;
}

/** A PayPal id in a cell: the id in tabular figures, truncated, the whole of it on hover. */
function IdCell(p: CustomCellRendererProps<LedgerRow, string | null>) {
  if (!p.value) return <span className="text-ink-3">None</span>;
  return <span className="truncate tabular-nums text-ink-2" title={p.value}>{p.value}</span>;
}

/** Who, over what kind of row it is and when: the first column when the grid is too narrow for Date and Type. On a
 *  phone, where the Property column is gone, the name is the link to the property. */
function WhoCell(p: CustomCellRendererProps<LedgerRow, string>) {
  const r = p.data;
  if (!r) return null;
  const ctx = p.context as Ctx;
  return (
    <div className="flex h-full flex-col justify-center leading-tight">
      {ctx.layout === "narrow"
        ? <Link href={`/tenancy/${r.tenancyId}?tab=payments`} className="truncate font-medium hover:underline">{r.tenants}</Link>
        : <span className="truncate font-medium">{r.tenants}</span>}
      <span className="mt-1 truncate text-xs text-ink-3">
        {TYPE[r.kind]}, {dayLabel(r.date, ctx.today)}{r.effect === "failed" ? (r.kind === "payment" ? ", reversed" : ", failed") : ""}{r.fromPayPal ? ", from PayPal" : ""}
      </span>
    </div>
  );
}

function RowMenu(p: CustomCellRendererProps<LedgerRow>) {
  const r = p.data;
  if (!r) return null;
  const ctx = p.context as Ctx;
  const items: MenuItem[] = [
    { label: "Details", icon: "info", onSelect: () => ctx.open(r) },
    { label: "Open property", href: `/tenancy/${r.tenancyId}?tab=payments`, icon: "arrow-up-right" },
    ...(r.kind === "refund" || r.kind === "payout" ? [{ label: "View receipt", href: `/tenancy/${r.tenancyId}/refund`, icon: "doc" as const }] : []),
    ...(r.kind === "deduction" || r.kind === "refund" || r.kind === "payout" || r.kind === "outside_refund" ? [{ label: "Itemized statement", href: `/tenancy/${r.tenancyId}/statement`, icon: "doc" as const }] : []),
    // A settlement's receipt is the amended statement: the adjusted charges, who accepted and approved it, and the
    // PayPal id of the money it sent.
    ...(r.kind === "settlement" ? [
      { label: "View receipt", href: `/tenancy/${r.tenancyId}/statement`, icon: "doc" as const },
      { label: "Negotiation", href: `/tenancy/${r.tenancyId}?tab=move-out#negotiation`, icon: "split" as const },
    ] : []),
    ...(r.paypalId ? [{ label: "Copy PayPal ID", icon: "copy" as const, onSelect: () => { navigator.clipboard?.writeText(r.paypalId!).catch(() => {}); } }] : []),
    { divider: true },
    { label: "Only this property", icon: "building", onSelect: () => ctx.onlyProperty(r.tenancyId) },
  ];
  // A block the cell's height, so the button sits on the row's center line rather than the text baseline.
  return (
    <div className="flex h-full items-center justify-end">
      <Menu label={`More for ${TYPE[r.kind].toLowerCase()} ${shortDate(r.date)}`} items={items} portal />
    </div>
  );
}

/* ---------- The row checkboxes ---------- */

// Two of the grid's options, made once. AG Grid React compares each option by identity and applies one that changed:
// written inline they were new objects on every render, the grid rebuilt its checkbox column for each, that fired
// onDisplayedColumnsChanged, which set state, which rendered again, without end (the page never came to rest wherever
// the checkboxes show, which is every width but a phone's).
const ROW_SELECTION: RowSelectionOptions<LedgerRow> = { mode: "multiRow", checkboxes: true, headerCheckbox: true, enableClickSelection: false };
const SELECTION_COLUMN: SelectionColumnDef = { width: 48, minWidth: 48, maxWidth: 48, pinned: null, resizable: false, suppressHeaderMenuButton: true, suppressMovable: true };
const sameIds = (a: string[], b: string[]) => a.length === b.length && a.every((x, i) => x === b[i]);

/* ---------- Remembered columns ---------- */

const STORE = "gf.ledger.v2";
const colsKey = (view: View, layout: Layout) => `${STORE}.cols.${view}.${layout}`;
type SavedCol = Pick<ColumnState, "colId" | "width" | "hide" | "sort" | "sortIndex">;

/* ---------- The page body ---------- */

export function LedgerGrid({ rows, today, units, details, focusId, q, initialView, requestHref }: {
  rows: LedgerRow[];
  today: string;
  units: LedgerUnit[];
  details: Record<string, LedgerDetail>;
  focusId: string | null; // opened from one tenancy's page: start filtered to it
  q: string; // the top bar's search, on this page
  initialView: string | null; // ?view=, so a view can be linked to and survives a reload
  requestHref: string;
}) {
  const apiRef = useRef<GridApi<LedgerRow> | null>(null);
  // A PayPal report's moment, on the clock of the row's property (its state's zone; "EDT" and the like outside Pacific).
  const zones = useMemo(() => new Map(units.map((u) => [u.id, zoneOf(u.state)])), [units]);
  const atFor = useCallback((r: LedgerRow, ts: string) => atTextIn(ts, zones.get(r.tenancyId) ?? PACIFIC), [zones]);
  // Every row California's (its tags are subsections of Civ. Code 1950.5): the export's column keeps that name.
  const allCa = rows.every((r) => !r.tag || r.tag.startsWith("("));
  const [view, setView] = useState<View>(VIEWS.some((v) => v.key === initialView) ? initialView as View : "all");
  const [property, setProperty] = useState<string | null>(focusId && units.some((u) => u.id === focusId) ? focusId : null);
  const RANGES = useMemo(() => ranges(today), [today]);
  const [range, setRange] = useState<Range>(RANGES[0]);
  const [band, setBand] = useState<Band>(BANDS[0]);
  // The quick filter: as the landlord types, on every column (the hidden ones too). The top bar's search lands here.
  const [search, setSearch] = useState(q);
  const [lastQ, setLastQ] = useState(q);
  if (q !== lastQ) { setLastQ(q); setSearch(q); }
  const [shown, setShown] = useState(0);
  const [selected, setSelected] = useState(0);
  const [open, setOpen] = useState<LedgerRow | null>(null);
  const [shownCols, setShownCols] = useState<string[]>([]); // the Columns menu's checks follow the grid's own state
  // The view is in the address (?view=), so it can be linked to, comes back on a reload and goes back with Back.
  const choose = (v: View) => {
    setView(v);
    const url = new URL(window.location.href);
    if (v === "all") url.searchParams.delete("view"); else url.searchParams.set("view", v);
    window.history.replaceState(null, "", url);
  };

  // The columns follow the card's own width, not the window's: beside the sidebar a 1024px window leaves the grid
  // about 740px and a 1280px one about 990px. Wide shows the view's columns; compact (a 13-inch laptop) drops the
  // extras first; medium folds the type and date under the name; a phone keeps who, how much and the row's menu.
  const card = useRef<HTMLDivElement>(null);
  const [layout, setLayout] = useState<Layout>("wide");
  useEffect(() => {
    const el = card.current;
    if (!el) return;
    const ro = new ResizeObserver(([e]) => {
      const w = e.contentRect.width;
      setLayout(w < 600 ? "narrow" : w < 880 ? "medium" : w < 1060 ? "compact" : "wide");
    });
    ro.observe(el);
    return () => ro.disconnect();
  }, []);
  const narrow = layout === "narrow";
  const V = VIEWS.find((v) => v.key === view)!;

  // Every chip but the view, as one predicate: the view counts and the external filter both read it.
  const passesChips = useCallback((r: LedgerRow) =>
    (!property || r.tenancyId === property)
    && (!range.from || r.date >= range.from) && (!range.to || r.date <= range.to)
    && (band.min == null || r.amount >= band.min) && (band.max == null || r.amount < band.max), [property, range, band]);
  const filter = useRef({ has: V.has, passesChips });
  useEffect(() => {
    filter.current = { has: V.has, passesChips };
    apiRef.current?.onFilterChanged();
  }, [V, passesChips]);

  const counts = useMemo(() => {
    const c = Object.fromEntries(VIEWS.map((t) => [t.key, 0])) as Record<View, number>;
    for (const r of rows) if (passesChips(r)) for (const t of VIEWS) if (t.has(r)) c[t.key]++;
    return c;
  }, [rows, passesChips]);

  // A deposit reads Returned once its tenancy's refund or payout went back, and Partly returned while money went back
  // and more is still owed (owedBack).
  const back = useMemo(() => {
    const m = new Map<string, Back>();
    const byT = new Map<string, LedgerRow[]>();
    for (const r of rows) byT.set(r.tenancyId, [...(byT.get(r.tenancyId) ?? []), r]);
    for (const r of rows) {
      if (!BACK.includes(r.kind)) continue;
      if (r.effect === "returned") m.set(r.tenancyId, owedBack(byT.get(r.tenancyId)!) > 0.005 ? "partly" : "returned");
      else if (r.effect === "pending" && !m.has(r.tenancyId)) m.set(r.tenancyId, "pending");
    }
    return m;
  }, [rows]);

  // The tiles follow the property filter only: what is held is a running balance, so a date or amount filter would
  // make it read wrong.
  const tiles = useMemo(() => {
    const mine = rows.filter((r) => !property || r.tenancyId === property);
    const byT = new Map<string, LedgerRow[]>();
    for (const r of mine) byT.set(r.tenancyId, [...(byT.get(r.tenancyId) ?? []), r]);
    const holding = [...byT.values()].filter((xs) => ledgerTotals(xs).held > 0).length;
    const due = units.filter((u) => u.due && byT.has(u.id))
      // Forfeited deductions (New York after day 14): the whole deposit is owed, or the rest of it once a refund went.
      .map((u) => ({ u, amount: owedBack(byT.get(u.id)!), forfeited: byT.get(u.id)!.some((r) => r.effect === "forfeited"),
        rest: byT.get(u.id)!.some((r) => (r.kind === "refund" || r.kind === "payout" || r.kind === "outside_refund") && r.effect !== "failed") })).filter((x) => x.amount > 0)
      .sort((a, b) => a.u.due!.localeCompare(b.u.due!));
    return { held: ledgerTotals(mine).held, holding, due };
  }, [rows, units, property]);

  const onlyProperty = useCallback((id: string) => setProperty(id), []);
  const context = useMemo<Ctx>(() => ({ back, today, layout, onlyProperty, open: setOpen }), [back, today, layout, onlyProperty]);

  const recount = useCallback((api: GridApi<LedgerRow>) => {
    setShown(api.getDisplayedRowCount());
    setSelected(api.getSelectedRows().length);
  }, []);

  // Which of the view's columns this card has room for.
  const visible = useMemo(() => {
    if (layout === "narrow") return new Set<ColId>(["amount"]);
    if (layout === "medium") return new Set<ColId>(["unit", "status", "amount", ...V.cols.filter((c) => c === "paypalId" && view === "paypal")]);
    const max = layout === "compact" ? 6 : 99;
    const cols = [...V.cols];
    for (const d of DROP) if (cols.length > max && cols.includes(d)) cols.splice(cols.indexOf(d), 1);
    if (layout === "compact") { const i = cols.indexOf("method"); if (i >= 0) cols.splice(i, 1); }
    return new Set(cols);
  }, [layout, V, view]);

  /** This view's remembered columns, or the defaults when there are none. */
  const applySaved = useCallback((api: GridApi<LedgerRow>) => {
    const saved = browserStore.get<SavedCol[]>(colsKey(view, layout));
    if (saved?.length) api.applyColumnState({ state: saved, applyOrder: true, defaultState: { sort: null } });
    else api.applyColumnState({ state: [{ colId: "date", sort: "desc" }], defaultState: { sort: null } });
  }, [view, layout]);
  useEffect(() => { if (apiRef.current) applySaved(apiRef.current); }, [applySaved, visible]);

  const remember = useCallback(() => {
    const api = apiRef.current;
    if (!api) return;
    const state = api.getColumnState().map(({ colId, width, hide, sort, sortIndex }) => ({ colId, width, hide, sort, sortIndex }));
    browserStore.set(colsKey(view, layout), state);
  }, [view, layout]);

  const toggleColumn = (id: ColId) => {
    const api = apiRef.current;
    if (!api) return;
    const col = api.getColumn(id);
    api.setColumnsVisible([id], !col?.isVisible());
    remember();
  };
  const resetColumns = () => {
    browserStore.remove(colsKey(view, layout));
    apiRef.current?.resetColumnState();
    if (apiRef.current) applySaved(apiRef.current);
  };

  // The Columns menu's checks: set only when the columns shown really changed, so an event that changes nothing
  // renders nothing.
  const onDisplayedColumnsChanged = useCallback((e: DisplayedColumnsChangedEvent<LedgerRow>) => {
    const ids = e.api.getAllDisplayedColumns().map((c) => c.getColId());
    setShownCols((was) => (sameIds(was, ids) ? was : ids));
  }, []);

  const onGridReady = useCallback((e: GridReadyEvent<LedgerRow>) => {
    apiRef.current = e.api;
    applySaved(e.api);
    recount(e.api);
  }, [recount, applySaved]);

  const exportCsv = () => {
    const api = apiRef.current;
    if (!api) return;
    api.exportDataAsCsv({
      fileName: `good-faith-payments-${view}-${today}.csv`,
      onlySelected: api.getSelectedRows().length > 0,
      columnKeys: ["date", "type", "unit", "tenants", "detail", "method", "amount", "paypalId", "status", "source", "tag"],
      processHeaderCallback: (p: ProcessHeaderForExportParams<LedgerRow>) => {
        const id = p.column.getColId();
        return id === "tag" ? (allCa ? "Civ. Code 1950.5" : "Rule") : id === "unit" ? "Property" : id === "tenants" ? "Tenants" : id === "paypalId" ? "PayPal ID" : p.column.getColDef().headerName ?? id;
      },
      processCellCallback: (p: ProcessCellForExportParams<LedgerRow>) => {
        const r = p.node?.data;
        const col = p.column.getColId();
        if (!r) return csvSafe(p.value);
        if (col === "date") return r.date;
        if (col === "amount") return r.amount.toFixed(2);
        if (col === "unit") return csvSafe(r.address);
        if (col === "detail") return csvSafe(r.detail);
        if (col === "tag") return r.tag ? `${r.tag} ${r.tagLabel}` : "";
        if (col === "source") return r.fromPayPal ? `PayPal webhook, ${r.fromPayPal}` : sourceOf(r);
        return csvSafe(p.value);
      },
    });
  };

  const columnDefs = useMemo<ColDef<LedgerRow>[]>(() => {
    const on = (id: ColId) => visible.has(id);
    const oneLine = layout === "wide" || layout === "compact";
    const date: ColDef<LedgerRow> = {
      field: "date", headerName: "Date", width: 104, comparator: byTime, cellClass: "tabular-nums text-ink-2", hide: !oneLine || !on("date"),
      valueFormatter: (p: ValueFormatterParams<LedgerRow, string>) => (p.value ? dayLabel(p.value, today) : ""),
      getQuickFilterText: (p) => (p.value ? `${p.value} ${shortDate(p.value)}` : ""),
    };
    const who: ColDef<LedgerRow> = oneLine
      ? { colId: "tenants", field: "tenants", headerName: "To / From", flex: 1.25, minWidth: layout === "wide" ? 170 : 150, cellClass: "font-medium", tooltipField: "tenants", hide: !on("tenants") }
      // Shown in every view: a column definition that leaves `hide` out keeps whatever the wide layout set (the PayPal
      // events view hides To / From there), and the two-line cell is the row's name on a phone.
      : { colId: "tenants", field: "tenants", headerName: "To / From", flex: 1.2, minWidth: narrow ? 150 : 180, cellRenderer: WhoCell, tooltipField: "tenants", sortable: !narrow, hide: false };
    return [
      date,
      who,
      {
        colId: "type", headerName: "Type", width: layout === "wide" ? 132 : 124, hide: !oneLine || !on("type"),
        valueGetter: (p: ValueGetterParams<LedgerRow>) => (p.data ? TYPE[p.data.kind] : ""),
        // Each row's part of its state's deposit law (California: Civil Code 1950.5) is its type's tooltip, and a column of
        // the export.
        tooltipValueGetter: (p: ITooltipParams<LedgerRow>) => (p.data?.tag ? `${tagCite(p.data)}: ${p.data.tagLabel}` : null),
      },
      {
        colId: "unit", field: "unit", headerName: "Property", flex: 1, minWidth: layout === "wide" ? 170 : layout === "compact" ? 150 : 140, cellRenderer: PropertyCell, hide: !on("unit"),
        tooltipValueGetter: (p: ITooltipParams<LedgerRow>) => (p.data ? p.data.address : null),
        getQuickFilterText: (p) => (p.data ? `${p.data.unit} ${p.data.address}` : ""),
      },
      { colId: "method", field: "method", headerName: "Method", width: 120, cellRenderer: MethodCell, hide: !on("method") },
      {
        colId: "detail", field: "summary", headerName: "Detail", flex: 1.1, minWidth: 180, hide: !on("detail"), cellClass: "text-ink-2",
        tooltipValueGetter: (p: ITooltipParams<LedgerRow>) => (p.data ? cap(p.data.detail) : null),
        getQuickFilterText: (p) => (p.data ? p.data.detail : ""),
      },
      { colId: "paypalId", field: "paypalId", headerName: "PayPal ID", width: 176, cellRenderer: IdCell, hide: !on("paypalId") },
      {
        colId: "source", headerName: "Status from", width: 132, hide: !on("source"), cellClass: "text-ink-2",
        valueGetter: (p: ValueGetterParams<LedgerRow>) => (p.data ? sourceOf(p.data) : ""),
        tooltipValueGetter: (p: ITooltipParams<LedgerRow>) => (p.data?.fromPayPal ? `PayPal reported it ${atFor(p.data, p.data.fromPayPal)}` : null),
      },
      {
        colId: "tag", field: "tag", headerName: allCa ? "Civ. Code" : "Rule", width: 116, hide: !on("tag"), cellClass: "tabular-nums text-ink-2",
        valueFormatter: (p: ValueFormatterParams<LedgerRow, string>) => (p.data?.tag ? `${p.data.tag.startsWith("(") ? p.data.tag : p.data.tagShort}` : ""),
        tooltipValueGetter: (p: ITooltipParams<LedgerRow>) => (p.data?.tag ? `${tagCite(p.data)}: ${p.data.tagLabel}` : null),
        getQuickFilterText: (p) => (p.data ? `${p.data.tag} ${p.data.tagShort}` : ""),
      },
      {
        colId: "status", headerName: "Status", width: layout === "wide" ? 124 : 112, cellRenderer: StatusCell, valueGetter: statusGetter, hide: !on("status"),
        tooltipValueGetter: (p: ITooltipParams<LedgerRow>) => (p.data ? cap(p.data.detail) + (p.data.fromPayPal ? `. PayPal reported it ${atFor(p.data, p.data.fromPayPal)}.` : "") : null),
      },
      { colId: "amount", field: "amount", headerName: "Amount", width: narrow ? 116 : layout === "wide" ? 128 : 116, type: "rightAligned", cellRenderer: AmountCell, cellClass: "tabular-nums", sortable: !narrow },
      { ...MENU, width: narrow ? 40 : 52 },
    ];
  }, [layout, today, visible, narrow, allCa, atFor]);

  const defaultColDef = useMemo<ColDef<LedgerRow>>(() => ({
    sortable: true, resizable: true, suppressHeaderMenuButton: true, tooltipComponent: GridTip,
  }), []);

  // A click on a row (not on its link, menu or checkbox) and Enter on a focused cell open the row's details.
  const onCellClicked = useCallback((e: CellClickedEvent<LedgerRow>) => {
    const t = e.event?.target as HTMLElement | null;
    if (!e.data || t?.closest("a, button, input, [role=menu]") || e.column.getColId() === "menu") return;
    setOpen(e.data);
  }, []);
  const onCellKeyDown = useCallback((e: CellKeyDownEvent<LedgerRow>) => {
    // The row's menu, from its cell (the grid is one Tab stop).
    if (e.column.getColId() === "menu") {
      pressCellControl(e);
      return;
    }
    const k = (e.event as KeyboardEvent | undefined)?.key;
    if (k === "Enter" && e.data && e.column.getColId() !== "menu" && !(e.event?.target as HTMLElement | null)?.closest("button, a")) setOpen(e.data);
  }, []);

  // Past a screenful the grid gets a fixed height and renders only the rows in view (and a few either side), so a
  // few hundred rows scroll as fast as ten; a short list grows to fit, with no scroll box inside the page.
  const rowH = layout === "wide" || layout === "compact" ? 48 : 56;
  const virtual = shown > 24;

  const chip = "inline-flex h-[30px] items-center gap-1.5 rounded-sm border px-2.5 text-sm [&_svg]:size-[13px]";
  const off = `${chip} border-line bg-canvas text-ink-2 transition-colors hover:bg-surface [&_svg]:text-ink-4`;
  const onC = `${chip} border-brand-100 bg-brand-50 text-brand-700 [&_svg]:text-brand`;
  const unit = units.find((u) => u.id === property);
  const streets = new Map<string, number>();
  for (const u of units) streets.set(u.street, (streets.get(u.street) ?? 0) + 1);
  const anyChip = !!property || range.key !== "all" || band.key !== "any" || !!search;

  return (
    <>
      <div className="mb-5 flex flex-wrap items-center gap-x-4 gap-y-3">
        <h1 className="text-xl font-medium">Payments</h1>
        <div className="ml-auto flex items-center gap-2">
          <Menu label="Columns" align="end" width={220} buttonClass="inline-flex h-[34px] items-center gap-[7px] rounded-md bg-surface-2 px-3.5 text-sm font-medium text-ink transition-colors hover:bg-surface-3 max-sm:hidden"
            trigger={<><Icon name="columns" className="size-[15px]" />Columns</>}
            items={[
              { heading: `${V.label}: columns` },
              ...(narrow ? [] : OPTIONAL).map((o) => ({
                label: o.label, icon: shownCols.includes(o.id) ? "check" as const : undefined, checked: shownCols.includes(o.id), onSelect: () => toggleColumn(o.id),
              })),
              { divider: true },
              { label: "Reset columns", icon: "restart", onSelect: resetColumns },
            ]} />
          <Button onClick={exportCsv}>{selected ? `Export ${selected}` : "Export"}</Button>
          <ButtonLink variant="primary" href={requestHref}><Icon name="receive" />Request deposit</ButtonLink>
        </div>
      </div>

      <div className="mb-6 grid gap-3 sm:grid-cols-2">
        <Tile label={<>Deposits held<InfoTip title="Deposits held">What was collected, less the deductions on a statement that went out and less what went back. Draft deductions come out once the statement goes out.</InfoTip></>}
          value={tiles.held} sub={tiles.holding ? `${tiles.holding} ${tiles.holding === 1 ? "tenancy" : "tenancies"}` : "Nothing held"} />
        {tiles.due.length ? (
          <Tile label={`Due back by ${shortDate(tiles.due[0].u.due!)}`}
            value={tiles.due.reduce((s, x) => s + x.amount, 0)}
            sub={tiles.due.length === 1 ? `${tiles.due[0].u.street}, ${tiles.due[0].forfeited ? (tiles.due[0].rest ? "the rest of the deposit" : "the whole deposit") : "after deductions"}` : `${tiles.due.length} move-outs, the first at ${tiles.due[0].u.street}`} />
        ) : (
          <Tile label="Due back" value={0} sub="No move-out is waiting on a refund" />
        )}
      </div>

      <Tabs label="Views" active={view} onSelect={(k) => choose(k as View)}
        items={VIEWS.map((t) => ({ key: t.key, label: t.label, count: counts[t.key] }))} />

      <div className="mb-3.5 mt-5 flex flex-wrap items-center gap-2">
        <label className="relative flex min-w-0 items-center max-sm:w-full">
          <span className="sr-only">Filter these rows</span>
          <Icon name="search" className="pointer-events-none absolute left-2.5 size-[13px] text-ink-4" />
          <input type="search" value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Filter rows"
            className={`${inlineInputClass} h-[30px] w-[220px] pl-8 text-sm max-sm:w-full`} />
        </label>
        <Menu label={`Date range: ${range.label}`} align="start" width={200} buttonClass={range.key === "all" ? off : onC}
          trigger={<><Icon name="calendar" />{range.label}<Icon name="chev-down" /></>}
          items={RANGES.map((r) => ({ label: r.label, icon: r.key === range.key ? "check" as const : undefined, checked: r.key === range.key, radio: true, onSelect: () => setRange(r) }))} />
        <Menu label={`Property: ${unit ? unit.street : "All properties"}`} align="start" width={280} buttonClass={unit ? onC : off}
          trigger={<><Icon name="building" /><span className="max-w-[180px] truncate">{unit ? unit.street : "Property"}</span><Icon name="chev-down" /></>}
          items={[
            { label: "All properties", icon: !unit ? "check" : undefined, checked: !unit, radio: true, onSelect: () => setProperty(null) },
            { divider: true },
            ...units.map((u) => ({
              label: (streets.get(u.street) ?? 0) > 1 ? `${u.street} (${u.start ? `from ${shortDate(u.start)}` : u.tenants})` : u.street,
              icon: u.id === property ? "check" as const : undefined, checked: u.id === property, radio: true, onSelect: () => setProperty(u.id),
            })),
          ]} />
        <Menu label={band.key === "any" ? "Amount: Any amount" : `Amount: ${band.label}`} align="start" width={200} buttonClass={band.key === "any" ? off : onC}
          trigger={<>{band.key === "any" ? "Amount" : band.label}<Icon name="chev-down" /></>}
          items={BANDS.map((b) => ({ label: b.label, icon: b.key === band.key ? "check" as const : undefined, checked: b.key === band.key, radio: true, onSelect: () => setBand(b) }))} />
        {anyChip && (
          <Button variant="link" className="ml-1" onClick={() => { setProperty(null); setRange(RANGES[0]); setBand(BANDS[0]); setSearch(""); }}>Clear</Button>
        )}
      </div>

      <div ref={card} className="overflow-hidden rounded-lg border border-line bg-canvas shadow-sm">
        <AgGridProvider modules={MODULES}>
          <div style={virtual ? { height: 40 + 12 * rowH + 2 } : undefined}>
            <AgGridReact<LedgerRow>
              containerStyle={virtual ? { height: "100%" } : undefined}
              theme={gridTheme}
              rowData={rows}
              columnDefs={columnDefs}
              defaultColDef={defaultColDef}
              context={context}
              getRowId={(p) => p.data.id}
              quickFilterText={search}
              includeHiddenColumnsInQuickFilter
              cacheQuickFilter
              isExternalFilterPresent={() => true}
              doesExternalFilterPass={(n: IRowNode<LedgerRow>) => {
                const r = n.data;
                const f = filter.current;
                return !!r && f.has(r) && f.passesChips(r);
              }}
              rowSelection={narrow ? undefined : ROW_SELECTION}
              selectionColumnDef={SELECTION_COLUMN}
              rowHeight={layout === "wide" || layout === "compact" ? undefined : 56}
              domLayout={virtual ? "normal" : "autoHeight"}
              rowBuffer={8}
              ensureDomOrder
              suppressColumnVirtualisation
              animateRows={false}
              enableCellTextSelection
              tooltipShowDelay={300}
              overlayComponentParams={{ noMatchingRows: { overlayText: view === "paypal" ? "No PayPal records match. PayPal's reports show here as they arrive." : "No payments match these filters." } }}
              onGridReady={onGridReady}
              onModelUpdated={(e) => recount(e.api)}
              onSelectionChanged={(e) => recount(e.api)}
              onCellClicked={onCellClicked}
              {...gridTab}
              onCellKeyDown={onCellKeyDown}
              onColumnResized={(e: ColumnResizedEvent<LedgerRow>) => { if (e.finished && e.source === "uiColumnResized") remember(); }}
              onColumnMoved={(e: ColumnMovedEvent<LedgerRow>) => { if (e.finished && e.source === "uiColumnMoved") remember(); }}
              onSortChanged={(e: SortChangedEvent<LedgerRow>) => { if (e.source === "uiColumnSorted") remember(); }}
              onDisplayedColumnsChanged={onDisplayedColumnsChanged}
              getRowClass={() => "cursor-pointer"}
            />
          </div>
        </AgGridProvider>
        <div className="flex flex-wrap items-center gap-x-3 gap-y-1 border-t border-line px-5 py-3 text-xs text-ink-3">
          {selected ? (
            <span>{selected} selected<button type="button" onClick={() => apiRef.current?.deselectAll()} className="ml-2 font-medium text-brand hover:underline">Clear</button></span>
          ) : (
            <span className="tabular-nums">{shown} result{shown === 1 ? "" : "s"}</span>
          )}
          <span className="max-md:hidden">Click a row or press Enter for its details</span>
          <span className="ml-auto" title={`PayPal reports payments, refunds and payouts as they happen ("From PayPal" under a status), and opening a property refreshes its deposit. Hover a type for the part of ${allCa ? "Civil Code 1950.5" : "each property's state law"} behind it; the export lists it for every row.`}>
            Statuses as last checked
          </span>
        </div>
      </div>

      <Drawer open={!!open} onClose={() => setOpen(null)} title={open ? `${TYPE[open.kind]}, ${shortDate(open.date)}` : ""} sub={open ? `${open.unit}, ${open.tenants}` : undefined}>
        {open && <Details r={open} d={details[open.id]} status={statusOf(open, back)} at={(ts) => atFor(open, ts)} />}
      </Drawer>
    </>
  );
}

/** One row in full: the amount and its status, what it was and the rule behind it, every PayPal id with a copy button,
 *  where the status came from, and what PayPal's webhook said about it. */
function Details({ r, d, status, at }: { r: LedgerRow; d: LedgerDetail | undefined; status: string; at: (ts: string) => string }) {
  const section = "mt-6 border-t border-line-2 pt-4";
  return (
    <div>
      <div className="flex items-center gap-3">
        <RowMoney r={r} className="text-2xl font-medium" />
        {status === "Failed" || status === "Reversed" ? <StatusChip tone="red">{status}</StatusChip>
          : <StatusChip tone={status === "Completed" || status === "Paid" || status === "Returned" ? "green" : status === "Held" || status === "Demo example" ? "gray" : "amber"}>{status}</StatusChip>}
      </div>
      <p className="mt-2 text-sm text-ink-2">{cap(r.detail)}.</p>
      <KV className="mt-5" rows={[
        ["Date", longDate(r.date)],
        ["To / From", r.tenants],
        ["Property", <Link key="p" href={`/tenancy/${r.tenancyId}?tab=payments`} className="text-brand hover:underline">{r.address}</Link>],
        ["Method", r.method ?? "None"],
        ...(r.tag ? [["Rule", <span key="t" className="inline-flex items-center gap-1.5">{tagCite(r)}<InfoTip title={tagCite(r)}>{r.tagLabel}</InfoTip></span>] as [React.ReactNode, React.ReactNode]] : []),
      ]} />

      <div className={section}>
        <h3 className="flex items-center gap-1.5 text-sm font-medium"><PayPalMark size={14} />PayPal</h3>
        {d?.ids.length ? (
          <KV className="mt-3" rows={d.ids.map((x) => [x.label, <CopyId key={x.id} text={x.id} label={`Copy the ${x.label.toLowerCase()} id`} />])} />
        ) : (
          <p className="mt-2 text-sm text-ink-3">None. {r.kind === "deduction" ? "A deduction is on the statement, not in PayPal." : "PayPal holds no record of this row."}</p>
        )}
      </div>

      <div className={section}>
        <h3 className="text-sm font-medium">Status from</h3>
        <p className="mt-2 text-sm text-ink-2">{d?.source.text ?? sourceOf(r)}{d?.source.at ? `, ${at(d.source.at)}` : ""}.</p>
        {d?.source.event && (
          <KV className="mt-3" rows={[["Event", d.source.event.type], ["Event ID", <CopyId key="e" text={d.source.event.id} label="Copy the event id" />]]} />
        )}
      </div>

      {!!d?.events.length && (
        <div className={section}>
          <h3 className="text-sm font-medium">PayPal&apos;s webhook</h3>
          <ul className="mt-2">
            {d.events.map((e) => (
              <li key={e.id} className="flex items-start gap-3 border-b border-line-2 py-2.5 last:border-b-0">
                <span className={`mt-1.5 size-2 shrink-0 rounded-full ${e.status === "failed" ? "bg-red-dot" : e.status === "applied" ? "bg-green-dot" : "bg-amber-dot"}`} aria-hidden />
                <div className="min-w-0 flex-1">
                  <div className="text-sm font-medium">{e.type}</div>
                  <div className="text-xs text-ink-3">{e.note ?? cap(e.status)}</div>
                </div>
                <span className="shrink-0 text-xs text-ink-3">{at(e.at)}</span>
              </li>
            ))}
          </ul>
        </div>
      )}

      <div className="mt-6 flex flex-wrap gap-2">
        <ButtonLink href={`/tenancy/${r.tenancyId}?tab=payments`}><Icon name="arrow-up-right" />Open property</ButtonLink>
        {(r.kind === "deduction" || r.kind === "refund" || r.kind === "payout" || r.kind === "outside_refund" || r.kind === "settlement") && (
          <ButtonLink href={`/tenancy/${r.tenancyId}/statement`}><Icon name="doc" />Statement</ButtonLink>
        )}
      </div>
    </div>
  );
}

/** Each row's menu: its details, the property, the receipt, the statement, copy the PayPal id, filter to the property. */
const MENU: ColDef<LedgerRow> = {
  // Named for a screen reader, not shown.
  colId: "menu", headerName: "Actions", headerClass: "gf-header-sr", width: 52, sortable: false, resizable: false, suppressMovable: true, lockPosition: "right", cellRenderer: RowMenu,
  cellStyle: { display: "flex", alignItems: "center", justifyContent: "flex-end", paddingLeft: 0 },
};

const statusGetter = (p: ValueGetterParams<LedgerRow>) => (p.data ? statusOf(p.data, (p.context as Ctx).back) : "");

/** Newest first by the day, and within a day by the moment it was stored (an invoice before its payment). */
function byTime(_a: string, _b: string, na: IRowNode<LedgerRow>, nb: IRowNode<LedgerRow>) {
  const a = na.data, b = nb.data;
  if (!a || !b) return 0;
  return a.date === b.date ? Date.parse(a.at) - Date.parse(b.at) : a.date < b.date ? -1 : 1;
}

function Tile({ label, value, sub }: { label: React.ReactNode; value: number; sub: string }) {
  return (
    <div className="rounded-lg border border-line bg-canvas px-5 py-4">
      <div className="flex items-center gap-1.5 text-sm text-ink-3">{label}</div>
      <RollMoney quick value={value} cents="small" phoneCents="raised" className="mt-1 block text-xl font-medium" />
      <div className="mt-0.5 truncate text-xs text-ink-3">{sub}</div>
    </div>
  );
}

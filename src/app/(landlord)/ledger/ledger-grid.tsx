"use client";

import Link from "next/link";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { AgGridProvider, AgGridReact, type CustomCellRendererProps, type CustomTooltipProps } from "ag-grid-react";
import {
  AllCommunityModule, themeQuartz,
  type ColDef, type GridApi, type GridReadyEvent, type IRowNode, type ITooltipParams,
  type ProcessCellForExportParams, type ProcessHeaderForExportParams, type ValueFormatterParams, type ValueGetterParams,
} from "ag-grid-community";
import { dayLabel, shortDate } from "@/lib/dates";
import { Button, ButtonLink } from "@/components/button";
import { Icon, PayPalMark } from "@/components/icons";
import { InfoTip } from "@/components/info-tip";
import { Menu, type MenuItem } from "@/components/menu";
import { Tabs } from "@/components/tabs";
import { Money, StatusChip } from "@/components/ui";
import { ledgerTotals, owedBack, tagCite, type LedgerKind, type LedgerRow } from "@/lib/ledger";
import type { LedgerUnit } from "@/lib/ledger-load";

// Payments, as Mercury's and Stripe's transaction tables read: the page title with Export and Request deposit, two
// tiles (what is held, what is due back next), tabs by kind, filter chips, then one 48px line per money event in AG Grid
// Community: sorting, row selection, the external filter behind the tabs and chips, the quick filter behind the top
// bar's search, custom cells, tooltips and the CSV export. No license key and nothing from Enterprise; the modules go
// in through the provider so nothing runs on the server.
const modules = [AllCommunityModule];

// The design tokens by value (globals.css): the theme mixes them into its hover, selection and focus tints, which it
// cannot do from a var() reference. The grid draws no border of its own; the card around it does.
const theme = themeQuartz.withParams({
  accentColor: "#5e6ad2",
  backgroundColor: "#ffffff",
  foregroundColor: "#1b1d23",
  cellTextColor: "#1b1d23",
  borderColor: "#e6e8ee",
  wrapperBorder: false,
  wrapperBorderRadius: 0,
  rowBorder: { color: "#eff0f4" },
  headerRowBorder: { color: "#e6e8ee" },
  columnBorder: false,
  headerColumnBorder: false,
  headerColumnResizeHandleColor: "transparent",
  chromeBackgroundColor: "#ffffff",
  headerBackgroundColor: "#ffffff",
  headerCellHoverBackgroundColor: "#f7f8fa",
  headerTextColor: "#64697b",
  headerFontWeight: 500,
  headerFontSize: 12,
  headerHeight: 40,
  rowHeight: 48,
  autoHeightMinBodyHeight: 48, // room for the "no payments match" line, not the 150px default under a short list
  rowHoverColor: "#f7f8fa",
  selectedRowBackgroundColor: "#eef0fb",
  fontFamily: "var(--font-inter), system-ui, sans-serif",
  fontSize: 13,
  dataFontSize: 13,
  cellHorizontalPadding: 10,
  iconSize: 12,
  checkboxBorderRadius: 4,
  checkboxUncheckedBorderColor: "#c9ccd6",
  checkboxCheckedBackgroundColor: "#5e6ad2",
  checkboxCheckedBorderColor: "#5e6ad2",
  checkboxIndeterminateBackgroundColor: "#5e6ad2",
  checkboxIndeterminateBorderColor: "#5e6ad2",
});

/* ---------- Tabs, chips and what each row is ---------- */

type Tab = "all" | "deposits" | "refunds" | "requests" | "deductions";
const GROUP: Record<LedgerKind, Exclude<Tab, "all">> = {
  payment: "deposits", refund: "refunds", payout: "refunds", deposit_invoice: "requests", damage_invoice: "requests", deduction: "deductions", settlement: "refunds",
};
// All is money that moved: deposits in, refunds and payouts out. Invoices are requests, and deductions are what the
// statement keeps; each has its own tab.
const TABS: { key: Tab; label: string; has: (k: LedgerKind) => boolean }[] = [
  { key: "all", label: "All", has: (k) => GROUP[k] === "deposits" || GROUP[k] === "refunds" },
  { key: "deposits", label: "Deposits", has: (k) => GROUP[k] === "deposits" },
  { key: "refunds", label: "Refunds", has: (k) => GROUP[k] === "refunds" },
  { key: "requests", label: "Requests", has: (k) => GROUP[k] === "requests" },
  { key: "deductions", label: "Deductions", has: (k) => GROUP[k] === "deductions" },
];

/** The word the table shows for each kind (the deposit received reads "Deposit"; an invoice is a request). */
const TYPE: Record<LedgerKind, string> = {
  payment: "Deposit", refund: "Refund", payout: "Payout", deposit_invoice: "Deposit request", damage_invoice: "Balance request", deduction: "Deduction", settlement: "Settlement",
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
function statusOf(r: LedgerRow, back: Map<string, "returned" | "pending">): string {
  switch (r.kind) {
    case "payment": {
      if (r.effect === "failed") return "Reversed";
      const b = back.get(r.tenancyId);
      return b === "returned" ? "Returned" : b === "pending" ? "Refund pending" : "Held";
    }
    case "refund":
    case "payout":
    case "settlement": return r.example ? "Demo example" : r.effect === "returned" ? "Completed" : r.effect === "failed" ? "Failed" : "Pending";
    case "deposit_invoice":
    case "damage_invoice": return /^(paid|marked as paid)/.test(r.status) ? "Paid" : r.status === "sent, not paid" ? "Unpaid" : cap(r.status);
    default: return cap(r.status);
  }
}

/* ---------- Cells ---------- */

type Layout = "narrow" | "medium" | "compact" | "wide";
type Ctx = { back: Map<string, "returned" | "pending">; today: string; layout: Layout; onlyProperty: (id: string) => void };

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
  const m = r.effect === "failed" ? <Money value={r.amount} className="text-ink-3 line-through" />
    : r.kind === "payment" ? <Money value={r.amount} className="text-green" />
      : r.kind === "refund" || r.kind === "payout" || r.kind === "settlement" ? <Money value={r.amount} sign="minus" />
        : <Money value={r.amount} className="text-ink-2" />;
  return <div className="text-right">{m}</div>;
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
    { label: "Open property", href: `/tenancy/${r.tenancyId}?tab=payments`, icon: "arrow-up-right" },
    ...(r.kind === "refund" || r.kind === "payout" ? [{ label: "View receipt", href: `/tenancy/${r.tenancyId}/refund`, icon: "doc" as const }] : []),
    ...(r.kind === "deduction" || r.kind === "refund" || r.kind === "payout" ? [{ label: "Itemized statement", href: `/tenancy/${r.tenancyId}/statement`, icon: "doc" as const }] : []),
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

/** The grid's tooltips in the app's own dark tip. */
function GridTip(p: CustomTooltipProps) {
  return <div className="max-w-[300px] rounded-md bg-ink px-3 py-2 text-sm text-white shadow-md">{String(p.value ?? "")}</div>;
}

/* ---------- The page body ---------- */

export function LedgerGrid({ rows, today, units, focusId, q, requestHref }: {
  rows: LedgerRow[];
  today: string;
  units: LedgerUnit[];
  focusId: string | null; // opened from one tenancy's page: start filtered to it
  q: string; // the top bar's search, on this page
  requestHref: string;
}) {
  const apiRef = useRef<GridApi<LedgerRow> | null>(null);
  // Every row California's (its tags are subsections of Civ. Code 1950.5): the export's column keeps that name.
  const allCa = rows.every((r) => !r.tag || r.tag.startsWith("("));
  const [tab, setTab] = useState<Tab>("all");
  const [property, setProperty] = useState<string | null>(focusId && units.some((u) => u.id === focusId) ? focusId : null);
  const RANGES = useMemo(() => ranges(today), [today]);
  const [range, setRange] = useState<Range>(RANGES[0]);
  const [band, setBand] = useState<Band>(BANDS[0]);
  const [shown, setShown] = useState(0);
  const [selected, setSelected] = useState(0);
  // The columns follow the card's own width, not the window's: beside the sidebar a 1024px window leaves the grid
  // about 740px and a 1280px one about 990px. Wide shows every column; compact (a 13-inch laptop) drops only the
  // method, which is PayPal on every row; medium folds the type and date under the name; a phone keeps who, how much
  // and the row's menu.
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

  // Every chip but the tab, as one predicate: the tab counts and the external filter both read it.
  const passesChips = useCallback((r: LedgerRow) =>
    (!property || r.tenancyId === property)
    && (!range.from || r.date >= range.from) && (!range.to || r.date <= range.to)
    && (band.min == null || r.amount >= band.min) && (band.max == null || r.amount < band.max), [property, range, band]);
  const filter = useRef({ tab, passesChips });
  useEffect(() => {
    filter.current = { tab, passesChips };
    apiRef.current?.onFilterChanged();
  }, [tab, passesChips]);

  const counts = useMemo(() => {
    const c = Object.fromEntries(TABS.map((t) => [t.key, 0])) as Record<Tab, number>;
    for (const r of rows) if (passesChips(r)) for (const t of TABS) if (t.has(r.kind)) c[t.key]++;
    return c;
  }, [rows, passesChips]);

  // A deposit reads Returned once its tenancy's refund or payout went back.
  const back = useMemo(() => {
    const m = new Map<string, "returned" | "pending">();
    for (const r of rows) {
      if (r.kind !== "refund" && r.kind !== "payout") continue;
      if (r.effect === "returned") m.set(r.tenancyId, "returned");
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
      .map((u) => ({ u, amount: owedBack(byT.get(u.id)!) })).filter((x) => x.amount > 0)
      .sort((a, b) => a.u.due!.localeCompare(b.u.due!));
    return { held: ledgerTotals(mine).held, holding, due };
  }, [rows, units, property]);

  const onlyProperty = useCallback((id: string) => setProperty(id), []);
  const context = useMemo<Ctx>(() => ({ back, today, layout, onlyProperty }), [back, today, layout, onlyProperty]);

  const recount = useCallback((api: GridApi<LedgerRow>) => {
    setShown(api.getDisplayedRowCount());
    setSelected(api.getSelectedRows().length);
  }, []);

  const onGridReady = useCallback((e: GridReadyEvent<LedgerRow>) => {
    apiRef.current = e.api;
    recount(e.api);
  }, [recount]);

  const exportCsv = () => {
    const api = apiRef.current;
    if (!api) return;
    api.exportDataAsCsv({
      fileName: `good-faith-payments-${today}.csv`,
      onlySelected: api.getSelectedRows().length > 0,
      columnKeys: ["date", "type", "unit", "tenants", "detail", "method", "amount", "paypalId", "status", "tag"],
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
        if (col === "tag") return r.tag ? `${r.tag} ${r.tagLabel}` : "";
        return csvSafe(p.value);
      },
    });
  };

  const columnDefs = useMemo<ColDef<LedgerRow>[]>(() => {
    const date: ColDef<LedgerRow> = {
      field: "date", headerName: "Date", width: 104, sort: "desc", comparator: byTime, cellClass: "tabular-nums text-ink-2",
      valueFormatter: (p: ValueFormatterParams<LedgerRow, string>) => (p.value ? dayLabel(p.value, today) : ""),
      getQuickFilterText: (p) => (p.value ? `${p.value} ${shortDate(p.value)}` : ""),
    };
    const type: ColDef<LedgerRow> = {
      colId: "type", headerName: "Type", width: layout === "wide" ? 132 : 124, hide: layout === "medium",
      valueGetter: (p: ValueGetterParams<LedgerRow>) => (p.data ? TYPE[p.data.kind] : ""),
      // Each row's part of its state's deposit law (California: Civil Code 1950.5) is its type's tooltip, and a column of
      // the export.
      tooltipValueGetter: (p: ITooltipParams<LedgerRow>) => (p.data?.tag ? `${tagCite(p.data)}: ${p.data.tagLabel}` : null),
    };
    const amount: ColDef<LedgerRow> = { field: "amount", headerName: "Amount", width: 128, type: "rightAligned", cellRenderer: AmountCell, cellClass: "tabular-nums" };
    if (layout === "narrow") {
      return [
        { colId: "who", field: "tenants", headerName: "To / From", flex: 1, minWidth: 150, cellRenderer: WhoCell, sortable: false },
        { ...amount, width: 116, sortable: false },
        { ...MENU, width: 40 },
        // Off screen, for the sort and the export.
        { ...date, hide: true }, { ...type, hide: true },
        { field: "unit", hide: true }, { field: "method", hide: true }, { colId: "status", hide: true, valueGetter: statusGetter },
        ...HIDDEN,
      ];
    }
    const oneLine = layout !== "medium"; // wide or compact: one 48px line per row, as the mockup's table
    return [
      { ...date, hide: !oneLine },
      oneLine
        ? { field: "tenants", headerName: "To / From", flex: 1.25, minWidth: layout === "wide" ? 170 : 150, cellClass: "font-medium", tooltipField: "tenants" }
        : { field: "tenants", headerName: "To / From", flex: 1.2, minWidth: 180, cellRenderer: WhoCell, tooltipField: "tenants" },
      type,
      {
        field: "unit", headerName: "Property", flex: 1, minWidth: layout === "wide" ? 170 : layout === "compact" ? 150 : 140, cellRenderer: PropertyCell,
        tooltipValueGetter: (p: ITooltipParams<LedgerRow>) => (p.data ? p.data.address : null),
        getQuickFilterText: (p) => (p.data ? `${p.data.unit} ${p.data.address}` : ""),
      },
      { field: "method", headerName: "Method", width: 120, cellRenderer: MethodCell, hide: layout !== "wide" },
      {
        colId: "status", headerName: "Status", width: layout === "wide" ? 124 : 112, cellRenderer: StatusCell, valueGetter: statusGetter,
        tooltipValueGetter: (p: ITooltipParams<LedgerRow>) => (p.data ? cap(p.data.detail) : null),
      },
      { ...amount, width: layout === "wide" ? 128 : 116 },
      MENU,
      ...HIDDEN,
    ];
  }, [layout, today]);

  const defaultColDef = useMemo<ColDef<LedgerRow>>(() => ({
    sortable: true, resizable: true, suppressHeaderMenuButton: true, tooltipComponent: GridTip,
  }), []);

  const chip = "inline-flex h-[30px] items-center gap-1.5 rounded-sm border px-2.5 text-sm [&_svg]:size-[13px]";
  const off = `${chip} border-line bg-canvas text-ink-2 hover:bg-surface [&_svg]:text-ink-4`;
  const on = `${chip} border-brand-100 bg-brand-50 text-brand-700 [&_svg]:text-brand`;
  const unit = units.find((u) => u.id === property);
  const streets = new Map<string, number>();
  for (const u of units) streets.set(u.street, (streets.get(u.street) ?? 0) + 1);
  const anyChip = !!property || range.key !== "all" || band.key !== "any";

  return (
    <>
      <div className="mb-5 flex flex-wrap items-center gap-x-4 gap-y-3">
        <h1 className="text-xl font-medium">Payments</h1>
        <div className="ml-auto flex items-center gap-2">
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
            sub={tiles.due.length === 1 ? `${tiles.due[0].u.street}, after deductions` : `${tiles.due.length} move-outs, the first at ${tiles.due[0].u.street}`} />
        ) : (
          <Tile label="Due back" value={0} sub="No move-out is waiting on a refund" />
        )}
      </div>

      <Tabs label="Payment types" active={tab} onSelect={(k) => setTab(k as Tab)}
        items={TABS.map((t) => ({ key: t.key, label: t.label, count: counts[t.key] }))} />

      <div className="mb-3.5 mt-5 flex flex-wrap items-center gap-2">
        <Menu label="Date range" align="start" width={200} buttonClass={range.key === "all" ? off : on}
          trigger={<><Icon name="calendar" />{range.label}<Icon name="chev-down" /></>}
          items={RANGES.map((r) => ({ label: r.label, icon: r.key === range.key ? "check" as const : undefined, onSelect: () => setRange(r) }))} />
        <Menu label="Property" align="start" width={280} buttonClass={unit ? on : off}
          trigger={<><Icon name="building" /><span className="max-w-[180px] truncate">{unit ? unit.street : "Property"}</span><Icon name="chev-down" /></>}
          items={[
            { label: "All properties", icon: !unit ? "check" : undefined, onSelect: () => setProperty(null) },
            { divider: true },
            ...units.map((u) => ({
              label: (streets.get(u.street) ?? 0) > 1 ? `${u.street} (${u.start ? `from ${shortDate(u.start)}` : u.tenants})` : u.street,
              icon: u.id === property ? "check" as const : undefined, onSelect: () => setProperty(u.id),
            })),
          ]} />
        <Menu label="Amount" align="start" width={200} buttonClass={band.key === "any" ? off : on}
          trigger={<>{band.key === "any" ? "Amount" : band.label}<Icon name="chev-down" /></>}
          items={BANDS.map((b) => ({ label: b.label, icon: b.key === band.key ? "check" as const : undefined, onSelect: () => setBand(b) }))} />
        {q && (
          <Link href={property ? `/ledger?tenancy=${property}` : "/ledger"} className={on} aria-label={`Clear the search for ${q}`}>
            <Icon name="search" /><span className="max-w-[160px] truncate">{q}</span><Icon name="x" />
          </Link>
        )}
        {anyChip && (
          <Button variant="link" className="ml-1" onClick={() => { setProperty(null); setRange(RANGES[0]); setBand(BANDS[0]); }}>Clear</Button>
        )}
      </div>

      <div ref={card} className="overflow-hidden rounded-lg border border-line bg-canvas shadow-sm">
        <AgGridProvider modules={modules}>
          <AgGridReact<LedgerRow>
            theme={theme}
            rowData={rows}
            columnDefs={columnDefs}
            defaultColDef={defaultColDef}
            context={context}
            getRowId={(p) => p.data.id}
            quickFilterText={q}
            includeHiddenColumnsInQuickFilter
            isExternalFilterPresent={() => true}
            doesExternalFilterPass={(n: IRowNode<LedgerRow>) => {
              const r = n.data;
              const f = filter.current;
              return !!r && TABS.find((t) => t.key === f.tab)!.has(r.kind) && f.passesChips(r);
            }}
            rowSelection={narrow ? undefined : { mode: "multiRow", checkboxes: true, headerCheckbox: true, enableClickSelection: false }}
            selectionColumnDef={{ width: 48, minWidth: 48, maxWidth: 48, pinned: null, resizable: false, suppressHeaderMenuButton: true }}
            rowHeight={layout === "wide" || layout === "compact" ? undefined : 56}
            domLayout="autoHeight"
            suppressColumnVirtualisation
            animateRows={false}
            suppressCellFocus
            enableCellTextSelection
            tooltipShowDelay={300}
            overlayComponentParams={{ noMatchingRows: { overlayText: "No payments match these filters." } }}
            onGridReady={onGridReady}
            onModelUpdated={(e) => recount(e.api)}
            onSelectionChanged={(e) => recount(e.api)}
          />
        </AgGridProvider>
        <div className="flex flex-wrap items-center gap-x-3 gap-y-1 border-t border-line px-5 py-3 text-xs text-ink-3">
          {selected ? (
            <span>{selected} selected<button type="button" onClick={() => apiRef.current?.deselectAll()} className="ml-2 font-medium text-brand hover:underline">Clear</button></span>
          ) : (
            <span className="tabular-nums">{shown} result{shown === 1 ? "" : "s"}</span>
          )}
          <span className="ml-auto" title={`PayPal reports payments, refunds and payouts as they happen ("From PayPal" under a status), and opening a property refreshes its deposit. Hover a type for the part of ${allCa ? "Civil Code 1950.5" : "each property's state law"} behind it; the export lists it for every row.`}>
            Statuses as last checked
          </span>
        </div>
      </div>
    </>
  );
}

/** Each row's menu: open the property, the receipt, the statement, copy the PayPal id, filter to the property. */
const MENU: ColDef<LedgerRow> = {
  colId: "menu", headerName: "", width: 52, sortable: false, resizable: false, cellRenderer: RowMenu,
  cellStyle: { display: "flex", alignItems: "center", justifyContent: "flex-end", paddingLeft: 0 },
};

const statusGetter = (p: ValueGetterParams<LedgerRow>) => (p.data ? statusOf(p.data, (p.context as Ctx).back) : "");

/** Columns off screen that the export and the search still read. */
const HIDDEN: ColDef<LedgerRow>[] = [
  { field: "detail", headerName: "Detail", hide: true },
  { field: "paypalId", headerName: "PayPal ID", hide: true },
  { field: "tag", headerName: "Civ. Code", hide: true, getQuickFilterText: (p) => (p.data ? `${p.data.tag} ${p.data.tagShort}` : "") },
];

/** Newest first by the day, and within a day by the moment it was stored (an invoice before its payment). */
function byTime(_a: string, _b: string, na: IRowNode<LedgerRow>, nb: IRowNode<LedgerRow>) {
  const a = na.data, b = nb.data;
  if (!a || !b) return 0;
  return a.date === b.date ? Date.parse(a.at) - Date.parse(b.at) : a.date < b.date ? -1 : 1;
}

/** Spreadsheets run a cell that starts with = + - @ or a tab as a formula, so such a value gets a leading apostrophe. */
const csvSafe = (v: unknown) => {
  const s = v == null ? "" : String(v);
  return /^[=+\-@\t\r]/.test(s) ? `'${s}` : s;
};

function Tile({ label, value, sub }: { label: React.ReactNode; value: number; sub: string }) {
  return (
    <div className="rounded-lg border border-line bg-canvas px-5 py-4">
      <div className="flex items-center gap-1.5 text-sm text-ink-3">{label}</div>
      <Money value={value} cents="small" phoneCents="raised" className="mt-1 block text-xl font-medium" />
      <div className="mt-0.5 truncate text-xs text-ink-3">{sub}</div>
    </div>
  );
}

"use client";

import Link from "next/link";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { AgGridProvider, AgGridReact, type CustomCellRendererProps } from "ag-grid-react";
import {
  AllCommunityModule, themeQuartz,
  type ColDef, type ColSpanParams, type FilterChangedEvent, type GridApi, type GridReadyEvent, type ITooltipParams,
  type ProcessCellForExportParams, type ValueFormatterParams,
} from "ag-grid-community";
import { shortDate } from "@/lib/dates";
import { usd } from "@/lib/deductions";
import { Button } from "@/components/button";
import { Icon } from "@/components/icons";
import { InfoTip } from "@/components/info-tip";
import { Fact, FactStrip, Money } from "@/components/ui";
import { KIND_TONE, ledgerTotals, type LedgerRow } from "@/lib/ledger";
import type { LedgerUnit } from "@/lib/ledger-load";

// AG Grid Community only. The quick filter, the text, number and date column filters, the pinned total row and the CSV
// export are all in the free build, so there is no license key and nothing from Enterprise. Modules go in through the
// provider rather than a global registry so nothing runs on the server.
const modules = [AllCommunityModule];

// The app's tokens from globals.css, by value: the theme mixes these into its hover and focus tints, which it cannot
// do from a var() reference. Keep them in step with :root there.
const theme = themeQuartz.withParams({
  accentColor: "#5e6ad2",
  backgroundColor: "#ffffff",
  foregroundColor: "#1b1d23",
  borderColor: "#e6e8ee",
  rowBorder: { color: "#eff0f4" },
  chromeBackgroundColor: "#ffffff",
  headerBackgroundColor: "#ffffff",
  headerTextColor: "#6e7385",
  headerFontWeight: 500,
  headerFontSize: 12,
  rowHoverColor: "#f7f8fa",
  fontFamily: "var(--font-inter), system-ui, sans-serif",
  fontSize: 13,
  spacing: 6,
  borderRadius: 8,
  wrapperBorderRadius: 10,
  rowVerticalPaddingScale: 1.15,
  pinnedRowBackgroundColor: "#f7f8fa",
  pinnedRowFontWeight: 500,
});

// The CSV carries every column, the two the grid folds into the unit cell (tenants) or hides on a phone included.
const COLUMN_KEYS = ["date", "type", "unit", "tenants", "detail", "amount", "paypalId", "status", "tag"];
// Opening the ledger from one tenancy's page filters on the tenancy id, not the address: a unit re-let to new tenants
// keeps its address, and the old tenants' money must not show under the new ones.
const FOCUS = "tenancyId";

/** The date filter compares calendar days: the cell holds a YYYY-MM-DD and the picker gives local midnight. */
function dateComparator(filterDate: Date, cell: string | null | undefined): number {
  if (!cell) return -1;
  const [y, m, d] = cell.split("-").map(Number);
  const v = new Date(y, m - 1, d).getTime(), f = filterDate.getTime();
  return v < f ? -1 : v > f ? 1 : 0;
}

/** Spreadsheets run a cell that starts with = + - @ or a tab as a formula, so such a value gets a leading apostrophe. */
const csvSafe = (v: unknown) => {
  const s = v == null ? "" : String(v);
  return /^[=+\-@\t\r]/.test(s) ? `'${s}` : s;
};

/** The unit's street line with the tenants under it; the tooltip and the CSV carry the whole address. */
function UnitCell(p: CustomCellRendererProps<LedgerRow, string>) {
  if (!p.data || p.node.rowPinned) return null;
  return (
    <div className="py-1 leading-snug">
      <Link href={`/tenancy/${p.data.tenancyId}`} className="text-sm font-medium text-ink hover:underline">{p.value}</Link>
      <div className="text-xs text-ink-3">{p.data.tenants}</div>
    </div>
  );
}

function TypeCell(p: CustomCellRendererProps<LedgerRow, string>) {
  if (!p.data || p.node.rowPinned || !p.value) return null;
  return <span className={`inline-flex h-[22px] items-center rounded-sm px-2 text-xs font-medium ${KIND_TONE[p.data.kind]}`}>{p.value}</span>;
}

/** Text that wraps at the unit cell's line spacing rather than the row's (a wrapped cell otherwise inherits the
 *  single-line row height as its line height and reads double spaced). */
function WrapCell(p: CustomCellRendererProps<LedgerRow, string>) {
  return <div className="py-1 text-sm leading-snug">{p.value}</div>;
}

/** Status as plain text with a capital, as Mercury's table reads ("Paid, refund sent"). */
function StatusCell(p: CustomCellRendererProps<LedgerRow, string>) {
  const v = p.value ?? "";
  return <div className="py-1 text-sm leading-snug">{v.charAt(0).toUpperCase() + v.slice(1)}</div>;
}

export function LedgerGrid({ rows, today, focus }: { rows: LedgerRow[]; today: string; focus: LedgerUnit | null }) {
  const apiRef = useRef<GridApi<LedgerRow> | null>(null);
  const [quick, setQuick] = useState("");
  const [totals, setTotals] = useState(() => ledgerTotals(focus ? rows.filter((r) => r.tenancyId === focus.id) : rows));
  const [focusId, setFocusId] = useState<string | null>(focus?.id ?? null);
  const [filtered, setFiltered] = useState(false);
  // On a phone the PayPal id column folds away (the CSV still has it) so date, type and amount fit.
  const [narrow, setNarrow] = useState(false);
  useEffect(() => {
    const mq = window.matchMedia("(max-width: 639px)");
    const on = () => setNarrow(mq.matches);
    on();
    mq.addEventListener("change", on);
    return () => mq.removeEventListener("change", on);
  }, []);

  // The totals follow whatever the filters leave showing, so "Still held" answers for one unit as well as for all.
  const recount = useCallback((api: GridApi<LedgerRow>) => {
    const shown: LedgerRow[] = [];
    api.forEachNodeAfterFilter((n) => { if (n.data) shown.push(n.data); });
    setTotals(ledgerTotals(shown));
    const model = api.getFilterModel() as Record<string, { type?: string; filter?: unknown }>;
    const f = model[FOCUS];
    setFocusId(f?.type === "equals" && typeof f.filter === "string" ? f.filter : null);
    setFiltered(Object.keys(model).some((k) => k !== FOCUS));
  }, []);

  const onGridReady = useCallback((e: GridReadyEvent<LedgerRow>) => {
    apiRef.current = e.api;
    // Opened from one tenancy's page: start on that tenancy, as an ordinary column filter the landlord can clear.
    if (focus) e.api.setFilterModel({ [FOCUS]: { filterType: "text", type: "equals", filter: focus.id } });
    recount(e.api);
  }, [focus, recount]);

  const onFilterChanged = useCallback((e: FilterChangedEvent<LedgerRow>) => recount(e.api), [recount]);

  const clearFocus = () => {
    const api = apiRef.current;
    if (!api) return;
    const rest = { ...api.getFilterModel() };
    delete rest[FOCUS];
    api.setFilterModel(Object.keys(rest).length ? rest : null);
  };

  /** Every column filter and the search go, the unit focus stays (its chip has its own way out). */
  const clearFilters = () => {
    const api = apiRef.current;
    if (!api) return;
    const model = api.getFilterModel();
    api.setFilterModel(model[FOCUS] ? { [FOCUS]: model[FOCUS] } : null);
    setQuick("");
  };

  const exportCsv = () => {
    apiRef.current?.exportDataAsCsv({
      fileName: `deposit-ledger-${today}.csv`,
      columnKeys: COLUMN_KEYS,
      skipPinnedBottom: true,
      processHeaderCallback: (p) => (p.column.getColId() === "tag" ? "Civ. Code 1950.5" : p.column.getColDef().headerName ?? p.column.getColId()),
      processCellCallback: (p: ProcessCellForExportParams<LedgerRow>) => {
        const col = p.column.getColId();
        if (col === "amount") return p.value == null ? "" : Number(p.value).toFixed(2);
        if (col === "unit" && p.node?.data) return csvSafe(p.node.data.address);
        if (col === "tag" && p.node?.data) return `${p.value} ${p.node.data.tagLabel}`;
        return csvSafe(p.value);
      },
    });
  };

  // The fixed widths and the two flex minimums add up to 1034px, inside the 1150px the grid has at 1440 beside the
  // sidebar and the page gutters, so every column is on screen without a horizontal scroll and nothing is cut short: the
  // unit, detail and status cells wrap and the rows grow to fit, and a 24-character PayPal id fits its column
  // in the app font. The amount is pinned on the right, so a phone, which scrolls the rest sideways, still shows every
  // figure and the total.
  const columnDefs = useMemo<ColDef<LedgerRow>[]>(() => [
    { field: FOCUS, hide: true, filter: "agTextColumnFilter" },
    { field: "tenants", headerName: "Tenants", hide: true },
    {
      field: "date", headerName: "Date", width: 104, minWidth: 104, sort: "asc", cellDataType: "text", cellClass: "tabular-nums",
      filter: "agDateColumnFilter", filterParams: { comparator: dateComparator, browserDatePicker: true, buttons: ["reset"], maxNumConditions: 1 },
      valueFormatter: (p: ValueFormatterParams<LedgerRow, string>) => (p.node?.rowPinned ? p.value ?? "" : p.value ? shortDate(p.value) : ""),
      colSpan: (p: ColSpanParams<LedgerRow>) => (p.node?.rowPinned ? 2 : 1),
      getQuickFilterText: (p) => (p.value ? `${p.value} ${shortDate(p.value)}` : ""),
    },
    {
      // Each row's part of Civil Code 1950.5 is the type's tooltip (and a column of the CSV), not a column on screen.
      field: "type", headerName: "Type", width: 130, minWidth: 130, filter: "agTextColumnFilter", cellRenderer: TypeCell,
      tooltipValueGetter: (p: ITooltipParams<LedgerRow>) => (p.data && !p.node?.rowPinned && p.data.tag ? `Civ. Code 1950.5${p.data.tag}: ${p.data.tagLabel}` : null),
    },
    {
      field: "unit", headerName: "Unit", flex: 1, minWidth: 170, filter: "agTextColumnFilter", cellRenderer: UnitCell, autoHeight: true, wrapText: true,
      tooltipValueGetter: (p: ITooltipParams<LedgerRow>) => (p.data && !p.node?.rowPinned ? `${p.data.address}. ${p.data.tenants}` : null),
      getQuickFilterText: (p) => (p.data ? `${p.data.unit} ${p.data.address} ${p.data.tenants}` : ""),
    },
    { field: "detail", headerName: "Detail", flex: 1.3, minWidth: 200, filter: "agTextColumnFilter", cellRenderer: WrapCell, wrapText: true, autoHeight: true },
    { field: "paypalId", headerName: "PayPal id", width: 180, minWidth: 180, hide: narrow, filter: "agTextColumnFilter", cellClass: "text-xs" },
    { field: "status", headerName: "Status", width: 140, minWidth: 140, filter: "agTextColumnFilter", cellRenderer: StatusCell, wrapText: true, autoHeight: true },
    {
      // Hidden on screen; the CSV spells it out (processHeaderCallback above) and the search still finds it.
      field: "tag", headerName: "Civ. Code", hide: true,
      getQuickFilterText: (p) => (p.data ? `${p.data.tag} ${p.data.tagShort}` : ""),
    },
    {
      field: "amount", headerName: "Amount", width: 110, minWidth: 110, pinned: "right", type: "rightAligned", cellClass: "tabular-nums font-medium",
      filter: "agNumberColumnFilter", valueFormatter: (p: ValueFormatterParams<LedgerRow, number>) => (p.value == null ? "" : usd(p.value)),
    },
  ], [narrow]);

  const defaultColDef = useMemo<ColDef<LedgerRow>>(() => ({
    sortable: true, resizable: true, filterParams: { buttons: ["reset"], maxNumConditions: 1 },
  }), []);

  // The last line of the grid: what the rows showing still hold for the tenants (the tiles above break it down). It is
  // left out of the CSV.
  const pinnedBottom = useMemo<LedgerRow[]>(() => [{
    id: "total", date: "Still held", at: "", tenancyId: "", unit: "", address: "", tenants: "", kind: "payment", type: "",
    detail: `${totals.count} event${totals.count === 1 ? "" : "s"} shown`,
    amount: totals.held, signed: 0, effect: "none", paypalId: null, status: "", tag: "", tagShort: "", tagLabel: "",
  }], [totals]);

  const focusLabel = focusId ? (focus?.id === focusId ? focus.label : rows.find((r) => r.tenancyId === focusId)?.unit ?? "one unit") : null;

  return (
    <section>
      <FactStrip cols={4}>
        <Fact label="Collected" value={<Money value={totals.collected} />} />
        <Fact label="Deductions" value={<Money value={totals.deducted} />}
          sub={totals.drafted > 0 ? (totals.drafted === totals.deducted ? "All drafts" : `${usd(totals.drafted)} drafted`) : undefined} />
        <Fact label="Returned" value={<Money value={totals.returned} />} sub={totals.pending > 0 ? `${usd(totals.pending)} pending` : undefined} />
        <Fact label="Still held" big value={<Money value={totals.held} cents="small" />}
          info={<InfoTip align="end" title="Still held">What was collected, less the deductions on a statement that went out and less what went back. Drafts come out once the statement goes out.</InfoTip>} />
      </FactStrip>

      <div className="mt-6 flex flex-wrap items-center gap-3">
        <label className="flex h-9 min-w-0 flex-1 basis-56 items-center gap-2 rounded-md border border-line bg-canvas px-3 text-ink-4 focus-within:border-brand focus-within:ring-3 focus-within:ring-brand-50">
          <Icon name="search" className="size-[15px]" />
          <input
            type="search" value={quick} onChange={(e) => setQuick(e.target.value)} aria-label="Search the ledger"
            placeholder="Search units, tenants, items, PayPal ids"
            className="h-full min-w-0 flex-1 bg-transparent text-sm text-ink outline-none placeholder:text-ink-4"
          />
        </label>
        <span className="flex items-center gap-2 text-sm tabular-nums text-ink-3">
          {totals.count} of {rows.length} events
          {(quick || filtered) && <Button variant="link" onClick={clearFilters}>Clear filters</Button>}
          <InfoTip align="end" title="Filters and statuses">
            Filter any column from its header menu; the totals follow the filters. Statuses are as last stored, and opening a unit
            refreshes them from PayPal. Hover a type for the part of Civil Code 1950.5 behind the row; the export lists it for every row.
          </InfoTip>
        </span>
        <Button onClick={exportCsv}><Icon name="download" />Export CSV</Button>
      </div>
      {focusLabel && (
        <p className="mt-3 flex flex-wrap items-center gap-2 text-sm text-ink-2">
          Showing {focusLabel}<Button variant="link" onClick={clearFocus}>Show every unit</Button>
        </p>
      )}

      <div className="mt-4 min-w-0">
        <AgGridProvider modules={modules}>
          <AgGridReact<LedgerRow>
            theme={theme}
            rowData={rows}
            columnDefs={columnDefs}
            defaultColDef={defaultColDef}
            getRowId={(p) => p.data.id}
            quickFilterText={quick}
            pinnedBottomRowData={pinnedBottom}
            domLayout="autoHeight"
            suppressColumnVirtualisation
            animateRows={false}
            suppressCellFocus
            enableCellTextSelection
            tooltipShowDelay={300}
            overlayComponentParams={{ noMatchingRows: { overlayText: "No events match these filters." } }}
            onGridReady={onGridReady}
            onFilterChanged={onFilterChanged}
          />
        </AgGridProvider>
      </div>
    </section>
  );
}

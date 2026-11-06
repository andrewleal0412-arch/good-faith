"use client";

import Link from "@/components/link";
import { forwardRef, useCallback, useEffect, useImperativeHandle, useMemo, useRef, useState } from "react";
import { AgGridProvider, AgGridReact, type CustomCellRendererProps } from "ag-grid-react";
import type {
  ColDef, GetRowIdParams, GridApi, IRowNode, ITooltipParams, PostSortRowsParams, ProcessCellForExportParams, RowClassParams, ValueGetterParams,
} from "ag-grid-community";
import { CsvExportModule, ExternalFilterModule, PinnedRowModule, RenderApiModule } from "ag-grid-community";
import { browserStore, csvSafe, GridTip, gridModules, gridTab, gridTheme, pressCellControl } from "@/components/grid";
import { Icon } from "@/components/icons";
import { Money, StatusChip, inlineInputClass } from "@/components/ui";
import { shortDate } from "@/lib/dates";
import type { InsightGroup, InsightRow, Money as M } from "@/lib/insights";

// Every property's money, grouped by state and then by property (when one has held more than one tenancy), in AG Grid
// Community: the groups are rows of their own with their totals in the same columns, opened and closed with a chevron
// (or Enter), and kept together under any sort by postSortRows, so sorting by Held orders the states, the properties in
// each and the tenancies in each, all by Held. A filter box, a pinned total for everything showing, and a CSV of the
// tenancies with the total. Row grouping is an Enterprise feature; none of this uses it.

type Row = (InsightRow | InsightGroup) & { level: number; parent: string | null; grandparent: string | null };

/** What this grid draws with, beyond what every grid shares (gridModules): the filter box and the open groups, the
 *  pinned total, the CSV, and the names drawn again when a group opens or closes. */
const MODULES = gridModules(ExternalFilterModule, PinnedRowModule, CsvExportModule, RenderApiModule);
type Layout = "narrow" | "wide";
type Ctx = { open: Set<string>; toggle: (id: string) => void; layout: Layout };

const AMOUNTS: { id: keyof M; header: string; tip: string }[] = [
  { id: "collected", header: "Collected", tip: "Deposits paid, through PayPal or marked paid" },
  { id: "returned", header: "Returned", tip: "Refunds and Payouts, and PayPal's own refunds through a dispute" },
  { id: "settled", header: "Settled", tip: "What a settled dispute sent back on top of the statement's refund" },
  { id: "kept", header: "Kept", tip: "What the statements kept as deductions, after any settlement" },
  { id: "held", header: "Held", tip: "Collected, less what went back and what a statement that went out kept" },
];

function NameCell(p: CustomCellRendererProps<Row>) {
  const r = p.data;
  const ctx = p.context as Ctx;
  if (!r) return null;
  const pad = { paddingLeft: r.level * 22 };
  if (r.kind === "state" || r.kind === "property") {
    const open = ctx.open.has(r.id);
    return (
      <div className="flex min-w-0 items-center gap-1.5" style={pad}>
        <button type="button" onClick={(e) => { e.stopPropagation(); ctx.toggle(r.id); }} aria-expanded={open}
          aria-label={`${open ? "Close" : "Open"} ${r.label}`}
          className="-ml-1 inline-flex size-6 shrink-0 items-center justify-center rounded-xs text-ink-3 transition-colors hover:bg-surface-3 hover:text-ink">
          <Icon name={open ? "chev-down" : "chev-right"} className="size-3.5" />
        </button>
        <span className="truncate font-medium">{r.label}</span>
        <span className="shrink-0 text-xs text-ink-3">{r.count} {r.kind === "state" ? (r.count === 1 ? "tenancy" : "tenancies") : "tenancies"}</span>
      </div>
    );
  }
  const t = r as InsightRow & { level: number };
  return (
    <div className="flex min-w-0 flex-col leading-tight" style={pad}>
      <Link href={`/tenancy/${t.id}`} className="truncate font-medium hover:underline" onClick={(e) => e.stopPropagation()}>
        {t.level === 2 ? `From ${t.start ? shortDate(t.start) : "the start"}` : t.street}
      </Link>
      <span className="mt-1 truncate text-xs text-ink-3">{ctx.layout === "narrow" ? `${t.status.label}, ${t.tenants}` : t.tenants}</span>
    </div>
  );
}

function StatusCell(p: CustomCellRendererProps<Row>) {
  const r = p.data;
  if (!r || r.kind !== "tenancy") return null;
  return <StatusChip tone={r.status.tone}>{r.status.label}</StatusChip>;
}

function AmountCell(p: CustomCellRendererProps<Row, number> & { strong?: boolean }) {
  if (p.value == null) return null;
  const group = p.data?.kind === "state" || p.data?.kind === "property" || p.node.rowPinned;
  return <Money value={p.value} className={`${group ? "font-medium" : ""} ${p.value === 0 ? "text-ink-3" : ""}`} />;
}

export type InsightsGridHandle = { exportCsv: () => void };

export const InsightsGrid = forwardRef<InsightsGridHandle, { tenancies: InsightRow[]; groups: InsightGroup[]; total: M; today: string; onDrawn?: () => void }>(function InsightsGrid(p, ref) {
  const apiRef = useRef<GridApi<Row> | null>(null);
  // Every group open to start; what the landlord closes is remembered in this browser.
  // (Read once, in the browser: the grid's rows only render there, so the server's markup has none to differ.)
  const [open, setOpen] = useState<Set<string>>(() => {
    const closed = browserStore.getList("gf.insights.closed", (x): x is string => typeof x === "string");
    return new Set(p.groups.map((g) => g.id).filter((id) => !closed.includes(id)));
  });
  const toggle = useCallback((id: string) => setOpen((s) => {
    const n = new Set(s);
    if (n.has(id)) n.delete(id); else n.add(id);
    browserStore.set("gf.insights.closed", p.groups.map((g) => g.id).filter((g) => !n.has(g)));
    return n;
  }), [p.groups]);
  const [search, setSearch] = useState("");

  const card = useRef<HTMLDivElement>(null);
  const [layout, setLayout] = useState<Layout>("wide");
  useEffect(() => {
    const el = card.current;
    if (!el) return;
    const ro = new ResizeObserver(([e]) => setLayout(e.contentRect.width < 720 ? "narrow" : "wide"));
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  // The tree in its natural order: each state, then each property with more than one tenancy as its own group, then
  // the tenancies.
  const rows = useMemo<Row[]>(() => {
    const out: Row[] = [];
    for (const s of p.groups.filter((g) => g.kind === "state")) {
      out.push({ ...s, level: 0, parent: null, grandparent: null });
      for (const t of p.tenancies.filter((x) => x.state === s.state)) {
        const prop = p.groups.find((g) => g.kind === "property" && g.state === t.state && g.street === t.street);
        if (prop && !out.some((r) => r.id === prop.id)) out.push({ ...prop, level: 1, parent: s.id, grandparent: null });
        out.push({ ...t, level: prop ? 2 : 1, parent: prop ? prop.id : s.id, grandparent: prop ? s.id : null });
      }
    }
    return out;
  }, [p.groups, p.tenancies]);

  // A tenancy shows when it matches the filter box and its groups are open; a group shows when anything under it
  // matches.
  const q = search.trim().toLowerCase();
  const matches = useMemo(() => new Set(p.tenancies.filter((t) => !q || `${t.street} ${t.address} ${t.tenants} ${t.status.label} ${t.stateName} ${t.state}`.toLowerCase().includes(q)).map((t) => t.id)), [p.tenancies, q]);
  const filter = useRef({ open, matches, rows });
  useEffect(() => {
    filter.current = { open, matches, rows };
    apiRef.current?.onFilterChanged();
    apiRef.current?.refreshCells({ columns: ["name"], force: true });
  }, [open, matches, rows]);

  const pinned = useMemo(() => {
    const shown = p.tenancies.filter((t) => matches.has(t.id));
    const s = (k: keyof M) => Math.round(shown.reduce((t, x) => t + (x[k] as number), 0) * 100) / 100;
    return [{
      kind: "state", id: "total", state: "CA", stateName: "", street: null, label: q ? "Showing" : "All properties", count: shown.length, level: 0, parent: null, grandparent: null,
      collected: s("collected"), returned: s("returned"), settled: s("settled"), kept: s("kept"), held: s("held"), deducted: s("deducted"), deductions: shown.reduce((t, x) => t + x.deductions, 0),
    } as Row];
  }, [p.tenancies, matches, q]);

  const context = useMemo<Ctx>(() => ({ open, toggle, layout }), [open, toggle, layout]);

  const columnDefs = useMemo<ColDef<Row>[]>(() => {
    const amount = (a: (typeof AMOUNTS)[number]): ColDef<Row> => ({
      colId: a.id, headerName: a.header, headerTooltip: a.tip, width: 124, type: "rightAligned", cellRenderer: AmountCell,
      valueGetter: (v: ValueGetterParams<Row>) => (v.data ? (v.data[a.id] as number) : null), cellStyle: RIGHT,
    });
    const name: ColDef<Row> = {
      colId: "name", headerName: "Property", flex: 1, minWidth: layout === "narrow" ? 170 : 240, cellRenderer: NameCell, cellClass: "gf-first", headerClass: "gf-first",
      valueGetter: (v: ValueGetterParams<Row>) => (v.data ? (v.data.kind === "tenancy" ? (v.data as InsightRow).street : (v.data as InsightGroup).label) : ""),
      tooltipValueGetter: (t: ITooltipParams<Row>) => (t.data?.kind === "tenancy" ? (t.data as InsightRow).address : null),
      cellRendererSelector: (c) => (c.node.rowPinned ? { component: TotalName } : undefined),
    };
    // On a phone: the property (its status under it) and what it holds; the rest stays for the CSV.
    const phone = layout === "narrow";
    return [
      name,
      { colId: "status", headerName: "Status", width: 160, hide: phone, cellRenderer: StatusCell, valueGetter: (v: ValueGetterParams<Row>) => (v.data?.kind === "tenancy" ? (v.data as InsightRow).status.label : "") },
      ...AMOUNTS.map((a) => ({ ...amount(a), hide: phone && a.id !== "held", width: phone ? 116 : 124 })),
      {
        colId: "due", headerName: "Due", width: 112, hide: phone, cellClass: "tabular-nums text-ink-2", headerTooltip: "The statement and refund deadline, once the tenants moved out",
        valueGetter: (v: ValueGetterParams<Row>) => (v.data?.kind === "tenancy" ? (v.data as InsightRow).due : null),
        valueFormatter: (v) => (v.value ? shortDate(v.value) : ""),
      },
      ...HIDDEN,
    ];
  }, [layout]);

  // The CSV lists every tenancy the filter box matches, under a closed group too, so its rows add up to the total row
  // (which counts the same tenancies): all the rows, in the tree's order, not only the ones the open groups show.
  useImperativeHandle(ref, () => ({
    exportCsv: () => apiRef.current?.exportDataAsCsv({
      fileName: `good-faith-insights-${p.today}.csv`,
      columnKeys: ["stateName", "name", "tenants", "status", "collected", "returned", "settled", "kept", "held", "due"],
      exportedRows: "all",
      shouldRowBeSkipped: (x) => !x.node.rowPinned && (x.node.data?.kind !== "tenancy" || !filter.current.matches.has(x.node.data.id)),
      processHeaderCallback: (h) => ({ stateName: "State", name: "Property", tenants: "Tenants", status: "Status", due: "Statement and refund due" } as Record<string, string>)[h.column.getColId()] ?? h.column.getColDef().headerName ?? "",
      processCellCallback: (c: ProcessCellForExportParams<Row>) => {
        const id = c.column.getColId();
        const r = c.node?.data;
        if (!r) return "";
        if (c.node?.rowPinned) return id === "name" ? ((r as InsightGroup).label === "Showing" ? "Total" : "All properties") : AMOUNTS.some((a) => a.id === id) ? Number(c.value ?? 0).toFixed(2) : "";
        if (AMOUNTS.some((a) => a.id === id)) return Number(c.value ?? 0).toFixed(2);
        if (id === "name") return csvSafe((r as InsightRow).address);
        return csvSafe(c.value);
      },
    }),
  }), [p.today]);

  // Groups stay together under any sort: each level is ordered by where its rows landed, its groups first.
  const postSortRows = useCallback(({ nodes }: PostSortRowsParams<Row>) => {
    const pos = new Map(nodes.map((n, i) => [n.data!.id, i]));
    const rank = (n: IRowNode<Row>) => pos.get(n.data!.id) ?? 0;
    const states = nodes.filter((n) => n.data?.kind === "state").sort((a, b) => rank(a) - rank(b));
    const out: IRowNode<Row>[] = [];
    for (const s of states) {
      out.push(s);
      const under = nodes.filter((n) => n.data?.parent === s.data!.id).sort((a, b) => rank(a) - rank(b));
      for (const u of under) {
        out.push(u);
        if (u.data?.kind === "property") out.push(...nodes.filter((n) => n.data?.parent === u.data!.id).sort((a, b) => rank(a) - rank(b)));
      }
    }
    nodes.splice(0, nodes.length, ...out);
  }, []);

  return (
    <div ref={card}>
      <div className="flex flex-wrap items-center gap-2 border-b border-line-2 px-5 py-3">
        <label className="relative flex min-w-0 items-center max-sm:w-full">
          <span className="sr-only">Filter properties</span>
          <Icon name="search" className="pointer-events-none absolute left-2.5 size-[13px] text-ink-4" />
          <input type="search" value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Filter properties"
            className={`${inlineInputClass} h-[30px] w-[220px] pl-8 text-sm max-sm:w-full`} />
        </label>
        <span className="text-xs text-ink-3 sm:ml-auto">{matches.size} of {p.tenancies.length} tenancies</span>
      </div>
      <div className="gf-grid">
        <AgGridProvider modules={MODULES}>
          <AgGridReact<Row>
            theme={gridTheme}
            rowData={rows}
            pinnedBottomRowData={pinned}
            columnDefs={columnDefs}
            defaultColDef={DEFAULT}
            context={context}
            getRowId={(r: GetRowIdParams<Row>) => r.data.id}
            isExternalFilterPresent={() => true}
            doesExternalFilterPass={(n: IRowNode<Row>) => {
              const r = n.data;
              const f = filter.current;
              if (!r) return false;
              const kids = (id: string) => f.rows.some((x) => x.kind === "tenancy" && (x.parent === id || x.grandparent === id) && f.matches.has(x.id));
              if (r.kind === "state") return kids(r.id);
              if (r.kind === "property") return f.open.has(r.parent!) && kids(r.id);
              return f.matches.has(r.id) && f.open.has(r.parent!) && (!r.grandparent || f.open.has(r.grandparent));
            }}
            postSortRows={postSortRows}
            getRowClass={(r: RowClassParams<Row>) => (r.node.rowPinned ? "gf-sum" : r.data?.kind === "state" || r.data?.kind === "property" ? "gf-group" : undefined)}
            onCellClicked={(e) => {
              if ((e.data?.kind === "state" || e.data?.kind === "property") && !e.node.rowPinned && !(e.event?.target as HTMLElement | null)?.closest("button, a")) toggle(e.data.id);
            }}
            getRowHeight={(r) => (r.data?.kind === "tenancy" ? 52 : 44)}
            {...gridTab}
            onCellKeyDown={(e) => {
              if (e.node.rowPinned) return;
              const k = (e.event as KeyboardEvent | undefined)?.key;
              // A group's row: Enter or Space on any of its cells opens or closes it.
              if ((k === "Enter" || k === " ") && (e.data?.kind === "state" || e.data?.kind === "property")) { e.event?.preventDefault(); toggle(e.data.id); return; }
              // A tenancy's row: Enter on any of its cells opens its property, through the link in its Property cell (the
              // grid is one Tab stop, so the link isn't in the Tab order).
              if (e.data?.kind === "tenancy") pressCellControl(e, true);
            }}
            domLayout="autoHeight"
            ensureDomOrder
            suppressColumnVirtualisation
            animateRows={false}
            enableCellTextSelection
            tooltipShowDelay={300}
            onGridReady={(e) => { apiRef.current = e.api; }}
            onFirstDataRendered={() => p.onDrawn?.()}
            overlayComponentParams={{ noMatchingRows: { overlayText: "No properties match." } }}
          />
        </AgGridProvider>
      </div>
    </div>
  );
});

function TotalName(p: CustomCellRendererProps<Row>) {
  const g = p.data as InsightGroup | undefined;
  return (
    <div className="flex items-center gap-2">
      <span className="font-medium">{g?.label}</span>
      <span className="text-xs text-ink-3">{g?.count} {g?.count === 1 ? "tenancy" : "tenancies"}</span>
    </div>
  );
}

const CENTER = { display: "flex", alignItems: "center" };
const RIGHT = { ...CENTER, justifyContent: "flex-end" };
const DEFAULT: ColDef<Row> = { sortable: true, resizable: true, suppressHeaderMenuButton: true, tooltipComponent: GridTip, cellStyle: CENTER };

/** Off screen, for the CSV. */
const HIDDEN: ColDef<Row>[] = [
  { colId: "stateName", headerName: "State", hide: true, valueGetter: (v) => v.data?.stateName ?? "" },
  { colId: "tenants", headerName: "Tenants", hide: true, valueGetter: (v) => (v.data?.kind === "tenancy" ? (v.data as InsightRow).tenants : "") },
];

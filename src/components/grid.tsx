"use client";

import { CellStyleModule, ClientSideRowModelModule, RowStyleModule, themeQuartz, TooltipModule, type CellKeyDownEvent, type Module, type TabToNextCellParams } from "ag-grid-community";
import type { CustomTooltipProps } from "ag-grid-react";

// What every AG Grid in the app shares: the Community modules they all use (no Enterprise feature and no license key
// anywhere), the Quartz theme dressed in the design tokens, the dark tooltip and the CSV guard. The grids themselves
// are the Payments ledger (ledger/ledger-grid.tsx), the Move-out tab's deductions (tenancy/[id]/deductions-grid.tsx)
// and Insights (insights/insights-grid.tsx).

/** The modules every grid uses, which each grid gives AgGridProvider with its own (so nothing registers on the server,
 *  and a grid's chunk carries only what it draws with; AllCommunityModule carried every Community feature): the client
 *  side row model (sorting, column moves and resizes, keyboard navigation and overlays come with the core), tooltips,
 *  cell and row classes. AG Grid logs error #200 for an option or call whose module is missing. Its ValidationModule,
 *  which names the module, stays out even in development: it draws a box over the grid for every deprecation, and the
 *  demo is filmed from next dev. To check a grid's modules, add it here for a run and remove it again. */
export const gridModules = (...own: Module[]): Module[] => [ClientSideRowModelModule, TooltipModule, CellStyleModule, RowStyleModule, ...own];

/** The design tokens by value (globals.css): the theme mixes them into its hover, selection and focus tints, which it
 *  cannot do from a var() reference. The grid draws no border of its own; the card around it does. */
export const gridTheme = themeQuartz.withParams({
  accentColor: "#003087",
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
  autoHeightMinBodyHeight: 48, // room for the "nothing matches" line, not the 150px default under a short list
  rowHoverColor: "#f7f8fa",
  selectedRowBackgroundColor: "#e8eef8",
  pinnedRowBorder: { color: "#e6e8ee" },
  pinnedRowFontWeight: 400,
  pinnedRowTextColor: "#1b1d23",
  pinnedRowBackgroundColor: "#ffffff",
  valueChangeValueHighlightBackgroundColor: "#e8eef8", // a cell the code just worked out again flashes brand-50
  fontFamily: "var(--font-hanken), system-ui, sans-serif",
  fontSize: 13,
  dataFontSize: 13,
  cellHorizontalPadding: 10,
  iconSize: 12,
  checkboxBorderRadius: 4,
  checkboxUncheckedBorderColor: "#c9ccd6",
  checkboxCheckedBackgroundColor: "#003087",
  checkboxCheckedBorderColor: "#003087",
  checkboxIndeterminateBackgroundColor: "#003087",
  checkboxIndeterminateBorderColor: "#003087",
  // Keyboard focus on a cell: AG Grid's 1px border in brand, under the app's 2px brand outline (globals.css). AG Grid's
  // own controls (a header, a row's checkbox) ring in solid brand, 11.9:1 on white, not its faint accent tint.
  rangeSelectionBorderColor: "#003087",
  focusShadow: { spread: 2, color: "#003087" },
  inputFocusBorder: { color: "#003087" },
  inputFocusShadow: "0 0 0 3px #d3def0",
  inputBorder: { color: "#e6e8ee" },
  inputBorderRadius: 6,
  inputInvalidBorder: { color: "#b3261e" },
  inputInvalidTextColor: "#b3261e",
  cellEditingBorder: { color: "#003087" },
  cellEditingShadow: "0 0 0 3px #d3def0",
});

/** The keyboard, the same in every grid (WAI-ARIA's grid pattern): the grid is one stop in the page's Tab order, the
 *  arrow keys move between its headers and cells, and Tab or Shift+Tab leaves it. AG Grid's own Tab walks every cell
 *  first, which in a ledger of 300 rows is a long way to the next control. While a cell is being edited, Tab still
 *  moves to the next input, as in a spreadsheet. */
export const gridTab = {
  tabToNextCell: (p: TabToNextCellParams) => (p.editing ? p.nextCellPosition ?? false : false),
  tabToNextHeader: () => false as const,
};

/** With the grid one Tab stop, a control inside a cell (a row's menu, a link, an info tip) is reached from its cell:
 *  Enter or Space on the cell presses it, and the arrow keys carry on through the grid from wherever focus lands. A
 *  menu takes focus and Escape gives it back to the menu's button in the cell; a link opens its page; an info tip takes
 *  focus, which opens it with its text as the button's description (a click would pin it open unread), and Escape
 *  closes it. With `rowLink`, Enter on a cell with no control of its own opens the row's first link (Insights: any cell
 *  of a tenancy's row opens its property). True when it pressed one; a key on the control itself is left to the
 *  control. */
export function pressCellControl(e: Pick<CellKeyDownEvent, "event">, rowLink = false): boolean {
  const ev = e.event as KeyboardEvent | null | undefined;
  if (!ev || (ev.key !== "Enter" && ev.key !== " ")) return false;
  const at = ev.target as HTMLElement | null;
  if (!at || at.closest("button, a[href], input, select, textarea")) return false;
  const control = at.closest(".ag-cell")?.querySelector<HTMLElement>("button, a[href]")
    ?? (rowLink && ev.key === "Enter" ? at.closest(".ag-row")?.querySelector<HTMLElement>("a[href]") : null);
  if (!control) return false;
  ev.preventDefault();
  if (control.matches("[data-tip]")) control.focus();
  else control.click();
  return true;
}

/** The grid's tooltips in the app's own dark tip. */
export function GridTip(p: CustomTooltipProps) {
  return <div className="gf-tip max-w-[300px] rounded-md bg-ink px-3 py-2 text-sm text-white shadow-md">{String(p.value ?? "")}</div>;
}

/** A value saved in this browser only (a grid's columns, a chosen view): read and written in try/catch, since a
 *  private window or blocked site data can throw, and the page works the same without it. */
export const browserStore = {
  get<T>(key: string): T | null {
    try {
      const raw = window.localStorage.getItem(key);
      return raw ? (JSON.parse(raw) as T) : null;
    } catch {
      return null;
    }
  },
  /** A saved list, each item checked by `item`: anything else stored under the key (an object, a string, a list with
   *  the wrong things in it; anything on the origin can write localStorage) reads as the empty list, so the page starts
   *  from its defaults instead of failing on it. */
  getList<T>(key: string, item: (x: unknown) => x is T): T[] {
    const v = browserStore.get<unknown>(key);
    return Array.isArray(v) ? v.filter(item) : [];
  },
  set(key: string, value: unknown) {
    try {
      window.localStorage.setItem(key, JSON.stringify(value));
    } catch {
      // Not saved: the next visit starts from the defaults.
    }
  },
  remove(key: string) {
    try {
      window.localStorage.removeItem(key);
    } catch {
      // Nothing to do.
    }
  },
};

"use client";

import { AllCommunityModule, themeQuartz } from "ag-grid-community";
import type { CustomTooltipProps } from "ag-grid-react";

// What every AG Grid in the app shares: the Community modules (no Enterprise feature and no license key anywhere),
// the Quartz theme dressed in the design tokens, the dark tooltip and the CSV guard. The grids themselves are the
// Payments ledger (ledger/ledger-grid.tsx), the Move-out tab's deductions (tenancy/[id]/deductions-grid.tsx) and
// Insights (insights/insights-grid.tsx).

/** Every Community module, given to each grid through AgGridProvider so nothing registers on the server. */
export const gridModules = [AllCommunityModule];

/** The design tokens by value (globals.css): the theme mixes them into its hover, selection and focus tints, which it
 *  cannot do from a var() reference. The grid draws no border of its own; the card around it does. */
export const gridTheme = themeQuartz.withParams({
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
  autoHeightMinBodyHeight: 48, // room for the "nothing matches" line, not the 150px default under a short list
  rowHoverColor: "#f7f8fa",
  selectedRowBackgroundColor: "#eef0fb",
  pinnedRowBorder: { color: "#e6e8ee" },
  pinnedRowFontWeight: 400,
  pinnedRowTextColor: "#1b1d23",
  pinnedRowBackgroundColor: "#ffffff",
  valueChangeValueHighlightBackgroundColor: "#eef0fb", // a cell the code just worked out again flashes brand-50
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
  // Keyboard focus on a cell: AG Grid's 1px border in brand, under the app's 2px brand outline (globals.css).
  rangeSelectionBorderColor: "#5e6ad2",
  inputFocusBorder: { color: "#5e6ad2" },
  inputFocusShadow: "0 0 0 3px #dfe3f8",
  inputBorder: { color: "#e6e8ee" },
  inputBorderRadius: 6,
  inputInvalidBorder: { color: "#b3261e" },
  inputInvalidTextColor: "#b3261e",
  cellEditingBorder: { color: "#5e6ad2" },
  cellEditingShadow: "0 0 0 3px #dfe3f8",
});

/** The grid's tooltips in the app's own dark tip. */
export function GridTip(p: CustomTooltipProps) {
  return <div className="gf-tip max-w-[300px] rounded-md bg-ink px-3 py-2 text-sm text-white shadow-md">{String(p.value ?? "")}</div>;
}

/** Spreadsheets run a cell that starts with = + - @ or a tab as a formula, so such a value gets a leading apostrophe. */
export const csvSafe = (v: unknown) => {
  const s = v == null ? "" : String(v);
  return /^[=+\-@\t\r]/.test(s) ? `'${s}` : s;
};

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

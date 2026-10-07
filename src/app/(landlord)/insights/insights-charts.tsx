"use client";

import { useEffect, useMemo, useState } from "react";
import { AgCharts } from "ag-charts-react";
import {
  AreaSeriesModule, BarSeriesModule, CartesianChartModule, CategoryAxisModule, LegendModule, NumberAxisModule,
  type AgCartesianChartOptions, type AgChartTheme,
} from "ag-charts-community";
import { InfoTip } from "@/components/info-tip";
import { Card, CardHead } from "@/components/ui";
import { usd } from "@/lib/deductions";
import type { Category, SeriesPoint } from "@/lib/insights";

// The four charts on Insights, in AG Charts Community (MIT, no license key), registered per chart with only the
// modules they draw with. Dressed in the design tokens: Inter, ink text, hairline grid, the app's dark tooltip. Color
// does one job per chart and was checked with the data-viz palette validator: indigo is the series a chart is about,
// gray the context beside it (emphasis); the deductions keep the colors their findings have everywhere in the app
// (damage red, cleaning amber, rent gray). Every chart has a legend or a single series its title names, labels on the
// bars, a tooltip per mark, and the grid below as its table.

const MODULES = [CartesianChartModule, AreaSeriesModule, BarSeriesModule, CategoryAxisModule, NumberAxisModule, LegendModule];

const INK = "#1b1d23", INK3 = "#64697b", LINE = "#e6e8ee", LINE2 = "#eff0f4";
const BRAND = "#5e6ad2", GRAY = "#9a9ead";
const CATEGORY_FILL: Record<Category, string> = { damage: "#d64540", cleaning: "#d99a1b", rent: GRAY };

/** Whole dollars, compact past a thousand: the axis ticks. */
const compact = (n: number) => (Math.abs(n) >= 1000 ? `$${(n / 1000).toLocaleString("en-US", { maximumFractionDigits: 1 })}k` : `$${Math.round(n)}`);

function theme(font: string): AgChartTheme {
  return {
    baseTheme: "ag-default",
    palette: { fills: [BRAND, GRAY], strokes: [BRAND, GRAY] },
    params: {
      // The keyboard's focus on a bar, a point or a legend item: a 2px brand line on a white one, 4.7:1 on the canvas.
      accentColor: BRAND, focusShadow: `0 0 0 2px ${BRAND}`,
      fontFamily: font, fontSize: 12, textColor: INK, subtleTextColor: INK3, backgroundColor: "#ffffff",
      gridLineColor: LINE2, axisLineColor: LINE, chartPadding: 4,
      tooltipBackgroundColor: INK, tooltipTextColor: "#ffffff", tooltipSubtleTextColor: "rgba(255,255,255,0.72)", tooltipBorder: false, tooltipBorderRadius: 6,
    },
  };
}

/** The axes every time chart shares: the periods along the bottom, dollars up the side on a hairline grid. Each period
 *  is keyed by its first day, since a category axis merges equal values and a span past a year repeats month names
 *  ("Oct" twice); the axis prints the period's label, dropping labels that would collide rather than tilting them. */
const timeAxes = (labels: Map<string, string>): AgCartesianChartOptions["axes"] => ({
  x: {
    type: "category", position: "bottom", line: { enabled: true, stroke: LINE }, tick: { enabled: false },
    label: { color: INK3, avoidCollisions: true, autoRotate: false, wrapping: "never", minSpacing: 12, formatter: ({ value }) => labels.get(String(value)) ?? String(value) },
  },
  y: { type: "number", position: "left", line: { enabled: false }, gridLine: { style: [{ stroke: LINE2, lineDash: [] }] }, label: { color: INK3, formatter: ({ value }) => compact(Number(value)) } },
});

export function InsightsCharts(p: {
  series: SeriesPoint[];
  grain: string; // "week", "month" or "quarter"
  categories: { category: Category; label: string; amount: number; count: number }[];
  states: { state: string; name: string; held: number; collected: number; returned: number; kept: number }[];
}) {
  // Canvas text needs the loaded font by name: next/font's Inter, read from its CSS variable once it is ready.
  const [font, setFont] = useState<string | null>(null);
  useEffect(() => {
    let live = true;
    const name = getComputedStyle(document.documentElement).getPropertyValue("--font-inter").trim() || "system-ui, sans-serif";
    document.fonts.ready.then(() => { if (live) setFont(`${name}, system-ui, sans-serif`); }).catch(() => { if (live) setFont("system-ui, sans-serif"); });
    return () => { live = false; };
  }, []);

  const t = useMemo(() => (font ? theme(font) : null), [font]);
  const labels = useMemo(() => new Map(p.series.map((x) => [x.key, x.label])), [p.series]);
  const last = p.series[p.series.length - 1];
  const backTotal = p.series.reduce((s, x) => s + x.refunds + x.settlements, 0);

  // Room above the top tick and right of the last label, so nothing is clipped by the canvas edge.
  const padding = { top: 14, right: 18, bottom: 4, left: 4 };
  const held: AgCartesianChartOptions | null = t && {
    theme: t, data: p.series, height: 232, padding,
    series: [{
      type: "area", xKey: "key", yKey: "held", yName: "Held", fill: BRAND, fillOpacity: 0.1, stroke: BRAND, strokeWidth: 2,
      marker: { enabled: true, size: 8, fill: BRAND, stroke: "#ffffff", strokeWidth: 2 },
      tooltip: { renderer: ({ datum }) => ({ heading: `${grainWord(p.grain)} of ${(datum as SeriesPoint).label}`, data: [{ label: "Held at its end", value: usd((datum as SeriesPoint).held) }] }) },
    }],
    axes: timeAxes(labels), legend: { enabled: false },
  };

  const returned: AgCartesianChartOptions | null = t && {
    theme: t, data: p.series, height: 232, padding,
    series: (["refunds", "settlements"] as const).map((k) => ({
      type: "bar" as const, xKey: "key", yKey: k, yName: k === "refunds" ? "Refunds" : "Settlements", stacked: true,
      fill: k === "refunds" ? BRAND : GRAY, stroke: "#ffffff", strokeWidth: 1, cornerRadius: 3, width: 22,
      tooltip: { renderer: ({ datum }: { datum: unknown }) => {
        const d = datum as SeriesPoint;
        return { heading: `${grainWord(p.grain)} of ${d.label}`, data: [{ label: "Refunds", value: usd(d.refunds) }, { label: "Settlements", value: usd(d.settlements) }] };
      } },
    })),
    axes: timeAxes(labels), legend: { enabled: true, position: "bottom", item: { marker: { shape: "square", size: 10 }, label: { color: INK3 } } },
  };

  // A bar's value sits past its end: the axis runs a quarter further than the longest bar so the label fits.
  const room = (max: number) => (max > 0 ? Math.ceil((max * 1.3) / 100) * 100 : 100);
  const cats: AgCartesianChartOptions | null = t && {
    theme: t, data: p.categories, height: 196, padding,
    series: [{
      type: "bar", direction: "horizontal", xKey: "label", yKey: "amount", yName: "Deducted", cornerRadius: 3, width: 22,
      itemStyler: ({ datum }) => ({ fill: CATEGORY_FILL[(datum as { category: Category }).category] }),
      label: { enabled: true, placement: "outside-end", color: INK, formatter: ({ value }) => usd(Number(value)) },
      tooltip: { renderer: ({ datum }) => {
        const d = datum as { label: string; amount: number; count: number };
        return { heading: d.label, data: [{ label: "Deducted", value: usd(d.amount) }, { label: "Charges", value: String(d.count) }] };
      } },
    }],
    axes: {
      y: { type: "category", position: "left", line: { enabled: false }, tick: { enabled: false }, label: { color: INK } },
      x: { type: "number", position: "bottom", line: { enabled: false }, gridLine: { style: [{ stroke: LINE2, lineDash: [] }] }, label: { color: INK3, formatter: ({ value }) => compact(Number(value)) }, min: 0, max: room(Math.max(...p.categories.map((c) => c.amount))), nice: false },
    },
    legend: { enabled: false },
  };

  const byHeld = [...p.states].sort((a, b) => b.held - a.held);
  const states: AgCartesianChartOptions | null = t && {
    theme: t, data: byHeld, height: Math.max(140, 64 + p.states.length * 44), padding,
    series: [{
      type: "bar", direction: "horizontal", xKey: "name", yKey: "held", yName: "Held", fill: BRAND, cornerRadius: 3, width: 22,
      label: { enabled: true, placement: "outside-end", color: INK, formatter: ({ value }) => usd(Number(value)) },
      tooltip: { renderer: ({ datum }) => {
        const d = datum as (typeof p.states)[number];
        return { heading: d.name, data: [
          { label: "Collected", value: usd(d.collected) }, { label: "Returned", value: usd(d.returned) },
          { label: "Kept", value: usd(d.kept) }, { label: "Held", value: usd(d.held) },
        ] };
      } },
    }],
    axes: {
      y: { type: "category", position: "left", line: { enabled: false }, tick: { enabled: false }, label: { color: INK } },
      x: { type: "number", position: "bottom", line: { enabled: false }, gridLine: { style: [{ stroke: LINE2, lineDash: [] }] }, label: { color: INK3, formatter: ({ value }) => compact(Number(value)) }, min: 0, max: room(Math.max(...p.states.map((x) => x.held))), nice: false },
    },
    legend: { enabled: false },
  };

  const by = grainWord(p.grain).toLowerCase();
  return (
    <div className="grid gap-4 lg:grid-cols-2">
      <ChartCard title="Deposits held" meta={`By ${by}`} tip="What was collected, less what went back and what a statement that went out kept, at the end of each period."
        summary={`Deposits held by ${by}. ${last ? `At the end of the ${by} of ${last.label}: ${usd(last.held)}.` : ""}`} options={held} />
      <ChartCard title="Returned to tenants" meta={`By ${by}`} tip="Refunds and Payouts (PayPal's refunds through a dispute among them), and what a settled dispute sent back on top."
        summary={`Refunds and settlements by ${by}, ${usd(backTotal)} in all.`} options={returned} />
      <ChartCard title="Deductions by category" meta="Every statement" tip="Every deduction on file, drafts included, by what it was for. Wear and tear is never charged, so it isn't here."
        summary={`Deductions: ${p.categories.map((c) => `${c.label} ${usd(c.amount)}`).join(", ")}.`} options={cats} />
      <ChartCard title="Held by state" meta={`${p.states.length} state${p.states.length === 1 ? "" : "s"}`} tip="What each state's properties hold now. Hover a bar for what was collected, returned and kept there."
        summary={`Held by state: ${p.states.map((s) => `${s.name} ${usd(s.held)}`).join(", ")}.`} options={states} />
    </div>
  );
}

const grainWord = (g: string) => (g === "week" ? "Week" : g === "quarter" ? "Quarter" : "Month");

function ChartCard({ title, meta, tip, summary, options }: { title: string; meta: string; tip: string; summary: string; options: AgCartesianChartOptions | null }) {
  return (
    <Card>
      <CardHead title={title} meta={meta} right={<InfoTip align="end" title={title}>{tip}</InfoTip>} />
      <div className="px-3 pb-3 pt-2">
        <p className="sr-only">{summary} The table below lists every property&apos;s figures.</p>
        {/* AG Charts names every chart "interactive chart"; the group says which one a screen reader has entered. */}
        {options ? <div role="group" aria-label={title}><AgCharts options={options} modules={MODULES} /></div> : <div style={{ height: options === null ? 232 : 0 }} aria-hidden />}
      </div>
    </Card>
  );
}

"use client";

import dynamic from "next/dynamic";
import { startTransition, useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Button } from "@/components/button";
import { Icon } from "@/components/icons";
import { InfoTip } from "@/components/info-tip";
import { RollMoney } from "@/components/roll-money";
import { Card, CardHead, Fact, FactStrip } from "@/components/ui";
import { usd } from "@/lib/deductions";
import { byCategory, firstMoneyDate, insightRows, periods, series, type InsightUnit } from "@/lib/insights";
import type { LedgerRow } from "@/lib/ledger";
import { InsightsGrid, type InsightsGridHandle } from "./insights-grid";

// The charts draw on a canvas in the browser only, so they load there, after the page's own figures, and they are
// built only once the grid below them has drawn its rows and the browser has painted them: building the four charts
// is the page's longest task, and it no longer holds up the grid (docs/PERFORMANCE.md). Their code is fetched at once
// meanwhile. Each chart's place is held at its size until then.
const loadCharts = () => import("./insights-charts").then((m) => m.InsightsCharts);
const ChartsWaiting = () => <div className="grid gap-4 lg:grid-cols-2">{[0, 1, 2, 3].map((i) => <div key={i} className="h-[300px] rounded-lg border border-line bg-surface" />)}</div>;
const InsightsCharts = dynamic(loadCharts, { ssr: false, loading: ChartsWaiting });
/** The charts are built no later than this after the page opens, whatever the grid does. */
const CHARTS_BY_MS = 1500;

// Insights' body: one row of state filters, the facts strip (what is held is the view's one hero number), the four
// charts, then every property in the grid. The state filter narrows all of it at once.

export function Insights({ units, rows, today }: { units: InsightUnit[]; rows: LedgerRow[]; today: string }) {
  const states = useMemo(() => [...new Map(units.map((u) => [u.state, u.stateName])).entries()].sort((a, b) => a[1].localeCompare(b[1])), [units]);
  const [state, setState] = useState<string | null>(null);
  const grid = useRef<InsightsGridHandle>(null);
  // Whether the charts may be built: once the grid has drawn and that frame is painted (or CHARTS_BY_MS has passed).
  const [chartsOn, setChartsOn] = useState(false);
  const showCharts = useCallback(() => startTransition(() => setChartsOn(true)), []);
  useEffect(() => {
    void loadCharts();
    const t = window.setTimeout(showCharts, CHARTS_BY_MS);
    return () => window.clearTimeout(t);
  }, [showCharts]);
  const gridDrawn = useCallback(() => {
    requestAnimationFrame(() => window.setTimeout(showCharts, 0));
  }, [showCharts]);

  const view = useMemo(() => {
    const us = state ? units.filter((u) => u.state === state) : units;
    const ids = new Set(us.map((u) => u.id));
    const rs = rows.filter((r) => ids.has(r.tenancyId));
    const { grain, list } = periods(firstMoneyDate(rs), today);
    const tree = insightRows(us, rs);
    return {
      tree, grain, series: series(rs, list, new Map(us.map((u) => [u.id, u.deliveredOn]))), categories: byCategory(rs),
      states: [...new Set(us.map((u) => u.state))].map((s) => {
        const g = tree.groups.find((x) => x.kind === "state" && x.state === s)!;
        return { state: s, name: g.stateName, held: g.held, collected: g.collected, returned: g.returned + g.settled, kept: g.kept };
      }),
    };
  }, [units, rows, today, state]);

  const t = view.tree.total;
  const holding = view.tree.tenancies.filter((x) => x.held > 0).length;
  const paidBy = view.tree.tenancies.filter((x) => x.collected > 0).length;
  const btn = (on: boolean) => `inline-flex h-7 shrink-0 items-center gap-[5px] rounded-sm px-2.5 text-sm transition-[color,background-color,box-shadow] ${on ? "bg-canvas font-medium text-ink shadow-sm" : "text-ink-3 hover:text-ink"}`;

  return (
    <>
      <div className="mb-5 flex flex-wrap items-center gap-x-4 gap-y-3">
        <h1 className="text-xl font-medium">Insights</h1>
        <div className="ml-auto flex items-center gap-2">
          <Button onClick={() => grid.current?.exportCsv()}><Icon name="download" />Export CSV</Button>
        </div>
      </div>

      {states.length > 1 && (
        <div role="group" aria-label="State" className="mb-5 inline-flex max-w-full gap-0.5 overflow-x-auto rounded-md bg-surface-2 p-[3px]">
          <button type="button" aria-pressed={!state} onClick={() => setState(null)} className={btn(!state)}>
            All states<span className="font-normal text-ink-3">{units.length}</span>
          </button>
          {states.map(([code, name]) => (
            <button key={code} type="button" aria-pressed={state === code} onClick={() => setState(code)} className={btn(state === code)}>
              {name}<span className="font-normal text-ink-3">{units.filter((u) => u.state === code).length}</span>
            </button>
          ))}
        </div>
      )}

      <FactStrip cols={4} className="mb-6">
        <Fact label="Deposits held" big value={<RollMoney value={t.held} cents="small" phoneCents="full" />}
          sub={holding ? `${holding} ${holding === 1 ? "tenancy" : "tenancies"}` : "Nothing held"}
          info={<InfoTip title="Deposits held">What was collected, less what went back and what a statement that went out kept. The same figure as Payments and Properties.</InfoTip>} />
        <Fact label="Collected" value={<RollMoney quick value={t.collected} />} sub={paidBy === 1 ? "1 deposit paid" : `${paidBy} deposits paid`} />
        <Fact label="Returned" value={<RollMoney quick value={t.returned + t.settled} />} sub={t.settled ? `${usd(t.settled)} of it in settlements` : "Refunds and Payouts"} />
        <Fact label="Kept as deductions" value={<RollMoney quick value={t.kept} />} sub={`${t.deductions} charge${t.deductions === 1 ? "" : "s"} on file`}
          info={<InfoTip title="Kept as deductions" align="end">What the statements kept, after any settlement gave part of it back. Wear and tear is never charged.</InfoTip>} />
      </FactStrip>

      {chartsOn ? <InsightsCharts series={view.series} grain={view.grain} categories={view.categories} states={view.states} /> : <ChartsWaiting />}

      <Card className="mt-6">
        <CardHead title="Properties" meta={`${view.tree.tenancies.length} ${view.tree.tenancies.length === 1 ? "tenancy" : "tenancies"}, by state`}
          right={<InfoTip align="end" title="Properties by state">Each state, and each property that has held more than one tenancy, is a row of its own with its totals. Close one with its chevron or Enter; sort any column and the groups stay together. Export CSV lists every tenancy and the total.</InfoTip>} />
        <InsightsGrid key={state ?? "all"} ref={grid} tenancies={view.tree.tenancies} groups={view.tree.groups} total={view.tree.total} today={today} onDrawn={gridDrawn} />
      </Card>
    </>
  );
}

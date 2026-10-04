import type { ReactNode } from "react";
import type { TurnLineView, TurnView } from "@/lib/negotiation";
import { Icon } from "./icons";
import { InfoTip } from "./info-tip";
import { Money, StatusChip } from "./ui";

// The negotiation as both sides see it: every turn, who made it (an agent or a person), the move, what it gives back,
// the message to the other side, and behind a disclosure the reasoning and the charge-by-charge figures with each
// reason and citation. What the app checked or changed in a turn sits behind an info tip. Shared by the landlord's
// property page and the tenants' dispute page, which differ only in who "you" are.

export type Perspective = "landlord" | "tenant";

const usd = (n: number) => `$${n.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;

const MOVE: Record<string, string> = {
  case: "Case", concede: "Concedes", accept: "Accepts", hold: "Holds", counter: "Counters", reject: "Declines", withdraw: "Withdraws", note: "Note",
};
const LINE_MOVE: Record<string, string> = { concede: "Concedes", hold: "Holds", counter: "Counters", agreed: "Agreed" };

/** Who made a turn, in the page reader's words. */
export function whoMade(t: Pick<TurnView, "side" | "actor" | "by">, p: Perspective, names: { landlord: string; tenants: string }): string {
  if (t.side === p) return t.actor === "agent" ? (p === "landlord" ? "Your negotiator" : "Your advocate") : "You";
  if (t.side === "tenant") return t.actor === "agent" ? "Their advocate" : t.by ?? names.tenants;
  return t.actor === "agent" ? `${/s$/i.test(names.landlord) ? `${names.landlord}'` : `${names.landlord}'s`} negotiator` : names.landlord;
}

export function NegotiationThread({ turns, perspective, names }: { turns: TurnView[]; perspective: Perspective; names: { landlord: string; tenants: string } }) {
  return (
    <ol>
      {turns.map((t) => <TurnRow key={t.n} t={t} p={perspective} names={names} />)}
    </ol>
  );
}

function TurnRow({ t, p, names }: { t: TurnView; p: Perspective; names: { landlord: string; tenants: string } }) {
  const who = whoMade(t, p, names);
  const agrees = t.move === "concede" || t.move === "accept";
  const verb = t.side === "tenant" ? (t.move === "accept" ? "Accepts" : "Asks") : (t.move === "concede" ? "Gives" : "Offers");
  const moved = t.lines.filter((l) => l.move && l.move !== "agreed");
  return (
    <li className="relative grid grid-cols-[24px_minmax(0,1fr)] gap-x-3 border-t border-line-2 py-3.5 first:border-t-0">
      <span aria-hidden className={`mt-px flex size-6 items-center justify-center rounded-full text-xs font-semibold ${t.side === "landlord" ? "bg-surface-2 text-ink-2" : "bg-brand-50 text-brand-700"}`}>
        {t.actor === "agent" ? <span className="text-[10px] tracking-tight">AI</span> : <Icon name="users" className="size-3" />}
      </span>
      <div className="min-w-0">
        <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
          <span className="font-medium">{who}</span>
          <StatusChip tone={agrees ? "green" : "gray"} dot={false} size="sm">{MOVE[t.move] ?? t.move}</StatusChip>
          {t.adjustments.length > 0 && (
            <InfoTip title="Checked by the app">
              The app held this turn to each charge&apos;s lawful range and to the negotiation&apos;s rules: {t.adjustments.join(" ")}
            </InfoTip>
          )}
          <span className="ml-auto whitespace-nowrap text-sm">
            <span className="text-ink-3">{verb} </span><Money value={t.amountBack} className="font-medium" /><span className="text-ink-3"> back</span>
          </span>
        </div>
        {t.message && <p className="mt-1 whitespace-pre-line text-sm text-ink-2">{t.message}</p>}
        {t.limit && (
          <p className="mt-1 text-xs text-amber">
            Held at your {usd(t.limit.limit)} limit. Your negotiator would have offered {usd(t.limit.wanted)}.
          </p>
        )}
        {(t.reasoning || moved.length > 0) && (
          <details className="group mt-1.5">
            <summary className="inline-flex cursor-pointer list-none items-center gap-1 text-xs font-medium text-brand hover:underline [&::-webkit-details-marker]:hidden">
              {t.reasoning ? "Reasoning and figures" : "Charge by charge"}
              <Icon name="chev-down" className="size-3 transition-transform group-open:rotate-180" />
            </summary>
            {t.reasoning && <p className="mt-2 text-sm text-ink-2">{t.reasoning}</p>}
            <ul className="mt-2 flex flex-col gap-2">
              {t.lines.map((l) => <LineRow key={l.n} l={l} />)}
            </ul>
          </details>
        )}
      </div>
    </li>
  );
}

function LineRow({ l }: { l: TurnLineView }) {
  return (
    <li className="flex gap-3 text-sm">
      <span className="mt-px flex size-5 shrink-0 items-center justify-center rounded-xs bg-surface-2 text-xs font-medium tabular-nums text-ink-3">{l.n}</span>
      <div className="min-w-0 flex-1">
        <p className="flex flex-wrap items-center gap-x-2">
          <span className="font-medium">{l.title}</span>
          {l.move && <span className="text-xs text-ink-3">{LINE_MOVE[l.move] ?? l.move}</span>}
        </p>
        {l.reason && (
          <p className="text-xs text-ink-3">
            {l.reason}{" "}
            {l.citation && <InfoTip trigger="why" align="end" title={l.title} cite={l.citation}>The most the law and the record support for it: {usd(l.max)}.</InfoTip>}
          </p>
        )}
      </div>
      <div className="shrink-0 text-right">
        <Money value={l.keep} className="font-medium" />
        <p className="text-xs text-ink-3">kept of {usd(l.amount)}</p>
      </div>
    </li>
  );
}

/** A labeled amount for a settlement panel or the no-agreement summary. */
export function Position({ label, value, sub }: { label: ReactNode; value: number; sub?: ReactNode }) {
  return (
    <div className="min-w-0">
      <p className="text-xs text-ink-3">{label}</p>
      <Money value={value} className="mt-0.5 block text-lg font-medium" />
      {sub && <p className="mt-0.5 text-xs text-ink-3">{sub}</p>}
    </div>
  );
}

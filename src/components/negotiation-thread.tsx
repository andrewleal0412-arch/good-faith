import type { ReactNode, Ref } from "react";
import { CHECKED_NOTE } from "@/lib/jev-notes";
import type { TurnLineView, TurnView } from "@/lib/negotiation";
import { Icon } from "./icons";
import { InfoTip } from "./info-tip";
import { PresenceList, WorkingDots } from "./motion";
import { LineMark, Money, StatusChip } from "./ui";

// The negotiation as both sides see it: every turn, who made it (an agent or a person), the move, what it gives back,
// the message to the other side, and behind a disclosure the reasoning and the charge-by-charge figures with each
// reason and citation. Every turn code checked carries a green Checked mark beside its move, so both pages show
// that the turn was held to the lawful range before anyone saw it; what code held it to, and what it changed, sits
// behind the mark as its tip. Shared by the landlord's property page and the tenants' dispute page, which differ only
// in who "you" are.

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

/** The turns, oldest first. A turn that lands while the page is open eases in, like a message, and the app's check
 *  mark on it settles in just after (gf-settle). `working` is the side whose agent is writing its turn right now: its
 *  typing row shows only while the run is going, and is gone the moment the turn lands (data-leave), the turn opening
 *  where it was. */
export function NegotiationThread({ turns, perspective, names, working }: {
  turns: TurnView[]; perspective: Perspective; names: { landlord: string; tenants: string }; working?: "landlord" | "tenant" | null;
}) {
  const writer = working ? whoMade({ side: working, actor: "agent", by: null }, perspective, names) : null;
  return (
    <ol>
      <PresenceList>
        {turns.map((t) => <TurnRow key={t.n} t={t} p={perspective} names={names} />)}
        {working && writer && (
          <li key="working" data-leave="at-once" className="relative grid grid-cols-[24px_minmax(0,1fr)] gap-x-3 border-t border-line-2 py-3.5 first:border-t-0">
            <Avatar side={working} agent />
            <div role="status" className="flex min-h-6 items-center gap-2.5">
              <span className="font-medium">{writer}</span>
              <WorkingDots className="text-ink-4" />
              <span className="sr-only">is writing its turn. Each turn appears here as it is made.</span>
            </div>
          </li>
        )}
      </PresenceList>
    </ol>
  );
}

/** The mark on a checked turn: a green check and the word, the tip's trigger (its button is named by this word).
 *  The tenants' dispute page puts the same mark on the advocate's case before it is sent, so the first agent output
 *  the tenants see carries it too. */
export function CheckedMark() {
  return (
    <span className="inline-flex items-center gap-1 text-xs font-medium text-green">
      <Icon name="check" className="size-3" />
      Checked
    </span>
  );
}

function Avatar({ side, agent }: { side: "landlord" | "tenant"; agent: boolean }) {
  return (
    <span aria-hidden className={`flex size-6 items-center justify-center rounded-full text-xs font-semibold ${side === "landlord" ? "bg-surface-2 text-ink-2" : "bg-brand-50 text-brand-700"}`}>
      {agent ? <span className="text-[10px] tracking-tight">AI</span> : <Icon name="users" className="size-3" />}
    </span>
  );
}

function TurnRow({ t, p, names, ref }: { t: TurnView; p: Perspective; names: { landlord: string; tenants: string }; ref?: Ref<HTMLLIElement> }) {
  const who = whoMade(t, p, names);
  const agrees = t.move === "concede" || t.move === "accept";
  const verb = t.side === "tenant" ? (t.move === "accept" ? "Accepts" : "Asks") : (t.move === "concede" ? "Gives" : "Offers");
  const moved = t.lines.filter((l) => l.move && l.move !== "agreed");
  return (
    <li ref={ref} className="relative grid grid-cols-[24px_minmax(0,1fr)] gap-x-3 border-t border-line-2 py-3.5 first:border-t-0">
      <LineMark><Avatar side={t.side} agent={t.actor === "agent"} /></LineMark>
      <div className="min-w-0">
        <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
          <span className="font-medium">{who}</span>
          <StatusChip tone={agrees ? "green" : "gray"} dot={false} size="sm" className="gf-settle">{MOVE[t.move] ?? t.move}</StatusChip>
          {(t.checked || t.adjustments.length > 0 || t.reasonsChecked) && (
            <InfoTip title="Checked by code" className="gf-settle" trigger={<CheckedMark />}>
              Code held this turn to each charge&apos;s lawful range and to the negotiation&apos;s rules before either page showed it
              {t.adjustments.length ? `: ${t.adjustments.join(" ")}` : ". Every figure was inside them, so nothing was changed."}
              {t.reasonsChecked ? ` ${CHECKED_NOTE}` : ""}
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
            <summary className="-my-1 inline-flex cursor-pointer list-none items-center gap-1 py-1 text-xs font-medium text-brand hover:underline [&::-webkit-details-marker]:hidden">
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
      <LineMark><span className="flex size-5 items-center justify-center rounded-xs bg-surface-2 text-xs font-medium tabular-nums text-ink-3">{l.n}</span></LineMark>
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

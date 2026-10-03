import { InfoTip } from "./info-tip";
import { localOverlays, packFor } from "@/lib/states";

// Which state's deposit law a property follows: a small neutral chip ("Rules: Civ. Code 1950.5") whose tip says what
// that statute governs here, and, when the state's pack knows of local rules for the city (New York City, Seattle and
// so on), one amber dotted label saying local rules may add requirements. Local rules are never enforced, only named.

export function RulesChip({ state, city, className = "" }: { state: string; city: string | null; className?: string }) {
  const pack = packFor(state);
  const local = localOverlays(pack, city);
  return (
    <span className={`inline-flex flex-wrap items-center gap-x-2.5 gap-y-1 ${className}`}>
      <InfoTip title={pack.chip.title} cite={pack.chip.cite}
        trigger={<span className="inline-flex h-[22px] items-center whitespace-nowrap rounded-sm bg-surface-2 px-2 text-xs font-medium text-ink-2">Rules: {pack.statute.short}</span>}>
        {pack.chip.text} Not legal advice.
      </InfoTip>
      {local.length > 0 && (
        <InfoTip title="Local rules may add requirements"
          trigger={<span className="text-xs text-amber underline decoration-amber-dot decoration-dotted underline-offset-[3px]">Local rules</span>}>
          {local.map((o) => <span key={o.city} className="mt-1.5 block first:mt-0">{o.city}: {o.line}</span>)}
          <span className="mt-1.5 block text-white/70">Shown for information. Good Faith applies {pack.name} law only; check the city&apos;s own program.</span>
        </InfoTip>
      )}
    </span>
  );
}

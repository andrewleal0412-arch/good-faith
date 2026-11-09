import { InfoTip } from "@/components/info-tip";
import { Card, CardHead, LineMark, Money, StatusChip } from "@/components/ui";
import { dateIn, PACIFIC, shortDate } from "@/lib/dates";
import type { DisputeStatus, LandlordDisputeView } from "@/lib/disputes";
import { CHECKED_NOTE } from "@/lib/jev-notes";
import { CaseFold } from "./case-fold";

// The tenants' dispute on the property's Move-out tab: what they dispute and why, the case their advocate wrote, each
// charge's lawful range as the code computed it, and their photos. Read-only: the answer, the negotiation and the
// settlement are in the Negotiation card under it (negotiation.tsx), and nothing changes until a settlement is agreed
// and approved.

const usd = (n: number) => `$${n.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
const VERDICT: Record<string, { label: string; tone: "gray" | "amber" | "red" }> = {
  solid: { label: "Looks solid", tone: "gray" },
  weak: { label: "Looks weak", tone: "amber" },
  unsupported: { label: "Not supported", tone: "amber" },
  unlawful: { label: "Not allowed", tone: "red" },
};
const DISPUTE_STATUS: Record<DisputeStatus, { label: string; tone: "green" | "amber" | "red" | "gray" }> = {
  draft: { label: "Draft", tone: "gray" },
  open: { label: "Waiting for you", tone: "amber" },
  negotiating: { label: "Negotiating", tone: "amber" },
  agreed: { label: "Agreed", tone: "amber" },
  settled: { label: "Settled", tone: "green" },
  no_agreement: { label: "No agreement", tone: "red" },
  withdrawn: { label: "Withdrawn", tone: "gray" },
};

export function DisputeCard({ v, photoUrl, thumbUrl, tenantsLabel, zone = PACIFIC }: {
  v: LandlordDisputeView; photoUrl: (path: string) => string | null; thumbUrl?: (path: string) => string | null; tenantsLabel: string; zone?: string;
}) {
  const st = DISPUTE_STATUS[v.status];
  const disputed = v.lines.filter((l) => l.disputed);
  const who = v.openedBy ?? tenantsLabel;
  // Settled, the card's body folds to one line (case-fold.tsx): who disputed how many charges and asked what back, and
  // when; the Negotiation card under it says how it ended.
  const settled = v.status === "settled";
  const when = v.sentAt ? `, ${shortDate(dateIn(v.sentAt, zone))}` : "";
  const line = `${who} disputed ${disputed.length} of ${v.lines.length} charge${v.lines.length === 1 ? "" : "s"} and asked ${usd(v.askedBack ?? 0)} back${when}.`;
  return (
    <Card id="dispute" className="scroll-mt-8">
      <CardHead title="Dispute"
        right={<><StatusChip tone={st.tone}>{st.label}</StatusChip>
          <InfoTip align="end" title="How this was checked">
            {v.advocate ? "The tenants' advocate, a Claude agent working for them, wrote this case. " : "The tenants wrote this case themselves. "}
            The app computed each charge&apos;s lawful range from the law and your records and held every amount to it.{v.advocate?.support ? ` ${CHECKED_NOTE}` : ""} Not legal advice: the advocate drafts the tenants&apos; case from the records and the state&apos;s rules, and can&apos;t say what a court would decide.
          </InfoTip></>} />

      <CaseFold settled={settled} count={disputed.length} line={line}>
        <div className="grid grid-cols-2 gap-x-4 gap-y-3 border-b border-line-2 px-5 py-4 sm:grid-cols-3">
          <div>
            <p className="text-xs text-ink-3">Asked back</p>
            <Money value={v.askedBack ?? 0} className="mt-0.5 block text-lg font-medium" />
            <p className="mt-0.5 text-xs text-ink-3">By {who}{v.sentAt ? `, ${shortDate(dateIn(v.sentAt, zone))}` : ""}</p>
          </div>
          <div>
            <p className="text-xs text-ink-3">Disputed</p>
            <p className="mt-0.5 text-lg font-medium tabular-nums">{disputed.length} of {v.lines.length}</p>
          </div>
          <div className="max-sm:col-span-2">
            <p className="flex items-center gap-1.5 text-xs text-ink-3">
              Least back by the rules
              <InfoTip align="end" title="The least that goes back">
                What the law and your records don&apos;t support, whatever is agreed: charges the rules bar outright, charges missing the documents the law requires, and amounts above what their own math or the guidance allows.
              </InfoTip>
            </p>
            <Money value={v.totals.minBack} className="mt-0.5 block text-lg font-medium" />
          </div>
        </div>

        {v.advocate && (
          <div className="border-b border-line-2 px-5 py-4">
            <p className="text-xs text-ink-3">Their advocate&apos;s summary</p>
            <p className="mt-1 text-sm text-ink-2">{v.advocate.summary}</p>
          </div>
        )}

        <ol>
          {v.lines.map((l) => {
            const p = l.proposed;
            const verdict = p?.verdict ? VERDICT[p.verdict] : null;
            const back = p ? Math.round((l.amount - p.keep) * 100) / 100 : 0;
            const photos = v.evidence.filter((e) => e.deductionId === l.id);
            return (
              <li key={l.id} className="flex gap-3 border-b border-line-2 px-5 py-3.5 last:border-b-0">
                <LineMark className="text-sm"><span className="flex size-6 items-center justify-center rounded-sm bg-surface-2 text-xs font-semibold tabular-nums text-ink-3">{l.n}</span></LineMark>
                <div className="min-w-0 flex-1">
                  <p className="flex flex-wrap items-center gap-x-2 gap-y-1 text-sm font-medium">
                    {l.title}
                    {verdict && <StatusChip tone={verdict.tone} dot={false} size="sm">{verdict.label}</StatusChip>}
                    {!l.disputed && <span className="text-xs font-normal text-ink-3">Not disputed</span>}
                  </p>
                  {p && back > 0 && <p className="text-xs text-ink-3 sm:hidden">Asks {usd(back)} back</p>}
                  {l.tenantReason && <p className="mt-1 whitespace-pre-line text-sm text-ink-2">&ldquo;{l.tenantReason}&rdquo;</p>}
                  {p?.reason && (
                    <p className="mt-1 text-xs text-ink-3">
                      Advocate: {p.reason}{" "}
                      <InfoTip trigger="why" align="end" title="The lawful range" cite={p.citation ?? l.citations[0]}>
                        {l.reasons.join(" ")} The most you may keep of it on the record as it stands: {usd(l.max)}.
                      </InfoTip>
                    </p>
                  )}
                  {photos.length > 0 && (
                    <ul className="mt-2 flex flex-wrap gap-2">
                      {photos.map((e) => {
                        // The tile shows the photo's small version; the link opens the photo itself.
                        const u = photoUrl(e.path);
                        return (
                          <li key={e.id}>
                            {u ? (
                              <a href={u} target="_blank" rel="noreferrer" aria-label={`The tenants' photo ${e.name}`}>
                                {/* eslint-disable-next-line @next/next/no-img-element */}
                                <img loading="lazy" decoding="async" src={thumbUrl?.(e.path) ?? u} alt="" className="size-14 rounded-md border border-line bg-surface object-cover" />
                              </a>
                            ) : <span className="text-xs text-ink-3">{e.name}</span>}
                          </li>
                        );
                      })}
                    </ul>
                  )}
                </div>
                <div className="shrink-0 text-right">
                  <Money value={l.amount} className="text-sm font-medium" />
                  {p && back > 0 && <p className="text-xs text-ink-3 max-sm:hidden">Asks {usd(back)} back</p>}
                </div>
              </li>
            );
          })}
        </ol>

        {v.message && (
          <div className="border-t border-line-2 px-5 py-4">
            <p className="text-xs text-ink-3">Their message</p>
            <p className="mt-1 whitespace-pre-line text-sm text-ink-2">{v.message}</p>
          </div>
        )}
      </CaseFold>

      {/* Settled or closed, the Negotiation card under it says how it ended; the promise only holds while it is live. */}
      {(v.status === "open" || v.status === "negotiating" || v.status === "agreed") && (
        <p className="border-t border-line-2 px-5 py-3 text-xs text-ink-3">Nothing changes until a settlement is agreed and you approve it.</p>
      )}
    </Card>
  );
}

/** The banner every tab shows while a dispute is live: sent, being negotiated, or agreed and waiting on approval. */
export function DisputeBanner({ v, href, tenantsLabel }: { v: LandlordDisputeView; href: string; tenantsLabel: string }) {
  const n = v.lines.filter((l) => l.disputed).length;
  const who = v.openedBy ?? tenantsLabel, one = !!v.openedBy;
  const s = v.settlement;
  const [tag, text, link] = v.status === "agreed" && s?.paying
    ? ["Agreed", "You approved the settlement. PayPal hasn't confirmed the payment yet.", "Check the payment"]
    : v.status === "agreed" && s?.accepted && s.wholeFirst
      ? ["Agreed", `${s.acceptedBy ?? who} accepted the settlement. Send the refund of the whole deposit first: it already holds the settlement, which then moves no money.`, "Review settlement"]
    : v.status === "agreed" && s?.accepted
      ? ["Agreed", `${s.acceptedBy ?? who} accepted the settlement. It waits on your approval.`, "Approve and pay"]
      : v.status === "agreed"
        ? ["Agreed", `A settlement is agreed. Nothing moves until ${who} accept${one ? "s" : ""} it and you approve it.`, "Review settlement"]
        : v.status === "negotiating"
          ? ["Negotiating", `Your negotiator and ${who}'s advocate are negotiating ${n} disputed deduction${n === 1 ? "" : "s"}.`, "View negotiation"]
          : ["Disputed", `${who} dispute${one ? "s" : ""} ${n} deduction${n === 1 ? "" : "s"} and ask${one ? "s" : ""} for ${usd(v.askedBack ?? 0)} back.`, "View dispute"];
  return (
    <div className="mb-5 flex flex-wrap items-center gap-x-3 gap-y-1.5 rounded-lg border border-line bg-amber-bg px-4 py-3 text-sm">
      <span className="font-medium text-amber">{tag}</span>
      <span className="min-w-0 flex-1 text-ink">{text}</span>
      <a href={href} className="font-medium text-brand hover:underline">{link}</a>
    </div>
  );
}

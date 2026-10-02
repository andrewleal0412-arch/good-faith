import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { longDate, pacificDate } from "@/lib/dates";
import { usd } from "@/lib/deductions";
import { SANDBOX } from "@/lib/paypal";
import { MOVE_IN_PHOTOS_FROM } from "@/lib/rules";
import { describeDelivery, TAGS } from "@/lib/statement";
import { tenantMoveOutSentOn } from "@/lib/tenant";
import { resolveTenantToken } from "@/lib/tenant-links";
import { loadTenantView, type TenantView } from "@/lib/tenant-view";
import { MovingOutForm } from "./moving-out-form";

export const dynamic = "force-dynamic";

// A private page, so not for search engines, and the token in its address is sent to no other site.
export const metadata: Metadata = { title: "Your security deposit", robots: { index: false, follow: false }, referrer: "no-referrer" };

// The tenants' own page, opened with the link their landlord gave them: what they paid, what they signed, the
// move-in photos, where things stand, and the statement once it goes out. Every fact comes from loadTenantView,
// which names its columns; nothing here reaches the landlord's lease flags, activity log or agent runs, and no
// address on this page carries the tenancy id. Section F of the rules spec: the statute's terms and the facts on
// file, never advice.

/** LEGAL_RULES source S7: where disputes go, by the courts' own guide. */
const COURTS_GUIDE = "https://selfhelp.courts.ca.gov/guide-security-deposits-california";

const words = (status: string) => status.toLowerCase().replace(/_/g, " ");
const payMethod = (m: string | null) => (!m || m === "PAYPAL" ? "PayPal" : words(m));

export default async function TenantPage({ params }: PageProps<"/t/[token]">) {
  const { token } = await params;
  const link = await resolveTenantToken(token);
  if (!link) notFound();
  const v = await loadTenantView(link.tenancyId);
  if (!v) notFound();

  const stand = standing(v);
  const rooms = [...new Set(v.photos.map((p) => p.room))];
  const moveInPhotosRequired = !!v.startDate && v.startDate >= MOVE_IN_PHOTOS_FROM;
  const a = v.agreement;
  const st = v.statement;
  const pdf = `/api/t/${token}/statement.pdf`;
  const signed = a ? `on ${longDate(pacificDate(a.signedAt))}` : null;

  // The rules in plain words, each with the exact subsection, and the facts on file for this tenancy where they fit.
  const rights: { text: React.ReactNode; cite: string }[] = [
    {
      text: <>Within 21 calendar days after you move out, the landlord gives you an itemized statement of any deductions and returns the rest of the deposit.{v.moveOutDate && v.statementDue ? <> You moved out on {longDate(v.moveOutDate)}, so the deadline {st ? "was" : "is"} {longDate(v.statementDue)}.</> : null}</>,
      cite: "Civ. Code 1950.5(h)(1)",
    },
    {
      text: "Deductions can only be for unpaid rent, damage beyond ordinary wear and tear caused by you or your guests, cleaning that brings the unit back to how clean it was when you moved in, or, if your lease says so, restoring or replacing the landlord's furnishings.",
      cite: "Civ. Code 1950.5(b)(1)-(4)",
    },
    {
      text: "Nothing can be deducted for ordinary wear and tear, for conditions that were already there when you moved in, or for wear that built up over earlier tenancies. Only what is reasonably necessary to restore the unit to its move-in condition may be charged.",
      cite: "Civ. Code 1950.5(e)(1), (e)(2)(A)-(B)",
    },
    {
      // (h)(2)(D) sends the photos only with a repair or cleaning deduction, and (h)(4)(A) lifts that at $125 or less.
      text: `The landlord photographs the unit ${moveInPhotosRequired ? "at the start of the tenancy, and again " : ""}at move-out before and after any repair or cleaning that is deducted. If any repair or cleaning is deducted, those photos come with the statement, subject to the $125 rule below.`,
      cite: moveInPhotosRequired ? "Civ. Code 1950.5(g)(1)-(2), (h)(2)(D)" : "Civ. Code 1950.5(g)(2), (h)(2)(D)",
    },
    {
      text: "If repair and cleaning deductions total more than $125, the invoices, receipts, labor records and photos come with the statement. If they total $125 or less, you may ask for them within 14 days of receiving the statement, and the landlord then has 14 days to provide them.",
      cite: "Civ. Code 1950.5(h)(2), (h)(4)-(5)",
    },
    v.deposit?.electronic
      ? {
        text: <>Because the deposit was paid electronically, the rest of it comes back electronically{a ? <>. You agreed in writing {signed} that it comes back by PayPal to {a.paypalEmail}.</> : <>, to an account you designate in writing, or by another electronic method you agree to in writing.</>}</>,
        cite: "Civ. Code 1950.5(h)(1)(A)",
      }
      : {
        text: <>The refund comes by personal delivery or first-class mail check, electronically if you paid rent or the deposit electronically, or by a method you and the landlord agreed to in writing{a ? <>: you agreed {signed} that it comes back by PayPal to {a.paypalEmail}</> : null}.</>,
        cite: "Civ. Code 1950.5(h)(1)(A)",
      },
    {
      text: "Before you move out, you may ask for an initial inspection and be there for it. It can take place no earlier than two weeks before the tenancy ends, with at least 48 hours' written notice of the date and time. Afterwards the landlord gives you an itemized list of what would be deducted, so you can fix it before you leave.",
      cite: "Civ. Code 1950.5(f)(1), (f)(2)",
    },
    { text: "The statement is mailed to the address you give the landlord. If you give none, it goes to the unit you left.", cite: "Civ. Code 1950.5(h)(6)" },
    // (h)(1)(C)(i) is the default; the (C)(ii) agreement may send the refund to one adult or divide it, and says how
    // each adult receives the statement. The agreement on file names the account, which is stated as a fact only.
    ...(v.tenants.length > 1 ? [{
      text: <>With more than one adult on the lease, the refund is a check payable to all of you and the statement goes to any one of you, unless every adult and the landlord signed a written agreement saying how it is returned, whether to one of you or divided among you, and how each of you receives the statement.{a ? <> The agreement above, signed by {a.signedBy.join(" and ")}, names the PayPal account the refund goes to.</> : null}</>,
      cite: "Civ. Code 1950.5(h)(1)(C)",
    }] : []),
  ];

  return (
    <main className="mx-auto w-full max-w-3xl px-5 py-10">
      <p className="text-[13px] font-semibold uppercase tracking-[0.14em] text-accent">Your security deposit</p>
      <h1 className="mt-2 text-[30px] font-semibold leading-tight tracking-[-0.02em]">{v.address}</h1>
      <p className="mt-1 text-[15px] text-ink-2">
        {v.tenants.join(" and ") || "Tenant"}{v.startDate && <> · since {longDate(v.startDate)}</>}{v.landlord && <> · Landlord: {v.landlord}</>}
      </p>

      <div className="mt-6 rounded-2xl bg-surface p-5 shadow-sm">
        <p className="text-[11px] font-semibold uppercase tracking-[0.1em] text-ink-3">Where things stand</p>
        <p className="mt-1 text-[18px] font-semibold leading-snug">{stand.title}</p>
        <p className="mt-1 text-[14px] leading-relaxed text-ink-2">{stand.detail}</p>
        {v.deposit?.payLink && (
          <a href={v.deposit.payLink} target="_blank" rel="noreferrer" className="mt-3 inline-block rounded-xl bg-accent px-4 py-2 text-[14px] font-semibold text-white hover:opacity-90">
            Pay the deposit invoice in PayPal{SANDBOX ? " (sandbox)" : ""}
          </a>
        )}
      </div>

      <Section title="Your deposit" cite="Civ. Code 1950.5(c), (h)(1)">
        {v.deposit ? (
          <>
            <p className="text-[22px] font-semibold tabular-nums">{usd(v.deposit.amount)}</p>
            <p className="mt-1 text-[14px] text-ink-2">
              {v.deposit.paid
                ? <>Paid {v.deposit.paidAt ? `on ${longDate(pacificDate(v.deposit.paidAt))} ` : ""}by {payMethod(v.deposit.method)}, PayPal invoice <span className="font-mono text-[12px]">{v.deposit.invoiceId}</span>.</>
                : <>PayPal invoice <span className="font-mono text-[12px]">{v.deposit.invoiceId}</span> is {words(v.deposit.status)}, not paid yet.</>}
            </p>
          </>
        ) : (
          <p className="text-[14px] text-ink-2">No deposit invoice has been sent through PayPal yet.</p>
        )}
      </Section>

      <Section title={a ? "The refund agreement you signed" : "How the refund comes back"} cite="Civ. Code 1950.5(h)(1)(A)">
        {a ? (
          <>
            {a.text && <blockquote className="rounded-xl bg-bg px-4 py-3 text-[14px] leading-relaxed">&ldquo;{a.text}&rdquo;</blockquote>}
            <p className={`${a.text ? "mt-3 " : ""}text-[14px] text-ink-2`}>
              Agreed in writing by <b className="text-ink">{a.signedBy.join(" and ")}</b> {signed}. PayPal account: <span className="font-mono text-[12px]">{a.paypalEmail}</span>.
            </p>
          </>
        ) : (
          <p className="text-[14px] leading-relaxed text-ink-2">
            No written agreement on the refund method is on file.{" "}
            {v.deposit?.electronic
              ? "Because the deposit was paid electronically, the refund comes back electronically: to an account you designate in writing, or by another electronic method you agree to in writing."
              : "The refund comes by personal delivery or first-class mail check, electronically if you paid rent or the deposit electronically, or by a method you and the landlord agree to in writing."}
          </p>
        )}
      </Section>

      <Section title="Move-in photos" cite={moveInPhotosRequired ? "Civ. Code 1950.5(g)(1)" : undefined}>
        <p className="text-[14px] leading-relaxed text-ink-2">
          {v.photos.length
            ? `${v.photos.length} photo${v.photos.length === 1 ? "" : "s"} of the unit at the start of the tenancy: the record of its condition on day one, which any move-out comparison is measured against.`
            : "No move-in photos are on file."}
        </p>
        {v.photos.length > 0 && (
          <>
            <p className="mt-1 text-[12px] text-ink-3">Tap a photo to open it full size.</p>
            {/* One grid, in room order, each tile opening the same photo at full size through the token route. */}
            <ul className="mt-3 grid grid-cols-3 gap-3 sm:grid-cols-5">
              {rooms.flatMap((r) => v.photos.filter((p) => p.room === r)).map((p) => (
                <li key={p.id} className="min-w-0">
                  <a href={`/api/t/${token}/photos/${p.id}`} target="_blank" rel="noreferrer" className="block rounded-lg focus:outline-none focus-visible:ring-2 focus-visible:ring-accent">
                    {/* eslint-disable-next-line @next/next/no-img-element */}
                    <img src={`/api/t/${token}/photos/${p.id}`} alt={`${p.room}, move-in`} loading="lazy" className="aspect-square w-full rounded-lg bg-bg object-cover" />
                  </a>
                  <p className="mt-1 truncate text-[11px] text-ink-3" title={p.room}>{p.room}</p>
                </li>
              ))}
            </ul>
          </>
        )}
      </Section>

      <Section title="Moving out" cite="Civ. Code 1950.5(h)(6)">
        {v.moveOutDate ? (
          <p className="text-[14px] leading-relaxed text-ink-2">
            Your landlord recorded the move-out on <b className="text-ink">{longDate(v.moveOutDate)}</b>.
            {v.statementDue && (st
              ? <> The itemized statement was due by {longDate(v.statementDue)}, 21 calendar days later (Civ. Code 1950.5(h)(1)), and went out on {longDate(st.delivery.date)}.</>
              : <> The itemized statement and the rest of the deposit are due by {longDate(v.statementDue)}, 21 calendar days later (Civ. Code 1950.5(h)(1)).</>)}
          </p>
        ) : v.noticeGivenOn ? (
          <p className="text-[14px] leading-relaxed text-ink-2">
            Your landlord recorded notice given on <b className="text-ink">{longDate(v.noticeGivenOn)}</b>{v.plannedMoveOut && <>, with a planned move-out of <b className="text-ink">{longDate(v.plannedMoveOut)}</b></>}.
          </p>
        ) : null}
        {st ? (
          <p className={`${v.moveOutDate || v.noticeGivenOn ? "mt-2 " : ""}text-[14px] leading-relaxed text-ink-2`}>
            {v.moveOut && <>You sent on {longDate(tenantMoveOutSentOn(v.moveOut))}: {v.moveOutDate ? "" : `moving out ${longDate(v.moveOut.planned_move_out)}, with `}{v.moveOut.forwarding_address} as the forwarding address. </>}
            The itemized statement {v.moveOutDate ? "has gone out" : <>went out on {longDate(st.delivery.date)}</>}, so these details can&apos;t be changed here. If something is wrong, contact your landlord directly.
          </p>
        ) : (
          <>
            <p className={`${v.moveOutDate || v.noticeGivenOn ? "mt-2 " : ""}text-[14px] leading-relaxed text-ink-2`}>
              {v.moveOutDate
                ? <>Where should the itemized statement be mailed? It goes to the address you give; with none, to the unit you left (Civ. Code 1950.5(h)(6)).</>
                : <>Tell your landlord when you are leaving and where to mail the itemized statement. It is mailed to the address you give; with none, it goes to the unit you are leaving (Civ. Code 1950.5(h)(6)).</>}
            </p>
            <MovingOutForm token={token} tenants={v.tenants} today={v.today} moveOutDate={v.moveOutDate} existing={v.moveOut} />
          </>
        )}
      </Section>

      {st && (
        <Section title="Itemized statement" cite="Civ. Code 1950.5(h)">
          <p className="text-[14px] text-ink-2">Delivered by {describeDelivery(st.delivery)}.</p>
          <div className="mt-3 flex flex-wrap gap-2">
            <a href={pdf} target="_blank" rel="noreferrer" className="rounded-xl bg-ink px-4 py-2 text-[14px] font-semibold text-white hover:opacity-90">Open the statement (PDF)</a>
            <a href={`${pdf}?download=1`} className="rounded-xl border border-line bg-surface px-4 py-2 text-[14px] font-semibold text-ink hover:bg-bg">Download</a>
          </div>
          {/* Built fresh from the landlord's records on each request (no copy of the mailed PDF is kept), so the copy says so. */}
          <p className="mt-2 text-[12px] text-ink-3">The PDF is built from your landlord&apos;s records as they stand, dated the day the statement went out, with the photo exhibits and copies of any invoices. The paper or email you received is the statement itself.</p>

          {st.deductions.length ? (
            <ol className="mt-4 divide-y divide-line border-t border-line">
              {st.deductions.map((d, i) => (
                <li key={i} className="flex flex-wrap items-baseline gap-x-3 gap-y-1 py-3">
                  <div className="min-w-0 flex-1">
                    <p className="text-[14px] font-semibold">{d.item}{d.room && <span className="font-normal text-ink-3"> · {d.room}</span>}</p>
                    <p className="text-[12px] text-ink-3">{TAGS[d.category].tag} {TAGS[d.category].label}</p>
                  </div>
                  <p className="text-[14px] font-semibold tabular-nums">{usd(d.amount)}</p>
                </li>
              ))}
            </ol>
          ) : (
            <p className="mt-4 border-t border-line pt-3 text-[14px] text-ink-2">No deductions.</p>
          )}
          <dl className="mt-2 space-y-1.5 border-t border-line pt-4 text-[14px]">
            <Row label="Security held">{usd(st.depositHeld)}</Row>
            <Row label="Total deductions">{st.total ? `-${usd(st.total)}` : usd(0)}</Row>
            {st.balanceClaimed > 0
              ? <Row label="Balance claimed" strong>{usd(st.balanceClaimed)}</Row>
              : <Row label={v.returned ? "Returned" : "Refund"} strong>{usd(v.returned?.amount ?? st.refund)}</Row>}
          </dl>
          <p className="mt-3 text-[14px] leading-relaxed text-ink-2">
            {v.returned
              ? <>{usd(v.returned.amount)} was returned by PayPal {v.returned.kind === "payout" ? "Payout" : "refund"} on {longDate(pacificDate(v.returned.at))}{v.returned.paypalId && <> (id <span className="font-mono text-[12px]">{v.returned.paypalId}</span>)</>}; PayPal reports it as {words(v.returned.status)}.</>
              : st.refund > 0
                ? <>{usd(st.refund)} is to be returned{a ? <> by PayPal to {a.paypalEmail}</> : null}{v.statementDue ? `, due by ${longDate(v.statementDue)}` : ""}.</>
                : st.balanceClaimed > 0
                  ? <>The deductions exceed the deposit by {usd(st.balanceClaimed)}. The statement records that amount as a claim; it is not a demand for immediate payment.</>
                  : <>The deductions used the whole deposit, so nothing is left to return.</>}
          </p>
          {st.deductions.some((d) => d.category !== "rent") && (
            <p className="mt-2 text-[13px] leading-relaxed text-ink-3">
              {st.documentsRequired
                ? "Repair and cleaning deductions total more than $125, so the law requires the invoices, receipts, labor records and photos with the statement (Civ. Code 1950.5(h)(2)). The PDF lists exactly what it holds."
                : "Repair and cleaning deductions total $125 or less, so those documents are not required with the statement. You may request them within 14 days of receiving it, and the landlord then has 14 days to provide them (Civ. Code 1950.5(h)(4)-(5))."}
            </p>
          )}
        </Section>
      )}

      <Section title="Your rights, as the statute states them">
        <p className="text-[13px] leading-relaxed text-ink-3">
          California Civil Code section 1950.5 in plain words, with the facts on file for this tenancy where they fit. Nothing here is advice about your situation.
        </p>
        <ul className="mt-4 space-y-4">
          {rights.map((r, i) => (
            <li key={i}>
              <p className="text-[14px] leading-relaxed">{r.text}</p>
              <p className="mt-0.5 text-[12px] text-ink-3">{r.cite}</p>
            </li>
          ))}
        </ul>
      </Section>

      <footer className="mt-10 space-y-2 border-t border-line pt-5 text-[12px] leading-relaxed text-ink-3">
        <p>This page shows the records your landlord keeps with Deposit Agent and the rules as California Civil Code 1950.5 states them. It is not legal advice and does not evaluate your situation.</p>
        <p>
          If you and your landlord disagree about a deduction, the California courts&apos;{" "}
          <a href={COURTS_GUIDE} target="_blank" rel="noreferrer" className="underline underline-offset-2 hover:text-ink">self-help guide to security deposits</a>{" "}
          explains how such disputes are handled.
        </p>
      </footer>
    </main>
  );
}

/** One line on where the deposit stands, from the latest fact on file. */
function standing(v: TenantView): { title: string; detail: string } {
  const st = v.statement;
  if (st) {
    const sent = `The itemized statement went out by ${describeDelivery(st.delivery)}.`;
    if (v.returned) return { title: `${usd(v.returned.amount)} returned to you`, detail: `By PayPal ${v.returned.kind === "payout" ? "Payout" : "refund"} on ${longDate(pacificDate(v.returned.at))}. ${sent}` };
    if (st.refund > 0) return { title: `${usd(st.refund)} to come back to you`, detail: `${sent}${v.statementDue ? ` The refund is due by ${longDate(v.statementDue)}, 21 days after move-out (Civ. Code 1950.5(h)(1)).` : ""}` };
    if (st.balanceClaimed > 0) return { title: "Statement sent; the deductions exceed the deposit", detail: `${sent} It records ${usd(st.balanceClaimed)} as a claim, not a demand for immediate payment.` };
    return { title: "Statement sent; nothing left to return", detail: `${sent} The deductions used the whole deposit.` };
  }
  if (v.moveOutDate && v.statementDue) {
    return { title: `Moved out ${longDate(v.moveOutDate)}`, detail: `The itemized statement and the rest of the deposit are due by ${longDate(v.statementDue)}, 21 calendar days after move-out (Civ. Code 1950.5(h)(1)).` };
  }
  if (v.noticeGivenOn) {
    return { title: v.plannedMoveOut ? `Moving out ${longDate(v.plannedMoveOut)}` : "Notice given", detail: `Your landlord recorded the notice given on ${longDate(v.noticeGivenOn)}.${v.moveOut ? " Your forwarding address for the statement is on file." : ""}` };
  }
  if (v.moveOut) {
    return { title: `Moving out ${longDate(v.moveOut.planned_move_out)}`, detail: `You sent this on ${longDate(tenantMoveOutSentOn(v.moveOut))}, with the forwarding address for the statement (Civ. Code 1950.5(h)(6)). Your landlord sees it on their side.` };
  }
  if (v.deposit?.paid) {
    // The date and invoice id sit in the Your deposit card just below, so this line says only what happens to it.
    return { title: `${usd(v.deposit.amount)} deposit held`, detail: "It comes back, less any lawful deductions, with an itemized statement within 21 calendar days after you move out (Civ. Code 1950.5(h)(1))." };
  }
  if (v.deposit) return { title: `Deposit invoice ${words(v.deposit.status)}`, detail: `PayPal invoice ${v.deposit.invoiceId} for ${usd(v.deposit.amount)} has not been paid yet.` };
  return { title: "No deposit invoice yet", detail: "Your landlord has not sent a deposit invoice through PayPal." };
}

function Section({ title, cite, children }: { title: string; cite?: string; children: React.ReactNode }) {
  return (
    <section className="mt-8">
      <div className="flex flex-wrap items-baseline gap-3">
        <h2 className="text-[18px] font-semibold tracking-[-0.01em]">{title}</h2>
        {cite && <span className="ml-auto text-[12px] text-ink-3">{cite}</span>}
      </div>
      <div className="mt-3 rounded-2xl bg-surface p-5 shadow-sm">{children}</div>
    </section>
  );
}

function Row({ label, strong, children }: { label: string; strong?: boolean; children: React.ReactNode }) {
  return (
    <div className={`flex justify-between gap-4 ${strong ? "text-[16px] font-semibold" : "text-ink-2"}`}>
      <dt>{label}</dt>
      <dd className="tabular-nums">{children}</dd>
    </div>
  );
}

# State rule packs

Good Faith runs one engine and five rule packs. A tenancy follows the deposit law of the state its property is in, and every state-specific number, deadline, trigger, notice, document rule, refund-method rule, penalty and citation comes from that state's pack. Nothing in this folder is legal advice, and nothing the product shows is either: it enforces, warns, informs and drafts for the landlord to approve.

| State | Pack | Spec | Statute (chip) | Deadline | Cap |
|---|---|---|---|---|---|
| California | `src/lib/states/ca.ts` | [docs/LEGAL_RULES.md](../LEGAL_RULES.md) | Civ. Code 1950.5 | 21 days after move-out | 1 month (2 for a small landlord) |
| New York | `src/lib/states/ny.ts` | [NY.md](NY.md) | N.Y. GOL 7-108 | 14 days after the tenants vacate | 1 month (deposit plus advance) |
| Texas | `src/lib/states/tx.ts` | [TX.md](TX.md) | Tex. Prop. Code ch. 92 | 30 days after surrender, owed once a written forwarding address arrives | none |
| Florida | `src/lib/states/fl.ts` | [FL.md](FL.md) | Fla. Stat. 83.49 | 15 days with no claim; a claim notice within 30 days, then the balance 30 days after it | none |
| Washington | `src/lib/states/wa.ts` | [WA.md](WA.md) | RCW 59.18.280 | 30 days after the tenancy ends and the tenants vacate | none |

Every other state is refused by name: "Good Faith supports California, Florida, New York, Texas and Washington for now."

## How a tenancy gets its pack

- `properties.state` (two-letter code, default `'CA'`) holds the property's state. Every property that existed before the packs is California, so the column was added with that default (migration `20261003183902_property_state_and_state_records.sql`). The hosted demo's copy function inserts properties without the column and gets `'CA'`, which is right for its California templates.
- The lease check reads the state from the lease (`extract.ts` asks for it; a blank answer is null). When the lease does not say, the address is parsed (`stateCode` in `src/lib/states/index.ts`). The lease check always shows the State picker, for a lease read as California too (Andrew's decision of 2026-10-04), so a misread state is corrected before the tenancy starts; the state it shows is what `POST /api/tenancies` stores. An unsupported state gets the plain refusal above and no tenancy.
- Each pack is two files. `<state>.ts` is the client half (`ClientPack`): the lease rules, tips, labels, records, deadlines and delivery rules the client components read. `<state>.server.ts` is the server half (`ServerPart`): the statement checklist and its graders, the close-out agent's rules and prompt, the next-step hooks, the calendar and the tenant page. Client components get a `state` string prop and call `packFor` from `src/lib/states/index.ts`, which returns the client half, so the prompts and the graders never ship to the browser. Server code calls `packFor` from `src/lib/states/server.ts` (marked `server-only`), which joins the halves into the whole `StatePack`; `tenancyPack(id)` and `tenancyDue(id, moveOut)` (`src/lib/tenancy-pack.ts`) do the same from a tenancy id.
- City rules (New York City, Kingston, Seattle, Tacoma, Bellingham, Olympia, Austin, Dallas, San Antonio, the Florida cities whose ordinances are preempted) are `localOverlays` in each pack. They are only ever shown, as the amber "Local rules" label beside the Rules chip; they never block or change an amount. California's list is empty, so California pages are unchanged; its local interest ordinances stay where they were, on the statement.

## What a pack holds

`src/lib/states/types.ts` defines `StatePack`. Each section carries its citations next to its values.

| Section | What it decides |
|---|---|
| `statute`, `chip`, `courtsGuide`, `copy` | The statute's names (`short` for the chip, `full`, `inline` as a sentence names it), the Rules chip and its tip, the Help menu's guide, the four disclaimers, the "prepared under" line, the tenant page's "about" line |
| `lease` | `evaluate` (the lease check's flags, by the spec's rule ids), `lawful` (the deposit the invoice may ask for), `securityTotal` and `securityCharge` (which move-in charges count), the cap tile, the law cards and the four steps on the lease check, and the invoice note and terms. The lease check shows the state picker for every lease |
| `deadline` | Days, what starts the clock (`clockStart`), `due` (Florida's depends on whether a claim notice went out), `lastDay` (New York: General Construction Law 25-a runs a 14th day on a weekend or public holiday to the next business day; `nyLate` in `ny.ts` is New York's whole day-14 rule, which the close-out, the statement, the next step and the dispute share), `words` (Florida's labels: "Claim notice due", "Balance and statement due"), the tips, the rail text, the late warning, whether the move-out date must be recorded first, and when a ledger entry is allowed |
| `moveIn`, `moveOut` | Whether move-in photos are required and from when, and the photo tips |
| `refund` | Whether a signed refund agreement is required (California by statute; Washington as product policy, since a PayPal refund is outside its hand-or-mail safe harbor), and the agreement text and blockers |
| `documents` | When invoices or receipts are required (California over $125, Washington always, the others never by statute), whether after-photos, vendor contacts or evidence are required, and the tips |
| `tags`, `ledger`, `findings` | The deduction categories' tags and words, and the Why? tips on findings |
| `records` | The dated records the state asks for: notices, checklists, accounts, the forwarding address, the claim notice and objection. Each has its phase, title, cite, rule id, tip, delivery methods, form fields, and (when the app drafts it) the draft body; `after` decides when it is listed (`listedRecords` in `src/lib/notices.ts`), and `status` adds a line to its page (Florida: whether an objection came in time) |
| `notices` | The refund notice and the pre-move-out inspection window (California 14 days before the end with 48 hours' notice; New York the same window, excused only when the tenants themselves gave less than 14 days' notice, which is why the New York notice form asks who gave it), and their tips |
| `delivery` | How the statement may be delivered: email only on the tenants' agreement (California), under a signed s. 83.505 addendum (Florida) or, on a lease from September 2025, after a first email exchange (Texas 92.113); email open (New York); email as a courtesy copy only (Washington); whether the vacated unit is a fallback address; and how an email delivery is named on the record (`emailWord`, saved with it as `basis`) |
| `close` | The close-out agent's RULES; extra blockers and warnings (New York's forfeiture after day 14 as extended by GCL 25-a: a hard block with no override, lifted only by removing the deductions, except while a dispute the tenants sent is open, when the close-out returns the whole deposit with the deductions still on file; Florida's claim notice, receipt and objection window; Texas's forwarding address; Washington's signed checklist before a damage deduction); and `standing`, how claimed amounts stand when they are not plain deductions (Florida: "Claimed, disputed" after a timely objection; New York: "Forfeited after day 14", `forfeits`: the lines stay as claimed, the totals add them back and show the whole deposit as owed), which the statement, its PDF, the tenant page and the refund page print |
| `steps` | The next-step machinery's state hooks: the flow's labels, a move-in step that must come before the invoice, a step once notice is given while the move-out is still ahead (Texas: ask for the forwarding address in writing), what follows the inspection, and `forfeit` (New York only: once day 14 passed before the statement and the rest of the deposit, the full refund is the step, before the statement goes out and after) |
| `calendar`, `statement` | The calendar event texts; the statement's checklist (13, 13, 11, 12 and 13 items), interest, notes, section cites and PDF lines, and whether the wear-and-tear findings are listed at $0 (`wearAtZero`: Texas, Florida, Washington) |
| `tenant` | The tenant page's tips and the "your rights" lines |
| `ai` | The close-out agent's SYSTEM prompt, its tool descriptions, and the inspection guide the photo comparison reads |
| `localOverlays` | City rules, shown only |
| `dispute` | A tenant's dispute of the statement (`src/lib/lawful-range.ts`, `src/lib/advocate.ts`): what a late statement costs (`late.effect`: `forfeit` in New York, Florida and Washington, `flag` in California and Texas) and when it is late (`isLate`, from the later of the statement and the refund; Florida's is the claim notice), with a `doubt` that keeps a forfeiture from applying when it turns on a reading or a fact the file can't settle (Washington's early move-out, Florida's 83.49(5) tenant notice), the evidence rule a charge is weighed by, where a dispute goes (`forum`), a rule that bars a line outright (Washington's move-in checklist), the state's own cleaning rule (`cleaningRule`: California's professional cleaning, Washington's carpet cleaning), whether supplying missing documents can still support a charge (`documentsCure`, California), and a line above Send (`sendNote`, Florida: not the statutory objection). `scripts/lawful-range-check.mjs` checks them |

`guardRefund` still decides every refund in code from the facts. The packs change which facts block (a missing forwarding address, a claim notice not yet received, a forfeited claim), never the rails, the amount math or PayPal's 180-day refund window, which stay common to every state.

## California inventory

Every California-specific rule that was in code before the packs, and where it lives now. Each moved verbatim: `scripts/ca-snapshot.mjs` proves California's output is byte for byte what it was.

| Rule (spec id) | Was in | Now in `ca.ts` |
|---|---|---|
| Lease flags: cap over one or two months (D3), unknown cap (D4), "nonrefundable" security (D8), mandatory professional cleaning (D10, AB 2801), late fee as a reasonable estimate (D26), move-in photos required (D13), electronic refund (D16, AB 414), adult tenants named (D19) | `rules.ts` `evaluateLease` | `lease.evaluate` |
| Everything charged at move-in except first month's rent is security (D1); small-landlord exemption (D4, D5) | `rules.ts` `totalSecurity`, `smallLandlordExempt` | `lease.securityTotal`, `lease.lawful` (the helpers stay in `rules.ts` and are used by the pack) |
| The cap the invoice is held to (AB 12) | `rules.ts` `lawfulDeposit`, `api/tenancies/[id]/deposit-invoice` | `lease.lawful`, `lease.invoiceNote`, `lease.invoiceTerms` |
| Move-in photos required on tenancies from 2025-07-01 (AB 2801) | `rules.ts` `MOVE_IN_PHOTOS_FROM` | `moveIn.photosFrom` |
| 21-day statement and refund deadline from move-out (1950.5(h)(1)) | `deductions.ts` `statementDue`, `next-step.ts`, `ics.ts`, `tenant-view.ts`, `ledger.ts` | `deadline.days`, `deadline.due`, `deadline.clockStart` |
| Receipts or invoices required over $125 of repair and cleaning (1950.5(h)(2)) | `deductions.ts` `RECEIPT_THRESHOLD` | `documents.threshold` |
| Deduction categories (b)(1) rent, (b)(2) damage, (b)(3) cleaning | `copy.ts` `TAGS`, `ledger.ts` | `tags`, `ledger` (the old `TAGS` constant is kept, unused by the app) |
| Wear-and-tear, damage and cleaning Why? tips | `findings.ts` `KIND` | `findings` (`KIND` is now `kindsFor(CA)`) |
| Initial-inspection notice: 14-day window, 48 hours' notice, the draft (1950.5(f)) | `notices.ts` `INSPECTION_WINDOW_DAYS`, `INSPECTION_NOTICE_HOURS`, `NOTICE_INFO`, the drafts page | `notices.inspection`, `records` (the California drafts page itself is unchanged) |
| Electronic-refund notice and its status (AB 414) | `notices.ts` `refundNoticeStatus` | `notices.refundNotice`, `records` |
| Refund agreement required, its text and its blockers (1950.5(h)(1)(A)) | `closeout.ts`, `api/tenancies/[id]/agreement` | `refund` |
| Statement delivery by email only with the tenants' agreement; the vacated unit as fallback (1950.5(h)(6)) | `api/tenancies/[id]/statement/delivery`, `delivery-form.tsx` | `delivery` |
| The close-out RULES the agent quotes | `closeout.ts` `RULES` | `close.rules` (`rulesFor(pack)` in `closeout.ts`) |
| The close-out agent's SYSTEM prompt and tool descriptions | `agent.ts` `SYSTEM` | `ai.closeOutSystem`, `ai.factsToolDescription`, `ai.checklistToolDescription` |
| The inspection guide (1950.5 and the DRE guide) | `inspect.ts` `GUIDE` | `ai.inspectionGuide` |
| The 13-item statement checklist, local interest (San Francisco, Los Angeles RSO, Berkeley, West Hollywood), notes, cites | `statement.ts` `checklist`, `localInterest`, `statement/page.tsx` | `statement` |
| The PDF's statute lines, deadline line and disclaimers | `statement-pdf.ts` | `statement.pdf`, `copy` |
| The four disclaimers (LEGAL_RULES section F) | `copy.ts` `DISCLAIMERS` | `copy.disclaimers` (the copy constant stays for the Help menu of a California-only workspace) |
| Next steps: photos, the inspection notice, the refund notice, the statement, the refund, the deadline levels | `next-step.ts` | `steps`, `deadline`, `notices` |
| Calendar events: the inspection window, the deadline | `ics.ts` | `calendar` |
| Tenant page: the rights lines, the deadline, the delivery and proration tips | `t/[token]/page.tsx`, `tenant-view.ts` | `tenant` |
| Why? tips on the property, statement, settlement, money and units pages that cite 1950.5 | each page | the pack section that owns the rule |

What stays in code for every state: the deduction math and proration (`deductions.ts`, DRE guidance labeled as such), the refund rails and `guardRefund` (`closeout.ts`), PayPal's 180-day refund window, the 60-day check-in before a lease ends, and the audit log. Comments that cite 1950.5 in files California alone reaches (the photo and statement routes) were left as they are.

## Records

The `tenancies.notices` jsonb holds one dated record per kind. California's two kinds (`inspection`, `electronic_refund`) are still written by `set_notice()`, unchanged. The other packs' kinds (`move_in_inspection`, `deposit_account`, `holding_notice`, `move_in_checklist`, `forwarding_address`, `claim_notice`, `claim_objection`) are written by `set_state_notice()` (migrations `20261003183902` and `20261003202355`; the function still accepts `late_acknowledgment`, New York's old override for deductions kept after day 14, which nothing records since day 14 became a hard block on 2026-10-04). A record may carry a `detail` (an account, a tracking number, an address) and a `received` date (Florida's claim notice). Each record's audit entry carries the pack's name and verb for it, so the activity log reads "Forwarding address received", not "given".

`tenancies.notice_given_by` (`tenant`, `landlord` or null; migration `20261003202355`) records who gave the notice to end the tenancy where the state asks (New York). Null means not recorded, and the app then treats the New York inspection-rights notice as owed.

## Verifying

```bash
node scripts/ca-snapshot.mjs           # California's output against scripts/fixtures/ca-snapshot.json; exits 1 on any difference
node scripts/state-packs-check.mjs     # the per-state unit checks: deadlines, caps, flags, blockers, records, statements
```

`ca-snapshot.mjs` needs `.env.local`, the two template tenancies and the PayPal sandbox (it reads their deposit invoices); a sandbox or storage hiccup shows up as a difference in the PDF section only, and the script says so. It runs the lib code (lease flags, deadlines, deductions, close-out facts and plans, next steps, notices, ledger, statements and the text of their PDF, the tenant view, the calendar, the agent's prompts) against the two California template tenancies and variants of their lease that walk every flag, with the clock frozen. It reads the database and storage with `.env.local` and the templates' deposit invoices from the PayPal sandbox, writes nothing, and makes no Claude call. `--write` replaces the baseline, which only a deliberate California change should do; `--out f` saves the run to diff by hand. `state-packs-check.mjs` is pure: no database, no PayPal, no Claude.

## Adding a state

1. Write the spec as `docs/rules/<XX>.md`, from primary sources, with rule ids.
2. Add `src/lib/states/<xx>.ts` (the `ClientPack`) and `src/lib/states/<xx>.server.ts` (the `ServerPart`) from it, and register them in `src/lib/states/index.ts` (`PACKS`, `SUPPORTED`, `STATE_NAMES`) and `src/lib/states/server.ts`.
3. If it needs a new record kind, add the kind to `RecordKind` and to `set_state_notice()` in a new additive migration.
4. Add its checks to `scripts/state-packs-check.mjs`, and run both scripts.

## Known gaps

The packs enforce what is above. These rules marked E (enforce) in the verified specs are not in code yet; the app neither applies nor contradicts them, and the Rules chip's tip should not be read as saying it does:

- **Texas.** T4 (a fee-in-lieu lease is flagged and routed out), T7 (a no-notice deduction or forfeiture needs the lease clause underlined or in bold, confirmed by the landlord), T23 (with no deposit and deductions on file, the 92.110 claim notice before any collection step), T30 (a rekey deduction needs a lease break on record and the underlined or bold clause). T7 and T30 need only the clause from the extractor and the landlord's confirmation.
- **Florida.** F1 (a transient, subsidized or otherwise regulated tenancy is flagged as possibly outside 83.49), F13 (the tenant's 7-day notice recorded with its date and method), F21 (an early-termination or liquidated-damages deduction only with the signed 83.595 addendum, capped at 2 months' rent), F23 (a servicemember's termination blocks early-termination and future-rent deductions).
- **Washington.** W10's offer of installments in the invoice flow (the lease check only flags the right), W12 (the 25 percent cap on a holding deposit and its credit into the deposit), W19's materials receipt for the landlord's own work and the copy of an estimate itself (`is_estimate` stands in for "copies of estimates received").
- **New York.** N14 is a next step after the deposit invoice, not a block before occupancy; N24 (the transfer workflow when the building is sold); the interest line (checklist item 3) has no fields for the rate, period, 1 percent fee and amount, so it stays "missing" in a building of six or more units, as California's local-interest item does.

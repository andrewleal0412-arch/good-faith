# Texas security deposit rules spec (as of 2026-10-03)

Researched 2026-10-03 by a Fable research agent from primary sources: the official text of Property Code Chapter 92 on statutes.capitol.texas.gov, rendered from the legislature's own site, which states it is "current through the 89th 2nd Called Legislative Session, 2025" [S1]. Every section of Subchapter C (92.101 to 92.113) was read with its history note, and the two bills that changed the subchapter since 2019 were read in their enrolled form [S2][S3]. TexasLawHelp and the State Law Library guide were used only to cross-check, never as the citation [S9][S10]. Verified 2026-10-03 by a second agent against the same official text, rendered again in a headless browser the same day (section "Verification" at the end: 3 corrections, 11 clarifications, one missed rule added as T30), and again the same day by a third agent in an adversarial pass that re-rendered every cited statute and re-read every bill text and city ordinance ("Verification, second pass": 5 corrections, 6 clarifications, no change to any number, deadline or penalty).

This is the rulebook the app enforces for Texas. The product never gives legal advice; it enforces, warns, informs and drafts for the landlord to approve (section K).

**Status of the law.** Security deposits are governed by Property Code Title 8, Chapter 92, Subchapter C, Sections 92.101 to 92.113 [S1]. The subchapter was last amended by HB 2037 (Acts 2025, 89th Leg., R.S., ch. 732, Sec. 2), effective September 1, 2025, which added 92.112 (agents for delivery of notice) and 92.113 (notice by e-mail); the Act applies only to "a lease entered into or renewed on or after the effective date" [S2]. Before that:
- SB 1783 (Acts 2021, 87th Leg., R.S., ch. 189): added 92.111, the fee in lieu of a security deposit, effective September 1, 2021, for leases entered into or renewed on or after that date [S3].
- Nothing else in 92.101 to 92.110 has changed since 2019. The history notes end in 1984 (92.104, 92.106, 92.107, 92.108, 92.109), 1996 (92.101, 92.102, 92.103, 92.1031, 92.1041) and 2016 (92.105(b-1), 92.110, both from SB 1367) [S1].
- HB 3405 (88th Leg., 2023) would have rewritten 92.107 (how the forwarding address may be given: hand delivery, certified or first-class mail, tracked delivery) and 92.109(d) (the presumption would run only after the address was given); it died in the House. Last action 05/05/2023: "H Comm. report sent to Local & Consent Calendar" [S4]. It is not law.
- HB 2037 itself was filed as the refile of HB 3405: its introduced text (and the identical Senate companion SB 851 by Middleton, same Legislative Council draft 89R 2410) would have rewritten 92.107 (hand delivery, first-class, certified or registered mail, or any tracked delivery service for the forwarding address, effective even if the landlord refuses delivery) and 92.109(d) (the presumption would run from the 30th day after the tenant had both surrendered possession and given the address). The House committee substitute, "reported favorably as substituted", dropped both sections and put 92.112 and 92.113 in their place, and that is what passed [S2][S18]. So the legislature has twice (2023, 2025) had the "presumption only after the address" change before it without enacting it; the enacted 92.109(d) still counts from surrender of possession.
- 89th Leg. (2025) bills that did not pass [S16]: SB 851 (Middleton), the companion of HB 2037 as filed, last action 02/13/2025 "Referred to Business & Commerce"; HB 798 (Walle), "certain rights and duties of residential tenants and landlords; increasing the amount of civil penalties", last action 03/05/2025 "Referred to Trade, Workforce & Economic Development"; HB 4305 (Gates), disclosure of rent and fees, last action 04/01/2025, referred to the same committee. None is law.
- SB 38 (89th Leg., R.S., 2025), the eviction procedure act, takes effect January 1, 2026 (its Section 16 on September 1, 2025) and applies to eviction suits filed on or after that date. It does not mention security deposits; it matters here only for the city eviction-notice overlays in section L [S15].
- No section of Subchapter C carries a future effective date on the official site as of 2026-10-03. The only other 2025 changes anywhere in Chapter 92 are to 92.0135 (floodplain notice, SB 2349), 92.0161 (vacating after certain offenses, HB 47) and 92.0561(f) (who may make a tenant's repair, HB 2037 Sec. 1); none concerns the deposit.
- Outside the subchapter: 92.019 (late fees) was last amended by SB 1414, effective September 1, 2019 [S1]; Property Code 1.004 (state preemption of city ordinances in fields the code occupies) was added by HB 2127, effective September 1, 2023 [S5].

Texas has **no deposit cap, no deposit interest, no move-in checklist statute, no pre-move-out inspection, no "where the deposit is held" notice and no prescribed refund method.** The whole regime is: refund or account within 30 days of surrender, once the tenant has given a written forwarding address, with a written itemized list, under a bad-faith penalty of $100 plus three times the amount wrongfully withheld plus fees.

**Why this matters for PayPal.** The statute does not say how the refund must travel, so a PayPal refund of the deposit invoice is a lawful way to pay it and needs no written agreement. Two things change from the California flow: the mailing presumption in 92.1041 covers only US mail with a postmark, so a PayPal refund proves its date with PayPal's own timestamp and the app's send record; and the refund and the written itemized list are not owed until the tenant's forwarding address arrives in writing (92.107), so the tenant page must collect that address and the app must record the day it arrived.

## A. Rules table

Citations are to the Property Code unless noted. Action: E = enforce (block), W = warn, I = inform. "In force" means the text dates from the 1984 codification or the 1996 amendments and has not changed since.

| ID | Rule (plain English) | Cite | Effective | Action | Fields |
|---|---|---|---|---|---|
| T1 | The subchapter applies to all residential leases, and a landlord's duties and a tenant's remedies about security deposits "may not be waived". A lease of a lot in a manufactured home community is governed instead by Chapter 94, whose own deposit subchapter (94.101 to 94.111) is parallel but separate (30th day after the tenant "surrenders the manufactured home lot", 94.103(a)) and out of scope | 92.101; 92.006(a); 94.002, 94.101 [S19] | in force | E: a lease clause waiving or shortening any deposit duty is flagged void; a manufactured-home lot lease is flagged out of scope | lease_text, property_type |
| T2 | A security deposit is "any advance of money, other than a rental application deposit or an advance payment of rent, that is intended primarily to secure performance under a lease". The label does not control: money that secures performance is a deposit however the lease names it (the spec's reading of "intended primarily"; see open question 5). A rental application deposit is outside this subchapter and has its own refund regime in 92.351 to 92.355 (deemed rejection on the 7th day, refund, $100 plus three times the amount plus fees for bad faith) | 92.102; 92.351 | in force (1996 text) | E: each move-in charge is classified deposit, application deposit, advance rent or fee; W when a "nonrefundable" fee looks like security | move_in_charges[], charge.label, charge.purpose |
| T3 | No cap on the amount, no interest, no separate-account or holding-notice duty | none (no statute) | n/a | I: the amount and its ratio to rent are shown for information only; nothing blocks | deposit_amount, monthly_rent |
| T4 | Fee in lieu of a deposit: a landlord who offers one must also offer the deposit option, may not use the choice as an approval criterion, must give the three-part written notice, and must sign a written agreement; the fee must be "a recurring fee of equivalent amount" due with each rent payment; it may buy insurance, and the fee may not exceed "the reasonable cost of obtaining and administering the insurance"; the fee is a security deposit for Chapter 92 unless a signed agreement exists and the fee buys insurance; before any insurer claim the landlord must give the tenant a written description and itemized list within 30 days of surrender | 92.111(a)-(h), (j) | 2021-09-01, leases entered into or renewed on or after [S3] | E (scope): the product runs deposits only. A fee-in-lieu lease is flagged; it is treated as a deposit tenancy only when 92.111(g) makes the fee a deposit | lease_fee_in_lieu, fee_agreement_signed, fee_buys_insurance, lease_signed_or_renewed_date |
| T5 | Refund "on or before the 30th day after the date the tenant surrenders the premises" | 92.103(a) | in force (1996 text) | E: 30-day countdown from the surrender date | surrender_date |
| T6 | The landlord is not obligated to refund or to give the written description "until the tenant gives the landlord a written statement of the tenant's forwarding address for the purpose of refunding the security deposit"; the tenant never forfeits the deposit or the description by failing to give one | 92.107(a)-(b) | in force | E: refund and statement wait for a written address; W at day 30 with no address; the deposit is never marked forfeited for a missing address | forwarding_address, forwarding_address_received_date, forwarding_address_written_evidence |
| T7 | A lease requirement that the tenant give advance notice of surrender as a condition of refund "is effective only if the requirement is underlined or is printed in conspicuous bold print in the lease" | 92.103(b) | in force | E: a no-notice deduction or forfeiture needs the clause and the landlord's confirmation that it is underlined or bold; the lease check extracts the clause and asks | lease_notice_of_surrender_clause, clause_conspicuous, notice_given_date |
| T8 | The tenant's claim to the deposit "takes priority over the claim of any creditor of the landlord, including a trustee in bankruptcy" | 92.103(c) | in force | I | none |
| T9 | Deductions only for "damages and charges for which the tenant is legally liable under the lease or as a result of breaching the lease" | 92.104(a) | in force | E: every deduction names its basis: unpaid rent, damage beyond wear and tear, a lease charge (quoted), or a breach | deduction.basis, lease_clause_ref |
| T10 | No deduction for normal wear and tear: "deterioration that results from the intended use of a dwelling", not deterioration from "negligence, carelessness, accident, or abuse" by the tenant, household or guests | 92.104(b); 92.001(4); 92.111(i) | in force | E: wear-and-tear findings are $0 | finding.kind |
| T11 | When any part is kept, the landlord gives the tenant the balance "together with a written description and itemized list of all deductions" | 92.104(c) | in force | E: no partial refund leaves without the statement | deductions[], balance_refunded |
| T12 | The description and list are not required if the tenant owes rent at surrender and "there is no controversy concerning the amount of rent owed" | 92.104(c)(1)-(2) | in force | I: the app still itemizes; the exception is shown, never relied on | rent_owed_at_surrender, rent_amount_disputed |
| T13 | A refund or accounting "placed in the United States mail and postmarked on or before the required date" is presumed timely | 92.1041 | 1996-01-01 | E: the delivery record stores the postmark date; e-mail and PayPal get no presumption, so the app stores PayPal's timestamp and the send record instead | delivery_method, postmark_date, refund_timestamp |
| T14 | Notices and communications under the subchapter "may be sent by e-mail if the tenant and the landlord or landlord's agent have previously communicated by e-mail"; the landlord may designate an address for the tenant to use | 92.113 | 2025-09-01, leases entered into or renewed on or after [S2] | E (product policy): e-mail as the delivery of record unlocks only with a recorded prior e-mail exchange and a qualifying lease date; otherwise mail or hand delivery is the record and e-mail a courtesy copy. The statute prescribes no method and forbids none, so e-mail to a tenant on an older lease is not unlawful; it only lacks 92.113's express basis and the 92.1041 postmark presumption | lease_signed_or_renewed_date, prior_email_evidence, tenant_email, landlord_designated_email |
| T15 | A managing agent, leasing agent or resident manager "is the agent of the landlord for purposes of notice" under the subchapter | 92.112 | 2025-09-01, same applicability | I: a forwarding address given to the manager counts | manager_contact |
| T16 | "The landlord shall keep accurate records of all security deposits" | 92.106 | in force | E: the ledger and audit log are the record; exportable | none |
| T17 | Owner change: the new owner is liable for the deposit from the date title is acquired and must deliver a signed statement acknowledging the acquisition and the responsibility and "specifying the exact dollar amount of the deposit"; the former owner stays liable until the new owner has received the deposit or assumed the liability, unless a written contract says otherwise; a mortgage lienholder taking title by foreclosure is excepted | 92.105(a)-(c) | in force; (b-1) 2016-01-01 | E: transfer workflow drafts the signed statement and records the handoff | sale_date, successor_contact, deposit_amount, transfer_contract |
| T18 | The tenant may not withhold the last month's rent on the ground that the deposit covers it; doing so is presumed bad faith and costs three times the rent withheld plus fees | 92.108 | in force | I: unpaid last month's rent is a T9 deduction; the app never computes the tenant's penalty | rent_ledger |
| T19 | Bad-faith retention: "$100, three times the portion of the deposit wrongfully withheld, and the tenant's reasonable attorney's fees" | 92.109(a) | in force | I: risk banner | none |
| T20 | Bad-faith failure to give the written description and itemized list: the landlord "forfeits the right to withhold any portion of the security deposit or to bring suit against the tenant for damages to the premises", plus fees | 92.109(b) | in force | E: a refund of less than the full deposit is blocked until the statement is on record | statement_sent_date |
| T21 | In the tenant's suit "the landlord has the burden of proving that the retention of any portion of the security deposit was reasonable" | 92.109(c) | in force | E (product policy, not statute): every deduction carries evidence: photos, an invoice or a labor description | photos[], invoice, labor_description |
| T22 | A landlord "who fails either to return a security deposit or to provide a written description and itemization of deductions on or before the 30th day after the date the tenant surrenders possession is presumed to have acted in bad faith" | 92.109(d) | in force | E: the countdown turns red at day 30; nothing is blocked afterwards, late is better than never | surrender_date, refund_sent_date, statement_sent_date |
| T23 | Lease with no deposit: before reporting a claim to a consumer reporting agency or debt collector the landlord must give written notice of the claim; not required when no forwarding address was given; failure forfeits the right to collect | 92.110 | 2016-01-01 | E: with a zero deposit and deductions on file, the claim notice is drafted before any collections step | deposit_amount, claim_notice_date, forwarding_address |
| T24 | Tenant who never moves in: the landlord may not keep the deposit or rent prepayment if a satisfactory replacement occupies by the lease start; if the landlord found the replacement, the landlord may keep a lease cancellation fee named in the lease or the actual expenses of finding the replacement, "including a reasonable amount for the time of the landlord" | 92.1031 | 1996-01-01 | E: a no-occupancy path with those two deductions only | occupied, replacement_found_by, lease_cancellation_fee, reletting_expenses |
| T25 | A late fee is deductible only if lawfully owed: notice of the fee in a written lease, a reasonable amount, and rent unpaid "two full days after the date the rent was originally due"; safe harbor 12 percent of the period's rent in a structure of four or fewer units, 10 percent above four (a higher fee is lawful only up to the landlord's uncertain damages from the late payment, 92.019(a-1)(2)); an unlawful fee costs $100 plus three times the fee plus fees; on request the landlord must give a written statement of any late fee owed (92.0191) | 92.019(a), (a-1), (c); 92.0191 | 2019-09-01 (SB 1414) | W: every late-fee deduction is flagged and the safe harbor computed | lease_late_fee_clause, units_in_structure, rent, late_fee_amount, days_late |
| T26 | Death of a sole-occupant tenant: the deposit, less lawful deductions including removal and storage, goes to the person the tenant designated or anyone lawfully entitled | 92.014(c)(3) | in force (1999) | I | tenant_deceased, designated_contact |
| T27 | Deposit disputes go to justice court, which hears civil matters up to $20,000 exclusive of interest; a corporation need not be represented by an attorney there | Gov. Code 27.031(a)(1), (d) | 2020-09-01 (SB 2342) | I: the dispute card points to the court's self-help pages | none |
| T28 | Templates and factual information only. Texas excludes from the practice of law forms and software that "clearly and conspicuously state that the products are not a substitute for the advice of an attorney" | Gov. Code 81.101(a), (c) | 1999-06-18 | E (copy and flow): the disclaimer is on every page and every document | none |
| T29 | The product performs no applicant screening; tenant selection criteria and the application deposit are the landlord's own duties, and fair housing law is out of scope | 92.3515; Prop. Code ch. 301 | in force | E (scope) | none |
| T30 | Rekeying after a lease break: the landlord rekeys at the landlord's expense within seven days of each turnover (92.156(a)); if the tenant "vacates the premises in breach of a written lease", the reasonable rekeying cost may be deducted from the deposit "only if the lease includes a provision that is underlined or printed in boldface type authorizing the deduction" | 92.156(a), (e) | (e) 2016-01-01 (HB 2404) | E: a rekey deduction needs a lease break on record and the landlord's confirmation that the clause is underlined or bold; the lease check extracts the clause and asks, as for T7 | lease_rekey_clause, rekey_clause_conspicuous, vacated_in_breach, rekey_invoice |

## B. What the app must collect at move-in

1. The lease PDF and the date it was signed or last renewed. That date decides whether 92.111, 92.112 and 92.113 apply (T4, T14, T15).
2. Every charge at the start, with its label and purpose: deposit, application deposit, advance rent, pet or cleaning fee. The engine sums what "secures performance" as the deposit (T2) and warns on fees called nonrefundable.
3. The notice-of-surrender clause, its text, and whether it is underlined or in bold in the lease (T7). The lease check extracts it; the landlord confirms the formatting, because the PDF text layer does not carry it reliably. The same check covers a rekey-deduction clause, which needs the same underlining or bold (T30).
4. Whether the lease offers a fee in lieu of a deposit, whether the agreement is signed and whether the fee buys insurance (T4).
5. The late-fee clause and the number of units in the structure (T25).
6. Move-in photos, room by room, and a condition record. Texas requires neither. The app collects them because the landlord carries the burden of proof (T21) and because the TAA lease forms make an Inventory and Condition Form a contract duty (practice, not statute).
7. The tenants' e-mail addresses and the first e-mail exchange (date, who, about what), so that 92.113 e-mail delivery is available at move-out (T14), and the landlord's designated e-mail address.
8. The refund method. The statute is silent. The app records that the deposit was paid through the PayPal invoice and tells the tenants the refund returns the same way; a payout to any other account needs the tenant's written designation (section G).
9. The managing agent or resident manager, if any (T15).
10. The owner of record and the exact deposit amount, so a later sale produces the 92.105(b) statement (T17).
11. Optional: the tenant's designated contact under 92.014 (T26).
12. Copy on the tenant page, at move-in: the forwarding address must be given in writing, and the refund waits for it (T6). Collecting the address early, through the moving-out form, is the single best protection for both sides.

## C. The deadline and what starts the clock

- **Due date.** The 30th day after the date the tenant surrenders the premises (92.103(a)). The bad-faith presumption counts from the day the tenant "surrenders possession" (92.109(d)). Both are calendar days.
- **Counting.** The Code Construction Act applies to the Property Code (Prop. Code 1.002): the first day is excluded and the last included, and a period ending on a Saturday, Sunday or legal holiday runs to the next business day (Gov. Code 311.014(a)-(b)) [S8]. The app shows the 30th calendar day and does not rely on the extension.
- **Time zone (Andrew's decision of 2026-10-05).** The days are counted in Central time (America/Chicago), where nearly all of Texas is: today and the day a refund or delivery went. El Paso and Hudspeth counties keep Mountain time. The app does not guess a zone from the city: for a property there (El Paso, Socorro, Horizon City, Anthony, Canutillo, Clint, San Elizario, Vinton, Fabens, Tornillo, Sierra Blanca, Dell City, Fort Hancock, Fort Bliss) it shows a "Time zone" warning beside the Rules chip and in the close-out, and still counts in Central time, so the local day ends at 11 PM there: anything done before then is on time on either clock.
- **Surrender.** Chapter 92 does not define it. The app records the surrender date as the day possession was returned (keys back, or the move-out date in the tenant's notice once nobody is living there), confirmed by the landlord. When keys and move-out differ, the app uses the earlier date for the countdown; that is the conservative reading.
- **Forwarding address gate.** The duty to refund and to send the description is suspended until the written forwarding address arrives (92.107(a)). The statute does not grant a fresh 30-day window after a late address. The app keeps the due date at surrender plus 30 days; when the address arrives after that day it shows "Due now" and records the day it arrived, which is the landlord's evidence against the 92.109(d) presumption. TexasLawHelp describes the deadline as 30 days from the move-out "or the date you provide notice of your new address, whichever is later" [S9]; that is a secondary reading, listed as an open question.
- **Written means written.** A text message, e-mail or the tenant page's moving-out form all produce a written statement of the address. The app stores the message as evidence and the date received.
- **Mail.** A refund or accounting placed in US mail and postmarked by the due date is presumed timely (92.1041). The delivery record asks for the postmark date.

## D. How the statement must be delivered

- The statute says the landlord "shall give to the tenant" the balance and the written description and itemized list (92.104(c)). No method is prescribed.
- The statute names no method and forbids none. With an express statutory footing: US mail to the forwarding address, with the 92.1041 postmark presumption; e-mail under 92.113 when the parties previously communicated by e-mail and the lease was entered into or renewed on or after September 1, 2025 (T14). Personal delivery satisfies "shall give" on its face. E-mail to a tenant on an older lease is not prohibited, but it has neither 92.113 behind it nor a postmark, so the app does not make it the delivery of record (product policy). A managing agent, leasing agent or resident manager may receive and send notices for the landlord (92.112).
- Address rule: the forwarding address the tenant gave in writing (92.107). With none on file there is no duty yet; the app holds the statement, keeps asking through the tenant page, and never sends to the vacated unit as a substitute.
- App defaults: first-class mail to the written forwarding address with the postmark recorded, plus a copy through the tenant page. E-mail as the only channel is offered when T14 is satisfied; for older leases the e-mail is a courtesy copy and the mail record is the delivery.

## E. Documentation rules

- Statute: a "written description and itemized list of all deductions" (92.104(c)) and accurate records of all deposits (92.106). No receipts, invoices, photos or dollar threshold are required by statute. California's $125 rule has no Texas counterpart.
- The landlord bears the burden of proving every retention reasonable (92.109(c)), so the app keeps the California packet structure as evidence and labels it "Evidence, not required by Texas law": before and after photos for repair and cleaning items, the vendor invoice or the landlord's labor description with hours and rate, the item's age for any proration.
- Each deduction states its basis (T9): the lease clause quoted, the breach, or the unpaid rent with the dates it was due. The fee-in-lieu notice under 92.111(j) must include "the dates the rent payments were due"; the app uses that format for every rent line.
- Estimates: the statute is silent. The app marks any estimate as such and follows up with the invoice, as a practice.

## F. Penalties

- Bad-faith retention: $100 plus three times the portion wrongfully withheld plus the tenant's reasonable attorney's fees (92.109(a)).
- Bad-faith failure to give the written description and itemized list: the landlord forfeits the right to withhold any portion of the deposit and the right to sue the tenant for damages to the premises, and pays the tenant's fees (92.109(b)).
- Burden: the landlord proves the retention was reasonable (92.109(c)).
- Lateness: failing to refund or to itemize by the 30th day after surrender of possession is presumed bad faith (92.109(d)). The presumption is rebuttable; the statute does not forfeit the deductions by lateness alone.
- No-deposit leases: failing to give the 92.110 notice forfeits the right to collect the damages and charges, and that forfeiture is "the exclusive remedy" (92.110(c)).
- Unlawful late fees: $100 plus three times the fee plus fees (92.019(c)).
- The tenant's side: withholding the last month's rent against the deposit costs three times the rent withheld plus fees (92.108(b)). A tenant who gives no forwarding address does not forfeit the deposit (92.107(b)).
- Forum: justice court up to $20,000 (Gov. Code 27.031(a)(1)).

## G. How the refund may be paid

- **Statute.** None. Any method that gets the money to the tenant by the due date satisfies 92.103(a). The only method-specific rule is the mailing presumption in 92.1041.
- **PayPal refund of the deposit invoice.** Allowed. The tenant paid through PayPal, so a refund against that payment returns the money to the account the tenant chose; no written agreement is required by Texas law. The app records PayPal's refund id, amount and timestamp and prints them on the statement, because there is no postmark to point to.
- **Payout to a different account or e-mail.** Allowed by statute, but a payment to the wrong payee is a wrongful retention in substance. The app requires the tenant's written designation of the destination (tenant page or a signed note) before a payout; that is product policy, not law.
- **Several tenants on one lease.** The statute is silent. The lease controls; TAA forms make the refund payable jointly to all residents (practice). The app refunds the paying PayPal account by default and splits only under a written allocation signed by every adult tenant, mirroring California's rule as a practice item, not a Texas requirement.
- **Timing.** The refund and the itemized list travel together whenever possible; the app does not release the refund of a reduced amount without the statement (T20).
- **Deposit paid by a third party.** Flag it; refund per the lease to the tenant unless the payer is a party to the lease.

## H. Wear and tear

The statute defines the term, which California's does not: "Normal wear and tear" means "deterioration that results from the intended use of a dwelling", including for Subchapters B and D breakage from age or deteriorated condition, "but the term does not include deterioration that results from negligence, carelessness, accident, or abuse of the premises, equipment, or chattels by the tenant, by a member of the tenant's household, or by a guest or invitee of the tenant" (92.001(4)) [S1]. A landlord "may not retain any portion of a security deposit to cover normal wear and tear" (92.104(b)), and the fee-in-lieu section repeats the bar in general terms: "A landlord may not charge a tenant for normal wear and tear of a dwelling" (92.111(i)).

Texas publishes no official wear-and-tear guide comparable to California's DRE guide. TexasLawHelp gives "a worn carpet, peeling paint, or dusty fixtures" as examples of everyday wear [S9]. Useful-life proration and paint schedules are not in Texas law; the app may keep its California proration as "Common practice", labeled so, because the landlord must prove the amount reasonable (92.109(c)) and a prorated charge is easier to defend than a full replacement cost. Confidence: H = statute, L = common practice.

| Item | Usually | Source, confidence |
|---|---|---|
| Faded or scuffed paint, small nail holes, worn carpet paths, loose blinds from age, dusty fixtures | Not deductible: deterioration from intended use | 92.001(4), H; examples L |
| Large holes, gouges, burns, pet urine, broken fixtures, chewed trim | Deductible: negligence, carelessness, accident or abuse | 92.001(4), 92.104(a), H |
| Cleaning to the move-in level, when the lease makes the tenant responsible | Deductible as a lease charge; a flat cleaning fee regardless of condition is a T2 warning | 92.104(a), H; practice L |
| Damage from a prior tenant, or cumulative wear across tenancies | Not deductible: not caused by this tenant | 92.104(a), H |
| Replacement of an aged item the tenant damaged | Deductible; proration by remaining life is common practice, not statute | 92.109(c), H; proration L |

## I. Itemized statement checklist

1. Tenant name(s), unit address, surrender date, the day the written forwarding address was received, statement date; the 30-day due date shown. 92.103(a), 92.107
2. Deposit received: amount, date, how paid (PayPal invoice id); application deposit and advance rent listed separately. 92.102
3. One line per deduction: description, amount, basis (lease clause quoted, breach, or unpaid rent with due dates). 92.104(a), (c)
4. Wear-and-tear findings listed at $0, so the tenant sees they were considered and excluded. 92.104(b)
5. Evidence attached and labeled as evidence: photos, invoices, labor description, item age. 92.109(c)
6. Balance refunded, method (PayPal refund id and timestamp, or check), payee(s). 92.104(c)
7. If deductions exceed the deposit: the balance claimed, stated as a claim, not a demand. 92.104(a)
8. Delivery record: hand delivered, mailed to the forwarding address with the postmark date, or e-mailed under 92.113 with the prior-exchange evidence. 92.1041, 92.113
9. The landlord's or agent's name and contact; the agent's role if an agent sends it. 92.112
10. If the tenant owed rent at surrender and the amount is undisputed, say so; the statement is sent anyway. 92.104(c)(1)-(2)
11. The disclaimer line: templates and records, not legal advice. Gov. Code 81.101(c)

## J. Edge cases

- **No forwarding address.** The duty is suspended (92.107(a)); the app holds the statement, shows the countdown anyway, and prompts the tenant page daily. The deposit is never treated as forfeited (92.107(b)).
- **Address arrives after day 30.** Send immediately; record the arrival date. Whether the landlord gets a new 30 days is an open question; the app does not assume so.
- **Rent owed and undisputed.** 92.104(c) excuses the itemized list. The app still sends it: it costs nothing and removes 92.109(b) risk.
- **Notice-of-surrender clause not underlined or bold.** The clause is ineffective as a condition of refund (92.103(b)); the app blocks a deduction or forfeiture based on it and tells the landlord why. A lease-break rent claim is separate and lives outside this tool.
- **Tenant never moved in.** 92.1031 path: no retention if a satisfactory replacement occupied by the lease start, except the cancellation fee or actual reletting expenses when the landlord found the replacement.
- **Owner sold during the tenancy.** 92.105 workflow: the signed statement with the exact amount, the handoff record, and the former owner's liability until the new owner received the deposit or assumed it.
- **Lease with no deposit.** 92.110 notice before any collections step; forfeiture of the claim without it.
- **Fee in lieu of a deposit.** Out of scope unless 92.111(g) makes the fee a deposit; the lease check flags it.
- **Deceased sole tenant.** Refund to the designated person or anyone lawfully entitled, less lawful deductions including removal and storage (92.014(c)(3)).
- **Late fees.** Lawful only under 92.019; the app computes the 12 or 10 percent safe harbor and warns.
- **Rekeying after a lease break.** Deductible only with an underlined or bold lease clause and a vacancy in breach of a written lease (92.156(e)); routine turnover rekeying is the landlord's own cost (92.156(a)). Without both, the rekey line is blocked and the landlord is told why.
- **Lease ended by the tenant under a statutory remedy** (repair remedies 92.056(f)(2), landlord closes the unit after a repair notice 92.055(d), casualty loss 92.054(b), utility cutoff 92.301(b)(4), revoked certificate of occupancy 92.023). Under 92.056(f)(2) and 92.301(b)(4) the tenant may deduct the deposit from rent "without necessity of lawsuit" or obtain its refund "according to law"; 92.054(b) and 92.055(d) return the deposit "otherwise required by law", that is under this subchapter; under 92.023 the landlord owes "the full amount of the tenant's security deposit". Inform only; the app does not judge whether the termination was valid.
- **Application deposit.** Not a security deposit (92.102); its refund runs under 92.351 to 92.355, with its own weekend extension (92.353(c)). Keep it out of the deposit ledger.
- **Lease signed before September 1, 2025 and not renewed since.** 92.112 and 92.113 do not apply; mail is the delivery, e-mail a courtesy copy. A renewal or a new lease after that date brings them in.
- **Deductions exceed the deposit.** The statement shows a claim; the tool drafts only. No autonomous collections, no credit reporting.
- **Tenant dispute.** Record it. Point to justice court self-help; no advice on the merits.

## K. Disclaimers and UPL guardrails

**Product copy:**
- "This tool organizes your records and fills in templates based on Texas Property Code Chapter 92, Subchapter C. It does not give legal advice, does not evaluate your specific situation, and is not a substitute for the advice of a Texas attorney." (Gov. Code 81.101(c))
- "Items marked Common practice (useful-life proration, paint schedules, joint refunds) are not in the statute. A court may decide differently."
- "You decide every deduction and approve every document before it is sent. The tool flags rules; it does not decide disputes."
- "Not legal advice."

**Design rules:**
- Present rules and the statutory text, never "you should deduct".
- Flags, not conclusions ("This item may be normal wear and tear under 92.001(4)").
- Do not answer "can I win in court" questions; route to the court's self-help pages and lawyer referral.
- Keep templates generic and let the landlord select and complete them. Gov. Code 81.101(c) protects "forms, computer software, or similar products" only when they "clearly and conspicuously state" they are not a substitute for an attorney, so the disclaimer is on every page and every PDF.
- No Texas court has decided whether an AI agent that explains statutory rules is giving advice. Keep every explanation tied to a quoted source.

## L. Local overlays (flag, do not implement)

Texas cities cannot regulate a field the Property Code occupies: an ordinance in such a field "is void, unenforceable, and inconsistent with this code" (Prop. Code 1.004(a), added by HB 2127, effective September 1, 2023) [S5]. Subchapter C occupies security deposits. No city deposit cap, deposit interest rule or deposit deadline was found for Austin, Dallas, San Antonio, Houston, Fort Worth, El Paso or Arlington (medium confidence: city documents, not a code-by-code review), and the engine computes nothing city by city. A Travis County district court held HB 2127 unconstitutional in August 2023; on July 18, 2025 the Third Court of Appeals reversed, holding that Houston, San Antonio and El Paso lacked standing (no city had been sued or had repealed an ordinance under the act) and that the State was not a proper defendant because only private parties enforce it; it dismissed without prejudice and did not reach the merits [S11]. SB 38 adds Prop. Code 24.0043 from January 1, 2026: "only the legislature may modify or suspend procedures prescribed by this chapter" (Chapter 24, evictions) [S15]. The app flags, by city, the tenant-notice and registration rules that touch a move-out:

- **Austin.** City Code Chapter 4-14, Article 2 (Ord. 20221027-023, effective November 7, 2022): a landlord who owns five or more dwellings must give a written notice of proposed eviction, with a notice of tenants' rights in English and Spanish, before any notice to vacate, with a cure period of at least seven days; a notice to vacate given earlier, or after a non-compliant notice, "shall have no effect" (4-14-106); the notice may go the way 24.005(f) allows, through the e-mail or web portal the landlord uses with the tenant, or posted on the front door; exceptions for an imminent threat of harm, criminal activity, an insured casualty, intentional damage, a holdover after notice, and a fourth notice for the same violation other than rent (4-14-104(E)) [S12]. Eviction-side; 1.004(b) names notices to vacate as a preempted field and 24.0043 reserves eviction procedure to the legislature from 2026, so enforceability is doubtful; whether Austin has repealed or stopped enforcing the article was not confirmed. Flag only.
- **Dallas.** City Code Chapter 27: single-family, duplex and condominium rentals must be registered with the city each year (the updated program began October 1, 2025) and meet minimum property standards [S13]. Registration, not deposits. Flag on the property record.
- **San Antonio.** Ordinance 2020-06-25-0453 (City Code 16-6, passed June 25, 2020, enforcement from 30 days after passage): the city's form Notice of Tenant Rights within one business day after a notice to vacate for non-payment of rent, by hand, on the door, text, e-mail, overnight courier or USPS mail; not owed for any other notice to vacate; one warning, then a fine of up to $500 as the sole remedy, with no private cause of action; a complaint must be made within 90 days of the violation, and a notation on the landlord's copy is prima facie evidence of delivery [S14]. The ordinance text sets no language requirement, but the form it adopts as Exhibit 1 is printed in English and Spanish, the city manager may update the form without council action, and the city's current version was last revised in May 2023. Eviction-side. Flag only.
- **Houston.** No deposit-specific or tenant-notice ordinance found (medium confidence).
- **Fort Worth, El Paso, Arlington.** None found (medium confidence).

## M. Open questions

1. **Late forwarding address.** Does the landlord get a fresh 30 days after a written address arrives past day 30, or must the refund go out at once? The statute is silent; TexasLawHelp says "whichever is later" [S9]. No appellate decision was checked. Bills that would have written the "whichever is later" rule into 92.109(d) (HB 3405 in 2023; HB 2037 as filed and SB 851 in 2025) were not enacted, and the 2025 committee substitute dropped that section [S4][S18]; that is legislative history, not a holding. The app treats it as due now.
2. **"Surrender".** Undefined in Chapter 92. Keys returned, the move-out date in the notice, or abandonment can differ by days. The app uses the earliest defensible date and lets the landlord confirm.
3. **Weekend due dates.** Gov. Code 311.014(b) extends a period ending on a weekend or holiday; whether a court applies it to 92.109(d)'s presumption was not confirmed. The app shows the calendar day.
4. **"Renewed" leases.** 92.112 and 92.113 apply to a lease "entered into or renewed" on or after September 1, 2025. Whether a month-to-month holdover is a renewal each month was not resolved. The app asks for the last renewal date and, in doubt, treats e-mail as a courtesy copy.
5. **Nonrefundable fees.** Whether a pet fee or cleaning fee labeled nonrefundable is a deposit under 92.102 ("intended primarily to secure performance") turns on facts; the app warns rather than reclassifies.
6. **Joint tenants.** The statute says nothing about who gets the refund when several tenants paid. The lease controls; the app's joint-refund default is practice.
7. **HB 2127.** The Third Court of Appeals disposed of the cities' suit on standing and did not rule on the merits, so the constitutional question is open; no Texas Supreme Court filing was found as of 2026-10-03, but the court's docket was not searched directly. Whether any city re-enacts a deposit rule, and whether Austin still enforces Chapter 4-14, Article 2 after SB 38, should be rechecked before a Texas launch.
8. **Attorney General page.** The AG's tenant-rights page returned HTTP 402 during the research and again at verification, so it was not cross-checked; the State Law Library guide and TexasLawHelp were used instead [S9][S10].
9. **92.156(e) and 92.103(b) together.** Both turn on underlining or bold in the lease. Whether a rekey clause that is bold in a lease addendum, rather than the lease body, counts was not checked; the app asks the landlord to confirm the formatting and records the answer.

## Sources

- [S1] Property Code Chapter 92 (official, current through the 89th Leg., 2nd C.S., 2025): https://statutes.capitol.texas.gov/Docs/PR/htm/PR.92.htm (Subchapter C from #92.101; 92.001 definitions; 92.006 waiver; 92.014; 92.019; 92.3515)
- [S2] HB 2037, 89th Leg., R.S. (2025), enrolled: https://capitol.texas.gov/tlodocs/89R/billtext/html/HB02037F.HTM
- [S3] SB 1783, 87th Leg., R.S. (2021), enrolled: https://capitol.texas.gov/tlodocs/87R/billtext/html/SB01783F.HTM
- [S4] HB 3405, 88th Leg., R.S. (2023), history (died in the House): https://capitol.texas.gov/BillLookup/History.aspx?LegSess=88R&Bill=HB3405
- [S5] Property Code 1.002 and 1.004: https://statutes.capitol.texas.gov/Docs/PR/htm/PR.1.htm ; HB 2127, 88th Leg., R.S. (2023), enrolled: https://capitol.texas.gov/tlodocs/88R/billtext/html/HB02127F.HTM
- [S6] Government Code 27.031 (justice court jurisdiction): https://statutes.capitol.texas.gov/Docs/GV/htm/GV.27.htm
- [S7] Government Code 81.101 (practice of law; forms and software exception): https://statutes.capitol.texas.gov/Docs/GV/htm/GV.81.htm
- [S8] Government Code 311.002 and 311.014 (Code Construction Act; computation of time): https://statutes.capitol.texas.gov/Docs/GV/htm/GV.311.htm
- [S9] TexasLawHelp, Security Deposits (secondary, cross-check only; "last legally reviewed" 2023-01-02): https://texaslawhelp.org/article/security-deposits
- [S10] Texas State Law Library, Landlord/Tenant Law: Security Deposits (secondary, cross-check only): https://guides.sll.texas.gov/landlord-tenant-law/security-deposits
- [S11] Texas Municipal League, July 25, 2025 (Third Court of Appeals decision on HB 2127): https://www.tml.org/1059/July-25-2025-Number-28
- [S12] Austin Ordinance 20221027-023 (Chapter 4-14, notice of proposed eviction): https://services.austintexas.gov/edims/document.cfm?id=398004
- [S13] Dallas Code Compliance, Single Family Rental Registration and Inspection Program: https://dallascityhall.com/departments/codecompliance/Pages/single-family-program.aspx
- [S14] San Antonio Notice of Tenant Rights ordinance 2020-06-25-0453: https://docsonline.sanantonio.gov/DSDUploads/NoticeofTenantRightsOrdinance2020-06-25-0453.pdf ; city presentation "Local Ordinances Related to Rental Housing" (July 30, 2024, with the form last revised May 2023): https://www.sa.gov/files/assets/main/v/1/nhsd/documents/local-ordinances-related-to-rental-housing.pdf
- [S15] SB 38, 89th Leg., R.S. (2025), enrolled (eviction procedure; 24.0043; eff. 2026-01-01, Sec. 16 eff. 2025-09-01): https://capitol.texas.gov/tlodocs/89R/billtext/html/SB00038F.htm ; Property Code 24.0043 as it appears on the official site (added by Acts 2025, ch. 960; amended by HB 16, 89th Leg., 2nd C.S., ch. 7, Sec. 12.09, eff. 2026-01-01): https://statutes.capitol.texas.gov/Docs/PR/htm/PR.24.htm
- [S16] 89th Leg. bills that died in committee: SB 851 https://capitol.texas.gov/BillLookup/History.aspx?LegSess=89R&Bill=SB851 ; HB 798 https://capitol.texas.gov/BillLookup/History.aspx?LegSess=89R&Bill=HB798 ; HB 4305 https://capitol.texas.gov/BillLookup/History.aspx?LegSess=89R&Bill=HB4305 ; Legislative Reference Library, effective dates of 89th Leg. bills: https://lrl.texas.gov/sessions/effDates/billsEffective89.cfm
- [S17] Property Code 92.156 (rekeying; deposit deduction only with an underlined or bold clause), in [S1] at #92.156; 92.351 to 92.355 (application deposit), in [S1] at #92.351
- [S18] HB 2037 as introduced (identical to SB 851; amends 92.107 and 92.109(d)): https://capitol.texas.gov/tlodocs/89R/billtext/html/HB02037I.HTM ; House committee report version (substitute; adds 92.112 and 92.113 instead): https://capitol.texas.gov/tlodocs/89R/billtext/html/HB02037H.HTM ; HB 2037 history ("Reported favorably as substituted"; "Effective on 9/1/25"): https://capitol.texas.gov/BillLookup/History.aspx?LegSess=89R&Bill=HB2037
- [S19] Property Code Chapter 94 (manufactured home tenancies; its own deposit subchapter, with 94.110 and 94.111 added by HB 2037 Secs. 3 and 4): https://statutes.capitol.texas.gov/Docs/PR/htm/PR.94.htm

**Uncertainties:**
1. The official site is a JavaScript application; its text was captured by rendering the page in a headless browser on 2026-10-03 and reading the history notes. Deep links with a section anchor open the chapter page and may need the section selector.
2. Useful-life proration, paint schedules and joint refunds are practice, not Texas law.
3. City overlays were checked through city documents and one municipal-league bulletin, not through a code-by-code review of every Texas city.
4. No court decision was read for this spec; every rule above is statute text.

```json pack
{
  "state": "TX",
  "statute_name": "Texas Property Code, Title 8, Chapter 92, Subchapter C, Sections 92.101 to 92.113 (Security Deposits)",
  "last_amended": {
    "act": "HB 2037, Acts 2025, 89th Leg., R.S., ch. 732, Sec. 2",
    "effective": "2025-09-01",
    "applies_to": "leases entered into or renewed on or after 2025-09-01",
    "added": ["92.112", "92.113"],
    "prior": {"act": "SB 1783, Acts 2021, 87th Leg., R.S., ch. 189", "effective": "2021-09-01", "added": ["92.111"]},
    "source_current_through": "89th Legislature, 2nd Called Session, 2025"
  },
  "deposit_cap": {"months_of_rent": null, "exceptions": [], "note": "no statute caps the amount"},
  "return_deadline_days": 30,
  "deadline_trigger": {
    "type": "surrender",
    "description": "the 30th day after the date the tenant surrenders the premises (92.103(a)); the bad-faith presumption counts from surrender of possession (92.109(d)); the duty is suspended until the tenant gives a written forwarding address (92.107(a)); days are calendar days, counted under Gov. Code 311.014"
  },
  "notice_before_claim": {
    "required": false,
    "days": null,
    "method": null,
    "wording": null,
    "exceptions": [
      {"when": "the lease required no security deposit", "rule": "written notice of the claim for damages and charges on or before the date it is reported to a consumer reporting agency or third-party debt collector; not required without a forwarding address; failure forfeits the claim", "cite": "92.110"},
      {"when": "fee in lieu of a deposit with insurance", "rule": "written description and itemized list of damages and unpaid rent, with the rent due dates, within 30 days after surrender, before any insurer claim", "cite": "92.111(j)"}
    ]
  },
  "statement_delivery": {
    "methods": [
      "personal delivery",
      "US mail to the written forwarding address; postmarked by the due date is presumed timely (92.1041)",
      "e-mail, only if the tenant and the landlord or agent previously communicated by e-mail and the lease was entered into or renewed on or after 2025-09-01 (92.113)"
    ],
    "address_rule": "the forwarding address the tenant gave in writing for the purpose of the refund (92.107(a)); with none on file there is no duty yet and the vacated unit is not a substitute; a managing agent, leasing agent or resident manager is the landlord's agent for notices (92.112)"
  },
  "itemization_required": {
    "required": true,
    "rule": "a written description and itemized list of all deductions, with the balance (92.104(c)); excused only when the tenant owes rent at surrender and the amount is undisputed (92.104(c)(1)-(2)); the app always itemizes"
  },
  "documents_required": {
    "rule": "none by statute beyond the written itemized list and accurate deposit records (92.104(c), 92.106); the landlord bears the burden of proving the retention reasonable (92.109(c)), so the app attaches photos, invoices and labor descriptions as evidence",
    "dollar_threshold": null
  },
  "interest_required": {"required": false, "rule": "no statute"},
  "holding_notice_required": {"required": false, "days": null, "rule": "no statute; the only deposit notice is the new owner's signed statement of the exact amount on a transfer of ownership (92.105(b))"},
  "move_in_checklist_required": {
    "required": false,
    "rule": "no statute; TAA lease forms make an Inventory and Condition Form a contract duty",
    "consequence_if_missing": "none by statute; weaker proof under the landlord's burden in 92.109(c)"
  },
  "pre_move_out_inspection": {"required": false, "rule": "no statute"},
  "refund_method_rules": {
    "statute": "none; any method that delivers the refund by the due date satisfies 92.103(a)",
    "mail_presumption": "a refund placed in US mail and postmarked by the due date is presumed timely (92.1041); electronic methods get no presumption, so record PayPal's refund id and timestamp",
    "paypal_refund_allowed": true,
    "paypal_refund_needs_tenant_agreement": false,
    "payout_to_other_account_needs_tenant_agreement": true,
    "payout_agreement_basis": "product policy, not statute",
    "joint_tenants": "statute silent; the lease controls; one refund to the paying account unless every adult tenant signs an allocation (practice)"
  },
  "penalty": "Bad-faith retention costs $100 plus three times the amount wrongfully withheld plus the tenant's reasonable attorney's fees (92.109(a)). A bad-faith failure to give the written itemized list forfeits the right to withhold any part of the deposit and the right to sue for damages to the premises, plus fees (92.109(b)). The landlord must prove every retention reasonable (92.109(c)). Missing the 30th day after surrender is presumed bad faith (92.109(d)).",
  "forfeiture_if_late": {
    "late_forfeits_deductions": false,
    "what_is_forfeited": "nothing automatically; lateness raises a rebuttable presumption of bad faith (92.109(d)); a bad-faith failure to itemize forfeits the right to withhold and to sue for damages (92.109(b)); a no-deposit landlord who skips the 92.110 notice forfeits the claim (92.110(c)); the tenant never forfeits the deposit for a missing forwarding address (92.107(b))"
  },
  "wear_and_tear": {
    "definition_source": "Prop. Code 92.001(4)",
    "definition": "deterioration that results from the intended use of a dwelling, not deterioration that results from negligence, carelessness, accident, or abuse of the premises by the tenant, the tenant's household, or a guest or invitee",
    "charge_bar": "92.104(b)"
  },
  "local_overlays": [
    {"city": "Austin", "line": "Chapter 4-14, Article 2 (Ord. 20221027-023, eff. 2022-11-07): notice of proposed eviction with a bilingual notice of tenants' rights before any notice to vacate, cure period of at least seven days, landlords of five or more dwellings; eviction-side, likely preempted by Prop. Code 1.004(b) and 24.0043; current enforcement not confirmed; flag only"},
    {"city": "Dallas", "line": "Chapter 27: annual registration of single-family, duplex and condominium rentals (program from 2025-10-01) and minimum property standards; registration, not deposits; flag on the property record"},
    {"city": "San Antonio", "line": "Ord. 2020-06-25-0453 (City Code 16-6): the city's form Notice of Tenant Rights within one business day after a notice to vacate for non-payment of rent; form last revised May 2023; fine up to $500 after a warning, sole remedy; eviction-side; flag only"},
    {"city": "Houston", "line": "no deposit-specific or tenant-notice ordinance found; state law only"},
    {"city": "statewide", "line": "Prop. Code 1.004 (HB 2127, eff. 2023-09-01) voids city rules in fields the Property Code occupies, including security deposits; on 2025-07-18 the Third Court of Appeals reversed the trial court and dismissed the cities' challenge for lack of standing without reaching the merits; SB 38 adds 24.0043 (eff. 2026-01-01) reserving eviction procedure to the legislature; recheck before launch"}
  ],
  "citations": [
    {"id": "92.001", "cite": "Tex. Prop. Code 92.001(4) (normal wear and tear defined)", "url": "https://statutes.capitol.texas.gov/Docs/PR/htm/PR.92.htm#92.001"},
    {"id": "92.006", "cite": "Tex. Prop. Code 92.006(a) (deposit duties and remedies not waivable)", "url": "https://statutes.capitol.texas.gov/Docs/PR/htm/PR.92.htm#92.006"},
    {"id": "92.014", "cite": "Tex. Prop. Code 92.014(c)(3) (deceased tenant's deposit)", "url": "https://statutes.capitol.texas.gov/Docs/PR/htm/PR.92.htm#92.014"},
    {"id": "92.019", "cite": "Tex. Prop. Code 92.019 (late fees)", "url": "https://statutes.capitol.texas.gov/Docs/PR/htm/PR.92.htm#92.019"},
    {"id": "92.101", "cite": "Tex. Prop. Code 92.101 (application)", "url": "https://statutes.capitol.texas.gov/Docs/PR/htm/PR.92.htm#92.101"},
    {"id": "92.102", "cite": "Tex. Prop. Code 92.102 (security deposit defined)", "url": "https://statutes.capitol.texas.gov/Docs/PR/htm/PR.92.htm#92.102"},
    {"id": "92.103", "cite": "Tex. Prop. Code 92.103 (obligation to refund; 30 days; notice-of-surrender clause; priority)", "url": "https://statutes.capitol.texas.gov/Docs/PR/htm/PR.92.htm#92.103"},
    {"id": "92.1031", "cite": "Tex. Prop. Code 92.1031 (tenant who never occupies)", "url": "https://statutes.capitol.texas.gov/Docs/PR/htm/PR.92.htm#92.1031"},
    {"id": "92.104", "cite": "Tex. Prop. Code 92.104 (retention; wear and tear; written description and itemized list)", "url": "https://statutes.capitol.texas.gov/Docs/PR/htm/PR.92.htm#92.104"},
    {"id": "92.1041", "cite": "Tex. Prop. Code 92.1041 (mailing presumption)", "url": "https://statutes.capitol.texas.gov/Docs/PR/htm/PR.92.htm#92.1041"},
    {"id": "92.105", "cite": "Tex. Prop. Code 92.105 (cessation of owner's interest)", "url": "https://statutes.capitol.texas.gov/Docs/PR/htm/PR.92.htm#92.105"},
    {"id": "92.106", "cite": "Tex. Prop. Code 92.106 (records)", "url": "https://statutes.capitol.texas.gov/Docs/PR/htm/PR.92.htm#92.106"},
    {"id": "92.107", "cite": "Tex. Prop. Code 92.107 (tenant's forwarding address)", "url": "https://statutes.capitol.texas.gov/Docs/PR/htm/PR.92.htm#92.107"},
    {"id": "92.108", "cite": "Tex. Prop. Code 92.108 (withholding last month's rent)", "url": "https://statutes.capitol.texas.gov/Docs/PR/htm/PR.92.htm#92.108"},
    {"id": "92.109", "cite": "Tex. Prop. Code 92.109 (liability of landlord; bad faith; burden; presumption)", "url": "https://statutes.capitol.texas.gov/Docs/PR/htm/PR.92.htm#92.109"},
    {"id": "92.110", "cite": "Tex. Prop. Code 92.110 (lease without security deposit; required notice)", "url": "https://statutes.capitol.texas.gov/Docs/PR/htm/PR.92.htm#92.110"},
    {"id": "92.111", "cite": "Tex. Prop. Code 92.111 (fee in lieu of security deposit), added by SB 1783 (2021)", "url": "https://statutes.capitol.texas.gov/Docs/PR/htm/PR.92.htm#92.111"},
    {"id": "92.112", "cite": "Tex. Prop. Code 92.112 (agents for delivery of notice), added by HB 2037 (2025)", "url": "https://statutes.capitol.texas.gov/Docs/PR/htm/PR.92.htm#92.112"},
    {"id": "92.113", "cite": "Tex. Prop. Code 92.113 (notice by e-mail), added by HB 2037 (2025)", "url": "https://statutes.capitol.texas.gov/Docs/PR/htm/PR.92.htm#92.113"},
    {"id": "92.156", "cite": "Tex. Prop. Code 92.156(a), (e) (rekeying; deposit deduction only with an underlined or boldface lease clause after a lease break), (e) eff. 2016-01-01", "url": "https://statutes.capitol.texas.gov/Docs/PR/htm/PR.92.htm#92.156"},
    {"id": "92.351", "cite": "Tex. Prop. Code 92.351 to 92.355 (application deposit: definition, rejection, refund, liability, waiver)", "url": "https://statutes.capitol.texas.gov/Docs/PR/htm/PR.92.htm#92.351"},
    {"id": "92.3515", "cite": "Tex. Prop. Code 92.3515 (notice of eligibility requirements)", "url": "https://statutes.capitol.texas.gov/Docs/PR/htm/PR.92.htm#92.3515"},
    {"id": "PR24.0043", "cite": "Tex. Prop. Code 24.0043 (only the legislature may modify or suspend eviction procedures), added by SB 38 (Acts 2025, 89th Leg., R.S., ch. 960, Sec. 2) and amended by HB 16 (Acts 2025, 89th Leg., 2nd C.S., ch. 7, Sec. 12.09), both eff. 2026-01-01", "url": "https://statutes.capitol.texas.gov/Docs/PR/htm/PR.24.htm#24.0043"},
    {"id": "PR94", "cite": "Tex. Prop. Code ch. 94, Subch. C, 94.101 to 94.111 (manufactured home lot deposits; parallel rules, out of scope; 94.110 and 94.111 added by HB 2037 (2025))", "url": "https://statutes.capitol.texas.gov/Docs/PR/htm/PR.94.htm#94.101"},
    {"id": "PR1.002", "cite": "Tex. Prop. Code 1.002 (Code Construction Act applies)", "url": "https://statutes.capitol.texas.gov/Docs/PR/htm/PR.1.htm#1.002"},
    {"id": "PR1.004", "cite": "Tex. Prop. Code 1.004 (preemption), added by HB 2127 (2023)", "url": "https://statutes.capitol.texas.gov/Docs/PR/htm/PR.1.htm#1.004"},
    {"id": "GV27.031", "cite": "Tex. Gov't Code 27.031 (justice court jurisdiction, $20,000)", "url": "https://statutes.capitol.texas.gov/Docs/GV/htm/GV.27.htm#27.031"},
    {"id": "GV81.101", "cite": "Tex. Gov't Code 81.101 (practice of law; forms and software exception)", "url": "https://statutes.capitol.texas.gov/Docs/GV/htm/GV.81.htm#81.101"},
    {"id": "GV311.014", "cite": "Tex. Gov't Code 311.014 (computation of time)", "url": "https://statutes.capitol.texas.gov/Docs/GV/htm/GV.311.htm#311.014"},
    {"id": "HB2037", "cite": "HB 2037, 89th Leg., R.S. (2025), enrolled; eff. 2025-09-01", "url": "https://capitol.texas.gov/tlodocs/89R/billtext/html/HB02037F.HTM"},
    {"id": "SB1783", "cite": "SB 1783, 87th Leg., R.S. (2021), enrolled; eff. 2021-09-01", "url": "https://capitol.texas.gov/tlodocs/87R/billtext/html/SB01783F.HTM"},
    {"id": "HB3405", "cite": "HB 3405, 88th Leg., R.S. (2023), died in the House", "url": "https://capitol.texas.gov/BillLookup/History.aspx?LegSess=88R&Bill=HB3405"},
    {"id": "SB851", "cite": "SB 851, 89th Leg., R.S. (2025), identical companion of HB 2037 as filed (HB 3405 text: forwarding-address methods, presumption only after the address), died in committee (last action 2025-02-13); the House committee substitute of HB 2037 dropped those sections", "url": "https://capitol.texas.gov/BillLookup/History.aspx?LegSess=89R&Bill=SB851"},
    {"id": "SB38", "cite": "SB 38, 89th Leg., R.S. (2025), enrolled; eviction procedure; eff. 2026-01-01 (Sec. 16 eff. 2025-09-01); no deposit provisions", "url": "https://capitol.texas.gov/tlodocs/89R/billtext/html/SB00038F.htm"}
  ]
}
```

## Verification

Verified 2026-10-03 by a second agent, independently of the author. Method: the official site is a JavaScript application, so Property Code chapters 1, 24 and 92 and Government Code chapters 27, 81 and 311 were rendered in headless Chromium and the body text saved; every section the spec cites was read in full with its history note; the enrolled texts of HB 2037, SB 1783 and SB 38, the introduced text of HB 3405, and the TLO histories of HB 3405, SB 851, HB 798 and HB 4305 were read; the Austin and San Antonio ordinances were read from the city PDFs; the TML bulletin, the Dallas program page, the LRL effective-dates list and TexasLawHelp were read for the claims attributed to them. The Attorney General page still returns HTTP 402.

**Confirmed without change.** The "current through" statement; every history note relied on (92.101 to 92.1041 and 92.1031 at 1996, 92.104 and 92.106 to 92.109 at 1984, 92.105(b-1) and 92.110 at 2016, 92.111 at 2021, 92.112 and 92.113 at 2025); the two applicability clauses ("a lease entered into or renewed on or after the effective date"); every number in the pack (30 days, $100, three times, $20,000, 12 and 10 percent, two full days, 7 days in 92.156(a)); the trigger words ("surrenders the premises" in 92.103(a), "surrenders possession" in 92.109(d) and 92.104(c)(1)); the quotations in T1 to T29 and section H; the consequences in section F (liability under 92.109(a), forfeiture under 92.109(b) and 92.110(c), the tenant's non-forfeiture under 92.107(b), the tenant's liability under 92.108(b)); Gov. Code 27.031 ($20,000 since 2020-09-01, SB 2342), 81.101(c) (1999-06-18) and 311.014; Prop. Code 1.002 and 1.004 (HB 2127, Acts 2023, ch. 899, Sec. 15); the HB 3405 history and the claim that it would have changed 92.107 and 92.109(d); the TexasLawHelp quotations; the Dallas registration facts (annual, from 2025-10-01, Chapter 27); the Austin ordinance facts (five or more dwellings, notice of tenants' rights, seven days).

**Corrections** (old, new, source):
1. Pack `local_overlays` statewide line said the Third Court of Appeals "upheld the statute against a standing-based challenge". New: it reversed the trial court and dismissed the cities' suit for lack of standing (and because the State is not a proper defendant) without reaching the merits. Source: TML bulletin of 2025-07-25 [S11]; the search of 2026-10-03 found no Texas Supreme Court filing.
2. Section L and pack said San Antonio's ordinance was "revised 2023" and required the notice "in English and Spanish". New: the ordinance (2020-06-25-0453, City Code 16-6) was not shown to have been amended; the city's form notice was last revised May 2023 and the ordinance sets no language requirement (the city publishes other-language versions). Added the delivery methods, the non-payment-only scope and the $500 sole-remedy penalty. Source: the ordinance PDF and the city's July 2024 presentation [S14].
3. Missed rule added as T30: Prop. Code 92.156(e), a deposit deduction for rekeying is allowed only when the tenant vacated in breach of a written lease and the lease authorizes it in an underlined or boldface clause; routine turnover rekeying is the landlord's expense under 92.156(a). The California analog is D2's "only if the lease authorizes it". Source: [S1] at 92.156, history note Acts 2015, ch. 1072 (HB 2404), eff. 2016-01-01. Also added to sections B and J and the pack citations; the pack's 20 keys were left unchanged so it stays in the shape of the WA and NY packs.

**Clarifications** (wording tightened where the spec said more than the text, or less):
4. Section L opened with "no Texas city imposes a deposit cap, deposit interest or a deposit deadline". New: none was found for the seven cities checked, medium confidence. The spec had no source for the universal claim.
5. T14 and section D read as if e-mail were unlawful for leases older than 2025-09-01. New: the statute prescribes no delivery method, so e-mail is not prohibited; it lacks 92.113's express basis and the 92.1041 presumption, and making mail the delivery of record is product policy. Source: 92.104(c) ("shall give"), 92.1041, 92.113.
6. T22 was garbled ("Neither a refund nor the itemized list ... is presumed bad faith"). New: quotes 92.109(d) directly.
7. T4 said the fee is "capped at the reasonable cost of the insurance". New: "the reasonable cost of obtaining and administering the insurance" (92.111(e)).
8. T10 and section H now also cite 92.111(i), a second, unconditional statutory bar on charging for normal wear and tear.
9. T2 now notes that a rental application deposit has its own regime (92.351 to 92.355) so the engine never folds it into the security deposit; a J edge case added. Source: [S1] at 92.351 to 92.355.
10. Status: added the 89th Legislature bills that would have changed the subchapter and died (SB 851, HB 798, HB 4305) and SB 38, which does not touch deposits but adds 24.0043 on eviction procedure. Confirmed that no Subchapter C section carries a future effective date. Sources: [S15][S16].
11. Section L, Austin: added the ordinance's effective date (2022-11-07), that the cure period is a minimum of seven days, that an early notice to vacate "shall have no effect", and that SB 38's 24.0043 adds to the preemption doubt from 2026-01-01; whether Austin still enforces the article was not confirmed. Source: [S12][S15].
12. Section J: added the tenant-side provisions outside the subchapter that return the deposit when the tenant ends the lease under a statutory remedy (92.023, 92.054(b), 92.056(f)(2), 92.301(b)(4)). Inform only.
13. HB 3405 bullet now says what the bill would have done (forwarding-address methods; presumption only after the address is given). Source: HB 3405 introduced text.
14. Sources: [S9] now carries TexasLawHelp's review date (2023-01-02); [S14] identifies the city document as a July 2024 presentation; [S15] to [S17] added.

**Still uncertain after verification.** Open questions 1 to 9 in section M stand: the effect of a forwarding address received after day 30, the meaning of "surrender", whether 311.014(b) extends the 92.109(d) date, whether a month-to-month holdover is a "renewal" for 92.112 and 92.113, when a nonrefundable fee is a deposit under 92.102, the joint-tenant payee, the HB 2127 merits and any Texas Supreme Court review, the Attorney General page, and the addendum question under 92.156(e) and 92.103(b). No court decision was read for this spec; every rule is statute text. The city overlays rest on city documents and one municipal-league bulletin, not on a current code check of each city; Houston, Fort Worth, El Paso and Arlington were not re-verified here.

## Verification, second pass

Verified 2026-10-03 by a third agent, adversarially and independently of the author and the first verifier, on the assumption that the spec had errors. Method: Property Code chapters 1, 24, 92 and 94 and Government Code chapters 27, 81 and 311 were rendered again in headless Chromium from statutes.capitol.texas.gov (a plain HTTP fetch returns the site's JavaScript shell with no section text), and every section the spec cites was read in full with its history note; the enrolled texts of HB 2037, SB 1783 and SB 38, the introduced texts of HB 3405, HB 2037 and SB 851, the House committee report version of HB 2037, the Senate Research Center analysis of HB 2037, and the TLO histories of HB 2037, HB 3405, SB 851, HB 798, HB 4305 and SB 38 were read; the Austin and San Antonio ordinances were read from the city PDFs with the text extracted locally; the Dallas program page, the LRL effective-dates list, the TML bulletin of 2025-07-25, TexasLawHelp and the State Law Library guide were fetched; the TAA lease and Inventory and Condition Form claims were checked against TAA's published sample text. The Attorney General page returned HTTP 402 a third time.

**Confirmed without change** (every number, trigger, delivery method and date in the rules table and in the pack):
- The text and history notes of 92.101 to 92.113 exactly as the spec states them: 1984 codification; 1996 amendments to 92.101, 92.102 and 92.103 and new 92.1031 and 92.1041; 92.105 amended 1985 and (b-1) added 2016 (SB 1367 Sec. 5); 92.110 added 2016 (SB 1367 Sec. 6); 92.111 added 2021 (SB 1783, ch. 189, Sec. 1); 92.112 and 92.113 added 2025 (HB 2037, ch. 732, Sec. 2). No Subchapter C section carries a future effective date; nothing in 92.101 to 92.110 has changed since 2019; the site is "current through the 89th 2nd Called Legislative Session, 2025".
- Numbers: the 30th day after surrender (92.103(a), 92.109(d), 92.111(j)); $100 plus three times plus fees (92.109(a), 92.019(c), 92.354); three times the rent (92.108(b)); 12 and 10 percent and two full days (92.019(a), (a-1)); the seventh day (92.156(a), 92.352(a)); $20,000 (Gov. Code 27.031(a)(1), SB 2342, eff. 2020-09-01); 81.101(c) eff. 1999-06-18; 311.014(a) to (c).
- Quotations in T1 to T30 and sections C to L: 92.001(4), 92.006(a), 92.014(c)(3), 92.023(1), 92.102, 92.103(a) to (c), 92.104(a) to (c), 92.1041, 92.105(a) to (c), 92.106, 92.107(a) and (b), 92.108, 92.109(a) to (d), 92.110(a) to (c), 92.111(a) to (j), 92.112, 92.113(a) and (b), 92.156(a) and (e), 92.352(a), 92.353(c), 92.354; Prop. Code 1.002 and 1.004(a) and (b) (HB 2127, ch. 899, Sec. 15, eff. 2023-09-01); 24.0043 (SB 38, ch. 960, Sec. 2; HB 16, 2nd C.S., ch. 7, Sec. 12.09; both eff. 2026-01-01); Gov. Code 27.031(d), 81.101(c).
- Consequences are stated as the statute states them: liability under 92.109(a), forfeiture under 92.109(b) and 92.110(c), a rebuttable presumption only under 92.109(d), the tenant's non-forfeiture under 92.107(b). Nowhere does the spec turn the presumption into a forfeiture or the tenant's liability under 92.108(b) into a landlord's remedy against the deposit.
- Bills: the HB 2037 enrolled text, votes (House 126-1 on 2025-05-02, Senate 31-0 on 2025-05-28) and applicability clause ("a lease entered into or renewed on or after the effective date"); SB 1783 Sec. 2 applicability; SB 38 effective 2026-01-01 with Sec. 16 on 2025-09-01 (enrolled Sec. 18 and the LRL list); HB 3405 last action 05/05/2023 "H Comm. report sent to Local & Consent Calendar"; SB 851 last action 02/13/2025; HB 798 last action 03/05/2025; HB 4305 last action 04/01/2025 "Referred to Trade, Workforce & Economic Development".
- Secondary sources: TexasLawHelp's "whichever is later" sentence, its "worn carpet, peeling paint, or dusty fixtures" examples and the 2023-01-02 review date; the TML bulletin's account of the 2025-07-18 Third Court of Appeals decision (no standing, the State not a proper defendant, dismissed without prejudice, merits not reached); Dallas registration (single-family, duplex and condominium units, annual, from 2025-10-01, Chapter 27, $74 fee); Austin Ord. 20221027-023 (five or more dwellings, 4-14-101(B); minimum 7 days to cure, 4-14-105(B); bilingual statement in 16-point bold underlined, 4-14-104(D); bilingual notice of tenants' rights, 4-14-104(F); effective 2022-11-07, Part 6); San Antonio Ord. 2020-06-25-0453 (one business day, six delivery methods, non-payment only, one warning then up to $500 as the sole remedy, no private cause of action); the TAA sample lease ("one payment jointly payable to all residents") and Inventory and Condition Form (deemed accurate 48 hours after move-in if not returned), which the spec labels practice.
- No local deposit cap, interest rule or deadline was found for the cities named; that is consistent with Prop. Code 1.004 and stays at medium confidence because no city code was searched exhaustively.

**Corrections** (old, new, source):
1. Status, SB 851 and HB 2037. Old: SB 851 described only as "the refile of HB 3405", with HB 2037 presented as if it had always been the e-mail bill. New: HB 2037 as introduced and SB 851 are identical (Legislative Council draft 89R 2410) and both carried the HB 3405 text amending 92.107 (hand delivery, first-class, certified or registered mail or any tracked delivery for the forwarding address, effective even if the landlord refuses delivery) and 92.109(d) (the presumption would run only after the tenant had both surrendered possession and given the address); the House committee substitute dropped those sections and added 92.112 and 92.113 instead, and that version was enacted. Source: HB 2037 introduced, House committee report and enrolled texts; TLO histories of HB 2037 ("Reported favorably as substituted") and SB 851 ("Companion: HB 2037 by Darby, Identical") [S2][S18]. Recorded in Status, open question 1 and the pack's SB851 citation.
2. Status, 2025 changes elsewhere in Chapter 92. Old: only 92.0135 and 92.0161. New: also 92.0561(f) (who may make a tenant's repair), amended by HB 2037 Sec. 1. Source: history notes in [S1].
3. T1 scope. Old: Subchapter C "applies to all residential leases", with no mention of manufactured home lots. New: a lease of a lot in a manufactured home community is governed by Chapter 94, whose own deposit subchapter (94.101 to 94.111) has parallel but separate rules (the 30th day after the tenant "surrenders the manufactured home lot", 94.103(a); 94.110 and 94.111 added by HB 2037 Secs. 3 and 4), out of scope for the engine; a property_type field added. Source: [S19]; HB 2037 enrolled.
4. Section J, terminations under a statutory remedy. Old: the list omitted 92.055(d) and put one quotation ("according to law") on all four sections. New: 92.055(d) added (landlord closes the unit after a repair notice); 92.056(f)(2) and 92.301(b)(4) say "according to law" and let the tenant deduct the deposit from rent "without necessity of lawsuit"; 92.054(b) and 92.055(d) say "otherwise required by law". Source: [S1].
5. Section L, San Antonio. Old: "the ordinance itself sets no language requirement" and "the city publishes it in other languages". New: the ordinance text sets no language requirement, but the form it adopts as Exhibit 1 is itself printed in English and Spanish; added the 90-day complaint window (16-6(c)), the prima facie delivery notation (16-6(e)), enforcement from 30 days after passage (Sec. 13), the overnight courier and USPS wording, and the city manager's power to update the form without council action (Sec. 8). Source: the ordinance PDF [S14].

**Clarifications:**
6. T25 now notes 92.019(a-1)(2) (a fee above the safe harbor is lawful only up to the landlord's uncertain damages from the late payment) and 92.0191 (a written statement of late fees owed, on the tenant's request; SB 1414, 2019). Source: [S1].
7. Section L, Austin: added the delivery methods (4-14-104(C)), the six exceptions (4-14-104(E)) and that a non-compliant notice of proposed eviction also voids the notice to vacate (4-14-106). Source: [S12].
8. Open question 1 now carries the legislative history (HB 3405 in 2023; HB 2037 as filed and SB 851 in 2025, dropped in the committee substitute), marked as history, not a holding.
9. Sources: [S18] (HB 2037 introduced and committee report versions and history) and [S19] (Chapter 94) added; the pack citations gain a PR94 entry and the SB851 entry is corrected; the pack's 20 keys are unchanged.
10. The LRL effective-dates list [S16] lists only bills whose effective dates are not the ordinary ones; HB 2037 is absent because its whole text took effect 2025-09-01 (TLO history "Effective on 9/1/25"). The spec never claimed otherwise; noted so nobody looks for it there.
11. A web search summary produced during this pass asserted that HB 4305 (rent and fee disclosure) "became law". The TLO history shows its last action as referral to committee on 2025-04-01, so the spec's statement that it is not law stands; this is recorded because the same wrong claim may surface again.

**Still uncertain after this pass.** Open questions 1 to 9 stand, with question 1 now carrying the legislative history. Not resolved here: whether Austin still enforces Chapter 4-14, Article 2 (no repeal was found by search; the current code page on Municode did not render); whether any party sought Texas Supreme Court review after the 2025-07-18 decision (none found by search; the court's docket was not searched directly); the Houston, Fort Worth, El Paso and Arlington statements (not re-checked); the Attorney General page (HTTP 402); and whether Texas courts apply Gov. Code 311.014(b) to the 92.109(d) date. No court decision was read in this pass either; every rule is statute text.

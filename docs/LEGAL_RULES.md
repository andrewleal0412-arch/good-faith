# California security deposit rules spec (as of 2026-10-01)

Researched 2026-10-01 by a Fable research agent from primary sources. Spot-checked the same day against the official text of Civil Code 1950.5 on leginfo: subdivisions (g)(1), (g)(2), (h)(1)(A)-(C) and the history note "Amended by Stats. 2025, Ch. 340 (AB 414), effective January 1, 2026" all match.

This is the rulebook the app enforces. The product never gives legal advice; it enforces, warns, informs and drafts for the landlord to approve (section F).

**Status of the law.** Civil Code 1950.5 was last amended by AB 414 (Stats. 2025, ch. 340), effective January 1, 2026 [S1]. It already includes:
- AB 12 (Stats. 2023, ch. 733): the deposit cap [S2]
- SB 611 (Stats. 2024, ch. 287): fees and service members [S4]
- AB 2801 (Stats. 2024, ch. 280): photos and cleaning [S3]

California has **no statewide deposit interest requirement**; interest is a local rule only.

**Why this matters for PayPal:** AB 414 (h)(1)(A) requires an electronic refund when the landlord received the security or rent electronically. PayPal is an allowed method only if the tenant agreed in writing. So the app must capture the tenant's refund-method agreement at move-in (rule D16).

## A. Rules table

Citations are to CC 1950.5 unless noted. Action: E = enforce (block), W = warn, I = inform.

| ID | Rule (plain English) | Cite | Effective | Action | Fields |
|---|---|---|---|---|---|
| D1 | "Security" is any payment, fee, deposit or charge at the start of tenancy, including advance rent and new-tenant processing fees, however labeled (screening fee under CC 1950.6 excepted) | (a), (b) | in force | E: sum all move-in charges except first month's rent as deposit | deposit_amount, move_in_fees[], first_month_rent |
| D2 | Deposit only for: unpaid rent; damage beyond ordinary wear and tear by tenant or guests; cleaning to the move-in cleanliness level; restoring/replacing personal property only if the lease authorizes it | (b)(1)-(4) | in force | E: every deduction maps to one category; category 4 blocked without lease clause | deduction.category, lease_authorizes_personal_property |
| D3 | Cap: not more than one month's rent, plus first month's rent | (c)(1), (c)(6) [S2] | security demanded on or after 2024-07-01; earlier deposits grandfathered | E at intake | monthly_rent, deposit_amount, deposit_collected_date |
| D4 | Two months allowed only if landlord is a natural person (incl. family trust settlor/beneficiary) or an LLC whose members are all natural persons, AND owns no more than two residential rental properties with no more than four units total offered for rent | (c)(5)(A),(C) | 2024-07-01 | E | owner_type, llc_all_natural, num_properties, num_units |
| D5 | The two-month exception never applies to a service member (Mil. & Vet. Code 400); can't refuse to rent for that reason | (c)(5)(B) [S9] | 2024-07-01 | E cap at one month; W | tenant_is_service_member |
| D6 | Service member charged above the standard/advertised security because of credit or housing history: written statement of amount and reason by lease signing; excess returned within six months if rent not in arrears; return date stated in lease | (c)(4) [S4] | 2025-04-01 | E: draft statement, schedule refund | advertised_deposit, lease_signed_date |
| D7 | Advance payment of six or more months' rent allowed if the lease term is six months or longer | (c)(2) | in force | I | lease_term_months |
| D8 | No lease clause calling any security "nonrefundable" | (n) | in force | E (lease text scan) | lease_text |
| D9 | No deduction for preexisting conditions, ordinary wear and tear, or cumulative wear across tenancies; only amounts reasonably necessary to restore move-in condition | (e)(1), (e)(2)(A)-(B) | in force | E: each item tagged damage vs wear | move_in_photos, move_in_checklist, item_age |
| D10 | No professional carpet or other professional cleaning charge "unless reasonably necessary to return the premises to the condition it was in at the inception of tenancy, exclusive of ordinary wear and tear" | (e)(2)(C) [S3] | 2025-01-01 | E: require move-in vs move-out cleanliness evidence | cleaning_invoice, move_in_cleanliness_evidence |
| D11 | Initial inspection: written notice of the tenant's option to request one and be present, within a reasonable time after notice to terminate or before lease end; no earlier than two weeks before the end; 48 hours' written notice (waivable in a signed writing); notice must contain the statutory abandoned-property paragraph; no duty if not requested; not required for CCP 1161(2)-(4) evictions | (f)(1), (f)(7) | in force | E: auto-draft notice | move_out_notice_date, lease_end_date, inspection_requested, inspection_datetime |
| D12 | After the inspection, an itemized statement of proposed deductions including the text of (b)(1)-(4), handed to the tenant or left inside; final deductions limited to listed items plus items arising after the inspection or hidden by tenant possessions | (f)(2)-(6) | in force | E: cross-check final list against inspection list | inspection_items[], deduction.origin |
| D13 | Move-in photos "immediately before, or at the inception of, the tenancy" | (g)(1) [S3] | tenancies beginning on or after 2025-07-01 | E (new tenancies); W (older) | tenancy_start_date, move_in_photos[] |
| D14 | Move-out photos within a reasonable time after possession is returned, before any repair or cleaning that will be deducted, and again after completion | (g)(2) [S3] | 2025-04-01 | E: no repair/cleaning deduction without before and after photos | move_out_date, before_photos[], after_photos[] |
| D15 | Within 21 calendar days after the tenant vacates: itemized statement of basis, amount and disposition of the security, and refund of the remainder | (h)(1) | in force | E: deadline countdown | move_out_date |
| D16 | Refund by personal delivery or first-class-mailed check; but if the landlord received the security or rent electronically, refund electronically to a tenant-designated account "or by any electronic or virtual method available to the landlord if agreed to in writing by the tenant"; parties may agree in writing on another method | (h)(1)(A) [S1][S5] | 2026-01-01 | E: PayPal only with the tenant's written designation | payments_received_electronically, refund_method_agreement, tenant_paypal_or_bank |
| D17 | Written notice of the right to an electronic refund within a reasonable time after notice to terminate (unless a prior written method agreement exists) | (h)(1)(A)(ii)(II) | 2026-01-01 | E: auto-draft | move_out_notice_date |
| D18 | Statement by personal delivery or first-class mail; email only by mutual written agreement (can be made any time) | (h)(1)(B) | in force | E: email locked until agreement recorded | statement_delivery_agreement, tenant_email |
| D19 | Multiple adult tenants: one check payable to all adults on the lease, statement to any one of them, unless a written agreement with all adults sets allocation percentages and delivery per tenant (CC 1946.7 terminations excepted) | (h)(1)(C) | 2026-01-01 | E | adult_tenants[], allocation_agreement |
| D20 | Documents with the statement: own/employee labor: work description, time, reasonable hourly rate; third party: bill/invoice/receipt plus name, address, phone if missing; materials: receipt or vendor price list; the (g) photos plus "a written explanation of the cost"; photos may be sent by mail, email, flash drive or online link | (h)(2)(A)-(D) | in force; (D) from 2025 | E | performer, hours, rate, invoice, vendor_contact, photo_ids, cost_explanation |
| D21 | Repair not finished or documents not in hand within 21 days: deduct a good-faith estimate with vendor contact, then complete the statement within 14 calendar days of completion/receipt | (h)(3) | in force | E: estimate flag + 14-day task | deduction.is_estimate, completion_date |
| D22 | Documents not required if repair plus cleaning deductions total $125 or less, or the tenant signed a waiver (valid only after a termination notice or within 60 days of lease end, containing the (h)(2) text); the tenant may still demand documents within 14 days, and the landlord then has 14 days | (h)(4)-(5) | in force | E threshold; W attach anyway | total_repair_cleaning, waiver_signed_date |
| D23 | Mail to the tenant's provided address, else to the vacated unit | (h)(6) | in force | E | forwarding_address |
| D24 | Bad-faith failure to follow (h) forfeits any claim to the security; bad-faith retention: statutory damages up to twice the deposit plus actual damages; landlord bears the burden of proof on reasonableness | (h)(7), (m) | in force | I (risk banner) | none |
| D25 | Sale/transfer: either transfer remaining security to the successor and notify the tenant (personal delivery or first-class mail) of the transfer, claims, amount and successor contacts; or return it with an (h) accounting; written statement to the successor; successor jointly liable if not done | (i)-(l) | in force | E: transfer workflow | sale_date, successor_contact |
| D26 | A late fee is deductible only if lawfully owed; residential late-fee clauses are liquidated damages, void unless actual damage was impracticable to fix and the amount is a reasonable estimate | CC 1671(c)-(d); Orozco v. Casimiro [S16] | in force | W: flag every late-fee deduction, require a lease clause | lease_late_fee_clause, late_fee_amount |
| D27 | No fee for paying rent or deposit by check; no fee for serving notices | CC 1947.3, 1946, 1946.1 [S4] | 2025-01-01 | E: block these deduction types | deduction.type |
| D28 | Local deposit interest owed in SF, LA RSO units, Berkeley, West Hollywood; unpaid interest due with the deposit at move-out | sources S10-S13 | varies | I / compute by city | property_city, rso_status, deposit_held_since |
| D29 | Product performs no applicant screening or selection | Gov. Code 12955; CC 1950.6 [S18] | in force | E (scope) | none |
| D30 | Templates and factual information only; no advice on a specific landlord's rights or strategy | B&P 6125, 6400; People v. LPS [S19] | in force | E (copy and flow) | none |

## B. Itemized statement checklist

1. Tenant name(s), unit address, move-out date, statement date; 21-day deadline shown. (h)(1)
2. Security received and its basis (date paid; any portions labeled fees or advance rent). (h)(1), (b)
3. One line per deduction, each tagged (b)(1) rent, (b)(2) damage, (b)(3) cleaning, or (b)(4) personal property (lease clause quoted). (b), (h)(1)
4. Landlord/employee labor: description, time, hourly rate. (h)(2)(A)
5. Outside vendors: copy of the bill, invoice or receipt; vendor name, address, phone if not on it. (h)(2)(B)
6. Materials: receipt, or vendor price list for stock items. (h)(2)(C)
7. Every repair or cleaning deduction: before-repair and after-repair photos (plus move-in photos for tenancies from 2025-07-01) and a written cost explanation; delivered by mail, email, flash drive or link. (g), (h)(2)(D)
8. Any good-faith estimate marked as such, with vendor contact and the 14-day follow-up. (h)(3)
9. If documents are omitted because deductions total $125 or less, say so, with the tenant's right to request them within 14 days. (h)(4)-(5)
10. Refund amount, method (electronic if rent or deposit was paid electronically, unless a written agreement says otherwise), and payee(s) for multiple adult tenants. (h)(1)(A), (h)(1)(C)
11. Local interest owed (rate and period) if the city requires it. [S10]-[S13]
12. If deductions exceed the deposit: the balance claimed, stated as a claim, not a demand for immediate payment. (e)(1); DRE guide [S6]
13. Delivery record: personal delivery, first-class mail to the forwarding address (else the unit), or email under a recorded agreement. (h)(1)(B), (h)(6)

## C. Wear-and-tear guide

The statute never defines "ordinary wear and tear"; it only bars charging for it. The DRE guide (2026 ed., pp. 83-85) gives the examples and the useful-life method, and says these "are not necessarily the law" [S6]. Confidence: H = statute, M = DRE guidance, L = common practice.

| Item | Usually | Proration | Source, confidence |
|---|---|---|---|
| Faded or lightly scuffed paint, worn paint behind furniture | Not deductible | None | DRE p. 85, M |
| Small nail or pin holes, minor nicks | Not deductible | None | DRE p. 85, M |
| "Large number of holes" needing plaster and repaint; large gouges | Deductible | Paint 2-year life: under 6 months full cost; 6-12 months two thirds; 1-2 years one third; 2+ years nothing | DRE p. 84, M (some use 3 years, L) |
| Routine repainting between tenancies | Not deductible | None | DRE p. 84, M |
| Carpet worn or matted from use, moderate spotting | Not deductible | None | DRE p. 84; (e)(2)(A), H |
| Carpet with large rips, burns, pet urine, indelible stains | Deductible | Replacement cost x remaining life / total life (DRE: 8-year-old carpet, 10-year life, $1,000 new: charge $200) | DRE p. 84, M; 8-10 year life is practice, L |
| Drapes and blinds faded or loose from age | Not deductible | None | DRE p. 84, M |
| Blinds snapped or torn by tenant | Deductible | Prorate by age if replaced; repair cost if repaired | (b)(2), H; proration L |
| Dirty oven, mildew, flea infestation, decals, unwashed floors | Deductible cleaning | Actual reasonable cost to reach move-in level only | DRE p. 83, M; (b)(3), H |
| Built-up wax or grime from prior tenancies | Not deductible | None | DRE p. 84; (e)(2)(A), H |
| Professional carpet cleaning as a standard charge | Not deductible unless necessary to reach move-in condition | None | (e)(2)(C), H |
| Burns, chewed trim, broken fixtures caused by tenant or guests | Deductible | Reasonable repair cost | (b)(2); DRE p. 82, H/M |
| Damage from a prior tenant | Not deductible | None | (e)(2)(A), H |

## D. Edge cases

- **Partial months.** Unpaid prorated rent for days occupied is a (b)(1) deduction. Rent for days after possession was returned is not "default in the payment of rent" and must be justified separately; lease-break damages are outside this tool, so flag them for the landlord.
- **Deposit over the cap.** Block at intake. Deposits collected before 2024-07-01 are grandfathered by (c)(6). For later over-cap deposits the statute states no specific remedy; inform the landlord and offer a refund of the excess.
- **Deductions exceed the deposit.** The statement shows a balance claimed; the tool drafts only. The landlord still bears the burden of reasonableness under (m).
- **Tenant dispute.** Record it. Respond to any document request within 14 days under (h)(5). Remind the landlord that disputes go to small claims under (o), within the CCP 116.221 limit ($12,500 per the DRE guide p. 85). Good-faith late compliance doesn't forfeit setoff rights (Granberry) [S17]; bad faith does, under (h)(7) and (m).
- **Tenancy began before 2025-07-01.** No (g)(1) move-in photo duty, but move-out before/after photos are still required for any deduction after 2025-04-01. The burden of proving move-in condition stays with the landlord under (m); accept checklists, prior photos, or the prior tenant's statement.
- **Roommates on one lease.** By default, one refund payable to all adult tenants, with the statement to any one of them. Split refunds only under a written agreement signed by all adults, per (h)(1)(C). Collect that agreement at move-in.
- **Property sold during the tenancy.** Run the (i)-(l) workflow: transfer and notify, or return with an accounting, plus a written statement to the buyer.
- **Service member.** Cap at one month even for small landlords, plus the (c)(4) written statement and six-month refund if charged above the advertised amount.
- **Tenant paid by Zelle, card or portal.** An electronic refund is mandatory unless a written agreement picks another method. PayPal qualifies only if the tenant agreed in writing.
- **No inspection requested.** The landlord's (f) duties are discharged, but photos and the 21-day statement still apply.

## E. Demo scenario (Orange, CA)

This is the scenario `npm run demo:seed` builds (README.md, "Demo"): a fictional lease, landlord, tenants and address. Its dates run from the day the seed is run.

**The setup:**
- Single-family house in the City of Orange. The owner is one natural person with one rental, so the two-month cap applies (D4, (c)(5)(A)).
- Rent $2,400, so the cap is $4,800. The one-year tenancy began 2025-10-01, with move-in photos taken (D13).
- The lease asks a $4,800 deposit plus a $300 "nonrefundable" cleaning fee for professional cleaning at the end of the tenancy. Everything charged at the start counts as security (D1), so the $5,100 asked is $300 over the cap (D3, D4); no security may be called nonrefundable (D8, (n)); and professional cleaning can't be required regardless of condition (D10, (e)(2)(C)). A $120 late fee the lease lets the landlord take from the deposit gets a warning (D26).
- The agent invoices the $4,800 cap through PayPal and the tenants pay it there, so the refund must be electronic (D16). Both adult tenants signed the PayPal refund agreement at move-in, so the electronic-refund notice (D17) is not owed and the tool says so.

**The timeline:**
- The tenants gave notice 30 days before the move-out. The tool drafted the initial-inspection notice (D11, (f)(1)), recorded as mailed two days later.
- Move-out on the day the seed runs, so the statement and refund are due 21 days later (D15). PayPal dates the sandbox payment that same day; every other record is dated the day it belongs to.
- No local interest. Orange has no rent or deposit ordinance, and no Orange County city requires deposit interest as far as could be found (medium-high confidence) [S15].

**The outcome** (move-in, before and after photos on file):
1. A few small nail holes in the bedroom: wear and tear, $0 (D9; DRE p. 85).
2. Bedroom carpet with a large stain, replaced: $1,800 invoice. The carpet is 6 years old with a 10-year life, so 4 years remain: **$720** (DRE p. 84 proration, marked as guidance). The inspection may say to try cleaning first; the deduction then carries the landlord's note that spot cleaning did not lift the stain, as part of the written explanation of the cost (D20, (h)(2)(D)).
3. Hole in the living room wall, patched by a handyman: invoice $140, with name, address and phone: **$140**.
4. Range cleaning by the landlord: 3 hours at $50, described: **$150**. No professional cleaning was billed, so (e)(2)(C) is satisfied.

**Total deductions: $1,010.** That's over $125, so the invoices, labor description, photos and cost explanation are attached (D20, D22). **Refund: $3,790**, by PayPal under the written agreement, within 21 days of the move-out (D15, D16). The statement goes by first-class mail, or by email under a recorded agreement (D18).

## F. Disclaimers and UPL guardrails

**Product copy:**
- "This tool organizes your records and fills in templates based on California Civil Code 1950.5 and published state guidance. It does not give legal advice, does not evaluate your specific situation, and is not a substitute for a California attorney." (B&P 6125)
- "Items marked Guidance or Common practice (useful-life proration, paint schedules) are not in the statute. A court may decide differently."
- "You decide every deduction and approve every document before it is sent. The tool flags rules; it does not decide disputes."
- "Local ordinances may add interest or other duties. Check your city's rent program."

**Design rules:**
- Present rules and the statutory text, never "you should deduct".
- Use flags ("This item may be ordinary wear and tear under the DRE guide") rather than conclusions.
- Don't answer "can I win in court" questions in chat; route them to the Courts self-help guide [S7] and lawyer referral.
- Keep templates generic, and let the landlord select and complete them. That tracks the "ministerial" completion of documents "at the person's specific direction" in B&P 6400, and the distinction in People v. Landlords Professional Services between forms and "advice addressed to the specific problems and concerns of its clients" [S19].
- No California court has decided whether an AI agent that explains statutory rules is giving "advice". That risk is real and unsettled, so keep every explanation tied to a quoted source.

## Sources

- [S1] CC 1950.5 (current): https://leginfo.legislature.ca.gov/faces/codes_displaySection.xhtml?lawCode=CIV&sectionNum=1950.5
- [S2] AB 12 (2023, ch. 733): https://leginfo.legislature.ca.gov/faces/billTextClient.xhtml?bill_id=202320240AB12
- [S3] AB 2801 (2024, ch. 280): https://leginfo.legislature.ca.gov/faces/billTextClient.xhtml?bill_id=202320240AB2801
- [S4] SB 611 (2024, ch. 287): https://leginfo.legislature.ca.gov/faces/billTextClient.xhtml?bill_id=202320240SB611
- [S5] AB 414 (2025, ch. 340): https://legiscan.com/CA/text/AB414/id/3272194
- [S6] DRE, California Tenants guide, 2026 ed., deposits pp. 75-85: https://www.dre.ca.gov/publications/ResourceGuidebook/2026_Landlord_Tenant_Guide.pdf
- [S7] Courts self-help, security deposits: https://selfhelp.courts.ca.gov/guide-security-deposits-california
- [S8] Attorney General fact sheet: https://www.oag.ca.gov/system/files/media/Know-Your-Rights-Security-Deposits-English.pdf
- [S9] Mil. & Vet. Code 400: https://leginfo.legislature.ca.gov/faces/codes_displaySection.xhtml?lawCode=MVC&sectionNum=400
- [S10] San Francisco (Admin. Code ch. 49; 4.2% for 3/1/2026 to 2/28/2027): https://www.sf.gov/reports--security-deposits , https://www.sf.gov/news--new-interest-rate-security-deposits-effective-3126
- [S11] Los Angeles (LAMC 151.06.02; RSO units; 3.03% for 2026): https://housing.lacity.gov/wp-content/uploads/2023/01/44-Interest-Payments-on-Security-Deposits-English.pdf
- [S12] Berkeley (BMC 13.76.070; 0.9% for 2025): https://rentboard.berkeleyca.gov/sites/default/files/documents/CHAPTER%207_Security%20Deposits_1.pdf
- [S13] West Hollywood (WHMC 17.32.020; 4.3% for 2025): https://weho.granicus.com/MetaViewer.php?view_id=23&clip_id=4257&meta_id=303670
- [S14] Santa Monica (no interest requirement): https://www.smgov.net/Security_Deposits.aspx
- [S15] Santa Ana rent ordinance (no deposit provisions found): https://santa-ana.gov/rsjce-ordinance/
- [S16] CC 1671: https://leginfo.legislature.ca.gov/faces/codes_displaySection.xhtml?lawCode=CIV&sectionNum=1671 ; Orozco v. Casimiro (2004) 121 Cal.App.4th Supp. 7: https://caselaw.findlaw.com/court/ca-superior-court/1010356.html
- [S17] Granberry v. Islay Investments (1995) 9 Cal.4th 738: https://law.justia.com/cases/california/supreme-court/4th/9/738.html
- [S18] Gov. Code 12955: https://leginfo.legislature.ca.gov/faces/codes_displaySection.xhtml?lawCode=GOV&sectionNum=12955 ; CC 1950.6: https://leginfo.legislature.ca.gov/faces/codes_displaySection.xhtml?lawCode=CIV&sectionNum=1950.6
- [S19] B&P 6125, 6400: https://leginfo.legislature.ca.gov/faces/codes_displaySection.xhtml?lawCode=BPC&sectionNum=6125 ; People v. Landlords Professional Services (1989) 215 Cal.App.3d 1599: https://caselaw.findlaw.com/court/ca-court-of-appeal/1771504.html

**Uncertainties:**
1. The $125 threshold is statute. The useful-life method and paint schedule are DRE guidance only.
2. Berkeley's 2026 move-out rates weren't confirmed from a primary document.
3. LAMC and West Hollywood were confirmed through city bulletins, not the code pages.
4. No court decision yet addresses missing (g) photos. The consequence is indirect: the (h)(2)(D) documentation can't be satisfied, which feeds (h)(7) forfeiture risk and the (m) burden of proof.

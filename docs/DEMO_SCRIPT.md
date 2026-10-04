# Demo video script

Under three minutes, eight beats, one fresh demo copy. Each beat names the screen to show, what to click, and one line to say. The times are a budget, not a stopwatch.

## Before recording

- Open the hosted demo once a few minutes ahead, so Render is awake, and check the pool has a deposit ready (`npm run demo:pool -- --status`).
- Enter the judges' code in a private window: a fresh copy, dated today. Use Start over if you rehearsed in it.
- Two windows side by side: the landlord on the left, the tenants' page on the right. "Open the tenant's view" opens a new tab, not a window, so drag that tab out to the right once it opens.
- Beats 5 and 7 hold six clicks each in 25 seconds, which fits only without fumbling. To give beat 5 room, record the statement's delivery off camera right after beat 4 (Statement, Record delivery, any method), open the tenant's view then and drag it into the right window, and start beat 5 on the tenants' page. Rehearse 5 to 7 once on a spare copy (Start over gives a fresh one).
- Three waits are real Claude or PayPal calls: the lease check (about 20 seconds), the close-out agent (under a minute) and the advocate (about a minute). Record them and cut the wait. Run the lease check once before recording if you want its result on screen without the wait.
- If the negotiation runs long or the agents don't agree on camera, beat 6 can use 482 N. Glassell St, Unit B instead, which comes with a settled dispute. Say it is the demo's recorded example. Its beat 7 shows the settlement row and the amended statement, but no PayPal refund id: no PayPal money moved for it, and the page says "Demo example". The PayPal refund then rests on beat 4, so prefer a re-take of the live run for the final cut.

## The beats

| # | Time | Beat | Screen | Click | Say |
|---|---|---|---|---|---|
| 1 | 0:00 to 0:20 | Lease check | Check a lease (`/lease`) | Upload `demo/lease-single-owner.pdf` | "Claude reads the lease; code checks it against the statute: a deposit over the cap, a 'nonrefundable' fee, and the lawful amount to collect." |
| 2 | 0:20 to 0:35 | Deposit by PayPal | Properties, then 1140 E. Juniper Hollow Ln, Overview | Point at Move-in: the signed refund agreement and the deposit paid through a PayPal invoice | "The deposit is collected through a PayPal invoice for the lawful amount only, and the tenants agree in writing to a PayPal refund." |
| 3 | 0:35 to 0:55 | Move-out boxes | Same unit, Move-out tab | Open the carpet's photo pair; hover a box; scroll to the three deductions | "Claude compares move-in and move-out photos room by room and boxes what changed. It classifies; code prices, with the carpet prorated by its age. Wear and tear is never charged." |
| 4 | 0:55 to 1:15 | Refund approval | Review refund | Prepare refund, then Send refund | "The close-out agent proposes $3,790 back through PayPal's Agent Toolkit over MCP. Nothing moves until I approve, and a guard re-checks the amount and the capture right before PayPal is called." |
| 5 | 1:15 to 1:40 | Tenant dispute | The tenants' page (right window), opened before recording | Dispute it, under Deductions: the carpet, one sentence why; Ask my advocate; Send | "Now the tenants. Their own Claude agent, the advocate, reads the same file and writes their case. Code computed each charge's lawful range first, so the case can't ask outside it." |
| 6 | 1:40 to 2:10 | Two-agent negotiation | Landlord's Move-out tab (left), tenants' dispute page (right) | Let my negotiator answer; open one turn's Reasoning and figures, and a Why? | "My negotiator answers with my evidence, their advocate answers back. Every turn is checked by code: inside the lawful range, no taking back a concession, citations from the statute only, and no legal advice." |
| 7 | 2:10 to 2:35 | PayPal settlement | Tenants' page, then landlord's Move-out tab | Accept settlement (right); Approve and pay (left); then Amended statement and Payments | "It takes both humans: the tenants accept, I approve. PayPal refunds the agreed amount against the same deposit payment, and the statement becomes the amended statement. No small claims court for either side." |
| 8 | 2:35 to 2:55 | Multi-state | Properties | Point at 2317 Mesquite Bend Dr (TX); hover its Rules chip | "The same engine runs California, New York, Texas, Florida and Washington from verified rule packs: different deadlines, documents and penalties, the same PayPal rails and guards." |

Close on the Properties page (2:55 to 3:00): "Good Faith. AI that informs and negotiates inside the law, PayPal that pays only when both sides say yes. Not legal advice."

## What each beat proves

- Beats 1 to 3: Claude reads and classifies; code decides every amount (`rules.ts`, `deductions.ts`).
- Beat 4: agentic commerce with a human approval on every money tool (`agent.ts`, `needsApproval`, `guardRefund`).
- Beats 5 to 7: two agents for two humans, bounded by code (`lawful-range.ts`, `negotiator.ts`), settled through PayPal only after both approve (`settlement.ts`).
- Beat 8: the state packs (`src/lib/states/`, `docs/rules/`).

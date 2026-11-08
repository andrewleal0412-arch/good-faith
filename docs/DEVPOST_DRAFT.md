# Devpost submission draft

The text for the [PayPal AI Hackathon](https://paypalaihackathon.devpost.com/) submission, under Devpost's own field
names and story headings, so it pastes in one to one. Every claim is checked against this repository. The access code
and the video link go in the placeholders at the end. The GitHub link under Try it out works only once the repository
is public.

---

## Tagline

Claude reads the lease and the move-out photos, code computes every dollar from the state's deposit statute, and
PayPal sends the refund after the landlord approves it.

## Built with

node.js, next.js, react, typescript, tailwind, paypal, paypal-agent-toolkit, mcp, claude, anthropic, ai-sdk,
typesafe-jev, supabase, postgres, ag-grid, ag-charts, pdf-lib, sharp, zod, playwright, axe-core, render

---

# Project story

## Inspiration

California rewrote its security deposit law four times in three years: a new cap, mandatory move-in and pre-repair
photos, electronic refunds when the deposit or the rent came in electronically, and no professional cleaning charge
beyond what move-in condition requires. The landlords most likely to get this wrong own one condo and keep the
tenancy in text messages, where bad faith costs up to twice the deposit. Their tenants get a number with no
arithmetic behind it and nowhere to take it but small claims court. I wanted the lawful close-out to be the easy
path for both of them, with the money going back as soon as the landlord approves.

## What it does

Upload the lease and Claude pulls out the deposit terms with the wording it relied on. The state's rule pack flags
what breaks the law, works out the lawful deposit, and a PayPal invoice asks for that and nothing more. At move-out
Claude boxes what changed between each room's move-in and move-out photos: damage, cleaning, wear and tear (never
charged) or unclear. Code prices each from the vendor's invoice or the landlord's hours, prorated over the item's
useful life.

The close-out agent reads those figures, checks the deposit with PayPal and proposes the refund. Nothing moves until
the landlord presses Send refund. If the tenants disagree, their own Claude agent writes their case and trades offers
with the landlord's agent for up to three exchanges; PayPal pays the settlement once the tenants accept and the
landlord approves. If the tenants open a PayPal dispute instead, a defense agent drafts the response for the landlord
to approve word for word. All of it runs on five rule packs: California, New York, Texas, Florida and Washington, each
with its own deadline and time zone. The app informs, computes and drafts. It does not give legal advice.

## How we built it

One Next.js 16 app on Render, with Supabase for the data and the files.

PayPal, as the code names it. The **Invoicing API** collects the deposit. The refund and the settlement go through
**PayPal's Agent Toolkit** (`@paypal/agent-toolkit` 1.11.0) as an **MCP server inside the app's own process**. The
close-out agent gets `get_invoice`, `get_refund` and `create_refund`, plus the app's own `send_payout`; the settlement
and the chargeback defense call `create_refund`, `list_disputes` and `get_dispute` from code. The **Payouts API** is
the rail for a payment that can no longer be refunded; the **Disputes API** takes the evidence as one multipart
request. **Webhooks** are checked with PayPal's verify-webhook-signature, so a refund made by hand in the dashboard is
counted once.

AI decides: Claude (Opus 5.5, through the AI SDK) reads the lease, classifies each change in the photos, and writes
the agents' proposals and turns.

Code decides: the cap, every deduction, the deadlines, the PayPal rail, and each charge's lawful range. No model picks
an amount. Every money tool carries `needsApproval`, and on approval `guardRefund` reads the database and PayPal again
and refuses any other amount, payment or account.

## Challenges we ran into

PayPal's Invoicing API accepts `PayPal-Request-Id` and ignores it, so the deposit invoice is made once by its invoice
number; the Disputes API does not declare it, so a resend is guarded by reading the dispute first. PayPal refused my
first evidence submission with `ITEM_ID_IS_MANDATORY_FOR_MULTIPLE_EVIDENCES`, so the files go in one submission now.
And PayPal refuses a partial refund while a case is open on the payment, which decided the chargeback response: while
money is still owed back, accepting the claim is the only answer the rules allow.

The demo was the other hard part: each browser that enters the access code gets a private copy of the data with a
pre-paid sandbox deposit of its own, so no judge's refund touches another's.

## Accomplishments that we're proud of

Code computes each disputed charge's lawful range before either agent speaks, and checks every turn against it. Words
planted in a dispute can change the wording of an answer at most, never the money.

Four Claude agents work on the money and none of them can move it alone. The refund, the settlement and the response
to a PayPal dispute are each claimed once in the database and recomputed from the database and PayPal at the moment of
the call, so a double click cannot pay twice.

The path a judge takes through the demo is also an automated test. It builds the app, walks the demo script in a real
browser on a production build, and works every dollar on screen out again from the demo copy's own rows: 179 checks. A
second script holds every page to WCAG 2.2 AA at 1280 and 390 px, 397 checks, with the three things still open written
down.

## What we learned

I learned to keep the split narrow and then to leave it alone. Claude reads, classifies and writes; code decides
every amount; a person approves; PayPal moves the money. That line is what lets every dollar on the statement point
back to a rule with a citation.

PayPal's toolkit made the calls easy to hand to an agent, so what took my time was everything around them: an
approval claimed once, a plan recomputed right before the call, and an idempotency key taken from the app's own
records, because what PayPal tracks for you differs from one of its APIs to the next. The toolkit hands an agent the
calls. It does not hand you the guards, and I had to write those.

Writing each pack from its own state's text, with sources and rule ids, taught me that a new state is research and a
pack, not a new engine. It also taught me that the wording needs the same care as the money: language that goes past
informing, like telling someone to sue or predicting a court, is replaced in code with the app's own.

## What's next for Good Faith

Per-landlord PayPal sign-in, which live PayPal is waiting on. More states, from their statutes the way these five
were. Venmo as a payout rail, which the sandbox refused. And the accessibility work still open: text-field borders at
1.2:1 against white, a pass with a real screen reader, and a tagged PDF for the statement.

---

# The other Devpost fields

## Project name

Good Faith

## Try it out links

- https://good-faith.onrender.com
- https://github.com/andrewleal0412-arch/good-faith

## Video demo link

`<VIDEO URL GOES HERE>`

## Testing instructions

https://good-faith.onrender.com, PayPal sandbox only. No real money moves.

1. Enter the access code: `<ACCESS CODE GOES HERE>`.
2. Your browser gets a private copy of a small landlord with three units, dated to today, with a guide at the top of
   each page linking to each step. Start over, in the account menu, gives a fresh one.
3. Check a lease, in the sidebar, then Check the sample lease: one click, no Claude call, and the code flags a deposit
   over the cap, a "nonrefundable" fee and the lawful amount to collect. To watch Claude read it live (about 20
   seconds), open the sample from the link beside the button and drop the PDF on the page.
4. Properties, then 1140 E. Juniper Hollow Ln. Its Overview shows the deposit paid through a PayPal invoice and the
   tenants' signed refund agreement; its Move-out tab shows Claude's boxes and the three deductions. Review refund,
   Prepare refund (the close-out agent, under a minute), then Send refund: a real sandbox refund of $3,790.00 from
   your copy's own deposit, with PayPal's refund ID on the receipt.
5. For the two agents: on the receipt, press Send statement, then Record delivery, then Open the tenant's view. On the
   tenants' page, Dispute it: tick the carpet, say why, pick a name, Ask my advocate (about a minute), then Send to
   Teddy Buettner and confirm.
6. Back on the landlord's Move-out tab, Let my negotiator answer: the two agents trade offers, up to three exchanges,
   each turn checked by code. Then pick a name and Accept settlement on the tenants' page, and Approve and pay on the
   Move-out tab (each asks once more): PayPal refunds the agreed amount against the same deposit payment, and the
   statement becomes the amended statement.
7. Properties, then 2317 Mesquite Bend Dr, Unit 3: the same engine under Texas law, with the Rules chip under the
   address.

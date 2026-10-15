# Devpost submission draft

Draft submission text for the [PayPal AI Hackathon](https://paypalaihackathon.devpost.com/), field by field. Every
claim is checked against this repository; the access code goes in the placeholder below.

---

## Project name

Good Faith

## Elevator pitch

Claude reads the lease and the move-out photos, code computes every dollar from the state's deposit statute, and
PayPal sends the refund after the landlord approves it.

## The problem

California rewrote its security deposit law four times in three years: a new cap, mandatory move-in and pre-repair
photos, electronic refunds when the rent or the deposit came in electronically, and no professional cleaning charge
beyond what move-in condition requires. The landlords most likely to get this wrong own one condo and keep the
tenancy in text messages, where bad faith costs up to twice the deposit. Their tenants get a number with no
arithmetic behind it and nowhere to take it but small claims court.

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
with its own deadline and time zone.

## How I built it

One Next.js 16 app on Render, with Supabase for the data and the files.

PayPal, as the code names it. The **Invoicing API** collects the deposit. The refund and the settlement go through
**PayPal's Agent Toolkit** (`@paypal/agent-toolkit` 1.11.0) as an **MCP server inside the app's own process**. The
close-out agent gets `get_invoice`, `get_refund` and `create_refund`, plus the app's own `send_payout`; the settlement
and the chargeback defense call `create_refund`, `list_disputes` and `get_dispute` from code. The **Payouts API** is
the rail for a payment that can no longer be refunded; the **Disputes API** takes the evidence as one multipart
request. **Webhooks** are checked with PayPal's verify-webhook-signature, so a refund made by hand in the dashboard is
counted once.

AI decides: Claude (Opus 5.5, through the AI SDK) reads the lease, classifies each change in the photos, and writes
the agents' proposals and turns. Jev by TypeSafe reads a finding as the landlord types it and checks each agent's
reasons against the record.

Code decides: the cap, every deduction, the deadlines, the PayPal rail, and each charge's lawful range. No model picks
an amount. Every money tool carries `needsApproval`, and on approval `guardRefund` reads the database and PayPal again
and refuses any other amount, payment or account.

## What was hard

PayPal's Invoicing API accepts `PayPal-Request-Id` and ignores it, so the deposit invoice is made once by its invoice
number; the Disputes API does not declare it, so a resend is guarded by reading the dispute first. PayPal refused my
first evidence submission with `ITEM_ID_IS_MANDATORY_FOR_MULTIPLE_EVIDENCES`, so the files go in one submission now.
And PayPal refuses a partial refund while a case is open on the payment, which decided the chargeback response: while
money is still owed back, accepting the claim is the only answer the rules allow.

The demo was the other hard part: each browser that enters the access code gets a private copy of the data with a
pre-paid sandbox deposit of its own, so no judge's refund touches another's.

## What I am proud of

Code computes each disputed charge's lawful range before either agent speaks, and checks every turn against it. Words
planted in a dispute can change the wording of an answer at most, never the money.

## What is next

Per-landlord PayPal sign-in, which live PayPal is waiting on. More states, from their statutes the way these
five were. Venmo as a payout rail, which the sandbox refused.

## Built with

next.js, react, typescript, tailwind, paypal, paypal-agent-toolkit, mcp, claude, anthropic, ai-sdk, typesafe-jev,
supabase, postgres, ag-grid, ag-charts, pdf-lib, sharp, zod, playwright, axe-core, render

## Testing instructions

https://good-faith.onrender.com, PayPal sandbox only. No real money moves.

1. Enter the access code: `<ACCESS CODE GOES HERE>`. On Render's free plan the first page after a quiet spell takes
   about a minute.
2. Your browser gets a private copy of a small landlord with three units, dated to today, with a guide at the top of
   each page linking to each step. Start over, in the account menu, gives a fresh one.
3. Open 1140 E. Juniper Hollow Ln and its Move-out tab for Claude's boxes. Review refund, Prepare refund, then Send
   refund: a real sandbox refund of $3,790.00 from your copy's own deposit.
4. For the two agents: on the receipt, press Send statement, then Record delivery, then Open the tenant's view and
   dispute a charge.

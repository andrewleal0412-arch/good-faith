# Deposit agent: PayPal AI Hackathon plan

Working name only; pick the real name before the repo goes public.

**Hackathon:** https://paypalaihackathon.devpost.com/
- Due **Thu Nov 12, 2:00 PM PT**. We aim to submit **Sun Nov 8**.
- Required: a working demo (hosted URL or a runnable repo), a public GitHub repo with an open source license, and a YouTube video under 3 minutes.
- Judged on five equal criteria: tech implementation (PayPal + AI), design (complete product), impact, innovation, presentation.
- Research behind this pick: the Obsidian vault note `Ideas & Notes/PayPal AI Hackathon - idea research (2026-10-01).md`.

## The product in one line

An AI agent that runs a California security deposit from move-in to refund for small landlords. It records the lease and move-in photos, compares move-out photos, proposes only lawful deductions with photo evidence, writes the Civil Code 1950.5 itemized statement inside the 21-day window, and pays the refund through PayPal.

**Who it's for:** owners of 1 to 10 units, and the tenants who get their deposit back faster and with receipts.

**Why now:** AB 2801 made move-in and move-out photos mandatory for California deductions in 2025. Bad-faith retention costs up to twice the deposit. Most small landlords track all of this in texts and Venmo screenshots.

## The demo (what the 3-minute video shows)

1. **Move-in.** Upload the lease and move-in photos. The agent pulls out the deposit terms and flags anything unlawful, such as a deposit over the AB 12 cap. The deposit is collected with a PayPal invoice, which the tenant pays with PayPal, Venmo or a card.
2. **Move-out.** Upload the move-out photos. Claude compares them room by room. It separates ordinary wear and tear (no charge) from damage (deduction, prorated by useful life), and every line cites its before and after photos.
3. **Statement.** The 1950.5 itemized statement is generated with the photos attached, with the 21-day clock on screen.
4. **Money.** The landlord approves, and the agent picks the rail:
   - a partial refund of the original deposit payment if it's within PayPal's 180-day refund window;
   - otherwise a PayPal Payout to the tenant's PayPal or Venmo;
   - if the damage is more than the deposit, a PayPal invoice for the difference.
5. **Dispute.** The tenant contests one line. The agent re-checks it against the photos and the rules, then adjusts the line or explains why it stands.

## Stack

- **Next.js** (App Router, TypeScript) as one deployable app on **Render**, which is a hackathon sponsor with credits.
- **AI:** the Vercel AI SDK with Anthropic Claude for vision (photo comparison), extraction (lease) and drafting (statement, dispute replies).
- **PayPal:**
  - the Agent Toolkit (`@paypal/agent-toolkit/ai-sdk`) for invoices, orders, refunds, recorded refunds and transactions;
  - the Payouts REST API, called directly since it isn't in the toolkit;
  - webhooks for paid invoices and payout status;
  - all in the sandbox.
- **Rules engine:** deterministic TypeScript rules (deadlines, caps, the $125 receipt threshold, useful-life proration) built from the legal spec. The model proposes; the rules decide what's lawful. That keeps it explainable to judges.
- **Data:** SQLite (or Render Postgres) plus file storage for photos. A PDF statement with embedded photos.
- **Sponsor prize to stack (max one):** AG Grid for the landlord's deposit ledger, with Render credits for hosting.
- **Guardrails:** spending policy, approval before any payout, and an audit log of every agent action. These speak to "Best Use of Agentic Commerce".

## Schedule

| Dates | Andrew | Build |
|---|---|---|
| Oct 1-8 (midterms) | ~15 min: join on Devpost, create the PayPal Developer account, paste the sandbox keys into the setup prompt | Legal rules spec; scaffold the app; prove the sandbox loop (invoice, pay, refund, payout); Claude vision test on sample photos |
| Oct 9-15 | Review the first screens, decide the name | Data model; lease upload, extraction and compliance flags; deposit invoice at move-in; move-in photo record |
| Oct 16-22 (knee closes Oct 22) | Light | Move-out photo comparison; deduction engine with wear and tear and proration; itemized statement PDF; 21-day clock |
| Oct 23-29 | Product decisions, real-user tests | Refund vs payout routing, Venmo path, excess-damage invoice, tenant view and dispute flow, approval guardrail |
| Oct 30-Nov 5 | Test with 2-3 student renters and 1 landlord | Design polish, AG Grid ledger, hosted on Render, README with run instructions |
| Nov 6-8 | Film the demo (real room, staged damage) | Video edit, Devpost text, submit Nov 8; Nov 9-11 is buffer |

## Decisions still open

- **Name.**
- **An Anthropic API key with a spend cap** for the hosted demo. A public web app can't use the Max subscription; expect well under $20 for judging.
- **When the GitHub repo goes public:** private during the build, public before submission.
- **Where to film:** his apartment with staged move-out damage.

## Risks

- **Money transmission:** the app never holds funds. The landlord's PayPal business account does; the agent prepares and sends with approval.
- **Venmo payouts may not be testable in the sandbox:** demo with sandbox PayPal recipients and show the Venmo code path.
- **Law:** it flags and drafts, it doesn't give legal advice, and it never does tenant screening.
- **Fees:** PayPal invoices cost 3.49% + $0.49. Note it in the pitch, and lean on Payouts for money out.

# Deposit agent

An AI agent that runs a California security deposit from move-in to refund for small landlords: the owner of one condo, a duplex or an ADU who manages it alone. It reads the lease and flags what breaks Civil Code 1950.5, collects only the lawful deposit through a PayPal invoice, keeps the move-in and move-out photos the law now requires, has Claude compare them room by room, computes the deductions in code, writes the itemized statement with its exhibits, and returns the deposit through PayPal's Agent Toolkit with the landlord's approval. Built for the PayPal AI Hackathon.

It organizes records and fills in templates from the statute and published state guidance. It does not give legal advice.

## Run it locally

Next.js 16 (App Router), Supabase, PayPal sandbox and Claude through the AI SDK.

```bash
npm install
scripts/setup-supabase.sh        # SUPABASE_URL and SUPABASE_SECRET_KEY
scripts/setup-sandbox.sh         # PAYPAL_CLIENT_ID and PAYPAL_CLIENT_SECRET (sandbox)
scripts/setup-sandbox-tenant.sh  # the sandbox personal account that plays the tenant
scripts/setup-anthropic.sh       # ANTHROPIC_API_KEY
npm run dev -- -p 3210
```

Secrets live in `.env.local`, which is gitignored. The scripts above write it; nothing else should.

## Demo

One command builds a complete demo tenancy by driving the app's own APIs, so every step is the real one: the lease check, the tenancy, the tenants' written agreement to a PayPal refund (AB 414), the deposit invoice paid in the PayPal sandbox, move-in photos, the tenants' notice with the written notice it calls for, the move-out date, move-out photos, Claude's room-by-room inspection, three deductions with their receipts and after-repair photos, and the private tenant link. It stops before the close-out, so the agent and the approval happen live.

```bash
npm run demo:seed
```

It prints the tenancy's URL and the tenant's page. Open the tenancy and run the close-out: the agent reads the facts, cites the rules, and proposes the PayPal refund for approval. The tenant's page shows what the tenants see: the deposit paid, the agreement, the move-in photos and, once it is delivered, the statement.

What it needs:

- the dev server on `http://localhost:3210` (or set `DEMO_BASE_URL`);
- `.env.local` from the setup scripts above, including the sandbox tenant's login. The seed refuses to run when `PAYPAL_ENVIRONMENT` is `LIVE`;
- a Python with Playwright and Chromium (`pip install playwright && playwright install chromium`), which pays the invoice as the sandbox tenant and dates the receipt exhibits. If that Python is in a virtualenv, set `PLAYWRIGHT_PYTHON` to it in `.env.local` or the shell. The seed checks for the browser before it spends a Claude call.

The seed takes about three minutes. The sandbox checkout is driven by a headless browser; if PayPal's login page times out, the seed prints the invoice link: pay it in a browser as the sandbox tenant and run the same command again, and it continues from there.

What it costs: two Claude steps (reading the lease, then the inspection with one call per room) and one PayPal sandbox payment from the test tenant's fake balance. Everything else is deterministic code.

Dates: the records read like a tenancy that ran for a year. The move-in steps are dated the lease start, the notice the day it was given, and the move-out steps the move-out date. One date is PayPal's: it dates the sandbox payment the day the seed runs, so the statement says the deposit was paid that day. The move-out date defaults to that same day, so the 21-day clock starts then. With `--move-out` set to an earlier day, the statement shows the deposit paid after the tenants left; say so on camera, or seed on the day of the move-out.

Options:

| Command | What it does |
|---|---|
| `npm run demo:seed` | Builds the demo tenancy, or continues an unfinished one at the demo address (each finished step is skipped) |
| `npm run demo:seed -- --fresh` | Starts another demo tenancy even if an unfinished one exists |
| `npm run demo:seed -- --tenancy <id>` | Continues that tenancy |
| `npm run demo:seed -- --until inspect` | Stops before a step, to show it live. Steps: `lease`, `agreement`, `invoice`, `pay`, `move_in_photos`, `notice`, `move_out_date`, `move_out_photos`, `inspect`, `deductions`, `tenant_link` |
| `npm run demo:seed -- --move-out 2026-09-28` | Sets the move-out date (not in the future). Default: the day the seed runs |
| `npm run demo:reset -- <tenancyId>` | Removes one tenancy: its rows and its photos, receipts and lease PDF in storage. It refuses the original demo tenancy. PayPal sandbox records stay |

### The demo lease

`demo/lease-single-owner.pdf` (rendered from `demo/lease-single-owner.html` with `scripts/render_pdf.py`) is a fictional lease by one person who owns one rental, which is what makes the two-month cap apply:

- Rent $2,400, so the small-landlord cap is $4,800 (Civ. Code 1950.5(c)(5)).
- The lease asks a $4,800 deposit plus a $300 "nonrefundable" cleaning fee that "covers professional cleaning at the end of the tenancy". Everything charged at move-in counts as security, so the $5,100 total is $300 over the cap; no part of a deposit may be called nonrefundable (1950.5(n)); and professional cleaning can't be charged regardless of condition (1950.5(e)(2)(C)). The agent flags all three and invoices $4,800.
- A $120 late fee the lease lets the landlord take from the deposit, which gets a warning.
- The deposit is paid through PayPal, so the refund has to go back electronically, and by PayPal only with the tenants' written agreement (1950.5(h)(1)(A)). The tenants sign that agreement at move-in, so the written notice of the right to an electronic refund is not owed later, and the page says so.

The photos in `demo/photos` show a stained carpet and a few nail holes in the bedroom, a hole in the living room wall, and a grimy range and counter in the kitchen (credits in `demo/photos/CREDITS.md`). The inspection sorts what it sees into damage, cleaning and wear and tear; the nail holes come back as wear and tear and are never charged. The seed then deducts the carpet replacement prorated over its useful life ($1,800 invoice, 6 of 10 years used: $720), the drywall repair ($140) and three hours of the landlord's own cleaning of the range ($150), leaving $3,790 to return. Claude's reading varies a little from run to run: on the carpet it may say to try cleaning first, and the deduction then carries a note that spot cleaning did not lift the stain, which goes on the statement with the cost. A planned deduction whose finding the inspection did not make, or marked unclear, is skipped and named in the output, to add by hand. The receipts in `demo/receipts` are made up.

## Law

`docs/LEGAL_RULES.md` is the rule spec the code enforces: the deposit cap and the small-landlord exception, the photo requirements, wear and tear, the 21-day statement, the electronic-refund rule, the $125 documentation threshold, and the guardrails that keep the product to rules and facts. Its section E describes the demo scenario above.

# Hosting Deposit Agent on Vercel and Supabase

The steps, in order, to take the app from a laptop to a URL the judges can open. Nothing in this file has been run against a live project yet; it is the plan for the first deploy, written so each step is one screen.

## Before you start

- Accounts: GitHub (the repo goes public, with the MIT license in `LICENSE`), Vercel (Hobby), Supabase (free), PayPal Developer (sandbox), and the Anthropic console (an API key with a spend limit).
- **The app has no sign-in.** Hosted, every landlord page (`/units`, `/tenancy/<id>`, the statements) is open to anyone with the URL, and so are the routes that start a close-out and approve its refund. The only token-gated pages are the tenants' (`/t/<token>`). Host it with the fictional demo data only, never put a real tenant in it until a sign-in exists (a passcode check in a Next.js `proxy.ts` is enough for one landlord), and keep `PAYPAL_ENVIRONMENT=SANDBOX`: the close-out routes refuse `LIVE` for this reason (`src/lib/agent.ts`), so no stranger who finds the URL can move real money.
- The browser uploads and the long routes are already set up for Vercel's limits (steps 4.4 and 4.5), so there is no `vercel.json` to write.

## 1. Supabase

1. supabase.com > New project. Name `deposit-agent`, region **West US (North California)** (closest to the landlords and to Vercel's San Francisco region), a strong database password (the app never uses it; the API key does the work).
2. SQL Editor > New query. Paste `supabase/migrations/20261001203558_initial_schema.sql` and Run. Repeat for every file in `supabase/migrations`, in filename order (eleven files; the version prefix is the order). The SQL editor is the one path used here: the Supabase CLI's `db push` needs a `supabase/config.toml` the repo does not carry, and it records what it applied in a table the SQL editor does not, so mixing the two later re-applies files.
3. Check the result. Table Editor shows `properties`, `tenancies`, `photos`, `payments`, `audit_log`, `deductions`, `agent_runs` and `tenant_links`, every one with RLS enabled and no policies. Storage shows three buckets, `leases`, `photos` and `receipts`, all Private (the first and third migrations create them). Database > Functions shows `set_notice`, `remove_notice`, `set_tenant_move_out` and `create_tenant_link`, executable by `service_role` only.
4. Project Settings > API Keys > Secret keys: create one (or reveal the default) and copy it. That is `SUPABASE_SECRET_KEY` (it starts with `sb_secret_`). The Project URL on the same page (`https://<ref>.supabase.co`) is `SUPABASE_URL`. Never the publishable key: with RLS on and no policies it can read nothing, and the app would not work with it.
5. Storage settings: the default per-file upload limit (50 MB on the free plan) is far above what arrives; the browser sends photos at 2000 px, under 1 MB each.
6. Free-plan caveat: a free project **pauses after seven days without activity**, and a paused project makes every page fail. During judging either open the site a couple of times a week, restore the project from the dashboard before the judges look (it takes a minute or two), or move it to Pro ($25 a month) for that month.

## 2. PayPal sandbox

1. developer.paypal.com > Apps & Credentials > **Sandbox** tab > Create App (or open the default app). Copy the Client ID and the Secret: `PAYPAL_CLIENT_ID` and `PAYPAL_CLIENT_SECRET`. Set `PAYPAL_ENVIRONMENT=SANDBOX`.
2. In the app's Features, keep **Invoicing** and **Payouts** on (Payouts is a checkbox the sandbox grants at once). Refunds come with Accept payments. The Agent Toolkit uses these same credentials.
3. Testing Tools > Sandbox Accounts. The Business account is the app's merchant (created with the app). Create or open a **Personal** account: it plays the tenant who pays the invoice and receives the refund. Its email and password are `PAYPAL_SANDBOX_BUYER_EMAIL` and `PAYPAL_SANDBOX_BUYER_PASSWORD`, used by the demo seed on the laptop only; they never go to Vercel.
4. What the sandbox will not do: Payouts to a Venmo wallet are rejected ("Recipient wallet not supported in sandbox", found by `scripts/sandbox_smoke.py`), and the app has no Venmo rail anyway: refunds go to the tenant's PayPal account, as a refund of the original payment or a Payout to the email in the agreement. The sandbox dates a payment the day it is paid, so the demo's statement says the deposit was paid the day the seed ran.
5. No webhooks: the app reads the invoice from PayPal when a page loads and when the agent runs.
6. Going live is a separate decision, not part of the hackathon, and it is blocked until the landlord pages have a sign-in: the close-out start and approve routes accept any caller today, so `src/lib/agent.ts` refuses to start or approve a run when `PAYPAL_ENVIRONMENT=LIVE`. After the sign-in: a real Business account, Payouts enabled by PayPal's review, the guard removed on purpose, and real fees. The demo seed refuses to run against LIVE as well.

## 3. Anthropic

1. console.anthropic.com > API Keys > Create Key, named for the hosted app. That is `ANTHROPIC_API_KEY`.
2. Billing > Limits: set a **monthly spend limit** before the URL is public. With no sign-in, anyone who finds the URL can upload leases and start close-out runs, and each one spends this key; the limit is the ceiling on that. A full demo costs a few dollars (section 6), so $20 covers several full demos; set it at what the judging period needs and no more.
3. Optional: `ANTHROPIC_MODEL` switches all three Claude jobs (lease extraction, the photo inspection, the close-out agent) from `claude-opus-5-5` to another model. Opus is the one that tells wear and tear from damage well; change it only to cut cost.

## 4. Vercel

1. Push the repo to GitHub, public. vercel.com > Add New > Project > Import it. Framework preset: Next.js (detected). Root directory: the repo root. Build command: `next build` (default). In Project Settings > General, Node.js version **22** (Next.js 16 needs 20.9 or newer).
2. Settings > Environment Variables, for Production and Preview: `SUPABASE_URL`, `SUPABASE_SECRET_KEY`, `PAYPAL_ENVIRONMENT` (`SANDBOX`), `PAYPAL_CLIENT_ID`, `PAYPAL_CLIENT_SECRET`, `ANTHROPIC_API_KEY`, and `ANTHROPIC_MODEL` if you want it. Mark the secrets Sensitive. Do not add the sandbox buyer login, `PLAYWRIGHT_PYTHON` or `DEMO_BASE_URL`; they belong to the laptop.
3. Settings > Functions > Region: **San Francisco (sfo1)**, next to the Supabase project. The tenancy page makes a dozen database and signed-URL calls per load, so the region matters more than usual.
4. Durations. Each route declares its own `maxDuration` in seconds and Vercel reads it from the build: 60 for the lease check, photos, deductions and both statement PDFs; 300 for the inspection (one Claude call per room, rooms in parallel) and for the close-out start and approval (an agent run of up to twelve steps). With Fluid compute, the default on new projects, Hobby allows up to 300 seconds and Pro up to 800; check Vercel's current limits page. If the plan allows less than a route declares, the deploy fails naming the route; the fix is a lower number in that route or a plan change.
5. Request bodies. Vercel functions refuse a body over 4.5 MB. The app handles it in the browser (`src/lib/uploads.ts`): photos are downscaled to 2000 px on a canvas with the EXIF orientation applied and sent in batches under 4 MB; one deduction's receipt and after-repair photos are shrunk and checked against the same budget; and a lease PDF over that 4 MB budget is refused with a plain message before it is sent. Nothing to configure.
6. Deploy. The build log should end with the same route table as a local `next build`: `/` and `/_not-found` static, everything else marked dynamic. The runtime is Node.js on every route (`export const runtime = "nodejs"`); nothing runs on the Edge.
7. Settings > Deployment Protection: leave Production unprotected so the judges can open it without a Vercel login. Preview deployments can stay protected.
8. The Hobby plan is for non-commercial use; the hackathon entry qualifies.

## 5. After the first deploy: a ten-minute check

1. Open `https://<project>.vercel.app/`. The home page, with the browser console clean.
2. Check a lease with `demo/lease-single-owner.pdf` (one Claude call, under a minute): three violations and one warning, then Start this tenancy.
3. On the tenancy page: record the refund agreement with the sandbox personal account's email, send the PayPal invoice, open the pay link in a private window, pay as the sandbox tenant, refresh: Paid.
4. Or build the whole demo from the laptop against the hosted site: `DEMO_BASE_URL=https://<project>.vercel.app npm run demo:seed`. Playwright pays the invoice from the laptop; the hosted app does everything else, including the inspection.
5. `/units` lists the tenancy. The tenant link opens in a private window. The statement PDF downloads and opens.
6. Vercel > Logs: nothing that says `lease upload failed`, `inspection failed` or `close-out run failed`.

## 6. What it costs

- **Vercel Hobby:** free. **Supabase free:** 500 MB of database and 1 GB of storage, which the demo uses a fraction of, with the seven-day pause above; Pro is $25 a month if it should stay awake.
- **PayPal sandbox:** free, fake money. Live invoicing would cost 3.49% plus $0.49 per paid invoice and Payouts carry their own fee, which is why the pitch leans on Payouts for money out.
- **Anthropic:** the only metered cost. Three things spend: a lease check (one call with the PDF), an inspection (one call per room, each with that room's photos), and a close-out run (a tool-use conversation of up to twelve steps, run twice: up to the approval and after it). Each is cents to a dollar on Opus depending on the PDF and photo sizes; a full demo is a few dollars at most. Read the console's usage page after the first hosted run and set the spend limit from that.

## 7. Keeping it safe

- `.env.local` never leaves the laptop and is gitignored; Vercel holds the hosted secrets. There are no `NEXT_PUBLIC_` variables in this app, and the Supabase secret key must never become one: it bypasses row level security.
- To rotate a key: Supabase (API Keys > the key's menu), PayPal (the app's Secret > Generate new), Anthropic (revoke, create), then update the variable in Vercel and redeploy.
- Before any real tenant: a sign-in for the landlord pages, a privacy notice on the tenants' page, and only then the live PayPal decision in step 2.6. `PAYPAL_ENVIRONMENT=LIVE` must not be set before the sign-in exists; the close-out routes refuse it until then.

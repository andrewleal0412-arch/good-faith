# Hosting Good Faith on Vercel and Supabase

The steps, in order, to take the app from a laptop to a URL the judges can open. Nothing in this file has been run against a live project yet; it is the plan for the first deploy, written so each step is one screen.

## Before you start

- Accounts: GitHub (the repo goes public, with the MIT license in `LICENSE`), Vercel (Hobby), Supabase (free), PayPal Developer (sandbox), and the Anthropic console (an API key with a spend limit).
- **The hosted app sits behind an access code** (section 8): every landlord page and API route needs the session the `/access` page sets, and the Claude jobs and sandbox invoices have daily limits. The code is shared by the judges, so it is a demo gate, not a landlord sign-in: host the fictional demo data only, never a real tenant, and keep `PAYPAL_ENVIRONMENT=SANDBOX`. The close-out routes still refuse `LIVE` (`src/lib/agent.ts`). The tenants' pages (`/t/<token>`) stay open to their token, as before.
- The browser uploads and the long routes are already set up for Vercel's limits (steps 4.4 and 4.5), so there is no `vercel.json` to write.

## 1. Supabase

1. supabase.com > New project. Name `deposit-agent`, region **West US (North California)** (closest to the landlords and to Vercel's San Francisco region), a strong database password (the app never uses it; the API key does the work).
2. SQL Editor > New query. Paste `supabase/migrations/20261001203558_initial_schema.sql` and Run. Repeat for every file in `supabase/migrations`, in filename order (the version prefix is the order; the last two, `daily_usage_limits` and `usage_limits_tenancies_uploads`, add the daily limits of section 8). The SQL editor is the one path used here: the Supabase CLI's `db push` needs a `supabase/config.toml` the repo does not carry, and it records what it applied in a table the SQL editor does not, so mixing the two later re-applies files.
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
6. Going live is a separate decision, not part of the hackathon, and it is blocked until the landlord pages have a real sign-in (one account per landlord, not the shared demo code): `src/lib/agent.ts` refuses to start or approve a run when `PAYPAL_ENVIRONMENT=LIVE`. After the sign-in: a real Business account, Payouts enabled by PayPal's review, the guard removed on purpose, and real fees. The demo seed refuses to run against LIVE as well.

## 3. Anthropic

1. console.anthropic.com > API Keys > Create Key, named for the hosted app. That is `ANTHROPIC_API_KEY`.
2. Billing > Limits: set a **monthly spend limit** before the URL is public. Anyone with the access code can upload leases and start close-out runs, and each one spends this key. The app's daily limits (section 8) cap that per session and per day; the console limit is the ceiling behind them. A full demo costs a few dollars (section 6), so $20 covers several full demos; set it at what the judging period needs and no more.
3. Optional: `ANTHROPIC_MODEL` switches all three Claude jobs (lease extraction, the photo inspection, the close-out agent) from `claude-opus-5-5` to another model. Opus is the one that tells wear and tear from damage well; change it only to cut cost.

## 4. Vercel

1. Push the repo to GitHub, public. vercel.com > Add New > Project > Import it. Framework preset: Next.js (detected). Root directory: the repo root. Build command: `next build` (default). In Project Settings > General, Node.js version **22** (Next.js 16 needs 20.9 or newer).
2. Settings > Environment Variables, for Production and Preview: `SUPABASE_URL`, `SUPABASE_SECRET_KEY`, `PAYPAL_ENVIRONMENT` (`SANDBOX`), `PAYPAL_CLIENT_ID`, `PAYPAL_CLIENT_SECRET`, `ANTHROPIC_API_KEY`, `ANTHROPIC_MODEL` if you want it, and the access gate's `GOOD_FAITH_ACCESS_CODE`, `GOOD_FAITH_OWNER_CODE` and `GOOD_FAITH_SESSION_SECRET` (section 8). Mark the secrets Sensitive. Do not add the sandbox buyer login, `PLAYWRIGHT_PYTHON` or `DEMO_BASE_URL`; they belong to the laptop.
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
- Before any real tenant: a real sign-in for the landlord pages (the access code is one shared demo code), a privacy notice on the tenants' page, and only then the live PayPal decision in step 2.6. `PAYPAL_ENVIRONMENT=LIVE` must not be set before the sign-in exists; the close-out routes refuse it until then.

## 8. The access gate and the daily limits

The hosted demo is gated so an open URL can't spend the Anthropic key or flood the PayPal sandbox.

**The gate** (`src/proxy.ts`, `src/lib/session.ts`). Every page and API route needs a session, except `/access` and its form (`POST /api/access`, and `POST /api/access/sign-out`), the tenants' pages and their files (`/t/<token>`, `/api/t/<token>/...`, guarded by their token as before), Next's static files, and `GET /api/health`, which answers `{"ok":true}` and nothing else. A page without a session goes to `/access?next=<the page>`; an API call gets a 401 with a plain message. The right code sets a signed cookie, `gf_session`: HttpOnly, SameSite=Lax, Secure in production, seven days. It carries the kind of session (`owner` or `demo`), a session id (always `owner` for the owner, a new uuid for each demo sign-in) and its expiry, signed with HMAC-SHA256. Codes are compared in constant time. Wrong codes are limited in memory (`src/lib/access-throttle.ts`): 10 per 10 minutes from one address, and a ceiling of 200 per 10 minutes across every address. Once the ceiling is reached, an address that has itself been wrong in the window waits ("Too many tries"), but one that hasn't still gets its try, so a flood of wrong codes can't lock the judges out. A restart clears those counts, which is why the codes must be long and random. "Sign out" is in the account menu.

The address is read from a header the caller can't choose. On Render (it sets `RENDER` in the environment) that is `CF-Connecting-IP`, which Render's Cloudflare sets to the address that reached it; Render's `X-Forwarded-For` keeps whatever the caller sent as its first entry, so that entry is never used. Elsewhere the app takes the last `X-Forwarded-For` entry (the one the nearest proxy appended), or the header named in `GOOD_FAITH_CLIENT_IP_HEADER`.

Sessions can't be revoked one at a time: Sign out clears that browser's cookie, and a copied cookie stays valid until it expires. To end every session at once (a leaked cookie, a judge's code you want to retire), change `GOOD_FAITH_SESSION_SECRET` and restart; change the code too if the code itself leaked.

| Variable | What it does |
|---|---|
| `GOOD_FAITH_ACCESS_CODE` | The judges' code. Opens a demo session, with the daily limits below. |
| `GOOD_FAITH_OWNER_CODE` | Your code. Opens the owner session: no per-session limits, but it counts toward the day's totals. Ignored if it equals the judges' code. |
| `GOOD_FAITH_SESSION_SECRET` | Signs the session cookie; at least 32 characters (`openssl rand -base64 48`). Changing it signs everyone out. |
| `GOOD_FAITH_CLIENT_IP_HEADER` | Optional. The header that carries the caller's real address on a host other than Render (for example `x-real-ip` behind nginx). Leave it unset on Render. |

How it fails: with `GOOD_FAITH_ACCESS_CODE` unset outside production (`next dev`), the gate is off and every request is the owner, so local development works as before. Unset in production, or set with a missing or short secret anywhere, every gated page says "This demo is not configured" and every gated API call gets a 503: closed, never open.

Changing a code: the proxy runs on the Node.js runtime and reads these variables from the environment on each request; `next build` does not copy them into the bundle (checked on 16.3.8: a build made with one code, started with another, accepts only the second). So a new code or secret needs a restart of the service with the new environment, not a rebuild. Only `NODE_ENV` is fixed at build time.

**The daily limits** (`src/lib/limits.ts`, the `daily_usage` table and the `take_usage` function). Each Claude job, each sandbox invoice and each new tenancy takes one unit of the day's allowance (the Pacific day), and stored uploads take one unit per started megabyte, before Claude, PayPal or storage is called; the check and the count are one locked step in Postgres, so requests that arrive together can't go past a limit. A refusal is a 429 with "Today's demo limit for this is used up. Everything already prepared still works." A job that fails before anything was spent gets its unit back: a lease check or an inspection where Claude never answered (an overload, a bad key), a close-out that failed before the agent's first call, an invoice PayPal refused to create. Defaults, each changeable on the host:

| Variable | Default | Counts |
|---|---|---|
| `GOOD_FAITH_DAILY_LEASE` | 5 | Lease checks per demo session (one Claude call each) |
| `GOOD_FAITH_DAILY_INSPECT` | 3 | Move-out inspections per demo session (one Claude call per room) |
| `GOOD_FAITH_DAILY_CLOSE_OUT` | 4 | Close-out agent runs per demo session (the approval that resumes a run is part of it) |
| `GOOD_FAITH_DAILY_INVOICE` | 5 | PayPal sandbox deposit invoices per demo session |
| `GOOD_FAITH_DAILY_TENANCY` | 10 | New tenancies per demo session |
| `GOOD_FAITH_DAILY_UPLOAD_MB` | 100 | Megabytes of photos, receipts and after-repair photos stored per demo session |
| `GOOD_FAITH_DAILY_AI_TOTAL` | 150 | Claude jobs per day across every session, the owner's included |
| `GOOD_FAITH_DAILY_INVOICE_TOTAL` | 100 | Sandbox invoices per day across every session |
| `GOOD_FAITH_DAILY_TENANCY_TOTAL` | 50 | New tenancies per day across every session |
| `GOOD_FAITH_DAILY_UPLOAD_MB_TOTAL` | 400 | Megabytes of uploads stored per day across every session (lease PDFs are bounded by the lease limit instead) |
| `GOOD_FAITH_INSPECT_ROOMS` | 6 | Rooms one inspection compares; more is refused before any call |
| `GOOD_FAITH_INSPECT_PHOTOS` | 6 | Photos per room and phase an inspection sends (the first ones taken) |

A new demo sign-in is a new session with fresh per-session limits, so the per-session limits are soft and the day's totals are the real ceiling, with the Anthropic console's spend limit (section 3) behind them. A unit is a job, not a Claude call: a lease check is one call, an inspection one call per room (up to 6), a close-out run up to twelve agent steps plus the steps after the approval. So 150 jobs can be several hundred calls. For the judging window, set `GOOD_FAITH_DAILY_AI_TOTAL` to what a day of judging needs (for example 40) and the console's limit to match. The free Supabase plan holds 1 GB of storage; the upload totals keep a day under that, but check Storage's usage now and then while the URL is public.

**Uploads** are checked on the server whatever the browser did: at most 4 MB per file and per request (the proxy answers a declared body over 4.5 MB with a plain 413 once Next has received it, keeping at most 5 MB in memory; a body sent without a `Content-Length` is cut at 5 MB and the route refuses it as unreadable), 20 photos per request, 10 after-repair photos and one receipt per deduction, 120 photos per tenancy, and every file is identified by its first bytes: JPEG, PNG, GIF or WebP for photos (and sharp must read it as the same format), PDF for leases, PDF or a photo for receipts. HEIC is refused, as before; the browser converts what it can decode.

**Headers** (`next.config.ts`): `X-Content-Type-Options: nosniff`, `Referrer-Policy: strict-origin-when-cross-origin` (`no-referrer` on the tenants' pages), `X-Frame-Options: DENY` with `Content-Security-Policy: frame-ancestors 'none'`, and `Strict-Transport-Security` in production.

**On Render:** set the health check path to `/api/health`. API writes (POST, PATCH, DELETE) whose `Origin` names another host than the request's `X-Forwarded-Host` (when the host's proxy sets it) or `Host` are refused with a 403, so a page on another site can't act with a judge's session; Render passes the public host through, but if every save on a new host fails with "That request came from another site", the proxy in front is rewriting `Host`. One instance keeps the wrong-code counts in one place; with more than one, each counts its own. After the first deploy, check that the throttle sees the real address: send eleven wrong codes, each with a different made-up `X-Forwarded-For` (`curl -X POST https://<host>/api/access -H 'Content-Type: application/json' -H 'X-Forwarded-For: 203.0.113.<n>' -d '{"code":"wrong"}'`). The eleventh must answer 429 "Too many tries" (that address, yours, then waits ten minutes, so sign in first); if every one answers 401, the header the app trusts is not the one Render sets, and `GOOD_FAITH_CLIENT_IP_HEADER` needs the right name. To seed the demo against the hosted copy from the laptop: `DEMO_BASE_URL=https://<host> DEMO_ACCESS_CODE=<the owner code> npm run demo:seed`.

**Checking a production build locally:** build in a worktree (see the README's Checks), then start it with test codes on the command line, not in `.env.local`, so local dev stays open: `GOOD_FAITH_ACCESS_CODE=<test> GOOD_FAITH_OWNER_CODE=<test> GOOD_FAITH_SESSION_SECRET=<32+ chars> npx next start -p 3211`.

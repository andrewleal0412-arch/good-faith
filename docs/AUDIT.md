# Audit before judging

A whole-app check on 2026-10-05, at commit `417664d` plus the fixes listed under [Fixed](#fixed) and [Fixed after review](#fixed-after-review). Every page was opened at desktop and phone width in two places: the owner workspace and a private demo copy like the one a judge gets. The repository was also checked for what it would expose once public. Nothing here is legal advice; the audit covers the software only.

## How it was checked

**Check scripts.** All pass at `417664d` and again with the fixes:

| Script | Result |
|---|---|
| `npx tsc --noEmit` | clean |
| `npx eslint src --max-warnings=0` | clean |
| `node scripts/ca-snapshot.mjs` | identical, 17 sections |
| `node scripts/state-packs-check.mjs` | 256 passed |
| `node scripts/lawful-range-check.mjs` | 147 passed |
| `node scripts/negotiation-check.mjs` | 126 passed (131 with the review's settlement cases) |
| `node scripts/paypal-webhook-check.mjs` | 168 passed |
| `node scripts/grid-check.mjs` | 70 passed |
| `node scripts/chargeback-check.mjs` | 121 passed |
| `next build` in a temporary worktree | passed |

**Two places.**
- *Owner workspace*: the dev server on port 3210 with the access gate off. It holds the three template tenancies, opened read only.
- *Demo copy*: a production build (`next start` on port 3211) with throwaway gate codes. The copy was made by the app's own `copy_demo_template` and `copy_demo_history`, its tenant links were re-keyed as `createDemoCopy` does, and a demo session for it was signed locally. This spends none of the hosted demo's daily copies and no pre-paid deposit. Without a pool deposit, the move-out unit's Review refund page shows "Today's sandbox deposits for the demo are used up". The copy was swept afterwards.

**Each page**, at 1440 x 900 and at 390 x 844 (2x), was checked for:
- the response status and any redirect;
- console errors, page errors and failed requests;
- sideways scroll, and the elements that cause it;
- axe-core's WCAG 2 A and AA rules;
- text that shouldn't be there: em dashes, emoji, `undefined`, `NaN`, `Invalid Date`, `[object Object]`, a stray `null`, and the old "California security deposits" line.

Every page also got a full-page screenshot. The crawl started from every sidebar page, every tab of every unit, every statement, refund, tenant and dispute page and every ledger view, then followed each internal link it found. A link to a file (statement PDF, calendar `.ics`, tenant photo, signed storage link) was fetched and its type checked.

**By hand in the browser** (production build, demo session; every drawer cancelled, nothing saved):
- the bell, Help and account menus, and Cmd+K search with Enter;
- Add property, a Why? popover and the Slider view;
- Add finding, the deductions row menu and the statement's Record delivery;
- the Payments details panel and its CSV, and the Insights state filter;
- on a phone: the navigation drawer, search, and the deduction Edit drawer.

**Scoping and the gate.** These requests were sent from the demo session. Each one either only reads, or carries a body the route refuses anyway, so nothing could change even if a guard were missing:
- **Another workspace's tenancy.** A template, and another visitor's copy: their PDF, calendar and PayPal dispute view, a deduction PATCH and a tenancy PATCH. All got 404.
- **A cross-site POST.** 403.
- **The API without a session.** 401.
- **A tenant token asking for another tenancy's photo.** 404.
- **A statement PDF before delivery.** 404.
- **A bad token.** 404.

The tenants' page opens without a session, as designed.

**Links outside the app.** The app links to 10 deposit guides and statutes and to PayPal's site, and the docs cite 258 sources. Each was fetched with a browser user agent.

**The repository.**
- **Secrets.** Every blob in all 41 commits (868 blobs) and every commit message was searched for two things, and no value was printed:
  - the exact value (and its base64) of each of the 11 variables in `.env.local` and `.env.render`;
  - common key patterns: Anthropic, Supabase secret and publishable keys, JWTs, AWS, GitHub, Slack, Google, PEM private keys, PayPal access tokens, Bearer tokens, database URLs with a password, and password assignments.
- **Files.** Every path ever committed was checked for env files, keys, certificates and databases.
- **People.** Emails, names and addresses were searched for.
- **Environment.** `.env.example` was compared with every variable the code reads.
- **Dependencies.** `npm audit --omit=dev`.

## Pages

Every page below returned what it should at both widths, with no console or page errors, no failed requests, no sideways scroll, no axe violations and no flagged text, unless the last column says otherwise.

| Route | Opened | Found |
|---|---|---|
| `/` | owner, demo | Goes to `/units` |
| `/units`, `?filter=move-out`, `?filter=closed` | owner, demo | Deposits held, refunded and deducted agree with Payments and Insights (demo copy: $6,650 held, $2,060 returned with the $270 settlement, $740 kept) |
| `/tenants` | owner, demo | Nothing |
| `/ledger`, the views `deposits`, `refunds`, `settlements`, `deductions`, `requests`, `paypal`, and `?tenancy=` for each unit | owner, demo | Details panel opens on a click; the CSV has every row shown (5) |
| `/insights` | owner, demo | Collected $9,450 = held $6,650 + returned $2,060 + kept $740 (demo copy); Texas filter narrows the figures to $1,850 |
| `/documents` | owner, demo | Nothing |
| `/lease` | owner, demo | Not run (a Claude call); the page and its state note load |
| `/move-outs`, `?view=closed` | owner, demo | Nothing |
| `/tenancy/[id]`, tabs Overview, Move-out, Payments, Documents, Tenants, for each of the three units | owner, demo | Nothing |
| `/tenancy/[id]/statement` (three units) | owner, demo | The closed unit's is the amended statement; the PDF links answer with a PDF |
| `/tenancy/[id]/refund` (three units) | owner, demo | Refund sent on the closed unit; Review refund on the others, with Prepare refund off in a copy without its own deposit, as designed |
| `/tenancy/[id]/notices/[kind]`: `inspection`, `electronic-refund` (California), `forwarding-address` (Texas) | owner, demo | Nothing. New York, Florida and Washington records aren't reachable from the demo data; `state-packs-check` covers them |
| `/t/[token]` (three units) | demo | Photos and the statement PDF answer; no PDF before delivery |
| `/t/[token]/dispute` (three units) | demo | Settled dispute on the closed unit; "A dispute opens once ... has sent the itemized statement" on the others |
| `/access` | demo (no session), owner | Fixed: the old California-only line. No session sends a page here and an API call gets 401 |
| Not found: `/nope`, an unknown tenancy, another workspace's tenancy, a bad tenant token | owner, demo | 404 with the not-found page. Under `next dev` only, React's performance track logs "cannot have a negative time stamp" on the not-found tenancy and tenant pages; the production build doesn't |
| `error.tsx` (landlord and global) | | Not triggered: no page failed |

## API routes

| Route | Methods | How it was covered |
|---|---|---|
| `/api/health` | GET | 200 locally and on the hosted demo |
| `/api/access`, `/api/access/sign-out`, `/api/access/start-over` | POST | Sign-out refuses GET (405). The access form posts to the gate, which `/access` shows; the session was minted locally instead of entering a code |
| `/api/paypal/webhook` | POST | Locally 503 because `PAYPAL_WEBHOOK_ID` isn't in `.env.local` (as documented). On the hosted demo an unsigned POST got 400, which is past the webhook id check, so the id is set there. `paypal-webhook-check` covers the rest |
| `/api/tenancies/[id]/calendar`, `/statement/pdf`, `/api/t/[token]/photos/[photoId]`, `/api/t/[token]/statement.pdf` | GET | Fetched from every page that links them: `text/calendar` and `application/pdf` with a body, photos as JPEG; other workspaces get 404 |
| `/api/tenancies/[id]/paypal-dispute`, `/api/tenancies/[id]/dispute`, `/api/t/[token]/dispute` | GET (and POST) | Read by the pages; another workspace gets 404; `chargeback-check` and `negotiation-check` cover the writes |
| `/api/tenancies/[id]/deductions`, `/deductions/[did]` | POST, PATCH, DELETE | `grid-check` (the route and the grid agree on every edit, and the lock); another workspace's PATCH gets 404 |
| `/api/lease`, `/inspect`, `/close-out`, `/close-out/[runId]`, `/api/t/[token]/dispute/advocate`, `/dispute/negotiate` | POST | Not run: each is a Claude job. The stubbed checks cover their bounds |
| `/deposit-invoice`, `/dispute/settle`, `/paypal-dispute` POST | POST | Not run: each writes to PayPal. Covered by earlier rounds' sandbox runs and the stubbed checks |
| `/api/tenancies`, `/[id]` PATCH, `/agreement`, `/photos`, `/findings`, `/notice`, `/notices/[kind]`, `/tenant-link`, `/statement/delivery`, the tenants' `moving-out`, `dispute`, `evidence`, `offer`, `accept`, `send`, `withdraw` | POST, PATCH, DELETE | Not run against the templates or the copy; cross-site and other-workspace requests are refused |

## Fixed

| What | Where |
|---|---|
| The access page and the site description still said "California security deposits"; the app runs five states. Now "Security deposits from move-in to refund in five states, with PayPal." and the five named in the description | `src/app/access/page.tsx`, `src/app/layout.tsx`; the known-gap line in `docs/rules/README.md` removed |
| The README opened as a California-only product. It now names the five states, the disputes and the chargebacks; The problem points to States; the disclaimer note says each state has its own; the negotiator's limit is per browser (Start over keeps the session), not per copy | `README.md` |
| Two README screenshots predated Insights (the sidebar had no Insights) and the settled dispute. Retaken from a demo copy on the production build, same size as the others | `docs/screenshots/inspection.png`, `statement.png` |
| DEPLOY said nothing had run against a live host and that the service is on Starter. The hosted demo is live on the free plan; the steps now say so and when to move to Starter | `docs/DEPLOY.md` |
| A cited source was gone (Broward County's copy of Laws of Fla. ch. 2023-314, 404). Now the official text | `docs/rules/FL.md` |
| `.env.example` lacked two variables the code reads and DEPLOY documents | `.env.example`: `GOOD_FAITH_DAILY_ADVOCATE`, `GOOD_FAITH_DAILY_TENANT_UPLOAD_MB` |
| `public/` held create-next-app's five sample SVGs, used nowhere | removed |

## Fixed after review

A review of the audit found these; each was checked against the code first. The changed pages were opened again at both widths in the owner workspace (dev server) and in a fresh demo copy on a production build (no console errors, no sideways scroll), the demo crawl was run again over every route (114 loads, axe clean; only the deliberate not-found pages answer 404), and the copy was swept afterwards. No Claude call, no PayPal write.

| What | Where |
|---|---|
| A settlement could send more than the deposit still held. Its amount is bounded by the deductions, which know nothing of money PayPal already returned through the tenants' PayPal dispute: on a $4,800 deposit with the $3,790 refund and a $500 PayPal dispute refund, an agreed $800 would have gone out as a Payout although only $510 was left. Now the settlement is refused with the reason and nothing is sent; the pages already showed the same ceiling | `src/lib/settlement.ts`, `settlementRoom` in `src/lib/refund-rail.ts`; cases in `negotiation-check` |
| The tenants' daily advocate runs and dispute-photo megabytes were counted per tenant link, so Make a new link started a fresh count. They are counted per tenancy now. On the production build, with the tenancy's count used up, the advocate answered 429 on the old link and again on a new one, before any Claude call | `src/lib/limits.ts`, the two `/api/t/[token]/dispute` routes; `.env.example`, `docs/DEPLOY.md`, README |
| The closed unit listed its initial-inspection notice as "Not due yet" after the move-out. A notice never recorded once the tenants moved out now reads "Not recorded", on Documents and on the property's Documents tab; Documents also shows New York's excused inspection notice as "Not needed", as the tab did | `src/app/(landlord)/documents/page.tsx`, `tenancy/[id]/page.tsx` |
| The lease check showed California's three law cards under "For properties in" five states before any lease was read. They are now labeled "California rules, until a lease's state is read" (or the lease's state), and the electronic-refund line no longer merges two rules: "Since 2026; PayPal with written consent" | `src/app/(landlord)/lease/lease-check.tsx`, `src/lib/states/ca.ts` |
| The notice drafts printed "for a October 4, 2026 move-out" | California's two drafts, New York's inspection-rights notice (`src/lib/states/ny.ts`) |
| The tenants' no-agreement text gave one small-claims limit, $12,500, for either side. Code Civ. Proc. 116.221's $12,500 is for a natural person; 116.220 caps any other plaintiff, such as a landlord's LLC, at $6,250, and 1950.5(o) cites both | `src/lib/states/ca.server.ts`, `docs/LEGAL_RULES.md` section D |
| The Payments tab's "Deductions $740.00" on the settled unit disagreed with the statement's $1,010.00. It reads "Deductions as settled", as the amended statement does, with "$1,010.00 less $270.00 settled" under it | `src/app/(landlord)/tenancy/[id]/money.tsx` |
| The rules chip dated AB 414 to 2026; it is Stats. 2025, effective January 1, 2026 | `src/lib/states/ca.ts` |
| Next's own error pages sent `x-powered-by: Next.js` | `next.config.ts` (`poweredByHeader: false`) |
| The package was still create-next-app's `web` | `package.json`, `package-lock.json`: `good-faith` |

## Found, not changed

- **Dependency advisories.** `npm audit --omit=dev` lists 10 (5 high), all inside `@paypal/agent-toolkit` 1.11.0's own dependencies: `@langchain/core`, `langsmith`, `jsondiffpatch`, the toolkit's nested `ai` 4.x, `mathjs` and `uuid`. npm's only fix for most of them is downgrading the toolkit to 1.3.5, a breaking change. npm lists a non-breaking fix for `mathjs` alone (`npm audit fix`), but it changes nothing: checked on 2026-10-07, the toolkit asks for `mathjs` `^14.0.1` and the first fixed release is 15.2.0, so only an `overrides` entry or a new toolkit would move it. They were left alone this late. GitHub's Dependabot will list them once the repository is public.
- **Links a script can't check.** These answer 403 to scripts (bot protection), so open them by hand once:
  - nysenate.gov, the New York pack's statute link and most of NY.md's sources;
  - justia, findlaw, hcr.ny.gov, nycourts.gov, legiscan, amlegal, codepublishing and the Florida Bar PDF.

  Two more timed out after the burst of requests: leginfo.legislature.ca.gov (it answered 200 earlier in the same run) and floridataxwatch.org. The app's other outside links (9 guides and statutes, PayPal's live and sandbox sites) answered 200, and so did 199 of the docs' 258.
- **No pool deposit in the audit copy.** It was made without one on purpose. The pool has 1 ready deposit (see below).
- **Signing out doesn't revoke a session.** The session is a signed cookie with no server record, so a copied cookie keeps opening its copy for up to seven days; rotating `GOOD_FAITH_SESSION_SECRET` signs everyone out (DEPLOY, section 8). Shorter sessions would cost a judge their copy between days, so it was left.
- **Template ids in signed photo links.** A demo copy's landlord pages show the templates' photos through one-hour signed storage links that name the template tenancies and the owner workspace. From a demo session those ids answer 404 everywhere, writes included; the tenants' pages go through their own photo route.
- **Demo data a careful judge may notice** (the templates are read only in these rounds, so nothing was changed): Luke Jones and Camila Reyes show the same sandbox PayPal email, the one sandbox buyer account that pays the deposits; the move-out unit opens at "Review findings" because its kitchen countertop finding is still Suggested; the Texas deposit is dated after its notice (the README explains why).
- **`CLAUDE.md` stays.** It holds only `@AGENTS.md`, which loads the Next.js notes into Claude Code sessions in this repository.

## Before the repository goes public

The counts in this section are as of 2026-10-05. The current ones are in the README. Nothing in this list was changed by the audit; the later pass is [PUBLIC_REPO_CHECK.md](PUBLIC_REPO_CHECK.md).

1. **No secrets in the history.** No value from `.env.local` or `.env.render`, and no key or token pattern, appears in any commit or commit message, and no env, key or database file was ever committed. Nothing needs rotating because of the history.
   - The Supabase project's URL is in one old version of `scripts/setup-supabase.sh` (commit `347668a`). It is not a secret: the URL is public by design, and with row level security on and no policies, only the secret key reads anything.
   - Sandbox PayPal ids (invoices, captures, refunds, disputes, the webhook id) appear in the docs and fixtures. They are sandbox-only and not credentials.
   - The scan knew only today's values and the key patterns. If a PayPal or Anthropic key was rotated during the build, search the history once for the old value (a PayPal client secret has no prefix a pattern could catch).
2. **Andrew's personal email address is the author on all 41 commits** and becomes public with the repository. To keep it off new commits, set GitHub's noreply address. Rewriting the existing ones changes every hash and needs a force push to `main`, which Render deploys from. Or keep it as is.
3. **`PLAN.md` is the internal plan from 2026-10-01.** It holds Andrew's schedule (midterms, filming at home, another competition's close date), an Obsidian note path, and a stale stack (SQLite, the name still open). Delete it, or move it out of the repository, before going public. It stays in the history, which holds nothing sensitive.
4. **Demo addresses use real street names.** The people, companies and 555 numbers are fictional (`demo/photos/CREDITS.md` says so). The streets are real ones in Orange, Santa Ana and Austin (E. Chapman Ave, N. Glassell St, W. Cedar St, Mesquite Bend Dr), so a house number could match a real building. This is optional to change; check it before filming if it matters.
5. **README: "Demo video: [to be added before submission]".**
6. **Before judging:**
   - Move Render to Starter (`plan: starter` in `render.yaml`), since the free plan sleeps.
   - Top up the pool: `npm run demo:pool -- --fill N`. It had 1 ready deposit on 2026-10-05.
   - Set `GOOD_FAITH_DAILY_COPIES` (15 to 20) and `GOOD_FAITH_DAILY_AI_TOTAL` on Render (DEPLOY, section 4.4).
   - Keep the Supabase project awake (DEPLOY, section 1.6).
   - The hosted demo shows the old tagline until these fixes are pushed.
7. **To make it public:** GitHub > the repository > Settings > General > Danger Zone > Change visibility. Then turn on secret scanning and push protection (Settings > Code security), which are free for public repositories.

`LICENSE` (MIT, Andrew Leal, 2026) matches `package.json` and the README. The demo photos are Pexels-licensed with credits; the leases and invoices are made up.

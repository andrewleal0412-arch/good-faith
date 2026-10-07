# Performance

Andrew, 2026-10-05: "the site is slow, it takes forever to go from tab to tab; it should be responsive." This is what was measured, what changed, the numbers before and after for every route, and what Render's Starter plan would add. `README.md` has the architecture and `docs/DEPLOY.md` the hosting.

## The short version

- **A property's tabs switch in 13 to 26 ms, and an inspected unit's Move-out in 75 to 95 ms** (its deductions grid is built again each time it opens; slowest 163 ms), medians at 4x CPU slowdown, with no request to the server. They took 200 to 1,500 ms (Payments 1.1 to 1.5 s, waiting on PayPal), and 0.4 to 1.9 s on the hosted demo.
- **Every click answers in the next frame.** The sidebar shows the next page's skeleton within 10 to 26 ms (it showed nothing for 200 to 630 ms locally, 0.4 to 2.5 s on the hosted demo), and the page's content lands 30 to 60 percent sooner. Opening a property, its statement or the refund review answers the same way; the statement and the refund review still take about a second to fill, because they ask PayPal before they show anything (see Common clicks).
- **A page view costs the server 60 to 90 percent less.** Each page used to start 13 to 25 prefetches (Next.js prefetches every link it shows), which together cost the server 100 to 150 ms of CPU locally, over a second of the free plan's tenth of a CPU, right when the next click needed it. No link is prefetched now.
- **A full load paints in 50 to 100 ms for the sidebar pages and 200 to 360 ms for a property** (the shell and the page's skeleton stream first), instead of 470 to 1,570 ms.
- Nothing is cached between requests or between workspaces, and a change shows at once (`scripts/cache-check.mjs`).
- **Move to Starter before judging.** The free plan sleeps after 15 minutes (a judge's first page waited 6 to 11 s on 2026-10-05), and its CPU is a fifth of Starter's. The estimates are at the end.
- **Part 2 (2026-10-07):** the statement and the refund review show their own content in 0.4 to 0.5 s instead of after PayPal's answer (about 1 s), photo grids load 6 to 10 kB thumbnails instead of the photos (the statement 1.75 MB to 77 kB), every AG Grid page loads 57 kB less JavaScript, a property opened again within a minute doesn't wait on PayPal, and Insights draws its grid 140 ms sooner on a click. See Speed, part 2.

## How it was measured

- **Local production build** (`next build`, `next start` on port 3211) of the code before (commit `ac311ca`) and after, the same afternoon, against the shared Supabase project, with a throwaway demo copy (the three template units, no pool deposit) and a locally signed demo session. The laptop is about 100 ms from Supabase per round trip, against an estimated 25 ms from Render's Oregon region, so database waits weigh more here than on the hosted demo.
- **Chrome through Playwright with its CPU slowed 4x**, to stand in for a mid-range phone or laptop, at 1440 and 390 px. A click's *feedback* is the first animation frame that shows it was heard (the link marked current, a skeleton, the page changed); its *content* is the first frame with the destination's own content and no skeleton left. Both are counted from the click event's own time (`event.timeStamp`); the sidebar's and tabs' "after" figures were measured again that way after the review's fixes (the first pass counted from the page's click listener, a few ms later). Sidebar: Properties, Tenants, Payments, Insights, Documents, Lease check, Move-outs, three rounds. Tabs: Overview, Move-out, Payments, Documents, Tenants on each of the three units, three rounds. Full loads: every route in a fresh browser, twice.
- **The server's own CPU time** per request (`ps` on the server process, eight requests per route) and per page view in a browser (everything the page made the server do until the network went quiet, prefetches included).
- **The hosted demo before**, read-only: signed in with the owner's code, GET requests only, nothing changed (2026-10-05, 15:00 Pacific, free plan).
- No app-level Claude calls and no PayPal writes. The property pages read PayPal's invoice as they always do.

## What was slow, and what changed

| Finding | Change | Where |
|---|---|---|
| Every tab of a property was a full server round trip: the header's reads, the shell's and the tab's, rendered again, about 0.9 s on the hosted demo. Payments also waited on PayPal's invoice. | All five tabs come in one response. The tab the address names is in the HTML; the others are in the page's data, laid out by React at idle priority while hidden (`Activity`), and shown on a click with `history.replaceState`: the address stays shareable, and a property is one entry in the browser's history, so Back leaves it and coming back opens the tab it was left on. (Not `pushState`: Next's router copies its current tree into each entry pushed that way and `router.refresh()` renews only the current one, so after a change, Back to an older tab entry and then Back again from another page left the property on its skeleton until a reload.) Payments' PayPal read streams in after the rest, so the page never waits for it. After a change, `router.refresh()` renders every tab again from the database, as before. A hidden tab keeps its state, and its effects run again when it is shown. AG Grid's React component destroys its grid when its tab is hidden and, on the way back, builds it from the props it had when it first mounted, so the deductions grid is mounted anew each time Move-out is shown (`WhileShown`), from the rows as they are then; that rebuild is most of the Move-out tab's time below. | `src/app/(landlord)/tenancy/[id]/page.tsx`, `tab-state.tsx`, `deductions-grid.tsx` |
| Every page view started 13 to 25 prefetches, one or two per link in view, each a small server render: about 150 ms of CPU locally per page view, 1.5 s on the free plan's CPU. | No link prefetches (`src/components/link.tsx`, every in-app link). A prefetch could only ever bring a page's skeleton, which the shell draws itself. | `src/components/link.tsx` |
| A click showed nothing until the server answered. | The shell draws the destination's skeleton in the frame of the click (or of Enter in the search box) and marks the sidebar item; a filter on the same page (Properties' status filter) dims it; the refund review's skeleton covers the page. The page then streams into one Suspense boundary in the landlord layout that stays mounted, so it replaces the skeleton the moment it is ready: per-route `loading.tsx` files would mount a fresh boundary on each click, and React holds a fallback for at least 300 ms once it has shown one, which delayed the content locally by up to 200 ms. Full loads stream the shell and the skeleton first. An address that answers 404 (another workspace's tenancy, a notice the state doesn't have) is checked before anything is sent, so it keeps its status. | `src/components/app-shell.tsx`, `skeletons.tsx`, `skeleton-route.tsx`, `route-skeleton.tsx`, `src/app/(landlord)/layout.tsx`, `src/proxy.ts`, `src/lib/page-path.ts` |
| A page made 15 to 20 Supabase requests in two or three waves, several twice: the units' six tables, the dispute's facts three times on Move-out, the dispute row twice, the tenant link twice, the deposit invoice again for the pool check. | The workspace's tenancies and every row under them in one embedded read per request, shared by the shell, the page, the ledger and the thumbnails (`workspaceTenancies`, React `cache()`); a property's own rows embedded in its read; the dispute's facts built from those rows; the dispute and the tenant link read once; columns named instead of `*` where a page reads few; the Payments ledger's webhook details only on Payments. | `src/lib/units.ts`, `ledger-load.ts`, `disputes.ts` (`factsFrom`), `negotiation.ts`, `tenant-links.ts` (`tenantLinkView`), `notice-page.ts` |
| Node's fetch closes an idle connection after 4 s, so the first click after reading a page opened about a dozen TLS connections again: 840 ms and 100 ms of CPU for one page's reads locally, against 360 to 570 ms and 45 to 55 ms on kept connections. | One keep-alive pool for Supabase and PayPal (a minute). Inside the server it goes over undici's own fetch, which also skips Next's per-call bookkeeping (a few percent of a page's server time); anywhere the global fetch isn't Next's (a check script, or a check script's stand-in for PayPal or Supabase, whenever it was put in place), the global fetch is called, so a test never reaches the real service. | `src/lib/http.ts`, `db.ts`, `paypal.ts` |
| Node gzipped every page, payload and script on the small CPU. | `compress: false`: Render's Cloudflare edge compresses every response itself (Brotli or gzip, as the browser asks; checked on the live host). | `next.config.ts`, `docs/DEPLOY.md` section 4, step 9 |
| Date and money formatting built a new `Intl` formatter on every call, the app's own biggest server cost in a CPU profile of the build before (a page formats hundreds of dates). | The formatters are made once. Same output: the California snapshot is identical. | `src/lib/dates.ts`, `deductions.ts`, `states/common.ts`, `components/ui.tsx` |
| The bare address `/` redirected to `/units`, about 1 s on the hosted demo. | `/` renders Properties itself. | `src/app/(landlord)/page.tsx` |
| AG Grid (326 kB gzipped) was in every property page's first JavaScript. | The deductions grid loads with its card (`React.lazy`), with the grid's rows held in gray at their own heights meanwhile; a property that hasn't been inspected never loads it (Texas unit: 539 to 221 kB). Insights already loaded its charts this way. | `src/app/(landlord)/tenancy/[id]/settlement.tsx` |
| Photos in hidden tabs would download with the page. | Every photo is `loading="lazy"` and `decoding="async"`, except the statement's, which must be there when it is printed. | `photo-compare.tsx`, `move-in-steps.tsx`, `dispute.tsx`, `ui.tsx` (`Thumb`), tenant pages |

## The numbers

### Clicks (Chrome at 4x CPU slowdown, median of 3 rounds)

**Sidebar, 1440 px**

| Tab | Feedback before | Feedback after | Content before | Content after |
|---|---:|---:|---:|---:|
| Properties | 435 ms | 14 ms | 435 ms | 185 ms |
| Tenants | 217 ms | 12 ms | 217 ms | 122 ms |
| Payments | 626 ms | 15 ms | 681 ms | 230 ms |
| Insights | 351 ms | 26 ms | 556 ms | 348 ms |
| Documents | 215 ms | 16 ms | 215 ms | 136 ms |
| Lease check | 18 ms | 10 ms | 18 ms | 27 ms |
| Move-outs | 258 ms | 12 ms | 258 ms | 129 ms |

The first visit to Payments in a session took 579 ms (its grid's code and a 300 ms task building it); later visits 216 to 230 ms.

**Sidebar, 390 px** (through the navigation drawer)

| Tab | Feedback before | Feedback after | Content before | Content after |
|---|---:|---:|---:|---:|
| Properties | 431 ms | 17 ms | 431 ms | 200 ms |
| Tenants | 216 ms | 12 ms | 216 ms | 122 ms |
| Payments | 345 ms | 14 ms | 406 ms | 252 ms |
| Insights | 364 ms | 15 ms | 535 ms | 350 ms |
| Documents | 216 ms | 14 ms | 216 ms | 150 ms |
| Lease check | 23 ms | 11 ms | 23 ms | 28 ms |
| Move-outs | 268 ms | 11 ms | 268 ms | 148 ms |

**A property's tabs** (all three demo units, three rounds: nine clicks per tab and width; feedback and content are the same frame now, and no tab click sends a request)

| Tab | 1440 before | 1440 after | 390 before | 390 after |
|---|---:|---:|---:|---:|
| Overview | 220 ms (slowest 647) | 17 ms (slowest 23) | 230 ms (326) | 16 ms (20) |
| Move-out | 392 ms (760) | 75 ms (163) | 394 ms (740) | 66 ms (120) |
| Payments | 1,306 ms (1,523) | 26 ms (180) | 1,071 ms (1,511) | 21 ms (29) |
| Documents | 202 ms (278) | 14 ms (17) | 206 ms (402) | 13 ms (20) |
| Tenants | 242 ms (337) | 14 ms (17) | 246 ms (675) | 13 ms (15) |

Move-out is the one tab with real work on the click: on the two inspected units the deductions grid is built again each time the tab opens (median 75 to 94 ms at 1440, 73 to 84 ms at 390, one long task of 60 to 160 ms, the first opening the slowest), since AG Grid destroys its grid while its tab is hidden; on the Texas unit, which has no grid yet, Move-out takes 15 to 27 ms. Payments' 180 ms was one click in nine (a single long task); the other eight took 12 to 39 ms. Without the 4x slowdown these are about a quarter as long.

### Common clicks (1440 px, 4x CPU, three rounds, after the review's fixes)

The clicks a judge makes most besides the sidebar and the tabs. Each shows its skeleton within 14 to 27 ms (74 ms the first time in a session); what follows is the wait for the server.

| Click | Content, local | The server's answer, local (first to last byte) | Free plan (estimate) | Starter (estimate) |
|---|---:|---:|---:|---:|
| A Properties row to its property | 231 ms (229 to 282) | 10 to 768 ms (Payments' PayPal read streams last) | 0.7 to 1.2 s | 0.3 to 0.4 s |
| Back to Properties (the arrow) | 202 ms (174 to 208) | 10 to 183 ms | 0.4 to 0.5 s | about 0.2 s |
| A property to its statement | 1,083 ms (1,026 to 1,251) | 7 to 1,078 ms | 1.5 to 1.7 s | about 1.0 s |
| Move-out to Review refund | 1,091 ms (1,082 to 1,418) | 5 to 1,383 ms | 1.7 to 2.0 s | 1.1 to 1.3 s |

The statement and the refund review are the slow ones on any plan: before they show anything they read the close-out's facts live from PayPal (`closeOutFacts`, the deposit invoice and its payment, so the amounts on them are PayPal's), about 0.7 to 0.9 s of waiting on PayPal's sandbox here. Starter shortens only their server work (66 to 84 ms of CPU locally, so about 0.7 to 0.8 s on the free plan and 0.15 on Starter). Since part 2 they draw their own content first and stream PayPal's part behind its own skeletons (Speed, part 2).

**Insights** is the heaviest page in the browser: a full load has about 860 ms of blocking time at 4x, with one task of 390 to 440 ms while its four charts and the grid are built together (on the first sidebar visit, 794 ms of long tasks in all). That is the browser's work, the same on any plan, and about a quarter as long without the slowdown. The charts already load only on Insights; since part 2 they are built after the grid has drawn (Speed, part 2).

The estimates use the same calibration as the table at the end: ten times the local server CPU on the free plan and twice on Starter, Supabase about four times closer from Render's Oregon region (25 ms a round trip, against 100 ms here), PayPal's wait the same, and the browser's share as measured.

**The hosted demo before** (free plan, 4x CPU, median of 2 rounds; owner session, read only): sidebar content 440 ms (Lease check) to 2,508 ms (Insights), most 530 to 1,110 ms; tabs 360 to 807 ms median, slowest 1,904 ms (Payments). Not re-measured after: the change isn't deployed.

### Full page loads (fresh browser, median of 2)

**1440 px**

| Page | First byte before | after | First paint before | after | Content before | after |
|---|---:|---:|---:|---:|---:|---:|
| Properties (`/units`)* | 1,738 ms | 116 ms | 1,858 ms | 240 ms | 1,812 ms | 511 ms |
| Tenants | 452 ms | 6 ms | 522 ms | 78 ms | 484 ms | 350 ms |
| Payments | 662 ms | 16 ms | 740 ms | 90 ms | 1,246 ms | 750 ms |
| Insights | 519 ms | 8 ms | 594 ms | 84 ms | 1,094 ms | 698 ms |
| Documents | 422 ms | 6 ms | 494 ms | 74 ms | 454 ms | 343 ms |
| Lease check | 414 ms | 7 ms | 484 ms | 78 ms | 444 ms | 128 ms |
| Move-outs | 436 ms | 6 ms | 506 ms | 72 ms | 468 ms | 346 ms |
| Closed unit, Overview | 783 ms | 213 ms | 876 ms | 288 ms | 826 ms | 562 ms |
| Closed unit, Move-out | 802 ms | 194 ms | 906 ms | 262 ms | 886 ms | 1,072 ms** |
| Closed unit, Payments | 1,488 ms | 188 ms | 1,572 ms | 252 ms | 1,525 ms | 921 ms |
| Closed unit, Documents | 660 ms | 197 ms | 744 ms | 264 ms | 697 ms | 536 ms |
| Closed unit, Tenants | 746 ms | 242 ms | 828 ms | 310 ms | 782 ms | 582 ms |
| Move-out unit, Overview | 574 ms | 215 ms | 662 ms | 288 ms | 612 ms | 562 ms |
| Move-out unit, Move-out | 770 ms | 160 ms | 872 ms | 230 ms | 844 ms | 1,036 ms** |
| Move-out unit, Payments | 1,280 ms | 190 ms | 1,360 ms | 254 ms | 1,316 ms | 810 ms |
| Move-out unit, Documents | 567 ms | 200 ms | 648 ms | 268 ms | 602 ms | 538 ms |
| Move-out unit, Tenants | 678 ms | 223 ms | 754 ms | 292 ms | 711 ms | 595 ms |
| Texas unit, Overview | 577 ms | 130 ms | 672 ms | 202 ms | 644 ms | 489 ms |
| Texas unit, Move-out | 678 ms | 164 ms | 778 ms | 238 ms | 752 ms | 524 ms |
| Texas unit, Payments | 1,278 ms | 258 ms | 1,362 ms | 326 ms | 1,315 ms | 913 ms |
| Texas unit, Documents | 550 ms | 232 ms | 630 ms | 300 ms | 586 ms | 571 ms |
| Texas unit, Tenants | 690 ms | 292 ms | 774 ms | 358 ms | 726 ms | 632 ms |

\* The first page of each run, so it includes the server's first-request warm-up. ** Move-out's content now waits for the deductions grid's rows (its gray rows count as a skeleton); before, the measurement stopped before the grid had drawn, so the two aren't the same moment. At 390 px the pattern is the same: first paint 52 to 100 ms for the sidebar pages (474 to 734 before) and 206 to 264 ms for a property (626 to 1,454), content 114 to 716 ms for the sidebar pages (452 to 1,260) and 402 to 1,004 ms for a property (594 to 1,424), Move-out 1,036 to 1,211 ms with its grid.

A property's first byte waits for one small read (is this tenancy in the session's workspace?), so a missing or foreign one can still answer 404. The sidebar pages' content can't come sooner than 300 ms after the first paint: React holds the streamed skeleton that long so the page doesn't flash. On the hosted demo the server takes longer than that anyway.

### JavaScript a page loads (1440 px, gzipped as sent)

| Page | Before | After |
|---|---:|---:|
| Properties, Tenants, Documents, Move-outs | 154 to 156 kB | 158 to 159 kB |
| Lease check | 189 kB | 195 kB |
| Payments (AG Grid) | 510 kB | 517 kB |
| Insights (AG Grid and AG Charts) | 915 kB | 920 kB |
| A property, inspected (the grid loads with its card) | 539 kB | 547 kB, the grid after the page |
| A property, not inspected (the Texas unit) | 539 kB | 221 kB |

The few kB added everywhere are the skeletons and the tab switcher. An inspected property still downloads the grid, but after the page is drawn and without holding it up.

### The server's own CPU time (local, median of 8 requests)

| Request | Before | After |
|---|---:|---:|
| Properties | 65 ms | 29 ms |
| Tenants | 59 ms | 22 ms |
| Payments | 52 ms | 22 ms |
| Insights | 60 ms | 22 ms |
| Documents | 44 ms | 36 ms |
| Lease check | 53 ms | 19 ms |
| Move-outs | 49 ms | 21 ms |
| A property, one tab before, all five after | 44 to 130 ms | 54 to 100 ms |
| A statement | 99 to 107 ms | 66 to 84 ms |
| The refund review | 81 ms | 71 ms |
| A click from one sidebar page to another (its RSC payload; Lease check is 2 to 9 ms either way) | 22 to 75 ms | 9 to 27 ms |

A property's page now carries all five tabs (its HTML is 1.5 to 3.4 times larger, before compression) for about the CPU one tab cost, and switching tabs afterwards costs the server nothing.

### One page view, everything it makes the server do (CPU, median of 5)

| Page | Before | Prefetches before | After | Prefetches after |
|---|---:|---:|---:|---:|
| Properties | 200 ms | 25 | 30 ms | 0 |
| Payments | 160 ms | 22 | 30 ms | 0 |
| Insights | 170 ms | 13 | 20 ms | 0 |
| The move-out unit | 190 ms | 21 | 70 ms | 0 |
| The closed unit | 180 ms | 20 | 70 ms | 0 |

## Motion (2026-10-06)

Round 9 added calm motion across the app (`docs/DESIGN.md`, Motion) with one rule from this page: no animation may delay content or a click. Measured as above (local production builds of `1b0acda` and of the round, the same throwaway demo copy, Chrome at 4x CPU, the click's own timestamp), with one more figure: when the page is *settled*, no animation left running in `main`.

- **Every click still answers in the next frame**, and a property's tabs still switch in 13 to 27 ms (Move-out 65 to 71 ms), with no request to the server.
- **Content is shown as soon as before**: a page's parts arrive from 40% opacity, 4 px low, so the first frame after a skeleton is never blank, and are at rest 150 ms later (a page's first three parts 20 ms apart, 60 ms at most). Nothing is added to the layout (the shift figures are the same).
- **Settled** comes 150 to 230 ms after the content. The two AG Grid views read longer: Payments about 350 ms after its content, and an inspected unit's Move-out about 400 ms, which there is AG Grid fading its hidden horizontal scrollbar, something nobody sees (the tab's own arrival ends at about 200 ms).

| 1440 px, median | Feedback before | after | Content before | after | Settled after |
|---|---:|---:|---:|---:|---:|
| Sidebar: Properties | 15 ms | 16 ms | 186 ms | 182 ms | 400 ms |
| Sidebar: Tenants | 11 ms | 14 ms | 153 ms | 128 ms | 304 ms |
| Sidebar: Payments | 13 ms | 16 ms | 216 ms | 246 ms | 596 ms |
| Sidebar: Insights | 20 ms | 24 ms | 340 ms | 354 ms | 580 ms |
| Sidebar: Documents | 15 ms | 16 ms | 138 ms | 150 ms | 326 ms |
| Sidebar: Lease check | 10 ms | 11 ms | 27 ms | 29 ms | 190 ms |
| Sidebar: Move-outs | 10 ms | 12 ms | 133 ms | 116 ms | 309 ms |
| Tab: Overview | | | 15 ms | 17 ms | 173 ms |
| Tab: Move-out | | | 67 ms | 65 ms | 473 ms |
| Tab: Payments | | | 26 ms | 27 ms | 182 ms |
| Tab: Documents, Tenants | | | 13 ms | 14 ms | 164 to 172 ms |
| A Properties row to its property | 26 ms | 22 ms | 252 ms | 230 ms | 410 ms |
| Back to Properties (the arrow) | 18 ms | 20 ms | 177 ms | 182 ms | 401 ms |
| A property to its statement | 19 ms | 21 ms | 970 ms | 956 ms | 1,122 ms |
| Move-out to Review refund | 15 ms | 19 ms | 919 ms | 878 ms | 1,111 ms |

Sidebar figures are six rounds per build, tabs nine clicks each (three units, three rounds), the common clicks six each. At 390 px the pattern is the same: feedback 14 to 21 ms (10 to 16 before; the click there also closes the navigation drawer, which now eases out), tabs 13 to 24 ms and Move-out 71 ms (79 before), and sidebar content within the run-to-run spread of the server's answer (Insights 479 ms against 401, its range 377 to 581 against 269 to 543). The sidebar's content figures move by tens of milliseconds between runs of the same build, since they wait on Supabase.

**JavaScript:** no motion library was added (CSS, and the Web Animations API in `src/components/motion.tsx`). Every page loads 2 to 4 kB less gzipped JavaScript than before (Properties 159.1 to 155.0 kB, Payments 518.8 to 514.8 kB; the build split the shared code differently), except the refund review, which gains 10.5 kB (157.6 to 168.1 kB) for the step timeline and the success moment it now carries.

## Speed, part 2 (2026-10-07)

Round 6's deferred list, measured the same way: local production builds of `a471119` (before) and of the round (after), the same afternoon, the same throwaway demo copy (the three template units, no pool deposit) and a locally signed demo session, Chrome through Playwright at 4x CPU, the click's own timestamp. The common clicks were measured with both builds served at once and run in turn (four runs of three rounds before, two after), the rest one run per build. No app-level Claude call and no PayPal write; the pages read PayPal's invoice as they do.

| Finding | Change | Where |
|---|---|---|
| The statement and the refund review showed nothing until PayPal answered (0.9 to 1.4 s at 4x), because every figure on them waits on `closeOutFacts`. | They draw what their own rows hold first: the statement its header, the parties and dates, each deduction with its photos and documents, Documents, interest and Delivery (`statementFrame`, the same code `buildStatement` uses for those parts); the refund review its parties, the amount of a refund waiting for approval, and the button. What PayPal's answer decides (the deposit, the totals, the refund, a settlement's figures, the checklist; the review's amount and method, blockers, checks and the agent's steps) streams in behind its own skeletons, each the height of what replaces it, from one read for all of them. PayPal's read starts with the statement's rows, not after them. Record delivery, Prepare refund and Send refund stay disabled until that answer is in, as they were when the page waited for it, and the routes behind them check everything again anyway. Decline, beside Send refund, is held off too until the answer brings the prepared run's id. The refund review reads its rows in one round instead of two. | `statement/page.tsx`, `src/lib/statement.ts`, `refund/page.tsx`, `src/lib/refund-view.ts`, `delivery-form.tsx` |
| Photo grids and thumbnails loaded the photos themselves (150 to 230 kB each). | A thumbnail route serves 480 px WebP versions (6 to 10 kB) to the property's header, the move-in grid, the move-out photos by room, the dispute tiles, Properties, Move-outs, the statement's photos and the tenants' pages; the move-out comparison and every photo that opens on its own keep the full photo. The route checks the session's workspace with the same rule as a signed link (`maySign`); the tenants' routes take `?size=thumb` under their token. The browser keeps a thumbnail 30 days (a stored photo's path is never reused). The 23 template photos every demo copy shows were made ahead (`scripts/template-thumbs.mjs`, read only on storage) and ship in `data/template-thumbs`, so the hosted demo spends no CPU on them, even right after the free plan wakes; any other photo is made on first request, or from the upload's bytes just after it, and kept in memory (32 MB at most). Nothing is written to storage. | `src/lib/thumbs.ts`, `src/app/api/thumbs/[...path]/route.ts`, `src/lib/workspace.ts` (`thumbsFor`), `scripts/thumbs-check.mjs` |
| Every grid registered `AllCommunityModule`. | Each grid registers only what it uses on top of the shared client-side row model, tooltips and cell and row classes (`gridModules` in `src/components/grid.tsx`). Every feature was exercised on the build (sorting, the quick filter, views, chips, row checkboxes, column moves and resizes, tooltips, row details, CSV exports, Insights' groups and filter, beat 3b's edits with the refused 12 and the accepted 9) with no AG Grid error, and in development with AG Grid's validation on for a run (it names a missing module; it isn't left on, since it also draws a box over the grid for every deprecation). | `grid.tsx`, the three grids |
| Every property view read PayPal's invoice (about 0.25 to 0.4 s of the page's stream, and a sandbox GET). | A paid deposit's invoice read in the last minute stands in for a new read, per workspace, while the tenancy's payment records and its notes of refunds made in PayPal are unchanged (a digest of them is in the key, so any write, webhook report or decision reads again at once). The statement, the refund review, the close-out, a settlement and every route that moves money read PayPal themselves, so no money button ever acts on the reused read; a deposit not yet paid is always read live. | `src/lib/deposit.ts`, the property page |
| Insights built its four charts in the same task as the grid on a click. | The charts are built once the grid has drawn its rows and that frame is painted (or after 1.5 s), their code fetched meanwhile, their places held at their sizes. | `insights.tsx`, `insights-grid.tsx` |
| Counting rows with supabase-js's `head: true` sends a HEAD, which Supabase answers with `Connection: close`: each one cost the keep-alive pool a connection, and the next read paid a new TLS handshake (eight HEAD counts in a row opened seven connections, eight GET counts one). The refund review makes two, so the page opened after it waited about 250 ms longer on its first reads (500 against 230 ms locally, in both builds). | The page-path counts (the refund review, its state pack, the tenants' page, the tenants' dispute polling) ask with a GET (`count` with `limit(1)`): the same count, and the connection stays open. The close-out's refund key and the photo upload still count with a HEAD (not on a page's path; left as they are). | `refund-view.ts`, `tenancy-pack.ts`, `tenant-view.ts`, `api/t/[token]/dispute/route.ts`, `src/lib/http.ts` |

**Common clicks, 1440 px, 4x CPU** (medians, range in brackets; "first content" is the first frame with the page's own content, "whole" the first with no skeleton left):

| Click | Before (first content = whole) | After, first content | After, whole |
|---|---:|---:|---:|
| A property to its statement | 1,056 ms (892 to 1,108) | 394 ms (380 to 412, 793 the first time) | 882 ms (791 to 1,066) |
| Move-out to Review refund | 1,052 ms (934 to 1,396) | 459 ms (450 to 476) | 964 ms (899 to 1,170) |
| A Properties row to its property | 259 ms (239 to 363) | 260 ms (245 to 264; 606 the first, cold) | the same |
| Back to Properties (the arrow) | 184 ms (176 to 204) | 182 ms (176 to 191) | the same |

The whole statement is about 170 ms sooner (PayPal's read starts with its rows), the whole refund review about 90 ms sooner (its rows in one round), and each shows its own content about 0.6 s earlier. Feedback stays 15 to 25 ms. Layout shift while the skeletons fill: 0.005 on the statement, 0.012 on the refund review at 1440 and 0.059 at 390 (the copy's demo notice, which only a copy with no deposit of its own shows; a copy with its own shows none), 0 before.

**Photos a page downloads** (1440 px, scrolled to its end, the move-out unit):

| Page | Before | After |
|---|---:|---:|
| Properties | 439 kB (3 photos) | 19 kB |
| Move-outs | 293 kB | 13 kB |
| A property, Overview | 582 kB | 26 kB |
| A property, Overview then Move-out | 1,164 kB | 1,190 kB (the comparison keeps the full photos; the room thumbnails add 19 kB) |
| The statement | 1,746 kB (9 photos) | 77 kB |
| The tenants' page | 552 kB (4, re-encoded at 1,600 px on every request) | 32 kB |

**The thumbnail route's cost** (the server's own CPU, local): a template photo's thumbnail the first time in a process 4 ms (5 ms to its last byte, read from `data/template-thumbs`), from memory 2 ms; a photo made from the bucket (an upload) 25 to 65 ms the first time (the download 7 ms, sharp about 20, and its wait on storage 0.3 to 0.4 s), about ten times that on the free plan, once per photo per server start.

**JavaScript** (gzipped as sent): Payments 514.9 to 457.8 kB, Insights 917.8 to 860.8 kB, an inspected property 548.6 to 491.6 kB (the grid's chunk, which loads after the page); the other pages are unchanged. Blocking time on a full load fell with it: an inspected property's Move-out tab 186 to 96 ms at 1440 (the move-out unit), the Payments page 154 to 116 ms (219 to 160 at 390).

**Insights at 4x** (three rounds each): on a click from the sidebar the grid's first row is drawn at 440 ms instead of 579 (the long tasks before it 231 ms instead of 428) and the charts at 677 ms instead of 653; sidebar content 232 ms instead of 395 at 1440 and 266 instead of 423 at 390. On a full load the charts' code arrives after the grid has drawn anyway, so the grid (642 against 692 ms) and the charts (1,328 against 1,384 ms) move by no more than the run-to-run spread, and blocking time is 663 ms against 694 (682 against 788 at 390).

**A property viewed again within a minute** (local, unthrottled, to the last byte): 595 to 650 ms instead of 800 to 1,050 with PayPal's read, and 100 to 131 ms of server CPU instead of 120 to 170. The page's own content arrives at the same time either way: the read was already streamed last (round 6).

Everything else measured within the run-to-run spread: the sidebar (feedback 11 to 23 ms, content as before), a property's tabs (13 to 30 ms; Move-out 68 to 76 ms, 85 to 92 before), full loads (first paint and content within the spread of the server's answer). The hosted demo isn't measured: this round isn't deployed.

## On Render: the free plan and Starter

Render's free plan gives the service a tenth of a CPU, Starter ($7 a month) half of one. The server's share of a page scales with that; the network share doesn't. Calibrated on the hosted demo before (its warm first bytes, 0.5 to 1.4 s, match about ten times the local CPU plus the database waits, within about 20 percent), the estimates:

| What | Free, before (measured live) | Free, after (estimate) | Starter, after (estimate) |
|---|---:|---:|---:|
| A property's tab (the browser's work, the same on any plan) | 0.4 to 1.9 s | 13 to 26 ms, Move-out 75 to 95 ms | the same |
| Feedback on a sidebar click | 0.4 to 2.5 s | under 30 ms | under 30 ms |
| A sidebar page's content | 0.4 to 2.5 s | 0.2 to 0.5 s | 0.15 to 0.3 s |
| First paint, full load of a sidebar page | 0.65 to 2.0 s | 0.15 to 0.3 s | about 0.1 s |
| Content, full load of a sidebar page | 0.6 to 2.8 s | 0.5 to 1.0 s | 0.4 to 0.6 s |
| Content, full load of a property | 0.9 to 1.8 s | 0.8 to 1.3 s | 0.4 to 0.6 s |
| Server CPU left busy by one page view | 1.6 to 2.0 s | 0.2 to 0.7 s | 0.05 to 0.15 s |
| Opening a property from Properties | not measured | 0.7 to 1.2 s | 0.3 to 0.4 s |
| A property's statement, or the refund review | not measured | 1.5 to 2.0 s | 1.0 to 1.3 s |
| The first page after 15 quiet minutes | 6 to 11 s (asleep) | the same | no sleep |

A property's full load is the one place the free plan stays slow among the pages: it is the heaviest render (five tabs, the shell's bell), about a second of the free CPU. On Starter it is about a fifth of a second of server time, and the free plan's wake-up, the worst first impression a judge can get, goes away. The statement and the refund review stay about a second on Starter, because most of their wait is PayPal's (Common clicks, above). A sidebar page's full load can't show its content sooner than 0.3 s after its first paint on any plan (React's hold on a streamed skeleton).

## Caching and isolation

Nothing is kept between requests that one workspace could read from another, and nothing is kept at all that a write would leave stale:

- No Next.js data or page cache (`"use cache"`, `unstable_cache`, fetch caching, `revalidate`), no `staleTimes`, no Cache Components or Partial Prefetching. Every landlord, flow and tenant page renders per request.
- React's `cache()` (per request only) shares a page's reads between the shell and the page.
- The few values a server module keeps between requests are each listed, with the reason no workspace's data can pass through them, in `scripts/cache-check.mjs`: the owner workspace's id, which demo copies exist, the template list, the app's PayPal token, throttles, and signed photo links (reached only after the workspace check).
- `node scripts/cache-check.mjs` checks all of this in the code and fails on a new module-level value until it is reviewed. With `--live <base>` it also makes two throwaway demo copies on a running build, requests every page and its RSC payload for both at once, interleaved (360 requests), checks that no answer names the other copy's records, that each copy gets 404 for the other's tenancies, and that a deduction edited in one copy shows at once on its property page, Payments and Insights, and not in the other; then it puts the edit back, opens copy A's move-out unit in a browser (`scripts/tabs-check.py`: tab switches send no request and add no history entry; after a change on Move-out, another tab and back, Payments then Back, and Back to Properties then Forward all show the new figures, the grid agreeing with the facts above it, the property back within 3 s; the phone grid keeps its columns), and removes both copies. Passed on 2026-10-05 (274 checks).

## Trade-offs, and what is left

- **A property view reads PayPal's invoice at most once a minute per workspace** while the records are unchanged (Speed, part 2). A refund made in the PayPal dashboard with no webhook report can therefore show on the property up to a minute later; the refund review and every money route read PayPal themselves, so nothing is sent on the older read.
- **The move-out comparison keeps the full photos.** Its frames run to the column's width and the slider to 900 px, where a 480 px version would blur the boxes' detail. The statement's photos are the 480 px versions on screen and on paper from the browser; the PDF packet still re-encodes the originals at 1,600 px.
- **A photo that isn't a template's is made into a thumbnail on the server** the first time it is shown after a start (25 to 65 ms of CPU locally, about ten times that on the free plan). Uploads warm theirs from the bytes in hand. Supabase's image resizing needs its Pro plan.
- **After a template photo changes,** run `node scripts/template-thumbs.mjs` (and `node scripts/thumbs-check.mjs --db` shows whether it is needed). A photo the index doesn't list is made on first request, so a stale index costs CPU, never a wrong picture.
- **A notice's 404** costs its page one read before streaming (the same read the page makes anyway, cached).
- **Back leaves a property.** Its tabs change the address without adding to the browser's history, so Back goes to the page before the property, not to the previous tab (and Forward comes back to the tab it was on). Tabs that each added an entry are what left a property on its skeleton after a change (above).
- **Move-out builds its grid on every visit** (75 to 95 ms at 4x on an inspected unit): AG Grid destroys its grid while the tab is hidden. Keeping it alive would mean keeping the tab out of `Activity`, which is what makes the other tabs instant.
- **The statement and the refund review still wait on PayPal for their figures** (about a second on any plan); their own content comes first since part 2.
- **Two streamed parts can still move the page a little.** On a demo copy with no sandbox deposit of its own (the day's pool used up, or the Texas unit), the refund review's notice saying so arrives with PayPal's answer and moves what is below it down: a layout shift of 0.012 at 1440 and 0.059 at 390, under the 0.1 counted as good. Holding its place would mean reading the pool before the first paint (two to four more database reads, on the judges' path too) or guessing. On the statement, a claim's standing (New York after day 14, a Florida claim the tenants objected to in time) arrives above the deductions with PayPal's answer, since the close-out's facts work it out with the rest (New York's turns on the deposit's live status too); reserving a line for every New York statement would move the common case, a statement before day 14, instead. The demo has no New York or Florida unit, so only the owner's own tenancies show it.
- **Insights' charts** are still built in one 270 to 390 ms task at 4x, now after the grid has drawn.
- **The hosted demo after** isn't measured yet: Render deploys `main`, and this round isn't pushed. After the deploy, step 11 of the ten-minute check in `docs/DEPLOY.md` covers it.

# What must be true before this repository is public

Checked on 2026-10-13 on branch `loop4` at `472dff6`, against the whole git history and not only the working tree.
This is a report. Nothing was rewritten, re-authored or deleted to produce it, and nothing should be: `main` is what
Render deploys, so a history rewrite would change every hash and need a force push. Each finding below carries a
recommended action instead.

On 2026-10-16 the plain edits were made: findings 2, 7, 10, 12, 14, 15 and 16, which also removed the address finding 5 places in AUDIT.md. The others stand as written.

The earlier pass is [AUDIT.md](AUDIT.md), section "Before the repository goes public", written on 2026-10-05 at 41
commits. This one redoes that work at 58 commits and adds what has landed since.

## How it was checked

- **Every commit's patch.** `git log --all -p` over all refs, 8.6 MB, 58 reachable commits.
- **Every object in the store**, which also covers commit messages, binary files and the four commits this clone no
  longer reaches: `git cat-file --batch-all-objects --batch`, 36 MB over 1,395 blobs, 953 trees and 62 commits.
- **Every current value** in `.env.local` and `.env.render` (21 assignments across the two files) was searched for in
  both of those, raw and base64 encoded. No value was printed, and nothing was copied out of the repository.
- **Key patterns:** Anthropic (`sk-ant-`), Supabase secret and publishable keys, JWTs, PEM private keys, GitHub, Slack,
  AWS, Google, PayPal bearer tokens, and database URLs with a password.
- **People:** every email address, every phone number, and every occurrence of a real name in a file, a path or a
  commit message.
- **Paths:** all 397 distinct paths ever added, checked for env files, keys, certificates and databases.
- **The rest:** `LICENSE` against `package.json` and the README, the license of every runtime dependency, the photo
  and invoice credits, and `.env.example` against every variable the code reads.

## Secrets and tokens

**Nothing needs rotating because of the history.** No value from `.env.local` or `.env.render` appears anywhere in the
object store, raw or base64. No key or token pattern matches. The only env file ever committed is `.env.example`, and
its every value is a placeholder.

| | Finding | Where | Recommended action |
|---|---|---|---|
| 1 | The Supabase project's URL was hard-coded in the setup script for two days. It is the only live value anywhere in the history. It is not a credential: the URL is public by design, and with row level security on and no policies, only the secret key reads anything. | added in `347668a`, removed in `d53be22`, `scripts/setup-supabase.sh` | None. Do not rewrite history for it. |
| 2 | The hosted demo's PayPal **sandbox** webhook id is printed as a worked example, twice on one line. Sandbox-only, and not a credential: a delivery is verified with it plus the app's PayPal credentials. | `docs/DEPLOY.md:35` | Optional. Replace the real id with `0RL00000000000000` and keep the sentence about its shape. |
| 3 | Sandbox dispute, refund and capture ids from the runs written up in the docs. Sandbox-only. | `docs/HOW_IT_WORKS.md:81-82` | None. They are the evidence that those runs happened. |
| 4 | Four commits this clone no longer reaches (three stash objects from 2026-10-02 and one superseded `7ab80ad`). They hold no secret, by the same object scan. They were never pushed, so they are not in the public repository either way. | local object store | None. `git gc --prune=now` removes them if the clutter matters. |

**Before flipping the switch:** turn on secret scanning and push protection (Settings, Code security). Both are free
for public repositories and would catch the next mistake rather than this one.

## People

Every phone number in the history is in the 555-01xx range reserved for fiction. Every email address is at
`example.com`, `example.org` or `harborviewrentals.example`, with one exception, below. The tenants, landlords and
vendors are invented.

| | Finding | Where | Recommended action |
|---|---|---|---|
| 5 | **Andrew Leal's personal email is the author and committer of all 58 commits**, and becomes public with them. It is also written out once in a document. | every commit; `docs/AUDIT.md:152` | Andrew's call. The GitHub account that will host this is already `andrewleal0412-arch`, so the name is public regardless. To keep the address off future commits, set GitHub's noreply address. Do not rewrite the existing ones. |
| 6 | **Nineteen files name Andrew in the third person**, mostly as "(Andrew's decision of 2026-10-05)" beside a rule the app enforces: `docs/rules/README.md`, `FL.md`, `NY.md`, `TX.md`, `WA.md`, `docs/ACCESSIBILITY.md:53`, `docs/PERFORMANCE.md:3`, `docs/AUDIT.md`, `PLAN.md`, two `supabase/migrations/`, `scripts/zone-check.mjs`, `scripts/negotiation-check.mjs`, `src/lib/dates.ts`, `dispute-status.ts`, `states/index.ts`, `ny.ts`, `ny.server.ts`, `types.ts`. | listed above | Keep, if being named is fine: `LICENSE` names him anyway, and the attributions are the honest record of who chose a rule the law left open. Otherwise one pass replacing "Andrew's decision of 2026-10-05" with "a product decision of 2026-10-05". |
| 7 | `docs/PERFORMANCE.md:3` opens by quoting a private remark: `Andrew, 2026-10-05: "the site is slow, it takes forever to go from tab to tab; it should be responsive."` | `docs/PERFORMANCE.md:3` | Keep or reword. It reads as a note between two people rather than a document. "Measured on 2026-10-05, after the site was reported slow between tabs" says the same thing. |
| 8 | Demo addresses use real street names in Orange, Santa Ana and Austin, so a house number could land on a real building. The people, companies and numbers at them are fictional. Carried over from `AUDIT.md`, still true. | `demo/`, the seed, `docs/DEMO_SCRIPT.md` | Optional, and worth deciding before filming. |

## Private notes and internal remarks

| | Finding | Where | Recommended action |
|---|---|---|---|
| 9 | **`PLAN.md` is a private planning document and should not be published as it stands.** It holds a personal schedule by week, including midterms (line 48), a competition's close date (line 50) and filming in Andrew's apartment (line 68); the path of a note in his Obsidian vault (line 9); and a stack that is no longer the one that was built (SQLite, Vercel, the name still open). | `PLAN.md` | **Delete it from the working tree, or move it out of the repository, before going public.** It stays in the history, which holds nothing sensitive. Nothing in the repository reads it except one line of `AUDIT.md`. |
| 10 | **`docs/AUDIT.md` ends with a list addressed to Andrew in the second person** ("These are for Andrew", "Your email is the author on all 41 commits", "your schedule"), with his email in plain text. Its counts are also stale: 41 commits, `state-packs` 256, `negotiation` 126, against 58, 316 and 136 today. | `docs/AUDIT.md:146-164` | Rewrite the section in the third person and point it at this file, or drop it and keep the audit's own findings. Keep the document dated 2026-10-05 whatever happens: it is a record of that day, not of today. |
| 11 | **Loop-internal wording in two published documents.** "The plan is Andrew's call and not part of this round", "of `9493e04` (before) and of this round (after)", "which is what this round is about" (`docs/PERFORMANCE.md:269`, `:273`), "on the Mac mini" and "these are the mini's numbers, not Render's" (`:273`), which is the build machine and not the product, and "this round's Claude calls were spent" (`docs/HOW_IT_WORKS.md:81`). A reader outside the build has no idea what a round is. | as listed | Replace "this round" with the date or the commit, and name the machine as "a local build" or drop it. The facts are right; only the frame is private. |
| 12 | Two remarks in the Render blueprint: "the Render workspace can't take a card at the moment", and a variable commented "your code: your own data". | `render.yaml:11`, `render.yaml:37` | Reword. "Free while the demo is being judged; the free plan sleeps after 15 minutes" and "the owner's code: the owner's own data". |
| 13 | **Eleven commit messages name Andrew or the build loop's rounds**, and on GitHub the commit list is the first thing a reader opens after the README. Subjects: `9493e04` "Demo guide (for Andrew to judge)", and `b67ae81`, `abee1d0`, `1abdb27`, `c4b453a` "Good Faith redesign, round 1" through "round 4". Bodies: `2bd2821` "Andrew clicked 'Remove deductions' on the hosted site and nothing happened", `a2c241d` "Andrew's 10-05 decisions and round 1's leftovers", `eefa8db` "Andrew's decisions of 10-04", `ac311ca` "Found by a verification pass of round 1", `447c0d5` "a session id for round 2's workspaces", `a55a279` "The round delivered", `e98d559` "Review fixes in the same round". None holds a secret or anything private beyond the name and the vocabulary. | the eleven commits listed | None that is safe: a history rewrite is off the table, so accept that these are public. Write future subjects and bodies without a person's name or the build loop's vocabulary. |

No `TODO`, `FIXME`, `HACK` or `XXX` is left in any tracked file.

## License and credits

All clean. No action needed.

- **`LICENSE`** is MIT, "Copyright (c) 2026 Andrew Leal". It matches `"license": "MIT"` in `package.json` and the
  README's footer, and the hackathon requires an open source license.
- **Every runtime dependency is permissive**, so MIT on top of them is sound: MIT for `next`, `react`, `react-dom`,
  `@modelcontextprotocol/sdk`, `@supabase/supabase-js`, `@typesafe-ai/sdk`, `ag-grid-community`, `ag-grid-react`,
  `ag-charts-community`, `ag-charts-react`, `pdf-lib`, `undici`, `zod` and `server-only`; Apache-2.0 for `ai`,
  `@ai-sdk/anthropic`, `@ai-sdk/mcp` and `sharp`; ISC for `@paypal/agent-toolkit`. Nothing copyleft.
- **AG Grid and AG Charts are the free Community builds**, with no Enterprise module and no license key, which the
  README already states.
- **`demo/photos/CREDITS.md`** names the three Pexels photos with their links and license, says the move-out versions
  are those photos with damage added, and says the invoices, vendors and 555 numbers in `demo/receipts` are made up.
- The **demo leases** are fictional documents written for this project.

## `.env.example`

It holds 39 variable names and no value that is not a placeholder, and it is the only env file ever committed.
`.gitignore` ignores `.env*` with `!.env.example`, so the real files cannot be added by accident.

| | Finding | Where | Recommended action |
|---|---|---|---|
| 14 | Three variables are read by a check script and are not listed: `GF_BASE`, `GF_COOKIE` and `GF_UNIT`, read by `scripts/tabs-check.py`. The file lists other script-only variables (`PLAYWRIGHT_PYTHON`, `DEMO_BASE_URL`, `DEMO_ACCESS_CODE`), so the omission is inconsistent rather than wrong. | `.env.example`, `scripts/tabs-check.py:26-28` | Add three commented lines, or say in the header that the file covers the app and the demo scripts and that `tabs-check.py` documents its own. |

Every other variable the code reads is in the file, the demo scripts' and the end-to-end test's switch included.

## Housekeeping a public reader would notice

| | Finding | Where | Recommended action |
|---|---|---|---|
| 15 | `docs/screenshots/` holds six PNGs totalling 3.0 MB that nothing displays any more. The README's images all come from `docs/img/`. Only a line of `AUDIT.md` prose mentions them. | `docs/screenshots/` | Remove them, or keep them and say in `AUDIT.md` that they are that audit's record. |
| 16 | `demo/lease.pdf` and `demo/lease.html` are the California lease as it was before it became `lease-single-owner`. Nothing uses them: the only mention is a docstring in `scripts/render_pdf.py`. | `demo/` | Remove both, and name `lease-single-owner.pdf` in that docstring instead. |
| 17 | `AGENTS.md` is the only prose in the repository with em dashes (the six other tracked files that hold one are fixtures for the code that strips them, and `agent-words.ts` itself), and it says things like "This is NOT the Next.js you know", which is about `node_modules` rather than about Good Faith. It is written and re-added by `next dev`. | `AGENTS.md` | Leave it. Deleting it only brings it back on the next `next dev`, as the file itself says. |

## Still outstanding from elsewhere

These are not repository findings, but they are on the same checklist and are not done yet.

- `npm audit --omit=dev`, run again today, lists 10 advisories (5 high, 2 moderate, 3 low), all inside
  `@paypal/agent-toolkit` 1.11.0's own dependencies. Dependabot will list them the moment the repository is public.
  The README's Known limits explains why they are there and why npm's only fix is a downgrade of the toolkit.

## To make it public

GitHub, the repository, Settings, General, Danger Zone, Change visibility. Then Settings, Code security: secret
scanning and push protection on.

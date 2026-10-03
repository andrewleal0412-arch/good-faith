# Good Faith design system

Zillow Rental Manager's structure with Mercury's calm: a white canvas, neutral grays, one indigo, and green, amber and red for status only. The tokens live in `src/app/globals.css` (Tailwind 4 `@theme`, with the default palette, type scale, radii and shadows cleared so nothing outside this system can be used). The shared pieces live in `src/components/`.

## Rules

- White background, neutral grays, one brand color. Green, amber and red mean status and nothing else; each status has exactly one color.
- One family (Inter via `next/font`, weights 400, 500 and 600). Tabular figures on every amount.
- No cream, serif, orange, gradients, emojis or em dashes. Short Sentence-case labels.
- No paragraphs on cards. A row carries a title and at most one sub line. Legal detail and citations sit only behind an info icon, a "Why?" link or a dotted-underline label, never printed under every row. Citations are the exact ones in `docs/LEGAL_RULES.md`.
- One hero number per view. Stat tiles and the facts strip raise the cents at 60%. On a phone one strip never mixes precisions: when every cell is a hero (Properties) all drop their cents, otherwise the hero prints full cents like its neighbours (`phoneCents`). The refund and tenant heroes keep full-size cents.
- One primary button per view. A card whose page already has a primary in its header passes `quiet` and shows its buttons as secondary.
- Empty values are words ("Not set", "Not paid", "None"), never a dash.
- The sandbox shows only as the Test mode switch in the top bar (and the plain word "Sandbox" in the tenant page's bar).
- Dates on screen are short ("Oct 1, 2026"); long dates ("October 1, 2026") are for the printed notices and the statement.

## Tokens

| Token | Value | Use |
| --- | --- | --- |
| `brand` | #5E6AD2 (hover #4F5BC4, active #4652B4) | Primary button, active nav, links, active tab, current step, focus outline |
| `brand-50` / `brand-100` / `brand-700` | #EEF0FB / #DFE3F8 / #3C47A8 | Active nav fill, focus ring and avatar / text on brand tints |
| `ink`, `ink-2`, `ink-3`, `ink-4` | #1B1D23, #464A58, #64697B, #9A9EAD | Text; `ink-3` is labels and meta (4.5:1 on every surface); `ink-4` is placeholders and icons only |
| `line`, `line-2` | #E6E8EE, #EFF0F4 | Card borders; row dividers inside cards |
| `surface`, `surface-2`, `surface-3` | #F7F8FA, #F1F2F6, #E8EAEF | Soft panels and hover; secondary buttons; their hover |
| `green` / `green-bg` / `green-dot` | #1E7B45 / #E6F4EA / #2DA160 | Done, leased, paid, money in |
| `amber` / `amber-bg` / `amber-dot` | #946200 / #FCF1D6 / #D99A1B | Waiting on you, cleaning, warnings |
| `red` / `red-bg` / `red-dot` | #B3261E / #FBEAE8 / #D64540 | Damage, overdue, violations, errors |

PayPal's two-tone monogram (`PayPalMark`) is the only other color, always beside the word PayPal.

**Type, six sizes:** `text-xs` 12/16 (meta, chips, table headers), `text-sm` 13/18 (table cells, buttons), `text-base` 14/20 (body), `text-lg` 16/24 (section and card titles, fact values), `text-xl` 24/32 (page and record titles, stat values), `text-2xl` 32/40 (heroes).

**Radius:** `rounded-xs` 4, `rounded-sm` 6 (chips), `rounded-md` 8 (buttons, inputs), `rounded-lg` 10 (cards). **Shadows:** `shadow-sm` lifts a card 1px; `shadow-md` is for menus, tips and drawers only.

**Spacing:** sidebar 232px, top bar 56px, content gutter 28px (16px on a phone), card padding 20px, table rows 44 to 48px, sections 24px apart.

**Focus:** buttons, inputs and tabs draw a 3px `brand-100` ring; everything else gets a 2px `brand` outline (`:focus-visible` in `globals.css`).

## Components

| Component | File | Use |
| --- | --- | --- |
| `AppShell` | `components/app-shell.tsx` | Sidebar (Properties, Tenants, Payments, Documents; Workflows: Lease check, Move-outs), PayPal connected, account switcher; top bar with search, Test mode, notifications, help, avatar. A drawer at phone width; on a phone the search covers the bar with a Cancel. The account is `GOOD_FAITH_ACCOUNT` or the oldest tenancy's owner, without "LLC". Its menu ends with Sign out when the hosted demo's access gate is on (no Settings). |
| `Button`, `ButtonLink`, `buttonClass` | `components/button.tsx` | Primary, secondary, link. Nothing else. Sizes sm 28, md 34, lg 40. |
| `StatusChip` | `components/ui.tsx` | 22px (26px in the record header). A dot for workflow status, plain for a classification (Damage, Violation). |
| `Money` | `components/ui.tsx` | Tabular amounts, a true minus for outflows, `cents="small"` for stat tiles. |
| `Card`, `CardHead`, `PageHead` | `components/ui.tsx` | 1px line, 10px radius; a 52px head with title, meta and a right slot. |
| `FactStrip`, `Fact` | `components/ui.tsx` | Mercury's summary strip: label, value, one sub line, optional info tip. |
| `KV`, `ListRow`, `StepBox` | `components/ui.tsx` | Key-value rows; Mercury's list row (title, sub, right); Zillow's next-step box. |
| `Table`, `Th`, `Td`, `trClass` | `components/ui.tsx` | Plain tables; on a phone each table has a list version instead of scrolling sideways. |
| `Tabs`, `Segmented` | `components/tabs.tsx`, `ui.tsx` | Record tabs (scroll with a chevron on a phone); segmented filters with counts. |
| `InfoTip`, `TipLabel` | `components/info-tip.tsx` | The one home of legal detail: a dark 300px tip from an info icon, "Why?" or a dotted label, fixed to the viewport. |
| `Menu` | `components/menu.tsx` | Overflow and account menus. |
| `Drawer`, `drawerFooter` | `components/drawer.tsx` | Forms in a 480px side drawer (full screen on a phone), every one ending in the same footer under the form; focus kept inside and returned. |
| `useConfirm`, `ConfirmDialog` | `components/confirm.tsx` | Yes-or-no questions in a 400px centered dialog (a bottom sheet on a phone), focus on Cancel. No browser `confirm()`. |
| `FormField`, `FilePick`, `inputClass` | `components/field.tsx`, `file-pick.tsx`, `ui.tsx` | Labeled inputs (36px, brand focus ring), the file picker as a secondary button. |
| `EmptyState`, `Notice` | `components/ui.tsx` | One icon, one line, one sub line, one action: brand for "nothing yet", gray for not found, red for errors. `Notice` for an inline error. |
| `CopyId`, `Thumb`, `Avatar`, `Wordmark` | `components/` | PayPal ids with copy; property photos; initials; the "Good Faith" wordmark. |

## Layouts

- **App pages:** `PageHead` then cards, max width 1208px.
- **A property:** the record header (64px photo, address, status chip, Statement, one primary, overflow menu) over Overview, Move-out, Payments, Documents and Tenants.
- **Focused flows** (`/tenancy/[id]/refund`): Mercury's Review transfer, a wordmark bar and a centered 560px column, no sidebar.
- **Tenant page** (`/t/[token]`): the landlord's name in a bar, a 560px column; the amount, one status line and a progress bar first, then Details, Deductions (the thing and what was done, then where and the basis), Timeline, photos, the statement download, a question card and Your rights, each right's title opening its tip. "Prepared with Good Faith" in the footer.
- **Access page** (`/access`): no shell; the wordmark, one line saying what the app is, and a 400px card with the "Access code" field and the one primary, "Enter demo". A wrong code or too many tries shows a `Notice` under the field. The footer line: "PayPal sandbox only. No real money moves. Not legal advice." When the host has no code set, the card is a gray `EmptyState`: "This demo is not configured".
- **Not found and errors:** `EmptyState` inside the shell for landlord pages (`(landlord)/not-found.tsx`, `error.tsx`), on a plain page elsewhere.

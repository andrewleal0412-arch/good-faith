// Copy shared by the pages and the statement, with no server imports, so the static home page can print the
// disclaimer without pulling in the database and PayPal clients.

/** The (b) category each deduction is tagged with on the statement and in the ledger; `short` is the one word the
 *  ledger prints beside the tag. */
export const TAGS = {
  rent: { tag: "(b)(1)", short: "rent", label: "Unpaid rent" },
  damage: { tag: "(b)(2)", short: "damage", label: "Damage beyond ordinary wear and tear" },
  cleaning: { tag: "(b)(3)", short: "cleaning", label: "Cleaning to the move-in level" },
} as const satisfies Record<"rent" | "damage" | "cleaning", { tag: string; short: string; label: string }>;

/** The order deductions are numbered in on the statement (rent, then damage, then cleaning), so every page that lists
 *  them uses the same numbers as the PDF. */
export const CATEGORY_ORDER = { rent: 0, damage: 1, cleaning: 2 } as const satisfies Record<keyof typeof TAGS, number>;

/** An email with all but its first letter hidden, e.g. "m•••@gmail.com", for pages a link can reach. */
export function maskEmail(email: string | null | undefined): string | null {
  if (!email) return null;
  const at = email.indexOf("@");
  return at > 0 ? `${email[0]}•••${email.slice(at)}` : email;
}

/** LEGAL_RULES section F, word for word. The first and third speak to the landlord; the statement prints the other two. */
export const DISCLAIMERS = [
  "This tool organizes your records and fills in templates based on California Civil Code 1950.5 and published state guidance. It does not give legal advice, does not evaluate your specific situation, and is not a substitute for a California attorney.",
  "Items marked Guidance or Common practice (useful-life proration, paint schedules) are not in the statute. A court may decide differently.",
  "You decide every deduction and approve every document before it is sent. The tool flags rules; it does not decide disputes.",
  "Local ordinances may add interest or other duties. Check your city's rent program.",
];

/** A settlement the demo copy came with (the closed unit's settled dispute, scripts/demo-history.mjs): history only.
 *  Its record carries raw.demo_example, no PayPal id, and no money ever moved for it; every page that shows it says so. */
export const isDemoExample = (raw: unknown) => !!raw && typeof raw === "object" && (raw as { demo_example?: unknown }).demo_example === true;
export const DEMO_EXAMPLE = {
  short: "Demo example: no PayPal money moved",
  text: "This copy of the demo came with this settled dispute as an example. The two agents' turns were written ahead and checked by the same code as a live run, and no PayPal money moved for it. To run one live, dispute the unit that moved out, after its refund.",
  tenant: "In this demo it is a recorded example, so no PayPal money moved for it.",
} as const;

/** What "Open the tenant's view" (a demo copy's landlord pages) says it does. */
export const TENANT_VIEW_TIP = "In the demo you play both sides. This opens the tenants' private page in a new tab, as they see it: the statement, their dispute and their advocate. A real landlord's tenant link is shown once and isn't kept.";

/** An owner's name for the app's chrome (the account, the tenant page's bar): a trailing entity suffix is dropped, as
 *  "Harbor View Rentals LLC" reads "Harbor View Rentals". Documents keep the full legal name. */
export const displayName = (name: string) => name.replace(/,?\s+(LLC|L\.L\.C\.|Inc\.?|LP|LLP|Corp\.?|Co\.)$/i, "").trim() || name;

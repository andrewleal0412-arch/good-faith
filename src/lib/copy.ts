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

/** An owner's name for the app's chrome (the account, the tenant page's bar): a trailing entity suffix is dropped, as
 *  "Harbor View Rentals LLC" reads "Harbor View Rentals". Documents keep the full legal name. */
export const displayName = (name: string) => name.replace(/,?\s+(LLC|L\.L\.C\.|Inc\.?|LP|LLP|Corp\.?|Co\.)$/i, "").trim() || name;

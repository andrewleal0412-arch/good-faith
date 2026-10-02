// Copy shared by the pages and the statement, with no server imports, so the static home page can print the
// disclaimer without pulling in the database and PayPal clients.

/** LEGAL_RULES section F, word for word. The first and third speak to the landlord; the statement prints the other two. */
export const DISCLAIMERS = [
  "This tool organizes your records and fills in templates based on California Civil Code 1950.5 and published state guidance. It does not give legal advice, does not evaluate your specific situation, and is not a substitute for a California attorney.",
  "Items marked Guidance or Common practice (useful-life proration, paint schedules) are not in the statute. A court may decide differently.",
  "You decide every deduction and approve every document before it is sent. The tool flags rules; it does not decide disputes.",
  "Local ordinances may add interest or other duties. Check your city's rent program.",
];

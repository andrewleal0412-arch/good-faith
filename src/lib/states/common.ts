// Pieces the New York, Texas, Florida and Washington packs share: money and date words and the ways a record is made.
// The statement checklist's building blocks and the close-out agent's instructions are in common.server.ts. California
// keeps its own words in ca.ts. Client-safe: no server imports.

import { addDays, daysBetween, longDate, pacificDate } from "../dates";
import type { NoticeMethod } from "../notices";

export const usd = (n: number) => `$${n.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
export const plural = (n: number, word: string) => `${n} ${word}${n === 1 ? "" : "s"}`;
export const list = (xs: string[]) => xs.join(", ");
/** A deposit as a share of the rent: "1 month's rent", "1.5 months' rent". */
export const monthsOfRent = (deposit: number, rent: number) => {
  const n = Math.round((deposit / rent) * 100) / 100;
  return n === 1 ? "1 month's rent" : `${n} months' rent`;
};
export { addDays, daysBetween, longDate, pacificDate };

export const MAIL_METHODS: [NoticeMethod, string][] = [["personal", "Personal delivery"], ["mail", "First-class mail"], ["email", "Email"]];
export const SIGNED: [NoticeMethod, string][] = [["signed", "Signed in person"], ["email", "Signed electronically"]];
export const RECEIVED: [NoticeMethod, string][] = [["mail", "Letter"], ["email", "Email"], ["text", "Text message"], ["personal", "Handed over"]];

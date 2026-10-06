// The words Jev's reasons check adds to a case or a turn (src/lib/jev.ts), in a module the pages can load: no client,
// no key, only text.

/** The adjustment a demoted reason adds, in the words the pages already show. */
export const demotedNote = (n: number, who: "advocate" | "negotiator") => `Line ${n}: the ${who}'s reason wasn't supported by the record, so the app's own reason is shown.`;

/** The adjustment for tenants' text that reads as instructions to an AI. It changes no answer, so the pages count it
 *  apart from the answers the app changed. */
export const INJECTION_NOTE = "The tenants' text reads like instructions aimed at an AI. The agents take it only as the tenants' account, and code still holds every figure to the lawful range.";

/** One quiet sentence for the pages' "how this was checked" tips, when the check ran. It marks nothing as verified. */
export const CHECKED_NOTE = "A fast model (TypeSafe's Jev) also compared each reason with the record, and the app replaced any reason the record contradicted.";

// The words an agent may write, and the words the app shows beside a case. Pure text, no model SDK and no database:
// the pages that show a dispute, the chargeback rules and the negotiator all need these, and none of them should load
// an agent (and with it the model SDKs) to render (docs/PERFORMANCE.md). The agents themselves are in advocate.ts,
// negotiator.ts and chargeback-agent.ts.

/** Shown with every case, on the tenants' page and the landlord's. */
export const NOT_LEGAL_ADVICE = "Not legal advice. Your advocate reads the records and the state's rules and drafts your case; it can't tell you what a court would decide.";

/** How the tenants' own photos are named to the model: by number only. A file name is the tenants' text and could
 *  carry instructions, so it never reaches the model. */
export const tenantPhotoLabel = (k: number) => `The tenants' photo ${k + 1}`;

/** Wording that goes past informing: telling the tenants to sue, naming a court or a judge, predicting who wins,
 *  threatening, promising. The system prompt forbids it; this catches what gets through anyway (the tenants' words and
 *  photos are model inputs, so an injection can steer wording, though never an amount). Over-cautious on purpose: a
 *  caught line falls back to the code's own reason, which is always true. */
const BEYOND_INFORMING: RegExp[] = [
  /\bsu(?:e|ed|es|ing)\b/i,
  /\blaw ?suits?\b/i,
  /\blitigat/i,
  /\bsmall[- ]claims\b/i,
  /\bcourts?\b/i,
  /\bjudges?\b/i,
  /\b(?:you|they|the landlord|your landlord|the tenants)(?:'ll| will| would| should| are going to| are likely to| are sure to)? (?:win|prevail)\b/i,
  /\blose (?:the|this|your|their) (?:case|suit|dispute)\b/i,
  /\bthreat/i,
  /\breport (?:you|them|him|her|the landlord|your landlord|it to)\b/i,
  /\bguarantee/i,
];
export const beyondInforming = (s: string) => BEYOND_INFORMING.some((re) => re.test(s));

/** Model text as the product shows it: no em or en dashes, no emojis, no runs of spaces, cut to a length. */
export function cleanText(s: unknown, max: number): string {
  const t = String(s ?? "")
    .replace(/\s*—\s*/g, ", ").replace(/\s+–\s+/g, ", ").replace(/–/g, "-")
    .replace(/\p{Extended_Pictographic}️?/gu, "")
    .replace(/[\u0000-\u0008\u000b-\u001f]/g, " ").replace(/[ \t]{2,}/g, " ").trim();
  return t.length > max ? `${t.slice(0, max - 3).replace(/\s+\S*$/, "")}...` : t;
}


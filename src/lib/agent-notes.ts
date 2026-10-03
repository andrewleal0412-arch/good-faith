// The close-out agent's own sentences, made fit to show: any statute it quoted comes out of the text (the citations
// go in a tip instead), and its last sentence group is the summary. Pure, so the server pages and the client share it.

import type { TimelineItem } from "./agent-timeline";

/** The statutes the state packs' rules cite: California's Civil Code, New York's General Obligations Law (and Real
 *  Property Law), Texas's Property Code, Florida Statutes and Washington's RCW. */
const STATUTE = String.raw`(?:(?:Cal\. )?Civ\. Code|(?:N\.Y\. )?GOL|(?:N\.Y\. )?RPL|Tex\. Prop\. Code|Fla\. Stat\.|RCW)`;

/** A quoted rule ("Civ. Code 1950.5(h)(1): the itemized statement...") with the words that lead into it. */
const QUOTED = new RegExp(String.raw`((?:As the rules? puts? it|In the rules' words|The rules? says?),?\s*)?(,?\s*\b(?:since|because|as|per|under)\s+)?["“](${STATUTE}) (?:§\s*)?([^:"”]+):[^"”]*?([.!?])?["”]`, "g");

/** "Cal. Civ. Code" reads "Civ. Code", as the rules list writes it. */
const statuteName = (s: string) => s.replace(/^Cal\. /, "");

/** The text without quoted statute, and the citations it quoted. */
export function stripQuotes(text: string): { text: string; cites: string[] } {
  const cites: string[] = [];
  const out = text.replace(QUOTED, (_m, sent: string | undefined, clause: string | undefined, statute = "", cite = "", end?: string) => {
    cites.push(`${statuteName(statute)} ${cite.trim()}`);
    if (sent) return "";
    if (clause) return end ?? "";
    return `${statuteName(statute)} ${cite.trim()}${end ?? ""}`;
  }).replace(/\s{2,}/g, " ").replace(/\s+([.,])/g, "$1").trim();
  return { text: out, cites: [...new Set(cites)] };
}

// A citation the agent wrote in its own words rather than quoted from the rules list: "(Civ. Code 1950.5(h)(2))" or
// "Under Civ. Code 1950.5(h)(1), you...". Its subsections are not checked against the rules (an early run cited (g)
// for (h)), so the summary drops them; the checked citations sit in the summary's tip.
const SECTION = String.raw`${STATUTE} (?:§\s*)?[\d.-]+(?:\([a-zA-Z0-9-]+\))*(?:(?:,|;| and| or)\s*(?:[\d.-]+)?(?:\([a-zA-Z0-9-]+\))+)*`;
const PAREN = new RegExp(String.raw`\s*\(${SECTION}\)`, "g");
const LEAD = new RegExp(String.raw`\b(?:Under|Per|By) ${SECTION},\s*(\w)`, "g");

/** The agent's text without citations it wrote from memory. */
export function withoutLooseCites(text: string): string {
  return text.replace(LEAD, (_m, c: string) => c.toUpperCase()).replace(PAREN, "").replace(/\s+([.,;])/g, "$1");
}

/** A page path in the agent's words, so it can be shown as a link. */
export const PAGE_PATH = /(\/tenancy\/[0-9a-f-]{36}(?:\/[a-z-]+)*)/;

export type Step = Extract<TimelineItem, { kind: "step" }>;

/** The run's tool steps, its summary (what the agent said after its last step, if anything) and every citation it
 *  quoted along the way. The narration before each step repeats the step's own title, so only the summary is shown. */
export function runNotes(items: TimelineItem[]): { steps: Step[]; summary: string[]; cites: string[] } {
  const steps = items.filter((it): it is Step => it.kind === "step");
  const lastStep = items.map((it) => it.kind).lastIndexOf("step");
  const says = items.map((it, i) => ({ it, i })).filter((x) => x.it.kind === "say");
  const all = says.map((x) => ({ i: x.i, ...stripQuotes((x.it as { text: string }).text) }));
  return {
    steps,
    summary: all.filter((x) => x.i > lastStep && x.text).map((x) => withoutLooseCites(x.text)),
    cites: [...new Set(all.flatMap((x) => x.cites))],
  };
}

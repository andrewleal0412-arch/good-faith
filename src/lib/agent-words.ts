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

/** A citation written into free text (a reason, a message, a summary) that isn't one of the state's citations, or
 *  null when every one is. The citation field is held to the list by its own check; this reads the words around it,
 *  so a section number from the model's memory can't ride inside a reason under the Checked mark. A reference is a
 *  code's name (Civ. Code, GOL, RPL, Tex. Prop. Code, Fla. Stat., RCW, a spelled-out form, or another code's such as
 *  the Penal Code or the Code of Civil Procedure) and a section number
 *  with any subdivisions (1950.5(b)(2), 7-108(1-a)(e), 59.18.280); Section, § or a chapter before a dotted or
 *  subdivided number; a bare section with a subdivision or three dotted parts; or a bill (AB 2801). A plain number
 *  after Section or Chapter ("section 3 of the lease") isn't one. It is covered when an allowed citation holds its
 *  section as a whole number (inside "92.101 to 92.113" counts), its code's name when it names one, and its
 *  subdivisions as a chain (a range's ends count: (b)(2)-(3) covers (b)(3)), so a shortened form of an allowed
 *  citation passes and "Civ. Code 1950.5" always does in California. Over-cautious like beyondInforming: a caught
 *  line falls back to the code's own words. */
export function strayCitation(text: string, allowed: Iterable<string>): string | null {
  const cites = [...allowed].map((c) => expandSubs(normCite(c)));
  for (const m of text.replace(/\u00a0/g, " ").matchAll(CITATION_REF)) {
    const bill = m.groups?.bill, headRaw = m.groups?.head, section = m.groups?.section ?? "", subs = m.groups?.subs ?? "";
    const head = headRaw && !GENERIC_HEAD.test(headRaw) ? CODE_HEADS.find(([re]) => re.test(headRaw))?.[1] ?? normCite(headRaw) : null;
    const parts = section.split(/[.-]/).length;
    const dotted = section.includes(".");
    if (!bill && !head && !subs && !(parts >= 3 && dotted) && !(headRaw && parts >= 2)) continue;
    if (/^\d{4}-\d/.test(section)) continue; // a date
    const sec = bill ? normCite(bill).replace(/^([as]b) ?/, "$1 ") : normCite(section);
    const chains = expandSubs(normCite(subs)).split(" ").filter(Boolean);
    const covered = cites.some((c) => (!head || c.includes(head)) && holdsSection(c, sec) && chains.every((p) => c.includes(p)));
    if (!covered) return m[0].trim();
  }
  return null;
}
const normCite = (s: string) => s.toLowerCase().replace(/§/g, "").replace(/\s+/g, " ").trim();
/** "(b)(2)-(3)" as "(b)(2) (b)(3)", so a range's ends can be found as chains. */
const expandSubs = (s: string) => s.replace(/((?:\([^)]*\))*)\((\w+)\)-\((\w+)\)/g, "$1($2) $1($3)");
/** Whether `sec` is in `cite` as a whole section number (1950.5 in "1950.5(b)", not 92 in "92.104"), or inside a
 *  "92.101 to 92.113" range of the same prefix. */
function holdsSection(cite: string, sec: string): boolean {
  for (let at = cite.indexOf(sec); at >= 0; at = cite.indexOf(sec, at + 1)) {
    if (!/[\d.\-]/.test(cite[at - 1] ?? " ") && !/[\d.\-]/.test(cite[at + sec.length] ?? " ")) return true;
  }
  const last = sec.lastIndexOf("."), prefix = sec.slice(0, last + 1), n = Number(sec.slice(last + 1));
  if (last < 0 || !Number.isFinite(n)) return false;
  for (const r of cite.matchAll(/(\d[\d.]*) to (\d[\d.]*)/g)) {
    const [a, b] = [r[1], r[2]];
    if (a.startsWith(prefix) && b.startsWith(prefix) && n >= Number(a.slice(prefix.length)) && n <= Number(b.slice(prefix.length))) return true;
  }
  return false;
}
/** Section, § and a chapter name no code. */
const GENERIC_HEAD = /^(?:§+|section|sec\.|chapter|ch\.|subdivision|subd\.)$/i;
/** The names a model gives a code, each with the form the packs' citations use; any other code's name (Penal Code)
 *  is itself, which no pack's citation holds. */
const CODE_HEADS: [RegExp, string][] = [
  [/^(?:cal\.? )?civ(?:il)?\.? code$|^cal\.? civ\.?$|^cc$/i, "civ. code"],
  [/gol|oblig/i, "gol"],
  [/rpl|real prop/i, "rpl"],
  [/tex(?:as|\.) prop|^prop(?:erty)?\.? code$/i, "tex. prop. code"],
  [/fla|florida/i, "fla. stat."],
  [/^rcw$|wash\.? rev|revised code of washington/i, "rcw"],
];
const CITATION_REF = new RegExp(String.raw`\b(?<bill>[AS]B ?\d{2,4})\b|(?:(?<![A-Za-z])(?<head>(?:Cal\.? )?Civ(?:il)?\.? Code|Cal\.? Civ\.?|CC|(?:N\.?Y\.? )?GOL|Gen(?:eral|\.) Oblig(?:ations|\.) Law|(?:N\.?Y\.? )?RPL|Real Property Law|Tex(?:as|\.) Prop(?:erty|\.) Code|Property Code|Fla\.? Stat\.?|Florida Statutes?|RCW|Wash\.? Rev\.? Code|Revised Code of Washington|(?:(?:[A-Z][a-z]{0,4}\.|Penal|Health|Safety|Evidence|Government|Gov't|Business|Professions|Commerce|Civil|Procedure|Insurance|Labor|Welfare|Institutions|Administrative|Admin\.?) ?(?:and |& )?){1,4}Code|Code (?:of )?Civ(?:il)?\.? Proc(?:edure|\.)?|CCP|WAC|Wash\.? Admin\.? Code|§+|[Ss]ection|[Ss]ec\.|[Cc]hapter|[Cc]h\.|[Ss]ubdivision|[Ss]ubd\.)\s*(?:§+|[Ss]ection|[Ss]ec\.)?\s*)?\b(?<section>\d{1,5}(?:[.\-]\d{1,5})*(?:-[a-z]\b)?)(?<subs>(?:-?\([A-Za-z0-9\-]+\))*)`, "gi");

/** Model text as the product shows it: no em or en dashes, no emojis, no runs of spaces, cut to a length. */
export function cleanText(s: unknown, max: number): string {
  const t = String(s ?? "")
    .replace(/\s*—\s*/g, ", ").replace(/\s+–\s+/g, ", ").replace(/–/g, "-")
    .replace(/\p{Extended_Pictographic}️?/gu, "")
    .replace(/[\u0000-\u0008\u000b-\u001f]/g, " ").replace(/[ \t]{2,}/g, " ").trim();
  return t.length > max ? `${t.slice(0, max - 3).replace(/\s+\S*$/, "")}...` : t;
}


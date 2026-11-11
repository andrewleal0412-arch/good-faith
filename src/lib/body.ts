// Reading what a route was sent, with limits first. Next accepts a body up to the proxy's limit (4.5 MB), and a route
// that parses all of it, or runs a pattern over it, can be made to spend the one server's memory or time on a single
// request (docs/AUDIT.md, "Security pass"). These read a capped body and check the size of a value before its shape.

/** A request's JSON body, or null when it is missing, malformed, or longer than `max` characters. The text is read and
 *  measured before anything parses it. */
export async function readJson(req: Request, max: number): Promise<unknown> {
  if (Number(req.headers.get("content-length") ?? 0) > max) return null;
  const raw = await req.text().catch(() => "");
  if (!raw || raw.length > max) return null;
  try {
    return JSON.parse(raw);
  } catch {
    return null;
  }
}

/** True for a string that looks like one email address. The length is checked first: the pattern backtracks on a long
 *  run of dots, and an address is at most 254 characters. */
export const isEmail = (v: unknown): v is string => typeof v === "string" && v.length <= 254 && /^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(v);

/** The value as a list of at most `most` strings of at most `longest` characters each, or null when it is anything else. */
export function stringList(v: unknown, most: number, longest: number): string[] | null {
  return Array.isArray(v) && v.length <= most && v.every((s) => typeof s === "string" && s.length <= longest) ? (v as string[]) : null;
}

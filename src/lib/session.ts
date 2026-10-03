import { createHmac, randomUUID, timingSafeEqual } from "node:crypto";

// The demo access gate: one access code for the judges, one for the owner, and a signed session cookie. Shared by the
// proxy (src/proxy.ts), which checks the cookie on every request, and the route handlers, which read the session to
// apply the daily limits (src/lib/limits.ts). No Next.js imports here, so the proxy can load it.
//
// The environment is read when a request arrives, not when the app is built (see docs/DEPLOY.md), so changing a code
// or the secret on the host takes a restart, not a rebuild.

export const SESSION_COOKIE = "gf_session";
export const SESSION_DAYS = 7;
const SESSION_SECONDS = SESSION_DAYS * 24 * 60 * 60;

export type SessionKind = "owner" | "demo";

/** What the cookie carries. `sid` is the session's own id: the owner always gets "owner", each demo sign-in a new
 *  uuid. The daily limits count by it, and it is the key a per-session workspace hangs off. */
export type Session = { v: 1; kind: SessionKind; sid: string; iat: number; exp: number };

/** The owner's session when the gate is off (local development with no codes set). */
export const OWNER_SID = "owner";
export const LOCAL_OWNER: Session = { v: 1, kind: "owner", sid: OWNER_SID, iat: 0, exp: Number.MAX_SAFE_INTEGER };

/** off: no access code and not production, so local dev stays open and every request is the owner.
 *  unconfigured: production without a code or secret, so the gated pages say the demo is not configured.
 *  on: every gated request needs a signed session. */
export type Gate =
  | { mode: "off" }
  | { mode: "unconfigured" }
  | { mode: "on"; secret: string; accessCode: string; ownerCode: string | null };

/** The secret signs the cookie, so a short one could be guessed offline from one cookie. */
const MIN_SECRET = 32;

export function gate(): Gate {
  const accessCode = (process.env.GOOD_FAITH_ACCESS_CODE ?? "").trim();
  const secret = (process.env.GOOD_FAITH_SESSION_SECRET ?? "").trim();
  const ownerCode = (process.env.GOOD_FAITH_OWNER_CODE ?? "").trim();
  if (!accessCode) return process.env.NODE_ENV === "production" ? { mode: "unconfigured" } : { mode: "off" };
  // A code without a secret to sign the session with is half set up: closed, in every environment.
  if (secret.length < MIN_SECRET) return { mode: "unconfigured" };
  // An owner code equal to the judges' code would hand every judge the owner's session; it is ignored instead.
  return { mode: "on", secret, accessCode, ownerCode: ownerCode && ownerCode !== accessCode ? ownerCode : null };
}

const b64url = (b: Buffer | string) => Buffer.from(b).toString("base64url");
const mac = (secret: string, body: string) => createHmac("sha256", secret).update(`gf-session.${body}`).digest();

/** A new signed cookie value for this kind of session. */
export function issueSession(kind: SessionKind, secret: string, now = Date.now()): { value: string; session: Session } {
  const iat = Math.floor(now / 1000);
  const session: Session = { v: 1, kind, sid: kind === "owner" ? OWNER_SID : randomUUID(), iat, exp: iat + SESSION_SECONDS };
  const body = b64url(JSON.stringify(session));
  return { value: `${body}.${b64url(mac(secret, body))}`, session };
}

const SID_RE = /^(owner|[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})$/;

/** The session in a cookie value, or null when it is missing, malformed, signed with another secret, or expired. */
export function readSession(value: string | undefined | null, secret: string, now = Date.now()): Session | null {
  if (!value || value.length > 600) return null;
  const dot = value.indexOf(".");
  if (dot < 1 || dot !== value.lastIndexOf(".")) return null;
  const body = value.slice(0, dot);
  const given = Buffer.from(value.slice(dot + 1), "base64url");
  const want = mac(secret, body);
  if (given.length !== want.length || !timingSafeEqual(given, want)) return null;
  let s: Partial<Session>;
  try {
    s = JSON.parse(Buffer.from(body, "base64url").toString("utf8"));
  } catch {
    return null;
  }
  if (!s || s.v !== 1 || (s.kind !== "owner" && s.kind !== "demo") || typeof s.sid !== "string" || !SID_RE.test(s.sid)) return null;
  if ((s.kind === "owner") !== (s.sid === OWNER_SID)) return null;
  if (typeof s.iat !== "number" || typeof s.exp !== "number" || s.exp * 1000 <= now || s.iat * 1000 > now + 60_000) return null;
  return s as Session;
}

/** Which kind of session a typed code opens, compared in constant time: both codes are always checked, through an
 *  HMAC, so neither the length nor the first wrong character shows in the timing. */
export function matchCode(entered: string, g: Extract<Gate, { mode: "on" }>): SessionKind | null {
  const digest = (s: string) => createHmac("sha256", g.secret).update(`gf-code.${s}`).digest();
  const typed = digest(entered.trim());
  const isOwner = timingSafeEqual(typed, digest(g.ownerCode ?? `\u0000no-owner-code.${g.secret}`)) && !!g.ownerCode;
  const isDemo = timingSafeEqual(typed, digest(g.accessCode));
  return isOwner ? "owner" : isDemo ? "demo" : null;
}

/** The cookie's attributes: HttpOnly, SameSite=Lax, seven days, and Secure in production. */
export function cookieOptions(maxAge = SESSION_SECONDS) {
  return { httpOnly: true, sameSite: "lax" as const, secure: process.env.NODE_ENV === "production", path: "/", maxAge };
}

/** The access page's plain messages, shared by the form's route and the page that shows them. */
export const ACCESS_MESSAGES = {
  wrong: "That code didn't work. Check it and try again.",
  throttled: "Too many tries. Wait 10 minutes and try again.",
  unconfigured: "This demo is not configured.",
  empty: "Enter the access code.",
  otherSite: "Open the access page on this site and try again.",
  crossSite: "That request came from another site, so it wasn't run.",
  signedOut: "Your session ended. Enter the access code again.",
} as const;

/** False for a browser request sent from another site (its Origin names another host). A request without an Origin
 *  (curl, the demo seed) is not a browser form on another site, so it passes. */
export function sameOrigin(headers: Headers): boolean {
  const origin = headers.get("origin");
  if (!origin) return true;
  const host = headers.get("x-forwarded-host")?.split(",")[0]?.trim() || headers.get("host");
  try {
    return !!host && new URL(origin).host === host;
  } catch {
    return false;
  }
}

/** Where to go after the code: a path on this site only (no "//host" or "/\host", which browsers read as another
 *  site), never back to the access page, and "/" when there is nothing usable. */
export function safeNext(next: unknown): string {
  if (typeof next !== "string" || !next.startsWith("/") || next.startsWith("//") || next.startsWith("/\\")) return "/";
  if (next.length > 512 || /[\u0000-\u001f]/.test(next)) return "/";
  if (next === "/access" || next.startsWith("/access?") || next.startsWith("/api/")) return "/";
  return next;
}

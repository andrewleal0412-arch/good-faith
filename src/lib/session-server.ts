import "server-only";
import { cookies } from "next/headers";
import { gate, LOCAL_OWNER, readSession, SESSION_COOKIE, type Session } from "./session";

/** The session of the request being handled: the owner when the gate is off (local dev with no codes), the signed
 *  cookie's session when it is on, and null when there is none (or the demo is not configured). */
export async function currentSession(): Promise<Session | null> {
  const g = gate();
  if (g.mode === "off") return LOCAL_OWNER;
  if (g.mode === "unconfigured") return null;
  return readSession((await cookies()).get(SESSION_COOKIE)?.value, g.secret);
}

/** Whether the account menu offers Sign out: only when there is a session to end. */
export const canSignOut = () => gate().mode === "on";

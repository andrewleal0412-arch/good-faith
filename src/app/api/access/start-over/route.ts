import { NextResponse } from "next/server";
import { clientAddress } from "@/lib/access-throttle";
import { ACCESS_MESSAGES as M, cookieOptions, gate, issueSession, sameOrigin, SESSION_COOKIE } from "@/lib/session";
import { currentSession } from "@/lib/session-server";
import { createDemoCopy } from "@/lib/workspace";

export const runtime = "nodejs";

// Start over, from the account menu of a demo copy: a fresh copy of the demo for this browser, under the same daily
// copy limits as entering the code. The session keeps its id, so the per-session daily limits carry over; the old
// copy gives back a sandbox deposit it never used and is left for the sweep (scripts/demo-sweep.mjs). Gated: only a
// demo session can start over. The owner's workspace has nothing to start over from.
export async function POST(req: Request) {
  if (!sameOrigin(req.headers)) return Response.json({ error: M.crossSite }, { status: 403 });
  const g = gate();
  const s = await currentSession();
  if (g.mode !== "on" || !s) return Response.json({ error: M.signedOut }, { status: 401 });
  if (s.kind !== "demo") return Response.json({ error: "Start over is for a demo copy. The owner's data stays as it is." }, { status: 400 });

  const copy = await createDemoCopy(clientAddress(req.headers), s.ws);
  if (!copy.ok) return Response.json({ error: copy.message }, { status: copy.status });
  const { value } = issueSession("demo", g.secret, { ws: copy.ws, sid: s.sid });
  const res = NextResponse.json({ ok: true });
  res.headers.set("Cache-Control", "no-store");
  res.cookies.set(SESSION_COOKIE, value, cookieOptions());
  return res;
}

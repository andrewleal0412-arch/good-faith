import { e2eStubs } from "@/lib/e2e-switch";
import { ownerReadout } from "@/lib/health";
import { currentSession } from "@/lib/session-server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// The host's health check (Render pings it). Public and data-free: it says the server answers, nothing else. Only on
// the judges'-path test's server (src/lib/e2e-switch.ts, never on Render) a header says the stubs are on, so the test
// refuses to run against a server that would call Claude or PayPal for real.
//
// With ?owner=1 and the owner's session (src/lib/session-server.ts: never a demo copy's, never without one), it answers
// the owner's readout instead (src/lib/health.ts): the pool, today's copies and today's Claude jobs against their
// limits. Anyone else asking gets the public answer, so the route gives nothing away.
export async function GET(req: Request) {
  const headers = { "Cache-Control": "no-store", ...(e2eStubs() ? { "X-Good-Faith-E2E-Stubs": "on" } : {}) };
  if (new URL(req.url).searchParams.get("owner") === "1" && (await currentSession())?.kind === "owner") {
    const readout = await ownerReadout();
    return Response.json(readout, { status: readout.ok ? 200 : 503, headers });
  }
  return Response.json({ ok: true }, { headers });
}

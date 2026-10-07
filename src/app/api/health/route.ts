import { e2eStubs } from "@/lib/e2e-switch";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// The host's health check (Render pings it). Public and data-free: it says the server answers, nothing else. Only on
// the judges'-path test's server (src/lib/e2e-switch.ts, never on Render) a header says the stubs are on, so the test
// refuses to run against a server that would call Claude or PayPal for real.
export function GET() {
  return Response.json({ ok: true }, { headers: { "Cache-Control": "no-store", ...(e2eStubs() ? { "X-Good-Faith-E2E-Stubs": "on" } : {}) } });
}

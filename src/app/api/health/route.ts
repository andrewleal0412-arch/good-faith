export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// The host's health check (Render pings it). Public and data-free: it says the server answers, nothing else.
export function GET() {
  return Response.json({ ok: true }, { headers: { "Cache-Control": "no-store" } });
}

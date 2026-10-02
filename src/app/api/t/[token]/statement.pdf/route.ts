import { audit, db } from "@/lib/db";
import { buildStatement } from "@/lib/statement";
import { buildStatementPdf } from "@/lib/statement-pdf";
import { resolveTenantToken, tokenNotFound } from "@/lib/tenant-links";

export const runtime = "nodejs";
export const maxDuration = 60;

// The itemized statement packet for the tenants, by their link token: the same PDF the landlord sent, with the
// photo exhibits and invoice copies (Civ. Code 1950.5(h)(2)). Only once it has been delivered; until then the
// statement is the landlord's draft and this route, like every other answer to a token it won't serve, is a 404.
// Opens in the browser; "?download=1" saves it instead.
export async function GET(req: Request, ctx: RouteContext<"/api/t/[token]/statement.pdf">) {
  const { token } = await ctx.params;
  const link = await resolveTenantToken(token);
  if (!link) return tokenNotFound();
  const download = new URL(req.url).searchParams.get("download") === "1";
  try {
    const s = await buildStatement(link.tenancyId);
    if (!s || !s.delivery) return tokenNotFound();
    const { bytes, filename } = await buildStatementPdf(s);
    // The tenants may open it many times; the landlord's log keeps one row a day.
    const { data: recent } = await db.from("audit_log").select("id").eq("tenancy_id", link.tenancyId).eq("action", "tenant_opened_statement")
      .gte("created_at", new Date(Date.now() - 86_400_000).toISOString()).limit(1);
    if (!recent?.length) await audit(link.tenancyId, "tenant", "tenant_opened_statement", { link_id: link.linkId });
    return new Response(new Uint8Array(bytes), {
      headers: {
        "Content-Type": "application/pdf",
        "Content-Disposition": `${download ? "attachment" : "inline"}; filename="${filename}"`,
        "Cache-Control": "no-store",
      },
    });
  } catch (e) {
    console.error("tenant statement pdf failed", e);
    return Response.json({ error: "Couldn't build the statement right now. Try again in a minute." }, { status: 500 });
  }
}

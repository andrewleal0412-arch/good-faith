import { audit, db } from "@/lib/db";
import { buildStatement } from "@/lib/statement";
import { buildStatementPdf } from "@/lib/statement-pdf";
import { isTemplate, routeTenancy } from "@/lib/workspace";

export const runtime = "nodejs";
export const maxDuration = 60;

// One PDF packet to mail or email: the itemized statement, the photo evidence for each deduction, and every vendor
// invoice (Civ. Code 1950.5(h)(2)). Read-only apart from the audit entry. "?inline=1" shows it in the browser (to
// print from); otherwise it downloads.
export async function GET(req: Request, ctx: RouteContext<"/api/tenancies/[id]/statement/pdf">) {
  const { id } = await ctx.params;
  const ws = await routeTenancy(id);
  if (ws instanceof Response) return ws;
  const inline = new URL(req.url).searchParams.get("inline") === "1";
  try {
    const s = await buildStatement(id);
    if (!s) return Response.json({ error: "No such tenancy." }, { status: 404 });
    const { bytes, pages, filename } = await buildStatementPdf(s);
    // The download changes nothing, and a landlord opens the packet many times, so the log keeps one row a day (and
    // none on a template, which nothing writes to).
    const { data: recent } = await db.from("audit_log").select("id").eq("tenancy_id", id).eq("action", "statement_packet_built")
      .gte("created_at", new Date(Date.now() - 86_400_000).toISOString()).limit(1);
    if (!recent?.length && !(await isTemplate(id))) await audit(id, "landlord", "statement_packet_built", { pages, filename });
    return new Response(new Uint8Array(bytes), {
      headers: {
        "Content-Type": "application/pdf",
        "Content-Disposition": `${inline ? "inline" : "attachment"}; filename="${filename}"`,
        "Cache-Control": "no-store",
      },
    });
  } catch (e) {
    console.error("statement pdf failed", e);
    return Response.json({ error: e instanceof Error ? e.message : "Couldn't build the packet." }, { status: 500 });
  }
}

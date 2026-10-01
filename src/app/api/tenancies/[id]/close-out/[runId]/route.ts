import { answerApproval } from "@/lib/agent";

export const runtime = "nodejs";
export const maxDuration = 300;

// The landlord approves or declines the money movement the agent proposed; the run then resumes.
export async function POST(req: Request, ctx: RouteContext<"/api/tenancies/[id]/close-out/[runId]">) {
  const { id, runId } = await ctx.params;
  const { approved } = (await req.json()) as { approved?: boolean };
  if (typeof approved !== "boolean") return Response.json({ error: "Approve or decline." }, { status: 400 });
  try {
    return Response.json(await answerApproval(id, runId, approved));
  } catch (e) {
    return Response.json({ error: e instanceof Error ? e.message : "Couldn't record that." }, { status: 400 });
  }
}

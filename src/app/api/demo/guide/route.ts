import { demoGuideSteps } from "@/lib/demo-guide-server";
import { canSignOut } from "@/lib/session-server";
import { currentWorkspace } from "@/lib/workspace";

export const runtime = "nodejs";

// The demo guide's eight steps for this copy, read again (components/demo-guide.tsx). The guide is rendered in the
// landlord layout, and Next keeps a layout it has already rendered when a click opens another page under it, so without
// this the ticks and the links would be the ones from the last full load: a judge who disputed in the tenants' tab and
// then moved around the landlord side by the sidebar would see a beat they had done still waiting. The panel asks here
// when the page changes under it and when the window is given focus again.
//
// Only a private demo copy has a guide: the owner's workspace gets the same 404 as a copy that isn't there, and a
// request without a session never reaches this route (src/proxy.ts). It reads nothing but the session's own workspace.
export async function GET() {
  const ws = await currentWorkspace();
  if (!canSignOut() || ws?.kind !== "demo") {
    return Response.json({ error: "No demo guide here." }, { status: 404, headers: { "Cache-Control": "no-store" } });
  }
  return Response.json({ steps: await demoGuideSteps() }, { headers: { "Cache-Control": "no-store" } });
}

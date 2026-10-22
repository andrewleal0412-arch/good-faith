import { demoWelcome } from "@/lib/demo-guide-server";
import { canSignOut } from "@/lib/session-server";
import { currentWorkspace } from "@/lib/workspace";

export const runtime = "nodejs";

// The welcome's words for this copy, read again (components/demo-welcome.tsx). Like the guide's steps
// (api/demo/guide), they are rendered in the landlord layout, which Next keeps when a click opens another page under
// it, so a welcome opened again from the account menu after a judge closed out the move-out would still ask them to
// close it out. The card asks here each time the account menu opens it.
//
// Only a private demo copy has a welcome: the owner's workspace gets the same 404 as a copy that isn't there, and a
// request without a session never reaches this route (src/proxy.ts). It reads nothing but the session's own workspace.
export async function GET() {
  const ws = await currentWorkspace();
  if (!canSignOut() || ws?.kind !== "demo") {
    return Response.json({ error: "No welcome here." }, { status: 404, headers: { "Cache-Control": "no-store" } });
  }
  return Response.json({ welcome: await demoWelcome() }, { headers: { "Cache-Control": "no-store" } });
}

import type { ReactNode } from "react";
import { DemoFrame } from "@/components/demo-frame";
import { canSignOut } from "@/lib/session-server";
import { resolveTenantToken } from "@/lib/tenant-links";
import { currentWorkspace, ownedTenancy } from "@/lib/workspace";

// The tenants' pages as a judge sees them in their own demo copy: the same pages, with the Landlord | Tenants switch
// above and the next-step bar at the foot (components/demo-frame.tsx), so playing the tenants is one click from the
// landlord's side and one click back. A real tenant's link, and any link opened without the session whose copy it is,
// shows the pages alone: nothing here says a demo exists. The token is checked without stamping the link as seen; the
// page itself does that.
export default async function TenantLayout({ children, params }: { children: ReactNode; params: Promise<{ token: string }> }) {
  const { token } = await params;
  return (await judgesOwn(token)) ? <DemoFrame side="tenants">{children}</DemoFrame> : children;
}

/** The token opens a tenancy of the session's own demo copy. */
async function judgesOwn(token: string): Promise<boolean> {
  if (!canSignOut()) return false;
  try {
    const ws = await currentWorkspace();
    if (ws?.kind !== "demo") return false;
    const link = await resolveTenantToken(token, { touch: false });
    return !!link && !!(await ownedTenancy(link.tenancyId));
  } catch (e) {
    console.error("Tenants' pages: couldn't tell whether this is a demo copy", e);
    return false;
  }
}

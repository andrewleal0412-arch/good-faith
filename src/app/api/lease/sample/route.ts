import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { db } from "@/lib/db";
import { DEMO_LEASE_FILE, DEMO_LEASE_TERMS } from "@/lib/demo-lease";
import { leaseResult } from "@/lib/lease-result";
import { ACCESS_MESSAGES } from "@/lib/session";
import { currentWorkspace, uploadPrefix } from "@/lib/workspace";

export const runtime = "nodejs";

// The sample lease (demo/lease-single-owner.pdf, src/lib/demo-lease.ts). GET is the PDF itself, to read or to drop on
// the lease page for a live read. POST checks it the way api/lease checks an upload, from the facts Claude read when
// the demo was built: no Claude call, nothing taken from the day's allowance, and the PDF goes to the workspace's
// own leases folder all the same, so the tenancy started from it has its lease on file. One copy per workspace: its
// name is a UUID made from the workspace's id (api/tenancies takes only ws/<uuid>/<uuid>.pdf), so checking the sample
// again overwrites it, and a button with no allowance can't fill the storage the live demo shares.
const pdf = () => readFile(join(process.cwd(), "demo", DEMO_LEASE_FILE));

function sampleName(wsId: string): string {
  const h = createHash("sha256").update(`sample-lease:${wsId}`).digest("hex");
  return `${h.slice(0, 8)}-${h.slice(8, 12)}-${h.slice(12, 16)}-${h.slice(16, 20)}-${h.slice(20, 32)}.pdf`;
}

export async function GET() {
  const ws = await currentWorkspace();
  if (!ws) return Response.json({ error: ACCESS_MESSAGES.signedOut }, { status: 401 });
  return new Response(new Uint8Array(await pdf()), {
    headers: { "Content-Type": "application/pdf", "Content-Disposition": `inline; filename="${DEMO_LEASE_FILE}"`, "Cache-Control": "private, max-age=3600" },
  });
}

export async function POST() {
  const ws = await currentWorkspace();
  if (!ws) return Response.json({ error: ACCESS_MESSAGES.signedOut }, { status: 401 });
  try {
    const bytes = new Uint8Array(await pdf());
    const leasePath = `${uploadPrefix(ws)}${sampleName(ws.id)}`;
    const upload = await db.storage.from("leases").upload(leasePath, bytes, { contentType: "application/pdf", upsert: true });
    if (upload.error) console.error("sample lease upload failed", upload.error.message);
    return Response.json(leaseResult(structuredClone(DEMO_LEASE_TERMS), upload.error ? null : leasePath));
  } catch (e) {
    console.error("sample lease check failed", e);
    return Response.json({ error: "Couldn't read the sample lease. Try again." }, { status: 500 });
  }
}

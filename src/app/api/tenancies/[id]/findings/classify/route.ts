import { db } from "@/lib/db";
import { jevConfigured, readable, readFinding, sealRead } from "@/lib/jev";
import { takeAllowance } from "@/lib/limits";
import { ACCESS_MESSAGES } from "@/lib/session";
import { packFor } from "@/lib/states";
import { currentWorkspace, isUuid } from "@/lib/workspace";

export const runtime = "nodejs";

// The finding form's read as the landlord types (src/lib/jev.ts): Jev reads what changed and what the photo shows as
// damage, cleaning, wear and tear or unclear under the property's state rules. Only those words go, with the tenancy's
// names and addresses taken out, and the state's finding rules; the key stays here. One unit of the day's Jev
// allowance per read (src/lib/limits.ts), given back only when TypeSafe refused it or couldn't be reached
// (jevNeverAnswered): a read cancelled or timed out after it went out keeps its unit, so cancelling can't get round
// the limit. The read comes back sealed (sealRead), so the finding's audit records only what Jev said, for these
// words. A slow (1.5 s) or failed read answers { read: null }: the form keeps working as it does without one. No
// TypeSafe key: 404, and the form never asks.

const text = (v: unknown, max: number) => (typeof v === "string" ? v.replace(/[\u0000-\u001f]/g, " ").trim().slice(0, max) : "");

export async function POST(req: Request, ctx: RouteContext<"/api/tenancies/[id]/findings/classify">) {
  if (!jevConfigured()) return Response.json({ error: "Not available." }, { status: 404 });
  const { id } = await ctx.params;
  const ws = await currentWorkspace();
  if (!ws) return Response.json({ error: ACCESS_MESSAGES.signedOut }, { status: 401 });
  if (!isUuid(id)) return Response.json({ error: "No such tenancy." }, { status: 404 });
  const b = (await req.json().catch(() => null)) as Record<string, unknown> | null;
  const item = text(b?.item, 120), observation = text(b?.observation, 600);
  if (!readable(item, observation)) return Response.json({ read: null });

  // The workspace check and the names to take out in one read (a tenancy in another workspace reads as none), beside
  // the day's allowance.
  const [{ data: t }, allowance] = await Promise.all([
    db.from("tenancies").select("tenants, refund_agreement, tenant_move_out, statement_delivery, properties(address, owner_name, state)")
      .eq("id", id).eq("workspace_id", ws.id).maybeSingle(),
    takeAllowance("jev"),
  ]);
  if (!t) {
    if (!allowance.refused) await allowance.giveBack();
    return Response.json({ error: "No such tenancy." }, { status: 404 });
  }
  if (allowance.refused) return allowance.refused;
  const prop = t.properties as unknown as { address: string | null; owner_name: string | null; state: string | null } | null;
  const tenants = (t.tenants ?? []) as { name?: string }[];
  const agreement = t.refund_agreement as { signed_by?: string[] } | null;
  const moveOut = t.tenant_move_out as { name?: string | null; forwarding_address?: string | null } | null;
  const mailed = t.statement_delivery as { address?: string | null } | null;
  // Every email address and phone number goes too, whoever's (redactor).
  const { read, spent } = await readFinding({ item, observation }, packFor(prop?.state ?? "CA"), {
    known: {
      names: [...tenants.map((x) => x.name), ...(agreement?.signed_by ?? []), moveOut?.name, prop?.owner_name],
      addresses: [prop?.address, moveOut?.forwarding_address, mailed?.address],
    },
    signal: req.signal, // the form cancels a read it no longer needs (the landlord typed on): Jev's call stops too
  });
  if (!spent) await allowance.giveBack();
  return Response.json({ read: read ? { ...read, seal: sealRead(id, { item, observation }, read) } : null });
}

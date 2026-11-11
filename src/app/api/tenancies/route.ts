import { z } from "zod";
import { readJson } from "@/lib/body";
import { audit, db } from "@/lib/db";
import { leaseKey } from "@/lib/lease-key";
import { takeAllowance } from "@/lib/limits";
import { evaluateLease, type LeaseTerms } from "@/lib/rules";
import { ACCESS_MESSAGES } from "@/lib/session";
import { isSupported, packFor, stateCode, unsupportedMessage } from "@/lib/states";
import { currentWorkspace, uploadPrefix } from "@/lib/workspace";

export const runtime = "nodejs";

// The lease terms as the lease check returns them (src/lib/extract.ts), checked here because the browser sends them
// back: a malformed body gets a plain 400 instead of failing halfway, and every field has a sane size, so an open demo
// can't store a megabyte of "tenant names". The bounds are far above any real lease.
const text = (max: number) => z.string().max(max);
const amount = z.number().finite().min(0).max(100_000_000);
const count = z.number().finite().min(0).max(100_000);
const termsSchema = z.object({
  propertyAddress: text(300).nullable(),
  city: text(120).nullable(),
  state: text(40).nullable().optional(),
  landlordName: text(200).nullable(),
  ownerType: z.enum(["natural_person", "llc_natural_persons", "llc_other", "corporation", "unknown"]),
  ownerPropertyCount: count.nullable(),
  ownerUnitCount: count.nullable(),
  buildingUnitCount: count.nullable().optional(),
  tenants: z.array(text(200)).max(20),
  tenancyStartDate: text(40).nullable(),
  leaseEndDate: text(40).nullable().optional(),
  monthlyRent: amount.nullable(),
  securityDeposit: amount.nullable(),
  otherMoveInCharges: z.array(z.object({ label: text(200), amount, refundable: z.boolean().nullable(), quote: text(2000) })).max(30),
  nonrefundableLanguage: z.array(text(2000)).max(30),
  lateFee: z.object({
    amount: amount.nullable(), percentOfRent: z.number().finite().min(0).max(100).nullable(),
    deductibleFromDeposit: z.boolean(), quote: text(2000),
  }).nullable(),
  mandatoryCleaningClause: text(2000).nullable(),
  electronicPaymentMethods: z.array(text(100)).max(20),
  tenantIsServiceMember: z.boolean().nullable(),
}) satisfies z.ZodType<LeaseTerms>;

const bodySchema = z.object({
  terms: termsSchema,
  // The state the landlord confirmed on the lease check (the lease's own, or the one picked). Without it, the lease's.
  state: z.string().max(40).nullable().optional(),
  // The name the lease check gave the stored PDF (src/app/api/lease/route.ts): ws/<workspace>/<uuid>.pdf, or null when
  // it wasn't stored. The workspace must be the session's own, checked below.
  leasePath: z.string().regex(/^ws\/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\.pdf$/).nullable().optional(),
});

/** The tenancy in this workspace that this lease already has, if there is one: the same property address and the same
 *  tenants (src/lib/lease-key.ts), oldest first. Read only in a demo copy, where every demo lease already has its
 *  tenancy and a second one of it is nothing but confusing; the owner's workspace may hold the same lease twice on
 *  purpose (the demo seed does, with `npm run demo:seed -- --fresh`). */
async function tenancyFromSameLease(workspaceId: string, terms: LeaseTerms): Promise<string | null> {
  const key = leaseKey({ address: terms.propertyAddress, tenants: terms.tenants });
  if (!key) return null;
  const { data, error } = await db.from("tenancies").select("id, tenants, properties(address)").eq("workspace_id", workspaceId).order("created_at");
  if (error || !data) return null;
  const rows = data as unknown as { id: string; tenants: { name: string | null }[] | null; properties: { address: string | null } | null }[];
  const same = rows.find((r) => leaseKey({ address: r.properties?.address, tenants: (r.tenants ?? []).map((t) => t.name) }) === key);
  return same?.id ?? null;
}

// Start a tenancy from a checked lease: the property (with the state whose law it follows), the tenancy with its
// extracted terms and flags, and the first audit entries. Flags are recomputed here with the state's pack rather than
// trusted from the browser, and a state with no pack is refused. In a demo copy the same lease started twice opens the
// tenancy it already made instead of making a second one.
export async function POST(req: Request) {
  // The tenancy goes into the session's workspace: the owner's, or this visitor's copy of the demo.
  const ws = await currentWorkspace();
  if (!ws) return Response.json({ error: ACCESS_MESSAGES.signedOut }, { status: 401 });
  // Read with a cap before zod sees it: zod checks every element of an oversized array, so a 4 MB body of numbers
  // would cost the server hundreds of megabytes. Real lease terms are a few kilobytes.
  const parsed = bodySchema.safeParse(await readJson(req, 128_000));
  if (!parsed.success) return Response.json({ error: "Those lease terms couldn't be read. Check the lease again." }, { status: 400 });
  const terms = parsed.data.terms as LeaseTerms;
  const leasePath = parsed.data.leasePath ?? null;
  // Only a lease this workspace uploaded: a path under another workspace's prefix would put that visitor's PDF here.
  if (leasePath && !leasePath.startsWith(uploadPrefix(ws))) return Response.json({ error: "Those lease terms couldn't be read. Check the lease again." }, { status: 400 });
  if (!terms.propertyAddress?.trim()) return Response.json({ error: "The lease has no property address." }, { status: 400 });
  const state = stateCode(parsed.data.state) ?? stateCode(terms.state) ?? stateCode(terms.propertyAddress);
  if (!isSupported(state)) return Response.json({ error: unsupportedMessage(state) }, { status: 400 });
  const pack = packFor(state);
  terms.state = state;
  // A lease this copy of the demo already has a tenancy for: that tenancy, so a judge who checks a demo lease never
  // ends up with two tenancies of one lease at one address. Nothing is written and nothing is spent. The browser sends
  // the visitor to it with the sentence that says why (?lease=existing).
  if (ws.kind === "demo") {
    const same = await tenancyFromSameLease(ws.id, terms);
    if (same) return Response.json({ id: same, existing: true });
  }
  const flags = evaluateLease(terms, pack);
  // Today's allowance of new tenancies (src/lib/limits.ts), so an open demo can't fill the database.
  const run = await takeAllowance("tenancy");
  if (run.refused) return run.refused;

  const { data: property, error: pErr } = await db.from("properties").insert({
    workspace_id: ws.id, address: terms.propertyAddress, city: terms.city, state, owner_name: terms.landlordName, owner_type: terms.ownerType,
    owner_property_count: terms.ownerPropertyCount, owner_unit_count: terms.ownerUnitCount,
  }).select("id").single();
  if (pErr) {
    console.error("property insert failed", pErr.message);
    return Response.json({ error: "Couldn't save the property. Try again." }, { status: 500 });
  }

  const { data: tenancy, error: tErr } = await db.from("tenancies").insert({
    workspace_id: ws.id, property_id: property.id,
    tenants: terms.tenants.map((name) => ({ name, email: null })),
    monthly_rent: terms.monthlyRent, deposit_amount: terms.securityDeposit, other_charges: terms.otherMoveInCharges,
    start_date: terms.tenancyStartDate, end_date: terms.leaseEndDate ?? null, lease_pdf_path: leasePath, lease_terms: terms, lease_flags: flags,
  }).select("id").single();
  if (tErr) {
    console.error("tenancy insert failed", tErr.message);
    return Response.json({ error: "Couldn't save the tenancy. Try again." }, { status: 500 });
  }

  await audit(tenancy.id, "agent", "lease_checked", {
    violations: flags.filter((f) => f.severity === "violation").map((f) => f.id),
    warnings: flags.filter((f) => f.severity === "warning").map((f) => f.id),
  });
  await audit(tenancy.id, "landlord", "tenancy_started", { address: terms.propertyAddress, state });
  return Response.json({ id: tenancy.id });
}

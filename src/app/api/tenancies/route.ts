import { z } from "zod";
import { audit, db } from "@/lib/db";
import { takeAllowance } from "@/lib/limits";
import { evaluateLease, type LeaseTerms } from "@/lib/rules";

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
  landlordName: text(200).nullable(),
  ownerType: z.enum(["natural_person", "llc_natural_persons", "llc_other", "corporation", "unknown"]),
  ownerPropertyCount: count.nullable(),
  ownerUnitCount: count.nullable(),
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
  // The name the lease check gave the stored PDF (src/app/api/lease/route.ts), or null when it wasn't stored.
  leasePath: z.string().regex(/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\.pdf$/).nullable().optional(),
});

// Start a tenancy from a checked lease: the property, the tenancy with its extracted terms and flags, and the
// first audit entries. Flags are recomputed here rather than trusted from the browser.
export async function POST(req: Request) {
  const parsed = bodySchema.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return Response.json({ error: "Those lease terms couldn't be read. Check the lease again." }, { status: 400 });
  const terms = parsed.data.terms as LeaseTerms;
  const leasePath = parsed.data.leasePath ?? null;
  if (!terms.propertyAddress?.trim()) return Response.json({ error: "The lease has no property address." }, { status: 400 });
  const flags = evaluateLease(terms);
  // Today's allowance of new tenancies (src/lib/limits.ts), so an open demo can't fill the database.
  const run = await takeAllowance("tenancy");
  if (run.refused) return run.refused;

  const { data: property, error: pErr } = await db.from("properties").insert({
    address: terms.propertyAddress, city: terms.city, owner_name: terms.landlordName, owner_type: terms.ownerType,
    owner_property_count: terms.ownerPropertyCount, owner_unit_count: terms.ownerUnitCount,
  }).select("id").single();
  if (pErr) return Response.json({ error: pErr.message }, { status: 500 });

  const { data: tenancy, error: tErr } = await db.from("tenancies").insert({
    property_id: property.id,
    tenants: terms.tenants.map((name) => ({ name, email: null })),
    monthly_rent: terms.monthlyRent, deposit_amount: terms.securityDeposit, other_charges: terms.otherMoveInCharges,
    start_date: terms.tenancyStartDate, end_date: terms.leaseEndDate ?? null, lease_pdf_path: leasePath, lease_terms: terms, lease_flags: flags,
  }).select("id").single();
  if (tErr) return Response.json({ error: tErr.message }, { status: 500 });

  await audit(tenancy.id, "agent", "lease_checked", {
    violations: flags.filter((f) => f.severity === "violation").map((f) => f.id),
    warnings: flags.filter((f) => f.severity === "warning").map((f) => f.id),
  });
  await audit(tenancy.id, "landlord", "tenancy_started", { address: terms.propertyAddress });
  return Response.json({ id: tenancy.id });
}

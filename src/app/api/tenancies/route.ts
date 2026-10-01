import { audit, db } from "@/lib/db";
import { evaluateLease, type LeaseTerms } from "@/lib/rules";

export const runtime = "nodejs";

// Start a tenancy from a checked lease: the property, the tenancy with its extracted terms and flags, and the
// first audit entries. Flags are recomputed here rather than trusted from the browser.
export async function POST(req: Request) {
  const { terms, leasePath } = (await req.json()) as { terms: LeaseTerms; leasePath: string | null };
  if (!terms?.propertyAddress) return Response.json({ error: "The lease has no property address." }, { status: 400 });
  const flags = evaluateLease(terms);

  const { data: property, error: pErr } = await db.from("properties").insert({
    address: terms.propertyAddress, city: terms.city, owner_name: terms.landlordName, owner_type: terms.ownerType,
    owner_property_count: terms.ownerPropertyCount, owner_unit_count: terms.ownerUnitCount,
  }).select("id").single();
  if (pErr) return Response.json({ error: pErr.message }, { status: 500 });

  const { data: tenancy, error: tErr } = await db.from("tenancies").insert({
    property_id: property.id,
    tenants: terms.tenants.map((name) => ({ name, email: null })),
    monthly_rent: terms.monthlyRent, deposit_amount: terms.securityDeposit, other_charges: terms.otherMoveInCharges,
    start_date: terms.tenancyStartDate, lease_pdf_path: leasePath, lease_terms: terms, lease_flags: flags,
  }).select("id").single();
  if (tErr) return Response.json({ error: tErr.message }, { status: 500 });

  await audit(tenancy.id, "agent", "lease_checked", {
    violations: flags.filter((f) => f.severity === "violation").map((f) => f.id),
    warnings: flags.filter((f) => f.severity === "warning").map((f) => f.id),
  });
  await audit(tenancy.id, "landlord", "tenancy_started", { address: terms.propertyAddress });
  return Response.json({ id: tenancy.id });
}

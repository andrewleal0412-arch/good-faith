import { extractLeaseTerms } from "@/lib/extract";
import { evaluateLease, smallLandlordExempt, totalSecurity } from "@/lib/rules";

export const runtime = "nodejs";
export const maxDuration = 60;

// POST a lease PDF (form field "file"): Claude extracts the deposit terms, then the rules engine flags anything
// that breaks California law. Nothing is stored yet.
export async function POST(req: Request) {
  const form = await req.formData();
  const file = form.get("file");
  if (!(file instanceof File) || file.type !== "application/pdf") {
    return Response.json({ error: "Upload the lease as a PDF." }, { status: 400 });
  }
  if (file.size > 15 * 1024 * 1024) {
    return Response.json({ error: "That PDF is over 15 MB." }, { status: 400 });
  }
  try {
    const terms = await extractLeaseTerms(new Uint8Array(await file.arrayBuffer()), file.name);
    return Response.json({
      terms,
      totalSecurity: totalSecurity(terms),
      smallLandlordExempt: smallLandlordExempt(terms),
      flags: evaluateLease(terms),
    });
  } catch (e) {
    console.error("lease extraction failed", e);
    return Response.json({ error: "Couldn't read that lease. Try again." }, { status: 500 });
  }
}

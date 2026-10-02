import { db } from "@/lib/db";
import { extractLeaseTerms } from "@/lib/extract";
import { evaluateLease, lawfulDeposit, smallLandlordExempt, totalSecurity } from "@/lib/rules";
import { mb, UPLOAD_BUDGET } from "@/lib/uploads";

export const runtime = "nodejs";
export const maxDuration = 60;

// POST a lease PDF (form field "file"): Claude extracts the deposit terms, then the rules engine flags anything
// that breaks California law. The PDF goes to the private leases bucket so a tenancy can be started from it.
export async function POST(req: Request) {
  const form = await req.formData();
  const file = form.get("file");
  if (!(file instanceof File) || file.type !== "application/pdf") {
    return Response.json({ error: "Upload the lease as a PDF." }, { status: 400 });
  }
  // The same limit everywhere the app runs, so a lease that works on a laptop also works once hosted.
  if (file.size > UPLOAD_BUDGET) {
    return Response.json({ error: `That PDF is over ${mb(UPLOAD_BUDGET)}. Export the lease as a smaller PDF and try again.` }, { status: 400 });
  }
  try {
    const bytes = new Uint8Array(await file.arrayBuffer());
    const leasePath = `${crypto.randomUUID()}.pdf`;
    const [terms, upload] = await Promise.all([
      extractLeaseTerms(bytes, file.name),
      db.storage.from("leases").upload(leasePath, bytes, { contentType: "application/pdf" }),
    ]);
    if (upload.error) console.error("lease upload failed", upload.error.message);
    return Response.json({
      leasePath: upload.error ? null : leasePath,
      lawfulDeposit: lawfulDeposit(terms),
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

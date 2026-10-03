import { db } from "@/lib/db";
import { extractLeaseTerms } from "@/lib/extract";
import { isPdf, readForm, UNREADABLE } from "@/lib/images";
import { claudeNeverAnswered, takeAllowance } from "@/lib/limits";
import { evaluateLease, lawfulDeposit, smallLandlordExempt, totalSecurity } from "@/lib/rules";
import { mb, UPLOAD_BUDGET } from "@/lib/uploads";

export const runtime = "nodejs";
export const maxDuration = 60;

// POST a lease PDF (form field "file"): Claude extracts the deposit terms, then the rules engine flags anything
// that breaks California law. The PDF goes to the private leases bucket so a tenancy can be started from it.
export async function POST(req: Request) {
  const form = await readForm(req);
  if (!form) return Response.json({ error: UNREADABLE }, { status: 400 });
  const files = form.getAll("file").filter((f): f is File => f instanceof File);
  if (files.length > 1) return Response.json({ error: "Upload one lease at a time." }, { status: 400 });
  const file = files[0];
  if (!file || !file.size) return Response.json({ error: "Upload the lease as a PDF." }, { status: 400 });
  // The same limit everywhere the app runs, so a lease that works on a laptop also works once hosted. The messages are
  // the browser's own (src/app/(landlord)/lease/lease-check.tsx).
  if (file.size > UPLOAD_BUDGET) {
    return Response.json({ error: `That PDF is ${mb(file.size)}; the limit is ${mb(UPLOAD_BUDGET)}. Export the lease as a smaller PDF (text, not scanned pages) and try again.` }, { status: 400 });
  }
  // A PDF by its first bytes, whatever the browser called it.
  const bytes = new Uint8Array(await file.arrayBuffer());
  if (!isPdf(bytes)) return Response.json({ error: "That isn't a PDF. Export the lease as a PDF and try again." }, { status: 400 });
  // Today's allowance, checked before Claude is called (src/lib/limits.ts).
  const run = await takeAllowance("lease");
  if (run.refused) return run.refused;
  try {
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
    // Claude never answered (an overload, a bad key): nothing was spent, so the check goes back to today's allowance.
    if (claudeNeverAnswered(e)) await run.giveBack();
    return Response.json({ error: "Couldn't read that lease. Try again." }, { status: 500 });
  }
}

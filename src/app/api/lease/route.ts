import { db } from "@/lib/db";
import { extractLeaseTerms } from "@/lib/extract";
import { isPdf, readForm, UNREADABLE } from "@/lib/images";
import { claudeNeverAnswered, takeAllowance } from "@/lib/limits";
import { evaluateLease, lawfulDeposit, smallLandlordExempt, totalSecurity } from "@/lib/rules";
import { isSupported, packFor, stateCode, unsupportedMessage } from "@/lib/states";
import { ACCESS_MESSAGES } from "@/lib/session";
import { mb, UPLOAD_BUDGET } from "@/lib/uploads";
import { currentWorkspace, uploadPrefix } from "@/lib/workspace";

export const runtime = "nodejs";
export const maxDuration = 60;

// POST a lease PDF (form field "file"): Claude extracts the deposit terms, including the state the property is in, and
// that state's rule pack flags anything that breaks its law. A state with no pack gets a plain refusal naming the
// supported states; the landlord can pick the state when the lease got it wrong, and the page re-checks with that
// pack. The PDF goes to the private leases bucket so a tenancy can be started from it.
export async function POST(req: Request) {
  const ws = await currentWorkspace();
  if (!ws) return Response.json({ error: ACCESS_MESSAGES.signedOut }, { status: 401 });
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
    // Under the workspace's own prefix: the tenancy started from it must be in the same workspace (api/tenancies).
    const leasePath = `${uploadPrefix(ws)}${crypto.randomUUID()}.pdf`;
    const [terms, upload] = await Promise.all([
      extractLeaseTerms(bytes, file.name),
      db.storage.from("leases").upload(leasePath, bytes, { contentType: "application/pdf" }),
    ]);
    if (upload.error) console.error("lease upload failed", upload.error.message);
    // The state the lease names, else the one its address ends with.
    const state = stateCode(terms.state) ?? stateCode(terms.propertyAddress);
    terms.state = state;
    const supported = isSupported(state);
    const pack = supported ? packFor(state) : null;
    return Response.json({
      leasePath: upload.error ? null : leasePath,
      state, supported, refusal: supported ? null : unsupportedMessage(state),
      lawfulDeposit: pack ? lawfulDeposit(terms, pack) : null,
      terms,
      totalSecurity: totalSecurity(terms),
      smallLandlordExempt: smallLandlordExempt(terms),
      flags: pack ? evaluateLease(terms, pack) : [],
    });
  } catch (e) {
    console.error("lease extraction failed", e);
    // Claude never answered (an overload, a bad key): nothing was spent, so the check goes back to today's allowance.
    if (claudeNeverAnswered(e)) await run.giveBack();
    return Response.json({ error: "Couldn't read that lease. Try again." }, { status: 500 });
  }
}

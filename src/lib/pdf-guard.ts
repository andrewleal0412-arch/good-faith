import { AsyncLocalStorage } from "node:async_hooks";
import { PDFDocument } from "pdf-lib";

// Loading a PDF with pdf-lib decodes every object stream and cross-reference stream in it, and a filter chain of a few
// hundred bytes can inflate to hundreds of megabytes (a 199 KB receipt peaked at 513 MB, docs/AUDIT.md). The parse
// grows with what the file claims too: a 1.5 MB object stream naming 700,000 objects took 320 MB and 12 s. pdf-lib is
// patched at install (scripts/patch-pdf-lib.mjs) to call back here as it decodes, makes a reference or reads an object;
// here that work is charged to the load in progress, and the load stops once it passes the limits below. A load's
// references are kept in its own map, so they go when its document does (pdf-lib's own pool is never emptied).
//
// The limits are many times what real documents need: across 63 PDFs of up to 4 MB (statements, slides, forms of up
// to 42 pages), the most any decoded was 208 KB, in buffers of at most 64 KB, and the most work was 102,000 steps.

/** One stream may decode to this much, and one load to this much in all. */
export const STREAM_LIMIT = 4 * 1024 * 1024;
export const LOAD_LIMIT = 8 * 1024 * 1024;
/** References made and objects read in one load. */
export const WORK_LIMIT = 200_000;
/** Indirect objects one file may hold. */
export const OBJECT_LIMIT = 20_000;

export class PdfTooBig extends Error {}

type Load = { left: number; work: number; refs: Map<string, unknown>; over?: string };
const loads = new AsyncLocalStorage<Load>();

// pdf-lib catches an error inside an object and reads on (as an invalid object), so the first limit passed is kept
// and the load is refused once it returns.
const stop = (load: Load | undefined, why: string): never => {
  if (load) load.over ??= why;
  throw new PdfTooBig(why);
};

const g = globalThis as {
  __goodFaithPdfDecode?: (size: number, grows: number) => void;
  __goodFaithPdfWork?: () => Map<string, unknown> | undefined;
  __goodFaithPdfPatched?: { decode?: boolean; ref?: boolean; parse?: boolean };
};
g.__goodFaithPdfDecode = (size, grows) => {
  const load = loads.getStore();
  if (size > STREAM_LIMIT) stop(load, `A stream in this PDF decodes to more than ${STREAM_LIMIT / 1048576} MB.`);
  if (!load) return;
  load.left -= grows;
  if (load.left < 0) stop(load, `This PDF decodes to more than ${LOAD_LIMIT / 1048576} MB.`);
};
g.__goodFaithPdfWork = () => {
  const load = loads.getStore();
  if (!load) return undefined;
  if (++load.work > WORK_LIMIT) stop(load, "This PDF has more in it than a receipt can.");
  return load.refs;
};

/** Whether the installed pdf-lib carries the patch. Without it a load could take the server's memory, so none runs. */
export function loadLimited(): boolean {
  const p = g.__goodFaithPdfPatched;
  return !!(p?.decode && p.ref && p.parse);
}

/** A PDF loaded within the limits, or a PdfTooBig (or pdf-lib's own error for a file it can't read). */
export async function loadPdf(bytes: Uint8Array): Promise<PDFDocument> {
  if (!loadLimited()) {
    console.error("pdf-lib is not patched (scripts/patch-pdf-lib.mjs); PDFs are not loaded");
    throw new PdfTooBig("PDFs can't be read on this server right now.");
  }
  const load: Load = { left: LOAD_LIMIT, work: 0, refs: new Map() };
  let doc: PDFDocument;
  try {
    doc = await loads.run(load, () => PDFDocument.load(bytes, { ignoreEncryption: true }));
  } catch (e) {
    if (load.over) throw new PdfTooBig(load.over);
    throw e;
  }
  if (load.over) throw new PdfTooBig(load.over);
  if (doc.context.enumerateIndirectObjects().length > OBJECT_LIMIT) throw new PdfTooBig(`This PDF holds more than ${OBJECT_LIMIT.toLocaleString("en-US")} objects.`);
  return doc;
}

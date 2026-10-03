// Uploads prepared in the browser so they fit the host. Vercel refuses a request body over 4.5 MB with a 413, and one
// phone photo is 3 to 12 MB, so photos are downscaled on a canvas before they leave the browser and sent in requests
// that stay under the limit. The statement packet re-encodes every photo at 1600 px anyway (src/lib/statement-pdf.ts),
// so nothing the statement shows is lost. Shared by the client components and the lease route; no DOM access at the
// top level, so the server can import the limits.

/** What one request may carry in files: the lease PDF, one batch of photos, or a deduction's receipt and photos. The
 *  host's limit is 4.5 MB (Vercel Functions; the unit is not stated, so the smaller reading, 4,500,000 bytes, is
 *  assumed) and the multipart framing and text fields ride on top, so every file check uses this budget and the
 *  person sees a plain message instead of the host's 413 page. */
export const UPLOAD_BUDGET = 4 * 1024 * 1024;
/** The largest request body any route takes, the budget plus room for the form framing and text fields. The proxy
 *  answers a bigger declared body with a 413 once it has arrived (src/proxy.ts). */
export const REQUEST_LIMIT = UPLOAD_BUDGET + 512 * 1024;
/** Photos in one request; the browser splits a bigger selection, and the server refuses more. */
export const PHOTOS_PER_REQUEST = 20;
/** After-repair photos on one deduction. */
export const AFTER_PHOTOS_MAX = 10;
/** Photos are downscaled to this many pixels on the long side and re-encoded as JPEG at this quality. */
export const PHOTO_MAX_SIDE = 2000;
export const PHOTO_QUALITY = 0.85;
/** A photo already this small and within PHOTO_MAX_SIDE goes up untouched, EXIF and all. */
const KEEP_UNDER = 1.5 * 1024 * 1024;

export const mb = (bytes: number) => `${(bytes / (1024 * 1024)).toFixed(1)} MB`;

/** The message for a file the browser could not decode. The server says the same when its own check fails. */
export const notAPhoto = (name: string) => `${name} isn't a photo this browser can open. Export it as a JPEG and try again.`;

/** A photo small enough to upload: downscaled to PHOTO_MAX_SIDE and re-encoded as JPEG when it is large, otherwise
 *  the original. The browser applies the EXIF orientation while decoding (createImageBitmap with "from-image", or an
 *  <img>, which every current browser orients), so a sideways phone photo comes out upright and the new JPEG, which
 *  carries no EXIF, needs no tag. Null when the browser can't decode the file (a HEIC in desktop Chrome, a renamed or
 *  truncated file): the callers refuse it with notAPhoto instead of sending bytes the server would store blind. */
export async function shrinkPhoto(file: File): Promise<File | null> {
  if (!file.type.startsWith("image/")) return null;
  let source: ImageBitmap | HTMLImageElement;
  let objectUrl: string | null = null;
  try {
    source = await decodeOriented(file);
  } catch {
    if (objectUrl) URL.revokeObjectURL(objectUrl);
    return null;
  }
  try {
    const width = "naturalWidth" in source ? source.naturalWidth : source.width;
    const height = "naturalHeight" in source ? source.naturalHeight : source.height;
    const long = Math.max(width, height);
    if (!long) return null;
    if (file.size <= KEEP_UNDER && long <= PHOTO_MAX_SIDE) return file;
    const scale = Math.min(1, PHOTO_MAX_SIDE / long);
    const canvas = document.createElement("canvas");
    canvas.width = Math.max(1, Math.round(width * scale));
    canvas.height = Math.max(1, Math.round(height * scale));
    const ctx = canvas.getContext("2d");
    if (!ctx) return file;
    // JPEG has no transparency: a transparent PNG would otherwise land on the canvas's black.
    ctx.fillStyle = "#fff";
    ctx.fillRect(0, 0, canvas.width, canvas.height);
    ctx.drawImage(source, 0, 0, canvas.width, canvas.height);
    const blob = await new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, "image/jpeg", PHOTO_QUALITY));
    // No gain (a small file at a high JPEG quality can grow): keep the original.
    if (!blob || blob.size >= file.size) return file;
    return new File([blob], file.name.replace(/\.[^.]+$/, "") + ".jpg", { type: "image/jpeg", lastModified: file.lastModified });
  } finally {
    if ("close" in source) source.close();
    if (objectUrl) URL.revokeObjectURL(objectUrl);
  }

  async function decodeOriented(f: File): Promise<ImageBitmap | HTMLImageElement> {
    if (typeof createImageBitmap === "function") {
      try {
        return await createImageBitmap(f, { imageOrientation: "from-image" });
      } catch {
        // Fall back to an <img>, which also applies the orientation.
      }
    }
    objectUrl = URL.createObjectURL(f);
    const img = new Image();
    img.src = objectUrl;
    await img.decode();
    return img;
  }
}

/** Files grouped so each group's bytes stay under the budget and its count under PHOTOS_PER_REQUEST, in the order
 *  given. A file over the budget by itself gets a group of its own; callers check for that first. */
export function batchFiles<T extends { size: number }>(files: T[], budget = UPLOAD_BUDGET, most = PHOTOS_PER_REQUEST): T[][] {
  const groups: T[][] = [];
  let group: T[] = [], bytes = 0;
  for (const f of files) {
    if (group.length && (bytes + f.size > budget || group.length >= most)) {
      groups.push(group);
      group = [];
      bytes = 0;
    }
    group.push(f);
    bytes += f.size;
  }
  if (group.length) groups.push(group);
  return groups;
}

/** The message for a failed upload response. The host's 413 is not JSON, so it is named before the body is read; the
 *  caller says what was too large, since the same route may carry a lease, a receipt or photos. */
export async function uploadError(r: Response, fallback: string, tooLarge = "That upload was too large for the server. Try fewer photos at a time."): Promise<string> {
  if (r.status === 413) return tooLarge;
  const j = await r.json().catch(() => ({}));
  return (j as { error?: string }).error ?? fallback;
}

export type UploadResult = { ok: true; count: number } | { ok: false; error: string };

/** Upload photos to a route that takes "files" plus text fields: each photo shrunk one at a time (a dozen 12 MB
 *  photos decoded at once would exhaust a phone's memory), then as many requests as the budget needs, each told the
 *  selection's total so the audit log can say "4 of 6". Stops at the first failure; the photos before it are kept. */
export async function uploadPhotos(url: string, fields: Record<string, string>, files: File[]): Promise<UploadResult> {
  const small: File[] = [];
  for (const f of files) {
    const s = await shrinkPhoto(f);
    if (!s) return { ok: false, error: notAPhoto(f.name) };
    small.push(s);
  }
  const over = small.find((f) => f.size > UPLOAD_BUDGET);
  if (over) return { ok: false, error: `${over.name} is ${mb(over.size)}, over the ${mb(UPLOAD_BUDGET)} limit for one photo, and it couldn't be made smaller. Export it as a JPEG and try again.` };
  let count = 0;
  for (const group of batchFiles(small)) {
    const fd = new FormData();
    for (const [k, v] of Object.entries(fields)) fd.append(k, v);
    fd.append("total", String(small.length));
    for (const f of group) fd.append("files", f);
    const r = await fetch(url, { method: "POST", body: fd });
    if (!r.ok) {
      const error = await uploadError(r, "Upload failed.");
      return { ok: false, error: count ? `${error} ${count} photo${count === 1 ? " was" : "s were"} saved before that.` : error };
    }
    count += group.length;
  }
  return { ok: true, count };
}

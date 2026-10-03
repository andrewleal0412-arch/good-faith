import "server-only";
import sharp from "sharp";
import { mb, UPLOAD_BUDGET } from "./uploads";

// What an uploaded file really is. The browser derives a file's type from its extension, so a renamed, truncated
// or HEIC file arrives labeled image/jpeg; stored, it would break every inspection of its room (one Claude call per
// room, nothing to remove it with), so the bytes are checked here before anything is written. The declared type is
// never trusted: the first bytes (the format's signature) must name an accepted format, and for a photo sharp must
// also read it as that same format.

/** The formats the inspection can send to Claude and every browser shows. HEIC is not among them: the browser turns
 *  what it can decode into a JPEG first (src/lib/uploads.ts). */
const ACCEPTED: Record<string, string> = { jpeg: "image/jpeg", png: "image/png", gif: "image/gif", webp: "image/webp" };

const starts = (b: Uint8Array, sig: number[], at = 0) => b.length >= at + sig.length && sig.every((x, i) => b[at + i] === x);
const ascii = (s: string) => [...s].map((c) => c.charCodeAt(0));

/** The media type the file's signature names, or null for anything else. */
export function sniff(b: Uint8Array): "image/jpeg" | "image/png" | "image/gif" | "image/webp" | "application/pdf" | null {
  if (starts(b, [0xff, 0xd8, 0xff])) return "image/jpeg";
  if (starts(b, [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])) return "image/png";
  if (starts(b, ascii("GIF87a")) || starts(b, ascii("GIF89a"))) return "image/gif";
  if (starts(b, ascii("RIFF")) && starts(b, ascii("WEBP"), 8)) return "image/webp";
  if (starts(b, ascii("%PDF-"))) return "application/pdf";
  return null;
}

/** The media type read from the bytes, or null when they aren't a photo the app can use. */
export async function imageType(bytes: Uint8Array): Promise<string | null> {
  const signed = sniff(bytes);
  if (!signed || !signed.startsWith("image/")) return null;
  try {
    const { format } = await sharp(bytes).metadata();
    const type = (format && ACCEPTED[format]) ?? null;
    return type === signed ? type : null;
  } catch {
    return null;
  }
}

/** True when the bytes start with a PDF's signature. */
export const isPdf = (bytes: Uint8Array) => sniff(bytes) === "application/pdf";

/** The message for a refused file, the same one the browser shows when it can't decode a photo (src/lib/uploads.ts). */
export const notAPhotoServer = (name: string) => `${name} isn't a photo the server can read. Export it as a JPEG and try again.`;

/** The message for one photo over the per-file limit, as the browser says it. */
export const photoTooLarge = (name: string, size: number) =>
  `${name} is ${mb(size)}, over the ${mb(UPLOAD_BUDGET)} limit for one photo. Export it as a JPEG and try again.`;

/** The message for a request whose files together are over the budget, as the browser says it for a 413. */
export const TOO_LARGE = "That upload was too large for the server. Try fewer photos at a time.";

/** Reads a multipart form, or null when the body isn't one (or was cut off at the proxy's limit). */
export async function readForm(req: Request): Promise<FormData | null> {
  try {
    return await req.formData();
  } catch {
    return null;
  }
}

export const UNREADABLE = "Couldn't read that upload. Try again.";

import "server-only";
import sharp from "sharp";

// What an uploaded "image" really is. The browser derives a file's type from its extension, so a renamed, truncated
// or HEIC file arrives labeled image/jpeg; stored, it would break every inspection of its room (one Claude call per
// room, nothing to remove it with), so the bytes are checked here before anything is written.

/** The formats the inspection can send to Claude and every browser shows. */
const ACCEPTED: Record<string, string> = { jpeg: "image/jpeg", png: "image/png", gif: "image/gif", webp: "image/webp" };

/** The media type read from the bytes, or null when they aren't a photo the app can use. */
export async function imageType(bytes: Uint8Array): Promise<string | null> {
  try {
    const { format } = await sharp(bytes).metadata();
    return (format && ACCEPTED[format]) ?? null;
  } catch {
    return null;
  }
}

/** The message for a refused file, the same one the browser shows when it can't decode a photo (src/lib/uploads.ts). */
export const notAPhotoServer = (name: string) => `${name} isn't a photo the server can read. Export it as a JPEG and try again.`;

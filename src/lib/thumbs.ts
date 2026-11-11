import "server-only";
import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import { join } from "node:path";
import sharp from "sharp";
import { db } from "./db";
import { MAX_PIXELS } from "./uploads";

// Small versions of the stored photos, for the photo grids and thumbnails: 480 px on the long side, WebP (6 to 10 kB
// for a demo photo, against 150 to 230 kB for the photo itself). The full photo still goes to the move-out comparison
// and to anywhere a photo opens on its own.
//
// Where they come from:
//  - the demo templates' photos, which every demo copy shows: made ahead from the bucket by
//    scripts/template-thumbs.mjs and kept in the repo (data/template-thumbs), so the hosted demo spends no CPU on them,
//    not even after the free plan wakes (making one costs 25 to 65 ms of CPU here, about ten times that there);
//    nothing is written to storage, the templates' folders least of all;
//  - any other photo: made from the private bucket the first time it is asked for (or from the bytes of an upload,
//    just after it), then kept in this process's memory.
// A stored photo's path is never reused (every upload gets a new random name, and a template's files don't change), so
// the browser may keep a thumbnail for weeks. Callers check that the session may see the path first (the routes:
// maySign, or the tenant link's own photo), and only then come here: the cache is keyed by path alone.

export const THUMB_PX = 480;
const QUALITY = 75;
/** WebP's encoder effort: 2 of 6, a little faster than the default for a file a few percent larger. */
const EFFORT = 2;
/** What the cache may hold; past it the thumbnails used longest ago go first. */
const CACHE_BYTES = 32 * 1024 * 1024;
/** An original sharp can't read is sent as it is, and kept only when it is small. */
const KEEP_ORIGINAL_UNDER = 512 * 1024;
/** Thumbnails made at once: the free plan's tenth of a CPU gains nothing from more, and each holds a decoded photo. */
const JOBS = 2;
/** The templates' thumbnails made ahead (scripts/template-thumbs.mjs): index.json maps each path to its file. */
export const TEMPLATE_THUMBS_DIR = join(process.cwd(), "data", "template-thumbs");

export type Thumbnail = { bytes: Uint8Array<ArrayBuffer>; type: string };

const made = new Map<string, Thumbnail>(); // by path, the most recently used last
let held = 0;
const making = new Map<string, Promise<Thumbnail | null>>();
let running = 0;
const waiting: (() => void)[] = [];
let bundled: Promise<Record<string, { file: string }>> | null = null;

/** A stored photo's path as the thumbnail routes take it: the bucket's own names (uuids, folders, an image extension). */
export const isPhotoPath = (p: string) => p.length <= 300 && !p.includes("..") && !p.includes("//") && /^[a-z0-9][a-z0-9/_.-]*\.(jpe?g|png|gif|webp)$/i.test(p);

/** The thumbnail's validator, from its path and size alone (the path's file never changes). */
export const thumbEtag = (path: string) => `"t${THUMB_PX}-${createHash("sha256").update(path).digest("hex").slice(0, 24)}"`;

/** One photo's small version, as every thumbnail is made (the script that makes the templates' ahead uses this too).
 *  rotate() applies the photo's EXIF orientation, as the browser does for the original, and the output keeps none. */
export const makeThumb = async (bytes: Uint8Array) =>
  new Uint8Array(await sharp(bytes, { limitInputPixels: MAX_PIXELS }).rotate().resize({ width: THUMB_PX, height: THUMB_PX, fit: "inside", withoutEnlargement: true })
    .webp({ quality: QUALITY, effort: EFFORT }).toBuffer());

/** The thumbnail of one stored photo in the photos bucket, or null when the file can't be read. */
export async function thumbnail(path: string): Promise<Thumbnail | null> {
  const hit = made.get(path);
  if (hit) {
    made.delete(path);
    made.set(path, hit);
    return hit;
  }
  const pending = making.get(path);
  if (pending) return pending;
  const job = make(path).finally(() => making.delete(path));
  making.set(path, job);
  return job;
}

/** A photo just uploaded: its thumbnail made from the bytes in hand, after the upload has answered (the page asks for
 *  it right after), so the first view of it needn't download the photo again. */
export function warmThumbnail(path: string, bytes: Uint8Array<ArrayBuffer>, type: string) {
  if (made.has(path) || making.has(path)) return;
  const job = make(path, { bytes, type }).finally(() => making.delete(path));
  making.set(path, job);
  job.catch(() => {});
}

/** A turn to make one, at most JOBS at once; a finished job hands its turn to the next one waiting. */
async function turn() {
  if (running < JOBS) running++;
  else await new Promise<void>((go) => waiting.push(go));
}
function done() {
  const next = waiting.shift();
  if (next) next();
  else running--;
}

/** A template photo's thumbnail made ahead, or null when the path has none (any other photo, or no index). */
async function madeAhead(path: string): Promise<Thumbnail | null> {
  bundled ??= readFile(join(TEMPLATE_THUMBS_DIR, "index.json"), "utf8")
    .then((t) => (JSON.parse(t) as { entries?: Record<string, { file: string }> }).entries ?? {})
    .catch(() => ({}));
  const entry = (await bundled)[path];
  if (!entry || !/^[0-9a-f]{24}\.webp$/.test(entry.file)) return null;
  try {
    return { bytes: new Uint8Array(await readFile(join(TEMPLATE_THUMBS_DIR, entry.file))), type: "image/webp" };
  } catch {
    return null;
  }
}

function keep(path: string, out: Thumbnail) {
  made.set(path, out);
  held += out.bytes.length;
  for (const [k, v] of made) {
    if (held <= CACHE_BYTES) break;
    made.delete(k);
    held -= v.bytes.length;
  }
}

async function make(path: string, given?: { bytes: Uint8Array<ArrayBuffer>; type: string }): Promise<Thumbnail | null> {
  const ahead = given ? null : await madeAhead(path);
  if (ahead) {
    keep(path, ahead);
    return ahead;
  }
  await turn();
  try {
    let original: Uint8Array<ArrayBuffer>, stored: string;
    if (given) ({ bytes: original, type: stored } = given);
    else {
      const { data, error } = await db.storage.from("photos").download(path);
      if (error || !data) return null;
      original = new Uint8Array(await data.arrayBuffer());
      stored = data.type;
    }
    let out: Thumbnail;
    try {
      out = { bytes: await makeThumb(original), type: "image/webp" };
    } catch {
      // sharp couldn't read it: the original goes out as stored, as the tenants' photo route does.
      out = { bytes: original, type: stored || "image/jpeg" };
      if (original.length > KEEP_ORIGINAL_UNDER) return out;
    }
    keep(path, out);
    return out;
  } finally {
    done();
  }
}

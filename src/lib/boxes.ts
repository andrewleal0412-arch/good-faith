// Where a move-out finding sits on its photo: a box in fractions of the photo's width and height, measured from the
// top-left corner (x, y) with a size (w, h). Claude proposes it; this module is the one place it is checked, both
// when the inspection is saved and again when a stored finding is read, so a bad value never reaches the page.

export type Box = { x: number; y: number; w: number; h: number };

/** The smallest box drawn, as a share of the photo: a nail hole is a pinpoint, and a 2px outline around it is unreadable. */
const MIN = 0.03;

const clamp = (n: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, n));
const round = (n: number) => Math.round(n * 10_000) / 10_000;

/** A clean box inside the photo, or null when the value can't be read as one. Values well over 1 are percentages or
 *  pixels: a box that fits inside 0..100 reads as percent when the photo's size is unknown, and is dropped as ambiguous
 *  when it is known (a box in a photo's top-left 100 pixels and a percent box look alike, and a wrong box is worse than
 *  none on an evidence screen); anything larger reads as pixels, scaled by the photo's size. A negative size flips the
 *  corner; a pinpoint grows to MIN around its center; everything is clamped to the photo. */
export function cleanBox(raw: unknown, px?: { width: number; height: number } | null): Box | null {
  if (!raw || typeof raw !== "object") return null;
  const r = raw as Record<string, unknown>;
  let [x, y, w, h] = [r.x, r.y, r.w, r.h].map(Number);
  if (![x, y, w, h].every(Number.isFinite)) return null;
  if (Math.max(x, y, w, h) > 1.5) {
    const percent = Math.max(x, y, w, h) <= 100 && x + w <= 100 && y + h <= 100;
    if (percent && px?.width && px?.height) {
      console.warn("box dropped: percent or pixels can't be told apart", { x, y, w, h });
      return null;
    }
    if (percent) { x /= 100; w /= 100; y /= 100; h /= 100; }
    else if (px?.width && px?.height) { x /= px.width; w /= px.width; y /= px.height; h /= px.height; }
    else return null;
  }
  if (w < 0) { x += w; w = -w; }
  if (h < 0) { y += h; h = -h; }
  if (x >= 1 || y >= 1 || x + w < 0 || y + h < 0) return null; // the whole box lies outside the photo
  let x0 = clamp(x, 0, 1), y0 = clamp(y, 0, 1);
  let x1 = clamp(x + w, 0, 1), y1 = clamp(y + h, 0, 1);
  if (x1 - x0 < MIN) { const c = (x0 + x1) / 2; x0 = clamp(c - MIN / 2, 0, 1 - MIN); x1 = x0 + MIN; }
  if (y1 - y0 < MIN) { const c = (y0 + y1) / 2; y0 = clamp(c - MIN / 2, 0, 1 - MIN); y1 = y0 + MIN; }
  return { x: round(x0), y: round(y0), w: round(x1 - x0), h: round(y1 - y0) };
}

/** A box placed over a photo drawn with object-fit: cover in a frame of another shape. Both shapes are width / height;
 *  `focus` is the photo's object-position along the cropped axis (0.5 centered, as CSS's 50%). The result is in percent
 *  of the frame and may run past its edges, where the frame clips it. */
export function placeBox(b: Box, photo: number, frame: number, focus = 0.5): { left: number; top: number; width: number; height: number } {
  if (photo > frame) {
    const s = photo / frame, off = (1 - s) * focus; // full height, the sides cropped
    return { left: (off + b.x * s) * 100, top: b.y * 100, width: b.w * s * 100, height: b.h * 100 };
  }
  const s = frame / photo, off = (1 - s) * focus; // full width, the top and bottom cropped
  return { left: b.x * 100, top: (off + b.y * s) * 100, width: b.w * 100, height: b.h * s * 100 };
}

/** Where to crop a photo shown in a frame of another shape so its boxes stay in view: the object-position along the
 *  cropped axis (0 to 1) that centers the visible window on the boxes, as far as the photo allows. When the boxes
 *  spread wider than the window, it centers on the `first` ones (what is charged) instead. 0.5 with no boxes. */
export function focusOn(boxes: Box[], photo: number, frame: number, first: Box[] = []): number {
  if (!boxes.length || Math.abs(photo - frame) < 0.01) return 0.5;
  const wide = photo > frame; // the sides are cropped
  const s = wide ? photo / frame : frame / photo;
  const span = (bs: Box[]) => [Math.min(...bs.map((b) => (wide ? b.x : b.y))), Math.max(...bs.map((b) => (wide ? b.x + b.w : b.y + b.h)))];
  let [lo, hi] = span(boxes);
  if (hi - lo > 1 / s && first.length) [lo, hi] = span(first);
  return clamp((((lo + hi) / 2) * s - 0.5) / (s - 1), 0, 1);
}

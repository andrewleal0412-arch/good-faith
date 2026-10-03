import "server-only";
import { anthropic } from "@ai-sdk/anthropic";
import { generateText, Output } from "ai";
import sharp from "sharp";
import { z } from "zod";
import { cleanBox, type Box } from "./boxes";

// Move-out inspection: Claude compares a room's move-in photos with its move-out photos and lists every change,
// classified the way California treats it, with a box around each change on the photo. It doesn't set dollar amounts;
// costs, useful-life proration and the $125 receipt rule are applied in code once the landlord enters invoices
// (docs/LEGAL_RULES.md, sections A and C).

const MODEL = process.env.ANTHROPIC_MODEL ?? "claude-opus-5-5";

// Fractions of the photo, not pixels: the page draws the box over the photo at any size. Range limits aren't sent to
// the model (structured outputs drop them); cleanBox clamps and checks every value instead.
const boxSchema = z.object({
  x: z.number().describe("Left edge, as a fraction of the photo's width: 0 is the left side, 1 the right"),
  y: z.number().describe("Top edge, as a fraction of the photo's height: 0 is the top, 1 the bottom"),
  w: z.number().describe("Width, as a fraction of the photo's width"),
  h: z.number().describe("Height, as a fraction of the photo's height"),
});

export const findingSchema = z.object({
  item: z.string().describe("What changed, e.g. 'Bedroom carpet', 'Wall above the window'"),
  label: z.string().describe("Two to five words naming the change itself, for the numbered marker on the photo, e.g. 'Carpet stain, lower middle', 'Wall hole', 'Grease on the range'"),
  summary: z.string().describe("One line for the landlord's list, under 90 characters: what changed and where, then one fact (its size in inches or feet, or that it isn't in the move-in photo). Don't start with 'The move-out photo'. e.g. 'Stain about 2 ft across in front of the window; not in the move-in photo.'"),
  observation: z.string().describe("What the move-out photo shows compared with move-in, in one or two plain sentences"),
  classification: z.enum(["wear_and_tear", "damage", "cleaning", "unclear"])
    .describe("wear_and_tear = ordinary use, never chargeable; damage = beyond ordinary wear and tear; cleaning = dirtier than at move-in; unclear = can't tell from the photos"),
  reason: z.string().describe("Why, in plain words, tied to the guidance (e.g. 'Small nail holes are ordinary wear and tear under the DRE guide')"),
  remedy: z.enum(["none", "clean", "repair", "replace"]),
  severity: z.enum(["minor", "moderate", "major"]),
  confidence: z.number().describe("0 to 1: how sure you are of the classification"),
  moveInPhoto: z.number().int().describe("Index of the move-in photo that shows the area before (0-based)"),
  moveOutPhoto: z.number().int().describe("Index of the move-out photo that shows the change (0-based)"),
  box: boxSchema.nullable()
    .describe("Where the change is on that move-out photo: a tight box around the visible change itself (the stain, the hole, the grime), not the whole object or wall. Null only when nothing in the photo can be pointed to."),
  moveInBox: boxSchema.nullable()
    .describe("The same area on that move-in photo, so the two can be compared. Null when the area isn't in the move-in photo."),
});

/** A finding as stored on the tenancy: the boxes checked and clamped, the room it belongs to. */
export type Finding = Omit<z.infer<typeof findingSchema>, "box" | "moveInBox"> & { room: string; box: Box | null; moveInBox: Box | null };

const GUIDE = `California Civil Code 1950.5 and the DRE's California Tenants guide (2026), as applied here:
- A deposit may cover damage beyond ordinary wear and tear, and cleaning only back to the cleanliness at move-in.
- Never chargeable (ordinary wear and tear): faded or lightly scuffed paint, paint worn behind furniture, a few small
  nail or pin holes, minor nicks, carpet worn or matted from normal traffic, moderate carpet spotting, drapes or blinds
  faded or loose from age, grime that predates this tenancy.
- Chargeable damage: a large number of holes or large holes/gouges in walls, carpet rips, burns, pet urine or other
  indelible stains, blinds snapped or torn, broken fixtures, chewed trim.
- Chargeable cleaning: a dirty oven or range, greasy surfaces, mildew, unwashed floors, decals, fleas, left-behind trash,
  but only beyond how clean it was at move-in.
- Professional carpet cleaning is chargeable only when needed to restore move-in condition, never as a routine charge.
Report only what the photos show. If lighting or angle makes it uncertain, say "unclear".`;

/** A photo's bytes with the media type they were stored under (read from the bytes at upload, src/lib/images.ts). */
export type InspectPhoto = { data: Uint8Array; mediaType: string };

/** The photo's size as it is displayed: EXIF orientations 5 to 8 turn it a quarter, so its sides swap. */
async function sizeOf(p: InspectPhoto): Promise<{ width: number; height: number } | null> {
  try {
    const m = await sharp(p.data).metadata();
    if (!m.width || !m.height) return null;
    return (m.orientation ?? 1) >= 5 ? { width: m.height, height: m.width } : { width: m.width, height: m.height };
  } catch {
    return null;
  }
}

/** Compare one room. Photos are passed as bytes, move-in first. */
export async function inspectRoom(room: string, moveIn: InspectPhoto[], moveOut: InspectPhoto[]): Promise<Finding[]> {
  const img = (p: InspectPhoto) => ({ type: "file" as const, mediaType: p.mediaType, data: p.data });
  const [inSizes, outSizes] = await Promise.all([Promise.all(moveIn.map(sizeOf)), Promise.all(moveOut.map(sizeOf))]);
  const size = (s: { width: number; height: number } | null) => (s ? `, ${s.width} x ${s.height} pixels` : "");
  const { output } = await generateText({
    model: anthropic(MODEL),
    output: Output.object({ schema: z.object({ findings: z.array(findingSchema) }) }),
    system:
      "You inspect rental units at move-out for a California landlord's security deposit tool. You compare move-in and " +
      "move-out photos of the same room and list every visible change. You classify, you don't price. Be fair to the " +
      "tenant: when something is ordinary wear and tear, say so.\n\n" +
      "Mark where each change is. On the move-out photo, give a tight box around the visible change itself, in " +
      "fractions of that photo's width and height measured from its top-left corner (x and y are the box's top-left " +
      "corner, w and h its size, all between 0 and 1). Give the same area on the move-in photo when it shows there. " +
      "The landlord sees these boxes drawn over the photos, so place them on the stain, hole or grime, not around " +
      "the whole wall or appliance. The photo sizes are only for placing the boxes: describe sizes in the room's terms " +
      "(inches, feet), never in pixels.\n\n" + GUIDE,
    messages: [{
      role: "user",
      content: [
        { type: "text", text: `Room: ${room}. The first ${moveIn.length} image(s) are MOVE-IN photos (indexes 0-${moveIn.length - 1}).` },
        ...moveIn.flatMap((p, i) => [{ type: "text" as const, text: `Move-in photo ${i}${size(inSizes[i])}:` }, img(p)]),
        { type: "text", text: `The next ${moveOut.length} image(s) are MOVE-OUT photos of the same room (indexes 0-${moveOut.length - 1}).` },
        ...moveOut.flatMap((p, i) => [{ type: "text" as const, text: `Move-out photo ${i}${size(outSizes[i])}:` }, img(p)]),
        { type: "text", text: "List every change between move-in and move-out, each with its boxes. If nothing changed, return an empty list." },
      ],
    }],
  });
  return output.findings.map((f) => {
    const outIdx = moveOut[f.moveOutPhoto] ? f.moveOutPhoto : 0;
    const inIdx = moveIn[f.moveInPhoto] ? f.moveInPhoto : 0;
    return {
      ...f, room,
      label: f.label.trim().slice(0, 60),
      summary: f.summary.trim().slice(0, 160),
      confidence: Math.min(1, Math.max(0, Number(f.confidence) || 0)),
      box: cleanBox(f.box, outSizes[outIdx]),
      moveInBox: cleanBox(f.moveInBox, inSizes[inIdx]),
    };
  });
}

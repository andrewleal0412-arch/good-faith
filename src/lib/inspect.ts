import "server-only";
import { anthropic } from "@ai-sdk/anthropic";
import { generateText, Output } from "ai";
import { z } from "zod";

// Move-out inspection: Claude compares a room's move-in photos with its move-out photos and lists every change,
// classified the way California treats it. It doesn't set dollar amounts; costs, useful-life proration and the
// $125 receipt rule are applied in code once the landlord enters invoices (docs/LEGAL_RULES.md, sections A and C).

const MODEL = process.env.ANTHROPIC_MODEL ?? "claude-opus-5-5";

export const findingSchema = z.object({
  item: z.string().describe("What changed, e.g. 'Bedroom carpet', 'Wall above the window'"),
  observation: z.string().describe("What the move-out photo shows compared with move-in, in one or two plain sentences"),
  classification: z.enum(["wear_and_tear", "damage", "cleaning", "unclear"])
    .describe("wear_and_tear = ordinary use, never chargeable; damage = beyond ordinary wear and tear; cleaning = dirtier than at move-in; unclear = can't tell from the photos"),
  reason: z.string().describe("Why, in plain words, tied to the guidance (e.g. 'Small nail holes are ordinary wear and tear under the DRE guide')"),
  remedy: z.enum(["none", "clean", "repair", "replace"]),
  severity: z.enum(["minor", "moderate", "major"]),
  confidence: z.number().min(0).max(1),
  moveInPhoto: z.number().int().describe("Index of the move-in photo that shows the area before (0-based)"),
  moveOutPhoto: z.number().int().describe("Index of the move-out photo that shows the change (0-based)"),
});
export type Finding = z.infer<typeof findingSchema> & { room: string };

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

/** Compare one room. Photos are passed as bytes, move-in first. */
export async function inspectRoom(room: string, moveIn: InspectPhoto[], moveOut: InspectPhoto[]): Promise<Finding[]> {
  const img = (p: InspectPhoto) => ({ type: "file" as const, mediaType: p.mediaType, data: p.data });
  const { output } = await generateText({
    model: anthropic(MODEL),
    output: Output.object({ schema: z.object({ findings: z.array(findingSchema) }) }),
    system:
      "You inspect rental units at move-out for a California landlord's security deposit tool. You compare move-in and " +
      "move-out photos of the same room and list every visible change. You classify, you don't price. Be fair to the " +
      "tenant: when something is ordinary wear and tear, say so.\n\n" + GUIDE,
    messages: [{
      role: "user",
      content: [
        { type: "text", text: `Room: ${room}. The first ${moveIn.length} image(s) are MOVE-IN photos (indexes 0-${moveIn.length - 1}).` },
        ...moveIn.map(img),
        { type: "text", text: `The next ${moveOut.length} image(s) are MOVE-OUT photos of the same room (indexes 0-${moveOut.length - 1}).` },
        ...moveOut.map(img),
        { type: "text", text: "List every change between move-in and move-out. If nothing changed, return an empty list." },
      ],
    }],
  });
  return output.findings.map((f) => ({ ...f, room }));
}

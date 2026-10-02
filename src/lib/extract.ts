import { anthropic } from "@ai-sdk/anthropic";
import { generateText, Output } from "ai";
import { z } from "zod";
import type { LeaseTerms } from "./rules";

// Claude reads the lease and returns facts only, with the exact wording it relied on. It does not judge what is
// lawful; src/lib/rules.ts does that, so the legal logic stays deterministic and citable.

// Opus 5.5: telling wear and tear from damage is the core judgment, and the extra cost over Sonnet is a few dollars.
const MODEL = process.env.ANTHROPIC_MODEL ?? "claude-opus-5-5";

const schema = z.object({
  propertyAddress: z.string().nullable(),
  city: z.string().nullable().describe("City of the rental unit"),
  landlordName: z.string().nullable(),
  ownerType: z.enum(["natural_person", "llc_natural_persons", "llc_other", "corporation", "unknown"])
    .describe("Legal form of the landlord/owner as stated. An LLC whose members aren't stated is llc_other."),
  ownerPropertyCount: z.number().nullable().describe("Residential rental properties the owner holds, only if the lease states it"),
  ownerUnitCount: z.number().nullable().describe("Units across those properties, only if stated"),
  tenants: z.array(z.string()).describe("Adult tenants named on the lease"),
  tenancyStartDate: z.string().nullable().describe("Start of the tenancy, YYYY-MM-DD"),
  leaseEndDate: z.string().nullable().describe("End of the fixed lease term, YYYY-MM-DD; null if the lease is month to month or states no end date"),
  monthlyRent: z.number().nullable(),
  securityDeposit: z.number().nullable().describe("The amount labeled security deposit"),
  otherMoveInCharges: z.array(z.object({
    label: z.string(),
    amount: z.number(),
    refundable: z.boolean().nullable(),
    quote: z.string().describe("Exact lease wording"),
  })).describe("Every other charge due at or before move-in besides first month's rent: fees, pet deposits, key deposits, last month's rent, etc."),
  nonrefundableLanguage: z.array(z.string()).describe("Exact quotes that call any payment nonrefundable"),
  lateFee: z.object({
    amount: z.number().nullable(),
    percentOfRent: z.number().nullable(),
    deductibleFromDeposit: z.boolean(),
    quote: z.string(),
  }).nullable(),
  mandatoryCleaningClause: z.string().nullable()
    .describe("Exact quote if the lease requires professional cleaning (carpet or otherwise) at move-out regardless of condition"),
  electronicPaymentMethods: z.array(z.string()).describe("Electronic methods the lease allows for rent or deposit, e.g. PayPal, Zelle, ACH"),
  tenantIsServiceMember: z.boolean().nullable(),
});

export async function extractLeaseTerms(pdf: Uint8Array, filename: string): Promise<LeaseTerms> {
  const { output } = await generateText({
    model: anthropic(MODEL),
    output: Output.object({ schema }),
    system:
      "You extract facts from a California residential lease for a security deposit tool. Report only what the " +
      "lease says; use null when it doesn't say. Quote wording exactly. Do not give legal opinions.",
    messages: [{
      role: "user",
      content: [
        { type: "text", text: "Extract the deposit-related terms from this lease." },
        { type: "file", mediaType: "application/pdf", data: pdf, filename },
      ],
    }],
  });
  return output as LeaseTerms;
}

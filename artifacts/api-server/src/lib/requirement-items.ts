import { createHash } from "node:crypto";
import { eq } from "drizzle-orm";
import { db, requirementItemsTable, type RequirementDraft } from "@workspace/db";
import { z } from "zod/v4";

export const requirementDraftSchema = z.object({
  title: z.string().trim().min(1).max(300),
  description: z.string().trim().min(1).max(8000),
  category: z.enum(["technical", "eligibility", "commercial", "submission", "delivery", "services", "other"]),
  sourceReference: z.string().max(2000),
  sourceQuote: z.string().max(4000),
  quantity: z.number().positive().max(1000000000).nullable(),
  unit: z.string().max(200).nullable(),
  requiresVendor: z.boolean(),
});
export function requirementKey(draft: RequirementDraft): string {
  return createHash("sha256").update(JSON.stringify([draft.category, draft.title, draft.description, draft.sourceQuote].map(s => s.trim().replace(/\s+/g, " ")))).digest("hex");
}
export async function appendRequirementDrafts(
  writer: Pick<typeof db, "select" | "insert">,
  tenderId: string, ownerId: string, extractionId: string | null, drafts: RequirementDraft[],
): Promise<void> {
  const existing = await writer.select({ sourceKey: requirementItemsTable.sourceKey }).from(requirementItemsTable).where(eq(requirementItemsTable.tenderId, tenderId));
  const keys = new Set(existing.map(r => r.sourceKey));
  const values = drafts.flatMap(draft => {
    const sourceKey = requirementKey(draft);
    if (keys.has(sourceKey)) return [];
    keys.add(sourceKey);
    return [{ ...draft, tenderId, ownerId, extractionId, sourceKey }];
  });
  if (existing.length + values.length > 1000) throw new Error("This tender exceeds the 1,000 individual-requirement limit. Existing work remains unchanged; no clauses were silently omitted.");
  if (values.length) await writer.insert(requirementItemsTable).values(values);
}

// Decimal arithmetic for authoritative commercial line totals, without binary
// floating-point multiplication or assumptions about tax/shipping.
export function pkrLineTotal(quantity: number | null, unitPrice: number | null): string | null {
  if (quantity === null || unitPrice === null) return null;
  if (!Number.isFinite(quantity) || quantity <= 0 || quantity > 1e9 || !Number.isFinite(unitPrice) || unitPrice < 0 || unitPrice > 1e12) throw new Error("Invalid quantity or PKR price.");
  const fraction = (value: number) => {
    const match = value.toString().match(/^(\d+)(?:\.(\d+))?(?:e([+-]?\d+))?$/)!;
    const scale = (match[2]?.length ?? 0) - Number(match[3] ?? 0);
    return {
      numerator: BigInt(match[1]! + (match[2] ?? "")) * 10n ** BigInt(Math.max(0, -scale)),
      denominator: 10n ** BigInt(Math.max(0, scale)),
    };
  };
  const q = fraction(quantity), p = fraction(unitPrice);
  const denominator = q.denominator * p.denominator;
  const total = (q.numerator * p.numerator * 100n + denominator / 2n) / denominator;
  return `${total / 100n}.${String(total % 100n).padStart(2, "0")}`;
}

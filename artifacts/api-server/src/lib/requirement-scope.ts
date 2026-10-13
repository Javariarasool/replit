import type { RequirementsExtraction, RequirementItem } from "@workspace/db";

export const EVALUATED_CARD_SCOPE = "evaluated_only" as const;

// Keep old cards and their human evidence in storage, but do not continue
// displaying or drafting from boilerplate excluded by the current extraction.
// Manually added cards are explicit human choices (their keys have a UUID suffix).
export function visibleRequirements(rows: RequirementItem[], extraction: RequirementsExtraction | null): RequirementItem[] {
  if (!extraction) return rows;
  if (extraction.cardScope !== EVALUATED_CARD_SCOPE) return rows.filter(row => row.sourceKey.includes(":"));
  return rows.filter(row => row.extractionId === extraction.id || row.sourceKey.includes(":"));
}

import { z } from "zod";
import type { RequirementItem } from "@workspace/db";

const responseSchema = z.object({
  technical: z.string().trim().min(1),
  commercial: z.string().trim().min(1),
  requirementResponses: z.array(z.object({ requirementId: z.string(), response: z.string().trim().min(1) })),
});
export function technicalHasBidPricing(text: string): boolean {
  const amount = /\b(?:PKR|USD|Rs\.?|rupees)\s*\d|[$₨]\s*\d|\d[\d,.]*\s*(?:PKR|USD|rupees)\b|\d[\d,.]*\s+Rs\b/i;
  const bidPrice = /\b(?:(?:unit|quoted|bid|offered)\s*(?:price|rate|cost|amount)|price\s*per\s*unit|line\s*total|grand\s*total)\b/i;
  const financialEvidence = /\b(?:(?:annual|yearly)\s*(?:turnover|revenue)|financial\s*(?:capacity|eligibility|statement)|(?:paid[- ]?up|minimum|share)\s*capital|(?:past|previous|reference)\s*(?:project|contract)|(?:project|contract)\s*value|eligibility\s*(?:threshold|criterion|criteria))\b/i;
  const lines = text.split(/\r?\n/);
  return lines.some((line, i) => {
    if (bidPrice.test(line) && /\b(?:PKR|USD|rupees|Rs)\b/i.test(line)) return true;
    if (!amount.test(line)) return false;
    const context = lines.slice(Math.max(0, i - 2), i + 1).join(" ");
    // Tender-required financial qualification figures are not supplier/bid prices.
    return bidPrice.test(context) || !financialEvidence.test(context);
  });
}
export function completeProposalDrafts(value: unknown, rows: RequirementItem[]) {
  const result = responseSchema.parse(value);
  const expected = new Set(rows.map(r => r.id)), seen = new Set<string>();
  for (const entry of result.requirementResponses) {
    if (!expected.has(entry.requirementId) || seen.has(entry.requirementId)) throw new Error("Draft responses contain duplicate or unknown requirements. Neither draft was saved.");
    seen.add(entry.requirementId);
  }
  if (seen.size !== expected.size) throw new Error("The draft omitted assessed tender requirements. Neither draft was saved; regenerate to get complete coverage.");
  const responses = new Map(result.requirementResponses.map(r => [r.requirementId, r.response]));
  const text = (s: string) => s.replace(/[\r\n]+/g, " ").trim();
  const sections = (kind: "technical" | "commercial") => rows.filter(r => (r.category === "commercial") === (kind === "commercial")).map((r, i) =>
    `### ${kind === "technical" ? "T" : "C"}${String(i + 1).padStart(3, "0")} — ${text(r.title)}\n\nTender reference: ${text(r.sourceReference) || "Refer to the approved requirement checklist"}\n\n${responses.get(r.id)}`,
  ).join("\n\n");
  const technical = sections("technical"), commercial = sections("commercial");
  return {
    technical: result.technical + (technical ? `\n\n## Assessed tender requirement responses\n\n${technical}` : ""),
    commercial: result.commercial + (commercial ? `\n\n## Assessed commercial requirement responses\n\n${commercial}` : ""),
  };
}

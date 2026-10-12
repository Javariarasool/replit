import type { Evidence, RequirementItem } from "@workspace/db";
import { pkrLineTotal } from "./requirement-items";

export function requirementProposalContext(rows: RequirementItem[], files: Evidence[], extractionId: string | null) {
  const technical = [];
  const commercial = [];
  const pricingLines: string[] = [];
  const md = (s: string) => s.replace(/\|/g, "\\|").replace(/[\r\n]+/g, " ");
  for (const row of rows) {
    if (row.reviewStatus !== "approved" || row.extractionId !== extractionId) throw new Error(`Review "${row.title}" against the current tender before drafting.`);
    const linked = files.filter(f => row.evidenceIds.includes(f.id));
    if (row.evidenceIds.some(id => !files.some(f => f.id === id))) throw new Error(`Evidence linked to "${row.title}" was removed. Update the evidence links first.`);
    const option = row.options.find(o => o.id === row.selectedOptionId);
    if (row.requiresVendor && (!option || !option.reviewed)) throw new Error(`Choose and confirm a supplier/product for "${row.title}" before drafting.`);
    if (option?.quoteEvidenceId && !linked.some(f => f.id === option.quoteEvidenceId)) throw new Error(`The quotation for "${row.title}" is no longer linked.`);
    const base = {
      requirementId: row.id, title: row.title, category: row.category, requirement: row.description,
      sourceReference: row.sourceReference, sourceQuote: row.sourceQuote, quantity: row.quantity, unit: row.unit,
      evidence: linked.map(f => ({ id: f.id, name: f.name, category: f.category,
        linkMeaning: "Attached for review, not verified proof. Cite only claims explicitly supported by the actual document text.",
      })),
      verifiedWebEvidence: row.webEvidence.filter(e => e.verified),
      hasLinkedMaterial: !!linked.length || row.webEvidence.some(e => e.verified) || !!option?.datasheetUrl,
      evidenceAssessment: "Requirement approval and supplier selection are decisions, not certification of document support. Assess the actual source text separately for each claimed fact.",
    };
    if (row.category !== "commercial") technical.push({
      ...base, selectedProduct: option ? {
        manufacturer: option.manufacturer, product: option.product, model: option.model, supplier: option.supplier,
        datasheetUrl: option.datasheetUrl, specifications: option.specifications, matchSummary: option.matchSummary,
        gaps: option.gaps, deliveryStatus: option.deliveryStatus, deliveryNotes: option.deliveryNotes,
      } : null,
    });
    commercial.push({ ...base, selectedOption: option ? { ...option, lineTotalPkr: pkrLineTotal(row.quantity, option.pricePkr) } : null });
    if (option) {
      const lineTotal = pkrLineTotal(row.quantity, option.pricePkr);
      pricingLines.push(`| ${md(row.title)} | ${md(option.supplier)} | ${md(`${option.manufacturer} ${option.product} ${option.model}`)} | ${row.quantity ?? "Confirm quantity"} ${md(row.unit ?? "")} | ${option.pricePkr === null ? "Quote required" : option.pricePkr.toString()} | ${lineTotal ?? "Not calculated—missing quantity/quote"} | ${option.taxStatus} | ${md(option.priceSourceUrl ?? (option.quoteEvidenceId ? `Uploaded quotation ${files.find(f => f.id === option.quoteEvidenceId)?.name ?? option.quoteEvidenceId}` : "Quotation required"))}; checked ${option.checkedAt.slice(0, 10)} |`);
    }
  }
  const schedule = pricingLines.length ? [
    "## Human-selected supplier pricing schedule (PKR)",
    "",
    "These unit prices and decimal-calculated line totals come from the human-selected options. They are not binding supplier quotations. Unknown prices are not treated as zero. Tax, shipping, bid margin and quote validity must be confirmed separately; no all-inclusive grand total is asserted.",
    "",
    "| Requirement | Supplier | OEM / product / model | Quantity / unit | Unit price PKR | Line total PKR | Tax basis | Price source / checked date |",
    "|---|---|---|---|---:|---:|---|---|",
    ...pricingLines,
  ].join("\n") : "";
  return { technical, commercial, schedule };
}

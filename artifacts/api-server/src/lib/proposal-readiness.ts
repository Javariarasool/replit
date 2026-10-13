import { and, eq, inArray } from "drizzle-orm";
import { db, requirementItemsTable, evidenceTable, uploadsTable, type RequirementItem, type Evidence, type DocumentExtraction } from "@workspace/db";
import type { ProposalReadiness } from "@workspace/api-zod";
import { resolveTenderEvidence } from "./company-evidence";
import { EVALUATED_CARD_SCOPE, visibleRequirements } from "./requirement-scope";
import { sameTenderSources } from "./tender-requirements";
import type { ownedTender } from "./tender-data";
type Tender = NonNullable<Awaited<ReturnType<typeof ownedTender>>>;
type File = Evidence & { applicability?: string; warnings?: string[] };

export function proposalReadiness(tender: Tender, rows: RequirementItem[], files: File[], texts: Map<string, DocumentExtraction | null>): ProposalReadiness {
  const blockers: ProposalReadiness["blockers"] = [];
  const global = (reason: string) => blockers.push({ requirementId: null, title: "Tender checklist", reasons: [reason] });
  if (!rows.length) global("Extract or add the assessed tender requirements before drafting.");
  if (tender.requirementsExtraction?.job?.status === "processing") global("Wait for requirement extraction to finish.");
  if (tender.requirementsExtraction && tender.requirementsExtraction.cardScope !== EVALUATED_CARD_SCOPE) global("Extract again using the assessed-only checklist rules.");
  if (tender.requirementsExtraction && !sameTenderSources(files, tender.requirementsExtraction)) global("Tender documents changed. Extract and review the current checklist again.");
  let readyCount = 0;
  for (const row of rows) {
    const reasons: string[] = [], linked = files.filter(f => row.evidenceIds.includes(f.id));
    if (row.reviewStatus !== "approved" || row.extractionId !== (tender.requirementsExtraction?.id ?? null)) reasons.push("Review and approve against the current tender.");
    if (row.evidenceIds.some(id => !files.some(f => f.id === id))) reasons.push("Replace removed evidence links.");
    const option = row.options.find(o => o.id === row.selectedOptionId);
    if (!linked.length && !row.webEvidence.some(w => w.verified) && !(option?.reviewed && option.datasheetUrl)) reasons.push("Link supporting evidence or a human-verified source.");
    for (const file of linked) {
      if ((file.companyEvidenceId || file.companySnapshot) && (file.applicability !== "applicable" || file.warnings?.some(w => !w.startsWith("Expiry date not recorded")))) {
        reasons.push(`Review or replace company evidence: ${file.name}.`);
      }
      const text = texts.get(file.objectPath);
      const readable = !!text && ["not_needed", "verified"].includes(text.status) && !!(text.reviewedText?.trim() || text.sourceText?.trim() || (text.status === "verified" && text.ocrText?.trim()));
      // Notes are explicit human evidence; source text must still be reviewed if OCR awaits verification.
      if (text && ["queued", "running", "needs_review", "cancelled"].includes(text.status)) reasons.push(`Finish reading/OCR review for ${file.name}.`);
      else if (!readable && !file.notes.trim()) reasons.push(`Add readable evidence or focused human notes for ${file.name}.`);
    }
    if (row.requiresVendor) {
      if (!option?.reviewed) reasons.push("Select and human-confirm a supplier/product.");
      if (option?.reviewed) {
        if (option.deliveryStatus !== "source_states_pakistan") reasons.push("Confirm supplier evidence of delivery to Pakistan.");
        if (option.pricePkr === null) reasons.push("Provide and confirm a current PKR unit price.");
        if (!option.priceSourceUrl && !option.quoteEvidenceId) reasons.push("Provide the current price source or linked quotation.");
        if (option.quoteEvidenceId && !linked.some(f => f.id === option.quoteEvidenceId)) reasons.push("Link the selected supplier quotation.");
        if (option.gaps.length) reasons.push("Resolve selected product specification gaps before drafting.");
        if (row.quantity === null || row.quantity <= 0) reasons.push("Confirm the required quantity for the commercial proposal.");
      }
    }
    if (reasons.length) blockers.push({ requirementId: row.id, title: row.title, reasons: [...new Set(reasons)] });
    else readyCount++;
  }
  return { ready: rows.length > 0 && !blockers.length, requirementCount: rows.length, readyCount, blockers };
}

export async function loadProposalReadiness(tender: Tender, ownerId: string) {
  const [allRows, files] = await Promise.all([
    db.select().from(requirementItemsTable).where(and(eq(requirementItemsTable.tenderId, tender.id), eq(requirementItemsTable.ownerId, ownerId))),
    db.select().from(evidenceTable).where(and(eq(evidenceTable.tenderId, tender.id), eq(evidenceTable.ownerId, ownerId))),
  ]);
  const rows = visibleRequirements(allRows, tender.requirementsExtraction);
  const resolved = await resolveTenderEvidence(files, tender);
  const paths = [...new Set(rows.flatMap(r => r.evidenceIds).map(id => files.find(f => f.id === id)?.objectPath).filter((p): p is string => !!p))];
  const uploads = paths.length ? await db.select({ path: uploadsTable.objectPath, extraction: uploadsTable.extraction }).from(uploadsTable)
    .where(and(eq(uploadsTable.ownerId, ownerId), inArray(uploadsTable.objectPath, paths))) : [];
  return proposalReadiness(tender, rows, resolved, new Map(uploads.map(u => [u.path, u.extraction])));
}

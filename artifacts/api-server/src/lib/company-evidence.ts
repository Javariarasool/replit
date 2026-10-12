import { eq, inArray } from "drizzle-orm";
import { db, companyEvidenceTable, evidenceTable, type Evidence, type Tender } from "@workspace/db";

type Metadata = {
  issueDate: string | null; expiryDate: string | null; tenderCategory: string | null;
  agency: string; tenderReference: string;
};

export function evidenceWarnings(meta: Metadata, tender?: Pick<Tender, "category" | "agency" | "referenceNumber" | "closingDate">, applicability = "pending", today = new Date().toISOString().slice(0, 10)): string[] {
  const warnings: string[] = [];
  if (meta.expiryDate && meta.expiryDate < today) warnings.push(`Expired on ${meta.expiryDate}.`);
  else if (tender?.closingDate && meta.expiryDate && meta.expiryDate < tender.closingDate) warnings.push(`Expires before tender closing date (${tender.closingDate}).`);
  if (meta.issueDate && meta.issueDate > today) warnings.push(`Not yet issued (issue date ${meta.issueDate}).`);
  if (!meta.expiryDate) warnings.push("Expiry date not recorded; check whether this document has a validity limit.");
  if (tender) {
    if (meta.tenderCategory && meta.tenderCategory !== tender.category) warnings.push("Not applicable: tender category does not match the evidence scope.");
    if (meta.agency && meta.agency.trim().toLowerCase() !== tender.agency.trim().toLowerCase()) warnings.push("Not applicable: issuing agency scope does not match this tender.");
    if (meta.tenderReference && meta.tenderReference.trim().toLowerCase() !== tender.referenceNumber?.trim().toLowerCase()) warnings.push("Not applicable: authorization is for a different tender reference.");
    if (applicability === "not_applicable") warnings.push("Marked not applicable to this tender by a reviewer.");
    if (applicability === "pending") warnings.push("Applicability has not been reviewed for this tender.");
  }
  return warnings;
}

export function validEvidenceDates(meta: Pick<Metadata, "issueDate" | "expiryDate">): boolean {
  const valid = (s: string | null) => !s || (/^\d{4}-\d{2}-\d{2}$/.test(s) && !Number.isNaN(Date.parse(s)) && new Date(s).toISOString().slice(0, 10) === s);
  return valid(meta.issueDate) && valid(meta.expiryDate) && !(meta.issueDate && meta.expiryDate && meta.issueDate > meta.expiryDate);
}

export async function resolveTenderEvidence(rows: Evidence[], tender: Tender) {
  const ids = rows.flatMap(r => r.companyEvidenceId ? [r.companyEvidenceId] : []);
  const company = ids.length ? await db.select().from(companyEvidenceTable).where(inArray(companyEvidenceTable.id, ids)) : [];
  return rows.map(row => {
    const current = company.find(c => c.id === row.companyEvidenceId);
    const meta = current ?? row.companySnapshot;
    return { ...row, category: current?.category ?? row.category, notes: current?.notes ?? row.notes,
      issueDate: meta?.issueDate ?? null, expiryDate: meta?.expiryDate ?? null,
      warnings: meta ? evidenceWarnings(meta, tender, row.applicability) : [] };
  });
}

export async function listResolvedTenderEvidence(tender: Tender) {
  const rows = await db.select().from(evidenceTable).where(eq(evidenceTable.tenderId, tender.id));
  return resolveTenderEvidence(rows, tender);
}

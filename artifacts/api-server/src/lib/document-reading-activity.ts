import { and, eq, isNotNull, sql } from "drizzle-orm";
import { db, uploadsTable, proposalLibraryTable, evidenceTable, tendersTable, companyEvidenceTable } from "@workspace/db";
import type { DocumentReadingActivity, DocumentReadingLink } from "@workspace/api-zod";

// Project only safe metadata in SQL: OCR, source text, errors, worker tokens,
// and lease details must never enter this activity response.
export async function listDocumentReadingActivity(ownerId: string): Promise<DocumentReadingActivity[]> {
  const [uploads, library, evidence, company] = await Promise.all([
    db.select({
      name: uploadsTable.name, objectPath: uploadsTable.objectPath,
      metadata: sql<Omit<DocumentReadingActivity, "name" | "objectPath" | "reviewLinks">>`jsonb_build_object(
        'id', coalesce(extraction->'job'->>'id', object_path),
        'status', extraction->>'status',
        'completedPages', coalesce((extraction->'job'->>'completedPages')::int, 0),
        'totalPages', (extraction->'job'->>'totalPages')::int,
        'queuedAt', coalesce(extraction->'job'->>'queuedAt', created_at::text),
        'finishedAt', extraction->'job'->>'finishedAt')`,
    }).from(uploadsTable).where(and(eq(uploadsTable.ownerId, ownerId), isNotNull(uploadsTable.extraction))),
    db.select({
      id: proposalLibraryTable.id, tender: proposalLibraryTable.tenderObjectPath,
      technical: proposalLibraryTable.technicalObjectPath, commercial: proposalLibraryTable.commercialObjectPath,
    }).from(proposalLibraryTable).where(eq(proposalLibraryTable.ownerId, ownerId)),
    db.select({ id: evidenceTable.id, tenderId: evidenceTable.tenderId, path: evidenceTable.objectPath })
      .from(evidenceTable).innerJoin(tendersTable, eq(evidenceTable.tenderId, tendersTable.id))
      .where(and(eq(evidenceTable.ownerId, ownerId), eq(tendersTable.ownerId, ownerId))),
    db.select({ id: companyEvidenceTable.id, path: companyEvidenceTable.objectPath })
      .from(companyEvidenceTable).where(eq(companyEvidenceTable.ownerId, ownerId)),
  ]);
  const links = new Map<string, DocumentReadingLink[]>();
  const add = (path: string | null, link: DocumentReadingLink) => {
    if (path) links.set(path, [...(links.get(path) ?? []), link]);
  };
  for (const entry of library) {
    for (const [kind, path] of [["tender", entry.tender], ["technical", entry.technical], ["commercial", entry.commercial]] as const) {
      add(path, { label: `Review library ${kind}`, href: `/library/${entry.id}` });
    }
  }
  for (const entry of evidence) add(entry.path, { label: "Review tender evidence", href: `/tenders/${entry.tenderId}?tab=evidence` });
  for (const entry of company) add(entry.path, { label: "Review company evidence", href: "/company-evidence" });
  return uploads.map(upload => ({
    ...upload.metadata, name: upload.name, objectPath: upload.objectPath,
    reviewLinks: links.get(upload.objectPath) ?? [{
      label: "Review document", href: `/readings/review?objectPath=${encodeURIComponent(upload.objectPath)}`,
    }],
  })).sort((a, b) => {
    const active = (status: string) => status === "queued" || status === "running" ? 1 : 0;
    return active(b.status) - active(a.status) ||
      Date.parse(b.finishedAt ?? b.queuedAt) - Date.parse(a.finishedAt ?? a.queuedAt);
  });
}

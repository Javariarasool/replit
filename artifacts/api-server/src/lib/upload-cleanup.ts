import { and, eq, or } from "drizzle-orm";
import { db, evidenceTable, companyEvidenceTable, proposalLibraryTable, uploadsTable } from "@workspace/db";
import { ObjectNotFoundError, ObjectStorageService } from "./objectStorage";

const storage = new ObjectStorageService();

export async function removeUnusedUpload(
  objectPath: string,
  ownerId: string,
  excluded: { evidenceId?: string; tenderId?: string; libraryId?: string; companyEvidenceId?: string } = {},
): Promise<void> {
  const [upload] = await db.select().from(uploadsTable)
    .where(and(eq(uploadsTable.objectPath, objectPath), eq(uploadsTable.ownerId, ownerId)));
  if (!upload) return;
  const evidence = await db.select({ id: evidenceTable.id, tenderId: evidenceTable.tenderId })
    .from(evidenceTable).where(eq(evidenceTable.objectPath, objectPath));
  if (evidence.some(e => e.id !== excluded.evidenceId && e.tenderId !== excluded.tenderId)) return;
  const company = await db.select({ id: companyEvidenceTable.id }).from(companyEvidenceTable).where(eq(companyEvidenceTable.objectPath, objectPath));
  if (company.some(e => e.id !== excluded.companyEvidenceId)) return;
  const archives = await db.select({ id: proposalLibraryTable.id }).from(proposalLibraryTable).where(or(
    eq(proposalLibraryTable.tenderObjectPath, objectPath),
    eq(proposalLibraryTable.technicalObjectPath, objectPath),
    eq(proposalLibraryTable.commercialObjectPath, objectPath),
  ));
  if (archives.some(a => a.id !== excluded.libraryId)) return;
  try {
    const object = await storage.getObjectEntityFile(objectPath);
    await object.delete({ ignoreNotFound: true });
  } catch (error) {
    if (!(error instanceof ObjectNotFoundError)) throw error;
  }
  await db.delete(uploadsTable).where(eq(uploadsTable.objectPath, objectPath));
}

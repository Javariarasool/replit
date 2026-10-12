import { Router, type IRouter } from "express";
import { and, eq, ilike, or, desc, sql } from "drizzle-orm";
import {
  db, proposalLibraryTable, proposalsTable, evidenceTable, uploadsTable, type ProposalLibraryEntry,
} from "@workspace/db";
import {
  ListProposalLibraryQueryParams, ListProposalLibraryResponse, CreateLibraryEntryBody, CreateLibraryEntryResponse,
  GetLibraryEntryParams, GetLibraryEntryResponse, UpdateLibraryEntryParams, UpdateLibraryEntryBody,
  UpdateLibraryEntryResponse, DeleteLibraryEntryParams,
} from "@workspace/api-zod";
import { requireAuth, ownedTender } from "../lib/tender-data";
import { ObjectStorageService } from "../lib/objectStorage";
import { evidenceContext } from "../lib/documents";
import { ensureExtraction } from "../lib/document-extractions";
import { removeUnusedUpload } from "../lib/upload-cleanup";

const router: IRouter = Router();
const storage = new ObjectStorageService();
router.use(requireAuth);

function metadata(row: ProposalLibraryEntry) {
  const { ownerId: _owner, tenderText: _tender, technicalText: _tech, commercialText: _commercial, ...data } = row;
  return data;
}

router.get("/proposal-library", async (req, res): Promise<void> => {
  const params = ListProposalLibraryQueryParams.safeParse(req.query);
  if (!params.success) { res.status(400).json({ error: "Invalid library search filters." }); return; }
  const filters = [eq(proposalLibraryTable.ownerId, req.user!.id)];
  if (params.data.category) filters.push(eq(proposalLibraryTable.category, params.data.category));
  if (params.data.outcome) filters.push(eq(proposalLibraryTable.outcome, params.data.outcome));
  if (params.data.q?.trim()) {
    const term = `%${params.data.q.trim().replace(/[%_\\]/g, "\\$&")}%`;
    filters.push(or(sql`exists (select 1 from document_uploads u where u.owner_id = ${req.user!.id}
      and u.object_path in (${proposalLibraryTable.tenderObjectPath}, ${proposalLibraryTable.technicalObjectPath}, ${proposalLibraryTable.commercialObjectPath})
      and (u.extraction->>'ocrText' ilike ${term} or u.extraction->>'reviewedText' ilike ${term}))`, ...[
      proposalLibraryTable.title, proposalLibraryTable.tenderTitle, proposalLibraryTable.agency,
      proposalLibraryTable.referenceNumber, proposalLibraryTable.versionLabel, proposalLibraryTable.notes, proposalLibraryTable.tenderText,
      proposalLibraryTable.technicalText, proposalLibraryTable.commercialText,
    ].map(column => ilike(column, term)))!);
  }
  const rows = await db.select().from(proposalLibraryTable).where(and(...filters)).orderBy(desc(proposalLibraryTable.updatedAt));
  res.json(ListProposalLibraryResponse.parse(rows.map(metadata)));
});

router.post("/proposal-library", async (req, res): Promise<void> => {
  const body = CreateLibraryEntryBody.safeParse(req.body);
  if (!body.success) { res.status(400).json({ error: "Provide the archive title, agency and category." }); return; }
  const data = body.data;
  const ownerId = req.user!.id;
  let tenderText = "", technicalText = "", commercialText = "";
  const warnings: string[] = [];
  let tenderObjectPath: string | null = null, technicalObjectPath: string | null = null, commercialObjectPath: string | null = null;
  try {
    if (data.sourceTenderId) {
      if (data.tenderObjectPath || data.technicalObjectPath || data.commercialObjectPath) {
        res.status(400).json({ error: "Choose uploaded documents OR a generated pair, not both." }); return;
      }
      const tender = await ownedTender(data.sourceTenderId, ownerId);
      if (!tender) { res.status(404).json({ error: "Source tender not found." }); return; }
      const drafts = await db.select().from(proposalsTable).where(eq(proposalsTable.tenderId, tender.id)).orderBy(desc(proposalsTable.version));
      const technical = drafts.find(p => p.kind === "technical"), commercial = drafts.find(p => p.kind === "commercial");
      if (!technical || !commercial || technical.status !== "approved" || commercial.status !== "approved") {
        res.status(400).json({ error: "Approve the latest technical and commercial drafts before archiving this pair." }); return;
      }
      const tenderFiles = await db.select().from(evidenceTable).where(and(eq(evidenceTable.tenderId, tender.id), eq(evidenceTable.category, "tender_rfp")));
      tenderText = `Title: ${tender.title}\nAgency: ${tender.agency}\nReference: ${tender.referenceNumber ?? ""}\nSummary: ${tender.summary}\nRequirements: ${tender.requirements}\n${await evidenceContext(tenderFiles)}`;
      technicalText = technical.content;
      commercialText = commercial.content;
    } else {
      if (!data.tenderObjectPath || (!data.technicalObjectPath && !data.commercialObjectPath)) {
        res.status(400).json({ error: "Upload the original tender and at least one corresponding proposal document." }); return;
      }
      const read = async (path: string | undefined, label: string): Promise<string> => {
        if (!path) return "";
        const [upload] = await db.select().from(uploadsTable)
          .where(and(eq(uploadsTable.objectPath, path), eq(uploadsTable.ownerId, ownerId)));
        if (!upload) throw new Error(`${label} upload is not owned by your account.`);
        const file = await storage.getObjectEntityFile(path);
        const [metadata] = await file.getMetadata();
        if (Number(metadata.size) > 25 * 1024 * 1024) throw new Error(`${label} must be 25 MB or smaller.`);
        try {
          const extraction = await ensureExtraction(path, ownerId);
          const text = extraction.sourceText;
          if (extraction.status === "failed") warnings.push(`${label}: ${extraction.error} Original preserved; review extraction details.`);
          if (!text.trim() && !extraction.ocrText.trim()) warnings.push(`${label}: no readable text found. Add notes or a clearer document.`);
          if (text.length > 500000) {
            warnings.push(`${label}: extracted text exceeds the archive limit. The original file is stored; text search/reuse is unavailable for this document.`);
            return "";
          }
          return text;
        } catch {
          warnings.push(`${label}: text extraction unavailable. The original file is stored and searchable by metadata/notes only.`);
          return "";
        }
      };
      tenderText = await read(data.tenderObjectPath, "Tender");
      technicalText = await read(data.technicalObjectPath, "Technical proposal");
      commercialText = await read(data.commercialObjectPath, "Commercial proposal");
      tenderObjectPath = data.tenderObjectPath;
      technicalObjectPath = data.technicalObjectPath ?? null;
      commercialObjectPath = data.commercialObjectPath ?? null;
    }
    const [row] = await db.insert(proposalLibraryTable).values({
      ownerId, title: data.title, tenderTitle: data.tenderTitle ?? data.title, agency: data.agency,
      category: data.category, referenceNumber: data.referenceNumber ?? null,
      submissionDate: data.submissionDate?.toISOString().slice(0, 10) ?? null,
      outcome: data.outcome ?? "unknown", versionLabel: data.versionLabel ?? "Final", notes: data.notes ?? "",
      sourceTenderId: data.sourceTenderId ?? null, tenderObjectPath, technicalObjectPath, commercialObjectPath,
      tenderText, technicalText, commercialText, extractionWarnings: warnings,
    }).returning();
    res.status(201).json(CreateLibraryEntryResponse.parse(row));
  } catch (error) {
    req.log.warn({ errorName: error instanceof Error ? error.name : "Error" }, "Archive import failed");
    res.status(400).json({ error: error instanceof Error ? error.message : "The archive could not be imported." });
  }
});

router.get("/proposal-library/:entryId", async (req, res): Promise<void> => {
  const params = GetLibraryEntryParams.safeParse(req.params);
  if (!params.success) { res.status(400).json({ error: "Invalid archive identifier." }); return; }
  const [row] = await db.select().from(proposalLibraryTable).where(and(eq(proposalLibraryTable.id, params.data.entryId), eq(proposalLibraryTable.ownerId, req.user!.id)));
  if (!row) { res.status(404).json({ error: "Archive not found." }); return; }
  res.json(GetLibraryEntryResponse.parse(row));
});

router.patch("/proposal-library/:entryId", async (req, res): Promise<void> => {
  const params = UpdateLibraryEntryParams.safeParse(req.params), body = UpdateLibraryEntryBody.safeParse(req.body);
  if (!params.success || !body.success) { res.status(400).json({ error: "Invalid archive details." }); return; }
  const { submissionDate, ...fields } = body.data;
  const [row] = await db.update(proposalLibraryTable).set({
    ...fields, ...(submissionDate !== undefined ? { submissionDate: submissionDate?.toISOString().slice(0, 10) ?? null } : {}), updatedAt: new Date(),
  }).where(and(eq(proposalLibraryTable.id, params.data.entryId), eq(proposalLibraryTable.ownerId, req.user!.id))).returning();
  if (!row) { res.status(404).json({ error: "Archive not found." }); return; }
  res.json(UpdateLibraryEntryResponse.parse(row));
});

router.delete("/proposal-library/:entryId", async (req, res): Promise<void> => {
  const params = DeleteLibraryEntryParams.safeParse(req.params);
  if (!params.success) { res.status(400).json({ error: "Invalid archive identifier." }); return; }
  const [row] = await db.select().from(proposalLibraryTable).where(and(eq(proposalLibraryTable.id, params.data.entryId), eq(proposalLibraryTable.ownerId, req.user!.id)));
  if (!row) { res.status(404).json({ error: "Archive not found." }); return; }
  for (const path of new Set([row.tenderObjectPath, row.technicalObjectPath, row.commercialObjectPath].filter((p): p is string => !!p))) {
    await removeUnusedUpload(path, req.user!.id, { libraryId: row.id });
  }
  await db.delete(proposalLibraryTable).where(eq(proposalLibraryTable.id, row.id));
  res.sendStatus(204);
});

export default router;

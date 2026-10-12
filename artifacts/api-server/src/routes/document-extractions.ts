import { Router, type IRouter } from "express";
import { and, eq } from "drizzle-orm";
import { db, uploadsTable } from "@workspace/db";
import { GetDocumentExtractionQueryParams, ExtractUploadedDocumentBody, ReviewDocumentExtractionBody } from "@workspace/api-zod";
import { requireAuth } from "../lib/tender-data";
import { ensureExtraction } from "../lib/document-extractions";

const router: IRouter = Router();
router.use(requireAuth);
router.get("/documents/extraction", async (req, res): Promise<void> => {
  const query = GetDocumentExtractionQueryParams.safeParse(req.query);
  if (!query.success) { res.status(400).json({ error: "Provide the document path." }); return; }
  const [upload] = await db.select().from(uploadsTable).where(and(eq(uploadsTable.objectPath, query.data.objectPath), eq(uploadsTable.ownerId, req.user!.id)));
  if (!upload) { res.status(404).json({ error: "Document not found." }); return; }
  res.json(upload.extraction);
});
router.post("/documents/extraction", async (req, res): Promise<void> => {
  const body = ExtractUploadedDocumentBody.safeParse(req.body);
  if (!body.success) { res.status(400).json({ error: "Provide the document path." }); return; }
  try { res.json(await ensureExtraction(body.data.objectPath, req.user!.id, body.data.retry)); }
  catch (error) { res.status(400).json({ error: error instanceof Error ? error.message : "Extraction failed." }); }
});
router.patch("/documents/extraction", async (req, res): Promise<void> => {
  const body = ReviewDocumentExtractionBody.safeParse(req.body);
  if (!body.success || !body.data.confirmed) { res.status(400).json({ error: "Confirm you checked the OCR against the original document." }); return; }
  const [upload] = await db.select().from(uploadsTable).where(and(eq(uploadsTable.objectPath, body.data.objectPath), eq(uploadsTable.ownerId, req.user!.id)));
  if (!upload) { res.status(404).json({ error: "Document not found." }); return; }
  const current = upload.extraction;
  if (!current || !["needs_review", "verified", "rejected"].includes(current.status)) { res.status(409).json({ error: "This document has no completed OCR to review." }); return; }
  if (body.data.status === "verified" && !body.data.reviewedText?.trim()) { res.status(400).json({ error: "Provide the checked OCR text." }); return; }
  const extraction = { ...current, status: body.data.status, reviewedText: body.data.status === "verified" ? body.data.reviewedText! : null, reviewedAt: new Date().toISOString() };
  await db.update(uploadsTable).set({ extraction }).where(and(eq(uploadsTable.objectPath, upload.objectPath), eq(uploadsTable.ownerId, req.user!.id)));
  res.json(extraction);
});
export default router;

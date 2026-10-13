import { Router, type IRouter } from "express";
import { and, eq } from "drizzle-orm";
import { db, uploadsTable } from "@workspace/db";
import { GetDocumentExtractionQueryParams, ExtractUploadedDocumentBody, ReviewDocumentExtractionBody } from "@workspace/api-zod";
import { requireAuth } from "../lib/tender-data";
import { ensureExtraction, isExtractionActive } from "../lib/document-extractions";

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
  if (!body.success) { res.status(400).json({ error: "Provide the document path and a supported OCR language (English, Urdu, or English + Urdu)." }); return; }
  try { res.json(await ensureExtraction(body.data.objectPath, req.user!.id, body.data.retry, body.data.language)); }
  catch (error) { res.status(400).json({ error: error instanceof Error ? error.message : "Extraction failed." }); }
});
router.patch("/documents/extraction", async (req, res): Promise<void> => {
  const body = ReviewDocumentExtractionBody.safeParse(req.body);
  if (!body.success || !body.data.confirmed) { res.status(400).json({ error: "Confirm you checked the OCR against the original document." }); return; }
  const [upload] = await db.select().from(uploadsTable).where(and(eq(uploadsTable.objectPath, body.data.objectPath), eq(uploadsTable.ownerId, req.user!.id)));
  if (!upload) { res.status(404).json({ error: "Document not found." }); return; }
  const current = upload.extraction;
  if (isExtractionActive(body.data.objectPath, req.user!.id)) { res.status(409).json({ error: "Wait for the current OCR reading to finish before reviewing it." }); return; }
  if (!current || !["needs_review", "verified", "rejected"].includes(current.status)) { res.status(409).json({ error: "This document has no completed OCR to review." }); return; }
  if ((current.language ?? "eng") !== (body.data.language ?? "eng")) { res.status(409).json({ error: "The recognition language changed. Reload the extraction and check the new OCR against the original." }); return; }
  if (body.data.status === "verified" && !body.data.reviewedText?.trim()) { res.status(400).json({ error: "Provide the checked OCR text." }); return; }
  const extraction = { ...current, status: body.data.status, reviewedText: body.data.status === "verified" ? body.data.reviewedText! : null, reviewedAt: new Date().toISOString() };
  const updated = await db.update(uploadsTable).set({ extraction }).where(and(eq(uploadsTable.objectPath, upload.objectPath), eq(uploadsTable.ownerId, req.user!.id), eq(uploadsTable.extraction, current))).returning({ objectPath: uploadsTable.objectPath });
  if (!updated.length) { res.status(409).json({ error: "The OCR changed while you were reviewing it. Reload and review the current text." }); return; }
  res.json(extraction);
});
export default router;

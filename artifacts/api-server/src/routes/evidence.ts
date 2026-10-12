import { Router, type IRouter } from "express";
import { and, eq, desc } from "drizzle-orm";
import { db, evidenceTable, uploadsTable, vendorSourcesTable } from "@workspace/db";
import {
  ListTenderEvidenceParams, ListTenderEvidenceResponse, AddTenderEvidenceParams,
  AddTenderEvidenceBody, AddTenderEvidenceResponse, DeleteEvidenceParams,
  ListVendorSourcesParams, ListVendorSourcesResponse, AddVendorSourceParams, AddVendorSourceBody,
  AddVendorSourceResponse, ReviewVendorSourceParams, ReviewVendorSourceBody, ReviewVendorSourceResponse,
  ResearchVendorSourceParams, ResearchVendorSourceBody, ResearchVendorSourceResponse,
} from "@workspace/api-zod";
import { requireAuth, ownedTender } from "../lib/tender-data";
import { ObjectStorageService } from "../lib/objectStorage";
import { researchSource } from "../lib/vendor-research";
import { removeUnusedUpload } from "../lib/upload-cleanup";
import { ensureExtraction } from "../lib/document-extractions";
import { resolveTenderEvidence } from "../lib/company-evidence";

const router: IRouter = Router();
const storage = new ObjectStorageService();
const researchInFlight = new Set<string>();
router.use(requireAuth);

router.get("/tenders/:tenderId/evidence", async (req, res): Promise<void> => {
  const params = ListTenderEvidenceParams.safeParse(req.params);
  if (!params.success) { res.status(400).json({ error: "Invalid tender identifier." }); return; }
  const tender = await ownedTender(params.data.tenderId, req.user!.id);
  if (!tender) { res.status(404).json({ error: "Tender not found." }); return; }
  const rows = await db.select().from(evidenceTable).where(eq(evidenceTable.tenderId, params.data.tenderId)).orderBy(desc(evidenceTable.uploadedAt));
  res.json(ListTenderEvidenceResponse.parse(await resolveTenderEvidence(rows, tender)));
});

router.post("/tenders/:tenderId/evidence", async (req, res): Promise<void> => {
  const params = AddTenderEvidenceParams.safeParse(req.params);
  const body = AddTenderEvidenceBody.safeParse(req.body);
  if (!params.success || !body.success) { res.status(400).json({ error: "Invalid evidence metadata." }); return; }
  if (!await ownedTender(params.data.tenderId, req.user!.id)) { res.status(404).json({ error: "Tender not found." }); return; }
  const [upload] = await db.select().from(uploadsTable).where(and(eq(uploadsTable.objectPath, body.data.objectPath), eq(uploadsTable.ownerId, req.user!.id)));
  if (!upload) { res.status(403).json({ error: "This upload does not belong to your account." }); return; }
  const object = await storage.getObjectEntityFile(upload.objectPath);
  const [metadata] = await object.getMetadata();
  if (Number(metadata.size) > 25 * 1024 * 1024) { res.status(400).json({ error: "Documents must be 25 MB or smaller." }); return; }
  // Extraction failure is visible in the document record; the original remains intact.
  try { await ensureExtraction(upload.objectPath, req.user!.id); }
  catch { /* The saved evidence exposes an explicit extraction action when OCR is busy. */ }
  const [row] = await db.insert(evidenceTable).values({
    ...body.data, name: upload.name, size: Number(metadata.size), contentType: upload.contentType,
    tenderId: params.data.tenderId, ownerId: req.user!.id, notes: body.data.notes ?? "",
  }).returning();
  res.status(201).json(AddTenderEvidenceResponse.parse(row));
});

router.delete("/evidence/:evidenceId", async (req, res): Promise<void> => {
  const params = DeleteEvidenceParams.safeParse(req.params);
  if (!params.success) { res.status(400).json({ error: "Invalid evidence identifier." }); return; }
  const [row] = await db.select().from(evidenceTable).where(and(eq(evidenceTable.id, params.data.evidenceId), eq(evidenceTable.ownerId, req.user!.id)));
  if (!row) { res.status(404).json({ error: "Evidence not found." }); return; }
  await removeUnusedUpload(row.objectPath, req.user!.id, { evidenceId: row.id });
  await db.delete(evidenceTable).where(eq(evidenceTable.id, row.id));
  res.sendStatus(204);
});

router.get("/tenders/:tenderId/vendor-sources", async (req, res): Promise<void> => {
  const params = ListVendorSourcesParams.safeParse(req.params);
  if (!params.success) { res.status(400).json({ error: "Invalid tender identifier." }); return; }
  if (!await ownedTender(params.data.tenderId, req.user!.id)) { res.status(404).json({ error: "Tender not found." }); return; }
  res.json(ListVendorSourcesResponse.parse(await db.select().from(vendorSourcesTable).where(eq(vendorSourcesTable.tenderId, params.data.tenderId)).orderBy(desc(vendorSourcesTable.createdAt))));
});

router.post("/tenders/:tenderId/vendor-sources", async (req, res): Promise<void> => {
  const params = AddVendorSourceParams.safeParse(req.params);
  const body = AddVendorSourceBody.safeParse(req.body);
  if (!params.success || !body.success || !body.data.sourceUrl.startsWith("https://")) { res.status(400).json({ error: "Provide a claim and an official HTTPS source URL." }); return; }
  if (!await ownedTender(params.data.tenderId, req.user!.id)) { res.status(404).json({ error: "Tender not found." }); return; }
  const [row] = await db.insert(vendorSourcesTable).values({ ...body.data, tenderId: params.data.tenderId, ownerId: req.user!.id, sourceTitle: body.data.sourceTitle ?? "" }).returning();
  res.status(201).json(AddVendorSourceResponse.parse(row));
});

router.patch("/vendor-sources/:sourceId", async (req, res): Promise<void> => {
  const params = ReviewVendorSourceParams.safeParse(req.params);
  const body = ReviewVendorSourceBody.safeParse(req.body);
  if (!params.success || !body.success) { res.status(400).json({ error: "Invalid source review." }); return; }
  const [current] = await db.select().from(vendorSourcesTable).where(and(eq(vendorSourcesTable.id, params.data.sourceId), eq(vendorSourcesTable.ownerId, req.user!.id)));
  if (!current) { res.status(404).json({ error: "Source not found." }); return; }
  const edited = ["claim", "sourceUrl", "product", "manufacturer"].some(key => key in body.data);
  const status = edited ? "pending" : (body.data.reviewStatus ?? current.reviewStatus);
  const [row] = await db.update(vendorSourcesTable).set({
    ...body.data, reviewStatus: status,
    reviewedAt: status === "pending" ? null : new Date(),
  }).where(eq(vendorSourcesTable.id, current.id)).returning();
  res.json(ReviewVendorSourceResponse.parse(row));
});

router.post("/tenders/:tenderId/vendor-sources/research", async (req, res): Promise<void> => {
  const params = ResearchVendorSourceParams.safeParse(req.params);
  const body = ResearchVendorSourceBody.safeParse(req.body);
  if (!params.success || !body.success) { res.status(400).json({ error: "Provide manufacturer, product and official source URL." }); return; }
  if (!await ownedTender(params.data.tenderId, req.user!.id)) { res.status(404).json({ error: "Tender not found." }); return; }
  if (researchInFlight.has(req.user!.id)) { res.status(429).json({ error: "A source research request is already running." }); return; }
  researchInFlight.add(req.user!.id);
  try { res.json(ResearchVendorSourceResponse.parse(await researchSource(body.data.manufacturer, body.data.product, body.data.sourceUrl))); }
  catch (error) {
    req.log.warn({ errorName: error instanceof Error ? error.name : "Error" }, "Source research failed");
    res.status(400).json({ error: error instanceof Error ? error.message : "Source research failed. Upload the datasheet or add a claim manually." });
  } finally { researchInFlight.delete(req.user!.id); }
});

export default router;

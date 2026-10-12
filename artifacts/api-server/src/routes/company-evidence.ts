import { Router, type IRouter } from "express";
import { and, desc, eq } from "drizzle-orm";
import { db, companyEvidenceTable, evidenceTable, uploadsTable } from "@workspace/db";
import {
  ListCompanyEvidenceResponse, CreateCompanyEvidenceBody, CreateCompanyEvidenceResponse,
  UpdateCompanyEvidenceParams, UpdateCompanyEvidenceBody, UpdateCompanyEvidenceResponse,
  DeleteCompanyEvidenceParams, LinkCompanyEvidenceParams, LinkCompanyEvidenceBody, LinkCompanyEvidenceResponse,
  ReviewEvidenceApplicabilityParams, ReviewEvidenceApplicabilityBody, ReviewEvidenceApplicabilityResponse,
} from "@workspace/api-zod";
import { requireAuth, ownedTender } from "../lib/tender-data";
import { ObjectStorageService } from "../lib/objectStorage";
import { removeUnusedUpload } from "../lib/upload-cleanup";
import { evidenceWarnings, validEvidenceDates, resolveTenderEvidence } from "../lib/company-evidence";

const router: IRouter = Router();
const storage = new ObjectStorageService();
router.use(requireAuth);
router.use((_req, res, next) => { res.setHeader("Cache-Control", "private, no-store"); next(); });
const view = (row: typeof companyEvidenceTable.$inferSelect) => ({ ...row, warnings: evidenceWarnings(row) });

router.get("/company-evidence", async (req, res): Promise<void> => {
  const rows = await db.select().from(companyEvidenceTable).where(eq(companyEvidenceTable.ownerId, req.user!.id)).orderBy(desc(companyEvidenceTable.createdAt));
  res.json(ListCompanyEvidenceResponse.parse(rows.map(view)));
});

router.post("/company-evidence", async (req, res): Promise<void> => {
  const body = CreateCompanyEvidenceBody.safeParse(req.body);
  if (!body.success || !body.data.title.trim() || !validEvidenceDates(body.data)) { res.status(400).json({ error: "Provide valid metadata and dates; expiry must not precede issue." }); return; }
  const [upload] = await db.select().from(uploadsTable).where(and(eq(uploadsTable.objectPath, body.data.objectPath), eq(uploadsTable.ownerId, req.user!.id)));
  if (!upload) { res.status(403).json({ error: "This upload does not belong to your account." }); return; }
  const object = await storage.getObjectEntityFile(upload.objectPath);
  const [metadata] = await object.getMetadata();
  const size = Number(metadata.size);
  if (!size || size > 25 * 1024 * 1024) { res.status(400).json({ error: "Documents must be nonempty and 25 MB or smaller." }); return; }
  const [row] = await db.insert(companyEvidenceTable).values({ ...body.data, title: body.data.title.trim(), ownerId: req.user!.id, name: upload.name, contentType: upload.contentType, size }).returning();
  res.status(201).json(CreateCompanyEvidenceResponse.parse(view(row)));
});

router.patch("/company-evidence/:companyEvidenceId", async (req, res): Promise<void> => {
  const params = UpdateCompanyEvidenceParams.safeParse(req.params);
  const body = UpdateCompanyEvidenceBody.safeParse(req.body);
  if (!params.success || !body.success || !body.data.title.trim() || !validEvidenceDates(body.data)) { res.status(400).json({ error: "Invalid evidence metadata or dates." }); return; }
  const [row] = await db.update(companyEvidenceTable).set(body.data).where(and(eq(companyEvidenceTable.id, params.data.companyEvidenceId), eq(companyEvidenceTable.ownerId, req.user!.id))).returning();
  if (!row) { res.status(404).json({ error: "Company evidence not found." }); return; }
  // Keep a last-known copy for tender records if the library entry is later removed.
  await db.update(evidenceTable).set({ companySnapshot: row, category: row.category, applicability: "pending" }).where(eq(evidenceTable.companyEvidenceId, row.id));
  res.json(UpdateCompanyEvidenceResponse.parse(view(row)));
});

router.delete("/company-evidence/:companyEvidenceId", async (req, res): Promise<void> => {
  const params = DeleteCompanyEvidenceParams.safeParse(req.params);
  if (!params.success) { res.status(400).json({ error: "Invalid evidence identifier." }); return; }
  const [row] = await db.select().from(companyEvidenceTable).where(and(eq(companyEvidenceTable.id, params.data.companyEvidenceId), eq(companyEvidenceTable.ownerId, req.user!.id)));
  if (!row) { res.status(404).json({ error: "Company evidence not found." }); return; }
  await removeUnusedUpload(row.objectPath, req.user!.id, { companyEvidenceId: row.id });
  await db.transaction(async tx => {
    await tx.update(evidenceTable).set({ companySnapshot: row, notes: row.notes }).where(eq(evidenceTable.companyEvidenceId, row.id));
    await tx.delete(companyEvidenceTable).where(eq(companyEvidenceTable.id, row.id));
  });
  res.sendStatus(204);
});

router.post("/tenders/:tenderId/company-evidence", async (req, res): Promise<void> => {
  const params = LinkCompanyEvidenceParams.safeParse(req.params);
  const body = LinkCompanyEvidenceBody.safeParse(req.body);
  if (!params.success || !body.success) { res.status(400).json({ error: "Invalid evidence link." }); return; }
  const tender = await ownedTender(params.data.tenderId, req.user!.id);
  const [company] = await db.select().from(companyEvidenceTable).where(and(eq(companyEvidenceTable.id, body.data.companyEvidenceId), eq(companyEvidenceTable.ownerId, req.user!.id)));
  if (!tender || !company) { res.status(404).json({ error: "Tender or company evidence not found." }); return; }
  const [row] = await db.insert(evidenceTable).values({
    tenderId: tender.id, ownerId: req.user!.id, companyEvidenceId: company.id,
    name: company.name, category: company.category, objectPath: company.objectPath,
    contentType: company.contentType, size: company.size, notes: company.notes, companySnapshot: company,
  }).onConflictDoNothing().returning();
  if (!row) { res.status(409).json({ error: "This file is already attached to the tender." }); return; }
  res.status(201).json(LinkCompanyEvidenceResponse.parse((await resolveTenderEvidence([row], tender))[0]));
});

router.patch("/evidence/:evidenceId/applicability", async (req, res): Promise<void> => {
  const params = ReviewEvidenceApplicabilityParams.safeParse(req.params);
  const body = ReviewEvidenceApplicabilityBody.safeParse(req.body);
  if (!params.success || !body.success) { res.status(400).json({ error: "Invalid applicability review." }); return; }
  const [current] = await db.select().from(evidenceTable).where(and(eq(evidenceTable.id, params.data.evidenceId), eq(evidenceTable.ownerId, req.user!.id)));
  if (!current) { res.status(404).json({ error: "Evidence not found." }); return; }
  const tender = await ownedTender(current.tenderId, req.user!.id);
  const [checked] = await resolveTenderEvidence([{ ...current, applicability: "applicable" }], tender!);
  if (body.data.applicability === "applicable" && checked.warnings.some(w => !w.startsWith("Expiry date not recorded"))) {
    res.status(400).json({ error: "Expired, not-yet-issued or scope-mismatched evidence cannot be marked applicable. Correct the library metadata or use valid evidence." }); return;
  }
  const [row] = await db.update(evidenceTable).set(body.data).where(eq(evidenceTable.id, current.id)).returning();
  res.json(ReviewEvidenceApplicabilityResponse.parse((await resolveTenderEvidence([row], tender!))[0]));
});
export default router;

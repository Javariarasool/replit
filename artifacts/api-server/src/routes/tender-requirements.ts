import { Router, type IRouter } from "express";
import { and, eq } from "drizzle-orm";
import { db, evidenceTable, tendersTable } from "@workspace/db";
import { ExtractTenderRequirementsBody, ExtractTenderRequirementsParams, ExtractTenderRequirementsResponse } from "@workspace/api-zod";
import { requireAuth, ownedTender, tenderView } from "../lib/tender-data";
import { extractTenderRequirements, requirementsInFlight, sameTenderSources } from "../lib/tender-requirements";

const router: IRouter = Router();
router.use(requireAuth);
router.post("/tenders/:tenderId/requirements/extract", async (req, res): Promise<void> => {
  const params = ExtractTenderRequirementsParams.safeParse(req.params);
  const body = ExtractTenderRequirementsBody.safeParse(req.body);
  if (!params.success || !body.success || body.data.aiConsent !== true) {
    res.status(400).json({ error: "Explicit AI-processing consent is required to extract tender requirements." }); return;
  }
  const owner = req.user!.id;
  const tender = await ownedTender(params.data.tenderId, owner);
  if (!tender) { res.status(404).json({ error: "Tender not found." }); return; }
  if (requirementsInFlight.has(owner)) { res.status(429).json({ error: "A requirements extraction is already running. Please wait." }); return; }
  requirementsInFlight.add(owner);
  try {
    const files = await db.select().from(evidenceTable).where(and(eq(evidenceTable.tenderId, tender.id), eq(evidenceTable.category, "tender_rfp")));
    const extraction = await extractTenderRequirements(files);
    const currentFiles = await db.select().from(evidenceTable).where(eq(evidenceTable.tenderId, tender.id));
    if (!sameTenderSources(currentFiles, extraction)) {
      res.status(409).json({ error: "Tender documents changed during extraction. Run extraction again against the current documents." }); return;
    }
    const [updated] = await db.update(tendersTable).set({ requirementsExtraction: extraction, updatedAt: new Date() })
      .where(and(eq(tendersTable.id, tender.id), eq(tendersTable.ownerId, owner))).returning();
    if (!updated) { res.status(404).json({ error: "Tender was removed during extraction." }); return; }
    res.json(ExtractTenderRequirementsResponse.parse(await tenderView(updated)));
  } catch (error) {
    req.log.warn({ errorName: error instanceof Error ? error.name : "Error" }, "Tender requirement extraction failed");
    res.status(400).json({ error: error instanceof Error ? error.message : "Requirements extraction failed. Your uploaded documents and working brief remain unchanged." });
  } finally { requirementsInFlight.delete(owner); }
});
export default router;

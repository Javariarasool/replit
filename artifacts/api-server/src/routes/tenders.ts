import { Router, type IRouter } from "express";
import { and, eq, count, sql } from "drizzle-orm";
import { db, tendersTable, vendorSourcesTable, proposalsTable, evidenceTable } from "@workspace/db";
import {
  GetDashboardSummaryResponse, ListTendersResponse, CreateTenderBody, CreateTenderResponse,
  GetTenderParams, GetTenderResponse, UpdateTenderParams, UpdateTenderBody, UpdateTenderResponse,
  DeleteTenderParams,
} from "@workspace/api-zod";
import { requireAuth, ownedTender, tenderView, listTenderViews } from "../lib/tender-data";
import { removeUnusedUpload } from "../lib/upload-cleanup";
import { requirementsInFlight } from "../lib/tender-requirements";

const router: IRouter = Router();
router.use(requireAuth);

router.get("/dashboard", async (req, res): Promise<void> => {
  const ownerId = req.user!.id;
  const tenders = await listTenderViews(ownerId);
  const [[sources], [proposals]] = await Promise.all([
    db.select({ total: count() }).from(vendorSourcesTable)
      .where(and(eq(vendorSourcesTable.ownerId, ownerId), eq(vendorSourcesTable.reviewStatus, "pending"))),
    db.select({ total: count() }).from(proposalsTable)
      .where(and(eq(proposalsTable.ownerId, ownerId), eq(proposalsTable.status, "approved"))),
  ]);
  res.json(GetDashboardSummaryResponse.parse({
    activeTenders: tenders.filter(t => t.status !== "submitted").length,
    awaitingReview: sources?.total ?? 0,
    completedProposals: proposals?.total ?? 0,
    recentTenders: tenders.slice(0, 4),
  }));
});

router.get("/tenders", async (req, res): Promise<void> => {
  res.json(ListTendersResponse.parse(await listTenderViews(req.user!.id)));
});

router.post("/tenders", async (req, res): Promise<void> => {
  const parsed = CreateTenderBody.safeParse(req.body);
  if (!parsed.success) { res.status(400).json({ error: "Provide a tender title and procuring agency." }); return; }
  const [tender] = await db.insert(tendersTable).values({
    ...parsed.data, ownerId: req.user!.id,
    closingDate: parsed.data.closingDate?.toISOString().slice(0, 10) ?? null,
    category: parsed.data.category ?? "mixed",
    summary: parsed.data.summary ?? "", requirements: parsed.data.requirements ?? "",
  }).returning();
  res.status(201).json(CreateTenderResponse.parse(await tenderView(tender!)));
});

router.get("/tenders/:tenderId", async (req, res): Promise<void> => {
  const parsed = GetTenderParams.safeParse(req.params);
  if (!parsed.success) { res.status(400).json({ error: "Invalid tender identifier." }); return; }
  const tender = await ownedTender(parsed.data.tenderId, req.user!.id);
  if (!tender) { res.status(404).json({ error: "Tender not found." }); return; }
  const sources = await db.select().from(vendorSourcesTable).where(eq(vendorSourcesTable.tenderId, tender.id));
  res.json(GetTenderResponse.parse({
    ...await tenderView(tender),
    sourceCount: sources.length,
    pendingReviewCount: sources.filter(s => s.reviewStatus === "pending").length,
  }));
});

router.patch("/tenders/:tenderId", async (req, res): Promise<void> => {
  const params = UpdateTenderParams.safeParse(req.params);
  const body = UpdateTenderBody.safeParse(req.body);
  if (!params.success || !body.success) { res.status(400).json({ error: "Invalid tender details." }); return; }
  const { closingDate, reviewedExtractionId, ...fields } = body.data;
  const current = await ownedTender(params.data.tenderId, req.user!.id);
  if (!current) { res.status(404).json({ error: "Tender not found." }); return; }
  if (reviewedExtractionId && requirementsInFlight.has(req.user!.id)) {
    res.status(409).json({ error: "Wait for the running extraction, then review the latest result." }); return;
  }
  if (reviewedExtractionId && (current.requirementsExtraction?.id !== reviewedExtractionId || !fields.requirements?.trim())) {
    res.status(409).json({ error: "The extraction changed. Review the latest extracted requirements before applying them." }); return;
  }
  const [tender] = await db.update(tendersTable).set({
    ...fields,
    ...(reviewedExtractionId && current.requirementsExtraction ? {
      requirementsExtraction: { ...current.requirementsExtraction, reviewedAt: new Date().toISOString() },
    } : {}),
    ...(!reviewedExtractionId && fields.requirements !== undefined && !fields.requirements.trim() && current.requirementsExtraction ? {
      requirementsExtraction: { ...current.requirementsExtraction, reviewedAt: null },
    } : {}),
    ...(closingDate !== undefined ? { closingDate: closingDate?.toISOString().slice(0, 10) ?? null } : {}),
    updatedAt: new Date(),
  })
    .where(and(eq(tendersTable.id, params.data.tenderId), eq(tendersTable.ownerId, req.user!.id),
      ...(reviewedExtractionId ? [sql`${tendersTable.requirementsExtraction}->>'id' = ${reviewedExtractionId}`] : []))).returning();
  if (!tender) { res.status(409).json({ error: "The tender changed. Reload and review the latest extraction." }); return; }
  res.json(UpdateTenderResponse.parse(await tenderView(tender)));
});

router.delete("/tenders/:tenderId", async (req, res): Promise<void> => {
  const params = DeleteTenderParams.safeParse(req.params);
  if (!params.success) { res.status(400).json({ error: "Invalid tender identifier." }); return; }
  const tender = await ownedTender(params.data.tenderId, req.user!.id);
  if (!tender) { res.status(404).json({ error: "Tender not found." }); return; }
  const files = await db.select().from(evidenceTable).where(eq(evidenceTable.tenderId, tender.id));
  for (const file of files) await removeUnusedUpload(file.objectPath, req.user!.id, { tenderId: tender.id });
  const [deleted] = await db.delete(tendersTable)
    .where(and(eq(tendersTable.id, params.data.tenderId), eq(tendersTable.ownerId, req.user!.id))).returning();
  if (!deleted) { res.status(404).json({ error: "Tender not found." }); return; }
  res.sendStatus(204);
});

export default router;

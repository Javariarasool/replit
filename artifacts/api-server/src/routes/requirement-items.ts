import { randomUUID } from "node:crypto";
import { Router, type IRouter } from "express";
import { and, eq, inArray, sql } from "drizzle-orm";
import { z } from "zod/v4";
import { db, requirementItemsTable, evidenceTable, type RequirementItem } from "@workspace/db";
import {
  CreateRequirementItemBody, UpdateRequirementItemBody, ImportRequirementItemsBody,
  ResearchRequirementSuppliersBody, AddRequirementSupplierOptionBody, SelectRequirementSupplierBody,
  ListRequirementItemsResponse, CreateRequirementItemResponse, UpdateRequirementItemResponse,
  GetRequirementPriceHistoryResponse,
} from "@workspace/api-zod";
import { ownedTender, requireAuth } from "../lib/tender-data";
import { appendRequirementDrafts, requirementDraftSchema, requirementKey } from "../lib/requirement-items";
import { splitRequirementsBrief, sameTenderSources, requirementsInFlight } from "../lib/tender-requirements";
import { requirementsProcessing } from "../lib/requirements-jobs";
import { EVALUATED_CARD_SCOPE, visibleRequirements } from "../lib/requirement-scope";
import { publicSourceUrl, researchSuppliers, supplierOptionInputSchema } from "../lib/supplier-research";
import { getHistoricalPrices } from "../lib/historical-prices";

const router: IRouter = Router();
router.use(requireAuth);
const researchActive = new Set<string>();

async function ownedItem(id: string, owner: string) {
  if (!z.string().uuid().safeParse(id).success) return undefined;
  const [row] = await db.select().from(requirementItemsTable).where(and(eq(requirementItemsTable.id, id), eq(requirementItemsTable.ownerId, owner)));
  return row;
}
async function evidenceOwned(ids: string[], row: { tenderId: string; ownerId: string }): Promise<boolean> {
  if (!ids.length) return true;
  const unique = [...new Set(ids)];
  const found = await db.select({ id: evidenceTable.id }).from(evidenceTable).where(and(
    eq(evidenceTable.tenderId, row.tenderId), eq(evidenceTable.ownerId, row.ownerId), inArray(evidenceTable.id, unique),
  ));
  return found.length === unique.length;
}
async function currentTender(row: RequirementItem) {
  const tender = await ownedTender(row.tenderId, row.ownerId);
  if (!tender) throw new Error("Tender not found.");
  if (await requirementsProcessing(row.ownerId)) throw new Error("Wait for tender extraction to finish before reviewing or researching clauses.");
  if (tender.requirementsExtraction) {
    const files = await db.select().from(evidenceTable).where(eq(evidenceTable.tenderId, row.tenderId));
    if (!sameTenderSources(files, tender.requirementsExtraction)) throw new Error("Tender documents changed. Extract the current tender before approving or researching requirements.");
  }
  return tender;
}
async function change(row: RequirementItem, fields: Partial<typeof requirementItemsTable.$inferInsert>) {
  const [updated] = await db.update(requirementItemsTable).set({ ...fields, updatedAt: new Date(), revision: row.revision + 1 })
    .where(and(eq(requirementItemsTable.id, row.id), eq(requirementItemsTable.ownerId, row.ownerId), eq(requirementItemsTable.revision, row.revision))).returning();
  if (!updated) throw new Error("This requirement changed while you were working. Reload it before trying again; newer work was preserved.");
  return updated;
}

router.get("/requirement-items/:requirementId/price-history", async (req, res): Promise<void> => {
  const row = await ownedItem(req.params.requirementId as string, req.user!.id);
  if (!row) { res.status(404).json({ error: "Requirement not found." }); return; }
  try {
    res.json(GetRequirementPriceHistoryResponse.parse(await getHistoricalPrices(row)));
  } catch (error) {
    req.log.warn({ errorName: error instanceof Error ? error.name : "Error" }, "Historical price comparison failed");
    res.status(400).json({ error: "Could not load past prices. Your current quotation and supplier selection are unchanged." });
  }
});
router.get("/tenders/:tenderId/requirement-items", async (req, res): Promise<void> => {
  const id = z.string().uuid().safeParse(req.params.tenderId);
  if (!id.success) { res.status(400).json({ error: "Invalid tender identifier." }); return; }
  const tender = await ownedTender(id.data, req.user!.id);
  if (!tender) { res.status(404).json({ error: "Tender not found." }); return; }
  const rows = await db.select().from(requirementItemsTable).where(and(eq(requirementItemsTable.tenderId, id.data), eq(requirementItemsTable.ownerId, req.user!.id))).orderBy(requirementItemsTable.createdAt, requirementItemsTable.id);
  res.json(ListRequirementItemsResponse.parse(visibleRequirements(rows, tender.requirementsExtraction)));
});
router.post("/tenders/:tenderId/requirement-items", async (req, res): Promise<void> => {
  const id = z.string().uuid().safeParse(req.params.tenderId);
  const body = CreateRequirementItemBody.safeParse(req.body);
  const draft = requirementDraftSchema.safeParse(req.body);
  if (!id.success || !body.success || !draft.success) { res.status(400).json({ error: "Provide a complete individual requirement with a positive quantity or leave quantity unknown." }); return; }
  const tender = await ownedTender(id.data, req.user!.id);
  if (!tender) { res.status(404).json({ error: "Tender not found." }); return; }
  const [row] = await db.insert(requirementItemsTable).values({
    ...draft.data, tenderId: id.data, ownerId: req.user!.id, sourceKey: `${requirementKey(draft.data)}:${randomUUID()}`,
    extractionId: tender.requirementsExtraction?.id ?? null,
  }).returning();
  res.status(201).json(CreateRequirementItemResponse.parse(row));
});
router.post("/tenders/:tenderId/requirement-items/import", async (req, res): Promise<void> => {
  const id = z.string().uuid().safeParse(req.params.tenderId);
  if (!id.success || !ImportRequirementItemsBody.safeParse(req.body).success) { res.status(400).json({ error: "Explicit AI-processing consent is required." }); return; }
  const owner = req.user!.id;
  const tender = await ownedTender(id.data, owner);
  if (!tender) { res.status(404).json({ error: "Tender not found." }); return; }
  if (tender.requirementsExtraction && tender.requirementsExtraction.cardScope !== EVALUATED_CARD_SCOPE) {
    res.status(409).json({ error: "Extract the tender again under the assessed-requirements rules before importing from its brief. Previous evidence is preserved." }); return;
  }
  if (await requirementsProcessing(owner)) { res.status(429).json({ error: "Requirements extraction is already running." }); return; }
  requirementsInFlight.add(owner);
  try {
    const drafts = tender.requirements.trim() ? await splitRequirementsBrief(tender.requirements) :
      tender.requirementsExtraction?.cardScope === EVALUATED_CARD_SCOPE && tender.requirementsExtraction.items?.length ? tender.requirementsExtraction.items :
      await splitRequirementsBrief(tender.requirementsExtraction?.requirements || "");
    await db.transaction(tx => appendRequirementDrafts(tx, tender.id, owner, tender.requirementsExtraction?.id ?? null, drafts));
    const rows = await db.select().from(requirementItemsTable).where(eq(requirementItemsTable.tenderId, tender.id)).orderBy(requirementItemsTable.createdAt, requirementItemsTable.id);
    res.json(ListRequirementItemsResponse.parse(rows));
  } catch (e) { res.status(400).json({ error: e instanceof Error ? e.message : "Could not separate requirements; existing work remains unchanged." }); }
  finally { requirementsInFlight.delete(owner); }
});
router.patch("/requirement-items/:requirementId", async (req, res): Promise<void> => {
  const row = await ownedItem(String(req.params.requirementId), req.user!.id);
  if (!row) { res.status(404).json({ error: "Requirement not found." }); return; }
  const body = UpdateRequirementItemBody.safeParse(req.body);
  if (!body.success) { res.status(400).json({ error: "Invalid requirement update." }); return; }
  try {
    const { confirmed, ...fields } = body.data;
    if (fields.evidenceIds && !await evidenceOwned(fields.evidenceIds, row)) throw new Error("Evidence must belong to this tender and your workspace.");
    if (fields.webEvidence?.some(s => !publicSourceUrl(s.url))) throw new Error("Web evidence requires public HTTPS source URLs.");
    const clauseKeys = ["title", "description", "category", "sourceReference", "sourceQuote", "quantity", "unit", "requiresVendor"] as const;
    const changed = clauseKeys.some(k => fields[k] !== undefined && fields[k] !== row[k]);
    const evidenceChanged = (fields.evidenceIds && JSON.stringify(fields.evidenceIds) !== JSON.stringify(row.evidenceIds)) ||
      (fields.webEvidence && JSON.stringify(fields.webEvidence) !== JSON.stringify(row.webEvidence));
    const draft = requirementDraftSchema.safeParse({ ...row, ...fields });
    if (!draft.success) throw new Error("Invalid requirement fields or quantity.");
    let extractionId = row.extractionId;
    if (fields.reviewStatus === "approved") {
      if (confirmed !== true) throw new Error("Confirm you checked this requirement against the current tender.");
      extractionId = (await currentTender(row)).requirementsExtraction?.id ?? null;
    }
    const stale = extractionId !== row.extractionId;
    const reset = changed || evidenceChanged || stale || fields.reviewStatus === "pending";
    const updated = await change(row, {
      ...fields, extractionId,
      ...(changed && fields.reviewStatus !== "approved" ? { reviewStatus: "pending" } : {}),
      ...(reset ? { selectedOptionId: null, options: row.options.map(o => ({ ...o, reviewed: false })) } : {}),
    });
    res.json(UpdateRequirementItemResponse.parse(updated));
  } catch (e) { res.status(409).json({ error: e instanceof Error ? e.message : "Requirement update failed." }); }
});
router.delete("/requirement-items/:requirementId", async (req, res): Promise<void> => {
  const row = await ownedItem(String(req.params.requirementId), req.user!.id);
  if (!row) { res.status(404).json({ error: "Requirement not found." }); return; }
  await db.delete(requirementItemsTable).where(and(eq(requirementItemsTable.id, row.id), eq(requirementItemsTable.ownerId, row.ownerId)));
  res.sendStatus(204);
});
router.post("/requirement-items/:requirementId/research", async (req, res): Promise<void> => {
  const row = await ownedItem(String(req.params.requirementId), req.user!.id);
  if (!row) { res.status(404).json({ error: "Requirement not found." }); return; }
  if (!ResearchRequirementSuppliersBody.safeParse(req.body).success) { res.status(400).json({ error: "Consent to live web research and AI processing first." }); return; }
  if (researchActive.has(row.ownerId)) { res.status(429).json({ error: "Supplier research is already running. Please wait." }); return; }
  researchActive.add(row.ownerId);
  try {
    const tender = await currentTender(row);
    if (!row.requiresVendor || row.reviewStatus !== "approved" || row.extractionId !== (tender.requirementsExtraction?.id ?? null)) throw new Error("Review the current requirement and mark it as needing a supplier before automatic research.");
    const options = await researchSuppliers(row);
    if (row.options.length + options.length > 50) throw new Error("This requirement already has 50 candidate versions. Existing candidates and selections remain saved.");
    const updated = await change(row, { options: [...row.options, ...options], researchStatus: "complete",
      researchError: options.length ? null : "No source-grounded candidate found. Upload a datasheet/quotation or add a supplier manually.",
      lastResearchedAt: new Date() });
    res.json(UpdateRequirementItemResponse.parse(updated));
  } catch (e) {
    const message = e instanceof Error ? e.message : "Supplier research failed; no prices were guessed.";
    await db.update(requirementItemsTable).set({ researchStatus: "failed", researchError: message, updatedAt: new Date(), revision: sql`${requirementItemsTable.revision} + 1` })
      .where(and(eq(requirementItemsTable.id, row.id), eq(requirementItemsTable.revision, row.revision)));
    req.log.warn({ errorName: e instanceof Error ? e.name : "Error" }, "Requirement supplier research failed");
    res.status(400).json({ error: message });
  } finally { researchActive.delete(row.ownerId); }
});
router.post("/requirement-items/:requirementId/options", async (req, res): Promise<void> => {
  const row = await ownedItem(String(req.params.requirementId), req.user!.id);
  if (!row) { res.status(404).json({ error: "Requirement not found." }); return; }
  const body = supplierOptionInputSchema.safeParse(req.body);
  if (!body.success || !AddRequirementSupplierOptionBody.safeParse(req.body).success) { res.status(400).json({ error: "Provide a complete supplier option with valid prices and bounded source claims." }); return; }
  try {
    const option = body.data;
    if (![option.supplierUrl, option.datasheetUrl, option.deliverySourceUrl, option.priceSourceUrl, ...option.sources.map(s => s.url)].every(publicSourceUrl)) throw new Error("Supplier sources require public HTTPS URLs.");
    if (option.pricePkr !== null && (!Number.isFinite(option.pricePkr) || option.pricePkr > 1e12 || (!option.priceSourceUrl && !option.quoteEvidenceId))) throw new Error("A PKR price requires a cited price source or uploaded quotation. Otherwise leave it unknown.");
    if (option.quoteEvidenceId && (!row.evidenceIds.includes(option.quoteEvidenceId) || !await evidenceOwned([option.quoteEvidenceId], row))) throw new Error("Link the uploaded quotation to this requirement before adding its price.");
    if (row.options.length >= 50) throw new Error("This requirement already has 50 candidate versions.");
    const updated = await change(row, { options: [...row.options, { ...option, priceType: option.pricePkr === null ? "not_published" : option.priceType,
      id: randomUUID(), origin: "manual", checkedAt: new Date().toISOString(), reviewed: false }] });
    res.status(201).json(UpdateRequirementItemResponse.parse(updated));
  } catch (e) { res.status(400).json({ error: e instanceof Error ? e.message : "Could not add supplier option." }); }
});
router.post("/requirement-items/:requirementId/selection", async (req, res): Promise<void> => {
  const row = await ownedItem(String(req.params.requirementId), req.user!.id);
  if (!row) { res.status(404).json({ error: "Requirement not found." }); return; }
  const body = SelectRequirementSupplierBody.safeParse(req.body);
  if (!body.success) { res.status(400).json({ error: "Confirm source, product, delivery and price review before choosing a supplier." }); return; }
  try {
    const tender = await currentTender(row);
    if (body.data.optionId !== null && (row.reviewStatus !== "approved" || row.extractionId !== (tender.requirementsExtraction?.id ?? null))) throw new Error("Review this requirement against the current tender first.");
    const option = row.options.find(o => o.id === body.data.optionId);
    const evidenceUrl = option?.datasheetUrl || (row.category === "services" ? option?.supplierUrl : null);
    if (body.data.optionId !== null && !option) throw new Error("Supplier option not found for this requirement.");
    if (option?.quoteEvidenceId && (!row.evidenceIds.includes(option.quoteEvidenceId) || !await evidenceOwned([option.quoteEvidenceId], row))) throw new Error("The selected quotation is no longer linked or available.");
    const updated = await change(row, { selectedOptionId: body.data.optionId,
      webEvidence: option && evidenceUrl && row.webEvidence.length < 100 && !row.webEvidence.some(w => w.url === evidenceUrl && w.verified)
        ? [...row.webEvidence, { id: randomUUID(), url: evidenceUrl, title: `${option.manufacturer} ${option.model || option.product} ${option.datasheetUrl ? "OEM" : "supplier service"} source`,
          claim: option.specifications.join("\n") || option.sources.find(s => s.url === evidenceUrl)?.quote || option.matchSummary, verified: true }]
        : row.webEvidence,
      options: row.options.map(o => o.id === body.data.optionId ? { ...o, reviewed: true } : o) });
    res.json(UpdateRequirementItemResponse.parse(updated));
  } catch (e) { res.status(409).json({ error: e instanceof Error ? e.message : "Selection failed." }); }
});
export default router;

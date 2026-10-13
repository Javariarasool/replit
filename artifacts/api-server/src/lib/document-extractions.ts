import { randomUUID } from "node:crypto";
import { and, eq, isNull, sql } from "drizzle-orm";
import { db, uploadsTable, type DocumentExtraction } from "@workspace/db";
import { ObjectStorageService } from "./objectStorage";
import { extractWithOcr, type OcrLanguage } from "./ocr";
import { MAX_DOCUMENT_BYTES } from "./documents";
import { logger } from "./logger";

const storage = new ObjectStorageService();
export const MAX_EXTRACTION_WORKERS = 2;
const LEASE_MS = 60000;
let localWorkers = 0;
let pumping = false;
let timer: ReturnType<typeof setInterval> | undefined;

export function extractionPending(extraction: DocumentExtraction): boolean {
  return extraction.status === "queued" || extraction.status === "running";
}

export function shouldRetryExtraction(extraction: DocumentExtraction, requested = false): boolean {
  return extraction.status === "failed" && (requested ||
    /spawn (?:pdfimages|pdftoppm|tesseract) ENOENT|required PDF\/OCR tool .* unavailable/i.test(extraction.error ?? ""));
}

export function queuedExtraction(language: OcrLanguage): DocumentExtraction {
  return {
    sourceText: "", ocrText: "", confidence: null, pages: [], status: "queued",
    error: null, reviewedText: null, reviewedAt: null, engine: "Local Tesseract", language,
    job: { id: randomUUID(), status: "queued", completedPages: 0, totalPages: null,
      stage: "Waiting for a worker", queuedAt: new Date().toISOString(), finishedAt: null,
      token: null, leaseUntil: null },
  };
}

// Enqueue with a compare-and-swap, never with a request-lifetime OCR promise.
export async function ensureExtraction(objectPath: string, ownerId: string, retry = false, requestedLanguage?: OcrLanguage): Promise<DocumentExtraction> {
  for (;;) {
    const [upload] = await db.select().from(uploadsTable).where(and(eq(uploadsTable.objectPath, objectPath), eq(uploadsTable.ownerId, ownerId)));
    if (!upload) throw new Error("Document not found.");
    const current = upload.extraction;
    const language = requestedLanguage ?? current?.language ?? "eng";
    if (current && extractionPending(current)) {
      if (language !== (current.language ?? "eng")) throw new Error("This document is already being read in another language. Wait for it to finish before changing languages.");
      return current;
    }
    if (current && language === (current.language ?? "eng") && !shouldRetryExtraction(current, retry)) return current;
    const extraction = queuedExtraction(language);
    const rows = await db.update(uploadsTable).set({ extraction }).where(and(
      eq(uploadsTable.objectPath, objectPath), eq(uploadsTable.ownerId, ownerId),
      current ? eq(uploadsTable.extraction, current) : isNull(uploadsTable.extraction),
    )).returning();
    if (rows.length) { if (timer) void pump(); return extraction; }
  }
}

export async function claimExtractionJob() {
  return db.transaction(async tx => {
    // Serialize claims globally so multiple server processes still share a
    // two-worker budget. Row locks alone would not enforce that budget.
    await tx.execute(sql`select pg_advisory_xact_lock(7419204)`);
    const live = await tx.select({ path: uploadsTable.objectPath }).from(uploadsTable).where(sql`
      extraction->>'status' = 'running' and (extraction->'job'->>'leaseUntil')::timestamptz > now()`);
    if (live.length >= MAX_EXTRACTION_WORKERS) return null;
    const [upload] = await tx.select().from(uploadsTable).where(sql`
      extraction->>'status' = 'queued' or
      (extraction->>'status' = 'running' and (extraction->'job'->>'leaseUntil')::timestamptz <= now())`)
      .orderBy(sql`extraction->'job'->>'queuedAt'`).limit(1).for("update", { skipLocked: true });
    if (!upload?.extraction?.job) return null;
    const extraction: DocumentExtraction = { ...upload.extraction, status: "running",
      job: { ...upload.extraction.job, status: "running", token: randomUUID(),
        leaseUntil: new Date(Date.now() + LEASE_MS).toISOString(), completedPages: 0, totalPages: null, stage: "Reading original document" } };
    await tx.update(uploadsTable).set({ extraction }).where(eq(uploadsTable.objectPath, upload.objectPath));
    return { ...upload, extraction };
  });
}

export async function runExtractionJob(upload: NonNullable<Awaited<ReturnType<typeof claimExtractionJob>>>) {
  const job = upload.extraction.job!;
  const fence = and(eq(uploadsTable.objectPath, upload.objectPath), eq(uploadsTable.ownerId, upload.ownerId),
    sql`extraction->>'status' = 'running' and extraction->'job'->>'token' = ${job.token}`);
  let leaseLost = false;
  const heartbeat = setInterval(() => {
    void db.update(uploadsTable).set({ extraction: sql`jsonb_set(extraction, '{job,leaseUntil}', to_jsonb(${new Date(Date.now() + LEASE_MS).toISOString()}::text))` })
      .where(fence).returning({ path: uploadsTable.objectPath }).then(rows => { if (!rows.length) leaseLost = true; })
      .catch(() => { leaseLost = true; });
  }, 10000);
  try {
    const object = await storage.getObjectEntityFile(upload.objectPath);
    const [metadata] = await object.getMetadata();
    if (Number(metadata.size) > MAX_DOCUMENT_BYTES) throw new Error("Documents must be 25 MB or smaller.");
    const [buffer] = await object.download();
    const extraction = await extractWithOcr(buffer, upload.contentType, upload.name, upload.extraction.language, async (completed, total, stage) => {
      if (leaseLost) throw new Error("Worker lease expired; reading will resume in the background.");
      job.completedPages = completed; job.totalPages = total; job.stage = stage;
      const rows = await db.update(uploadsTable).set({ extraction: sql`
        jsonb_set(jsonb_set(jsonb_set(extraction, '{job,completedPages}', to_jsonb(${completed}::int)),
          '{job,totalPages}', to_jsonb(${total}::int)), '{job,stage}', to_jsonb(${stage}::text))` })
        .where(fence).returning({ path: uploadsTable.objectPath });
      if (!rows.length) { leaseLost = true; throw new Error("Worker lease lost."); }
    });
    if (leaseLost) return;
    extraction.job = { ...job, status: extraction.status === "failed" ? "failed" : "completed",
      stage: extraction.status === "failed" ? "Reading failed" : "Reading completed",
      finishedAt: new Date().toISOString(), leaseUntil: null, token: null };
    await db.update(uploadsTable).set({ extraction }).where(fence);
  } catch (error) {
    if (leaseLost) return;
    const extraction: DocumentExtraction = { ...upload.extraction, status: "failed",
      error: error instanceof Error ? error.message : "Local extraction failed.",
      job: { ...job, status: "failed", stage: "Reading failed", finishedAt: new Date().toISOString(), leaseUntil: null, token: null } };
    await db.update(uploadsTable).set({ extraction }).where(fence);
  } finally { clearInterval(heartbeat); }
}

async function pump() {
  if (pumping) return;
  pumping = true;
  try {
    while (localWorkers < MAX_EXTRACTION_WORKERS) {
      const upload = await claimExtractionJob();
      if (!upload) break;
      localWorkers++;
      void runExtractionJob(upload).catch(error => logger.error({ errorName: error instanceof Error ? error.name : "Error" }, "Extraction worker failed; lease recovery will retry"))
        .finally(() => { localWorkers--; void pump(); });
    }
  } catch (error) {
    logger.error({ errorName: error instanceof Error ? error.name : "Error" }, "Unable to claim extraction jobs");
  } finally { pumping = false; }
}

export function startExtractionWorkers() {
  if (timer) return;
  timer = setInterval(() => void pump(), 2000);
  timer.unref();
  void pump();
}

export class OcrReviewRequiredError extends Error {
  override name = "OcrReviewRequiredError";
}

export function draftingText(extraction: DocumentExtraction, name: string): string {
  if (extractionPending(extraction)) throw new OcrReviewRequiredError(`"${name}" is still being read in the background. Wait for completion and verify any OCR before drafting.`);
  if (extraction.status === "needs_review" || extraction.status === "rejected") throw new OcrReviewRequiredError(`Verify the OCR for "${name}" against its original before extracting requirements or drafting a proposal.`);
  if (extraction.status === "failed") throw new Error(`Extraction failed for "${name}": ${extraction.error}`);
  return [extraction.sourceText, extraction.status === "verified" ? `HUMAN-VERIFIED OCR:\n${extraction.reviewedText}` : ""].filter(Boolean).join("\n\n");
}

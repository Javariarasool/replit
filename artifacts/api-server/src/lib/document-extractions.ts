import { and, eq } from "drizzle-orm";
import { db, uploadsTable, type DocumentExtraction } from "@workspace/db";
import { ObjectStorageService } from "./objectStorage";
import { extractWithOcr } from "./ocr";
import { MAX_DOCUMENT_BYTES } from "./documents";

const storage = new ObjectStorageService();
const active = new Map<string, Promise<DocumentExtraction>>();

export function shouldRetryExtraction(extraction: DocumentExtraction, requested = false): boolean {
  return extraction.status === "failed" && (requested ||
    /spawn (?:pdfimages|pdftoppm|tesseract) ENOENT|required PDF\/OCR tool .* unavailable/i.test(extraction.error ?? ""));
}

export async function ensureExtraction(objectPath: string, ownerId: string, retry = false): Promise<DocumentExtraction> {
  const [upload] = await db.select().from(uploadsTable).where(and(eq(uploadsTable.objectPath, objectPath), eq(uploadsTable.ownerId, ownerId)));
  if (!upload) throw new Error("Document not found.");
  if (upload.extraction && !shouldRetryExtraction(upload.extraction, retry)) return upload.extraction;
  const key = `${ownerId}:${objectPath}`;
  const existing = active.get(key);
  if (existing) return existing;
  if (active.size >= 2) throw new Error("OCR is busy. Please try again shortly.");
  const work = (async () => {
    const object = await storage.getObjectEntityFile(objectPath);
    const [metadata] = await object.getMetadata();
    if (Number(metadata.size) > MAX_DOCUMENT_BYTES) throw new Error("Documents must be 25 MB or smaller.");
    const [buffer] = await object.download();
    const extraction = await extractWithOcr(buffer, upload.contentType, upload.name);
    await db.update(uploadsTable).set({ extraction }).where(and(eq(uploadsTable.objectPath, objectPath), eq(uploadsTable.ownerId, ownerId)));
    return extraction;
  })();
  active.set(key, work);
  try { return await work; } finally { active.delete(key); }
}

export class OcrReviewRequiredError extends Error {
  override name = "OcrReviewRequiredError";
}

export function draftingText(extraction: DocumentExtraction, name: string): string {
  if (extraction.status === "needs_review" || extraction.status === "rejected") throw new OcrReviewRequiredError(`Verify the OCR for "${name}" against its original before extracting requirements or drafting a proposal.`);
  if (extraction.status === "failed") throw new Error(`Extraction failed for "${name}": ${extraction.error}`);
  return [extraction.sourceText, extraction.status === "verified" ? `HUMAN-VERIFIED OCR:\n${extraction.reviewedText}` : ""].filter(Boolean).join("\n\n");
}

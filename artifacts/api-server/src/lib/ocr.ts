import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { mkdtemp, writeFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { PDFParse } from "pdf-parse";
import type { DocumentExtraction } from "@workspace/db";
import { extractDocumentText, MAX_DOCUMENT_BYTES } from "./documents";

const exec = promisify(execFile);
const MAX_PAGES = 30;
const MAX_TEXT = 500000;
const MAX_SOURCE_TEXT = 1000000;

// Engine scores measure recognition quality, not factual correctness.
export function parseTsv(tsv: string): { text: string; confidence: number | null } {
  const lines = new Map<string, string[]>();
  let weighted = 0, weight = 0;
  for (const row of tsv.split("\n").slice(1)) {
    const columns = row.split("\t");
    if (columns[0] !== "5") continue;
    const word = columns.slice(11).join("\t").trim();
    const score = Number(columns[10]);
    if (!word) continue;
    const key = columns.slice(1, 5).join(":");
    const words = lines.get(key) ?? [];
    words.push(word); lines.set(key, words);
    if (Number.isFinite(score) && score >= 0) { weighted += score * word.length; weight += word.length; }
  }
  return { text: [...lines.values()].map(words => words.join(" ")).join("\n"), confidence: weight ? Math.round(weighted / weight) : null };
}

export async function extractWithOcr(buffer: Buffer, contentType: string, name: string): Promise<DocumentExtraction> {
  if (buffer.length > MAX_DOCUMENT_BYTES) throw new Error("Documents must be 25 MB or smaller.");
  const result: DocumentExtraction = { sourceText: "", ocrText: "", confidence: null, pages: [], status: "not_needed", error: null, reviewedText: null, reviewedAt: null, engine: "Local Tesseract (English)" };
  const pdf = buffer.subarray(0, 4).toString() === "%PDF" || contentType === "application/pdf";
  const image = /image\/(png|jpeg|tiff|bmp|webp)/i.test(contentType) || /\.(png|jpe?g|tiff?|bmp|webp)$/i.test(name);
  let directory: string | undefined;
  try {
    if (pdf || image) directory = await mkdtemp(join(tmpdir(), "tender-ocr-"));
    const input = directory ? join(directory, pdf ? "input.pdf" : "input-image") : "";
    if (directory) await writeFile(input, buffer);
    let pageNumbers: number[] = [];
    if (pdf) {
      const parser = new PDFParse({ data: new Uint8Array(buffer) });
      try {
        const text = await parser.getText();
        result.sourceText = text.text;
        pageNumbers = text.pages.filter(page => page.text.trim().length < 40).map(page => page.num);
        // A scan may contain embedded headers/footer text. Inspect raster dimensions
        // too, rather than treating a small text layer as the complete page.
        const { stdout } = await exec("pdfimages", ["-list", input], { timeout: 30000, maxBuffer: 1024 * 1024 });
        for (const row of stdout.split("\n").slice(2)) {
          const columns = row.trim().split(/\s+/);
          if (columns[2] === "image" && Number(columns[3]) >= 600 && Number(columns[4]) >= 600) pageNumbers.push(Number(columns[0]));
        }
        pageNumbers = [...new Set(pageNumbers)].sort((a, b) => a - b);
        if (pageNumbers.length && text.total > MAX_PAGES) throw new Error(`OCR is limited to ${MAX_PAGES} PDF pages. Split this document; no OCR text can be used yet.`);
      } finally { await parser.destroy(); }
    } else if (!image) {
      result.sourceText = await extractDocumentText(buffer, contentType, name);
    } else pageNumbers = [1];
    if (result.sourceText.length > MAX_SOURCE_TEXT) throw new Error("Extracted source text exceeds the 1,000,000 character limit. Split the document.");
    if (!pageNumbers.length) return result;
    for (const page of pageNumbers) {
      let imagePath = input;
      if (pdf) {
        const prefix = join(directory!, `page-${page}`);
        await exec("pdftoppm", ["-f", String(page), "-l", String(page), "-singlefile", "-scale-to", "2400", "-png", input, prefix], { timeout: 30000, maxBuffer: 1024 * 1024 });
        imagePath = `${prefix}.png`;
      }
      const { stdout } = await exec("tesseract", [imagePath, "stdout", "-l", "eng", "tsv"], { timeout: 30000, maxBuffer: 8 * 1024 * 1024 });
      const recognized = parseTsv(stdout);
      result.pages.push({ page, ...recognized });
    }
    result.ocrText = result.pages.map(page => `[OCR page ${page.page}]\n${page.text}`).join("\n\n");
    const scores = result.pages.filter(page => page.confidence !== null);
    result.confidence = scores.length ? Math.round(scores.reduce((sum, page) => sum + page.confidence!, 0) / scores.length) : null;
    if (result.ocrText.length > MAX_TEXT) throw new Error("OCR text exceeds the archive limit. Split the document.");
    if (!result.pages.some(page => page.text.trim())) throw new Error("OCR found no readable text. Supply a clearer scan or human evidence notes.");
    result.status = "needs_review";
    if (result.pages.some(page => !page.text.trim())) result.error = "Some pages have no recognized text. Check every page of the original before verifying.";
  } catch (error) {
    result.status = "failed";
    result.error = error instanceof Error ? error.message : "Local OCR failed.";
    if (result.sourceText.length > MAX_SOURCE_TEXT) result.sourceText = "";
    if (result.ocrText.length > MAX_TEXT) { result.ocrText = ""; result.pages = []; }
  } finally {
    if (directory) await rm(directory, { recursive: true, force: true });
  }
  return result;
}

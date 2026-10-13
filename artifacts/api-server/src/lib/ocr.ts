import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { mkdtemp, writeFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { PDFParse } from "pdf-parse";
import type { DocumentExtraction } from "@workspace/db";
import { extractDocumentText, MAX_DOCUMENT_BYTES } from "./documents";
import { ocrTool } from "./native-ocr-tools";

const exec = promisify(execFile);
const MAX_PAGES = 30;
const MAX_TEXT = 500000;
const MAX_SOURCE_TEXT = 1000000;
export type OcrLanguage = NonNullable<DocumentExtraction["language"]>;
export const OCR_LANGUAGES: Record<OcrLanguage, string> = {
  eng: "English",
  urd: "Urdu",
  "eng+urd": "English + Urdu",
};

export function substantialRaster(width: number, height: number, xPpi: number, yPpi: number, pageWidth: number, pageHeight: number): boolean {
  if (width < 600 || height < 600) return false;
  if (![xPpi, yPpi, pageWidth, pageHeight].every(v => Number.isFinite(v) && v > 0)) return true;
  // Pixel dimensions alone misclassify high-resolution logos repeated across
  // long digitized tenders. Measure their physical coverage on the page.
  return (width * 72 / xPpi) * (height * 72 / yPpi) / (pageWidth * pageHeight) >= 0.25;
}

export function repeatedGraphics(images: string[][], readablePages: Set<number>): Set<string> {
  const occurrences = new Map<string, Set<number>>();
  for (const columns of images) {
    const page = Number(columns[0]);
    if (columns[2] !== "image" || !readablePages.has(page) || !columns[10] || !columns[11]) continue;
    const key = `${columns[10]}:${columns[11]}`;
    const pages = occurrences.get(key) ?? new Set<number>();
    pages.add(page);
    occurrences.set(key, pages);
  }
  // A shared PDF image object repeated on several genuinely readable pages
  // is a logo/watermark, not a distinct page scan. Sparse pages still use OCR.
  return new Set([...occurrences].filter(([, pages]) => pages.size >= 3).map(([key]) => key));
}

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

export async function extractWithOcr(buffer: Buffer, contentType: string, name: string, language: OcrLanguage = "eng"): Promise<DocumentExtraction> {
  if (buffer.length > MAX_DOCUMENT_BYTES) throw new Error("Documents must be 25 MB or smaller.");
  if (!Object.hasOwn(OCR_LANGUAGES, language)) throw new Error("Select English, Urdu, or English + Urdu for local OCR.");
  const result: DocumentExtraction = { sourceText: "", ocrText: "", confidence: null, pages: [], status: "not_needed", error: null, reviewedText: null, reviewedAt: null, language, engine: `Local Tesseract (${OCR_LANGUAGES[language]})` };
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
        const info = await parser.getInfo({ parsePageInfo: true });
        result.sourceText = text.text;
        pageNumbers = text.pages.filter(page => page.text.trim().length < 40).map(page => page.num);
        // A scan may contain embedded headers/footer text. Inspect raster dimensions
        // too, rather than treating a small text layer as the complete page.
        const { stdout } = await exec(ocrTool("pdfimages"), ["-list", input], { timeout: 30000, maxBuffer: 1024 * 1024 });
        const images = stdout.split("\n").slice(2).map(row => row.trim().split(/\s+/));
        const graphics = repeatedGraphics(images, new Set(text.pages.filter(p => p.text.trim().length >= 400).map(p => p.num)));
        for (const columns of images) {
          if (graphics.has(`${columns[10]}:${columns[11]}`)) continue;
          const page = info.pages.find(p => p.pageNumber === Number(columns[0]));
          if (columns[2] === "image" && substantialRaster(Number(columns[3]), Number(columns[4]), Number(columns[12]), Number(columns[13]), page?.width ?? 0, page?.height ?? 0)) pageNumbers.push(Number(columns[0]));
        }
        pageNumbers = [...new Set(pageNumbers)].sort((a, b) => a - b);
        if (pageNumbers.length > MAX_PAGES) throw new Error(`OCR is limited to ${MAX_PAGES} scanned pages per document. Split this document; no OCR text can be used yet.`);
      } finally { await parser.destroy(); }
    } else if (!image) {
      result.sourceText = await extractDocumentText(buffer, contentType, name);
    } else pageNumbers = [1];
    if (result.sourceText.length > MAX_SOURCE_TEXT) throw new Error("Extracted source text exceeds the 1,000,000 character limit. Split the document.");
    if (!pageNumbers.length) return result;
    // Tesseract can succeed using only one installed language from a combination.
    // Fail explicitly instead of silently reading mixed scans as English only.
    const { stdout: installed } = await exec(ocrTool("tesseract"), ["--list-langs"], { timeout: 10000 });
    const available = new Set(installed.split(/\r?\n/).map(line => line.trim()));
    const missing = language.split("+").filter(code => !available.has(code));
    if (missing.length) throw new Error(`Local OCR language data is missing (${missing.join(", ")}). Install the selected Tesseract language data and retry; no remote OCR was used.`);
    for (const page of pageNumbers) {
      let imagePath = input;
      if (pdf) {
        const prefix = join(directory!, `page-${page}`);
        await exec(ocrTool("pdftoppm"), ["-f", String(page), "-l", String(page), "-singlefile", "-scale-to", "2400", "-png", input, prefix], { timeout: 30000, maxBuffer: 1024 * 1024 });
        imagePath = `${prefix}.png`;
      }
      // Bound native parallelism: the service already permits concurrent OCR
      // jobs, and OpenMP contention can make a small scan exceed its deadline.
      const options = {
        timeout: 60000, maxBuffer: 8 * 1024 * 1024,
        env: { ...process.env, OMP_THREAD_LIMIT: "1" },
      };
      const { stdout } = await exec(ocrTool("tesseract"), [imagePath, "stdout", "-l", language, "tsv"], options);
      let recognized = parseTsv(stdout);
      // Automatic layout analysis can discard short Urdu lines among English
      // paragraphs. If it found no Urdu at all, retry as one text block.
      // Keep automatic layout for multi-column pages that already contain Urdu.
      if (language !== "eng" && !/[\u0600-\u06ff]/u.test(recognized.text)) {
        const retry = await exec(ocrTool("tesseract"), [imagePath, "stdout", "-l", language, "--psm", "6", "tsv"], options);
        const candidate = parseTsv(retry.stdout);
        if (/[\u0600-\u06ff]/u.test(candidate.text)) recognized = candidate;
      }
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
    result.error = error instanceof Error && "killed" in error && error.killed === true
      ? "Local OCR exceeded its processing time limit. Retry reading this document; your original remains saved and no unverified OCR text was used."
      : error instanceof Error ? error.message : "Local OCR failed.";
    if (result.sourceText.length > MAX_SOURCE_TEXT) result.sourceText = "";
    if (result.ocrText.length > MAX_TEXT) { result.ocrText = ""; result.pages = []; }
  } finally {
    if (directory) await rm(directory, { recursive: true, force: true });
  }
  return result;
}

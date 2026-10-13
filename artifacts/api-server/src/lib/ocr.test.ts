import { test, after } from "node:test";
import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { mkdtemp, mkdir, writeFile, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { deflateSync } from "node:zlib";
import { extractWithOcr, parseTsv, substantialRaster, repeatedGraphics } from "./ocr";
import { draftingText, shouldRetryExtraction } from "./document-extractions";

const exec = promisify(execFile);
const directory = process.env.OCR_FIXTURE_DIR ?? await mkdtemp(join(tmpdir(), "ocr-tests-"));
await mkdir(directory, { recursive: true });
after(async () => { if (!process.env.OCR_FIXTURE_DIR) await rm(directory, { recursive: true, force: true }); });

function pdf(objects: Buffer[]): Buffer {
  const parts: Buffer[] = [Buffer.from("%PDF-1.4\n")];
  const offsets = [0];
  objects.forEach((object, index) => {
    offsets.push(Buffer.concat(parts).length);
    parts.push(Buffer.from(`${index + 1} 0 obj\n`), object, Buffer.from("\nendobj\n"));
  });
  const start = Buffer.concat(parts).length;
  parts.push(Buffer.from(`xref\n0 ${objects.length + 1}\n0000000000 65535 f \n${offsets.slice(1).map(offset => `${String(offset).padStart(10, "0")} 00000 n \n`).join("")}trailer\n<< /Size ${objects.length + 1} /Root 1 0 R >>\nstartxref\n${start}\n%%EOF`));
  return Buffer.concat(parts);
}
const text = "Tender network switches quantity 24 units";
const commands = `BT /F1 20 Tf 35 250 Td (${text}) Tj ET`;
const sourcePdf = pdf([
  Buffer.from("<< /Type /Catalog /Pages 2 0 R >>"),
  Buffer.from("<< /Type /Pages /Kids [3 0 R] /Count 1 >>"),
  Buffer.from("<< /Type /Page /Parent 2 0 R /MediaBox [0 0 600 300] /Resources << /Font << /F1 4 0 R >> >> /Contents 5 0 R >>"),
  Buffer.from("<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>"),
  Buffer.from(`<< /Length ${commands.length} >>\nstream\n${commands}\nendstream`),
]);
await writeFile(join(directory, "source.pdf"), sourcePdf);
await exec("pdftoppm", ["-singlefile", "-scale-to", "1800", join(directory, "source.pdf"), join(directory, "scan")]);
await exec("pdftoppm", ["-singlefile", "-scale-to", "1800", "-png", join(directory, "source.pdf"), join(directory, "scan")]);
const ppm = await readFile(join(directory, "scan.ppm"));
const header = ppm.toString("ascii", 0, 100).match(/^P6\s+(\d+)\s+(\d+)\s+255\s/)!;
assert.ok(header);
const pixels = deflateSync(ppm.subarray(header[0].length));
const draw = "q 600 0 0 300 0 0 cm /Im1 Do Q";
const scannedPdf = pdf([
  Buffer.from("<< /Type /Catalog /Pages 2 0 R >>"),
  Buffer.from("<< /Type /Pages /Kids [3 0 R] /Count 1 >>"),
  Buffer.from("<< /Type /Page /Parent 2 0 R /MediaBox [0 0 600 300] /Resources << /XObject << /Im1 4 0 R >> >> /Contents 5 0 R >>"),
  Buffer.concat([Buffer.from(`<< /Type /XObject /Subtype /Image /Width ${header[1]} /Height ${header[2]} /ColorSpace /DeviceRGB /BitsPerComponent 8 /Filter /FlateDecode /Length ${pixels.length} >>\nstream\n`), pixels, Buffer.from("\nendstream")]),
  Buffer.from(`<< /Length ${draw.length} >>\nstream\n${draw}\nendstream`),
]);
await writeFile(join(directory, "scanned.pdf"), scannedPdf);

test("TSV confidence excludes non-word rows and preserves line grouping", () => {
  const parsed = parseTsv("header\n5\t1\t1\t1\t1\t1\t0\t0\t10\t10\t90\tHello\n5\t1\t1\t1\t1\t2\t15\t0\t10\t10\t80\tworld\n");
  assert.equal(parsed.text, "Hello world");
  assert.equal(parsed.confidence, 85);
});
test("missing deployment tools do not permanently cache a failed import", () => {
  const failed = { sourceText: "", ocrText: "", confidence: null, pages: [], status: "failed" as const, error: "spawn pdfimages ENOENT", reviewedText: null, reviewedAt: null, engine: "Local Tesseract (English)" };
  assert.equal(shouldRetryExtraction(failed), true);
  assert.equal(shouldRetryExtraction({ ...failed, error: "Invalid PDF" }), false);
  assert.equal(shouldRetryExtraction({ ...failed, error: "Invalid PDF" }, true), true);
  assert.equal(shouldRetryExtraction({ ...failed, status: "verified" }, true), false);
  assert.equal(shouldRetryExtraction({ ...failed, status: "needs_review" }, true), false);
});
test("high-resolution logos do not count as whole-page scans", () => {
  assert.equal(substantialRaster(800, 800, 300, 300, 600, 800), false);
  assert.equal(substantialRaster(1800, 2400, 216, 216, 600, 800), true);
  assert.equal(substantialRaster(1800, 900, 216, 216, 600, 300), true);
  assert.equal(substantialRaster(800, 800, 0, 0, 600, 800), true);
});
test("shared watermarks are excluded only with readable pages, not scans", () => {
  const image = (page: number, ref: number) => [String(page), "0", "image", "800", "800", "rgb", "3", "8", "image", "no", String(ref), "0"];
  const rows = [image(1, 100), image(2, 100), image(3, 100), image(4, 200)];
  assert.deepEqual([...repeatedGraphics(rows, new Set([1, 2, 3]))], ["100:0"]);
  assert.equal(repeatedGraphics(rows, new Set()).size, 0);
  assert.equal(repeatedGraphics(rows, new Set([1, 2])).size, 0);
});
test("text PDF and plain text remain native source, not OCR", async () => {
  const native = await extractWithOcr(sourcePdf, "application/pdf", "source.pdf");
  assert.equal(native.status, "not_needed");
  assert.match(native.sourceText, /quantity 24/);
  assert.equal(native.ocrText, "");
  const plain = await extractWithOcr(Buffer.from(text), "text/plain", "source.txt");
  assert.equal(plain.sourceText, text);
});
test("scanned PDF has separate OCR and cannot draft until verified", async () => {
  const scan = await extractWithOcr(scannedPdf, "application/pdf", "scanned.pdf");
  assert.equal(scan.status, "needs_review", scan.error ?? undefined);
  assert.match(scan.ocrText, /quantity 24 units/i);
  assert.ok(scan.confidence !== null && scan.confidence >= 0 && scan.confidence <= 100);
  assert.equal(scan.pages[0].page, 1);
  assert.throws(() => draftingText(scan, "scanned.pdf"), /Verify/);
  const verified = { ...scan, status: "verified" as const, reviewedText: "Reviewed quantity 25 units" };
  assert.match(draftingText(verified, "scanned.pdf"), /Reviewed quantity 25/);
  assert.doesNotMatch(draftingText(verified, "scanned.pdf"), /quantity 24 units/i);
  assert.throws(() => draftingText({ ...scan, status: "rejected" }, "scanned.pdf"), /Verify/);
  assert.match(scan.ocrText, /quantity 24/); // review never mutates raw OCR
});
test("document image OCR is local and review gated", async () => {
  const image = await extractWithOcr(await readFile(join(directory, "scan.png")), "image/png", "scan.png");
  assert.equal(image.status, "needs_review", image.error ?? undefined);
  assert.equal(image.sourceText, "");
  assert.match(image.ocrText, /network switches/i);
  assert.throws(() => draftingText(image, "scan.png"), /Verify/);
});
test("unsupported or damaged documents fail explicitly", async () => {
  const result = await extractWithOcr(Buffer.from("not a valid document"), "application/octet-stream", "unknown.bin");
  assert.equal(result.status, "failed");
  assert.ok(result.error);
  assert.throws(() => draftingText(result, "unknown.bin"), /Extraction failed/);
});

test("recognition language is validated and defaults to English", async () => {
  const native = await extractWithOcr(Buffer.from(text), "text/plain", "source.txt");
  assert.equal(native.language, "eng");
  assert.match(native.engine, /English/);
  await assert.rejects(() => extractWithOcr(Buffer.from(text), "text/plain", "source.txt", "fra" as "eng"), /Select English, Urdu/);
});

for (const language of ["urd", "eng+urd"] as const) {
  for (const format of ["png", "pdf"] as const) {
    test(`${language} government-style tender ${format} preserves local review safeguards`, async () => {
      const fixture = new URL(`./fixtures/${language === "urd" ? "urdu" : "mixed"}-tender.${format}`, import.meta.url);
      const scan = await extractWithOcr(await readFile(fixture), format === "pdf" ? "application/pdf" : "image/png", `tender.${format}`, language);
      assert.equal(scan.status, "needs_review", scan.error ?? undefined);
      assert.equal(scan.language, language);
      assert.match(scan.engine, language === "urd" ? /\(Urdu\)/ : /\(English \+ Urdu\)/);
      assert.doesNotMatch(scan.sourceText, /پنجاب|GOVERNMENT/);
      assert.match(scan.ocrText, /کمپیوٹر/);
      assert.match(scan.ocrText, /کی فراہمی/); // logical RTL word order
      if (language === "urd") {
        assert.match(scan.ocrText, /ٹینڈر نوٹس/);
        assert.match(scan.ocrText, /آخری تاریخ/);
      }
      if (language === "eng+urd") {
        assert.match(scan.ocrText, /GOVERNMENT OF PUNJAB/);
        assert.match(scan.ocrText, /Quantity 24 units/);
        assert.match(scan.ocrText, /50000/); // currency labels still require human checking
        assert.match(scan.ocrText, /20 October 2026/);
      }
      assert.ok(scan.confidence !== null && scan.confidence >= 0 && scan.confidence <= 100);
      assert.ok(scan.pages[0].confidence !== null);
      assert.equal(scan.reviewedText, null);
      assert.equal(scan.reviewedAt, null);
      assert.throws(() => draftingText(scan, "tender"), /Verify/);
      assert.throws(() => draftingText({ ...scan, status: "rejected" }, "tender"), /Verify/);
      const raw = scan.ocrText;
      const corrected = "حکومت پنجاب — human checked quantity 25";
      assert.match(draftingText({ ...scan, status: "verified", reviewedText: corrected }, "tender"), /human checked quantity 25/);
      assert.equal(scan.ocrText, raw);
    });
  }
}

test("missing language data fails locally rather than falling back to English", async () => {
  const original = process.env.TESSDATA_PREFIX;
  const empty = join(directory, "empty-tessdata");
  await mkdir(empty, { recursive: true });
  process.env.TESSDATA_PREFIX = empty;
  try {
    const scan = await extractWithOcr(await readFile(new URL("./fixtures/mixed-tender.png", import.meta.url)), "image/png", "mixed.png", "eng+urd");
    assert.equal(scan.status, "failed");
    assert.match(scan.error ?? "", /language data is missing/);
    assert.equal(scan.ocrText, "");
    assert.equal(scan.reviewedText, null);
    assert.throws(() => draftingText(scan, "mixed"), /Extraction failed/);
  } finally {
    if (original === undefined) delete process.env.TESSDATA_PREFIX;
    else process.env.TESSDATA_PREFIX = original;
  }
});

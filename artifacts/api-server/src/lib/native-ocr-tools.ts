import { existsSync, readFileSync } from "node:fs";

export type OcrTool = "pdfimages" | "pdftoppm" | "tesseract";

// Production builds record the installed Nix binary paths. Development can
// use PATH, but production must not depend on the workspace's extra utilities.
const manifest = new URL("./ocr-tools.json", import.meta.url);
const tools: Partial<Record<OcrTool, string>> = existsSync(manifest)
  ? JSON.parse(readFileSync(manifest, "utf8"))
  : {};

export function ocrTool(tool: OcrTool): string {
  const path = tools[tool];
  if (path && !existsSync(path)) {
    throw new Error(`Required PDF/OCR tool ${tool} is unavailable. Republish with the PDF/OCR system dependencies; the original document remains saved.`);
  }
  return path ?? tool;
}

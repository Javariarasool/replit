import { execFileSync, execFile } from "node:child_process";
import { promisify } from "node:util";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

const exec = promisify(execFile);
const artifactDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const buildScript = path.join(artifactDir, "build.mjs");
const manifestPath = path.join(artifactDir, "dist", "ocr-tools.json");
const testFile = path.join(artifactDir, "src", "lib", "ocr.test.ts");
const tsxCli = path.join(artifactDir, "node_modules", "tsx", "dist", "cli.mjs");
const tools = ["pdfimages", "pdftoppm", "tesseract"];

function runTests(pattern, environment) {
  const args = [
    tsxCli,
    "--test",
    "--test-concurrency=1",
    "--test-name-pattern",
    pattern,
    testFile,
  ];
  try {
    execFileSync(process.execPath, args, {
      cwd: artifactDir,
      env: environment,
      stdio: "inherit",
    });
  } catch (error) {
    throw new Error(`Production-like OCR test failed for "${pattern}".`, { cause: error });
  }
}

const temporaryDir = await mkdtemp(path.join(tmpdir(), "ocr-production-smoke-"));
try {
  execFileSync(process.execPath, [buildScript], { cwd: artifactDir, stdio: "inherit" });
  const manifest = JSON.parse(await readFile(manifestPath, "utf8"));
  for (const tool of tools) {
    if (typeof manifest[tool] !== "string" || !path.isAbsolute(manifest[tool])) {
      throw new Error(`Production OCR tool manifest has no absolute path for ${tool}.`);
    }
  }

  let languages;
  try {
    ({ stdout: languages } = await exec(manifest.tesseract, ["--list-langs"]));
  } catch (error) {
    throw new Error("Could not check Tesseract language data using the production tool manifest.", { cause: error });
  }
  const installedLanguages = new Set(languages.split(/\r?\n/).map((line) => line.trim()));
  const missingLanguages = ["eng", "urd"].filter((language) => !installedLanguages.has(language));
  if (missingLanguages.length) {
    throw new Error(`Required Tesseract language data is missing from the production tool manifest: ${missingLanguages.join(", ")}.`);
  }

  const minimalPath = path.join(temporaryDir, "empty-path");
  await mkdir(minimalPath);
  const environment = {
    ...process.env,
    PATH: minimalPath,
    NODE_ENV: "test",
    OCR_TOOLS_MANIFEST_PATH: manifestPath,
    OCR_FIXTURE_PDFTOPPM: manifest.pdftoppm,
  };
  delete environment.TESSDATA_PREFIX;

  // Only the synthetic native and scanned PDF behavior is repeated here; this
  // intentionally makes no AI or application/database requests.
  runTests("^(text PDF and plain text remain native source, not OCR|scanned PDF has separate OCR and cannot draft until verified)$", environment);
  runTests("government-style tender (png|pdf)", environment);
  runTests("missing language data fails locally rather than falling back to English", environment);

  for (const tool of tools) {
    const missingManifest = { ...manifest, [tool]: path.join(temporaryDir, `missing-${tool}`) };
    const missingManifestPath = path.join(temporaryDir, `manifest-missing-${tool}.json`);
    await writeFile(missingManifestPath, JSON.stringify(missingManifest));
    runTests("production smoke fails closed when a required PDF/OCR tool is missing", {
      ...environment,
      OCR_TOOLS_MANIFEST_PATH: missingManifestPath,
      OCR_SMOKE_MISSING_TOOL: tool,
    });
  }
} finally {
  await rm(temporaryDir, { recursive: true, force: true });
}

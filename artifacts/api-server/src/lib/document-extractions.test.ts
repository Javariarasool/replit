import { after, before, test } from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import express, { type Request } from "express";
import { mkdtemp, writeFile, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { setTimeout as delay } from "node:timers/promises";
import { eq, sql } from "drizzle-orm";
import { db, pool, usersTable, uploadsTable } from "@workspace/db";
import { GetDocumentExtractionResponse } from "@workspace/api-zod";
import { ObjectStorageService } from "./objectStorage";
import { queuedExtraction, ensureExtraction, cancelExtraction, claimExtractionJob, runExtractionJob, draftingText, shouldRetryExtraction } from "./document-extractions";
import extractionRouter from "../routes/document-extractions";

// A private schema keeps live development workers and user uploads out of
// queue tests, including when several claim connections run concurrently.
const testSchema = `ocr_jobs_test_${randomUUID().replaceAll("-", "")}`;
pool.options.options = `${pool.options.options ?? ""} -c search_path=${testSchema}`;
before(async () => {
  await db.execute(sql`create schema ${sql.identifier(testSchema)}`);
  await db.execute(sql`create table ${sql.identifier(testSchema)}.users (like public.users including all)`);
  await db.execute(sql`create table ${sql.identifier(testSchema)}.document_uploads (like public.document_uploads including all)`);
});
after(async () => {
  try { await db.execute(sql`drop schema ${sql.identifier(testSchema)} cascade`); }
  finally { await pool.end(); }
});

test("durable queue deduplicates, enforces ownership and language, bounds claims and recovers expired workers", async () => {
  const ownerId = `ocr-jobs-${randomUUID()}`;
  const paths = Array.from({ length: 4 }, () => `/objects/test-${randomUUID()}`);
  await db.insert(usersTable).values({ id: ownerId });
  try {
    await db.insert(uploadsTable).values(paths.map(objectPath => ({
      objectPath, ownerId, name: "test.txt", contentType: "text/plain", size: 10,
    })));
    const queued = await Promise.all(Array.from({ length: 4 }, () => ensureExtraction(paths[0], ownerId)));
    assert.equal(new Set(queued.map(e => e.job!.id)).size, 1);
    assert.equal(queued[0].status, "queued");
    assert.throws(() => draftingText({ ...queued[0], sourceText: "partial must never draft" }, "test.txt"), /still being read/);
    await assert.rejects(ensureExtraction(paths[0], "other-owner"), /not found/);
    await assert.rejects(ensureExtraction(paths[0], ownerId, false, "urd"), /another language/);
    for (const path of paths.slice(1)) await ensureExtraction(path, ownerId);
    const claims = (await Promise.all(Array.from({ length: 4 }, () => claimExtractionJob()))).filter(c => c !== null);
    assert.equal(claims.length, 2);
    const first = claims[0];
    assert.equal(first.extraction.status, "running");
    assert.throws(() => draftingText(first.extraction, "test.txt"), /still being read/);
    // Equivalent to a server dying and its durable lease expiring.
    const expired = { ...first.extraction, job: { ...first.extraction.job!, leaseUntil: new Date(0).toISOString() } };
    await db.update(uploadsTable).set({ extraction: expired }).where(eq(uploadsTable.objectPath, first.objectPath));
    const recovered = await claimExtractionJob();
    assert.ok(recovered);
    assert.equal(recovered.objectPath, first.objectPath);
    assert.equal(recovered.extraction.job!.id, first.extraction.job!.id);
    assert.notEqual(recovered.extraction.job!.token, first.extraction.job!.token);
    const publicState = GetDocumentExtractionResponse.parse(recovered.extraction);
    assert.ok(publicState?.job);
    assert.equal("token" in publicState.job, false);
    assert.equal("leaseUntil" in publicState.job, false);
  } finally {
    await db.delete(uploadsTable).where(eq(uploadsTable.ownerId, ownerId));
    await db.delete(usersTable).where(eq(usersTable.id, ownerId));
  }
});

test("workers publish only whole results, persist failures, retry, and fence obsolete attempts", async () => {
  const ownerId = `ocr-worker-${randomUUID()}`;
  const path = `/objects/test-${randomUUID()}`;
  const original = ObjectStorageService.prototype.getObjectEntityFile;
  let fail = false;
  let release: (() => void) | undefined;
  let gate: Promise<void> | undefined;
  ObjectStorageService.prototype.getObjectEntityFile = async () => ({
    getMetadata: async () => [{ size: 24 }],
    download: async () => {
      if (gate) await gate;
      if (fail) throw new Error("Storage temporarily unavailable");
      return [Buffer.from("Complete embedded source")];
    },
  } as unknown as Awaited<ReturnType<typeof original>>);
  await db.insert(usersTable).values({ id: ownerId });
  const saved = async () => (await db.select().from(uploadsTable).where(eq(uploadsTable.objectPath, path)))[0].extraction!;
  try {
    await db.insert(uploadsTable).values({ ownerId, objectPath: path, name: "test.txt", size: 24, contentType: "text/plain" });
    const queue = await ensureExtraction(path, ownerId);
    const worker = await claimExtractionJob();
    assert.ok(worker);
    gate = new Promise<void>(resolve => { release = resolve; });
    const work = runExtractionJob(worker);
    assert.equal((await saved()).sourceText, "");
    assert.equal((await saved()).ocrText, "");
    release!(); await work; gate = undefined;
    const complete = await saved();
    assert.equal(complete.status, "not_needed");
    assert.equal(complete.job!.status, "completed");
    assert.equal(draftingText(complete, "test.txt"), "Complete embedded source");
    assert.equal((await ensureExtraction(path, ownerId)).job!.id, queue.job!.id);

    // A changed-language request invalidates old text and verification.
    await ensureExtraction(path, ownerId, false, "urd");
    fail = true;
    const failing = await claimExtractionJob(); assert.ok(failing);
    await runExtractionJob(failing);
    const failed = await saved();
    assert.equal(failed.status, "failed");
    assert.equal(failed.job!.status, "failed");
    assert.equal(failed.sourceText, "");
    assert.match(failed.error!, /temporarily unavailable/);
    assert.throws(() => draftingText(failed, "test.txt"), /Extraction failed/);
    assert.equal((await ensureExtraction(path, ownerId)).job!.id, failed.job!.id);
    const retry = await ensureExtraction(path, ownerId, true);
    assert.equal(retry.status, "queued");
    assert.notEqual(retry.job!.id, failed.job!.id);
    fail = false;
    const staleWorker = await claimExtractionJob(); assert.ok(staleWorker);
    gate = new Promise<void>(resolve => { release = resolve; });
    const staleWork = runExtractionJob(staleWorker);
    const expired = { ...staleWorker.extraction, job: { ...staleWorker.extraction.job!, leaseUntil: new Date(0).toISOString() } };
    await db.update(uploadsTable).set({ extraction: expired }).where(eq(uploadsTable.objectPath, path));
    const replacement = await claimExtractionJob(); assert.ok(replacement);
    release!(); await staleWork; gate = undefined;
    assert.equal((await saved()).status, "running");
    assert.equal((await saved()).job!.token, replacement.extraction.job!.token);
    await runExtractionJob(replacement);
    assert.equal((await saved()).job!.status, "completed");
  } finally {
    ObjectStorageService.prototype.getObjectEntityFile = original;
    await db.delete(uploadsTable).where(eq(uploadsTable.ownerId, ownerId));
    await db.delete(usersTable).where(eq(usersTable.id, ownerId));
  }
});

test("fresh durable jobs contain no prior text or verification", () => {
  const extraction = queuedExtraction("eng+urd");
  assert.deepEqual(extraction.pages, []);
  assert.equal(extraction.reviewedText, null);
  assert.equal(extraction.reviewedAt, null);
  assert.equal(extraction.job!.totalPages, null);
});

test("cancelled queue is owner scoped, idempotent, text-free and retried only explicitly", async () => {
  const ownerId = `cancel-${randomUUID()}`, path = `/objects/${randomUUID()}`;
  await db.insert(usersTable).values({ id: ownerId });
  try {
    await db.insert(uploadsTable).values({ objectPath: path, ownerId, name: "original.txt", size: 10, contentType: "text/plain" });
    const queued = await ensureExtraction(path, ownerId);
    await assert.rejects(cancelExtraction(path, "other-owner", queued.job!.id), /not found/);
    await assert.rejects(cancelExtraction(path, ownerId, randomUUID()), /reading changed/);
    // Even unexpected partial fields are cleared at the cancellation boundary.
    await db.update(uploadsTable).set({ extraction: { ...queued, sourceText: "partial", ocrText: "partial", reviewedText: "partial", pages: [{ page: 1, text: "partial", confidence: 90 }] } }).where(eq(uploadsTable.objectPath, path));
    const cancelled = await cancelExtraction(path, ownerId, queued.job!.id);
    assert.equal(cancelled.status, "cancelled");
    assert.equal(cancelled.job!.status, "cancelled");
    assert.equal(cancelled.job!.token, null);
    assert.equal(cancelled.job!.leaseUntil, null);
    assert.ok(cancelled.job!.finishedAt);
    assert.equal(cancelled.sourceText + cancelled.ocrText, "");
    assert.deepEqual(cancelled.pages, []);
    assert.equal(cancelled.reviewedText, null);
    assert.deepEqual(await cancelExtraction(path, ownerId, queued.job!.id), cancelled);
    assert.equal(await claimExtractionJob(), null);
    assert.equal(shouldRetryExtraction(cancelled), false);
    assert.equal(shouldRetryExtraction(cancelled, true), true);
    assert.throws(() => draftingText({ ...cancelled, sourceText: "partial" }, "original.txt"), /cancelled/);
    assert.equal((await ensureExtraction(path, ownerId)).status, "cancelled");
    assert.equal((await ensureExtraction(path, ownerId, false, "urd")).status, "cancelled");
    const retry = await ensureExtraction(path, ownerId, true, "urd");
    assert.equal(retry.status, "queued");
    assert.equal(retry.language, "urd");
    assert.notEqual(retry.job!.id, queued.job!.id);
    await assert.rejects(cancelExtraction(path, ownerId, queued.job!.id), /reading changed/);
    const [original] = await db.select().from(uploadsTable).where(eq(uploadsTable.objectPath, path));
    assert.equal(original.name, "original.txt");
    assert.equal(original.size, 10);
  } finally {
    await db.delete(uploadsTable).where(eq(uploadsTable.ownerId, ownerId));
    await db.delete(usersTable).where(eq(usersTable.id, ownerId));
  }
});

test("cancellation fences a running worker from overwriting cancellation or a later retry", async () => {
  const ownerId = `cancel-worker-${randomUUID()}`, path = `/objects/${randomUUID()}`;
  const original = ObjectStorageService.prototype.getObjectEntityFile;
  let release!: () => void, downloading!: () => void;
  const gate = new Promise<void>(resolve => { release = resolve; });
  const entered = new Promise<void>(resolve => { downloading = resolve; });
  let block = true;
  ObjectStorageService.prototype.getObjectEntityFile = async () => ({
    getMetadata: async () => [{ size: 24 }],
    download: async () => { if (block) { downloading(); await gate; } return [Buffer.from("Complete embedded source")]; },
  } as unknown as Awaited<ReturnType<typeof original>>);
  await db.insert(usersTable).values({ id: ownerId });
  const saved = async () => (await db.select().from(uploadsTable).where(eq(uploadsTable.objectPath, path)))[0].extraction!;
  try {
    await db.insert(uploadsTable).values({ ownerId, objectPath: path, name: "original.txt", size: 24, contentType: "text/plain" });
    await ensureExtraction(path, ownerId);
    const claimed = await claimExtractionJob(); assert.ok(claimed);
    const work = runExtractionJob(claimed);
    await entered;
    await cancelExtraction(path, ownerId, claimed.extraction.job!.id);
    assert.equal((await saved()).status, "cancelled");
    const retry = await ensureExtraction(path, ownerId, true);
    release(); await work;
    assert.equal((await saved()).status, "queued");
    assert.equal((await saved()).job!.id, retry.job!.id);
    assert.equal((await saved()).sourceText, "");
    block = false;
    const replacement = await claimExtractionJob(); assert.ok(replacement);
    await runExtractionJob(replacement);
    assert.equal((await saved()).status, "not_needed");
    await assert.rejects(cancelExtraction(path, ownerId, retry.job!.id), /already finished/);
  } finally {
    release();
    ObjectStorageService.prototype.getObjectEntityFile = original;
    await db.delete(uploadsTable).where(eq(uploadsTable.ownerId, ownerId));
    await db.delete(usersTable).where(eq(usersTable.id, ownerId));
  }
});

test("cancel endpoint requires authentication, validates attempts and rejects review of cancelled text", async () => {
  const ownerId = `cancel-api-${randomUUID()}`, path = `/objects/${randomUUID()}`;
  const app = express();
  app.use(express.json());
  // Test-only identity middleware; the production router still requires auth.
  app.use((req, _res, next) => {
    const id = req.header("x-test-owner");
    if (id) req.user = { id, email: null, firstName: null, lastName: null, profileImageUrl: null };
    req.isAuthenticated = function (this: Request) { return !!this.user; } as Request["isAuthenticated"];
    next();
  });
  app.use(extractionRouter);
  const server = app.listen(0, "127.0.0.1");
  await new Promise<void>(resolve => server.once("listening", resolve));
  const address = server.address(); assert.ok(address && typeof address !== "string");
  const url = `http://127.0.0.1:${address.port}`;
  const request = (route: string, body: unknown, owner?: string, method = "POST") => fetch(`${url}${route}`, {
    method, headers: { "content-type": "application/json", ...(owner ? { "x-test-owner": owner } : {}) }, body: JSON.stringify(body),
  });
  await db.insert(usersTable).values({ id: ownerId });
  try {
    await db.insert(uploadsTable).values({ objectPath: path, ownerId, name: "original.txt", size: 10, contentType: "text/plain" });
    const queued = await ensureExtraction(path, ownerId);
    const body = { objectPath: path, jobId: queued.job!.id };
    assert.equal((await request("/documents/extraction/cancel", body)).status, 401);
    assert.equal((await request("/documents/extraction/cancel", body, "other-owner")).status, 404);
    assert.equal((await request("/documents/extraction/cancel", { objectPath: path }, ownerId)).status, 400);
    assert.equal((await request("/documents/extraction/cancel", { ...body, jobId: randomUUID() }, ownerId)).status, 409);
    const cancelled = await request("/documents/extraction/cancel", body, ownerId);
    assert.equal(cancelled.status, 200);
    const payload = await cancelled.json() as { status: string; sourceText: string; job: Record<string, unknown> };
    assert.equal(payload.status, "cancelled");
    assert.equal(payload.sourceText, "");
    assert.equal("token" in payload.job, false);
    assert.equal("leaseUntil" in payload.job, false);
    assert.equal((await request("/documents/extraction/cancel", body, ownerId)).status, 200);
    assert.equal((await request("/documents/extraction", { objectPath: path, status: "verified", confirmed: true, reviewedText: "partial" }, ownerId, "PATCH")).status, 409);
    const automatic = await request("/documents/extraction", { objectPath: path, language: "urd" }, ownerId);
    assert.equal(GetDocumentExtractionResponse.parse(await automatic.json())?.status, "cancelled");
    const retried = await request("/documents/extraction", { objectPath: path, retry: true }, ownerId);
    assert.equal(GetDocumentExtractionResponse.parse(await retried.json())?.status, "queued");
  } finally {
    await new Promise<void>((resolve, reject) => server.close(error => error ? reject(error) : resolve()));
    await db.delete(uploadsTable).where(eq(uploadsTable.ownerId, ownerId));
    await db.delete(usersTable).where(eq(usersTable.id, ownerId));
  }
});

test("workers stop active native OCR on local and remotely persisted cancellation", async () => {
  const ownerId = `cancel-native-${randomUUID()}`;
  const directory = await mkdtemp(join(tmpdir(), "worker-cancel-test-"));
  const ready = join(directory, "ready");
  const original = ObjectStorageService.prototype.getObjectEntityFile;
  const oldPath = process.env.PATH;
  // A controllable direct native process exercises the worker's stop wiring.
  await writeFile(join(directory, "tesseract"), `#!${process.execPath}
if (process.argv.includes('--list-langs')) { process.stdout.write('eng\\n'); }
else { require('fs').writeFileSync(${JSON.stringify(ready)}, String(process.pid)); setInterval(() => {}, 1000); }
`, { mode: 0o755 });
  process.env.PATH = `${directory}:${oldPath ?? ""}`;
  ObjectStorageService.prototype.getObjectEntityFile = async () => ({
    getMetadata: async () => [{ size: 5 }],
    download: async () => [Buffer.from("image")],
  } as unknown as Awaited<ReturnType<typeof original>>);
  await db.insert(usersTable).values({ id: ownerId });
  try {
    for (const remote of [false, true]) {
      await rm(ready, { force: true });
      const path = `/objects/${randomUUID()}`;
      await db.insert(uploadsTable).values({ ownerId, objectPath: path, name: "original.png", size: 5, contentType: "image/png" });
      await ensureExtraction(path, ownerId);
      const claimed = await claimExtractionJob(); assert.ok(claimed);
      const work = runExtractionJob(claimed);
      let pid = 0;
      for (let i = 0; i < 300 && !pid; i++) {
        try { pid = Number(await readFile(ready, "utf8")); } catch { await delay(10); }
      }
      assert.ok(pid, "native OCR started");
      if (remote) {
        // Like cancellation in a separate process: no local controller access.
        const extraction = { ...claimed.extraction, status: "cancelled" as const,
          job: { ...claimed.extraction.job!, status: "cancelled" as const, token: null, leaseUntil: null, finishedAt: new Date().toISOString(), stage: "Reading cancelled" } };
        await db.update(uploadsTable).set({ extraction }).where(eq(uploadsTable.objectPath, path));
      } else await cancelExtraction(path, ownerId, claimed.extraction.job!.id);
      await Promise.race([work, delay(4000).then(() => { throw new Error("Cancelled OCR did not stop promptly"); })]);
      assert.throws(() => process.kill(pid, 0), { code: "ESRCH" });
      const [saved] = await db.select().from(uploadsTable).where(eq(uploadsTable.objectPath, path));
      assert.equal(saved.extraction!.status, "cancelled");
      assert.equal(saved.extraction!.sourceText + saved.extraction!.ocrText, "");
      assert.deepEqual(saved.extraction!.pages, []);
    }
  } finally {
    process.env.PATH = oldPath;
    ObjectStorageService.prototype.getObjectEntityFile = original;
    await db.delete(uploadsTable).where(eq(uploadsTable.ownerId, ownerId));
    await db.delete(usersTable).where(eq(usersTable.id, ownerId));
    await rm(directory, { recursive: true, force: true });
  }
});

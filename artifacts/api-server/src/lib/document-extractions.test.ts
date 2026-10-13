import { after, before, test } from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { eq, sql } from "drizzle-orm";
import { db, pool, usersTable, uploadsTable } from "@workspace/db";
import { GetDocumentExtractionResponse } from "@workspace/api-zod";
import { ObjectStorageService } from "./objectStorage";
import { queuedExtraction, ensureExtraction, claimExtractionJob, runExtractionJob, draftingText } from "./document-extractions";

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

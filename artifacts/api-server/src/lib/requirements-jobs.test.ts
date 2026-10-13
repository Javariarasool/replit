import { before, after, test } from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { eq, sql } from "drizzle-orm";
import { db, pool, usersTable, uploadsTable, evidenceTable, tendersTable, requirementItemsTable, type RequirementsExtraction } from "@workspace/db";
import { queuedExtraction } from "./document-extractions";
import { advanceSection, queueRequirements, processRequirements, requirementsProcessing } from "./requirements-jobs";
import { InvalidSectionOutputError, splitTenderText } from "./tender-requirements";
import { requirementKey } from "./requirement-items";
import { tenderView } from "./tender-data";

const schema = `requirements_jobs_test_${randomUUID().replaceAll("-", "")}`;
pool.options.options = `${pool.options.options ?? ""} -c search_path=${schema}`;
before(async () => {
  await db.execute(sql`create schema ${sql.identifier(schema)}`);
  for (const table of ["users", "document_uploads", "tenders", "tender_evidence", "requirement_items", "proposals"]) {
    await db.execute(sql`create table ${sql.identifier(schema)}.${sql.identifier(table)} (like public.${sql.identifier(table)} including all)`);
  }
});
after(async () => {
  try { await db.execute(sql`drop schema ${sql.identifier(schema)} cascade`); }
  finally { await pool.end(); }
});
const result = (title: string) => ({
  summary: "Tender scope", requirements: `Supply ${title}`, warnings: [],
  items: [{ title, description: `Supply ${title}`, category: "technical" as const, sourceReference: "large.pdf",
    sourceQuote: `Supply ${title}`, quantity: 1, unit: "item", requiresVendor: true }],
});
type Job = NonNullable<RequirementsExtraction["job"]>;

test("large source text is covered by small overlapping sections, including its final clause", () => {
  const text = Array.from({ length: 5000 }, (_, i) => `CLAUSE-${i}: ${"Mandatory hardware and commercial condition. ".repeat(3)}`).join("\n");
  const parts = splitTenderText(text);
  assert.ok(parts.length > 50);
  assert.ok(parts.every(p => p.length <= 8000));
  const seen = new Set(parts.flatMap(p => [...p.matchAll(/CLAUSE-(\d+):/g)].map(m => Number(m[1]))));
  assert.equal(seen.size, 5000);
});

test("truncated output checkpoints smaller sections with just one provider call per step", async () => {
  const text = `SOURCE FILE: "large.pdf"\nSOURCE SECTION: 1 OF 1\n${"requirement line\n".repeat(450)}`;
  const job: Job = { id: randomUUID(), cardScope: "evaluated_only", status: "processing", completedSections: 0, totalSections: 1, sourceFiles: [],
    error: null, sections: [{ label: "large.pdf section 1", text, depth: 0, attempts: 0 }], results: [] };
  let calls = 0;
  const next = await advanceSection(job, async () => { calls++; throw new InvalidSectionOutputError("incomplete"); });
  assert.equal(calls, 1);
  assert.equal(job.sections!.length, 1);
  assert.ok(next.sections!.length > 1);
  assert.equal(next.totalSections, next.sections!.length);
  assert.equal(next.completedSections, 0);
  assert.ok(next.sections!.every(s => s.text.startsWith('SOURCE FILE: "large.pdf"')));
});

test("transient failures are bounded and preserve successful checkpoints", async () => {
  let job: Job = { id: randomUUID(), status: "processing", completedSections: 1, totalSections: 2, sourceFiles: [],
    error: null, results: [{ label: "first", result: result("first") }],
    sections: [{ label: "second", text: "Supply final switch", depth: 0, attempts: 0 }] };
  for (let i = 0; i < 3; i++) job = await advanceSection(job, async () => { throw new Error("Timeout"); });
  assert.equal(job.status, "failed");
  assert.equal(job.completedSections, 1);
  assert.equal(job.results!.length, 1);
  assert.equal(job.sections!.length, 1);
});

test("durable extraction resumes after failure and publishes the whole brief and cards atomically", async () => {
  const ownerId = `test-${randomUUID()}`;
  await db.insert(usersTable).values({ id: ownerId });
  const [tender] = await db.insert(tendersTable).values({ ownerId, title: "Large test tender", agency: "Test", requirements: "Saved human brief" }).returning();
  const path = `/objects/test-${randomUUID()}`;
  const sourceText = "Supply hardware and software. ".repeat(700);
  const extraction = { ...queuedExtraction("eng"), status: "not_needed" as const, sourceText, job: undefined };
  await db.insert(uploadsTable).values({ ownerId, objectPath: path, name: "large.pdf", contentType: "application/pdf", size: 100, extraction });
  await db.insert(evidenceTable).values({ ownerId, tenderId: tender.id, objectPath: path, name: "large.pdf", category: "tender_rfp", contentType: "application/pdf", size: 100 });
  const queued = await queueRequirements(tender.id, ownerId);
  const duplicate = await queueRequirements(tender.id, ownerId);
  assert.equal(queued.requirementsExtraction!.job!.id, duplicate.requirementsExtraction!.job!.id);
  assert.ok(await requirementsProcessing(ownerId));
  assert.equal((await tenderView(queued)).requirementsExtraction!.job!.sections, undefined);
  assert.equal(queued.requirements, "Saved human brief");
  const read = async () => (await db.select().from(tendersTable).where(eq(tendersTable.id, tender.id)))[0];
  await processRequirements(tender.id, ownerId, async () => result("first"));
  assert.equal((await read()).requirementsExtraction!.job!.completedSections, 1);
  assert.equal((await db.select().from(requirementItemsTable)).length, 0);
  for (let i = 0; i < 3; i++) await processRequirements(tender.id, ownerId, async () => { throw new Error("Unavailable"); });
  assert.equal((await read()).requirementsExtraction!.job!.status, "failed");
  const resumed = await queueRequirements(tender.id, ownerId);
  assert.equal(resumed.requirementsExtraction!.job!.completedSections, 1);
  let counter = 1;
  while ((await read()).requirementsExtraction!.job!.status === "processing") {
    await processRequirements(tender.id, ownerId, async () => result(`remaining-${counter++}`));
  }
  const complete = await read();
  assert.equal(complete.requirementsExtraction!.job!.status, "completed");
  assert.equal(complete.requirementsExtraction!.job!.completedSections, complete.requirementsExtraction!.job!.totalSections);
  const rows = await db.select().from(requirementItemsTable).where(eq(requirementItemsTable.tenderId, tender.id));
  assert.equal(rows.length, counter);
  assert.ok(rows.every(r => r.extractionId === complete.requirementsExtraction!.id && r.reviewStatus === "pending"));
  assert.equal(complete.requirements, "Saved human brief");
  assert.match(complete.requirementsExtraction!.requirements, /remaining-/);
  assert.equal(await requirementsProcessing(ownerId), false);
  await assert.rejects(processRequirements(tender.id, "other-owner", async () => result("unauthorized")), /not found/);
  // Re-extraction reuses identical rows without discarding their human evidence.
  const first = rows.find(r => r.sourceKey === requirementKey(result("first").items[0]!))!;
  await db.update(requirementItemsTable).set({ reviewStatus: "approved", evidenceIds: ["kept-test-evidence"] }).where(eq(requirementItemsTable.id, first.id));
  await queueRequirements(tender.id, ownerId);
  counter = 0;
  while ((await read()).requirementsExtraction!.job!.status === "processing") {
    await processRequirements(tender.id, ownerId, async () => result(counter++ === 0 ? "first" : `remaining-${counter - 1}`));
  }
  const [retained] = await db.select().from(requirementItemsTable).where(eq(requirementItemsTable.id, first.id));
  assert.deepEqual(retained.evidenceIds, ["kept-test-evidence"]);
  assert.equal(retained.reviewStatus, "pending");
  assert.equal(retained.extractionId, (await read()).requirementsExtraction!.id);
});

test("concurrent tabs cannot process a section twice; obsolete workers cannot overwrite recovery", async () => {
  const ownerId = `lease-${randomUUID()}`;
  await db.insert(usersTable).values({ id: ownerId });
  const job: Job = { id: randomUUID(), cardScope: "evaluated_only", status: "processing", completedSections: 0, totalSections: 1, sourceFiles: [],
    error: null, sections: [{ label: "final", text: "Final switch", depth: 0, attempts: 0 }], results: [] };
  const [tender] = await db.insert(tendersTable).values({ ownerId, title: "Lease test", agency: "Test",
    requirementsExtraction: { id: randomUUID(), requirements: "", summary: "", sourceFiles: [], warnings: [], extractedAt: new Date().toISOString(), reviewedAt: null, job } }).returning();
  let release!: () => void, entered!: () => void;
  const gate = new Promise<void>(resolve => { release = resolve; });
  const started = new Promise<void>(resolve => { entered = resolve; });
  const stale = processRequirements(tender.id, ownerId, async () => { entered(); await gate; return result("obsolete"); });
  await started;
  let calls = 0;
  await processRequirements(tender.id, ownerId, async () => { calls++; return result("duplicate"); });
  assert.equal(calls, 0);
  const [current] = await db.select().from(tendersTable).where(eq(tendersTable.id, tender.id));
  await db.update(tendersTable).set({ requirementsExtraction: { ...current.requirementsExtraction!, job: { ...current.requirementsExtraction!.job!, leaseUntil: new Date(0).toISOString() } } }).where(eq(tendersTable.id, tender.id));
  await processRequirements(tender.id, ownerId, async () => result("replacement"));
  release(); await stale;
  const [saved] = await db.select().from(tendersTable).where(eq(tendersTable.id, tender.id));
  assert.match(saved.requirementsExtraction!.requirements, /replacement/);
  assert.doesNotMatch(saved.requirementsExtraction!.requirements, /obsolete/);
});

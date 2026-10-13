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

test("a full-tender job passes its consented Claude provider to the extractor", async () => {
  const job: Job = {
    id: randomUUID(), strategy: "full_tender", provider: "anthropic", status: "processing",
    completedSections: 0, totalSections: 1, error: null, sourceFiles: [],
    sections: [{ label: "Complete tender", text: "Original full tender", depth: 0, attempts: 0 }], results: [],
  };
  let calls = 0;
  const next = await advanceSection(job, async (text, partial, provider) => {
    calls++;
    assert.equal(text, "Original full tender");
    assert.equal(partial, false);
    assert.equal(provider, "anthropic");
    return result("switches");
  });
  assert.equal(calls, 1);
  assert.equal(next.provider, "anthropic");
  assert.equal(next.completedSections, 1);
});

test("large source text is covered by small overlapping sections, including its final clause", () => {
  const text = Array.from({ length: 5000 }, (_, i) => `CLAUSE-${i}: ${"Mandatory hardware and commercial condition. ".repeat(3)}`).join("\n");
  const parts = splitTenderText(text);
  assert.ok(parts.length > 50);
  assert.ok(parts.every(p => p.length <= 8000));
  const seen = new Set(parts.flatMap(p => [...p.matchAll(/CLAUSE-(\d+):/g)].map(m => Number(m[1]))));
  assert.equal(seen.size, 5000);
});
test("newline-aligned tiny recovery chunks always advance and retain every source character", () => {
  const text = "x".repeat(1500) + "\n" + "y".repeat(3000);
  const chunks = splitTenderText(text, 2002);
  assert.ok(chunks.length < 10);
  let covered = "", end = 0;
  for (const chunk of chunks) {
    const start = text.indexOf(chunk, Math.max(0, end - 500));
    assert.ok(start >= 0 && start <= end);
    covered += chunk.slice(Math.max(0, end - start));
    end = start + chunk.length;
  }
  assert.equal(covered, text);
});
test("two small untouched chunks share one bounded AI call without losing progress or their requirements", async () => {
  const job: Job = { id: randomUUID(), cardScope: "evaluated_only", status: "processing", completedSections: 2, totalSections: 4,
    sourceFiles: [], error: null, results: [{ label: "saved", result: result("saved") }],
    sections: [{ label: "first", text: "Supply first switch", depth: 0, attempts: 0 },
      { label: "second", text: "Supply second switch", depth: 0, attempts: 0 }] };
  let calls = 0;
  const next = await advanceSection(job, async text => {
    calls++; assert.match(text, /Supply first switch/); assert.match(text, /Supply second switch/);
    return { ...result("first switch"), items: [...result("first switch").items, ...result("second switch").items] };
  });
  assert.equal(calls, 1); assert.equal(next.completedSections, 4); assert.equal(next.sections!.length, 0);
  assert.equal(next.results![0]!.label, "saved");
  assert.equal(next.results![1]!.result.items.length, 2);
  assert.equal(job.completedSections, 2); assert.equal(job.sections!.length, 2);
});
test("a malformed two-chunk batch falls back to the untouched individual inputs with one call per step", async () => {
  const job: Job = { id: randomUUID(), cardScope: "evaluated_only", status: "processing", completedSections: 0, totalSections: 2,
    sourceFiles: [], error: null, results: [],
    sections: [{ label: "first", text: "Supply first switch", depth: 0, attempts: 0 },
      { label: "second", text: "Supply second switch", depth: 0, attempts: 0 }] };
  let calls = 0;
  const failed = await advanceSection(job, async () => { calls++; throw new InvalidSectionOutputError("invalid_shape"); });
  assert.equal(calls, 1); assert.equal(failed.sections!.length, 2); assert.equal(failed.completedSections, 0);
  assert.equal(failed.sections![0]!.text, job.sections![0]!.text);
  const recovered = await advanceSection(failed, async text => {
    calls++; assert.equal(text, "Supply first switch"); return result("first switch");
  });
  assert.equal(calls, 2); assert.equal(recovered.completedSections, 1);
  assert.equal(recovered.sections![0]!.text, "Supply second switch");
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

test("a full-tender attempt uses one complete input and never splits a failed response", async () => {
  const text = `FIRST ASSESSED CLAUSE\n${"General background is not a checklist item.\n".repeat(1000)}LAST ASSESSED CLAUSE`;
  const job: Job = { id: randomUUID(), strategy: "full_tender", cardScope: "evaluated_only", status: "processing",
    completedSections: 0, totalSections: 1, sourceFiles: [], error: null,
    sections: [{ label: "complete.pdf", text, depth: 0, attempts: 0 }], results: [] };
  let calls = 0;
  const failed = await advanceSection(job, async (input, partial) => {
    calls++; assert.equal(input, text); assert.equal(partial, false);
    throw new InvalidSectionOutputError("incomplete");
  });
  assert.equal(calls, 1);
  assert.equal(failed.status, "failed");
  assert.equal(failed.totalSections, 1);
  assert.equal(failed.completedSections, 0);
  assert.equal(failed.sections![0]!.text, text);
  assert.equal(failed.sections!.length, 1);
  assert.match(failed.error!, /No partial checklist/);
  const tooLarge = await advanceSection(job, async () => {
    throw Object.assign(new Error("Maximum input token limit"), { code: "context_length_exceeded" });
  });
  assert.equal(tooLarge.status, "failed");
  assert.match(tooLarge.error!, /input limit/);
  assert.equal(tooLarge.sections![0]!.text, text);
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
  assert.equal(queued.requirementsExtraction!.job!.strategy, "full_tender");
  assert.equal(queued.requirementsExtraction!.job!.totalSections, 1);
  assert.ok(queued.requirementsExtraction!.job!.sections![0]!.text.includes(sourceText));
  assert.equal(queued.requirements, "Saved human brief");
  const read = async () => (await db.select().from(tendersTable).where(eq(tendersTable.id, tender.id)))[0];
  await processRequirements(tender.id, ownerId, async () => { throw new Error("Unavailable"); });
  assert.equal((await read()).requirementsExtraction!.job!.completedSections, 0);
  assert.equal((await db.select().from(requirementItemsTable)).length, 0);
  assert.equal((await read()).requirementsExtraction!.job!.status, "failed");
  const resumed = await queueRequirements(tender.id, ownerId, "anthropic");
  assert.equal(resumed.requirementsExtraction!.job!.provider, "anthropic");
  assert.equal(resumed.requirementsExtraction!.job!.completedSections, 0);
  assert.equal(resumed.requirementsExtraction!.job!.id, queued.requirementsExtraction!.job!.id);
  let counter = 0;
  while ((await read()).requirementsExtraction!.job!.status === "processing") {
    await processRequirements(tender.id, ownerId, async (text, partial, provider) => {
      counter++; assert.ok(text.includes(sourceText)); assert.equal(partial, false);
      assert.equal(provider, "anthropic");
      return result("first");
    });
  }
  assert.equal(counter, 1);
  const complete = await read();
  assert.equal(complete.requirementsExtraction!.job!.status, "completed");
  assert.equal(complete.requirementsExtraction!.job!.completedSections, complete.requirementsExtraction!.job!.totalSections);
  const rows = await db.select().from(requirementItemsTable).where(eq(requirementItemsTable.tenderId, tender.id));
  assert.equal(rows.length, counter);
  assert.ok(rows.every(r => r.extractionId === complete.requirementsExtraction!.id && r.reviewStatus === "pending"));
  assert.equal(complete.requirements, "Saved human brief");
  assert.match(complete.requirementsExtraction!.requirements, /first/);
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

test("concurrent tabs cannot process the full tender twice; obsolete workers cannot overwrite recovery", async () => {
  const ownerId = `lease-${randomUUID()}`;
  await db.insert(usersTable).values({ id: ownerId });
  const job: Job = { id: randomUUID(), strategy: "full_tender", cardScope: "evaluated_only", status: "processing", completedSections: 0, totalSections: 1, sourceFiles: [],
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

test("legacy chunk jobs upgrade from complete original sources without exposing or losing saved work", async () => {
  const ownerId = `test-${randomUUID()}`;
  await db.insert(usersTable).values({ id: ownerId });
  const [tender] = await db.insert(tendersTable).values({ ownerId, title: "Full tender migration", agency: "Test", requirements: "Human-reviewed brief" }).returning();
  const texts = ["Supply first. " + "Background context. ".repeat(800) + "FIRST FINAL CLAUSE",
    "Supply second. " + "Annexure context. ".repeat(700) + "SECOND FINAL CLAUSE"];
  for (let i = 0; i < texts.length; i++) {
    const path = `/objects/test-${randomUUID()}`;
    await db.insert(uploadsTable).values({ ownerId, objectPath: path, name: `source-${i}.pdf`, contentType: "application/pdf", size: 100,
      extraction: { ...queuedExtraction("eng"), status: "not_needed", sourceText: texts[i], job: undefined } });
    await db.insert(evidenceTable).values({ ownerId, tenderId: tender.id, objectPath: path, name: `source-${i}.pdf`,
      category: "tender_rfp", contentType: "application/pdf", size: 100, notes: `UNIQUE_HUMAN_NOTE_${i}` });
  }
  const queued = await queueRequirements(tender.id, ownerId);
  const legacy: Job = { ...queued.requirementsExtraction!.job!, strategy: undefined, completedSections: 1, totalSections: 96,
    sections: [{ label: "old chunk", text: "PRIVATE OLD PARTIAL TEXT", depth: 0, attempts: 0 }],
    results: [{ label: "saved chunk", result: result("saved previous clause") }] };
  await db.update(tendersTable).set({ requirementsExtraction: { ...queued.requirementsExtraction!, job: legacy } }).where(eq(tendersTable.id, tender.id));
  let calls = 0;
  await processRequirements(tender.id, ownerId, async (input, partial) => {
    calls++; assert.equal(partial, false);
    for (let i = 0; i < texts.length; i++) {
      assert.ok(input.includes(texts[i]!));
      assert.equal(input.split(`UNIQUE_HUMAN_NOTE_${i}`).length - 1, 1);
    }
    assert.doesNotMatch(input, /SOURCE CHUNK|PRIVATE OLD PARTIAL TEXT/);
    const [inProgress] = await db.select().from(tendersTable).where(eq(tendersTable.id, tender.id));
    assert.equal(inProgress.requirements, "Human-reviewed brief");
    assert.equal(inProgress.requirementsExtraction!.job!.legacyCheckpoint!.results![0]!.result.items[0]!.title, "saved previous clause");
    const publicJob = (await tenderView(inProgress)).requirementsExtraction!.job!;
    assert.equal("legacyCheckpoint" in publicJob, false);
    assert.equal("strategy" in publicJob, false);
    return { ...result("first"), items: [...result("first").items, ...result("second").items] };
  });
  assert.equal(calls, 1);
  const [complete] = await db.select().from(tendersTable).where(eq(tendersTable.id, tender.id));
  assert.equal(complete.requirements, "Human-reviewed brief");
  assert.equal(complete.requirementsExtraction!.job!.status, "completed");
  assert.equal(complete.requirementsExtraction!.job!.legacyCheckpoint, undefined);
  assert.equal((await db.select().from(requirementItemsTable).where(eq(requirementItemsTable.tenderId, tender.id))).length, 2);
});

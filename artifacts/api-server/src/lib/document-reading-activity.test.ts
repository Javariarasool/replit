import { after, before, test } from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { eq, sql } from "drizzle-orm";
import { db, pool, usersTable, uploadsTable, proposalLibraryTable, evidenceTable, tendersTable, companyEvidenceTable } from "@workspace/db";
import { ListDocumentReadingActivityResponse } from "@workspace/api-zod";
import { queuedExtraction } from "./document-extractions";
import { listDocumentReadingActivity } from "./document-reading-activity";

const schema = `reading_activity_test_${randomUUID().replaceAll("-", "")}`;
pool.options.options = `${pool.options.options ?? ""} -c search_path=${schema}`;
before(async () => {
  await db.execute(sql`create schema ${sql.identifier(schema)}`);
  for (const table of ["users", "document_uploads", "proposal_library", "tenders", "tender_evidence", "company_evidence"]) {
    await db.execute(sql`create table ${sql.identifier(schema)}.${sql.identifier(table)} (like public.${sql.identifier(table)} including all)`);
  }
});
after(async () => {
  try { await db.execute(sql`drop schema ${sql.identifier(schema)} cascade`); }
  finally { await pool.end(); }
});

test("activity is owner-scoped, metadata-only, persisted and links to existing reviews", async () => {
  const owner = `reading-${randomUUID()}`, other = `other-${randomUUID()}`;
  await db.insert(usersTable).values([{ id: owner }, { id: other }]);
  const paths = ["library", "tender", "company", "unattached", "legacy", "unread", "foreign"].map(label => `/objects/${label}-${randomUUID()}`);
  const statuses = ["needs_review", "running", "failed", "queued", "not_needed"] as const;
  await db.insert(uploadsTable).values(paths.map((objectPath, index) => {
    const extraction = queuedExtraction("eng");
    extraction.status = statuses[index] ?? "needs_review";
    extraction.sourceText = "SECRET_SOURCE"; extraction.ocrText = "SECRET_OCR";
    extraction.reviewedText = "SECRET_REVIEW"; extraction.error = "SECRET_ERROR";
    extraction.job!.token = "SECRET_TOKEN";
    if (index === 4) delete extraction.job; // Historical extraction without a job.
    return { objectPath, ownerId: index === 6 ? other : owner, name: `${index}.pdf`, size: 1, contentType: "application/pdf", extraction: index === 5 ? null : extraction };
  }));
  const [entry] = await db.insert(proposalLibraryTable).values({ ownerId: owner, title: "History", agency: "Agency", category: "mixed", tenderObjectPath: paths[0] }).returning();
  // A foreign record referring to the same path must never leak its ID.
  const [foreign] = await db.insert(proposalLibraryTable).values({ ownerId: other, title: "Foreign", agency: "Agency", category: "mixed", tenderObjectPath: paths[0] }).returning();
  const [tender] = await db.insert(tendersTable).values({ ownerId: owner, title: "Tender", agency: "Agency", category: "mixed" }).returning();
  await db.insert(evidenceTable).values({ ownerId: owner, tenderId: tender.id, name: "Tender file", category: "tender_document", objectPath: paths[1], contentType: "application/pdf", size: 1 });
  await db.insert(companyEvidenceTable).values({ ownerId: owner, title: "Certificate", name: "Certificate", category: "certification", objectPath: paths[2], contentType: "application/pdf", size: 1 });
  const result = ListDocumentReadingActivityResponse.parse(await listDocumentReadingActivity(owner));
  assert.equal(result.length, 5);
  assert.ok(result.slice(0, 2).every(item => ["queued", "running"].includes(item.status)));
  assert.deepEqual(result.find(item => item.objectPath === paths[0])!.reviewLinks, [{ label: "Review library tender", href: `/library/${entry.id}` }]);
  assert.equal(result.find(item => item.objectPath === paths[1])!.reviewLinks[0].href, `/tenders/${tender.id}?tab=evidence`);
  assert.equal(result.find(item => item.objectPath === paths[2])!.reviewLinks[0].href, "/company-evidence");
  assert.equal(result.find(item => item.objectPath === paths[3])!.reviewLinks[0].href, `/readings/review?objectPath=${encodeURIComponent(paths[3])}`);
  assert.ok(result.find(item => item.objectPath === paths[4])!.queuedAt);
  const serialized = JSON.stringify(result);
  assert.ok(!serialized.includes("SECRET_"));
  assert.ok(!serialized.includes(foreign.id));
  assert.ok(!serialized.includes(paths[6]));
  const before = await db.select().from(uploadsTable);
  assert.deepEqual(await listDocumentReadingActivity(owner), result);
  assert.deepEqual(await db.select().from(uploadsTable), before, "Reading the feed must not enqueue or authorize any processing");
  const finished = { ...queuedExtraction("eng"), status: "verified" as const };
  finished.job!.status = "completed"; finished.job!.finishedAt = new Date().toISOString();
  await db.update(uploadsTable).set({ extraction: finished }).where(eq(uploadsTable.objectPath, paths[1]));
  const reloaded = await listDocumentReadingActivity(owner);
  assert.equal(reloaded.find(item => item.objectPath === paths[1])!.status, "verified");
  assert.equal(reloaded.find(item => item.objectPath === paths[1])!.finishedAt, finished.job!.finishedAt);
  assert.equal((await listDocumentReadingActivity(other)).length, 1);
  assert.deepEqual(await listDocumentReadingActivity("unknown-owner"), []);
});

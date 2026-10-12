import { test } from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { eq } from "drizzle-orm";
import { db, pool, usersTable, uploadsTable, companyEvidenceTable, tendersTable, evidenceTable } from "@workspace/db";
import { removeUnusedUpload } from "./upload-cleanup";

test("cleanup retains uploads while another tender or the company library uses them", async () => {
  const ownerId = `cleanup-test-${randomUUID()}`;
  const path = `/objects/cleanup-test-${randomUUID()}`;
  await db.insert(usersTable).values({ id: ownerId });
  try {
    await db.insert(uploadsTable).values({ ownerId, objectPath: path, name: "fixture.txt", size: 20, contentType: "text/plain" });
    const [company] = await db.insert(companyEvidenceTable).values({ ownerId, objectPath: path, name: "fixture.txt", title: "Fixture", category: "company_profile", size: 20, contentType: "text/plain" }).returning();
    const [a, b] = await db.insert(tendersTable).values([{ ownerId, title: "Fixture A", agency: "Fixture" }, { ownerId, title: "Fixture B", agency: "Fixture" }]).returning();
    const [first, second] = await db.insert(evidenceTable).values([a, b].map(t => ({
      ownerId, tenderId: t.id, companyEvidenceId: company.id, objectPath: path,
      name: "fixture.txt", category: "company_profile", size: 20, contentType: "text/plain",
    }))).returning();
    const retained = async () => assert.equal((await db.select().from(uploadsTable).where(eq(uploadsTable.objectPath, path))).length, 1);
    await removeUnusedUpload(path, ownerId, { evidenceId: first.id });
    await retained();
    await removeUnusedUpload(path, ownerId, { tenderId: a.id });
    await retained();
    await removeUnusedUpload(path, ownerId, { companyEvidenceId: company.id });
    await retained();
    await db.delete(companyEvidenceTable).where(eq(companyEvidenceTable.id, company.id));
    await db.delete(evidenceTable).where(eq(evidenceTable.id, first.id));
    // Library removal nulls the link, but the remaining tender still protects the file.
    await removeUnusedUpload(path, ownerId, { evidenceId: first.id });
    await retained();
    await removeUnusedUpload(path, "unrelated-owner", { evidenceId: second.id });
    await retained();
  } finally {
    await db.delete(usersTable).where(eq(usersTable.id, ownerId));
    await pool.end();
  }
});

import { and, eq, desc, count } from "drizzle-orm";
import { db, tendersTable, evidenceTable, proposalsTable, type Tender } from "@workspace/db";
import type { Request, Response, NextFunction } from "express";

export function requireAuth(req: Request, res: Response, next: NextFunction): void {
  if (!req.isAuthenticated()) {
    res.status(401).json({ error: "Please log in to access your proposal workspace." });
    return;
  }
  next();
}

export async function ownedTender(id: string, ownerId: string) {
  const [tender] = await db.select().from(tendersTable)
    .where(and(eq(tendersTable.id, id), eq(tendersTable.ownerId, ownerId)));
  return tender;
}

export async function tenderView(tender: Tender) {
  const [[evidence], [proposals]] = await Promise.all([
    db.select({ total: count() }).from(evidenceTable).where(eq(evidenceTable.tenderId, tender.id)),
    db.select({ total: count() }).from(proposalsTable).where(eq(proposalsTable.tenderId, tender.id)),
  ]);
  const { ownerId: _ownerId, ...data } = tender;
  if (data.requirementsExtraction?.job) {
    const { sections: _sections, results: _results, token: _token, leaseUntil: _lease, cardScope: _scope, strategy: _strategy, legacyCheckpoint: _checkpoint, ...progress } = data.requirementsExtraction.job;
    data.requirementsExtraction = { ...data.requirementsExtraction, job: progress };
  }
  return { ...data, evidenceCount: evidence?.total ?? 0, proposalCount: proposals?.total ?? 0 };
}

export async function listTenderViews(ownerId: string) {
  const rows = await db.select().from(tendersTable)
    .where(eq(tendersTable.ownerId, ownerId)).orderBy(desc(tendersTable.updatedAt));
  return Promise.all(rows.map(tenderView));
}

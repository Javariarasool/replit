import { randomUUID } from "node:crypto";
import { and, eq, ne, inArray, sql } from "drizzle-orm";
import { db, evidenceTable, requirementItemsTable, tendersTable, type RequirementsExtraction } from "@workspace/db";
import { assembleTenderRequirements, extractSection, InvalidSectionOutputError, prepareTenderSections, requirementsInFlight, splitTenderText, type ExtractedSection } from "./tender-requirements";
import { appendRequirementDrafts, requirementKey } from "./requirement-items";
import { EVALUATED_CARD_SCOPE } from "./requirement-scope";

type Job = NonNullable<RequirementsExtraction["job"]>;
const sourcesMatch = (a: { id: string }[], b: { id: string }[]) =>
  JSON.stringify(a.map(f => f.id).sort()) === JSON.stringify(b.map(f => f.id).sort());

export async function requirementsProcessing(ownerId: string) {
  if (requirementsInFlight.has(ownerId)) return true;
  const rows = await db.select({ id: tendersTable.id }).from(tendersTable).where(and(
    eq(tendersTable.ownerId, ownerId),
    sql`requirements_extraction->'job'->>'status' = 'processing'`,
  )).limit(1);
  return rows.length > 0;
}

export async function queueRequirements(tenderId: string, ownerId: string, upgradeOnly = false) {
  return db.transaction(async tx => {
    // Serialize starts for this owner, including requests from multiple tabs.
    await tx.execute(sql`select pg_advisory_xact_lock(hashtext(${`requirements:${ownerId}`}))`);
    const [tender] = await tx.select().from(tendersTable).where(and(eq(tendersTable.id, tenderId), eq(tendersTable.ownerId, ownerId))).for("update");
    if (!tender) throw new Error("Tender not found.");
    const files = await tx.select().from(evidenceTable).where(and(eq(evidenceTable.tenderId, tenderId), eq(evidenceTable.category, "tender_rfp")));
    const sourceFiles = files.map(f => ({ id: f.id, name: f.name }));
    const previous = tender.requirementsExtraction;
    // An authenticated continuation may upgrade the strategy only for the
    // same already-consented sources, never silently add new tender files.
    if (upgradeOnly && (previous?.job?.status !== "processing" ||
      previous.job.cardScope !== EVALUATED_CARD_SCOPE || !sourcesMatch(sourceFiles, previous.job.sourceFiles))) return tender;
    if (previous?.job?.cardScope === EVALUATED_CARD_SCOPE && sourcesMatch(sourceFiles, previous.job.sourceFiles)) {
      if (previous.job.status === "processing" && (previous.job.strategy === "full_tender" ||
        (previous.job.token && previous.job.leaseUntil && Date.parse(previous.job.leaseUntil) > Date.now()))) return tender;
      if (previous.job.status === "failed" && previous.job.strategy === "full_tender" && (previous.job.sections?.length || previous.job.results?.length)) {
        const job: Job = { ...previous.job, status: "processing", error: null, token: null, leaseUntil: null,
          sections: previous.job.sections?.map(s => ({ ...s, attempts: 0 })) ?? [] };
        const [updated] = await tx.update(tendersTable).set({ requirementsExtraction: { ...previous, job }, updatedAt: new Date() })
          .where(eq(tendersTable.id, tenderId)).returning();
        return updated!;
      }
    }
    const active = await tx.select({ id: tendersTable.id }).from(tendersTable).where(and(eq(tendersTable.ownerId, ownerId), ne(tendersTable.id, tenderId),
      sql`requirements_extraction->'job'->>'status' = 'processing'`)).limit(1);
    if (active.length || requirementsInFlight.has(ownerId)) throw new Error("Another tender extraction is already running. Open that tender to finish it.");
    const documents = await prepareTenderSections(files);
    const job: Job = { id: randomUUID(), strategy: "full_tender", status: "processing", completedSections: 0, totalSections: documents.length,
      error: null, sourceFiles, cardScope: EVALUATED_CARD_SCOPE, sections: documents.map(d => ({ ...d, depth: 0, attempts: 0 })), results: [] };
    if (previous?.job && previous.job.strategy !== "full_tender" && (previous.job.sections?.length || previous.job.results?.length)) {
      // Retain earlier completed work privately until the replacement succeeds.
      job.legacyCheckpoint = { completedSections: previous.job.completedSections, totalSections: previous.job.totalSections,
        sections: previous.job.sections, results: previous.job.results };
    }
    const extraction: RequirementsExtraction = { ...(previous ?? {
      id: randomUUID(), requirements: "", summary: "", warnings: [], sourceFiles: [],
      extractedAt: new Date().toISOString(), reviewedAt: null,
    }), job };
    const [updated] = await tx.update(tendersTable).set({ requirementsExtraction: extraction, updatedAt: new Date() })
      .where(eq(tendersTable.id, tenderId)).returning();
    return updated!;
  });
}

// Exactly ONE provider call per HTTP request. Full-tender jobs never split
// inputs or publish partial output; retries require an explicit user action.
export async function advanceSection(job: Job, extractor = extractSection): Promise<Job> {
  const next = structuredClone(job);
  const section = next.sections?.[0];
  if (!section) return next;
  const following = next.sections?.[1];
  const separator = "\n\n--- NEXT PROCESSING CHUNK ---\n\n";
  // One bounded provider call per request, even when it covers two original
  // chunks. Do not batch recovery/retried chunks: malformed batches fall back
  // to the original individual inputs, preserving all text and checkpoints.
  const batched = following && section.depth === 0 && following.depth === 0 &&
    section.attempts === 0 && following.attempts === 0 &&
    section.text.length + separator.length + following.text.length <= 18000;
  const input = batched ? section.text + separator + following.text : section.text;
  try {
    const result: ExtractedSection = await extractor(input, next.totalSections > 1);
    next.results = [...(next.results ?? []), { label: batched ? `${section.label} + ${following.label}` : section.label, result }];
    next.sections!.splice(0, batched ? 2 : 1);
    next.completedSections += batched ? 2 : 1;
    next.error = null;
  } catch (error) {
    if (next.strategy === "full_tender") {
      section.attempts++;
      next.status = "failed";
      const detail = error && typeof error === "object"
        ? `${"code" in error ? String(error.code) : ""} ${error instanceof Error ? error.message : ""}` : "";
      const inputLimit = /context[_ ]length|context window|too many tokens|maximum input|input (?:is )?too (?:long|large)/i.test(detail);
      next.error = inputLimit
        ? "The complete tender exceeds the AI input limit. No text was omitted or split, and your previous work is unchanged."
        : error instanceof InvalidSectionOutputError
          ? error.reason === "incomplete"
            ? "The AI response reached its output limit before completing the whole tender. No partial checklist was saved. Retry full-tender extraction."
            : "The AI did not return a valid assessed-requirements checklist for the complete tender. Your previous work is unchanged; retry full-tender extraction."
          : "The AI service could not finish the complete tender in this attempt. No partial checklist was saved. Retry full-tender extraction.";
    } else if (batched && error instanceof InvalidSectionOutputError) {
      section.attempts++;
      next.error = "This batch needs smaller inputs. Saved progress is unchanged; processing will continue with the original individual chunks.";
    } else if (error instanceof InvalidSectionOutputError && section.depth < 3 && section.text.length > 4000) {
      const header = section.text.match(/^SOURCE FILE: [^\n]*\nSOURCE (?:SECTION|CHUNK): [^\n]*\n/)?.[0] ?? "";
      const pieces = splitTenderText(section.text, Math.max(2001, Math.ceil(section.text.length / 2)));
      next.sections!.splice(0, 1, ...pieces.map((text, i) => ({
        text: header && !text.startsWith(header) ? header + text : text,
        label: `${section.label} · part ${i + 1}`, depth: section.depth + 1, attempts: 0,
      })));
      next.totalSections += pieces.length - 1;
    } else {
      section.attempts++;
      // Bound transient retries; preserve checkpoints for an explicit retry.
      if (error instanceof InvalidSectionOutputError || section.attempts >= 3) next.status = "failed";
      next.error = error instanceof InvalidSectionOutputError
        ? "The AI could not separate this processing chunk into valid requirements. Completed processing chunks are saved; retry extraction."
        : "The AI service could not finish this processing chunk. Completed processing chunks are saved; retry extraction if this continues.";
    }
  }
  next.token = null;
  next.leaseUntil = null;
  return next;
}

export async function processRequirements(tenderId: string, ownerId: string, extractor = extractSection) {
  const [existing] = await db.select({ extraction: tendersTable.requirementsExtraction }).from(tendersTable)
    .where(and(eq(tendersTable.id, tenderId), eq(tendersTable.ownerId, ownerId)));
  if (!existing) throw new Error("Tender not found.");
  if (existing.extraction?.job?.status === "processing" && existing.extraction.job.strategy !== "full_tender") {
    await queueRequirements(tenderId, ownerId, true);
  }
  const claimed = await db.transaction(async tx => {
    await tx.execute(sql`select pg_advisory_xact_lock(hashtext('requirements-provider-budget'))`);
    const [tender] = await tx.select().from(tendersTable).where(and(eq(tendersTable.id, tenderId), eq(tendersTable.ownerId, ownerId))).for("update");
    if (!tender) throw new Error("Tender not found.");
    const extraction = tender.requirementsExtraction;
    const job = extraction?.job;
    if (!extraction || !job) throw new Error("Start requirement extraction with explicit AI consent first.");
    if (job.cardScope !== EVALUATED_CARD_SCOPE) {
      await tx.update(tendersTable).set({ requirementsExtraction: { ...extraction, job: {
        ...job, status: "failed", error: "Extraction rules changed to assessed requirements only. Choose Extract again to rebuild the checklist.", sections: undefined, results: undefined, token: null, leaseUntil: null,
      } } }).where(eq(tendersTable.id, tenderId));
      return null;
    }
    if (job.status !== "processing" || (job.token && job.leaseUntil && Date.parse(job.leaseUntil) > Date.now())) return null;
    if (job.strategy !== "full_tender") {
      await tx.update(tendersTable).set({ requirementsExtraction: { ...extraction, job: {
        ...job, status: "failed", error: "Tender documents changed. Choose Extract again to review all current sources together.", token: null, leaseUntil: null,
      } } }).where(eq(tendersTable.id, tenderId));
      return null;
    }
    const busy = await tx.select({ id: tendersTable.id }).from(tendersTable).where(sql`
      requirements_extraction->'job'->>'status' = 'processing'
      and requirements_extraction->'job'->>'token' is not null
      and (requirements_extraction->'job'->>'leaseUntil')::timestamptz > now()`).limit(2);
    if (busy.length >= 2) return null;
    const token = randomUUID();
    const claimedJob = { ...job, token, leaseUntil: new Date(Date.now() + 210000).toISOString() };
    await tx.update(tendersTable).set({ requirementsExtraction: { ...extraction, job: claimedJob } }).where(eq(tendersTable.id, tenderId));
    return { extraction, job: claimedJob, token };
  });
  if (!claimed) return;
  const job = await advanceSection(claimed.job, extractor);
  await db.transaction(async tx => {
    const [current] = await tx.select().from(tendersTable).where(and(eq(tendersTable.id, tenderId), eq(tendersTable.ownerId, ownerId))).for("update");
    // Fence workers replaced after a restart, expiry, deletion or changed job.
    if (!current?.requirementsExtraction || current.requirementsExtraction.job?.token !== claimed.token) return;
    let extraction = { ...current.requirementsExtraction, job };
    const files = await tx.select({ id: evidenceTable.id }).from(evidenceTable).where(and(eq(evidenceTable.tenderId, tenderId), eq(evidenceTable.category, "tender_rfp")));
    if (!sourcesMatch(files, job.sourceFiles)) {
      job.status = "failed"; job.error = "Tender documents changed. Start extraction again against the current documents.";
      delete job.sections; delete job.results;
    } else if (job.status === "processing" && !job.sections?.length) {
      // Save both the brief and ALL cards atomically. A publication failure must
      // not roll back the successful section checkpoint.
      try {
        const completed = assembleTenderRequirements(job.sourceFiles, job.results ?? []);
        // Use a savepoint so any failed insert leaves previous work intact.
        await tx.transaction(async publish => {
          await appendRequirementDrafts(publish, tenderId, ownerId, completed.id, completed.items ?? []);
          const keys = (completed.items ?? []).map(requirementKey);
          for (let offset = 0; offset < keys.length; offset += 250) {
            await publish.update(requirementItemsTable).set({ extractionId: completed.id, reviewStatus: "pending", revision: sql`${requirementItemsTable.revision} + 1`, updatedAt: new Date() })
              .where(and(eq(requirementItemsTable.tenderId, tenderId), inArray(requirementItemsTable.sourceKey, keys.slice(offset, offset + 250))));
          }
        });
        job.status = "completed"; job.error = null;
        delete job.sections; delete job.results; delete job.legacyCheckpoint;
        extraction = { ...completed, job };
      } catch (error) {
        job.status = "failed"; job.error = error instanceof Error ? error.message : "Could not save the complete extraction.";
      }
    }
    await tx.update(tendersTable).set({ requirementsExtraction: extraction, updatedAt: new Date() }).where(eq(tendersTable.id, tenderId));
  });
}

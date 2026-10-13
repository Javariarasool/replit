import { randomUUID } from "node:crypto";
import { and, eq, ne, inArray, sql } from "drizzle-orm";
import { db, evidenceTable, requirementItemsTable, tendersTable, type RequirementsExtraction } from "@workspace/db";
import { assembleTenderRequirements, extractSection, InvalidSectionOutputError, prepareTenderSections, requirementsBrief, requirementsInFlight, splitTenderText, type ExtractedSection, type RequirementsAiProvider } from "./tender-requirements";
import { filterSavedRequirementIndices, savedRequirementFilterInput } from "./requirement-filter";
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

export async function queueRequirements(tenderId: string, ownerId: string, providerOrUpgrade: RequirementsAiProvider | boolean = "openai", upgradeOnlyArg = false) {
  const requestedProvider = typeof providerOrUpgrade === "string" ? providerOrUpgrade : undefined;
  const upgradeOnly = typeof providerOrUpgrade === "boolean" ? providerOrUpgrade : upgradeOnlyArg;
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
        const provider = previous.job.sections?.length
          ? requestedProvider ?? previous.job.provider ?? "openai"
          : previous.job.provider ?? requestedProvider ?? "openai";
        const job: Job = { ...previous.job, status: "processing", error: null, token: null, leaseUntil: null,
          provider, sections: previous.job.sections?.map(s => ({ ...s, attempts: 0 })) ?? [] };
        const [updated] = await tx.update(tendersTable).set({ requirementsExtraction: { ...previous, job }, updatedAt: new Date() })
          .where(eq(tendersTable.id, tenderId)).returning();
        return updated!;
      }
    }
    const active = await tx.select({ id: tendersTable.id }).from(tendersTable).where(and(eq(tendersTable.ownerId, ownerId), ne(tendersTable.id, tenderId),
      sql`requirements_extraction->'job'->>'status' = 'processing'`)).limit(1);
    if (active.length || requirementsInFlight.has(ownerId)) throw new Error("Another tender extraction is already running. Open that tender to finish it.");
    const documents = await prepareTenderSections(files);
    const job: Job = { id: randomUUID(), strategy: "full_tender", provider: requestedProvider ?? previous?.job?.provider ?? "openai", status: "processing", completedSections: 0, totalSections: documents.length,
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

export async function queueSavedRequirementFilter(tenderId: string, ownerId: string) {
  return db.transaction(async tx => {
    await tx.execute(sql`select pg_advisory_xact_lock(hashtext(${`requirements:${ownerId}`}))`);
    const [tender] = await tx.select().from(tendersTable).where(and(eq(tendersTable.id, tenderId), eq(tendersTable.ownerId, ownerId))).for("update");
    if (!tender) throw new Error("Tender not found.");
    const previous = tender.requirementsExtraction;
    if (!previous?.items?.length) throw new Error("No saved extracted list is available to filter. Use full-tender extraction first.");
    if (previous.job?.status === "processing") {
      if (previous.job.strategy === "filter_saved") return tender;
      throw new Error("Full-tender extraction is already running. Wait for it to finish before filtering.");
    }
    const active = await tx.select({ id: tendersTable.id }).from(tendersTable).where(and(eq(tendersTable.ownerId, ownerId), ne(tendersTable.id, tenderId),
      sql`requirements_extraction->'job'->>'status' = 'processing'`)).limit(1);
    if (active.length || requirementsInFlight.has(ownerId)) throw new Error("Another tender extraction is already running. Open that tender to finish it.");
    const files = await tx.select().from(evidenceTable).where(and(eq(evidenceTable.tenderId, tenderId), eq(evidenceTable.category, "tender_rfp")));
    const sourceFiles = files.map(f => ({ id: f.id, name: f.name }));
    if (!sourcesMatch(sourceFiles, previous.sourceFiles)) throw new Error("Tender documents changed since this saved list. Use full-tender extraction against the current documents first.");
    const rows = await tx.select({ sourceKey: requirementItemsTable.sourceKey }).from(requirementItemsTable).where(and(eq(requirementItemsTable.tenderId, tenderId), eq(requirementItemsTable.ownerId, ownerId)));
    const retainedKeys = new Set(rows.map(row => row.sourceKey));
    // Do not resurrect deleted cards or classify manually added/edited entries.
    const seenKeys = new Set<string>();
    const filterItemIndexes = previous.items.flatMap((item, index) => {
      const key = requirementKey(item);
      if (!retainedKeys.has(key) || seenKeys.has(key)) return [];
      seenKeys.add(key);
      return [index];
    });
    if (!filterItemIndexes.length) throw new Error("No retained automatically extracted cards are available to filter.");
    const input = savedRequirementFilterInput(filterItemIndexes.map(index => previous.items![index]!));
    const job: Job = {
      id: randomUUID(), strategy: "filter_saved", provider: "anthropic", status: "processing",
      completedSections: 0, totalSections: 1, error: null, sourceFiles, cardScope: EVALUATED_CARD_SCOPE,
      filterCandidateCount: filterItemIndexes.length, filterItemIndexes,
      sections: [{ label: "Saved requirement list", text: input, depth: 0, attempts: 0 }], results: [],
      legacyCheckpoint: previous.job?.legacyCheckpoint,
    };
    const [updated] = await tx.update(tendersTable).set({ requirementsExtraction: { ...previous, job }, updatedAt: new Date() })
      .where(eq(tendersTable.id, tenderId)).returning();
    return updated!;
  });
}

// Exactly ONE provider call per HTTP request. Full-tender jobs never split
// inputs or publish partial output; retries require an explicit user action.
export async function advanceSection(job: Job, extractor?: typeof extractSection, filterer: typeof filterSavedRequirementIndices = filterSavedRequirementIndices): Promise<Job> {
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
    if (next.strategy === "filter_saved") {
      if (!next.filterItemIndexes?.length || next.filterCandidateCount !== next.filterItemIndexes.length) throw new Error("Saved filtering snapshot is incomplete.");
      next.filterSelectedIndexes = await filterer(input, next.filterCandidateCount);
    } else {
      const result: ExtractedSection = await (extractor ?? extractSection)(input, next.totalSections > 1, next.provider ?? "openai");
      next.results = [...(next.results ?? []), { label: batched ? `${section.label} + ${following.label}` : section.label, result }];
    }
    next.sections!.splice(0, batched ? 2 : 1);
    next.completedSections += batched ? 2 : 1;
    next.error = null;
  } catch (error) {
    if (next.strategy === "filter_saved") {
      section.attempts++;
      next.status = "failed";
      next.error = "The AI could not finish classifying every saved item. Your original list, working brief, evidence and vendor choices are unchanged. Retry filtering explicitly.";
    } else if (next.strategy === "full_tender") {
      section.attempts++;
      next.status = "failed";
      const detail = error && typeof error === "object"
        ? `${"code" in error ? String(error.code) : ""} ${error instanceof Error ? error.message : ""}` : "";
      const inputLimit = /context[_ ]length|context window|too many tokens|maximum input|input (?:is )?too (?:long|large)/i.test(detail);
      next.error = inputLimit
        ? "The complete tender exceeds the AI input limit. No text was omitted or split, and your previous work is unchanged."
        : error instanceof InvalidSectionOutputError
          ? error.reason === "incomplete"
            ? error.providerStopReason && !["length", "max_tokens"].includes(error.providerStopReason)
              ? "The selected AI stopped before returning a complete checklist. No partial checklist was saved. Retry full-tender extraction."
              : "The AI response reached its output limit before completing the whole tender. No partial checklist was saved. Retry full-tender extraction."
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

export async function processRequirements(tenderId: string, ownerId: string, extractor?: typeof extractSection, filterer?: typeof filterSavedRequirementIndices) {
  const [existing] = await db.select({ extraction: tendersTable.requirementsExtraction }).from(tendersTable)
    .where(and(eq(tendersTable.id, tenderId), eq(tendersTable.ownerId, ownerId)));
  if (!existing) throw new Error("Tender not found.");
  if (existing.extraction?.job?.status === "processing" && existing.extraction.job.strategy !== "full_tender" && existing.extraction.job.strategy !== "filter_saved") {
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
    if (job.strategy !== "full_tender" && job.strategy !== "filter_saved") {
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
  const job = await advanceSection(claimed.job, extractor, filterer);
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
        let completed: RequirementsExtraction;
        if (job.strategy === "filter_saved") {
          const original = current.requirementsExtraction;
          if (!job.filterSelectedIndexes || !job.filterItemIndexes || !original.items) throw new Error("The saved filtering result is incomplete; the original list remains unchanged.");
          const rows = await tx.select({ sourceKey: requirementItemsTable.sourceKey }).from(requirementItemsTable).where(and(eq(requirementItemsTable.tenderId, tenderId), eq(requirementItemsTable.ownerId, ownerId)));
          const retained = new Set(rows.map(row => row.sourceKey));
          const items = job.filterSelectedIndexes.map(index => {
            const itemIndex = job.filterItemIndexes![index];
            const item = itemIndex === undefined ? undefined : original.items![itemIndex];
            if (!item) throw new Error("The saved list changed during filtering; the original list remains unchanged.");
            return item;
          }).filter(item => retained.has(requirementKey(item)));
          completed = assembleTenderRequirements(job.sourceFiles, [{ label: "Saved requirement list", result: {
            items, requirements: requirementsBrief(items),
            summary: `Filtered ${items.length} assessed requirements from ${job.filterCandidateCount} saved extracted items, without extracting the tender again. Review the retained clauses against the original tender.`,
            warnings: ["Filtering classified saved clause quotes and references; no descriptions or quantities were rewritten. Excluded cards and their evidence remain stored, and manually added requirements are unchanged."],
          } }]);
          job.filterKeptCount = items.length;
        } else {
          completed = assembleTenderRequirements(job.sourceFiles, job.results ?? []);
        }
        // Use a savepoint so any failed insert leaves previous work intact.
        await tx.transaction(async publish => {
          if (job.strategy !== "filter_saved") await appendRequirementDrafts(publish, tenderId, ownerId, completed.id, completed.items ?? []);
          const keys = (completed.items ?? []).map(requirementKey);
          for (let offset = 0; offset < keys.length; offset += 250) {
            await publish.update(requirementItemsTable).set({ extractionId: completed.id, ...(job.strategy === "filter_saved" ? {} : { reviewStatus: "pending" as const }), revision: sql`${requirementItemsTable.revision} + 1`, updatedAt: new Date() })
              .where(and(eq(requirementItemsTable.tenderId, tenderId), inArray(requirementItemsTable.sourceKey, keys.slice(offset, offset + 250))));
          }
        });
        job.status = "completed"; job.error = null;
        delete job.sections; delete job.results; delete job.legacyCheckpoint; delete job.filterItemIndexes; delete job.filterSelectedIndexes;
        extraction = { ...completed, job };
      } catch (error) {
        job.status = "failed"; job.error = error instanceof Error ? error.message : "Could not save the complete extraction.";
      }
    }
    await tx.update(tendersTable).set({ requirementsExtraction: extraction, updatedAt: new Date() }).where(eq(tendersTable.id, tenderId));
  });
}

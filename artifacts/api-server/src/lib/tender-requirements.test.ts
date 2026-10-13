import { test } from "node:test";
import assert from "node:assert/strict";
import { assembleTenderRequirements, extractSectionWithRecovery, InvalidSectionOutputError, parseSectionOutput, responseJson } from "./tender-requirements";

test("provider JSON wrappers are accepted only when the entire response is complete JSON", () => {
  const value = { summary: "Complete", warnings: [], items: [] };
  assert.deepEqual(responseJson(JSON.stringify(value)), value);
  assert.deepEqual(responseJson("```json\n" + JSON.stringify(value) + "\n```"), value);
  assert.throws(() => responseJson("Here is a fragment:\n" + JSON.stringify(value)), InvalidSectionOutputError);
  assert.throws(() => responseJson('{"summary":"unfinished"'), InvalidSectionOutputError);
});
import { visibleRequirements } from "./requirement-scope";
import type { RequirementItem, RequirementsExtraction } from "@workspace/db";
import { appendRequirementDrafts } from "./requirement-items";

const result = (quote: string) => ({
  summary: quote.slice(0, 200),
  requirements: quote,
  warnings: [],
  items: [{
    title: "Clause",
    description: "Tender clause",
    category: "technical" as const,
    sourceReference: "sample.pdf · section 1",
    sourceQuote: quote.slice(0, 100),
    quantity: null as number | null,
    unit: null,
    requiresVendor: false,
    assessmentBasis: "compliance_response" as const,
    assessmentQuote: quote.slice(0, 100),
  }],
});

test("only assessed items become cards and brief entries; general statements are excluded", () => {
  const assessed = result("Bidder must mark Comply/Not comply for 12 switches.");
  const context = { ...assessed.items[0]!, title: "Agency background",
    sourceQuote: "The agency supports digital transformation.", assessmentBasis: "context" as const, assessmentQuote: "" };
  const parsed = parseSectionOutput({ ...assessed, requirements: "Full tender context and checklist.", items: [...assessed.items, context] });
  assert.equal(parsed.items.length, 1);
  assert.equal(parsed.items[0]!.title, "Clause");
  assert.match(parsed.requirements, /Clause/);
  assert.doesNotMatch(parsed.requirements, /Agency background|digital transformation|Full tender context/);
  assert.equal("assessmentBasis" in parsed.items[0]!, false);
});

test("eligibility, scored criteria and mandatory bid submissions remain assessed requirements", () => {
  const base = result("Tax registration proof is mandatory. Experience scores 20 points. Signed compliance form is required.");
  const items = ["eligibility", "scored", "mandatory_submission"].map(assessmentBasis => ({ ...base.items[0]!, assessmentBasis }));
  assert.equal(parseSectionOutput({ ...base, items }, base.requirements).items.length, 3);
});

test("one complete-tender response can retain more than 300 assessed requirements without a narrative brief", () => {
  const base = result("The bidder must mark Comply or Not comply.");
  const { requirements: _legacyBrief, ...output } = base;
  const items = Array.from({ length: 350 }, (_, i) => ({ ...base.items[0]!, title: `Assessed clause ${i}` }));
  const parsed = parseSectionOutput({ ...output, items }, base.requirements);
  assert.equal(parsed.items.length, 350);
  assert.match(parsed.requirements, /Assessed clause 349/);
});

test("missing or invented assessment evidence is rejected instead of creating a general-statement card", () => {
  const output = result("Required compliance response.");
  assert.throws(() => parseSectionOutput({ ...output, items: [{ ...output.items[0], assessmentQuote: "" }] }), InvalidSectionOutputError);
  assert.throws(() => parseSectionOutput(output, "Agency history, no evaluation requirement"), InvalidSectionOutputError);
  const { assessmentBasis: _basis, assessmentQuote: _quote, ...legacy } = output.items[0]!;
  assert.throws(() => parseSectionOutput({ ...output, items: [legacy] }), InvalidSectionOutputError);
});

test("context-only input has no invented cards or statement-based brief entries", () => {
  const output = result("The agency supports digital transformation.");
  const parsed = parseSectionOutput({ ...output, items: [{ ...output.items[0], assessmentBasis: "context", assessmentQuote: "" }] });
  const extraction = assembleTenderRequirements([{ id: "source", name: "context.pdf" }], [{ label: "context.pdf", result: parsed }]);
  assert.deepEqual(extraction.items, []);
  assert.equal(extraction.cardScope, "evaluated_only");
  assert.match(extraction.requirements, /No assessed requirements/);
  assert.doesNotMatch(extraction.requirements, /digital transformation/);
  assert.ok(extraction.warnings.some(w => /No bid-assessment/.test(w)));
});

test("current assessed checklist hides historical general cards without deleting their evidence or manual choices", () => {
  const rows = [
    { id: "assessed", sourceKey: "a", extractionId: "new" },
    { id: "general", sourceKey: "b", extractionId: "old", evidenceIds: ["saved-evidence"] },
    { id: "human", sourceKey: "c:human-uuid", extractionId: "old" },
  ] as RequirementItem[];
  const scoped = { id: "new", cardScope: "evaluated_only" } as RequirementsExtraction;
  assert.deepEqual(visibleRequirements(rows, scoped).map(r => r.id), ["assessed", "human"]);
  assert.deepEqual(rows[1]!.evidenceIds, ["saved-evidence"]);
  assert.deepEqual(visibleRequirements(rows, { id: "old" } as RequirementsExtraction).map(r => r.id), ["human"]);
});

test("invalid model output retries smaller overlapping sections and keeps all source text", async () => {
  const text = Array.from({ length: 600 }, (_, i) => `CLAUSE-${String(i).padStart(4, "0")} ${"required tender text ".repeat(4)}`).join("\n");
  const seen: string[] = [];
  const recovered = await extractSectionWithRecovery(text, true, async chunk => {
    if (chunk.length > 10000) throw new InvalidSectionOutputError("incomplete");
    seen.push(chunk);
    return result(chunk);
  });

  assert.ok(seen.length > 1);
  assert.ok(seen.every(section => section.length <= 10000));
  const read = new Set(seen.flatMap(section => [...section.matchAll(/CLAUSE-(\d{4})/g)].map(match => match[0])));
  for (let i = 0; i < 600; i++) assert.ok(read.has(`CLAUSE-${String(i).padStart(4, "0")}`));
  assert.ok(recovered.length > 1);
  assert.ok(recovered.every(section => section.items.length === 1));
});

test("provider and request failures are not retried as malformed model output", async () => {
  let attempts = 0;
  await assert.rejects(
    extractSectionWithRecovery("Tender input ".repeat(2000), true, async () => {
      attempts++;
      throw new Error("Provider request failed");
    }),
    /Provider request failed/,
  );
  assert.equal(attempts, 1);
});

test("a non-purchase zero does not discard the brief or any individual requirements", () => {
  const output = result("Advance payment must be 0%; supply 12 switches.");
  output.items[0]!.quantity = 0;
  const parsed = parseSectionOutput(output);
  assert.ok(parsed.requirements.includes(output.requirements));
  assert.equal(parsed.items.length, 1);
  assert.equal(parsed.items[0]!.quantity, null);
  assert.equal(parsed.items[0]!.sourceQuote, output.items[0]!.sourceQuote);
  assert.match(parsed.warnings.at(-1)!, /quantities are unknown/i);
  assert.equal(output.items[0]!.quantity, 0);
});

test("positive purchase counts are retained, while missing clause text is still rejected", () => {
  const output = { ...result("Supply 12 switches"), items: [{ ...result("Supply 12 switches").items[0]!, quantity: 12 }] };
  assert.equal(parseSectionOutput(output).items[0]!.quantity, 12);
  assert.throws(() => parseSectionOutput({ ...output, items: [{ ...output.items[0], description: "" }] }), InvalidSectionOutputError);
});

test("large tenders retain all cards and insert them in bounded batches", async () => {
  const batches: unknown[][] = [];
  const writer = {
    select: () => ({ from: () => ({ where: async () => [] }) }),
    insert: () => ({ values: async (rows: unknown[]) => { batches.push(rows); } }),
  } as unknown as Parameters<typeof appendRequirementDrafts>[0];
  const drafts = Array.from({ length: 1500 }, (_, i) => ({ ...result(`Clause ${i}`).items[0]!, title: `Clause ${i}` }));
  await appendRequirementDrafts(writer, "tender", "owner", "extraction", drafts);
  assert.equal(batches.flat().length, 1500);
  assert.equal(batches.length, 6);
  assert.ok(batches.every(batch => batch.length <= 250));
});

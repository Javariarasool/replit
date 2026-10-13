import { test } from "node:test";
import assert from "node:assert/strict";
import { extractSectionWithRecovery, InvalidSectionOutputError, parseSectionOutput } from "./tender-requirements";
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
  }],
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
  assert.equal(parsed.requirements, output.requirements);
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

import { test } from "node:test";
import assert from "node:assert/strict";
import { extractSectionWithRecovery, InvalidSectionOutputError } from "./tender-requirements";

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
    quantity: null,
    unit: null,
    requiresVendor: false,
  }],
});

test("invalid model output retries smaller overlapping sections and keeps all source text", async () => {
  const text = Array.from({ length: 600 }, (_, i) => `CLAUSE-${String(i).padStart(4, "0")} ${"required tender text ".repeat(4)}`).join("\n");
  const seen: string[] = [];
  const recovered = await extractSectionWithRecovery(text, true, async chunk => {
    seen.push(chunk);
    if (chunk.length > 10000) throw new InvalidSectionOutputError("incomplete");
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

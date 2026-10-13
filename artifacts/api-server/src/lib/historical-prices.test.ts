import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { eq, sql } from "drizzle-orm";
import { db, pool, usersTable, tendersTable, requirementItemsTable, evidenceTable, uploadsTable, proposalLibraryTable } from "@workspace/db";
import { historicalDocumentDate, parseHistoricalPrices, priceNumber, matchHistoricalItem } from "./historical-price-parser";
import { getHistoricalPrices } from "./historical-prices";
import { GetRequirementPriceHistoryResponse } from "@workspace/api-zod";
import { queuedExtraction } from "./document-extractions";

test("parses explicitly labelled PKR table rates, not totals, subtotals or SKU digits", () => {
  const text = `Quotation in PKR
| Item | Description | Qty | Unit | Unit price PKR | Line total PKR | Tax |
| --- | --- | --- | --- | --- | --- | --- |
| 1 | 24-port managed switch C9200L-24T | 12 | pcs | 125,000.50 | 1,500,006.00 | excluded |
| 2 | Firewall 60F | 1 | pcs | 98,000 | 98,000 | included |
|  | Grand Total |  |  |  | 1,598,006 |  |`;
  const prices = parseHistoricalPrices(text);
  assert.equal(prices.length, 2);
  assert.equal(prices[0]!.item, "24-port managed switch C9200L-24T");
  assert.equal(prices[0]!.amount, 125000.5);
  assert.equal(prices[0]!.currency, "PKR");
  assert.equal(prices[0]!.quantity, 12);
  assert.equal(prices[0]!.unit, "pcs");
  assert.equal(prices[0]!.priceBasis, "unit");
  assert.match(prices[0]!.sourceQuote, /125,000.50/);
  assert.ok(!prices.some(p => p.item.includes("Grand Total")));
  assert.equal(priceNumber("C9200L-24T"), null);
  assert.equal(priceNumber("Quote required"), null);
  assert.equal(priceNumber("1,000 - 2,000"), null);
});
test("reads CSV and quoted individual unit prices; totals are labelled rather than misrepresented as unit rates", () => {
  const csv = `Product,Quantity,Rate (PKR),Total amount
"Router, managed",3,40,000,120,000`;
  // CSV numeric fields containing commas must be quoted to form valid CSV.
  const corrected = csv.replace("3,40,000,120,000", '3,"40,000","120,000"');
  const [price] = parseHistoricalPrices(corrected);
  assert.equal(price?.item, "Router, managed");
  assert.equal(price?.amount, 40000);
  assert.equal(price?.currency, "PKR");
  const [total] = parseHistoricalPrices("Description  Qty  Total amount PKR\nFirewall 60F  2  150,000");
  assert.equal(total?.priceBasis, "line_total");
  assert.equal(total?.amount, 150000);
  const [single] = parseHistoricalPrices("Supplier: ABC Supplies\nProduct: Access Switch C9200L-24T\nQty: 12 pcs\nUnit price: Rs. 35,000");
  assert.equal(single?.amount, 35000);
  assert.equal(single?.currency, "Rs (verify currency)");
  assert.equal(historicalDocumentDate("Quotation Date: 2/10/2025"), "2025-10-02");
  assert.equal(historicalDocumentDate("Date: 2025-02-31"), null);
  const [unknown] = parseHistoricalPrices("Product: Router\nUnit Price: 20,000");
  assert.equal(unknown?.currency, null);
});
test("does not merge different capacities/models; ambiguous overlaps remain possible matches", () => {
  assert.equal(matchHistoricalItem("24-port managed switch", "48-port managed switch"), null);
  assert.equal(matchHistoricalItem("Firewall FG-60F", "Firewall FG-80F"), null);
  assert.equal(matchHistoricalItem("networking switch", "backup server"), null);
  assert.equal(matchHistoricalItem("24-port managed network switch", "24-port managed switch")?.matchType, "possible_match");
  assert.equal(matchHistoricalItem("Switch C9200L-24T", "Switch C9200L-24T")?.matchType, "same_item");
});

const schema = `past_prices_test_${randomUUID().replaceAll("-", "")}`;
pool.options.options = `${pool.options.options ?? ""} -c search_path=${schema}`;
before(async () => {
  await db.execute(sql`create schema ${sql.identifier(schema)}`);
  for (const table of ["users", "tenders", "requirement_items", "tender_evidence", "document_uploads", "proposal_library", "proposals"]) {
    await db.execute(sql`create table ${sql.identifier(schema)}.${sql.identifier(table)} (like public.${sql.identifier(table)} including all)`);
  }
});
after(async () => {
  try { await db.execute(sql`drop schema ${sql.identifier(schema)} cascade`); }
  finally { await pool.end(); }
});
test("owner's prior library proposals and verified quotations are shown with provenance; active and other-user quotes never leak", async () => {
  const ownerId = `owner-${randomUUID()}`, otherId = `other-${randomUUID()}`;
  await db.insert(usersTable).values([{ id: ownerId }, { id: otherId }]);
  const [active, previous, other] = await db.insert(tendersTable).values([
    { ownerId, agency: "Govt", title: "Active" },
    { ownerId, agency: "Govt", title: "Previous" },
    { ownerId: otherId, agency: "Other", title: "Private" },
  ]).returning();
  const [row] = await db.insert(requirementItemsTable).values({ ownerId, tenderId: active.id, title: "24-port managed switch", description: "Comply with 24 port managed network switch", category: "technical", sourceKey: randomUUID() }).returning();
  await db.insert(proposalLibraryTable).values({ ownerId, title: "Past commercial proposal", agency: "Govt", category: "networking", submissionDate: "2025-02-20",
    commercialText: "| Requirement | Unit price PKR | Qty | Line total PKR |\n| 24-port managed switch | 98,000 | 2 | 196,000 |" });
  const path = `/objects/quote-${randomUUID()}`;
  const body = "Product: 24-port managed switch\nSupplier: ABC Traders\nQuantity: 2\nUnit Price: PKR 102,000";
  await db.insert(uploadsTable).values({ ownerId, objectPath: path, name: "earlier-quotation.txt", contentType: "text/plain", size: body.length,
    extraction: { ...queuedExtraction("eng"), status: "not_needed", sourceText: body, job: undefined } });
  await db.insert(evidenceTable).values({ ownerId, tenderId: previous.id, name: "earlier-quotation.txt", category: "vendor_quote", objectPath: path, size: body.length, contentType: "text/plain" });
  const otherPath = `/objects/other-${randomUUID()}`;
  await db.insert(uploadsTable).values({ ownerId: otherId, objectPath: otherPath, name: "secret.txt", contentType: "text/plain", size: 50,
    extraction: { ...queuedExtraction("eng"), status: "not_needed", sourceText: "Product: 24-port managed switch\nUnit price: PKR 5", job: undefined } });
  await db.insert(evidenceTable).values({ ownerId: otherId, tenderId: other.id, name: "secret.txt", category: "vendor_quote", objectPath: otherPath, size: 50, contentType: "text/plain" });
  // Even an attached quote for the active tender is current evidence, not past history.
  const activePath = `/objects/active-${randomUUID()}`;
  await db.insert(uploadsTable).values({ ownerId, objectPath: activePath, name: "today.txt", contentType: "text/plain", size: body.length,
    extraction: { ...queuedExtraction("eng"), status: "not_needed", sourceText: body.replace("102,000", "200,000"), job: undefined } });
  await db.insert(evidenceTable).values({ ownerId, tenderId: active.id, name: "today.txt", category: "vendor_quote", objectPath: activePath, size: body.length, contentType: "text/plain" });
  const before = await db.select().from(requirementItemsTable).where(eq(requirementItemsTable.id, row.id));
  const history = GetRequirementPriceHistoryResponse.parse(await getHistoricalPrices(row));
  assert.equal(history.matches.length, 2);
  assert.deepEqual(history.matches.map(m => m.amount).sort((a, b) => a - b), [98000, 102000]);
  assert.equal(history.matches.find(m => m.amount === 98000)?.sourceDate, "2025-02-20");
  assert.equal(history.matches.find(m => m.amount === 102000)?.objectPath, path);
  assert.equal(history.matches.find(m => m.amount === 102000)?.sourceType, "past_quotation");
  assert.ok(history.matches.every(m => m.currency === "PKR" && /24-port managed switch/.test(m.sourceQuote)));
  assert.deepEqual(await db.select().from(requirementItemsTable).where(eq(requirementItemsTable.id, row.id)), before);
  assert.ok(history.sourcesChecked >= 2);
});

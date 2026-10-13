import { createHash } from "node:crypto";
import { and, eq, ne, inArray, desc, or } from "drizzle-orm";
import { db, proposalLibraryTable, proposalsTable, evidenceTable, uploadsTable, requirementItemsTable, tendersTable, type RequirementItem, type DocumentExtraction } from "@workspace/db";
import type { HistoricalPrice, PriceHistory } from "@workspace/api-zod";
import { draftingText } from "./document-extractions";
import { historicalDocumentDate, matchHistoricalItem, parseHistoricalPrices, type PriceLine } from "./historical-price-parser";

type PriceSource = Pick<HistoricalPrice, "sourceType" | "sourceTitle" | "sourceDate" | "dateLabel" | "sourceTenderId" | "libraryEntryId" | "objectPath"> & { id: string };
export function historicalPriceMatches(row: Pick<RequirementItem, "title" | "description">, lines: PriceLine[], source: PriceSource): HistoricalPrice[] {
  const models = row.description.match(/\b[A-Z][A-Z0-9]*-[A-Z0-9][A-Z0-9./-]*\b/g) ?? [];
  const query = `${row.title} ${[...new Set(models)].join(" ")}`;
  return lines.flatMap(line => {
    const match = matchHistoricalItem(query, line.item);
    if (!match) return [];
    return [{
      ...line, ...match, ...source,
      id: createHash("sha256").update(JSON.stringify([source.id, line.item, line.amount, line.currency, line.priceBasis])).digest("hex"),
    }];
  });
}
function readable(extraction: DocumentExtraction | null, name: string, warnings: string[]): string {
  if (!extraction || !["not_needed", "verified"].includes(extraction.status)) {
    warnings.push(`${name}: finish local document reading and verify any OCR to include its historical prices.`);
    return "";
  }
  try { return draftingText(extraction, name); }
  catch { warnings.push(`${name}: document text is unavailable; the original is unchanged.`); return ""; }
}

export async function getHistoricalPrices(row: RequirementItem): Promise<PriceHistory> {
  const owner = row.ownerId;
  const [library, proposals, quotes, previous] = await Promise.all([
    db.select().from(proposalLibraryTable).where(eq(proposalLibraryTable.ownerId, owner)).orderBy(desc(proposalLibraryTable.updatedAt)).limit(201),
    db.select().from(proposalsTable).where(and(eq(proposalsTable.ownerId, owner), ne(proposalsTable.tenderId, row.tenderId),
      eq(proposalsTable.kind, "commercial"), eq(proposalsTable.status, "approved"))).orderBy(desc(proposalsTable.updatedAt)).limit(201),
    db.select().from(evidenceTable).where(and(eq(evidenceTable.ownerId, owner), or(
      eq(evidenceTable.category, "previous_proposal"),
      and(ne(evidenceTable.tenderId, row.tenderId), eq(evidenceTable.category, "vendor_quote")),
    ))).orderBy(desc(evidenceTable.uploadedAt)).limit(201),
    db.select().from(requirementItemsTable).where(and(eq(requirementItemsTable.ownerId, owner),
      ne(requirementItemsTable.tenderId, row.tenderId))).orderBy(desc(requirementItemsTable.updatedAt)).limit(1001),
  ]);
  const warnings: string[] = [], matches: HistoricalPrice[] = [];
  if (library.length > 200 || proposals.length > 200 || quotes.length > 200 || previous.length > 1000) {
    warnings.push("This comparison checks the newest 200 records in each document source and 1,000 past requirement records. Older records outside this limit were not searched.");
  }
  const paths = [...new Set([...library.slice(0, 200).map(l => l.commercialObjectPath), ...quotes.slice(0, 200).map(q => q.objectPath)].filter((p): p is string => !!p))];
  const uploads = paths.length ? await db.select({ path: uploadsTable.objectPath, extraction: uploadsTable.extraction }).from(uploadsTable)
    .where(and(eq(uploadsTable.ownerId, owner), inArray(uploadsTable.objectPath, paths))) : [];
  const documents = new Map(uploads.map(u => [u.path, u.extraction]));
  let sourcesChecked = 0;
  const add = (text: string, source: PriceSource) => {
    if (!text.trim()) return;
    sourcesChecked++;
    const lines = parseHistoricalPrices(text);
    matches.push(...historicalPriceMatches(row, lines, source));
    if (!lines.length) warnings.push(`${source.sourceTitle}: no unambiguous item-price table or labelled unit price was found. Check the original; no price was guessed.`);
  };
  for (const entry of library.slice(0, 200)) {
    if (entry.sourceTenderId === row.tenderId) continue;
    const text = entry.commercialObjectPath ? readable(documents.get(entry.commercialObjectPath) ?? null, entry.title, warnings) : entry.commercialText;
    if (!entry.commercialObjectPath && !entry.commercialText.trim()) warnings.push(`${entry.title}: no commercial proposal with pricing has been provided.`);
    add(text, { id: entry.id, sourceType: "past_proposal", sourceTitle: entry.title,
      sourceDate: entry.submissionDate, dateLabel: "Proposal submission date", sourceTenderId: entry.sourceTenderId,
      libraryEntryId: entry.id, objectPath: entry.commercialObjectPath });
  }
  // Archived approved pairs are already covered by their library commercial text.
  const archivedTenders = new Set(library.map(l => l.sourceTenderId).filter(Boolean));
  const seenVersions = new Set<string>();
  for (const proposal of proposals.slice(0, 200)) {
    if (archivedTenders.has(proposal.tenderId) || seenVersions.has(proposal.tenderId)) continue;
    seenVersions.add(proposal.tenderId);
    add(proposal.content, { id: proposal.id, sourceType: "past_proposal", sourceTitle: `${proposal.title} · version ${proposal.version}`,
      sourceDate: proposal.updatedAt.toISOString(), dateLabel: "Proposal record updated (not quote date)",
      sourceTenderId: proposal.tenderId, libraryEntryId: null, objectPath: null });
  }
  for (const quote of quotes.slice(0, 200)) {
    const text = readable(documents.get(quote.objectPath) ?? null, quote.name, warnings);
    const documentDate = historicalDocumentDate(text);
    add(text, { id: quote.id, sourceType: quote.category === "vendor_quote" ? "past_quotation" : "past_proposal", sourceTitle: quote.name,
      sourceDate: documentDate, dateLabel: documentDate ? "Date stated in document" : "Quote/document date not recorded", sourceTenderId: quote.tenderId,
      libraryEntryId: null, objectPath: quote.objectPath });
  }
  const tenderIds = [...new Set(previous.slice(0, 1000).map(p => p.tenderId))];
  const oldTenders = tenderIds.length ? await db.select({ id: tendersTable.id, title: tendersTable.title }).from(tendersTable)
    .where(and(eq(tendersTable.ownerId, owner), inArray(tendersTable.id, tenderIds))) : [];
  const tenderNames = new Map(oldTenders.map(t => [t.id, t.title]));
  for (const past of previous.slice(0, 1000)) {
    if (!tenderNames.has(past.tenderId)) continue;
    const priced = past.options.filter(o => o.reviewed && o.pricePkr !== null && (o.priceType === "quotation" || o.id === past.selectedOptionId));
    if (priced.length) sourcesChecked++;
    for (const option of priced) {
      const source: PriceSource = { id: option.id, sourceType: "supplier_record",
        sourceTitle: `${tenderNames.get(past.tenderId)} · ${past.title}`, sourceDate: option.checkedAt,
        dateLabel: "Price checked on (not quote validity)", sourceTenderId: past.tenderId, libraryEntryId: null, objectPath: null };
      matches.push(...historicalPriceMatches(row, [{
        item: `${past.title} · ${option.manufacturer} ${option.product} ${option.model}`, supplier: option.supplier,
        amount: option.pricePkr!, currency: "PKR", priceBasis: "unit", quantity: past.quantity, unit: past.unit,
        taxStatus: option.taxStatus,
        sourceQuote: `${option.manufacturer} ${option.product} ${option.model}\nSupplier: ${option.supplier}\nUnit price PKR: ${option.pricePkr}\nTax: ${option.taxStatus}\n${option.priceNotes}`,
      }], source));
    }
  }
  const unique = matches.filter((m, i) => matches.findIndex(other => other.id === m.id) === i);
  unique.sort((a, b) => (a.matchType === b.matchType ? 0 : a.matchType === "same_item" ? -1 : 1) ||
    (b.sourceDate ?? "").localeCompare(a.sourceDate ?? ""));
  if (unique.length > 100) warnings.push("Showing the 100 best/most recent matching historical references; additional matches are not displayed.");
  return { matches: unique.slice(0, 100), warnings: [...new Set(warnings)], sourcesChecked };
}

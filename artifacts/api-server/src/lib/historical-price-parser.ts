export interface PriceLine {
  item: string; supplier: string | null; amount: number; currency: string | null;
  priceBasis: "unit" | "line_total"; quantity: number | null; unit: string | null;
  taxStatus: string; sourceQuote: string;
}
const clean = (s: string) => s.replace(/[*_`]/g, "").trim();
const currency = (s: string): string | null => {
  const found = s.match(/\b(PKR|USD|EUR|GBP|AED|SAR)\b/i);
  if (found) return found[1]!.toUpperCase();
  if (/pakistani rupees/i.test(s)) return "PKR";
  if (/\bRs\.?(?:\s|$)/i.test(s)) return "Rs (verify currency)";
  return null;
};
export function priceNumber(text: string): number | null {
  // Never parse a digit embedded in a SKU, an unknown quote, or a formula.
  const stripped = clean(text).replace(/\b(?:PKR|USD|EUR|GBP|AED|SAR|Rs\.?)\b/gi, "").replace(/^[\s.:]+/, "").trim();
  if (!/^\d+(?:,\d{3})*(?:\.\d{1,4})?$/.test(stripped)) return null;
  const amount = Number(stripped.replaceAll(",", ""));
  return Number.isFinite(amount) && amount <= 1e12 ? amount : null;
}
export function historicalDocumentDate(text: string): string | null {
  const date = text.match(/(?:quotation\s*date|quote\s*date|proposal\s*date|date)\s*:\s*(\d{4}-\d{2}-\d{2}|\d{1,2}\/\d{1,2}\/\d{4})\b/i)?.[1];
  if (!date) return null;
  const parts = date.includes("/") ? date.split("/").reverse() : date.split("-");
  const iso = `${parts[0]}-${parts[1]!.padStart(2, "0")}-${parts[2]!.padStart(2, "0")}`;
  const parsed = new Date(`${iso}T00:00:00Z`);
  return Number.isNaN(parsed.getTime()) || parsed.toISOString().slice(0, 10) !== iso ? null : iso;
}
function csv(line: string) {
  const cells: string[] = []; let cell = "", quoted = false;
  for (let i = 0; i < line.length; i++) {
    const ch = line[i]!;
    if (ch === '"' && line[i + 1] === '"' && quoted) { cell += '"'; i++; }
    else if (ch === '"') quoted = !quoted;
    else if (ch === "," && !quoted) { cells.push(cell); cell = ""; }
    else cell += ch;
  }
  cells.push(cell); return cells.map(clean);
}
function cells(line: string, delimiter: "pipe" | "tab" | "csv" | "space") {
  if (delimiter === "pipe") return line.trim().replace(/^\|/, "").replace(/\|$/, "").split(/(?<!\\)\|/).map(clean);
  if (delimiter === "tab") return line.split("\t").map(clean);
  if (delimiter === "csv") return csv(line);
  return line.trim().split(/\s{2,}/).map(clean);
}
export function parseHistoricalPrices(text: string): PriceLine[] {
  const lines = text.split(/\r?\n/);
  const prices: PriceLine[] = [];
  // Currency may be in the document heading, but conflicting currencies are
  // never collapsed into an assumed PKR amount.
  const currencies = [...new Set([...text.matchAll(/\b(PKR|USD|EUR|GBP|AED|SAR)\b/gi)].map(m => m[1]!.toUpperCase()))];
  const documentCurrency = currencies.length === 1 ? currencies[0]! : null;
  for (let i = 0; i < lines.length; i++) {
    const header = lines[i]!;
    const delimiter = header.includes("|") ? "pipe" : header.includes("\t") ? "tab" : header.includes(",") ? "csv" : "space";
    const columns = cells(header, delimiter);
    const describedItem = columns.findIndex(c => /^(?:item description|description|product(?: name)?|particulars|requirement)/i.test(c));
    const itemIndex = describedItem >= 0 ? describedItem : columns.findIndex(c => /^(?:item|oem\s*\/)/i.test(c));
    const explicitUnitPrice = columns.findIndex(c => /(?:unit\s*(?:price|rate|cost)|(?:price|rate|cost)\s*per\s*unit)/i.test(c));
    const totalPrice = columns.findIndex(c => /(?:line\s*total|total\s*(?:price|amount)|amount)/i.test(c));
    const unitPrice = explicitUnitPrice >= 0 ? explicitUnitPrice :
      totalPrice >= 0 && columns.some(c => /^(qty|quantity)/i.test(c)) ? columns.findIndex(c => /^(?:rate|price)\b/i.test(c)) : -1;
    const priceIndex = unitPrice >= 0 ? unitPrice : totalPrice;
    if (columns.length < 2 || itemIndex < 0 || priceIndex < 0 || priceIndex === itemIndex) continue;
    const productIndex = columns.findIndex(c => /(?:oem.*product|model|part\s*(?:number|no)|sku)/i.test(c));
    const supplierIndex = columns.findIndex(c => /^(?:supplier|vendor|seller)/i.test(c));
    const quantityIndex = columns.findIndex(c => /^(?:qty|quantity)/i.test(c));
    const unitIndex = columns.findIndex(c => /^(?:unit|uom)$/i.test(c));
    const taxIndex = columns.findIndex(c => /^(?:tax|gst|vat)/i.test(c));
    const currencyIndex = columns.findIndex(c => /^currency$/i.test(c));
    for (let j = i + 1; j < lines.length; j++) {
      const line = lines[j]!;
      if (!line.trim()) break;
      if (/^[\s|:,\t-]+$/.test(line)) continue;
      const row = cells(line, delimiter);
      if (row.length !== columns.length) break;
      if (!row[itemIndex] || /^(?:sub[\s-]*total|grand\s*total|total|tax|gst|vat)\b/i.test(row[itemIndex]!)) continue;
      const amount = priceNumber(row[priceIndex]!);
      if (amount === null) continue;
      const q = quantityIndex >= 0 ? row[quantityIndex]!.match(/^([\d,]+(?:\.\d+)?)\s*(.*)$/) : null;
      const quantity = q ? priceNumber(q[1]!) : null;
      prices.push({
        item: [...new Set([row[itemIndex]!, productIndex >= 0 ? row[productIndex]! : ""].filter(Boolean))].join(" · "),
        supplier: supplierIndex >= 0 ? row[supplierIndex] || null : null,
        amount, currency: (currencyIndex >= 0 ? currency(row[currencyIndex]!) : null) ?? currency(row[priceIndex]!) ?? currency(columns[priceIndex]!) ?? documentCurrency,
        priceBasis: unitPrice >= 0 ? "unit" : "line_total",
        quantity: quantity !== null && quantity > 0 ? quantity : null,
        unit: unitIndex >= 0 ? row[unitIndex] || null : q?.[2]?.trim() || null,
        taxStatus: taxIndex >= 0 ? row[taxIndex] || "Not stated" : "Not stated",
        sourceQuote: `${header}\n${line}`.slice(0, 5000),
      });
    }
  }
  // Explicitly labelled single-item quotes, including common PDF text layouts.
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i]!;
    const money = line.match(/\b(?:unit\s*(?:price|rate|cost)|(?:price|rate)\s*per\s*unit)\s*(?:\((PKR|USD|EUR|GBP)\))?\s*[:=\-]?\s*(PKR|USD|EUR|GBP|Rs\.?)?\s*([\d][\d,]*(?:\.\d+)?)\s*$/i);
    if (!money) continue;
    const amount = priceNumber(money[3]!);
    if (amount === null) continue;
    const nearby = lines.slice(Math.max(0, i - 6), i + 1);
    const labelled = nearby.filter(s => /^(?:item|product|description|model)\s*:/i.test(s));
    const prefix = line.slice(0, money.index).replace(/[—:;\-]+\s*$/, "").trim();
    const item = labelled.map(s => s.replace(/^(?:item|product|description|model)\s*:\s*/i, "").trim()).join(" · ") || prefix;
    if (!item) continue; // A bare amount must never become an unnamed item.
    const supplier = nearby.find(s => /^(?:supplier|vendor|seller)\s*:/i.test(s))?.split(":").slice(1).join(":").trim() || null;
    const qtyLine = nearby.join("\n").match(/(?:qty|quantity)\s*:\s*([\d,]+(?:\.\d+)?)\s*([^\n]*)/i);
    prices.push({ item, supplier, amount, currency: currency(`${money[1] ?? ""} ${money[2] ?? ""}`) ?? documentCurrency,
      priceBasis: "unit", quantity: qtyLine ? priceNumber(qtyLine[1]!) : null, unit: qtyLine?.[2]?.trim() || null,
      taxStatus: "Not stated", sourceQuote: nearby.join("\n").slice(0, 5000) });
  }
  return prices.filter((p, i) => prices.findIndex(other => other.item === p.item && other.amount === p.amount && other.priceBasis === p.priceBasis && other.currency === p.currency) === i);
}

const stopWords = new Set("the a an and of for with supply provide required requirement shall must bidder equipment item product installation delivery support warranty quantity qty units unit each".split(" "));
function words(text: string) {
  return [...new Set(text.toLowerCase().replace(/(\d+)\s*[- ]?\s*ports?\b/g, "$1port").match(/[a-z0-9]+(?:[-./][a-z0-9]+)*/g) ?? [])]
    .filter(w => !stopWords.has(w) && !/^\d+$/.test(w))
    .map(w => ({ switches: "switch", routers: "router", servers: "server", licenses: "license", licences: "license", firewalls: "firewall" })[w] ?? w);
}
export function matchHistoricalItem(query: string, item: string): { matchType: "same_item" | "possible_match"; matchNotes: string } | null {
  const a = words(query), b = words(item);
  if (!a.length || !b.length) return null;
  const models = (w: string[]) => w.filter(s => /[a-z]/.test(s) && /\d/.test(s) && !/^\d+(?:port|gb|tb|mb|ghz|mhz)$/.test(s));
  const am = models(a), bm = models(b);
  if (am.length && bm.length && !am.some(m => bm.includes(m))) return null;
  const capacities = (w: string[]) => w.filter(s => /^\d+(?:port|gb|tb|mb|ghz|mhz)$/.test(s));
  const ac = capacities(a), bc = capacities(b);
  if (ac.length && bc.length && !ac.every(c => bc.includes(c))) return null;
  if ((am.length && am.some(m => bm.includes(m))) || (a.length === b.length && a.every(w => b.includes(w)))) {
    return { matchType: "same_item", matchNotes: "Matching item description or model identifier. Verify configuration, licence term, unit, quantity and tax basis against the original." };
  }
  const overlap = a.filter(w => b.includes(w)).length;
  if (overlap < Math.min(2, a.length) || overlap / Math.min(a.length, b.length) < 0.6) return null;
  return { matchType: "possible_match", matchNotes: "Description overlap only—not confirmed identical. Verify the exact model, specifications and licence/support terms before using this price." };
}

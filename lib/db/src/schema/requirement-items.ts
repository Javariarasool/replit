import { pgTable, uuid, varchar, text, jsonb, boolean, doublePrecision, timestamp, index, integer } from "drizzle-orm/pg-core";
import { tendersTable } from "./tenders";
import { usersTable } from "./auth";

export interface RequirementDraft {
  title: string;
  description: string;
  category: "technical" | "eligibility" | "commercial" | "submission" | "delivery" | "services" | "other";
  sourceReference: string;
  sourceQuote: string;
  quantity: number | null;
  unit: string | null;
  requiresVendor: boolean;
}
export interface RequirementWebEvidence {
  id: string;
  url: string;
  title: string;
  claim: string;
  verified: boolean;
}
export interface SupplierOption {
  id: string;
  origin: "web" | "manual";
  manufacturer: string;
  product: string;
  model: string;
  supplier: string;
  supplierUrl: string | null;
  datasheetUrl: string | null;
  specifications: string[];
  matchSummary: string;
  gaps: string[];
  deliveryStatus: "source_states_pakistan" | "unconfirmed";
  deliverySourceUrl: string | null;
  deliveryNotes: string;
  pricePkr: number | null;
  priceSourceUrl: string | null;
  quoteEvidenceId: string | null;
  priceType: "published" | "quotation" | "not_published";
  taxStatus: "included" | "excluded" | "unknown";
  priceNotes: string;
  checkedAt: string;
  reviewed: boolean;
  sources: { url: string; title: string; quote: string }[];
}
export const requirementItemsTable = pgTable("requirement_items", {
  id: uuid("id").defaultRandom().primaryKey(),
  tenderId: uuid("tender_id").notNull().references(() => tendersTable.id, { onDelete: "cascade" }),
  ownerId: varchar("owner_id").notNull().references(() => usersTable.id, { onDelete: "cascade" }),
  extractionId: uuid("extraction_id"),
  sourceKey: text("source_key").notNull(),
  revision: integer("revision").notNull().default(0),
  title: text("title").notNull(),
  description: text("description").notNull(),
  category: text("category").$type<RequirementDraft["category"]>().notNull(),
  sourceReference: text("source_reference").notNull().default(""),
  sourceQuote: text("source_quote").notNull().default(""),
  quantity: doublePrecision("quantity"),
  unit: text("unit"),
  requiresVendor: boolean("requires_vendor").notNull().default(false),
  reviewStatus: text("review_status").$type<"pending" | "approved">().notNull().default("pending"),
  evidenceIds: jsonb("evidence_ids").$type<string[]>().notNull().default([]),
  webEvidence: jsonb("web_evidence").$type<RequirementWebEvidence[]>().notNull().default([]),
  options: jsonb("options").$type<SupplierOption[]>().notNull().default([]),
  selectedOptionId: uuid("selected_option_id"),
  researchStatus: text("research_status").$type<"idle" | "complete" | "failed">().notNull().default("idle"),
  researchError: text("research_error"),
  lastResearchedAt: timestamp("last_researched_at", { withTimezone: true }),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
}, t => [index("requirement_items_tender_idx").on(t.tenderId)]);
export type RequirementItem = typeof requirementItemsTable.$inferSelect;

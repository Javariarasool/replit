import { createInsertSchema } from "drizzle-zod";
import { relations } from "drizzle-orm";
import {
  date,
  integer,
  jsonb,
  pgTable,
  text,
  timestamp,
  uniqueIndex,
  uuid,
  varchar,
} from "drizzle-orm/pg-core";
import { z } from "zod/v4";
import { usersTable } from "./auth";

export interface RequirementsExtraction {
  id: string;
  requirements: string;
  summary: string;
  sourceFiles: { id: string; name: string }[];
  warnings: string[];
  extractedAt: string;
  reviewedAt: string | null;
  items?: import("./requirement-items").RequirementDraft[];
}

export const tendersTable = pgTable("tenders", {
  id: uuid("id").defaultRandom().primaryKey(),
  ownerId: varchar("owner_id")
    .notNull()
    .references(() => usersTable.id, { onDelete: "cascade" }),
  title: text("title").notNull(),
  agency: text("agency").notNull(),
  referenceNumber: text("reference_number"),
  category: text("category").notNull().default("mixed"),
  closingDate: date("closing_date", { mode: "string" }),
  summary: text("summary").notNull().default(""),
  requirements: text("requirements").notNull().default(""),
  requirementsExtraction: jsonb("requirements_extraction").$type<RequirementsExtraction>(),
  status: text("status").notNull().default("draft"),
  createdAt: timestamp("created_at", { withTimezone: true })
    .notNull()
    .defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true })
    .notNull()
    .defaultNow()
    .$onUpdate(() => new Date()),
});

export const evidenceTable = pgTable(
  "tender_evidence",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    tenderId: uuid("tender_id")
      .notNull()
      .references(() => tendersTable.id, { onDelete: "cascade" }),
    ownerId: varchar("owner_id")
      .notNull()
      .references(() => usersTable.id, { onDelete: "cascade" }),
    name: text("name").notNull(),
    category: text("category").notNull(),
    objectPath: text("object_path").notNull(),
    contentType: text("content_type").notNull(),
    size: integer("size").notNull(),
    notes: text("notes").notNull().default(""),
    uploadedAt: timestamp("uploaded_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (table) => [uniqueIndex("tender_evidence_object_path_idx").on(table.objectPath)],
);

export const vendorSourcesTable = pgTable("vendor_sources", {
  id: uuid("id").defaultRandom().primaryKey(),
  tenderId: uuid("tender_id")
    .notNull()
    .references(() => tendersTable.id, { onDelete: "cascade" }),
  ownerId: varchar("owner_id")
    .notNull()
    .references(() => usersTable.id, { onDelete: "cascade" }),
  manufacturer: text("manufacturer").notNull(),
  product: text("product").notNull(),
  claim: text("claim").notNull(),
  sourceUrl: text("source_url").notNull(),
  sourceTitle: text("source_title").notNull().default(""),
  reviewStatus: text("review_status").notNull().default("pending"),
  reviewedAt: timestamp("reviewed_at", { withTimezone: true }),
  createdAt: timestamp("created_at", { withTimezone: true })
    .notNull()
    .defaultNow(),
});

export const proposalsTable = pgTable("proposals", {
    id: uuid("id").defaultRandom().primaryKey(),
    tenderId: uuid("tender_id")
      .notNull()
      .references(() => tendersTable.id, { onDelete: "cascade" }),
    ownerId: varchar("owner_id")
      .notNull()
      .references(() => usersTable.id, { onDelete: "cascade" }),
    kind: text("kind").notNull(),
    title: text("title").notNull(),
    content: text("content").notNull(),
    status: text("status").notNull().default("needs_review"),
    version: integer("version").notNull().default(1),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .notNull()
      .defaultNow()
      .$onUpdate(() => new Date()),
});

export const tendersRelations = relations(tendersTable, ({ many }) => ({
  evidence: many(evidenceTable),
  vendorSources: many(vendorSourcesTable),
  proposals: many(proposalsTable),
}));

export const insertTenderSchema = createInsertSchema(tendersTable).omit({
  id: true,
  createdAt: true,
  updatedAt: true,
});
export const insertEvidenceSchema = createInsertSchema(evidenceTable).omit({
  id: true,
  uploadedAt: true,
});
export const insertVendorSourceSchema = createInsertSchema(vendorSourcesTable).omit({
  id: true,
  createdAt: true,
  reviewedAt: true,
});
export const insertProposalSchema = createInsertSchema(proposalsTable).omit({
  id: true,
  updatedAt: true,
});

export type InsertTender = z.infer<typeof insertTenderSchema>;
export type Tender = typeof tendersTable.$inferSelect;
export type Evidence = typeof evidenceTable.$inferSelect;
export type VendorSource = typeof vendorSourcesTable.$inferSelect;
export type Proposal = typeof proposalsTable.$inferSelect;

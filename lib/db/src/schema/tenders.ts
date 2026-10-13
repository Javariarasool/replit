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
import { companyEvidenceTable } from "./company-evidence";

export interface RequirementsExtraction {
  id: string;
  requirements: string;
  summary: string;
  sourceFiles: { id: string; name: string }[];
  warnings: string[];
  extractedAt: string;
  reviewedAt: string | null;
  items?: import("./requirement-items").RequirementDraft[];
  cardScope?: "evaluated_only";
  job?: {
    id: string;
    status: "processing" | "failed" | "completed";
    completedSections: number;
    totalSections: number;
    error: string | null;
    sourceFiles: { id: string; name: string }[];
    // Internal durable checkpoints, never included in public tender views.
    sections?: { label: string; text: string; depth: number; attempts: number }[];
    results?: { label: string; result: { summary: string; requirements: string; warnings: string[]; items: import("./requirement-items").RequirementDraft[] } }[];
    token?: string | null;
    leaseUntil?: string | null;
    cardScope?: "evaluated_only";
    strategy?: "full_tender";
    legacyCheckpoint?: {
      completedSections: number;
      totalSections: number;
      sections?: NonNullable<RequirementsExtraction["job"]>["sections"];
      results?: NonNullable<RequirementsExtraction["job"]>["results"];
    };
  };
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
    companyEvidenceId: uuid("company_evidence_id").references(() => companyEvidenceTable.id, { onDelete: "set null" }),
    applicability: text("applicability").notNull().default("pending"),
    companySnapshot: jsonb("company_snapshot").$type<{
      issueDate: string | null; expiryDate: string | null; tenderCategory: string | null;
      agency: string; tenderReference: string; notes: string;
    }>(),
    uploadedAt: timestamp("uploaded_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (table) => [uniqueIndex("tender_evidence_tender_object_idx").on(table.tenderId, table.objectPath)],
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

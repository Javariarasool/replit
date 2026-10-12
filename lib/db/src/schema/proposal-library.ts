import { date, jsonb, pgTable, text, timestamp, uuid, varchar } from "drizzle-orm/pg-core";
import { usersTable } from "./auth";
import { tendersTable } from "./tenders";

export const proposalLibraryTable = pgTable("proposal_library", {
  id: uuid("id").defaultRandom().primaryKey(),
  ownerId: varchar("owner_id").notNull().references(() => usersTable.id, { onDelete: "cascade" }),
  title: text("title").notNull(),
  tenderTitle: text("tender_title").notNull().default(""),
  agency: text("agency").notNull(),
  category: text("category").notNull(),
  referenceNumber: text("reference_number"),
  submissionDate: date("submission_date", { mode: "string" }),
  outcome: text("outcome").notNull().default("unknown"),
  versionLabel: text("version_label").notNull().default("Final"),
  notes: text("notes").notNull().default(""),
  tenderObjectPath: text("tender_object_path"),
  technicalObjectPath: text("technical_object_path"),
  commercialObjectPath: text("commercial_object_path"),
  sourceTenderId: uuid("source_tender_id").references(() => tendersTable.id, { onDelete: "set null" }),
  tenderText: text("tender_text").notNull().default(""),
  technicalText: text("technical_text").notNull().default(""),
  commercialText: text("commercial_text").notNull().default(""),
  extractionWarnings: jsonb("extraction_warnings").$type<string[]>().notNull().default([]),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow().$onUpdate(() => new Date()),
});

export type ProposalLibraryEntry = typeof proposalLibraryTable.$inferSelect;

import { date, integer, pgTable, text, timestamp, uuid, varchar } from "drizzle-orm/pg-core";
import { usersTable } from "./auth";

export const companyEvidenceTable = pgTable("company_evidence", {
  id: uuid("id").defaultRandom().primaryKey(),
  ownerId: varchar("owner_id").notNull().references(() => usersTable.id, { onDelete: "cascade" }),
  title: text("title").notNull(),
  category: text("category").notNull(),
  name: text("name").notNull(),
  objectPath: text("object_path").notNull(),
  contentType: text("content_type").notNull(),
  size: integer("size").notNull(),
  notes: text("notes").notNull().default(""),
  issueDate: date("issue_date", { mode: "string" }),
  expiryDate: date("expiry_date", { mode: "string" }),
  tenderCategory: text("tender_category"),
  agency: text("agency").notNull().default(""),
  tenderReference: text("tender_reference").notNull().default(""),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

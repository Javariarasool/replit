import { pgTable, text, integer, varchar, timestamp } from "drizzle-orm/pg-core";
import { usersTable } from "./auth";

export const uploadsTable = pgTable("document_uploads", {
  objectPath: text("object_path").primaryKey(),
  ownerId: varchar("owner_id").notNull().references(() => usersTable.id, { onDelete: "cascade" }),
  name: text("name").notNull(),
  size: integer("size").notNull(),
  contentType: text("content_type").notNull(),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

import { pgTable, text, integer, varchar, timestamp, jsonb } from "drizzle-orm/pg-core";
import { usersTable } from "./auth";

export type DocumentExtraction = {
  sourceText: string;
  ocrText: string;
  confidence: number | null;
  pages: { page: number; text: string; confidence: number | null }[];
  status: "queued" | "running" | "not_needed" | "needs_review" | "verified" | "rejected" | "failed";
  error: string | null;
  reviewedText: string | null;
  reviewedAt: string | null;
  engine: string;
  // Optional for extractions saved before language selection was introduced.
  language?: "eng" | "urd" | "eng+urd";
  job?: {
    id: string;
    status: "queued" | "running" | "completed" | "failed";
    completedPages: number;
    totalPages: number | null;
    stage: string;
    queuedAt: string;
    finishedAt: string | null;
    // Worker fencing and expiry allow safe recovery across server restarts.
    token: string | null;
    leaseUntil: string | null;
  };
};

export const uploadsTable = pgTable("document_uploads", {
  objectPath: text("object_path").primaryKey(),
  ownerId: varchar("owner_id").notNull().references(() => usersTable.id, { onDelete: "cascade" }),
  name: text("name").notNull(),
  size: integer("size").notNull(),
  contentType: text("content_type").notNull(),
  extraction: jsonb("extraction").$type<DocumentExtraction>(),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

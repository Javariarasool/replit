import { pgTable, text, varchar, timestamp } from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { usersTable } from "./auth";

export const companyBrandingTable = pgTable("company_branding", {
  ownerId: varchar("owner_id").primaryKey().references(() => usersTable.id, { onDelete: "cascade" }),
  companyName: text("company_name").notNull().default(""),
  logoObjectPath: text("logo_object_path"),
  logoContentType: text("logo_content_type"),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow().$onUpdate(() => new Date()),
});
export const insertCompanyBrandingSchema = createInsertSchema(companyBrandingTable);
export type CompanyBranding = typeof companyBrandingTable.$inferSelect;

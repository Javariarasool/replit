import { Router, type IRouter } from "express";
import { and, eq } from "drizzle-orm";
import { db, companyBrandingTable, uploadsTable } from "@workspace/db";
import { GetCompanyBrandingResponse, UpdateCompanyBrandingBody, UpdateCompanyBrandingResponse } from "@workspace/api-zod";
import { requireAuth } from "../lib/tender-data";
import { ObjectStorageService } from "../lib/objectStorage";
import { logoDimensions } from "../lib/company-logo";

const router: IRouter = Router();
const storage = new ObjectStorageService();
router.use(requireAuth);
router.get("/company-branding", async (req, res): Promise<void> => {
  const [row] = await db.select().from(companyBrandingTable).where(eq(companyBrandingTable.ownerId, req.user!.id));
  res.json(GetCompanyBrandingResponse.parse(row ? { ...row, updatedAt: row.updatedAt.toISOString() } :
    { companyName: "", logoObjectPath: null, logoContentType: null, updatedAt: null }));
});
router.put("/company-branding", async (req, res): Promise<void> => {
  const body = UpdateCompanyBrandingBody.safeParse(req.body);
  if (!body.success) { res.status(400).json({ error: "Provide a company name and an owned PNG/JPEG upload, or null to remove the logo." }); return; }
  const ownerId = req.user!.id, path = body.data.logoObjectPath;
  let logoContentType: string | null = null;
  try {
    if (path) {
      const [upload] = await db.select().from(uploadsTable).where(and(eq(uploadsTable.ownerId, ownerId), eq(uploadsTable.objectPath, path)));
      if (!upload) { res.status(404).json({ error: "Logo upload not found in your account." }); return; }
      if (upload.size > 2 * 1024 * 1024) throw new Error("Company logos must be 2 MB or smaller.");
      const object = await storage.getObjectEntityFile(path);
      const [metadata] = await object.getMetadata();
      if (Number(metadata.size) > 2 * 1024 * 1024) throw new Error("Company logos must be 2 MB or smaller.");
      const [bytes] = await object.download();
      logoContentType = logoDimensions(bytes).contentType;
    }
    const values = { companyName: body.data.companyName.trim(), logoObjectPath: path, logoContentType, updatedAt: new Date() };
    const [row] = await db.insert(companyBrandingTable).values({ ownerId, ...values })
      .onConflictDoUpdate({ target: companyBrandingTable.ownerId, set: values }).returning();
    res.json(UpdateCompanyBrandingResponse.parse({ ...row, updatedAt: row.updatedAt.toISOString() }));
  } catch (error) {
    res.status(400).json({ error: error instanceof Error ? error.message : "Could not save branding. Previously saved branding is unchanged." });
  }
});
export default router;

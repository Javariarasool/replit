import { test } from "node:test";
import assert from "node:assert/strict";
import { evidenceWarnings, validEvidenceDates } from "./company-evidence";

const meta = { issueDate: "2025-01-01", expiryDate: "2027-01-01", tenderCategory: null, agency: "", tenderReference: "" };
const tender = { category: "networking", agency: "Agency A", referenceNumber: "REF-1", closingDate: "2026-12-01" };
const today = "2026-10-12";
test("valid reviewed evidence has no warnings", () => {
  assert.deepEqual(evidenceWarnings(meta, tender, "applicable", today), []);
});
test("expiry is inclusive, and compared to tender closing", () => {
  assert.deepEqual(evidenceWarnings({ ...meta, expiryDate: today }, undefined, "pending", today), []);
  assert.match(evidenceWarnings({ ...meta, expiryDate: "2026-10-11" }, tender, "applicable", today)[0], /Expired/);
  assert.match(evidenceWarnings({ ...meta, expiryDate: "2026-11-01" }, tender, "applicable", today)[0], /before tender/);
});
test("date, agency, category and reference mismatches cannot be cleared by reviewer", () => {
  const warnings = evidenceWarnings({ ...meta, issueDate: "2026-11-01", tenderCategory: "software", agency: "Agency B", tenderReference: "REF-2" }, tender, "applicable", today);
  assert.equal(warnings.length, 4);
  assert.match(warnings.join(" "), /Not yet issued/);
  assert.match(warnings.join(" "), /category/);
  assert.match(warnings.join(" "), /agency/);
  assert.match(warnings.join(" "), /reference/);
});
test("unreviewed, rejected applicability and unknown validity are explicit", () => {
  assert.match(evidenceWarnings(meta, tender, "pending", today).join(" "), /not been reviewed/);
  assert.match(evidenceWarnings(meta, tender, "not_applicable", today).join(" "), /Marked not applicable/);
  assert.match(evidenceWarnings({ ...meta, expiryDate: null }, tender, "applicable", today).join(" "), /not recorded/);
});
test("dates are strict calendar days with ordered bounds", () => {
  assert.equal(validEvidenceDates(meta), true);
  assert.equal(validEvidenceDates({ issueDate: null, expiryDate: null }), true);
  assert.equal(validEvidenceDates({ issueDate: "2026-02-30", expiryDate: null }), false);
  assert.equal(validEvidenceDates({ issueDate: "2026-10-12", expiryDate: "2026-10-11" }), false);
  assert.equal(validEvidenceDates({ issueDate: "2026-10-12T00:00:00Z", expiryDate: null }), false);
});
